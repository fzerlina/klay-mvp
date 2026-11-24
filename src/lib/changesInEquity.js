// Statement of Changes in Equity (Laporan Perubahan Ekuitas / Perubahan
// Modal) — pure computation, no React.
//
// SAK EP / PSAK 1 layout: equity components as COLUMNS, movements as ROWS.
// One block per period: balance at the start, what moved it, balance at the
// end. The numbers come from the same places the other statements use, so
// the three agree by construction and the page can prove it:
//   • opening and closing = the Balance Sheet's equity at the day before
//     `from` and at `to` (lib/balanceSheet.js), component by component;
//   • profit/(loss) for the period = the Profit & Loss's net profit for
//     [from, to] (lib/profitLoss.js);
//   • every other movement = posted journal lines on an equity account in
//     [from, to], classified by account.
// Opening + movements − closing is the check; anything left over shows as a
// difference, never hidden.
//
// Components. Each equity account in the chart is a column, except the ones
// that are part of retained earnings and so share its column (saldo laba):
// retained earnings itself, current year earnings, any debit-normal equity
// account (dividends distributed), and the computed current-year profit the
// Balance Sheet carries. That's the column every Indonesian statement prints
// as "Saldo laba".

import { COA } from "../data/seed/coa";
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";
import { computeBalanceSheet, byAccountCode, CURRENT_YEAR_PROFIT } from "./balanceSheet";
import { computeProfitLoss } from "./profitLoss";
import { dayBefore } from "./reportPeriods";

const r2 = (v) => Math.round(v * 100) / 100 + 0;

// Bahasa names of the usual equity accounts, as a laporan perubahan ekuitas
// heads its columns. Unknown accounts keep their chart name.
const COMPONENT_ID = {
  "3-1100": "Modal saham",
  "3-1200": "Tambahan modal disetor",
};
const RE_COMPONENT = { key: "re", label: "Retained earnings", id: "Saldo laba" };

// Which column an equity account belongs to.
const foldsIntoRetained = (a) =>
  a.code === DEFAULT_ACCOUNTS.retainedEarnings || /current year earnings/i.test(a.name) || a.normal_balance === "debit";

export function equityComponents(coa = COA) {
  const accts = coa.filter((n) => n.code && n.type === "equity").sort(byAccountCode);
  const cols = accts
    .filter((a) => !foldsIntoRetained(a))
    .map((a) => ({ key: a.code, label: a.name, id: COMPONENT_ID[a.code] || a.name, codes: [a.code] }));
  const reCodes = accts.filter(foldsIntoRetained).map((a) => a.code);
  cols.push({ ...RE_COMPONENT, codes: [...reCodes, CURRENT_YEAR_PROFIT.code] });
  return cols;
}

// The movement rows, in the order SAK EP prints them. `profit` is computed;
// the rest come from postings. A row with nothing in it is left out, except
// profit, which every statement shows.
export const MOVEMENTS = [
  { key: "profit",       label: "Profit/(loss) for the period",          id: "Laba (rugi) periode berjalan" },
  { key: "issue",        label: "Issue of share capital",                id: "Setoran modal" },
  { key: "reduction",    label: "Reduction of share capital",            id: "Pengurangan modal" },
  { key: "dividends",    label: "Dividends declared",                    id: "Dividen" },
  { key: "other",        label: "Other movements in retained earnings",  id: "Penyesuaian saldo laba lainnya" },
];

// A posted line on an equity account → its movement row. By account, not by
// reading memos: paid-in capital accounts move by issue or reduction; the
// dividends account by dividends; anything posted straight to retained
// earnings (prior-period corrections, a migration's opening equity) is
// "other" — the drill shows which journals.
function classify(acct, amount) {
  if (acct.normal_balance === "debit") return "dividends";
  if (acct.code === DEFAULT_ACCOUNTS.retainedEarnings || /current year earnings/i.test(acct.name)) return "other";
  return amount >= 0 ? "issue" : "reduction";
}

