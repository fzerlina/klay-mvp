// Statement of Cash Flows (Laporan Arus Kas) — pure computation, no React.
//
// Direct method (team decision, 25 Nov 2026: it's what most companies use and
// how they already lay out their Excel). The statement lists the cash actually
// received and paid, by category.
//
// How a cash movement finds its line — account level (SME, 25 Nov):
//   · Some accounts are "cash and cash equivalents" (by default the chart's
//     cash group, without time deposits and restricted cash — PSAK 2).
//   · Every other account sits in one of the company's own Cash Flow groups
//     (Settings → Accounting → Cash flow), set per account on the Chart of
//     accounts.
//   · A posted journal that touches cash lands in the groups of the accounts
//     on its other side. Each other line carries its own share:
//         cash effect of a line = credit − debit
//     so a receipt of 990 that settles 1.000 of AR with 10 of bank charges
//     shows +1.000 under the customers' group and −10 under the charges'
//     group. The shares always add up to the cash that moved, because every
//     journal balances.
//   · A journal moving money between two cash accounts has no other side and
//     drops out — it isn't a cash flow. A journal that never touches cash
//     (accruals, depreciation) never shows.
//   · Assigning one journal to a different group than its account's is not in
//     the MVP.
//
// Groups belong to operating, investing or financing activities (fixed, PSAK
// 2) and nest up to MAX_DEPTH levels; a group's amount is its own accounts
// plus every group under it. An account with no group still counts — it lands
// on "Not assigned" under operating so nothing goes missing — and the
// statement proves itself against the Balance Sheet:
//   cash at the start + net change = cash at the end.

import { COA } from "../data/seed/coa";
import { computeBalanceSheet, byAccountCode } from "./balanceSheet";
import { dayBefore } from "./reportPeriods";

const r2 = (v) => Math.round(v * 100) / 100 + 0;

export const MAX_DEPTH = 3;

export const CF_SECTIONS = [
  { key: "operating", label: "Cash flows from operating activities", id: "Arus kas dari aktivitas operasi",
    short: "Operating", total: "Net cash from operating activities", totalId: "Kas neto dari aktivitas operasi" },
  { key: "investing", label: "Cash flows from investing activities", id: "Arus kas dari aktivitas investasi",
    short: "Investing", total: "Net cash from investing activities", totalId: "Kas neto dari aktivitas investasi" },
  { key: "financing", label: "Cash flows from financing activities", id: "Arus kas dari aktivitas pendanaan",
    short: "Financing", total: "Net cash from financing activities", totalId: "Kas neto dari aktivitas pendanaan" },
];
export const SECTION_BY_KEY = Object.fromEntries(CF_SECTIONS.map((s) => [s.key, s]));
export const CASH_LINE = { key: "cash", label: "Cash and cash equivalents", id: "Kas dan setara kas" };
export const UNASSIGNED = { key: "unassigned", label: "Not assigned", id: "Belum dikelompokkan" };

// The standard structure a company starts from — a common Indonesian direct-
// method layout, with one nested example (payments to suppliers and
// employees). Array order is print order. `labelId` is the Bahasa label.
export const CF_TEMPLATE = [
  { key: "customers", section: "operating", parent: null, label: "Receipts from customers", labelId: "Penerimaan kas dari pelanggan" },
  { key: "paid", section: "operating", parent: null, label: "Payments to suppliers and employees", labelId: "Pembayaran kas kepada pemasok dan karyawan" },
  { key: "suppliers", section: "operating", parent: "paid", label: "Suppliers", labelId: "Pemasok" },
  { key: "employees", section: "operating", parent: "paid", label: "Employees", labelId: "Karyawan" },
  { key: "opex", section: "operating", parent: "paid", label: "Operating expenses", labelId: "Beban operasional" },
  { key: "tax", section: "operating", parent: null, label: "Taxes paid", labelId: "Pembayaran pajak" },
  { key: "interest", section: "operating", parent: null, label: "Interest received and paid", labelId: "Penerimaan dan pembayaran bunga" },
  { key: "other_op", section: "operating", parent: null, label: "Other operating receipts and payments", labelId: "Penerimaan (pembayaran) operasional lainnya" },
  { key: "fixed_assets", section: "investing", parent: null, label: "Purchase and sale of fixed assets", labelId: "Pembelian dan penjualan aset tetap" },
  { key: "intangibles", section: "investing", parent: null, label: "Purchase of intangible assets", labelId: "Perolehan aset takberwujud" },
  { key: "deposits", section: "investing", parent: null, label: "Time deposits and other investments", labelId: "Deposito berjangka dan investasi lainnya" },
  { key: "borrowings", section: "financing", parent: null, label: "Proceeds from and repayment of borrowings", labelId: "Penerimaan dan pembayaran pinjaman" },
  { key: "capital", section: "financing", parent: null, label: "Capital contributions", labelId: "Penerimaan setoran modal" },
  { key: "dividends", section: "financing", parent: null, label: "Dividends paid", labelId: "Pembayaran dividen" },
  { key: "other_eq", section: "financing", parent: null, label: "Other equity movements", labelId: "Perubahan ekuitas lainnya" },
];
export const defaultCfGroups = () => CF_TEMPLATE.map((g) => ({ ...g }));

