// The journal entries a reconciliation is allowed to write.
//
// Reconciliation is mostly a read: it explains the ledger against a statement
// and changes nothing. There are exactly two exceptions, and they are the two
// the PRD names — a bank fee and bank interest. Both are real money that moved,
// both are known to the bank and to nobody else, and without this the Finance
// Manager keys a manual entry for a Rp 2.500 charge every single month.
//
// Deliberately narrow. This module can post to Bank Charges and to Interest
// Income and nowhere else; anything else a Finance Manager decides to write off
// goes through the ordinary journal screen, where it is reviewed like any other
// entry. A reconciliation that can post anywhere is a reconciliation that can
// make the books agree with the bank by fiat, which is the one thing it must
// never be able to do.
//
// Entries are tagged `reference_type: "bank_reconciliation"` and carry the bank
// transaction id, so the GL can always say which statement line produced them.

import { COA } from "../data/seed/coa";
import { glCodeForAccount } from "./bankLedger";

const ACCT_BANK_CHARGES = "6-3000";
const ACCT_INTEREST_INCOME = "4-2100";

const nameOf = (code) => COA.find((a) => a.code === code)?.name || code;

// The bank side of the entry. An account with no GL mapping cannot be posted
// to, so the caller is told rather than defaulted somewhere plausible — the
// same discipline paymentJournal.js applies to an unmapped source account.
function bankLineFor(accountId) {
  const code = glCodeForAccount(accountId);
  if (!code) return null;
  return { account_code: code, account_name: nameOf(code) };
}

export function writeOffEntry({ exception, account, jeNumber, by, today }) {
  const bank = bankLineFor(account.id);
  if (!bank) {
    return { error: `${account.name} has no GL account mapped in Settings → Bank Accounts, so there is nowhere to post this write-off.` };
  }

  const isInterest = exception.type === "KNOWN_SYSTEMATIC";
  const amount = Math.abs(exception.amount);
  const other = isInterest
    ? { account_code: ACCT_INTEREST_INCOME, account_name: nameOf(ACCT_INTEREST_INCOME) }
    : { account_code: ACCT_BANK_CHARGES, account_name: nameOf(ACCT_BANK_CHARGES) };

  // Interest arrives, so the bank is debited and income credited. A fee leaves,
  // so the expense is debited and the bank credited. Both balance by
  // construction — there is one amount and it appears on each side once.
  const lines = isInterest
    ? [
        { ...bank, debit: amount, credit: 0, description: `Interest credited — ${exception.description}` },
        { ...other, debit: 0, credit: amount, description: "Bank interest income" },
      ]
    : [
        { ...other, debit: amount, credit: 0, description: `Bank charge — ${exception.description}` },
        { ...bank, debit: 0, credit: amount, description: `Charged to ${account.name}` },
      ];

  return {
    je: {
      je_number: jeNumber,
      je_date: exception.date,
      status: "posted",
      memo: isInterest
        ? `Bank interest — ${account.name} statement`
        : `Bank charge — ${account.name} statement`,
      reference_type: "bank_reconciliation",
      reference_id: exception.lineId,
      created_by: by,
      created_date: today,
      posted_by: by,
      posted_date: today,
      lines,
    },
  };
}

// What the row should say once it is written off, in the same voice as every
// other explanation on the page: what happened, where it went, and the entry
// that proves it.
export const writeOffNote = (exception, jeNumber) =>
  exception.type === "KNOWN_SYSTEMATIC"
    ? `Posted to ${nameOf(ACCT_INTEREST_INCOME)} as ${jeNumber}.`
    : `Written off to ${nameOf(ACCT_BANK_CHARGES)} as ${jeNumber}.`;