// Equity by component at the end of a day, credit-positive (as the Balance
// Sheet shows it: dividends distributed in parentheses).
function equityAt(entries, date, comps, opts) {
  const bs = computeBalanceSheet(entries, date, opts);
  const out = {};
  comps.forEach((c) => { out[c.key] = r2(c.codes.reduce((s, code) => s + (bs.byCode[code] || 0), 0)); });
  out.total = r2(comps.reduce((s, c) => s + out[c.key], 0));
  return { byComp: out, bsTotal: bs.totals.totalEquity };
}

// One block: opening, movements, closing, for [from, to].
//   rows: [{ key, label, id, byComp: {compKey|total → amount}, lines: { compKey: [line] } }]
//   opening / closing: { date, byComp }
//   difference: { compKey|total → closing − opening − movements } (0 when it ties)
//   profit: the P&L's net profit for the period
//   bsTotal: the Balance Sheet's total equity at `to`
export function computeChangesInEquity(entries, { from, to }, opts = {}, coa = COA) {
  const comps = equityComponents(coa);
  const compOf = {};
  comps.forEach((c) => c.codes.forEach((code) => { compOf[code] = c.key; }));
  const acctBy = Object.fromEntries(coa.filter((n) => n.code).map((n) => [n.code, n]));

  const openDate = dayBefore(from);
  const opening = equityAt(entries, openDate, comps, opts);
  const closing = equityAt(entries, to, comps, opts);
  const profit = r2(computeProfitLoss(entries, { from, to }).totals.netProfit);

  const rows = Object.fromEntries(MOVEMENTS.map((m) => [m.key, { ...m, byComp: {}, lines: {} }]));
  const add = (row, comp, amount, line) => {
    rows[row].byComp[comp] = r2((rows[row].byComp[comp] || 0) + amount);
    if (line) (rows[row].lines[comp] ||= []).push(line);
  };
  add("profit", RE_COMPONENT.key, profit);

  for (const je of entries || []) {
    if (je.status !== "posted" || !je.je_date || je.je_date < from || je.je_date > to) continue;
    (je.lines || []).forEach((l, i) => {
      const acct = acctBy[l.account_code];
      if (!acct || acct.type !== "equity") return;
      const amount = r2((Number(l.credit) || 0) - (Number(l.debit) || 0));
      if (!amount) return;
      // The cut-over journal from the previous system is where the books
      // start, not something that happened in the period: it joins the
      // opening balance (benchmark §6).
      if (je.is_opening) {
        const k = compOf[acct.code] || RE_COMPONENT.key;
        opening.byComp[k] = r2(opening.byComp[k] + amount);
        opening.byComp.total = r2(opening.byComp.total + amount);
        return;
      }
      add(classify(acct, amount), compOf[acct.code] || RE_COMPONENT.key, amount, {
        key: `${je.je_number}-${i}`, date: je.je_date, je_number: je.je_number, source: je.reference_type === "manual" || !je.reference_type ? "manual" : je.reference_type,
        party: "", desc: [acct.code, l.description || je.memo].filter(Boolean).join(" · "), amount,
      });
    });
  }

  const list = MOVEMENTS.map((m) => rows[m.key])
    .filter((r) => r.key === "profit" || Object.values(r.byComp).some((v) => Math.abs(v) >= 0.005));
  list.forEach((r) => { r.byComp.total = r2(comps.reduce((s, c) => s + (r.byComp[c.key] || 0), 0)); });

  const difference = {};
  [...comps.map((c) => c.key), "total"].forEach((k) => {
    const moved = list.reduce((s, r) => s + (r.byComp[k] || 0), 0);
    difference[k] = r2(closing.byComp[k] - opening.byComp[k] - moved);
  });
  const ties = Object.values(difference).every((v) => Math.abs(v) < 0.5);

  return {
    from, to, comps,
    opening: { date: openDate, byComp: opening.byComp },
    closing: { date: to, byComp: closing.byComp },
    rows: list, profit, difference, ties,
    bsTotal: closing.bsTotal,
    bsTies: Math.abs(closing.bsTotal - closing.byComp.total) < 0.5,
  };
}