// Every account that can carry a group: all posting accounts, balance sheet
// and P&L (in the direct method cash goes straight to expenses and revenue).
export const cfAccounts = (coa = COA) => coa.filter((n) => n.code && n.type !== "group").sort(byAccountCode);

const EMPLOYEE = /salar|wage|direct labor|bonus|employee/i;
const INTEREST = /interest|loan origination/i;

// The template group an account starts in, "cash", or null — from the chart's
// own groups and a few names.
export function defaultCfGroup(a) {
  if (a.parent === "g-cash") return /time deposit|restricted cash/i.test(a.name) ? "deposits" : "cash";
  if (INTEREST.test(a.name)) return "interest";
  if (EMPLOYEE.test(a.name)) return "employees";
  if (/disposal|held for sale/i.test(a.name)) return "fixed_assets";
  if (/dividend/i.test(a.name)) return "dividends";
  if (/deferred tax|vat|ppn|prepaid tax/i.test(a.name)) return "tax";
  if (/customer deposit|deferred revenue/i.test(a.name)) return "customers";
  if (/advance to supplier/i.test(a.name)) return "suppliers";
  switch (a.parent) {
    case "g-ar": return /other receivable/i.test(a.name) ? "other_op" : "customers";
    case "g-operating-rev": case "g-contra-rev": return "customers";
    case "g-inventory": case "g-prepaid": case "g-trade-payable": case "g-cogs": return "suppliers";
    case "g-other-current": return "other_op";
    case "g-ppe": return "fixed_assets";
    case "g-intangible": return "intangibles";
    case "g-other-nc": return "deposits";
    case "g-tax-payable": case "g-tax-exp": return "tax";
    case "g-short-debt": case "g-nc-liab": return "borrowings";
    case "g-other-current-liab": return "other_op";
    case "g-selling": case "g-ga": return "opex";
    case "g-other-rev": case "g-other-exp": return "other_op";
    case "g-equity": return /capital/i.test(a.name) ? "capital" : "other_eq";
    default: return null;
  }
}

// The group each account is in: the company's own choice (`assign`, set on
// the Chart of accounts — a group key, "cash", or null for none) or else the
// default. A group that no longer exists counts as none.
export function resolveCfAssign(groups, assign = {}, coa = COA) {
  const keys = new Set(groups.map((g) => g.key));
  const out = {};
  for (const a of cfAccounts(coa)) {
    const k = Object.prototype.hasOwnProperty.call(assign, a.code) ? assign[a.code] : defaultCfGroup(a);
    out[a.code] = k === "cash" || (k && keys.has(k)) ? k : null;
  }
  return out;
}

// ── Tree helpers (shared by the report and the settings page) ──────────────
export function childrenOf(groups, parent, section) {
  return groups.filter((g) => g.parent === parent && (parent || g.section === section));
}
export function groupDepth(groups, key) {
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));
  let d = 0, cur = by[key];
  while (cur && cur.parent) { d += 1; cur = by[cur.parent]; }
  return d;
}
export function descendantKeys(groups, key) {
  const out = [];
  const walk = (k) => groups.filter((g) => g.parent === k).forEach((g) => { out.push(g.key); walk(g.key); });
  walk(key);
  return out;
}
// How many levels a group's subtree spans (1 = no subgroups).
export function subtreeHeight(groups, key) {
  const kids = groups.filter((g) => g.parent === key);
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeHeight(groups, k.key))) : 0);
}
// "Operating › Payments to suppliers and employees › Suppliers"
export function groupPath(groups, key, lang = "en") {
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));
  const parts = [];
  let cur = by[key];
  while (cur) { parts.unshift(lang === "id" ? cur.labelId || cur.label : cur.label); cur = by[cur.parent]; }
  const top = by[key] ? SECTION_BY_KEY[groupSection(groups, key)] : null;
  return top ? [top.short, ...parts] : parts;
}
export function groupSection(groups, key) {
  const by = Object.fromEntries(groups.map((g) => [g.key, g]));
  let cur = by[key];
  while (cur && cur.parent) cur = by[cur.parent];
  return cur?.section || null;
}

