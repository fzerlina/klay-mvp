// Payment-status state — the second status axis, distinct from the journal/
// posting status (Draft→…→Posted). Payment status only applies once a bill is
// POSTED and tracks the payment lifecycle:
//
//   unpaid → requested (AP Staff) → approved (Finance Manager) → paid (Finance
//   Staff, executed off-system) → [reconciled — stubbed for now]
//
// A payment run can also settle only PART of the balance — status "partial".
// A partial bill still carries an open remaining balance, so it re-enters
// AP Staff's request queue (alongside "unpaid") for the rest to be requested.
//
// Per the 2026-07-11 MoM: request off AP Aging → FM approval → bank owner pays.
// Prototype: local state, no backend. Reconciliation (bank-statement upload /
// auto-match) is a later pass; "paid" is the terminal state here.

import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { BILLS } from "../data/seed/bills";
import { TODAY } from "../lib/clock";

const PaymentsContext = createContext(null);

const TODAY_ISO = TODAY.toISOString().slice(0, 10);

// ISO date N days before the demo clock — used to stagger request/approval
// timestamps so the role-scoped urgency sorts (FM "oldest waiting first",
// Finance Staff "time since approved") have something real to order on.
const isoDaysAgo = (n) => new Date(TODAY.getTime() - n * 86400000).toISOString().slice(0, 10);

// A posted, unpaid bill is payable. Seed a realistic spread across the lifecycle
// so every persona's Decision Queue has something to act on out of the box:
// a couple partially paid, a few approved (Finance Staff executes), several
// requested (FM approves), the rest unpaid (AP Staff requests). Timestamps are
// staggered so per-role urgency ordering is visible in the demo.
function seedPayments() {
  const payable = BILLS
    .filter((b) => b.je_number && b.pay !== "paid")
    .map((b) => b.id)
    .sort();
  const m = {};
  payable.forEach((id, i) => {
    if (i < 2) {
      // Partially paid — an earlier run covered part of the balance; the
      // remainder is still open and re-enters AP Staff's request queue.
      m[id] = {
        status: "partial",
        requestedBy: "Budi Santoso", requestedAt: isoDaysAgo(9 + i),
        approvedBy: "Sari Dewanti",  approvedAt: isoDaysAgo(7 + i),
        paidBy: "Andi Pratama",      paidAt: isoDaysAgo(5 + i),
      };
    } else if (i < 5) {
      // Approved, awaiting execution — stagger approvedAt (1–3 days back).
      m[id] = {
        status: "approved",
        requestedBy: "Budi Santoso", requestedAt: isoDaysAgo(4 + (i % 3)),
        approvedBy: "Sari Dewanti",  approvedAt: isoDaysAgo(1 + (i % 3)),
      };
    } else if (i < 13) {
      // Requested, awaiting FM approval — stagger requestedAt (1–6 days back).
      m[id] = {
        status: "requested",
        requestedBy: "Budi Santoso", requestedAt: isoDaysAgo(((i - 5) % 6) + 1),
      };
    }
    // rest: unpaid (absent from the map)
  });
  return m;
}

export function PaymentsProvider({ children }) {
  const [payments, setPayments] = useState(seedPayments);

  const requestPayment = useCallback((ids, by) => {
    setPayments((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { status: "requested", requestedBy: by, requestedAt: TODAY_ISO };
      return next;
    });
  }, []);

  const approvePayment = useCallback((ids, by) => {
    setPayments((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (next[id]?.status === "requested") next[id] = { ...next[id], status: "approved", approvedBy: by, approvedAt: TODAY_ISO };
      }
      return next;
    });
  }, []);

  const markPaid = useCallback((ids, by) => {
    setPayments((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (next[id]?.status === "approved") next[id] = { ...next[id], status: "paid", paidBy: by, paidAt: TODAY_ISO };
      }
      return next;
    });
  }, []);

  // Settle only part of an approved payment. The bill keeps an open balance
  // (reduced by the caller via the ledger), so it re-enters the request queue.
  const markPartial = useCallback((ids, by, amount) => {
    setPayments((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (next[id]?.status === "approved") {
          const prior = next[id]?.partialPaid || 0;
          next[id] = { ...next[id], status: "partial", paidBy: by, paidAt: TODAY_ISO, partialPaid: prior + (amount || 0) };
        }
      }
      return next;
    });
  }, []);

  // Send a requested payment back to AP (FM rejects). Rather than clearing the
  // request silently, we mark it "returned" with a reason so AP sees it bounced
  // and why — the bill re-enters AP Staff's request queue.
  const returnPayment = useCallback((ids, by, reason) => {
    setPayments((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        next[id] = { status: "returned", returnedBy: by, returnedAt: TODAY_ISO, returnReason: reason || "Sent back for correction", requestedBy: next[id]?.requestedBy, requestedAt: next[id]?.requestedAt };
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    payments,
    statusOf: (id) => payments[id]?.status || "unpaid",
    detailOf: (id) => payments[id] || null,
    requestPayment,
    approvePayment,
    markPaid,
    markPartial,
    returnPayment,
  }), [payments, requestPayment, approvePayment, markPaid, markPartial, returnPayment]);

  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

export function usePayments() {
  const ctx = useContext(PaymentsContext);
  if (!ctx) {
    // Tolerate consumers rendered outside the provider (HMR/tests).
    return { payments: {}, statusOf: () => "unpaid", detailOf: () => null, requestPayment: () => {}, approvePayment: () => {}, markPaid: () => {}, markPartial: () => {}, returnPayment: () => {} };
  }
  return ctx;
}

// Display metadata for a payment status.
export const PAYMENT_STATUS_META = {
  unpaid:    { label: "Unpaid",    tone: "muted" },
  requested: { label: "Requested", tone: "review" },
  approved:  { label: "Approved",  tone: "action" },
  returned:  { label: "Returned",  tone: "danger" },
  partial:   { label: "Partial",   tone: "partial" },
  paid:      { label: "Paid",      tone: "success" },
  reconciled:{ label: "Reconciled", tone: "success" },
};
