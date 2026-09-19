// The payments that produced the part-paid balances in partialPayments.js.
//
// Those bills used to arrive with a ledger balance and nothing behind it, so
// the Payment tab could only show an "opening position" line — an honest
// answer, but it meant the demo had no payment activity to look at until
// somebody recorded one, and a newly recorded payment is always dated today.
// A tab whose whole job is to list what has been paid needs history.
//
// Each seeded payment carries the same typed breakdown a real one does, and
// writes the same journal entry, because the tab derives everything it shows
// from those two things. Anything faked at a shallower level (a prose line, a
// bare amount) would render differently from a payment recorded in-session,
// which is exactly the drift this file exists to avoid.
//
// They are chosen to span the bank-reconciliation axis (lib/bankRecon.js) and
// its three different reasons for "not yet", plus the withholding case:
//
//   BILL009  transfer, 8 Apr    within the BCA Operating statement   → Reconciled
//   BILL015  transfer, 21 Apr   past the Mandiri Operating cut-off   → Not yet
//   BILL022  giro                reaches the statement when it clears → Not yet
//   BILL068  transfer, 14 Apr   within the BCA Operating statement   → Reconciled,
//                               and withholds PPh 23, so the amount it cleared
//                               is larger than the cash that left the bank

import { BILLS } from "./bills";
import { PARTIAL_SEED } from "./partialPayments";
import { defaultBreakdown } from "../../lib/paymentBreakdown";
import { paymentJournalLines } from "../../lib/paymentJournal";

const PLAN = {
  BILL009: { at: "2025-04-08", by: "Dewi Anggraini", method: "bank", sourceAccountId: "bca-op",     je: "JE-2025-0301" },
  BILL015: { at: "2025-04-21", by: "Dewi Anggraini", method: "bank", sourceAccountId: "mandiri-op", je: "JE-2025-0302" },
  BILL022: { at: "2025-04-16", by: "Dewi Anggraini", method: "giro", sourceAccountId: "bni-op", giroNumber: "GR-448120", je: "JE-2025-0303" },
  BILL068: { at: "2025-04-14", by: "Dewi Anggraini", method: "bank", sourceAccountId: "bca-op",     je: "JE-2025-0304" },
};

function build() {
  const history = {};
  const jes = [];

  for (const [id, plan] of Object.entries(PLAN)) {
    const bill = BILLS.find((b) => b.id === id);
    const seed = PARTIAL_SEED[id];
    if (!bill || !seed) continue;

    // What this payment cleared is whatever the seeded balance says is gone —
    // BillsContext derives the same number from remainingShare, so the rows and
    // the ledger cannot disagree about how much has been paid.
    const remaining = Math.round(bill.total * seed.remainingShare);
    const cleared = bill.total - remaining;
    if (cleared <= 0) continue;

    const breakdown = defaultBreakdown(
      { remaining: cleared, pph23: bill.pph23 },
      { method: plan.method, sourceAccountId: plan.sourceAccountId, giroNumber: plan.giroNumber || "" },
    );

    history[id] = [{ at: plan.at, by: plan.by, breakdown, cleared, je_number: plan.je }];

    const { lines } = paymentJournalLines(breakdown, { vendorName: bill.vendorName });
    jes.push({
      je_number: plan.je,
      je_date: plan.at,
      status: "posted",
      memo: `Payment — ${bill.vendorName}${bill.invNo ? ` · ${bill.invNo}` : ""}`,
      reference_type: "payment",
      reference_id: id,
      created_by: plan.by,
      created_date: plan.at,
      posted_by: plan.by,
      posted_date: plan.at,
      lines: lines.map((l) => ({
        account_code: l.account_code,
        account_name: l.account_name,
        debit: l.side === "DR" ? l.amount : 0,
        credit: l.side === "CR" ? l.amount : 0,
        description: l.description,
      })),
    });
  }

  return { history, jes };
}

const built = build();

// { billId: [{ at, by, breakdown, cleared, je_number }] }
export const PAYMENT_HISTORY_SEED = built.history;

// The journal entries those payments wrote, for the ledger to load alongside
// its own seed. Without them the Payment tab would link each line to an entry
// that does not exist.
export const PAYMENT_HISTORY_JES = built.jes;
