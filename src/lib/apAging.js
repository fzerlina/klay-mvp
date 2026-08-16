// AP Aging derivation layer.
//
// AP Aging reads from ap_invoices + vendors but needs fields the existing
// (auto-generated) seed doesn't carry: discount terms with confidence, vendor
// relationship_tier, on_hold, aging buckets, recon-badge state, and a set of
// synthesized ACCRUAL_POSTED records (the prototype's bill seed doesn't yet
// carry accruals — they're owned by AP Close Command Center in production).
// In production all of this would live on `ap_invoices`, `vendors`, and the
// pre-computed `ap_aging_snapshots` table. For the prototype we derive it on
// the client from existing seed plus deterministic per-id hashes so the demo
// is stable across reloads.

import { BILLS } from "../data/seed/bills";
import { VENDORS } from "../data/seed/vendors";
import { seedTierFor } from "../data/seed/vendorTiers";
import { TODAY, daysSince } from "./clock";
import { workflowStatus } from "./billStatus";

// ── Constants from PRD ─────────────────────────────────────────────────────
// Age buckets — Current / 1–30 / 31–60 / 61–90 / 91–120 / >120
export const AGE_BUCKETS = [
  { key: "current",   lbl: "Current",    min: -Infinity, max: 0,        tone: "neutral" },
  { key: "b1_30",     lbl: "1–30",       min: 1,         max: 30,       tone: "warn"    },
  { key: "b31_60",    lbl: "31–60",      min: 31,        max: 60,       tone: "warn"    },
  { key: "b61_90",    lbl: "61–90",      min: 61,        max: 90,       tone: "warn"    },
  { key: "b91_120",   lbl: "91–120",     min: 91,        max: 120,      tone: "danger"  },
  { key: "b_gt120",   lbl: ">120",       min: 121,       max: Infinity, tone: "danger"  },
];

export function ageBucketOf(daysOverdue) {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "b1_30";
  if (daysOverdue <= 60) return "b31_60";
  if (daysOverdue <= 90) return "b61_90";
  if (daysOverdue <= 120) return "b91_120";
  return "b_gt120";
}

// ── Relationship tier — Strategic / Standard / In Dispute ──────────────────
// The tier is a VENDOR-MASTER attribute (PRD TP-02), not an AP-Aging concept.
// This returns the seeded base value; live edits (from Vendor master or the
// aging table) live on the vendor record in VendorsContext, which the page
// overlays via tierOf(). Default: standard.
export function relationshipTier(vendorId) {
  return seedTierFor(vendorId);
}

// Parse "NET 30" / "NET 7" / "NET 60" → integer net days. Falls back to 30.
function parseNetDays(s) {
  if (!s) return 30;
  const m = /NET\s+(\d+)/i.exec(s);
  return m ? parseInt(m[1], 10) : 30;
}

// ── On-hold — small deterministic subset, FM-set ───────────────────────────
const ON_HOLD_OVERRIDES = {
  BILL048: { reason: "Awaiting credit note — qty short-delivered", since: "2025-04-12", by: "Budi Santoso" },
  BILL019: { reason: "Vendor dispute on rate card",                since: "2025-04-08", by: "Sarah Wijaya"  },
  BILL040: { reason: "Pending bank account verification",          since: "2025-04-15", by: "Budi Santoso" },
};
export function onHoldFor(billId) {
  return ON_HOLD_OVERRIDES[billId] || null;
}

// ── Synthetic accruals (ACCRUAL_POSTED) ────────────────────────────────────
// The prototype seed doesn't carry accrual records yet — those are owned by
// the AP Close Command Center. We synthesize a handful so the Aging Table can
// render the [ACCRUAL] tag in the Current bucket and the KPI bar's "Accrued
// Liabilities" tile reflects something real.
const ACCRUAL_SEED = [
  { vendor: "V003", amount: 13800000, expense: "6-3100", desc: "Jasa pengiriman April 2025 — bulanan" },
  { vendor: "V008", amount: 18500000, expense: "6-2700", desc: "IT support maintenance April 2025" },
  { vendor: "V010", amount: 46200000, expense: "6-2300", desc: "Asuransi aset operasional April 2025" },
  { vendor: "V004", amount: 22000000, expense: "6-2700", desc: "Audit internal — fase 2" },
];

