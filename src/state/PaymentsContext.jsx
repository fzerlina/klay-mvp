// Payment state — TWO independent axes on a posted bill.
//
//   Payment status   how much of the bill is paid off: unpaid → partial → paid.
//                    DERIVED from the bill's ledger balance, not stored here —
//                    see paymentStatusOf() in lib/paymentStage.js. Two places
//                    to record the same fact is two places to disagree.
//
//   Request status   where the current payment request sits
//                      notyet → requested (AP Staff) → approved (Finance Manager)
//
// They are independent on purpose: a bill that has been partly paid and is
// waiting on approval for the rest is "Approved" AND "Partial" at the same
// time, and a single status field cannot say that. Recording a payment ends
// the request cycle — the request status returns to "notyet" — while the
// payment status advances to partial or paid. So a part-paid bill re-enters
// AP Staff's request queue for the remainder, and goes round again.
//
// A returned request is NOT a status. The Finance Manager sending a request
// back drops the request status to "notyet" and raises an exception on the
// bill (see paymentFlags.js), so it shows up as something to resolve rather
// than as a parking state the bill can sit in.
//
// Prototype: local state, no backend. Execution is off-system; reconciliation
// (bank-statement match) is a later pass.

import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { BILLS } from "../data/seed/bills";
import { PARTIAL_SEED } from "../data/seed/partialPayments";
import { TODAY } from "../lib/clock";
import { breakdownTotal, defaultBreakdown, sumBreakdowns } from "../lib/paymentBreakdown";

const PaymentsContext = createContext(null);

const TODAY_ISO = TODAY.toISOString().slice(0, 10);

// ISO date N days before the demo clock — used to stagger request/approval
// timestamps so the role-scoped urgency sorts (FM "oldest waiting first",
// Finance Staff "time since approved") have something real to order on.
const isoDaysAgo = (n) => new Date(TODAY.getTime() - n * 86400000).toISOString().slice(0, 10);

const BLANK = { request: "notyet" };

// Request stamps consistent with a given request state, so the role-scoped
// urgency sorts have something real to order on.
function stampsFor(request, age = 3) {
  if (request === "requested") {
    return { request, requestedBy: "Budi Santoso", requestedAt: isoDaysAgo(age) };
  }
  if (request === "approved") {
    return {
      request,
      requestedBy: "Budi Santoso", requestedAt: isoDaysAgo(age + 2),
      approvedBy: "Sari Dewanti", approvedAt: isoDaysAgo(age),
    };
  }
  return { request: "notyet" };
}

// A posted, unpaid bill is payable. Seed a spread across both axes so every
// persona has something to act on.
function seedPayments() {
  const payable = BILLS
    .filter((b) => b.je_number && b.pay !== "paid")
    .map((b) => b.id)
    .sort();
  const m = {};

  // The part-paid bills are pinned across all three request states first, so
  // the independence of the two axes is visible in the demo rather than
  // implied: Partial can be not-yet-requested, requested, OR approved.
  for (const [id, seed] of Object.entries(PARTIAL_SEED)) m[id] = stampsFor(seed.request, 3);

  payable.forEach((id, i) => {
    if (m[id]) return; // already pinned above
    if (i < 6) {
      // Approved, awaiting execution — stagger approvedAt (1–3 days back).
      m[id] = {
        request: "approved",
        requestedBy: "Budi Santoso", requestedAt: isoDaysAgo(4 + (i % 3)),
        approvedBy: "Sari Dewanti", approvedAt: isoDaysAgo(1 + (i % 3)),
      };
    } else if (i < 14) {
      // Requested, awaiting FM approval — stagger requestedAt (1–6 days back).
      m[id] = {
        request: "requested",
        requestedBy: "Budi Santoso", requestedAt: isoDaysAgo(((i - 6) % 6) + 1),
      };
    }
    // rest: unpaid / notyet (absent from the map)
  });
  return m;
}

