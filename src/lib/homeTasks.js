// ── Home task hub — cross-module task registry ────────────────────────────
//
// The Home dashboard (MoM 2026-07-10) is a *task hub*: one reusable surface
// that consolidates every module's pending work into a single, role-scoped
// to-do list. Each surfaced item IS a task; clicking it drills into that
// module.
//
// This file is the reusable seam. A module contributes ONE provider — a pure
// function `(ctx) => Task[]` gated by the viewer's capabilities. The Home page
// runs the registry and renders whatever comes back, so a new module plugs in
// by adding a provider here; the page never changes.
//
// A Task descriptor is data-only (no JSX) so providers stay pure & testable:
//   { id, group, groupLabel, groupTo,
//     label,           // short imperative title ("Ready to post")
//     count,           // how many items — the thing we quantify
//     amount,          // rupiah value or null
//     sub,             // one-line context
//     tag,             // { text, tone } | null  (a small emphasis chip)
//     severity,        // "blocking" | "action" | "advisory"  (sort + colour)
//     to,              // deep-link into the module (with ?tab=/?card= focus)
//     cta }            // verb on the button ("Post")
//
// Severity drives the headline strip and ranking: blocking first, then action,
// then advisory; ties broken by amount desc.

import { workflowStatus, isReturned, billPeriod, isApPeriodLocked } from "./billStatus";
import { flagSummary } from "./reviewWorkflow";
import { buildAgingLines, isDecisionQueueRow } from "./apAging";
import { computeApCloseSummary, computeBankRecon } from "../data/seed/apClose";
import { TODAY } from "./clock";

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const todayKey = () => TODAY.toISOString().slice(0, 10);

export const SEVERITY_ORDER = { blocking: 0, action: 1, advisory: 2 };

// ── Providers ─────────────────────────────────────────────────────────────
// Each returns Task[] (already gated on capabilities). `group`/`groupLabel`/
// `groupTo` let the Home page section tasks by their origin module.

// AP · Bills — getting bills to Posted (mirrors the Bills "Your Tasks" band).
function billsTasks(ctx) {
  const { bills, closedThrough, autoAssignLateBills, hasCapability } = ctx;
  const canDraft = hasCapability("ap.transact");   // AP Staff owns the data
  const canApprove = hasCapability("ap.approve");  // Finance Manager
  const canPost = hasCapability("ap.post");         // Accounting Manager + FM
  const g = { group: "bills", groupLabel: "Bills", groupTo: "/bills" };
  const out = [];

  const reviewList = bills.filter((b) => workflowStatus(b) === "PENDING_REVIEW");
  const returnedList = bills.filter((b) => isReturned(b));
  const draftList = bills.filter((b) => b.approval === "draft" && !isReturned(b));
  const readyList = bills.filter(
    (b) => workflowStatus(b) === "APPROVED" && !isApPeriodLocked(billPeriod(b), closedThrough),
  );
  // Flag-based exceptions (open blocking + review) on non-posted bills.
  const exceptionList = bills.filter((b) => {
    const s = flagSummary(b, undefined, { autoAssignLateBills });
    return s.openBlocking + s.openReview > 0;
  });
  const anyBlocking = exceptionList.some(
    (b) => flagSummary(b, undefined, { autoAssignLateBills }).openBlocking > 0,
  );

  if (canApprove && reviewList.length) {
    out.push({ ...g, id: "bills:review", label: "Awaiting approval", count: reviewList.length,
      amount: sum(reviewList, (b) => b.total), sub: "Bills submitted for your approval",
      tag: null, severity: "action", to: "/bills?tab=review", cta: "Review" });
  }
  if ((canDraft || canApprove || canPost) && exceptionList.length) {
    out.push({ ...g, id: "bills:exceptions", label: "Resolve exceptions", count: exceptionList.length,
      amount: sum(exceptionList, (b) => b.total), sub: "Bills with open review flags",
      tag: anyBlocking ? { text: "blocking", tone: "danger" } : { text: "review", tone: "warn" },
      severity: anyBlocking ? "blocking" : "action", to: "/bills?tab=exception", cta: "Resolve" });
  }
  if (canDraft && returnedList.length) {
    out.push({ ...g, id: "bills:returned", label: "Fix returned bills", count: returnedList.length,
      amount: sum(returnedList, (b) => b.total), sub: "Returned by FM — needs correction",
      tag: { text: "returned", tone: "danger" }, severity: "blocking", to: "/bills?card=returned", cta: "Fix" });
  }
  if (canPost && readyList.length) {
    out.push({ ...g, id: "bills:ready", label: "Ready to post", count: readyList.length,
      amount: sum(readyList, (b) => b.total), sub: "Verified — commit to the general ledger",
      tag: null, severity: "action", to: "/bills?card=readyToPost", cta: "Post" });
  }
  if (canDraft && draftList.length) {
    out.push({ ...g, id: "bills:draft", label: "Submit drafts", count: draftList.length,
      amount: sum(draftList, (b) => b.total), sub: "Draft bills to submit for approval",
      tag: null, severity: "action", to: "/bills?tab=draft", cta: "Submit" });
  }
  return out;
}