// ── Account view (the SME's current tool, Mekari Jurnal) ─────────────────────
// Equity accounts by code: Permulaan (opening) · Debit · Kredit · Saldo akhir,
// a Total and the net movement (Pergerakan) — what Fidya sent on 23 Nov and
// what accountants check against the Trial Balance. Two things a plain
// account list would get wrong, handled so the total still ties to the
// Balance Sheet:
//   • Current year profit/(loss) has no account (Klay doesn't post a closing
//     journal), so it's a computed row: the P&L for the period on its debit
//     or credit side.
//   • When the period crosses a fiscal year-end, the year's profit rolls into
//     retained earnings: shown as a debit on the profit row and a credit on
//     retained earnings (`roll`), as a closing journal would.
// Each row: opening + credit − debit = closing (credit-positive, as the
// Balance Sheet shows equity; dividends distributed sit in parentheses).
export function computeEquityAccounts(entries, { from, to }, opts = {}, coa = COA) {
  const openDate = dayBefore(from);
  const bsOpen = computeBalanceSheet(entries, openDate, opts);
  const bsClose = computeBalanceSheet(entries, to, opts);
  const accts = coa.filter((n) => n.code && n.type === "equity").sort(byAccountCode);
  const dr = {}, cr = {}, lines = {};
  for (const je of entries || []) {
    if (je.status !== "posted" || !je.je_date || je.je_date < from || je.je_date > to) continue;
    (je.lines || []).forEach((l, i) => {
      if (!accts.some((a) => a.code === l.account_code)) return;
      const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      dr[l.account_code] = (dr[l.account_code] || 0) + d;
      cr[l.account_code] = (cr[l.account_code] || 0) + c;
      (lines[l.account_code] ||= []).push({
        key: `${je.je_number}-${i}`, date: je.je_date, je_number: je.je_number,
        source: !je.reference_type || je.reference_type === "manual" ? "manual" : je.reference_type,
        party: "", desc: l.description || je.memo || "", amount: r2(c - d),
      });
    });
  }
  const roll = r2(bsClose.rolledProfit - bsOpen.rolledProfit);
  const profit = r2(computeProfitLoss(entries, { from, to }).totals.netProfit);
  const side = (v) => (v >= 0 ? { debit: 0, credit: v } : { debit: -v, credit: 0 });

  const rows = accts.map((a) => {
    const isRe = a.code === DEFAULT_ACCOUNTS.retainedEarnings;
    const rollIn = isRe ? side(roll) : { debit: 0, credit: 0 };
    return {
      code: a.code, name: a.name, idName: COMPONENT_ID[a.code] || a.name,
      opening: r2(bsOpen.byCode[a.code] || 0),
      debit: r2((dr[a.code] || 0) + rollIn.debit),
      credit: r2((cr[a.code] || 0) + rollIn.credit),
      closing: r2(bsClose.byCode[a.code] || 0),
      roll: isRe ? roll : 0,
      lines: lines[a.code] || [],
    };
  });
  const p = side(profit), rOut = side(-roll);
  rows.push({
    code: CURRENT_YEAR_PROFIT.code, name: CURRENT_YEAR_PROFIT.name, idName: CURRENT_YEAR_PROFIT.id, computed: true,
    opening: r2(bsOpen.byCode[CURRENT_YEAR_PROFIT.code] || 0),
    debit: r2(p.debit + rOut.debit), credit: r2(p.credit + rOut.credit),
    closing: r2(bsClose.byCode[CURRENT_YEAR_PROFIT.code] || 0),
    profit, roll, lines: [],
  });
  rows.forEach((x) => { x.difference = r2(x.closing - x.opening - x.credit + x.debit); });
  const sum = (k) => r2(rows.reduce((s, x) => s + x[k], 0));
  const totals = { opening: sum("opening"), debit: sum("debit"), credit: sum("credit"), closing: sum("closing") };
  return {
    from, to, openDate, rows, totals,
    movement: r2(totals.closing - totals.opening),
    ties: rows.every((x) => Math.abs(x.difference) < 0.5),
    bsTotal: bsClose.totals.totalEquity,
    bsTies: Math.abs(bsClose.totals.totalEquity - totals.closing) < 0.5,
    profit, roll,
  };
}
