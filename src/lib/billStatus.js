// Pure helpers shared between BillsPage (list) and BillDetailPage (detail).
// Extracted from BillsPage.jsx so both surfaces use the same workflow state
// machine, period-lock check, source-channel rule, and urgency score.
//
// In production these would map to columns on `ap_invoices` (workflow_status,
// returned_reason, on_hold, hold_reason, exception_reason) plus a per-bill
// review-state object (fields_flagged, days_in_queue, etc) — see the
// Bill Details Page PRD (Coda: KLAY/Bill-Details-Page).

import { daysSince } from "./clock";
import { formatDateEn } from "./format";

// Demo-only overrides — adds states that aren't expressible from the
// two-dimensional (approval × pay) seed: RETURNED, ON_HOLD, EXCEPTION, plus
// a per-bill `opened` review-state for the PENDING_REVIEW cause sentence.
export const DEMO_OVERRIDES = {
  BILL005: { state: "RETURNED", returned: { by: "FM", reason: "PO doesn't match invoice qty — verify with vendor" } },
  BILL022: { state: "RETURNED", returned: { by: "FM", reason: "Needs L2 approval for amount > Rp 100M" } },
  BILL010: { state: "ON_HOLD",  onHold:   { reason: "awaiting credit note", since: "2025-04-15" } },
  BILL011: { state: "ON_HOLD",  onHold:   { reason: "vendor dispute on shipping cost", since: "2025-04-10" } },
  BILL028: { state: "EXCEPTION", exception: { reason: "OCR confidence below threshold — manual review required" } },
  BILL034: { state: "EXCEPTION", exception: { reason: "Duplicate detected — similar to BILL001" } },
  // Tag a couple of PENDING_REVIEW bills as "already opened" so the cause
  // sentence shows that branch (vs "not yet opened · Nd in queue").
  BILL008: { opened: { daysAgo: 2, fieldsFlagged: 3 } },
  BILL012: { opened: { daysAgo: 1, fieldsFlagged: 0 } },
};

export const STATUS_LABEL = {
  DRAFT:          "Draft",
  PENDING_REVIEW: "Pending Review",
  RETURNED:       "Returned",
  ON_HOLD:        "On Hold",
  APPROVED:       "Approved",
  POSTED:         "Posted",
  PAID:           "Paid",
  EXCEPTION:      "Exception",
};

// Period-locking helper — TRUE if a bill's accounting period falls within a
// closed AP period. Demo logic: every period ≤ closedThrough is closed.
// In production: `is_ap_period_locked(entity_id, bill.period)`, consulting
// `fiscal_periods.is_locked` as the canonical lock state per Subledger Memo
// Rule 7. The static AP_CLOSED_THROUGH is the baseline at app load; the
// ClosePeriodContext advances it as the FM declares new periods closed.
// Callers that need the dynamic value should pass `closedThrough` from
// `useClosePeriod()`; legacy callers fall back to the baseline constant.
export const AP_CLOSED_THROUGH = "2025-02";
export function isApPeriodLocked(billDate, closedThrough = AP_CLOSED_THROUGH) {
  if (!billDate) return false;
  return billDate.slice(0, 7) <= closedThrough;
}

// The accounting period a bill posts into — the field the period-lock check
// consults. Per the Bills List / Bill Detail PRDs this is SEPARATE from the
// vendor's invoice_date (b.date): it defaults to the invoice month but can be
// reassigned to an open period (e.g. when an invoice arrives after its period
// closed) WITHOUT rewriting the historical document date. Returns YYYY-MM.
// Falls back to invoice_date for seed bills that predate the field.
export function billPeriod(b) {
  if (b?.period) return b.period.slice(0, 7);
  return b?.date ? b.date.slice(0, 7) : "";
}

// Single workflow_status derived from the existing (approval × pay) seed plus
// the DEMO_OVERRIDES table. Bills List + Bill Detail both render from this.
export function workflowStatus(b) {
  const ov = DEMO_OVERRIDES[b.id];
  // Status = the journal lifecycle stage only (Draft / Pending Review / Approved
  // / Posted / Paid) plus ON_HOLD, which is a real (paused) status. "Returned"
  // and "Exception" are NOT statuses — "Returned" is a REVIEW-tier exception in
  // the flag engine (reviewWorkflow.js): a returned bill is back with AP as a
  // Draft and the return reason surfaces as a flag, not a status.
  if (ov?.state === "ON_HOLD") return "ON_HOLD";
  if (ov?.returned) return "DRAFT";
  if (b.approval === "draft") return "DRAFT";
  if (b.approval === "review") return "PENDING_REVIEW";
  if (b.approval === "approved" && b.pay === "paid") return "PAID";
  // Approved but not yet committed to the GL = "ready to post". Once the FM
  // posts (a je_number is stamped) it advances to POSTED. These are distinct
  // FM actions: Approve clears review, Post writes the journal entry.
  if (b.approval === "approved" && b.je_number) return "POSTED";
  if (b.approval === "approved") return "APPROVED";
  return "PENDING_REVIEW";
}

// "Returned" is an approval-workflow OUTCOME label, not a status. A returned
// bill shows as Draft (back with AP) with this label appended.
export function isReturned(b) {
  return !!DEMO_OVERRIDES[b?.id]?.returned;
}
export function returnedReason(b) {
  return DEMO_OVERRIDES[b?.id]?.returned?.reason || null;
}