// Signed cash effect per counter account in [from, to], and the cash codes.
function cashEffects(entries, { from, to }, cash) {
  const effect = {}; // code → amount (+ brought cash in)
  const openingCash = {}; // the cut-over journal's cash, part of cash at the start
  for (const je of entries || []) {
    if (je.status !== "posted" || !je.je_date || je.je_date < from || je.je_date > to) continue;
    const lines = je.lines || [];
    if (je.is_opening) {
      for (const l of lines) if (cash.has(l.account_code)) openingCash[l.account_code] = (openingCash[l.account_code] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0);
      continue;
    }
    if (!lines.some((l) => cash.has(l.account_code))) continue;
    for (const l of lines) {
      if (cash.has(l.account_code)) continue;
      const v = (Number(l.credit) || 0) - (Number(l.debit) || 0);
      if (v) effect[l.account_code] = (effect[l.account_code] || 0) + v;
    }
  }
  return { effect, openingCash };
}

// The statement for [from, to].
//   groups: { key: { ...group, depth, children: [key], accounts: [{ code, name, amount }], own, amount } }
//   roots: { operating|investing|financing: [key] } — top-level groups in order
//   unassigned: { amount, accounts }
//   sections: { operating|investing|financing: amount }
//   netChange, cashStart, cashEnd, difference (0 when it ties), cashCodes
export function computeCashFlow(entries, { from, to }, { groups = CF_TEMPLATE, assign = {}, fiscalYearStart = 1 } = {}, coa = COA) {
  const map = resolveCfAssign(groups, assign, coa);
  const acctBy = Object.fromEntries(cfAccounts(coa).map((a) => [a.code, a]));
  const cashCodes = Object.keys(map).filter((c) => map[c] === "cash");
  const cash = new Set(cashCodes);
  const { effect, openingCash } = cashEffects(entries, { from, to }, cash);

  const out = {};
  for (const g of groups) out[g.key] = { ...g, depth: groupDepth(groups, g.key), children: groups.filter((c) => c.parent === g.key).map((c) => c.key), accounts: [], own: 0, amount: 0 };
  const unassigned = { ...UNASSIGNED, amount: 0, accounts: [] };
  for (const a of cfAccounts(coa)) {
    const k = map[a.code];
    if (k === "cash") continue;
    const amount = r2(effect[a.code] || 0);
    const bucket = k ? out[k] : unassigned;
    bucket.accounts.push({ code: a.code, name: a.name, amount });
    if (k) bucket.own = r2(bucket.own + amount); else bucket.amount = r2(bucket.amount + amount);
  }
  // A journal line on an account that isn't in the chart (shouldn't happen)
  // still counts, under Not assigned.
  for (const code of Object.keys(effect)) {
    if (acctBy[code] || cash.has(code)) continue;
    const amount = r2(effect[code]);
    unassigned.accounts.push({ code, name: code, amount });
    unassigned.amount = r2(unassigned.amount + amount);
  }
  const roll = (k) => { const g = out[k]; g.amount = r2(g.own + g.children.reduce((s, c) => s + roll(c), 0)); return g.amount; };
  const roots = {};
  const sections = {};
  for (const s of CF_SECTIONS) {
    roots[s.key] = groups.filter((g) => !g.parent && g.section === s.key).map((g) => g.key);
    sections[s.key] = r2(roots[s.key].reduce((sum, k) => sum + roll(k), 0));
  }
  sections.operating = r2(sections.operating + unassigned.amount);
  const netChange = r2(sections.operating + sections.investing + sections.financing);

  const cashAt = (d) => {
    const bs = computeBalanceSheet(entries, d, { fiscalYearStart });
    return r2(cashCodes.reduce((s, c) => s + (bs.byCode[c] || 0), 0));
  };
  const cashStart = r2(cashAt(dayBefore(from)) + cashCodes.reduce((s, c) => s + (openingCash[c] || 0), 0));
  const cashEnd = cashAt(to);
  const difference = r2(cashStart + netChange - cashEnd);

  return { from, to, groups: out, roots, unassigned, sections, netChange, cashStart, cashEnd, difference, ties: Math.abs(difference) < 0.5, cashCodes, assign: map };
}

// The journal lines behind one account's cash effect in [from, to] — the
// other side of each posted journal that moved cash. + brought cash in.
export function cashEffectLines(entries, code, { from, to }, cashCodes = []) {
  const cash = new Set(cashCodes);
  const out = [];
  for (const je of entries || []) {
    if (je.status !== "posted" || je.is_opening || !je.je_date || je.je_date < from || je.je_date > to) continue;
    const lines = je.lines || [];
    if (!lines.some((l) => cash.has(l.account_code))) continue;
    lines.forEach((l, i) => {
      if (l.account_code !== code) return;
      const amount = r2((Number(l.credit) || 0) - (Number(l.debit) || 0));
      if (!amount) return;
      const via = lines.find((x) => cash.has(x.account_code));
      out.push({
        key: `${je.je_number}-${i}`, date: je.je_date, je_number: je.je_number,
        source: !je.reference_type || je.reference_type === "manual" ? "manual" : je.reference_type,
        party: "", desc: l.description || je.memo || (via ? `via ${via.account_code}` : ""), amount,
      });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
