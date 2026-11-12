// Balance Sheet — pure computation, no React.
//
// A statement of financial position at the end of one day (`asOf`), built from
// the chart's own tree (seed/coa.js): Assets → Current / Non-current → groups
// → accounts; Liabilities → Current / Non-current; Equity. The order is the
// SAK EP / Indonesian one (aset lancar first, liquidity order), the same order
// the chart already keeps.
//
// Sign convention. Every balance is shown on its side of the statement:
// asset accounts debit-positive, liability and equity accounts credit-positive.
// A contra account (accumulated depreciation, allowance for doubtful accounts)
// or a debit equity account (dividends distributed) therefore shows in
// parentheses and nets its group down, as an Indonesian statement prints it.
//
// Equity carries two lines the ledger has no posting for:
//   • Retained earnings takes every earlier fiscal year's profit, as a year-end
//     close would — the Trial Balance rolls it the same way, so the two agree.
//   • Current year profit/(loss) (laba tahun berjalan) is the P&L from the
//     start of the fiscal year to `asOf`, computed, not posted. It equals the
//     Profit & Loss's net profit for year to date — the tie-out the page shows.
// Total assets − total liabilities and equity is the balance check; any
// difference is a ledger problem, never hidden.
//
// Options:
//   lineFilter   (je, line) => boolean — e.g. a dimension filter. A filtered
//                run leaves out the seeded opening balances (they carry no
//                tags), so it shows only what was tagged and needn't balance.

import { COA, COA_BY_CODE } from "../data/seed/coa";
import { OPENING_BALANCES } from "../data/seed/openingBalances";
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";

const r2 = (v) => Math.round(v * 100) / 100 + 0;
const pad = (n) => String(n).padStart(2, "0");

export function fiscalYearStartFor(iso, fyStartMonth = 1) {
  const [y, m] = iso.split("-").map(Number);
  return `${m >= fyStartMonth ? y : y - 1}-${pad(fyStartMonth)}-01`;
}

// Bahasa Indonesia names for the chart's groups (print and Excel), in the
// words a laporan posisi keuangan uses under SAK EP.
const GROUP_ID = {
  "g-asset": "Aset",
  "g-current-asset": "Aset lancar",
  "g-cash": "Kas dan setara kas",
  "g-ar": "Piutang usaha",
  "g-inventory": "Persediaan",
  "g-prepaid": "Biaya dibayar di muka",
  "g-other-current": "Aset lancar lainnya",
  "g-non-current-asset": "Aset tidak lancar",
  "g-ppe": "Aset tetap",
  "g-intangible": "Aset takberwujud",
  "g-other-nc": "Aset tidak lancar lainnya",
  "g-liab": "Liabilitas",
  "g-current-liab": "Liabilitas jangka pendek",
  "g-trade-payable": "Utang usaha dan utang lain-lain",
  "g-tax-payable": "Utang pajak",
  "g-short-debt": "Pinjaman jangka pendek",
  "g-other-current-liab": "Liabilitas jangka pendek lainnya",
  "g-nc-liab": "Liabilitas jangka panjang",
  "g-equity": "Ekuitas",
};
export const groupIdLabel = (id, fallback) => GROUP_ID[id] || fallback;

// The three sides of the statement and the chart group each starts from.
export const BS_SIDES = [
  { key: "assets",      root: "g-asset",  label: "Assets",      id: "Aset",        debitSide: true },
  { key: "liabilities", root: "g-liab",   label: "Liabilities", id: "Liabilitas",  debitSide: false },
  { key: "equity",      root: "g-equity", label: "Equity",      id: "Ekuitas",     debitSide: false },
];

// The computed equity line.
export const CURRENT_YEAR_PROFIT = {
  code: "__cyp",
  name: "Current year profit/(loss)",
  id: "Laba (rugi) tahun berjalan",
  computed: true,
};

export const bsAccounts = (coa = COA) => coa.filter((n) => n.code && n.type !== "group" && n.fs === "BS");

// Seeded opening balances, debit-positive.
const SEED_OPENING = OPENING_BALANCES.reduce((m, r) => {
  m[r.account_code] = (m[r.account_code] || 0) + (r.debit || 0) - (r.credit || 0);
  return m;
}, {});

// Debit-positive balance per account at the end of `asOf`, plus the P&L split
// into earlier fiscal years (rolled to retained earnings) and this one.
function balancesAsOf(entries, asOf, { fiscalYearStart = 1, lineFilter = null } = {}) {
  const fyStart = fiscalYearStartFor(asOf, fiscalYearStart);
  const dr = {};
  let rolledPl = 0;      // earlier years' profit, credit-positive
  let currentPl = 0;     // this fiscal year's profit, credit-positive
  if (!lineFilter) for (const [code, v] of Object.entries(SEED_OPENING)) dr[code] = (dr[code] || 0) + v;
  for (const je of entries || []) {
    if (je.status !== "posted" || !je.je_date || je.je_date > asOf) continue;
    for (const l of je.lines || []) {
      const acct = COA_BY_CODE[l.account_code];
      if (!acct) continue;
      if (lineFilter && !lineFilter(je, l)) continue;
      const d = Number(l.debit) || 0;
      const c = Number(l.credit) || 0;
      if (acct.fs === "PL") {
        if (je.je_date < fyStart) rolledPl += c - d;
        else currentPl += c - d;
      } else {
        dr[l.account_code] = (dr[l.account_code] || 0) + d - c;
      }
    }
  }
  return { dr, rolledPl: r2(rolledPl), currentPl: r2(currentPl), fyStart };
}