// AP · Payments — the payment stage this role owns (request → approve → pay),
// off the AP Aging decision queue (POSTED-only). Mirrors ApAgingPage payMode.
function paymentTasks(ctx) {
  const { agingLines, paymentStatusOf, hasCapability } = ctx;
  const payMode = hasCapability("payment.approve") ? "approve"
    : hasCapability("payment.request") ? "request"
    : hasCapability("payment.execute") ? "execute"
    : "view";
  if (payMode === "view") return [];
  const g = { group: "payments", groupLabel: "Payments", groupTo: "/payments" };
  const out = [];

  const queue = agingLines.filter(isDecisionQueueRow);
  const stage = payMode === "approve" ? "requested" : payMode === "execute" ? "approved" : "unpaid";
  const stageRows = queue.filter((l) => paymentStatusOf(l.id) === stage);
  const STAGE_META = {
    request: { label: "Request payment", sub: "Posted bills ready to pay", cta: "Request" },
    approve: { label: "Payments to approve", sub: "Requested by AP Staff", cta: "Approve" },
    execute: { label: "Pay approved", sub: "Approved — execute the transfer", cta: "Pay" },
  }[payMode];
  if (stageRows.length) {
    out.push({ ...g, id: `pay:${payMode}`, label: STAGE_META.label, count: stageRows.length,
      amount: sum(stageRows, (l) => l.remaining), sub: STAGE_META.sub, tag: null,
      severity: "action", to: "/payments", cta: STAGE_META.cta });
  }

  // Finance Staff — settle the overdue first.
  if (payMode === "execute") {
    const overdue = queue.filter((l) => l.daysOverdue > 0 && paymentStatusOf(l.id) === "approved");
    if (overdue.length) {
      out.push({ ...g, id: "pay:overdue", label: "Settle overdue", count: overdue.length,
        amount: sum(overdue, (l) => l.remaining), sub: "Past due — pay these first",
        tag: { text: "overdue", tone: "danger" }, severity: "action", to: "/payments?card=overdue", cta: "Prioritize" });
    }
  }
  return out;
}

// AR · Invoices — send drafts + chase overdue (AR Staff owns the receivable).
function invoiceTasks(ctx) {
  const { invoices, hasCapability } = ctx;
  if (!hasCapability("ar.transact")) return [];
  const g = { group: "invoices", groupLabel: "Invoices", groupTo: "/invoices" };
  const out = [];
  const tk = todayKey();

  const drafts = invoices.filter((v) => v.approval === "draft");
  const overdue = invoices.filter(
    (v) => v.payStatus === "overdue" || (v.payStatus === "unpaid" && v.due && v.due < tk),
  );
  if (drafts.length) {
    out.push({ ...g, id: "inv:draft", label: "Send invoices", count: drafts.length,
      amount: sum(drafts, (v) => v.total), sub: "Draft invoices ready to send",
      tag: null, severity: "action", to: "/invoices?tab=draft", cta: "Send" });
  }
  if (overdue.length) {
    out.push({ ...g, id: "inv:overdue", label: "Chase overdue invoices", count: overdue.length,
      amount: sum(overdue, (v) => v.total), sub: "Past due — follow up for payment",
      tag: { text: "overdue", tone: "danger" }, severity: "action", to: "/invoices?tab=jatuhtempo", cta: "Chase" });
  }
  return out;
}

