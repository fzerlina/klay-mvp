// The journal entries a reconciliation is allowed to draft.
//
// Reconciliation is mostly a read: it explains the ledger against a statement
// and changes nothing. There are exactly two exceptions — a bank fee and bank
// interest. Both are real money that moved, both are known to the bank and to
// nobody else, and without this the Finance Manager keys a manual entry for a
// Rp 2.500 charge every single month.
//
// Klay drafts the entry; a person posts it, or edits it first. Nothing here
// posts on its own.
//
// The account mapping:
//
//   Bank fee        Dr 72050 Other Non-Operating Expenses
//                     Cr 11110 Bank IDR — [bank]   /  11120 Bank Foreign Currency — [currency]
//   Bank interest   Dr 11110 Bank IDR — [bank]   /  11120 Bank Foreign Currency — [currency]
//                     Cr 71010 Interest Income
//
// Entries are tagged `reference_type: "bank_reconciliation"` and carry the bank
// transaction id, so the GL can always say which statement line produced them.

import { COA } from "../data/seed/coa";

export const ACCT_BANK_FEE = "72050";
export const ACCT_INTEREST_INCOME = "71010";
export const ACCT_BANK_IDR = "11110";
export const ACCT_BANK_FX = "11120";

const nameOf = (code) => COA.find((a) => a.code === code)?.name || code;

// The master stores Mandiri as "MDR" for the card logo; the ledger line spells it out.
const BANK_NAME = { MDR: "Mandiri" };

// The bank side of an entry: IDR accounts post to 11110, foreign-currency
// accounts to 11120, each named for its bank or currency.
export function bankLineFor(account) {
  if (account.currency && account.currency !== "IDR") {
    return { account_code: ACCT_BANK_FX, account_name: `${nameOf(ACCT_BANK_FX)} — ${account.currency}` };
  }
  return { account_code: ACCT_BANK_IDR, account_name: `${nameOf(ACCT_BANK_IDR)} — ${BANK_NAME[account.bank] || account.bank}` };
}

export const isInterest = (exception) => exception.type === "KNOWN_SYSTEMATIC";

// The entry Klay proposes for a fee or interest line. `lines[0]` is always the
// bank line: it is what the bank printed, so the editor keeps it fixed.
export function draftEntry({ exception, account }) {
  const bank = bankLineFor(account);
  const amount = Math.abs(exception.amount);
  const interest = isInterest(exception);
  const other = interest
    ? { account_code: ACCT_INTEREST_INCOME, account_name: nameOf(ACCT_INTEREST_INCOME) }
    : { account_code: ACCT_BANK_FEE, account_name: nameOf(ACCT_BANK_FEE) };

  // Interest arrives, so the bank is debited and income credited. A fee leaves,
  // so the expense is debited and the bank credited.
  return {
    je_date: exception.date,
    memo: interest ? `Bank interest — ${account.name} statement` : `Bank fee — ${account.name} statement`,
    lines: interest
      ? [
          { ...bank, debit: amount, credit: 0, description: `Interest credited — ${exception.description}` },
          { ...other, debit: 0, credit: amount, description: "Bank interest income" },
        ]
      : [
          { ...bank, debit: 0, credit: amount, description: `Charged to ${account.name}` },
          { ...other, debit: amount, credit: 0, description: `Bank fee — ${exception.description}` },
        ],
  };
}

// What stops a draft from posting, or null when it can post. The bank line
// must still equal the statement line, or the line would not be reconciled.
export function draftProblem(draft, exception) {
  const lines = draft?.lines || [];
  if (lines.length < 2) return "An entry needs at least two lines.";
  if (lines.some((l) => !l.account_code)) return "Every line needs an account.";
  if (lines.some((l) => (l.debit || 0) < 0 || (l.credit || 0) < 0)) return "Amounts can't be negative.";
  if (lines.some((l) => !(l.debit || 0) && !(l.credit || 0))) return "Every line needs a debit or a credit.";
  const dr = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (dr !== cr) return "Debits and credits don't balance.";
  const bankNet = (lines[0].debit || 0) - (lines[0].credit || 0);
  if (bankNet !== exception.amount) return "The bank line has to equal the statement line.";
  return null;
}

// The posted entry. `postDate` overrides the draft's date when the month the
// line fell in is already closed: the entry goes into the first open month
// instead, the same rule late bills follow (Settings → Posting periods).
export function postedEntry({ draft, exception, jeNumber, by, today, postDate = null }) {
  return {
    je_number: jeNumber,
    je_date: postDate || draft.je_date,
    status: "posted",
    memo: draft.memo,
    reference_type: "bank_reconciliation",
    reference_id: exception.lineId,
    created_by: by,
    created_date: today,
    posted_by: by,
    posted_date: today,
    lines: draft.lines.map((l) => ({
      account_code: l.account_code,
      account_name: l.account_name || nameOf(l.account_code),
      debit: l.debit || 0,
      credit: l.credit || 0,
      description: l.description || "",
    })),
  };
}

export const postedNote = (exception, jeNumber, by) =>
  `${isInterest(exception) ? "Interest" : "Bank fee"} journal ${jeNumber} posted by ${by}.`;
