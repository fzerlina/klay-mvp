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
//   accountBalanceAsOf   One account's balance at the end of a given day.
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
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";

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

// A balance with debits positive and credits negative — the "Net" layout's
// sign, whatever the account's normal side. Across the whole chart it sums to
// zero when the ledger balances.
export const drPositive = (acct, normalSigned) => (isDebitNormal(acct) ? normalSigned : -normalSigned);

// `lineFilter(je, line)` keeps only the lines it returns true for — a
// dimension filter. A filtered run leaves out the seeded opening balances
// (they carry no tags), so it shows only what was tagged and needn't balance.
export function computeTrialBalance({ from, to, entries, fiscalYearStart = 1, lineFilter = null }) {
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
      if (lineFilter && !lineFilter(je, line)) return;
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
    const rolled = acct.code === DEFAULT_ACCOUNTS.retainedEarnings ? rolledPl : 0;
    const seeded = lineFilter ? 0 : (SEED_OPENING[acct.code] || 0);
    const opening = r2(seeded + a.pre + rolled);
    const closing = r2(opening + oriented(acct, a.perDr, a.perCr));
    const isZero = opening === 0 && closing === 0 && a.perDr === 0 && a.perCr === 0;
    const openSides = endingSides(acct, opening);
    return {
      code: acct.code,
      name: acct.name,
      type: acct.type,
      fs: acct.fs,
      section: acct.section,
      parent: acct.parent,
      normal_balance: acct.normal_balance,
      is_active: acct.is_active,
      opening_balance: opening,
      opening_dr: openSides.ending_dr,
      opening_cr: openSides.ending_cr,
      opening_net: r2(drPositive(acct, opening)),
      period_debit: r2(a.perDr),
      period_credit: r2(a.perCr),
      // The period's movement on the account's normal side (+ grows it).
      movement: r2(oriented(acct, a.perDr, a.perCr)),
      closing_balance: closing,
      closing_net: r2(drPositive(acct, closing)),
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

// The footing a reviewer checks before trusting a TB, each on its own:
//   opening   opening balances foot (Dr = Cr) — breaks on a bad migration
//   period    the period's debits equal its credits — breaks on a one-sided post
//   ending    ending balances foot — the headline check
//   pl        the TB's P&L movement for the range equals Profit & Loss's net
//             profit (a different code path over the same journals)
// `netProfit` is netProfitForPeriod(...).netProfit for the same range.
export function tieOut(rows, { netProfit }) {
  let oDr = 0, oCr = 0, pDr = 0, pCr = 0, eDr = 0, eCr = 0, plNet = 0;
  rows.forEach((r) => {
    oDr += r.opening_dr; oCr += r.opening_cr;
    pDr += r.period_debit; pCr += r.period_credit;
    eDr += r.ending_dr; eCr += r.ending_cr;
    if (r.fs === "PL") plNet += r.period_credit - r.period_debit;
  });
  const check = (key, label, a, b, aLbl, bLbl) => {
    const diff = r2(Math.abs(a - b));
    return { key, label, ok: diff < 1, diff, a: r2(a), b: r2(b), aLbl, bLbl };
  };
  return [
    check("opening", "Opening balances foot", oDr, oCr, "Opening Dr", "Opening Cr"),
    check("period", "Period debits = credits", pDr, pCr, "Period Dr", "Period Cr"),
    check("ending", "Ending balances foot", eDr, eCr, "Ending Dr", "Ending Cr"),
    check("pl", "Ties to Profit & Loss", plNet, netProfit, "TB net result", "P&L net profit"),
  ];
}

// The chart's own hierarchy (seed/coa.js group nodes) as a tree over the given
// rows, keeping their order: [{ id, label, level, groups, rows }], dropping
// groups with nothing to show. An account whose parent isn't a known group sits
// in an "Other accounts" group at the root.
export function coaTree(rows) {
  const groups = new Map();
  COA.filter((n) => n.type === "group").forEach((g) => {
    groups.set(g.id, { id: g.id, label: g.label, level: g.level, parent: g.parent || null, groups: [], rows: [] });
  });
  const other = { id: "g-other", label: "Other accounts", level: 0, parent: null, groups: [], rows: [] };
  rows.forEach((r) => (groups.get(r.parent) || other).rows.push(r));
  // Wire children in chart order, then prune empty branches bottom-up.
  const roots = [];
  groups.forEach((g) => (g.parent && groups.get(g.parent) ? groups.get(g.parent).groups.push(g) : roots.push(g)));
  const prune = (g) => { g.groups = g.groups.filter(prune); return g.rows.length > 0 || g.groups.length > 0; };
  const out = roots.filter(prune);
  if (other.rows.length) out.push(other);
  return out;
}

// One account's ledger balance at the end of a day, on its normal side: the
// seeded opening balance plus every posted line dated on or before it. What
// the Cash Position report compares each aging total against.
export function accountBalanceAsOf(code, asOf, entries) {
  const acct = COA_BY_CODE[code];
  if (!acct) return 0;
  let bal = SEED_OPENING[code] || 0;
  for (const je of entries) {
    if (je.status !== "posted" || je.je_date > asOf) continue;
    for (const line of je.lines || []) {
      if (line.account_code === code) bal += oriented(acct, line.debit || 0, line.credit || 0);
    }
  }
  return r2(bal);
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