function buildAccrualRecords() {
  return ACCRUAL_SEED.map((a, i) => {
    const v = VENDORS.find((x) => x.id === a.vendor);
    const idNum = String(i + 1).padStart(3, "0");
    return {
      id: "ACR" + idNum,
      vendor: a.vendor,
      vendorName: v?.name || a.vendor,
      initials: v?.initials || "?",
      poNo: "—",
      invNo: "—",
      date: "2025-04-30",         // posted at period-end
      due: "2025-04-30",          // accruals have no real due date
      grn: "—",
      dpp: a.amount,
      pph23: v?.pph === "pph23_2" ? Math.round(a.amount * 0.02) : 0,
      total: a.amount,
      sisa: a.amount,
      approval: "approved",
      pay: "unpaid",
      isAI: true,
      keterangan: a.desc,
      source: "ACCRUAL",          // PRD source enum value
      workflow_status: "ACCRUAL_POSTED",
      accrual_reversal_date: "2025-05-01",
      items: [{ desc: a.desc, qty: 1, price: a.amount, subtotal: a.amount, acct: a.expense, acctName: "Accrued — " + a.desc.slice(0, 30) }],
      audit: [{ type: "created", action: "Accrual posted by Klay AI", by: "Klay AI", date: "2025-04-30", time: "23:05" }],
    };
  });
}

// ── Aging line — one row per outstanding bill ─────────────────────────────
// Joins bill + vendor + derived fields. The Decision Queue and Aging Table
// both consume this. Filter at the view layer.
export function buildAgingLines(asOfDate, bills = BILLS) {
  const accruals = buildAccrualRecords();
  const allBills = [...bills, ...accruals];

  return allBills.map((b) => {
    const v = VENDORS.find((x) => x.id === b.vendor) || null;
    const tier = relationshipTier(b.vendor);
    const ws = b.workflow_status || workflowStatus(b);  // accruals carry it explicitly
    const isAccrual = ws === "ACCRUAL_POSTED" || b.source === "ACCRUAL" || b.source === "MIGRATION_ACCRUAL";

    // Aging
    const daysOverdue = isAccrual ? 0 : daysSince(b.due);  // accruals never age
    const ageBucket  = isAccrual ? "current" : ageBucketOf(daysOverdue);
    const ageDays    = isAccrual ? 0 : Math.max(0, daysSince(b.date));

    // Hold state — set by FM via Bill Detail Hold action in production
    const hold = onHoldFor(b.id);

    // Net days — from vendor's payment_terms string (fallback 30)
    const netDays = parseNetDays(v?.payment_terms);

    return {
      // identity
      id: b.id,
      vendorId: b.vendor,
      vendorName: b.vendorName,
      vendorInitials: b.initials,
      vendorCode: v?.code || "",
      relationship_tier: tier,
      invNo: b.invNo === "—" || !b.invNo ? b.id : b.invNo,
      invoiceDate: b.date,
      dueDate: b.due,

      // state
      workflow_status: ws,
      payment_status: b.pay,
      is_accrual: isAccrual,
      on_hold: !!hold,
      hold_reason: hold?.reason || null,
      hold_since: hold?.since || null,
      hold_by: hold?.by || null,

      // money (IDR)
      total: b.total,
      remaining: b.sisa,
      pph23: b.pph23 || 0,

      // aging
      daysOverdue,
      ageBucket,
      ageDays,

      // payment terms
      net_days: netDays,

      // raw fallback
      raw: b,
      vendorRaw: v,
    };
  });
}

