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
import { PAYMENT_HISTORY_SEED } from "../data/seed/paymentHistory";
import { TODAY } from "../lib/clock";
import { breakdownTotal, defaultBreakdown, sumBreakdowns } from "../lib/paymentBreakdown";
import { paymentJournalLines } from "../lib/paymentJournal";
import { useBills } from "./BillsContext";
import { useJournalEntries } from "./JournalEntriesContext";

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
  // Each carries the payment that produced its balance, so the Payment tab has
  // activity to list rather than an unexplained opening position.
  for (const [id, seed] of Object.entries(PARTIAL_SEED)) {
    const history = PAYMENT_HISTORY_SEED[id] || [];
    m[id] = {
      ...stampsFor(seed.request, 3),
      ...(history.length ? { history, paidSoFar: history.reduce((s, h) => s + h.cleared, 0) } : {}),
    };
  }

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
  // Recording a payment writes a real journal entry, so this provider sits
  // inside both of these (see App.jsx). Reading the live bill rather than the
  // seed keeps the entry's memo on the vendor the bill actually names today.
  const { bills } = useBills();
  const { addJournalEntry, peekNextJeNumber } = useJournalEntries();

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
    // Nobody executes a payment that was never approved. The guard runs here,
    // against the current state, rather than inside the updater below: the
    // journal entries are written outside it, and they must be written for
    // exactly the payments that land.
    const eligible = entries.filter((e) => payments[e.id]?.request === "approved");
    if (eligible.length === 0) return;

    // One journal entry per payment, written into the ledger now rather than
    // derived on demand when the Payment tab is opened. The tab links each row
    // to its entry, and a link needs something that exists: a JE computed for
    // display has no number to point at and no life outside that one table.
    //
    // Numbers are taken as a block. peekNextJeNumber reads provider state that
    // has not updated yet, so asking it once per bill in a bulk release would
    // hand every bill the same number.
    const base = peekNextJeNumber();
    const m = /^JE-(\d{4})-(\d+)$/.exec(base);
    const jeNumberAt = (i) => (m ? `JE-${m[1]}-${String(parseInt(m[2], 10) + i).padStart(4, "0")}` : `${base}-${i}`);

    const written = eligible.map((e, i) => {
      const bill = bills.find((b) => b.id === e.id);
      const je_number = jeNumberAt(i);
      const { lines } = paymentJournalLines(e.breakdown, { vendorName: bill?.vendorName });
      return {
        id: e.id,
        je_number,
        je: {
          je_number,
          je_date: TODAY_ISO,
          status: "posted",
          memo: `Payment — ${bill?.vendorName || e.id}${bill?.invNo ? ` · ${bill.invNo}` : ""}`,
          reference_type: "payment",
          reference_id: e.id,
          created_by: by,
          created_date: TODAY_ISO,
          posted_by: by,
          posted_date: TODAY_ISO,
          // paymentJournalLines speaks in sides so one renderer can draw both
          // this and the posting preview; a stored JE speaks in debit/credit
          // columns, which is the shape the rest of the GL already reads.
          lines: lines.map((l) => ({
            account_code: l.account_code,
            account_name: l.account_name,
            debit: l.side === "DR" ? l.amount : 0,
            credit: l.side === "CR" ? l.amount : 0,
            description: l.description,
          })),
        },
      };
    });
    written.forEach((w) => addJournalEntry(w.je));
    const jeById = Object.fromEntries(written.map((w) => [w.id, w.je_number]));

    setPayments((prev) => {
      const next = { ...prev };
      for (const e of eligible) {
        const cur = next[e.id];
        const cleared = breakdownTotal(e.breakdown);
        const history = [...(cur.history || []), { at: TODAY_ISO, by, breakdown: e.breakdown, cleared, je_number: jeById[e.id] }];
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
  }, [payments, bills, addJournalEntry, peekNextJeNumber]);

  // Convenience for callers that just want "pay the whole open balance" — it
  // still produces a typed breakdown rather than an untyped amount. `defaults`
  // carries the method and source account the caller is paying from, so a bulk
  // release records where the money actually came out of.
  const markPaid = useCallback((ids, by, linesById = {}, defaults = {}) => {
    recordPayment(
      ids.map((id) => ({ id, breakdown: defaultBreakdown(linesById[id] || {}, defaults), paysInFull: true })),
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