// Short cause sentence shown under the status pill on the list row and under
// the status stepper on the detail page. Captures "why is this bill here
// right now" — opened/not-opened for review, return reason, hold reason,
// payment scheduled, days late, etc.
export function statusCause(b) {
  const ov = DEMO_OVERRIDES[b.id] || {};
  const ws = workflowStatus(b);
  const dpd = daysSince(b.due);
  switch (ws) {
    case "DRAFT":
      return "not yet submitted";
    case "PENDING_REVIEW": {
      if (ov.opened) {
        const { daysAgo, fieldsFlagged } = ov.opened;
        return fieldsFlagged > 0
          ? `opened ${daysAgo}d ago · ${fieldsFlagged} field${fieldsFlagged === 1 ? "" : "s"} flagged`
          : `opened ${daysAgo}d ago · no fields flagged`;
      }
      const inQueue = Math.max(1, daysSince(b.audit?.[0]?.date || b.date));
      return `not yet opened · ${inQueue}d in queue`;
    }
    case "RETURNED":
      return `FM: ${(ov.returned?.reason || "needs fix").slice(0, 60)}`;
    case "ON_HOLD": {
      const sinceDays = ov.onHold?.since ? Math.max(0, daysSince(ov.onHold.since)) : 0;
      return `${ov.onHold?.reason || "awaiting info"} · ${sinceDays}d`;
    }
    case "APPROVED":
      return "ready to post";
    case "POSTED":
      return dpd > 0 ? `posted · overdue ${dpd}d` : "posted · awaiting payment";
    case "PAID": {
      const paidAudit = (b.audit || []).find((a) => a.type === "paid") || (b.audit || [])[(b.audit?.length || 1) - 1];
      return paidAudit?.date ? formatDateEn(paidAudit.date) : "settled";
    }
    case "EXCEPTION":
      return ov.exception?.reason || "system error";
    default:
      return "";
  }
}

// Source channel — derived from existing bill fields for demo. In production
// this would come from a `source_channel` field on ap_invoices.
const RECURRING_ACCTS = new Set(["6-2400", "6-2600", "6-2300"]); // Utilities, SaaS, Rent
export function sourceChannelFor(b) {
  if (b.isAI) return "email"; // AI-OCR drafts are ingested from email/WA streams
  // Recurring vendor heuristic: same vendor appears multiple times across months
  // with similar amounts. For the demo, flag utility/subscription CoA accts.
  if (b.items && b.items.some((it) => RECURRING_ACCTS.has(it.acct))) {
    if (b.approval !== "draft") return "recurring";
  }
  return "upload";
}

// Urgency score — drives the list's default sort (highest first). Exceptions
// (rules-engine flags) DOMINATE: any open BLOCKING outranks any REVIEW-only,
// and both outrank every clean bill — achieved with big tier constants so the
// other signals only break ties WITHIN a tier. Exceptions exist only on
// non-posted bills (the flag engine returns nothing once a bill is posted), so
// posted/paid bills fall to the bottom. After the exception tier: workflow
// state, time-in-review, due-date pressure, then a small advisory nudge.
// Anomalies and GRN mismatch are no longer scored here directly — they're now
// flags in the engine (advisory / review), so urgency reads ONE source: the
// flag summary. In production this is a pre-computed column with IA-tunable
// weights from system_config.
const URGENCY_TIER_BLOCKING = 100000; // any open blocking flag
const URGENCY_TIER_REVIEW = 50000;    // review-only (no blocking)
export function urgencyScore(b, flags) {
  let s = 0;
  const ws = workflowStatus(b);
  const dpd = daysSince(b.due);
  const ov = DEMO_OVERRIDES[b.id] || {};

  // 1) Exception tier — the dominant signal. BLOCKING beats REVIEW-only beats
  //    clean, absolutely; the flag count nudges ordering within a tier.
  if (flags) {
    if (flags.openBlocking > 0)    s += URGENCY_TIER_BLOCKING + flags.openBlocking * 100;
    else if (flags.openReview > 0) s += URGENCY_TIER_REVIEW + flags.openReview * 100;
  }

  // 2) Workflow state
  switch (ws) {
    case "ON_HOLD":        s += 30; break; // paused, may need a nudge
    case "PENDING_REVIEW": s += 50; break;
    case "APPROVED":       s += 20; break; // off the FM's plate already
    case "DRAFT":          s += 10; break;
    default:               break;          // POSTED / PAID — terminal for this list
  }

  // 3) Time in review + opened-with-flags signal (PENDING_REVIEW only)
  if (ws === "PENDING_REVIEW") {
    const inQueue = Math.max(0, daysSince(b.audit?.[0]?.date || b.date));
    if (inQueue >= 5) s += 40;
    else if (inQueue >= 3) s += 20;
    else if (inQueue >= 1) s += 8;
    s += (ov.opened?.fieldsFlagged || 0) * 8;
  }

  // 4) Due-date pressure — non-terminal, non-draft states
  if (ws !== "PAID" && ws !== "DRAFT") {
    if (dpd > 0)      s += Math.min(50, Math.round(dpd / 2)); // overdue (halved & capped)
    else if (dpd > -3) s += 25; // due in next 3 days
    else if (dpd > -7) s += 10; // due this week
  }

  // 5) Advisory tier — a small nudge only; exceptions already dominate. Reads
  //    the flag summary (openAdvisory), NOT the raw anomalies array — anomalies
  //    now flow through the engine as advisory flags (one attention model).
  if (flags) s += (flags.openAdvisory || 0) * 4;

  return s;
}