// ── Decision Queue filter ─────────────────────────────────────────────────
// AP Aging is the PAYMENT workspace: it shows only POSTED bills that are ready
// to be paid (a posted, unpaid liability = a live payment decision — discount
// window / overdue). Pre-posting bills (Draft / Pending Review / Returned /
// Approved) live on the Bills page, not here; accruals are managed in AP Close.
export function isDecisionQueueRow(line) {
  if (line.is_accrual) return false;
  if (line.on_hold) return false;
  if (line.remaining <= 0) return false;
  return line.workflow_status === "POSTED";
}

// ── Aging Table filter ────────────────────────────────────────────────────
// POSTED liabilities only (+ posted accruals, tagged separately). The aging
// table is the financial report that reconciles to the GL AP Control account
// (Gate 3a), so its grand total must equal the posted-only "AP Outstanding"
// KPI — pre-posting bills (PENDING_REVIEW / RETURNED / APPROVED) are NOT
// liabilities yet and are excluded here. They still surface for chasing in the
// Decision Queue (isDecisionQueueRow), which is a work-list, not a GL total.
export function isAgingTableRow(line) {
  if (line.remaining <= 0) return false;
  return line.workflow_status === "POSTED" || line.is_accrual;
}

// ── Urgency for Decision Queue — role-aware ───────────────────────────────
// "Urgency" is not one global ranking: each persona works a different payment
// stage, so the risk they are uniquely positioned to prevent differs. The
// comparator is therefore parameterised by payMode (the capability-scoped stage
// the queue is showing). All modes fall back to overdue-depth, so a row without
// stage timestamps still sorts sensibly.
//
//   request (AP Staff)     — a posted bill drifting overdue with no request
//                            raised → OVERDUE DEPTH first, then balance.
//   approve (Finance Mgr)  — being the bottleneck / rubber-stamping big
//                            payments → OLDEST REQUEST first (time waiting on
//                            me), then overdue depth, then balance.
//   execute (Finance Staff)— an approved payment slipping past due → DUE/
//                            OVERDUE first, then time-since-approved.
//   view (read-only)       — analytical → overdue depth, then balance.

// Age of a payment at its current stage, in days (higher = waited longer).
// detailOf() carries requestedAt / approvedAt; missing → 0 (sorts last).
function stageWaitDays(line, stampKey, detailOf) {
  const d = detailOf?.(line.id);
  const stamp = d?.[stampKey];
  return stamp ? Math.max(0, daysSince(stamp)) : 0;
}

// Overdue-depth tier: >90 → 61–90 → 31–60 → 1–30 → current (lower = worse).
function overdueTier(line) {
  const d = line.daysOverdue;
  if (d > 90) return 1;
  if (d > 60) return 2;
  if (d > 30) return 3;
  if (d > 0)  return 4;
  return 5;
}

// Returns a comparator for the given payMode. detailOf (from PaymentsContext)
// is optional — passed for the stages whose urgency depends on stage-wait time.
export function decisionQueueSort(payMode = "view", detailOf) {
  const byOverdueThenAmount = (a, b) => {
    const ta = overdueTier(a), tb = overdueTier(b);
    if (ta !== tb) return ta - tb;
    if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
    return b.remaining - a.remaining;
  };

  let roleCmp;
  if (payMode === "approve") {
    // Oldest waiting request first, then overdue depth, then balance.
    roleCmp = (a, b) => {
      const wa = stageWaitDays(a, "requestedAt", detailOf);
      const wb = stageWaitDays(b, "requestedAt", detailOf);
      if (wa !== wb) return wb - wa;
      return byOverdueThenAmount(a, b);
    };
  } else if (payMode === "execute") {
    // Due/overdue first, then longest-approved first (don't sit on approvals).
    roleCmp = (a, b) => {
      if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
      const wa = stageWaitDays(a, "approvedAt", detailOf);
      const wb = stageWaitDays(b, "approvedAt", detailOf);
      if (wa !== wb) return wb - wa;
      return b.remaining - a.remaining;
    };
  } else {
    // request + view — overdue depth, then balance.
    roleCmp = byOverdueThenAmount;
  }

  return roleCmp;
}

