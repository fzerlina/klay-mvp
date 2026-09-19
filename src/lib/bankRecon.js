// The bank-reconciliation axis.
//
// This is a THIRD axis, independent of the two in paymentStage.js:
//
//   Payment status   how much of the bill is paid off   (derived from the ledger)
//   Request status   where the payment request sits     (stored in PaymentsContext)
//   Recon status     has the bank confirmed the money moved
//
// It is deliberately NOT a stage either of the other two can reach. "Paid"
// means our payable is relieved; it says nothing about whether the cash has
// shown up on a statement. A payment can be paid-in-full and unreconciled for
// weeks, and a reconciled payment can still leave a partial balance behind.
// That is why the vocabulary note in paymentStage.js reserves "settled" — this
// axis is where that confirmation lives, and it carries its own two words.
//
// MVP derivation: a payment is reconciled when the loaded statement for the
// account it was paid from covers the date it was recorded. Reconciliation is
// a run someone performs against a statement, so anything recorded past the
// statement's cut-off has not been looked at yet, by definition. A real
// implementation matches an individual bank line to an individual payment and
// stores that match; this reads coverage instead, and every "not yet" says
// which cut-off it fell outside so the answer can be checked rather than
// trusted.

import { bankAccountById, statementLabelOf } from "../data/seed/bankAccounts";

export const RECON_META = {
  reconciled: { key: "reconciled", label: "Reconciled", tone: "success" },
  pending:    { key: "pending",    label: "Not yet reconciled", tone: "muted" },
};

// `at` is the date the payment was recorded; `breakdown` is its typed split.
export function reconOf({ at, breakdown } = {}) {
  const out = (key, why) => ({ ...RECON_META[key], why });

  if (!breakdown) {
    // A seeded payment with no breakdown behind it — there is no account to
    // check coverage against, so claiming either answer would be invention.
    return out("pending", "No payment record behind this line to match against a statement.");
  }

  const account = bankAccountById(breakdown.sourceAccountId);
  if (!account) return out("pending", "No source account recorded on this payment.");

  // A giro is a post-dated cheque: the bill is relieved when it is handed over,
  // but the bank line only appears on the day it clears. It cannot be on a
  // statement that predates its own clearing, whatever the coverage says.
  if (breakdown.method === "giro") {
    return out("pending", `Giro ${breakdown.giroNumber || ""} reaches the statement when it clears, not when it was recorded.`.replace("  ", " "));
  }

  const label = statementLabelOf(account);
  if (!account.statementThrough) {
    return out("pending", `${account.name} has no statement loaded.`);
  }
  if (at && at <= account.statementThrough) {
    return out("reconciled", `Matched against the ${account.name} statement, ${label}.`);
  }
  return out("pending", `The ${account.name} statement covers ${label} — this payment falls after it.`);
}
