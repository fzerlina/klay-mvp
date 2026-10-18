// Trial Balance — the numbers behind Reports → Trial Balance.
//
//   computeTrialBalance  One row per account in the chart: opening balance,
//                        the period's debits and credits, and the closing
//                        balance — signed on the account's normal side and
//                        split into Ending Dr / Ending Cr, so the two ending
//                        columns foot to the same total when the ledger
//                        balances. Built from POSTED journals only, plus the
//                        seeded opening balances.
//   netProfitForPeriod   Net profit over [from, to]: across every P&L account
//                        (fs 'PL'), period credits less period debits.
//                        Revenue is the same sum over the Revenue / Other
//                        Revenue sections (contra-revenue nets it down);
//                        expenses are the rest, negated. Profit & Loss uses
//                        the same rule, so the two reports agree.
//   ledgerBalance        Ending Dr vs Ending Cr totals and the difference.
//   unpostedInPeriod     Drafts and journals awaiting approval dated in the
//                        period — not in the numbers, but worth saying so.
//   periodCloseState     Whether the period is closed, open or partly closed.
//
// P&L accounts start each fiscal year at zero: anything they carried from an
// earlier fiscal year is rolled into Retained Earnings' opening balance, the
// way a year-end close would. Totals don't change, but an expense account
// reads "this fiscal year" rather than "since the books began" — and matches
// Profit & Loss for a year-to-date period.

import { COA, COA_BY_CODE } from "../data/seed/coa";
import { OPENING_BALANCES } from "../data/seed/openingBalances";

const RETAINED_EARNINGS = "3-1300";
const REVENUE_SECTIONS = new Set(["Revenue", "Other Revenue"]);

const pad = (n) => String(n).padStart(2, "0");
// Rupiah to the sen — keeps float noise out of "is it zero?" checks.
const r2 = (v) => Math.round(v * 100) / 100;

const ACCOUNTS = COA.filter((n) => n.code);
const isDebitNormal = (acct) => acct.normal_balance === "debit";
// A movement signed on the account's normal side: positive grows the balance.
const oriented = (acct, debit, credit) => (isDebitNormal(acct) ? debit - credit : credit - debit);

// First day of the fiscal year containing an ISO date. fyStartMonth is 1-12.
export function fiscalYearStartFor(iso, fyStartMonth = 1) {
  const [y, m] = iso.split("-").map(Number);
  return `${m >= fyStartMonth ? y : y - 1}-${pad(fyStartMonth)}-01`;
}

// Seeded opening balances (seed/openingBalances.js), on each account's normal side.
const SEED_OPENING = OPENING_BALANCES.reduce((m, r) => {
  const acct = COA_BY_CODE[r.account_code];
  if (!acct) return m;
  m[r.account_code] = (m[r.account_code] || 0) + oriented(acct, r.debit, r.credit);
  return m;
}, {});

// Ending balance split onto its natural side. A debit-normal account with a
// positive balance is an Ending Dr; one that has gone negative shows as an
// Ending Cr (and the reverse for credit-normal accounts).
export function endingSides(acct, closing) {
  const c = r2(closing);
  if (c === 0) return { ending_dr: 0, ending_cr: 0 };
  const onDebit = isDebitNormal(acct) ? c > 0 : c < 0;
  return onDebit ? { ending_dr: Math.abs(c), ending_cr: 0 } : { ending_dr: 0, ending_cr: Math.abs(c) };
}

export function computeTrialBalance({ from, to, entries, fiscalYearStart = 1 }) {
  const fyStart = fiscalYearStartFor(from, fiscalYearStart);
  const acc = {};
  ACCOUNTS.forEach((a) => { acc[a.code] = { pre: 0, perDr: 0, perCr: 0, lines: [] }; });
  let rolledPl = 0; // prior fiscal years' profit, credit-positive

  for (const je of entries) {
    if (je.status !== "posted" || je.je_date > to) continue;
    (je.lines || []).forEach((line, i) => {
      const acct = COA_BY_CODE[line.account_code];
      const a = acc[line.account_code];
      if (!acct || !a) return;
      const dr = line.debit || 0;
      const cr = line.credit || 0;
      if (je.je_date < from) {
        if (acct.fs === "PL" && je.je_date < fyStart) rolledPl += cr - dr;
        else a.pre += oriented(acct, dr, cr);
        return;
      }
      a.perDr += dr;
      a.perCr += cr;
      a.lines.push({
        key: `${je.je_number}:${i}`,
        je_ref: je.je_number,
        date: je.je_date,
        debit: dr,
        credit: cr,
        description: line.description,
        memo: je.memo,
        posted_by: je.posted_by,
        posted_date: je.posted_date,
      });
    });
  }

  return ACCOUNTS.map((acct) => {
    const a = acc[acct.code];
    const rolled = acct.code === RETAINED_EARNINGS ? rolledPl : 0;
    const opening = r2((SEED_OPENING[acct.code] || 0) + a.pre + rolled);
    const closing = r2(opening + oriented(acct, a.perDr, a.perCr));
    const isZero = opening === 0 && closing === 0 && a.perDr === 0 && a.perCr === 0;
    return {
      code: acct.code,
      name: acct.name,
      type: acct.type,
      fs: acct.fs,
      section: acct.section,
      normal_balance: acct.normal_balance,
      is_active: acct.is_active,
      opening_balance: opening,
      period_debit: r2(a.perDr),
      period_credit: r2(a.perCr),
      closing_balance: closing,
      ...endingSides(acct, closing),
      rolled_pl: r2(rolled),
      entries: a.lines.sort((x, y) => x.date.localeCompare(y.date) || x.je_ref.localeCompare(y.je_ref)),
      has_activity: !isZero,
    };
  });
}

// Totals of the ending columns across the given rows.
export function ledgerBalance(rows) {
  let dr = 0, cr = 0;
  rows.forEach((r) => { dr += r.ending_dr; cr += r.ending_cr; });
  dr = r2(dr); cr = r2(cr);
  const variance = r2(Math.abs(dr - cr));
  return { dr, cr, variance, balanced: variance < 1 };
}

export function netProfitForPeriod({ from, to, entries }) {
  let revenue = 0, net = 0;
  for (const je of entries) {
    if (je.status !== "posted" || je.je_date < from || je.je_date > to) continue;
    for (const line of je.lines || []) {
      const acct = COA_BY_CODE[line.account_code];
      if (!acct || acct.fs !== "PL") continue;
      const v = (line.credit || 0) - (line.debit || 0);
      net += v;
      if (REVENUE_SECTIONS.has(acct.section)) revenue += v;
    }
  }
  return { revenue: r2(revenue), expenses: r2(revenue - net), netProfit: r2(net) };
}

// Journals dated in the period that the report leaves out because they
// aren't posted yet. Voided entries never will be, so they aren't counted.
export function unpostedInPeriod(entries, from, to) {
  let drafts = 0, pending = 0;
  for (const je of entries) {
    if (je.je_date < from || je.je_date > to) continue;
    if (je.status === "draft") drafts++;
    else if (je.status === "pending") pending++;
  }
  return { drafts, pending };
}

// closedThrough is "YYYY-MM": every month up to it is locked.
export function periodCloseState(from, to, closedThrough) {
  if (!closedThrough) return "open";
  if (to.slice(0, 7) <= closedThrough) return "closed";
  if (from.slice(0, 7) <= closedThrough) return "partial";
  return "open";
}
