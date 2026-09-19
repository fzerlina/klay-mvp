// ─── AP Close Command Center — data + derivations ────────────────────────────
//
// The close board reads the SAME records as the rest of AP: every task row is a
// real bill from the bills seed (or a real accrual candidate), so clicking a row
// opens the actual Bill Detail / Journal page and the vendor, amount, invoice no.
// and status all match. Nothing here is invented — gate membership is a curated
// selection of real records that genuinely meet each gate's condition, and every
// displayed value is read from the source record.
//
// Period is April 2025 — the app's demo close period (lib/clock TODAY 2025-04-23,
// universal Close page CLOSE_PERIOD "2025-04"). No working-day math.

import { allReconciliations } from "../../lib/bankRecon";
import { maskOf } from "./bankAccounts";
import { BILLS } from "./bills";
import { ACCRUAL_CANDIDATES } from "./accrualCandidates";
import { USERS } from "./roles";
import { workflowStatus, statusCause } from "../../lib/billStatus";
import { daysSince } from "../../lib/clock";

// ─── Per-task assignment ─────────────────────────────────────────────────────
// Ownership is per task (not per gate) so a gate's work can be split across
// several people and scale with the team. Each task is assigned to a real app
// persona (roles.js USERS); "My tasks" filters by the logged-in persona.
// Keyed by the underlying record id (bill id, or accrual candidate id).
const ASSIGNEES = {
  // Bills to post — deliberately split across two AP people
  BILL057: "U003", // Budi Santoso — AP Staff
  BILL149: "U011", // Hana Wijoyo — Bookkeeper
  BILL188: "U003", // Budi Santoso
  // Exceptions
  BILL028: "U002", // Sari Dewanti — Finance Manager
  BILL008: "U003", // Budi Santoso
  // Locked-period
  BILL203: "U011", // Hana Wijoyo
  // Accruals — the owner/FM books them
  "AC-2025-04-001": "U001", "AC-2025-04-002": "U001", "AC-2025-04-003": "U001", "AC-2025-04-004": "U001",
};

function initialsOf(name) {
  return (name || "").trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}
function assigneeFor(key) {
  const uid = ASSIGNEES[key];
  const u = uid && USERS.find((x) => x.id === uid);
  if (!u) return { id: null, name: "Unassigned", initials: "—" };
  return { id: u.id, name: u.name, initials: initialsOf(u.name) };
}

export const AP_CLOSE_PERIOD = "2025-04";
export const AP_CLOSE_PERIOD_LABEL = "April 2025";
export const AP_CLOSE_NEXT_PERIOD_LABEL = "May";

// Target close date for the live period — drives the header "target close" +
// days-to-close countdown (against lib/clock TODAY = 2025-04-23 → 12 days).
export const AP_CLOSE_TARGET_DATE = "2025-05-05";
export const AP_CLOSE_TARGET_LABEL = "5 May 2025";

// PIC is per-gate default config — set once, annual rotation — not per period.
// These are the close-board team (distinct from transaction users); Hadi is the
// Finance Manager (supervisor, owns no gate). Full names shown in the table.
export const GATES_CONFIG = [
  { id: "bills", label: "Bills to post",       pic: "DN" },
  { id: "exc",   label: "Exceptions",          pic: "LK" },
  { id: "lock",  label: "Locked-period",       pic: "DN" },
  { id: "accr",  label: "Accruals",            pic: "NB" },
];

export const GATE_ORDER = GATES_CONFIG.map((g) => g.id);
export const GATE_BY_ID = Object.fromEntries(GATES_CONFIG.map((g) => [g.id, g]));

export const PIC_NAMES = {
  DN: "Deny Kurniawan",
  LK: "Lukman Hakim",
  NB: "Nabila Sari",
  HD: "Hadi Santoso",
};

// Current demo staff user for the "View as: Staff" rendering (owns gate `exc`).
export const STAFF_USER = { initials: "LK", name: "Lukman Hakim" };
export const FM_USER = { initials: "HD", name: "Hadi Santoso" };

