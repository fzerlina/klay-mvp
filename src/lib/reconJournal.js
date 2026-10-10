// The journal entries a reconciliation drafts.
//
// Reconciliation is two steps: match, then post. Matching never posts. A line
// either needs no journal — it matched a payment or journal already in the
// books — or it drafts one, which somebody allowed to post to the ledger
// (gl.post) posts from Review & post journals. Two sources of drafts:
//
//   bank-only     a fee or interest the bank charged or paid; drafted when the
//                 statement loads, before anybody matches anything
//   from a match  a customer receipt matched to its invoice (the cash, and any
//                 PPh 23 the customer withheld), and any difference the person
//                 chose to book instead of leaving open
//
// Nothing here posts on its own.
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
export const ACCT_AR = "1-2100";
export const ACCT_INTEREST_TAX = "8-1300";
export const ACCT_PPH23_PREPAID = "1-5500";

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
export const isInterestTax = (exception) => exception.detector === "INTEREST_TAX";

// The entry Klay proposes for a fee or interest line. `lines[0]` is always the
// bank line: it is what the bank printed, so the editor keeps it fixed.
export function draftEntry({ exception, account }) {
  const bank = bankLineFor(account);
  const amount = Math.abs(exception.amount);
  const interest = isInterest(exception);
  const tax = isInterestTax(exception);
  const other = interest
    ? { account_code: ACCT_INTEREST_INCOME, account_name: nameOf(ACCT_INTEREST_INCOME) }
    : tax
      ? { account_code: ACCT_INTEREST_TAX, account_name: nameOf(ACCT_INTEREST_TAX) }
      : { account_code: ACCT_BANK_FEE, account_name: nameOf(ACCT_BANK_FEE) };
  const kind = interest ? "Bank interest" : tax ? "Tax on interest" : "Bank fee";

  // Interest arrives, so the bank is debited and income credited. A fee leaves,
  // so the expense is debited and the bank credited.
  return {
    je_date: exception.date,
    memo: `${kind} — ${account.name} statement`,
    lines: interest
      ? [
          { ...bank, debit: amount, credit: 0, description: `Interest credited — ${exception.description}` },
          { ...other, debit: 0, credit: amount, description: "Bank interest income" },
        ]
      : [
          { ...bank, debit: 0, credit: amount, description: `Charged to ${account.name}` },
          { ...other, debit: amount, credit: 0, description: `${kind} — ${exception.description}` },
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
  `${isInterest(exception) ? "Interest" : isInterestTax(exception) ? "Tax on interest" : "Bank fee"} journal ${jeNumber} posted by ${by}.`;

// The draft a match produces, or null when the match needs no journal.
//
//   receipts  [{ invoiceId, customerName, cash, withheld }] — cash is what the
//             bank line paid toward the invoice; withheld is the PPh 23 the
//             customer kept back on an invoice paid in full (Dr 1-5500)
//   diff      { accountCode, amount } — a difference the person chose to book;
//             amount is signed like the statement: negative, the bank took more
//             (Dr the account, Cr bank); positive, more arrived (Dr bank, Cr it)
//
// lines[0] is the bank line — the part of the statement this entry explains.
export function matchEntry({ account, date, description, refs, receipts = [], diff = null }) {
  if (!receipts.length && !diff) return null;
  const bank = bankLineFor(account);
  const net = receipts.reduce((s, r) => s + r.cash, 0) + (diff?.amount || 0);
  const lines = [{ ...bank, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, description: `Statement — ${description}` }];
  for (const r of receipts) {
    if (r.withheld > 0) {
      lines.push({ account_code: ACCT_PPH23_PREPAID, account_name: nameOf(ACCT_PPH23_PREPAID), debit: r.withheld, credit: 0, description: `PPh 23 withheld by ${r.customerName} on ${r.invoiceId}` });
    }
    lines.push({ account_code: ACCT_AR, account_name: nameOf(ACCT_AR), debit: 0, credit: r.cash + r.withheld, description: `Receipt — ${r.invoiceId} · ${r.customerName}` });
  }
  if (diff) {
    const amt = Math.abs(diff.amount);
    lines.push({ account_code: diff.accountCode, account_name: nameOf(diff.accountCode), debit: diff.amount < 0 ? amt : 0, credit: diff.amount > 0 ? amt : 0, description: `Difference against ${refs}` });
  }
  const memo = receipts.length && diff ? "Customer receipt and difference" : receipts.length ? "Customer receipt" : "Reconciliation difference";
  return { je_date: date, memo: `${memo} — ${account.name} statement`, lines, bankAmount: net };
}
