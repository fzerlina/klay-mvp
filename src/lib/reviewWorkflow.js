// The AP review/approval RULES ENGINE — runs over non-posted bills and emits
// flags at three severities, per Vina's flowchart (2026-07-11). See the memory
// note "project-review-flag-engine" for the canonical spec.
//
//   BLOCKING  — stops posting (some overridable by the Finance Manager)
//   REVIEW    — needs a human to acknowledge / fix; does NOT hard-block posting
//   ADVISORY  — informational; never blocks
//
// The engine is PURE: computeBillFlags(bill) reads the bill + its vendor master
// and returns a flat flag list. Resolution state (acknowledged / overridden)
// lives on the bill record (review_ack / review_overrides), applied by the
// selector helpers below so the UI can gate the Post action via canPost().
//
// Routing (Vina 2026-07-11): exceptions are primarily AP Staff's to fix — they
// own the bill data. Accounting Manager sees the same items as oversight; the
// Finance Manager approves and overrides BLOCKING flags. So every flag's
// ownerRole is "ap_staff" except the structural Period-Locked block (FM).

import { daysSince } from "./clock";
import { workflowStatus, isApPeriodLocked, billPeriod, DEMO_OVERRIDES } from "./billStatus";
import { VENDORS } from "../data/seed/vendors";

export const SEVERITY = { BLOCKING: "BLOCKING", REVIEW: "REVIEW", ADVISORY: "ADVISORY" };

// Severity rank for sorting (most urgent first).
export const SEVERITY_RANK = { BLOCKING: 0, REVIEW: 1, ADVISORY: 2 };

// Tunables — in production these come from system_config (IA-tunable).
const BIG_TXN_THRESHOLD = 500_000_000; // Rp — "Big Transaction" advisory
const APPROVAL_STALLED_DAYS = 3; // days in PENDING_REVIEW before "Approval Stalled"
const PPN_RATE_DEFAULT = 0.11;
const FAKTUR_WINDOW_DAYS = 90; // ~3-month VAT input-credit window

// Demo-only signals for checks the seed has no field for yet. Kept small and
// explicit so the inbox shows a realistic spread without inventing data.
const BANK_CHANGE_BILLS = new Set(["BILL021", "BILL032"]); // vendor bank changed
const SKB_ON_FILE = new Set(["BILL033"]); // has a tax-exemption cert (SKB) → Tax Omitted overridable-clear

// Item-category → expected PPh. Tax is driven by the transaction *object* (the
// expense category), NOT the vendor — a service line attracts PPh, a goods line
// doesn't, regardless of vendor default. RATES/ARTICLES ARE PLACEHOLDER — to be
// validated with the tax advisor (see the "Tax category → account → treatment"
// table in the PRD). Keyed by GL account code.
const CATEGORY_TAX = {
  "6-2700": { pphExpected: true, article: "PPh 23",   rate: 0.02 }, // professional services
  "6-1200": { pphExpected: true, article: "PPh 23",   rate: 0.02 }, // marketing / advertising
  "6-3100": { pphExpected: true, article: "PPh 23",   rate: 0.02 }, // courier / logistics
  "6-3200": { pphExpected: true, article: "PPh 23",   rate: 0.02 }, // repairs & maintenance
  "6-2300": { pphExpected: true, article: "PPh 4(2)", rate: 0.10 }, // rent of building
};
const catTax = (acct) => CATEGORY_TAX[acct] || { pphExpected: false };

export function getVendor(vendorId) {
  return VENDORS.find((v) => v.id === vendorId) || null;
}

// Does this vendor's profile create a tax obligation (PPN and/or withholding)?
function taxRequired(vendor) {
  if (!vendor) return false;
  return vendor.pkp === "PKP" || (vendor.pph && vendor.pph !== "none");
}

function anyTaxOnInvoice(bill) {
  return (bill.ppn || 0) > 0 || (bill.pph23 || 0) > 0;
}