// Row action config per gate — label + owning module the button routes to.
export const GATE_ACTION = {
  bills: { label: "Review & post", route: (r) => `/bills/${r.ref}` },
  exc:   { label: "Open exception", route: (r) => `/bills/${r.ref}` },
  lock:  { label: "Reassign", route: (r) => `/bills/${r.ref}` },
  accr:  { label: "Review draft", route: () => `/journal-entry` },
};

export const GATE_EMPTY_LINE = {
  bills: "No bills waiting to be posted",
  exc:   "No open exceptions",
  lock:  "No bills stuck in a locked period",
  accr:  "No accruals pending for this period",
};

// ─── Gate membership (real records) ──────────────────────────────────────────
// Curated real bill ids per gate. Each set is verifiable against the seed:
//  • bills  — approved, no je_number → unposted (blocks close)
//  • exc    — workflow EXCEPTION / high "duplicate" anomaly (blocks close)
//  • lock   — unposted bill dated in a locked period (≤ 2025-02) → needs reassign
const GATE_BILLS = {
  bills: ["BILL057", "BILL149", "BILL188"],
  exc:   ["BILL028", "BILL008"],
  lock:  ["BILL203"],
};

const LOCKED_PERIOD_LABEL = { BILL203: "Feb 2025" };

function billById(id) {
  return BILLS.find((b) => b.id === id);
}

function displayCode(b) {
  return b.invNo && b.invNo !== "—" ? b.invNo : b.id;
}

function highAnomaly(b) {
  return (b.anomalies || []).find((a) => a.severity === "high");
}

// Status clause per gate — the close-relevant reason, drawn from the real bill
// so it never contradicts Bill Detail.
function clauseFor(b, gate) {
  if (gate === "lock") return `Sits in a locked period (${LOCKED_PERIOD_LABEL[b.id] || "prior"}) — reassign to post`;
  if (gate === "exc") {
    const anom = highAnomaly(b);
    if (anom) return anom.description;
    return statusCause(b);
  }
  // bills → the real workflow cause; recurring monthly utilities (electricity,
  // water, internet — Utilities/Rent/SaaS accounts) are flagged so the FM can
  // tell "utility bill already received, just post it" apart from an accrual.
  const base = statusCause(b);
  return isRecurringUtility(b) ? `Recurring monthly utility · ${base}` : base;
}

// A bill posting to a Utilities / Rent / SaaS account is a recurring monthly
// vendor bill (the "arrived before close → just post it" case).
const RECURRING_UTILITY_ACCTS = new Set(["6-2400", "6-2300", "6-2600"]);
function isRecurringUtility(b) {
  return (b.items || []).some((it) => RECURRING_UTILITY_ACCTS.has(it.acct));
}

function billRecord(id, gate) {
  const b = billById(id);
  if (!b) return null;
  const isBlocker = gate === "bills" || gate === "exc";
  return {
    id: displayCode(b),
    ref: b.id,
    gate,
    vendor: b.vendorName,
    amount: b.total,
    currency: b.original_currency || "IDR",
    original: b.original_currency && b.original_currency !== "IDR" && b.original_total != null
      ? { code: b.original_currency, amount: b.original_total }
      : null,
    status_clause: clauseFor(b, gate),
    age_days: Math.max(0, daysSince(b.date)),
    is_blocker: isBlocker,
    workflow: workflowStatus(b),
    assignee: assigneeFor(b.id),
  };
}

const BASIS_SHORT = {
  LAST_INVOICE: "last invoice",
  ROLLING_AVERAGE: "3-month average",
  PRIOR_ACCRUAL: "prior accrual",
};

function accrualRecord(c) {
  return {
    id: c.id,
    ref: null,
    gate: "accr",
    vendor: `${c.vendor_name} accrual`,
    amount: c.gross_amount,
    currency: "IDR",
    original: null,
    status_clause: `Accrual pending review — Klay suggested from ${BASIS_SHORT[c.suggested_basis] || "history"}`,
    age_days: 1,
    is_blocker: false,
    workflow: "ACCRUAL",
    assignee: assigneeFor(c.id),
  };
}