// ── KPI snapshot — feeds the 5-tile command bar + recon badge ─────────────
// In production this comes from `ap_aging_snapshots` (per the PRD's pre-
// computed snapshot architecture). Here it's computed live since the dataset
// is small.
export function buildSnapshot(lines, asOfDate = TODAY) {
  let apOutstanding = 0;
  let accruedLiabilities = 0;
  let dueIn7Days = 0;
  let totalSinceJan = 0;
  let paidSinceJan = 0;

  const bucketTotals = {
    current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b_gt120: 0,
  };

  for (const l of lines) {
    if (l.is_accrual) {
      accruedLiabilities += l.remaining;
      bucketTotals.current += 0;  // accruals do NOT contribute to per-bucket total per PRD
      continue;
    }
    // KPI / reconciliation scope = POSTED liabilities only (Gate 3a). Pre-
    // posting bills (PENDING_REVIEW / RETURNED / APPROVED) are subledger-only
    // and excluded from the GL-reconciled total by design — they still SHOW in
    // the Decision Queue / Aging Table, they just don't count toward this number.
    if (l.workflow_status !== "POSTED") continue;
    if (l.remaining <= 0) continue;

    apOutstanding += l.remaining;
    bucketTotals[l.ageBucket] += l.remaining;

    // Due in next 7 days — based on due date, regardless of overdue state
    const dueDays = -daysSince(l.dueDate);  // positive = future
    if (dueDays >= 0 && dueDays <= 7) dueIn7Days += l.remaining;
  }

  // DPO — simple approximation: avg age across open invoices weighted by
  // remaining. Real formula needs purchases base; this is a reasonable proxy.
  let weightedAge = 0;
  let weightTotal = 0;
  for (const l of lines) {
    if (l.is_accrual || l.workflow_status !== "POSTED" || l.remaining <= 0) continue;
    weightedAge += l.ageDays * l.remaining;
    weightTotal += l.remaining;
  }
  const dpoDays = weightTotal > 0 ? Math.round(weightedAge / weightTotal) : 0;

  return {
    asOfDate,
    apOutstanding,
    accruedLiabilities,
    dpoDays,
    dueIn7Days,
    bucketTotals,
    reconciliation: {
      // Gate 3a / 3b per PRD — both deltas Rp 0 = green. In production this
      // comes from the latest reconciliation_log entry.
      gate_3a_delta: 0,
      gate_3b_delta: 0,
      verified_hours_ago: 2,
      status: "ok",   // ok | mismatch | unavailable
    },
  };
}

// ── Vendor-pivot — for the Aging Table view ────────────────────────────────
// Groups lines by vendor. Each vendor row carries bucket totals and an
// expandable list of underlying invoices.
export function buildVendorPivot(lines) {
  const byVendor = new Map();
  for (const l of lines) {
    if (l.workflow_status === "DRAFT") continue;
    if (l.remaining <= 0) continue;
    if (!byVendor.has(l.vendorId)) {
      byVendor.set(l.vendorId, {
        vendorId: l.vendorId,
        vendorName: l.vendorName,
        vendorCode: l.vendorCode,
        initials: l.vendorInitials,
        relationship_tier: l.relationship_tier,
        buckets: { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b_gt120: 0 },
        accrual: 0,
        total: 0,                // sum across non-accrual buckets
        invoices: [],
      });
    }
    const row = byVendor.get(l.vendorId);
    if (l.is_accrual) {
      row.accrual += l.remaining;
    } else {
      row.buckets[l.ageBucket] += l.remaining;
      row.total += l.remaining;
    }
    row.invoices.push(l);
  }
  // Sort vendors by total outstanding desc (largest exposure first)
  return Array.from(byVendor.values()).sort((a, b) => b.total - a.total);
}

// ── Display helpers ────────────────────────────────────────────────────────
export const RELATIONSHIP_LABEL = {
  strategic: "Strategic",
  standard:  "Standard",
  at_risk:   "In Dispute",
};