function isNonPosted(bill) {
  if (bill.je_number) return false;
  const ws = workflowStatus(bill);
  return ws !== "POSTED" && ws !== "PAID";
}

// Build one flag object. `key` is stable per check so its id is stable per bill.
function flag(bill, key, { label, severity, category, message, ownerRole = "ap_staff", overridable = false, side = false }) {
  return {
    id: `${bill.id}:${key}`,
    key,
    billId: bill.id,
    label,
    severity,
    category,
    message,
    ownerRole,
    blocking: severity === SEVERITY.BLOCKING,
    overridable,
    side, // a "separate from the sequence" branch (withholding/faktur windows) — never blocks
  };
}

const has = (t, ...subs) => subs.some((s) => (t || "").toLowerCase().includes(s));

// ── The engine ──────────────────────────────────────────────────────────────
// Returns every flag the bill trips, in evaluation order. opts.autoAssignLateBills
// (default true) reflects the Settings → Accounting toggle: when ON, a bill in a
// closed period is auto-posted to the open period, so "Period Locked" never fires.
export function computeBillFlags(bill, vendorArg, opts = {}) {
  if (!bill || !isNonPosted(bill)) return [];
  const { autoAssignLateBills = true } = opts;
  const vendor = vendorArg || getVendor(bill.vendor);
  const out = [];
  const push = (...args) => out.push(flag(bill, ...args));

  // 1) Vendor Checks ----------------------------------------------------------
  // Required vendor-master field missing (a PKP vendor with no NPWP can't post).
  if (vendor && vendor.pkp === "PKP" && !vendor.tax_id) {
    push("vendor_data", {
      label: "Complete Vendor Data", severity: SEVERITY.BLOCKING, category: "Vendor",
      message: `${vendor.name} is PKP but has no NPWP on file — complete the vendor master before posting.`,
    });
  }
  // New vendor — first invoice from this vendor.
  if ((bill.anomalies || []).some((a) => has(a.description, "first invoice"))) {
    push("vendor_new", {
      label: "New Vendor", severity: SEVERITY.REVIEW, category: "Vendor",
      message: "First invoice from this vendor — confirm the vendor is legitimate before it posts.",
    });
  }

  // Vendor is awaiting approval — a new vendor, or one with a pending bank/payee
  // change. Vendor Master SoD: a manager signs it off before the bill can
  // post/pay. The bill can still be created & submitted; this only blocks at
  // posting & payment. Clears when the vendor's approval → Approved.
  if (vendor && vendor.approval === "pending_approval") {
    push("vendor_pending", {
      label: "Vendor pending approval", severity: SEVERITY.REVIEW, category: "Vendor",
      ownerRole: "finance_manager",
      message: `${vendor.name} is pending approval — a manager must sign off the vendor (in Vendor Master) before this bill can be posted or paid.`,
    });
  }

  // 2) Transaction Risk Checks ------------------------------------------------
  if ((bill.total || 0) > BIG_TXN_THRESHOLD) {
    push("big_txn", {
      label: "Big Transaction", severity: SEVERITY.ADVISORY, category: "Transaction risk",
      message: `Total Rp ${(bill.total).toLocaleString("id-ID")} exceeds the Rp ${BIG_TXN_THRESHOLD.toLocaleString("id-ID")} review threshold.`,
    });
  }
  if ((bill.anomalies || []).some((a) => has(a.description, "higher than", "× higher", "x higher"))) {
    push("price_anomaly", {
      label: "Pricing Anomaly", severity: SEVERITY.REVIEW, category: "Transaction risk",
      message: (bill.anomalies.find((a) => has(a.description, "higher")) || {}).description || "Price is out of line with this vendor's history.",
    });
  }
  if ((bill.anomalies || []).some((a) => has(a.description, "duplicate"))) {
    push("duplicate", {
      label: "Transaction Duplicate", severity: SEVERITY.REVIEW, category: "Transaction risk",
      message: (bill.anomalies.find((a) => has(a.description, "duplicate")) || {}).description || "Possible duplicate of another bill.",
    });
  }

  // 3) Tax Obligation Checks --------------------------------------------------
  const required = taxRequired(vendor);
  const taxPresent = anyTaxOnInvoice(bill);
  if (required && !taxPresent) {
    // Tax expected but none on the invoice — blocking, but an SKB can override.
    push("tax_omitted", {
      label: "Tax Omitted", severity: SEVERITY.BLOCKING, category: "Tax",
      overridable: true,
      message: SKB_ON_FILE.has(bill.id)
        ? "Tax expected but none on the invoice — an SKB (exemption cert) is on file; the FM can override to post."
        : "Tax expected for this vendor but none is on the invoice. Fix the tax, or the FM overrides with an SKB.",
    });
  } else if (!required && taxPresent) {
    // Vendor carries no tax obligation yet the invoice charges tax.
    push("tax_mismatch_obligation", {
      label: "Tax Mismatch", severity: SEVERITY.BLOCKING, category: "Tax",
      message: `${vendor ? vendor.name : "This vendor"} has no tax obligation, but the invoice charges tax — verify before posting.`,
    });
  }

  // 4) Tax Category / withholding-type check ----------------------------------
  // Vendor expects withholding (PPh) but none was applied → soft review.
  if (vendor && vendor.pph && vendor.pph !== "none" && (bill.pph23 || 0) === 0 && required) {
    push("review_tax_type", {
      label: "Review Tax", severity: SEVERITY.REVIEW, category: "Tax",
      message: `${vendor.name} usually has PPh withholding, but none was applied — confirm the tax category.`,
    });
  }

  // 4b) Tax Category check — does the applied tax match the item categories?
  // Category-driven (the vendor's PPh default can differ from what the line
  // categories actually attract). PLACEHOLDER category map — see the PRD tax
  // table; treated as REVIEW because the object isn't certain.
  {
    const lines = bill.items || [];
    const svc = lines.find((it) => catTax(it.acct).pphExpected);
    const pphApplied = (bill.pph23 || 0) > 0;
    if (svc && !pphApplied) {
      push("tax_category", {
        label: "Review Tax", severity: SEVERITY.REVIEW, category: "Tax",
        message: `A line ("${svc.desc || svc.acctName || svc.acct}") is a ${catTax(svc.acct).article}-type expense, but no withholding is applied — confirm the tax category.`,
      });
    } else if (!svc && pphApplied && lines.length) {
      push("tax_category", {
        label: "Review Tax", severity: SEVERITY.REVIEW, category: "Tax",
        message: "PPh is withheld but the invoice looks goods-only — confirm the tax category.",
      });
    }
  }

  // 5) Withholding deadline (separate branch — never blocks) -------------------
  if (vendor && vendor.pph && vendor.pph !== "none" && (bill.pph23 || 0) > 0) {
    const period = billPeriod(bill); // YYYY-MM
    // PPh deposit deadline ≈ the 10th of the month after the bill period.
    const [y, m] = period.split("-").map(Number);
    if (y && m) {
      const deadline = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-10`;
      const dToDeadline = -daysSince(deadline); // positive = days remaining
      if (dToDeadline < 0) {
        push("wh_overdue", {
          label: "Withholding overdue", severity: SEVERITY.ADVISORY, category: "Tax", side: true,
          message: `PPh deposit deadline (${deadline}) has passed by ${Math.abs(dToDeadline)}d.`,
        });
      } else if (dToDeadline <= 30) {
        push("wh_deadline", {
          label: "Withholding deadline", severity: SEVERITY.ADVISORY, category: "Tax", side: true,
          message: `PPh deposit due ${deadline} — ${dToDeadline}d left.`,
        });
      }
    }
  }

  // 6) PPN faktur -------------------------------------------------------------
  const fakturVal = bill.faktur_pajak || bill.fakturNo;
  const fakturMissing = !fakturVal || fakturVal === "—";
  if (vendor && vendor.pkp === "PKP" && (bill.ppn || 0) > 0 && fakturMissing) {
    push("faktur_missing", {
      label: "faktur missing", severity: SEVERITY.REVIEW, category: "Tax",
      message: `${vendor.name} is PKP and the invoice has PPN, but no faktur pajak number is on the bill.`,
    });
    // faktur window (separate branch — never blocks)
    const age = daysSince(bill.date);
    if (age > FAKTUR_WINDOW_DAYS) {
      push("faktur_forfeit", {
        label: "VAT credit forfeited", severity: SEVERITY.ADVISORY, category: "Tax", side: true,
        message: `Invoice is ${age}d old — past the ${FAKTUR_WINDOW_DAYS}d input-VAT credit window.`,
      });
    } else if (age > FAKTUR_WINDOW_DAYS - 30) {
      push("faktur_critical", {
        label: "faktur window critical", severity: SEVERITY.ADVISORY, category: "Tax", side: true,
        message: `${FAKTUR_WINDOW_DAYS - age}d left to claim the input-VAT credit — enter the faktur soon.`,
      });
    }
  }

  // 7) Tax Amount Check -------------------------------------------------------
  if ((bill.ppn || 0) > 0 && (bill.dpp || 0) > 0) {
    const rate = bill.ppnRate || PPN_RATE_DEFAULT;
    const expected = Math.round(bill.dpp * rate);
    const drift = Math.abs((bill.ppn || 0) - expected);
    if (drift > Math.max(1000, expected * 0.02)) {
      push("tax_amount_mismatch", {
        label: "Tax Amount Mismatch", severity: SEVERITY.BLOCKING, category: "Tax",
        message: `PPN Rp ${(bill.ppn).toLocaleString("id-ID")} ≠ expected Rp ${expected.toLocaleString("id-ID")} (DPP × ${(rate * 100).toFixed(0)}%).`,
      });
    }
  }

  // 8) Additional flags (parallel) --------------------------------------------
  // Returned — the approver (FM) sent the bill back to AP to fix and resubmit.
  // It's an EXCEPTION at the REVIEW tier, not a lifecycle status: the bill sits
  // at Draft (back with AP) and this flag carries the return reason, floats it
  // up the queue, and is cleared by acknowledging it. In production this reads
  // `returned_reason` / `returned_by` columns on ap_invoices.
  const returned = DEMO_OVERRIDES[bill.id]?.returned;
  if (returned) {
    push("returned", {
      label: "Returned", severity: SEVERITY.REVIEW, category: "Workflow",
      message: `Returned by ${returned.by === "FM" ? "the Finance Manager" : returned.by}: ${returned.reason}`,
    });
  }
  const ws = workflowStatus(bill);
  if (ws === "PENDING_REVIEW") {
    const inQueue = Math.max(0, daysSince(bill.audit?.[0]?.date || bill.date));
    if (inQueue > APPROVAL_STALLED_DAYS) {
      push("approval_stalled", {
        label: "Approval Stalled", severity: SEVERITY.ADVISORY, category: "Workflow",
        message: `In review ${inQueue}d — past the ${APPROVAL_STALLED_DAYS}d target.`,
      });
    }
  }
  if (!autoAssignLateBills && isApPeriodLocked(billPeriod(bill))) {
    push("period_locked", {
      label: "Period Locked", severity: SEVERITY.BLOCKING, category: "Workflow",
      ownerRole: "finance_manager", overridable: true,
      message: `Bill period ${billPeriod(bill)} is closed — needs a reopen (FM) or reassignment to an open period.`,
    });
  }
  if (BANK_CHANGE_BILLS.has(bill.id)) {
    push("bank_change", {
      label: "bank change", severity: SEVERITY.REVIEW, category: "Vendor",
      message: "Vendor's bank account changed since the last payment — verify before paying.",
    });
  }
  if (bill.poNo === "—" || bill.invNo === "—") {
    push("missing_document", {
      label: "missing document", severity: SEVERITY.REVIEW, category: "Documents",
      message: "A source document (PO or invoice number) is missing — attach or enter it.",
    });
  }
  // GRN (3-way match) mismatch — goods-receipt qty ≠ invoice. Treated as an
  // exception (needs verification before posting), not a quiet signal.
  if (bill.grn === "mismatch") {
    push("grn_mismatch", {
      label: "GRN Mismatch", severity: SEVERITY.REVIEW, category: "Transaction risk",
      message: "Goods-receipt quantity doesn't match the invoice — verify the 3-way match before posting.",
    });
  }

  // 9) Residual anomalies → ADVISORY -----------------------------------------
  // The notable anomalies above are promoted to Review/Blocking (Pricing
  // Anomaly, Transaction Duplicate, New Vendor). Anything left folds into the
  // one exception model at the ADVISORY tier — never gates, not counted in the
  // Exception tab/chip — so urgency and the row dot read a single source
  // instead of a parallel `anomalies` array.
  (bill.anomalies || []).forEach((a, i) => {
    const d = a.description || "";
    if (has(d, "first invoice") || has(d, "higher than", "× higher", "x higher") || has(d, "duplicate")) return;
    push(`anomaly_${i}`, {
      label: "Anomaly", severity: SEVERITY.ADVISORY, category: "Transaction risk",
      message: d || "Unusual signal on this bill.",
    });
  });

  return out;
}

// ── Resolution state + selectors ─────────────────────────────────────────────
// review_ack: array of flag ids the owner acknowledged ("Yes, I have reviewed").
// review_overrides: array of { id, reason, by, at } for FM-overridden BLOCKING flags.

export function flagStatus(bill, f) {
  if ((bill.review_overrides || []).some((o) => o.id === f.id)) return "overridden";
  if ((bill.review_ack || []).includes(f.id)) return "reviewed";
  return "open";
}

// Flags decorated with their current resolution status.
export function billFlags(bill, vendorArg, opts) {
  return computeBillFlags(bill, vendorArg, opts).map((f) => ({ ...f, status: flagStatus(bill, f) }));
}

// A bill can post when every BLOCKING flag is overridden. REVIEW/ADVISORY never
// block (per the flowchart) — REVIEW is tracked for the queue, not gated.
export function canPost(bill, vendorArg, opts) {
  return computeBillFlags(bill, vendorArg, opts).every(
    (f) => !f.blocking || flagStatus(bill, f) === "overridden",
  );
}

// Counts by severity, honouring resolution (reviewed/overridden drop out of the
// "open" tallies). Used by the Bills KPI strip + row chips.
export function flagSummary(bill, vendorArg, opts) {
  const flags = billFlags(bill, vendorArg, opts);
  const open = flags.filter((f) => f.status === "open");
  return {
    total: flags.length,
    openBlocking: open.filter((f) => f.severity === SEVERITY.BLOCKING).length,
    openReview: open.filter((f) => f.severity === SEVERITY.REVIEW).length,
    openAdvisory: open.filter((f) => f.severity === SEVERITY.ADVISORY).length,
    open: open.length,
    flags,
    canPost: canPost(bill, vendorArg, opts),
  };
}

// Does this bill belong in a given persona's review queue? AP Staff owns the
// fixes; Accounting Manager sees the same items as oversight; FM sees the ones
// needing approval/override. Used to scope the "My queue" filter.
export function inQueueFor(roleKey, summary) {
  if (summary.open === 0) return false;
  if (roleKey === "finance_manager") return summary.openBlocking > 0 || summary.openReview > 0;
  if (roleKey === "accounting_manager") return summary.open > 0;
  // ap_staff (and everyone operational) — the primary fix queue
  return summary.openBlocking > 0 || summary.openReview > 0;
}