// The full open-task set for the period, in gate order. Every item is an OPEN
// close task (needs action) — cleared work isn't relisted here.
export const AP_CLOSE_RECORDS = [
  ...GATE_BILLS.bills.map((id) => billRecord(id, "bills")),
  ...GATE_BILLS.exc.map((id) => billRecord(id, "exc")),
  ...GATE_BILLS.lock.map((id) => billRecord(id, "lock")),
  ...ACCRUAL_CANDIDATES.map(accrualRecord),
].filter(Boolean);

// ─── Periods (month switcher) ────────────────────────────────────────────────
// April 2025 is the live/open close; earlier months are closed and carry a
// retrospective (when it closed, days-after-period-end, blockers cleared) so the
// close page reads as a recurring cockpit, not a one-off. Newest first (dropdown).
export const AP_PERIODS = [
  { key: "2025-04", label: "April 2025", current: true },
  { key: "2025-03", label: "March 2025", closed: true, closedOn: "2 Apr 2025", daysToClose: 2, blockers: 14, offender: "UD Budi Cahyono" },
  { key: "2025-02", label: "February 2025", closed: true, closedOn: "4 Mar 2025", daysToClose: 4, blockers: 17, offender: "UD Budi Cahyono" },
  { key: "2025-01", label: "January 2025", closed: true, closedOn: "3 Feb 2025", daysToClose: 3, blockers: 22, offender: null },
];

// ─── Insight mock data ───────────────────────────────────────────────────────
export const PERIOD_HISTORY = [
  { period: "Feb 2025", blockers_total: 17 },
  { period: "Mar 2025", blockers_total: 14 },
  { period: "Apr 2025", blockers_total: 9 }, // running count, current period
];

// Last month's accrual snapshot — for the "accruals vs last month" cross-check
// (manager verifies the accrual set is complete / spots what changed).
export const LAST_MONTH_ACCRUALS = {
  label: "March 2025",
  count: 3,
  total: 80500000,
  vendors: ["PT Penyedia Layanan Konsultasi", "PT Jasa Logistik Cepat", "PT Teknologi Solusi Digital"],
};

// Recurring offender — UD Budi Cahyono repeatedly submits bills that land in
// review (real: BILL049 Feb, BILL070 Mar, BILL165 Apr).
export const VENDOR_HISTORY = [
  {
    vendor: "UD Budi Cahyono",
    exception_type: "recurring_exception",
    periods: ["Feb 2025", "Mar 2025", "Apr 2025"],
  },
];

// ─── Derivations ─────────────────────────────────────────────────────────────

// Severity for dot colour: green = done, red = blocking, amber = open.
export function recordSeverity(r) {
  if (r.done) return "green";
  return r.is_blocker ? "red" : "amber";
}

const SEV_RANK = { green: 0, amber: 1, red: 2 };

// Gate rollup — all five gates always returned, in order, including empties.
// Counts reflect OPEN items only (a `done` record — e.g. a booked/skipped
// accrual — no longer counts toward the gate).
export function computeGates(records = AP_CLOSE_RECORDS) {
  return GATES_CONFIG.map((cfg) => {
    const rows = records.filter((r) => r.gate === cfg.id);
    const openRows = rows.filter((r) => !r.done);
    const blockers = openRows.filter((r) => r.is_blocker);
    let severity = "green";
    for (const r of openRows) {
      if (SEV_RANK[recordSeverity(r)] > SEV_RANK[severity]) severity = recordSeverity(r);
    }
    return {
      ...cfg,
      rows,
      openCount: openRows.length,
      blockerCount: blockers.length,
      count: openRows.length,
      severity,
      picName: PIC_NAMES[cfg.pic] || cfg.pic,
    };
  });
}

// Page-level rollup — header pill, sticky bar, nav tile. One source of truth.
export function computeApCloseSummary(records = AP_CLOSE_RECORDS) {
  const open = records.filter((r) => !r.done).length;
  const blockerCount = records.filter((r) => r.is_blocker && !r.done).length;
  const pending = open - blockerCount;
  const ready = blockerCount === 0;
  const dot = blockerCount > 0 ? "red" : open > 0 ? "amber" : "green";
  return {
    open, blockerCount, pending, ready, dot,
    period: AP_CLOSE_PERIOD, periodLabel: AP_CLOSE_PERIOD_LABEL,
  };
}