export function PaymentsProvider({ children }) {
  const [payments, setPayments] = useState(seedPayments);

  const patchEach = useCallback((ids, fn) => {
    setPayments((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const cur = next[id] || { ...BLANK };
        const upd = fn(cur, id);
        if (upd) next[id] = { ...cur, ...upd };
      }
      return next;
    });
  }, []);

  // AP Staff asks for the open balance to be paid. Re-requesting is also how a
  // returned request is answered, so the return exception clears here.
  const requestPayment = useCallback((ids, by) => {
    patchEach(ids, () => ({ request: "requested", requestedBy: by, requestedAt: TODAY_ISO, returned: null }));
  }, [patchEach]);

  // The Finance Manager releases it. Only from "requested" — nobody approves a
  // payment that was never asked for.
  const approvePayment = useCallback((ids, by) => {
    patchEach(ids, (cur) => (cur.request === "requested"
      ? { request: "approved", approvedBy: by, approvedAt: TODAY_ISO }
      : null));
  }, [patchEach]);

  // Sending a request back. The bill drops to "not yet requested" and carries an
  // exception saying why, rather than sitting in a "Returned" status of its own.
  const returnRequest = useCallback((ids, by, reason) => {
    patchEach(ids, (cur) => (cur.request === "requested"
      ? {
        request: "notyet",
        approvedBy: undefined,
        approvedAt: undefined,
        returned: { by, at: TODAY_ISO, reason: reason || "Sent back for correction" },
      }
      : null));
  }, [patchEach]);

  // Executing an approved payment. Every execution carries a typed breakdown —
  // there is no untyped path — and is appended to the bill's payment history
  // rather than overwriting the last one. The request cycle then ends: the
  // request status returns to "notyet" so a remaining balance can be requested
  // again, and the payment status advances.
  //
  //   entries: [{ id, breakdown, paysInFull }]
  const recordPayment = useCallback((entries, by) => {
    setPayments((prev) => {
      const next = { ...prev };
      for (const e of entries) {
        const cur = next[e.id];
        if (cur?.request !== "approved") continue;
        const cleared = breakdownTotal(e.breakdown);
        const history = [...(cur.history || []), { at: TODAY_ISO, by, breakdown: e.breakdown, cleared }];
        next[e.id] = {
          ...cur,
          request: "notyet",
          requestedBy: undefined, requestedAt: undefined,
          approvedBy: undefined, approvedAt: undefined,
          paidBy: by, paidAt: TODAY_ISO,
          history,
          paidSoFar: history.reduce((s, h) => s + h.cleared, 0),
        };
      }
      return next;
    });
  }, []);

  // Convenience for callers that just want "pay the whole open balance" — it
  // still produces a typed breakdown rather than an untyped amount.
  const markPaid = useCallback((ids, by, linesById = {}) => {
    recordPayment(
      ids.map((id) => ({ id, breakdown: defaultBreakdown(linesById[id] || {}), paysInFull: true })),
      by,
    );
  }, [recordPayment]);

  // Acknowledging a review-tier release flag. Blocking flags are deliberately
  // not acknowledgeable — they have to be fixed on the record or the bill has
  // to leave the batch, which is the whole point of the tier.
  const acknowledgeFlag = useCallback((id, flagKey, by) => {
    setPayments((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { ...BLANK }),
        acks: { ...(prev[id]?.acks || {}), [flagKey]: { by, at: TODAY_ISO } },
      },
    }));
  }, []);

  const value = useMemo(() => ({
    payments,
    // The request axis only. The payment axis is derived from the ledger
    // balance — see paymentStatusOf() in lib/paymentStage.js.
    requestStatusOf: (id) => payments[id]?.request || "notyet",
    detailOf: (id) => payments[id] || null,
    // A returned request, as an exception rather than a status.
    returnedOf: (id) => payments[id]?.returned || null,
    // Every typed component ever paid against a bill, summed.
    paidComponentsOf: (id) => sumBreakdowns((payments[id]?.history || []).map((h) => h.breakdown)),
    acksOf: (id) => payments[id]?.acks || {},
    requestPayment,
    approvePayment,
    returnRequest,
    recordPayment,
    markPaid,
    acknowledgeFlag,
  }), [payments, requestPayment, approvePayment, returnRequest, recordPayment, markPaid, acknowledgeFlag]);

  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

export function usePayments() {
  const ctx = useContext(PaymentsContext);
  if (!ctx) {
    // Tolerate consumers rendered outside the provider (HMR/tests).
    return {
      payments: {},
      requestStatusOf: () => "notyet",
      detailOf: () => null,
      returnedOf: () => null,
      paidComponentsOf: () => ({}),
      acksOf: () => ({}),
      requestPayment: () => {}, approvePayment: () => {}, returnRequest: () => {},
      recordPayment: () => {}, markPaid: () => {}, acknowledgeFlag: () => {},
    };
  }
  return ctx;
}

// Display metadata for the PAYMENT axis. The axis itself is derived (see
// paymentStatusOf); this is only how each value is rendered. The request axis
// lives in lib/paymentStage.js (REQ_META) alongside the actions that move it.
export const PAYMENT_STATUS_META = {
  unpaid:  { label: "Unpaid",  tone: "muted" },
  partial: { label: "Partial", tone: "partial" },
  paid:    { label: "Paid",    tone: "success" },
};