// GL · Journal Entry — draft journals awaiting posting (recorder / approver).
function journalTasks(ctx) {
  const { entries, hasCapability } = ctx;
  if (!hasCapability("gl.post") && !hasCapability("gl.approve")) return [];
  const g = { group: "journals", groupLabel: "Journal Entry", groupTo: "/journal-entry" };
  const drafts = entries.filter((e) => e.status === "draft" || e.status === "pending");
  if (!drafts.length) return [];
  const amt = sum(drafts, (e) => sum(e.lines || [], (l) => l.debit));
  return [{ ...g, id: "gl:drafts", label: "Post draft journals", count: drafts.length,
    amount: amt, sub: "Draft journal entries awaiting posting", tag: null,
    severity: "action", to: "/journal-entry", cta: "Review" }];
}

// Bank · Reconciliation — unmatched / in-transit items (Finance Staff).
function bankTasks(ctx) {
  const { hasCapability } = ctx;
  if (!hasCapability("bank.reconcile")) return [];
  const g = { group: "bank", groupLabel: "Bank Reconciliation", groupTo: "/bank-reconciliation" };
  const recon = computeBankRecon();
  // Items to act on = payments in transit + unreconciled accounts.
  const inTransit = sum(recon.exceptions, (r) => r.outstanding);
  if (!inTransit && !recon.unrec) return [];
  const blocking = recon.unrec > 0;
  return [{ ...g, id: "bank:match", label: "Match bank items", count: inTransit || recon.unrec,
    amount: null, sub: blocking ? "Unreconciled accounts need review" : "Payments in transit to match",
    tag: blocking ? { text: "unreconciled", tone: "danger" } : null,
    severity: blocking ? "blocking" : "advisory", to: "/bank-reconciliation", cta: "Reconcile" }];
}

// Month-End Close — blockers holding the period (close owners: approve/post).
function closeTasks(ctx) {
  const { hasCapability } = ctx;
  const isOwner = hasCapability("ap.approve") || hasCapability("ap.post");
  if (!isOwner) return [];
  const s = computeApCloseSummary();
  if (!s.blockerCount) return [];
  const g = { group: "close", groupLabel: "Month-End Close", groupTo: "/close" };
  return [{ ...g, id: "close:blockers", label: "Clear close blockers", count: s.blockerCount,
    amount: null, sub: `Blocking the ${s.periodLabel || "current"} close`,
    tag: { text: "blocking close", tone: "danger" }, severity: "blocking", to: "/close", cta: "Resolve" }];
}

export const TASK_PROVIDERS = [
  billsTasks, paymentTasks, invoiceTasks, journalTasks, bankTasks, closeTasks,
];

// Run every provider against the assembled ctx and roll the results up into the
// shape the Home page renders. Groups preserve module origin; the summary
// quantifies the open workload (MoM: "quantify the number of open tasks").
export function computeHomeTasks(ctx) {
  const tasks = [];
  for (const provider of TASK_PROVIDERS) {
    const rows = provider(ctx) || [];
    for (const t of rows) tasks.push(t);
  }
  tasks.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.amount || 0) - (a.amount || 0),
  );

  // Section by module group, in first-seen order.
  const groups = [];
  const byKey = new Map();
  for (const t of tasks) {
    let grp = byKey.get(t.group);
    if (!grp) { grp = { key: t.group, label: t.groupLabel, to: t.groupTo, tasks: [] }; byKey.set(t.group, grp); groups.push(grp); }
    grp.tasks.push(t);
  }

  // Summaries count TASK CARDS (distinct actions), not underlying records —
  // records can appear under more than one task (a flagged bill is both an
  // exception and awaiting approval), so summing counts would double-count.
  // Per-card `count` still shows the granular "things to do" on each card.
  const bySeverity = { blocking: 0, action: 0, advisory: 0 };
  for (const t of tasks) bySeverity[t.severity] += 1;
  const taskCount = tasks.length;
  const recordCount = tasks.reduce((s, t) => s + t.count, 0);

  return { tasks, groups, taskCount, recordCount, groupCount: groups.length, bySeverity };
}