// Period posting completion — the top progress bar. Computed from the real bills
// seed so it agrees with the Bills module: of the period's bills, how many are
// committed to the GL (posted or paid).
export function computeBillPostingProgress(bills = BILLS) {
  const inPeriod = bills.filter((b) => b.date && b.date.startsWith(AP_CLOSE_PERIOD));
  const posted = inPeriod.filter((b) => {
    const ws = workflowStatus(b);
    return ws === "POSTED" || ws === "PAID";
  });
  return { posted: posted.length, total: inPeriod.length };
}

// ─── Gate 3 — Subledger vs GL reconciliation (3a AP Control + 3b Accrued Liab) ─
// The AP module owns two subledgers, each reconciling to its own GL control
// account (PRD lines 5810–5828):
//   • 3a — normal posted, still-owed bills  ↔  GL Accounts Payable control
//   • 3b — booked accrual records            ↔  GL Accrued Liabilities control
// The subledger side is summed from REAL records (bills' remaining balance /
// booked accrual amounts) so it can never drift from the rest of AP. The GL
// control-account balances are mock figures that tie to the subledger by
// construction, so both sub-checks reconcile (delta 0 = green) — the PRD's
// healthy target state. To demo a red delta, add a non-zero offset to a GL
// balance below (see GL_OFFSET).
export const MATERIALITY_THRESHOLD = 0; // Rp — close_config.materiality_threshold (default Rp 0)

// Mock GL drift, per sub-check. Set e.g. { a: 0, b: 4500000 } to show Gate 3b
// red (an accrual that didn't reverse leaves a delta in Accrued Liabilities —
// the classic 3b failure mode the PRD calls out). Both 0 = fully reconciled.
const GL_OFFSET = { a: 0, b: 0 };

function reconLine(id, label, account, glBalance, subledgerBalance, itemCount) {
  const delta = glBalance - subledgerBalance;
  const withinThreshold = Math.abs(delta) <= MATERIALITY_THRESHOLD;
  return { id, label, account, glBalance, subledgerBalance, delta, itemCount, withinThreshold, state: withinThreshold ? "green" : "red" };
}

export function computeReconciliation(records = AP_CLOSE_RECORDS, bills = BILLS) {
  // 3a — AP Control: posted bills still owed (remaining balance `sisa`).
  const posted = bills.filter((b) => workflowStatus(b) === "POSTED");
  const apSub = posted.reduce((s, b) => s + (b.sisa || 0), 0);
  const a = reconLine("3a", "AP Control", "2-1200 Accounts Payable", apSub + GL_OFFSET.a, apSub, posted.length);

  // 3b — Accrued Liabilities: booked (done) accrual records. Booking posts to
  // the subledger and GL atomically, so the two move together (delta stays 0).
  const booked = records.filter((r) => r.gate === "accr" && r.done && r.doneLabel === "Booked");
  const accrSub = booked.reduce((s, r) => s + (r.amount || 0), 0);
  const b = reconLine("3b", "Accrued Liabilities", "2-1300 Accrued Liabilities", accrSub + GL_OFFSET.b, accrSub, booked.length);

  return { a, b, green: a.withinThreshold && b.withinThreshold, threshold: MATERIALITY_THRESHOLD };
}