// The statement at the end of `asOf`.
//   sides.{assets|liabilities|equity}: { key, label, id, total, nodes }
//     node: { id, label, idLabel, total, rows: [{ code, name, amount }], nodes }
//   byCode: account code (and CURRENT_YEAR_PROFIT.code) → amount as shown
//   totals: currentAssets, nonCurrentAssets, totalAssets, currentLiabilities,
//           nonCurrentLiabilities, totalLiabilities, totalEquity,
//           totalLiabilitiesEquity, workingCapital
//   difference: totalAssets − totalLiabilitiesEquity (0 when it balances)
export function computeBalanceSheet(entries, asOf, opts = {}, coa = COA) {
  const { dr, rolledPl, currentPl, fyStart } = balancesAsOf(entries, asOf, opts);
  const groups = new Map();
  coa.filter((n) => n.type === "group").forEach((g) => {
    groups.set(g.id, { id: g.id, label: g.label, idLabel: groupIdLabel(g.id, g.label), parent: g.parent || null, rows: [], nodes: [], total: 0 });
  });

  const byCode = {};
  const sideOf = (acct) => (["asset", "contra_asset"].includes(acct.type) ? "assets" : acct.type === "liability" ? "liabilities" : "equity");
  for (const acct of bsAccounts(coa)) {
    const raw = dr[acct.code] || 0;
    const debitSide = sideOf(acct) === "assets";
    let amount = r2(debitSide ? raw : -raw);
    if (acct.code === DEFAULT_ACCOUNTS.retainedEarnings) amount = r2(amount + rolledPl);
    byCode[acct.code] = amount;
    const g = groups.get(acct.parent);
    if (g) g.rows.push({ code: acct.code, name: acct.name, amount, contra: acct.type === "contra_asset" || (acct.type === "equity" && acct.normal_balance === "debit") });
  }
  // The computed current-year line closes the equity group.
  const eq = groups.get("g-equity");
  byCode[CURRENT_YEAR_PROFIT.code] = currentPl;
  if (eq) eq.rows.push({ code: CURRENT_YEAR_PROFIT.code, name: CURRENT_YEAR_PROFIT.name, idName: CURRENT_YEAR_PROFIT.id, amount: currentPl, computed: true });

  // Wire the tree in chart order and total it bottom-up.
  groups.forEach((g) => { if (g.parent && groups.get(g.parent)) groups.get(g.parent).nodes.push(g); });
  const total = (g) => { g.total = r2(g.rows.reduce((s, r) => s + r.amount, 0) + g.nodes.reduce((s, n) => s + total(n), 0)); return g.total; };

  const sides = {};
  for (const s of BS_SIDES) {
    const root = groups.get(s.root);
    total(root);
    sides[s.key] = { key: s.key, label: s.label, id: s.id, total: root.total, node: root };
  }
  const byNode = {};
  groups.forEach((g, id) => { byNode[id] = g.total; });
  const t = (id) => groups.get(id)?.total || 0;
  const totals = {
    currentAssets: t("g-current-asset"),
    nonCurrentAssets: t("g-non-current-asset"),
    totalAssets: sides.assets.total,
    currentLiabilities: t("g-current-liab"),
    nonCurrentLiabilities: t("g-nc-liab"),
    totalLiabilities: sides.liabilities.total,
    totalEquity: sides.equity.total,
    totalLiabilitiesEquity: r2(sides.liabilities.total + sides.equity.total),
  };
  totals.workingCapital = r2(totals.currentAssets - totals.currentLiabilities);
  const difference = r2(totals.totalAssets - totals.totalLiabilitiesEquity);
  return {
    asOf, fyStart, sides, byCode, byNode, totals,
    currentYearProfit: currentPl, rolledProfit: rolledPl,
    difference, balanced: Math.abs(difference) < 1,
  };
}

// Ratios a lender or owner reads off a balance sheet. null when the base is 0.
export function bsRatios(totals) {
  const div = (a, b) => (b ? a / b : null);
  return {
    currentRatio: div(totals.currentAssets, totals.currentLiabilities),
    debtToEquity: div(totals.totalLiabilities, totals.totalEquity),
    workingCapital: totals.workingCapital,
  };
}

// Every account node id in the tree, depth-first, with its depth — for
// Expand / Collapse one level.
export function bsNodes(res) {
  const out = [];
  const walk = (n, depth, parent) => {
    out.push({ id: n.id, depth, parent });
    n.nodes.forEach((c) => walk(c, depth + 1, n.id));
  };
  for (const s of BS_SIDES) walk(res.sides[s.key].node, 0, null);
  return out;
}

// Change between two balances: { diff, pct } where pct is null when the base is 0.
export function change(current, prior) {
  const diff = r2((current || 0) - (prior || 0));
  const pct = prior ? diff / Math.abs(prior) : null;
  return { diff, pct };
}
