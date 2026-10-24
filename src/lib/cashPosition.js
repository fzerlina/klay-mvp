// Cash position — what the company holds in its own bank and cash accounts,
// per account, in the books, on a given day.
//
// The figure is the BOOK balance, read the same way Bank Reconciliation reads
// it (lib/bankBalance.js): the account's opening balance plus every cash
// movement the ledger attributes to that account (lib/bankLedger.js — posted
// journals, recorded payments, the operating accounts' everyday volume). It is
// deliberately not the GL report's balance: the demo chart carries two codes
// for some banks (1-1500 and 11110 "Bank IDR"), and journals posted from Bank
// Reconciliation (fees, interest) land on 11110, which names no one account —
// so those are not in these figures until the two codes are one.
//
// `openingBalance` on the account master is the balance at the start of the
// current statement month (the last statement's close — see bankStatement.js,
// which derives earlier months backwards from it the same way). So:
//
//   as of a date in/after that month   opening + movements from the 1st to the date
//   as of an earlier date              opening − movements after the date, up to
//                                      the day before the month began
//
// Fallback: an account the ledger can't attribute movements to (no GL code
// configured and no "Bank — {name}" account in the chart — BCA Petty Cash and
// BCA Restricted in the seed) shows its opening balance unchanged, flagged
// `source: "opening"` so the page can say so, rather than a guessed figure.
//
// Foreign-currency accounts: the master and the ledger carry them in IDR at
// book value (no revaluation in the prototype), so they add into the IDR total
// as-is and are labelled "IDR equivalent".

import { COMPANY_BANK_ACCOUNTS, maskOf } from "../data/seed/bankAccounts";
import { bookRecords, glCodeForAccount } from "./bankLedger";
import { addDays } from "./clock";
import { todayIso } from "./reportPeriods";

export const GROUP_LABEL = {
  operating: "Operating",
  payroll:   "Payroll",
  petty:     "Petty cash",
  fx:        "Foreign currency",
  tax:       "Tax account",
  deposit:   "Time deposit",
};

// Money that is in the company's name but can't pay a vendor tomorrow: a time
// deposit until it matures, a restricted account, and the tax account (held
// for the month's tax deposits). Same line accountsForMethod() draws for
// deposits when offering payment sources.
const UNAVAILABLE_GROUPS = new Set(["deposit", "tax"]);

function availabilityOf(account) {
  if (/restricted/i.test(account.name)) return { available: false, reason: "Restricted" };
  if (UNAVAILABLE_GROUPS.has(account.group)) return { available: false, reason: GROUP_LABEL[account.group] };
  return { available: true, reason: null };
}

// The first day of the month the opening balance stands at.
const openingDateOf = (account) => account.statementFrom || `${todayIso().slice(0, 7)}-01`;

// `asOf` is ISO (YYYY-MM-DD). `extraPayments` is PaymentsContext's history map,
// so payments recorded this session count (it replaces the seed — bankLedger.js
// explains why).
export function buildCashPosition(asOf = todayIso(), { extraPayments = null, accounts = COMPANY_BANK_ACCOUNTS } = {}) {
  const records = bookRecords({ extraPayments });
  const byAccount = new Map();
  for (const r of records) {
    if (!byAccount.has(r.accountId)) byAccount.set(r.accountId, []);
    byAccount.get(r.accountId).push(r);
  }

  const rows = accounts.filter((a) => a.active).map((a) => {
    const opening = a.openingBalance || 0;
    const openedOn = openingDateOf(a);
    const mine = byAccount.get(a.id) || [];
    const linked = !!glCodeForAccount(a.id);

    let movement = 0;
    if (asOf >= openedOn) {
      for (const r of mine) if (r.date >= openedOn && r.date <= asOf) movement += r.amount;
    } else {
      const before = addDays(openedOn, -1);
      for (const r of mine) if (r.date > asOf && r.date <= before) movement -= r.amount;
    }

    return {
      id: a.id,
      name: a.name,
      bank: a.bank,
      bankColor: a.bankColor,
      mask: maskOf(a),
      currency: a.currency || "IDR",
      group: a.group,
      groupLabel: GROUP_LABEL[a.group] || a.group,
      glAccount: a.glAccount,
      ...availabilityOf(a),
      balance: opening + movement,
      // "ledger" = opening + attributed movements; "opening" = nothing in the
      // ledger maps to this account, so the master's opening figure stands.
      source: linked ? "ledger" : "opening",
    };
  });

  const sum = (list) => list.reduce((s, r) => s + r.balance, 0);
  const available = rows.filter((r) => r.available);
  const unavailable = rows.filter((r) => !r.available);
  return {
    asOf,
    accounts: rows,
    available: { accounts: available, total: sum(available) },
    unavailable: { accounts: unavailable, total: sum(unavailable) },
    total: sum(rows),
  };
}