// ─── Gate 4 — Bank reconciliation ─────────────────────────────────────────────
// AP close CONSUMES this from the (separate) bank-rec module — it doesn't compute
// it. Green when every account is FULLY_RECONCILED or RECONCILED_WITH_TIMING
// (a recorded payment not yet cleared at the bank is a legitimate timing
// difference, still green). Only UNRECONCILED blocks. With many accounts the
// close board shows a rollup + only the exceptions — the full list lives in the
// bank-rec module. Flip a `state` to "UNRECONCILED" to demo a red gate.
// Gate 4 — bank reconciliation.
//
// This used to be a hand-written list of eleven accounts ("BCA-OPS ••4021")
// with a `state` field somebody typed, living next to a bank-account master
// that named different accounts with different masks. The close board and the
// reconciliation page each believed their own copy, so the page could not close
// the gate it exists to close, and the board could not be wrong in a way
// anybody would notice.
//
// It now reads the real run. Same output shape — the card and the task hub are
// unchanged — but every field is derived.
export function computeBankRecon() {
  const runs = allReconciliations();

  const rows = runs.map((r) => {
    const open = r.exceptions.filter((e) => !e.resolution);
    const timingItems = open.filter((e) => e.type === "TIMING_DIFFERENCE");

    // What the two sides disagree about, in rupiah. A matched pair cancels, so
    // the gap is whatever is left on either side: bank lines nothing in the
    // ledger claims, less ledger entries the bank has never shown. This is the
    // number an accountant would put at the bottom of a reconciliation
    // statement, and it falls out of the run rather than being stored.
    const unmatchedBank = open
      .filter((e) => !e.recordId)
      .reduce((s, e) => s + e.amount, 0);
    const unseenBooks = open
      .filter((e) => e.recordId)
      .reduce((s, e) => s + e.amount, 0);
    const delta = unmatchedBank - unseenBooks;

    const gateGreen = r.state.gateClosed;
    const blocking = r.counts.blocking;
    const toDecide = open.length - timingItems.length;

    // Red is reserved for something that needs investigating. An account whose
    // only open item is a Rp 2.500 fee awaiting one tap is amber: the gate is
    // genuinely open, but calling it the same colour as an unexplained debit
    // teaches people that red on this card does not mean much.
    const sev = r.state.key === "FULLY_RECONCILED" || r.state.key === "OUT_OF_SCOPE"
      ? "green"
      : blocking > 0 || r.state.key === "UNRECONCILED" ? "red"
      : "amber";

    const stateLabel =
      r.state.key === "FULLY_RECONCILED" ? "Reconciled"
      : r.state.key === "OUT_OF_SCOPE" ? "Not reconciled here"
      : r.state.key === "UNRECONCILED" ? "No statement loaded"
      : blocking > 0 ? `${blocking} to resolve`
      // Timing never appears alone in the label while something else is open —
      // "1 in transit" on an account that also has an unwritten-off fee reads
      // as nothing to do.
      : toDecide > 0 ? `${toDecide} to decide`
      : `${timingItems.length} in transit`;

    return {
      id: r.accountId,
      name: r.account.name,
      mask: maskOf(r.account),
      state: r.state.key,
      outstanding: timingItems.length,
      delta,
      sev,
      gateGreen,
      stateLabel,
      hasActivity: r.counts.total > 0 || open.length > 0,
    };
  });

  // Accounts with nothing to reconcile are not evidence of a clean close, so
  // they are excluded from the ratio rather than padding it green.
  const inScope = rows.filter((r) => r.state !== "OUT_OF_SCOPE");
  const total = inScope.length;
  const timing = inScope.filter((r) => r.outstanding > 0).length;
  const unrec = inScope.filter((r) => !r.gateGreen).length;

  // Only accounts needing a glance surface on the close board; anything fully
  // reconciled or out of scope stays invisible. Open gates first.
  const exceptions = rows
    .filter((r) => r.state !== "FULLY_RECONCILED" && r.state !== "OUT_OF_SCOPE" && r.hasActivity)
    .sort((a, b) => Number(a.gateGreen) - Number(b.gateGreen) || Math.abs(b.delta) - Math.abs(a.delta));

  return { rows, exceptions, total, reconciled: total - unrec, timing, unrec, green: unrec === 0 };
}

// Per-PIC open-task counts, for the staff team-progress strip.
export function computePicLoad(records = AP_CLOSE_RECORDS) {
  const load = {};
  for (const cfg of GATES_CONFIG) load[cfg.pic] = load[cfg.pic] || 0;
  for (const r of records) {
    const pic = GATE_BY_ID[r.gate]?.pic;
    if (pic) load[pic] = (load[pic] || 0) + 1;
  }
  return load;
}

// The insight cards — every card frames THIS month against LAST month so the
// manager can cross-check what's different before closing. Ranked, capped at 3.
export function computeInsights(records = AP_CLOSE_RECORDS) {
  const out = [];

  // 1) Accruals vs last month — the manager's accrual-review cross-check: is the
  //    accrual set complete, and what changed since last close?
  const thisTotal = ACCRUAL_CANDIDATES.reduce((s, c) => s + c.gross_amount, 0);
  const thisCount = ACCRUAL_CANDIDATES.length;
  const last = LAST_MONTH_ACCRUALS;
  const delta = thisTotal - last.total;
  const lastVendors = new Set(last.vendors);
  const newVendors = ACCRUAL_CANDIDATES.filter((c) => !lastVendors.has(c.vendor_name)).map((c) => c.vendor_name);
  out.push({
    id: "accrualMoM",
    rank: 5,
    label: "Accruals vs last month",
    stat: formatRp(thisTotal),
    compare: `${delta >= 0 ? "+" : "−"}${formatRp(Math.abs(delta))} vs ${monthOnly(last.label)}`,
    explanation: `${thisCount} vendors to accrue this month (was ${last.count} in ${monthOnly(last.label)})${newVendors.length ? `. New: ${newVendors.join(", ")} — confirm before booking.` : "."}`,
    action: { kind: "filterRecords", label: "Review accruals", recordIds: ACCRUAL_CANDIDATES.map((c) => c.id), toast: "Showing this month's accruals" },
  });

  // 2) Recurring offender — a vendor slipping the same way month after month.
  const offender = VENDOR_HISTORY.find(
    (v) => v.exception_type === "recurring_exception" && v.periods.length >= 2,
  );
  if (offender) {
    out.push({
      id: "offender",
      rank: 3,
      label: "Recurring offender",
      stat: offender.vendor,
      explanation: `Bills held in review ${offender.periods.length} months running — same as last month. Worth a vendor follow-up.`,
      action: { kind: "route", label: "View vendor", to: "/vendors" },
    });
  }

  // Two insight cards sit beside the Balance overview box in the top row.
  return out.sort((a, b) => b.rank - a.rank).slice(0, 2);
}

function monthOnly(period) {
  return (period || "").split(" ")[0];
}

// Retrospective insight cards for a CLOSED month — velocity (days-to-close),
// blockers cleared, and any recurring offender — each compared to the prior
// closed month so the recurring trend is visible.
export function computeClosedInsights(periodKey) {
  const p = AP_PERIODS.find((x) => x.key === periodKey);
  if (!p || !p.closed) return [];
  const chrono = AP_PERIODS.filter((x) => x.closed).slice().sort((a, b) => a.key.localeCompare(b.key));
  const idx = chrono.findIndex((x) => x.key === periodKey);
  const prev = idx > 0 ? chrono[idx - 1] : null;
  const m = monthOnly(p.label);
  const out = [];

  out.push({
    id: "velocity",
    label: "Close velocity",
    stat: `${p.daysToClose} ${p.daysToClose === 1 ? "day" : "days"}`,
    compare: prev ? `vs ${prev.daysToClose}d in ${monthOnly(prev.label)}` : null,
    explanation: `Declared closed ${p.closedOn} — ${p.daysToClose} days after period-end${prev ? (p.daysToClose < prev.daysToClose ? ", faster than last month." : p.daysToClose > prev.daysToClose ? ", slower than last month." : ", same as last month.") : "."}`,
    spark: chrono.map((x) => ({ label: monthOnly(x.label), value: x.daysToClose })),
    trendUp: prev ? p.daysToClose > prev.daysToClose : false,
    action: null,
  });

  out.push({
    id: "blockers",
    label: "Blockers cleared",
    stat: `${p.blockers}`,
    compare: prev ? `vs ${prev.blockers} in ${monthOnly(prev.label)}` : null,
    explanation: `Klay cleared ${p.blockers} blockers before ${m} closed${prev && p.blockers < prev.blockers ? " — fewer than the month before." : "."}`,
    action: null,
  });

  if (p.offender) {
    out.push({
      id: "offender",
      label: "Recurring offender",
      stat: p.offender,
      explanation: `Bills held in review in ${m} — the repeat pattern Klay flagged for a vendor follow-up.`,
      action: { kind: "route", label: "View vendor", to: "/vendors" },
    });
  }

  return out.slice(0, 3);
}

export function formatRp(n) {
  if (n == null) return "—";
  return "Rp " + n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}
