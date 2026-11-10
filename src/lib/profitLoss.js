// Profit & Loss — pure computation, no React.
//
// Built from each account's `section` and `type` in the chart of accounts, not
// from the account tree: Other Revenue sits under the Revenue group in the
// tree, but on the statement it belongs below operating profit. Subtotals
// follow from the buckets (DualEntry: "gross profit, operating income and net
// income follow your account type configuration"), so no mapping is needed.
//
// Sign convention. Internally every P&L account's movement is credit − debit,
// so income is positive and expenses negative. On the statement, deduction
// sections (returns & discounts, COGS, operating, other and tax expenses) are
// shown as positive numbers and subtracted in the subtotals.
//
// Net profit = Σ over every fs === "PL" account of (credit − debit). The Trial
// Balance uses the same rule, so the two reports agree. Every P&L account lands
// in exactly one bucket below (unknown sections fall back to Other income /
// Other expenses by type), which guarantees the identity.
//
// Options on every computation:
//   lineFilter   (je, line) => boolean — e.g. a dimension filter. Only matching
//                lines count.
//   adjustments  "included" (default: the adjusted P&L), "excluded" (leaves out
//                journals flagged is_adjusting — the unadjusted P&L) or "only"
//                (just the adjusting journals, for an Adjustments column).
//
// Labels come in English (screen) and Bahasa Indonesia (`id`, for print and
// Excel), following the SAK EP / EMKM order of a laporan laba rugi.

import { COA } from "../data/seed/coa";

// The statement's buckets, in display order. `deduct` buckets are presented as
// positive amounts and subtracted.
export const PL_BUCKETS = [
  { key: "revenue",      label: "Revenue",                         id: "Pendapatan usaha",                       deduct: false },
  { key: "contra",       label: "Less: sales returns & discounts", id: "Dikurangi: retur dan potongan penjualan", deduct: true },
  { key: "cogs",         label: "Cost of goods sold",              id: "Beban pokok penjualan",                  deduct: true },
  { key: "selling",      label: "Selling expenses",                id: "Beban penjualan",                        deduct: true, group: "opex" },
  { key: "ga",           label: "General & administrative",        id: "Beban umum dan administrasi",            deduct: true, group: "opex" },
  { key: "otherIncome",  label: "Other income",                    id: "Pendapatan lain-lain",                   deduct: false },
  { key: "otherExpense", label: "Other expenses",                  id: "Beban lain-lain",                        deduct: true },
  { key: "tax",          label: "Income tax expense",              id: "Beban pajak penghasilan",                deduct: true },
];
const BUCKET_BY_KEY = Object.fromEntries(PL_BUCKETS.map((b) => [b.key, b]));

// The statement, top to bottom. `section` lines expand to their account rows;
// `heading` lines carry no amount; `subtotal` lines are bold; `margin` lines
// are a subtotal as a share of net revenue.
export const PL_LINES = [
  { kind: "section",  key: "revenue" },
  { kind: "section",  key: "contra" },
  { kind: "subtotal", key: "netRevenue",      label: "Net revenue",              id: "Pendapatan bersih" },
  { kind: "section",  key: "cogs" },
  { kind: "subtotal", key: "grossProfit",     label: "Gross profit",             id: "Laba kotor" },
  { kind: "margin",   key: "grossMargin",     of: "grossProfit",     label: "Gross margin",     id: "Marjin laba kotor" },
  { kind: "heading",  key: "opexHead",        label: "Operating expenses",       id: "Beban usaha" },
  { kind: "section",  key: "selling", nested: true },
  { kind: "section",  key: "ga", nested: true },
  { kind: "subtotal", key: "opex",            label: "Total operating expenses", id: "Jumlah beban usaha", minor: true },
  { kind: "subtotal", key: "operatingProfit", label: "Operating profit",         id: "Laba usaha" },
  { kind: "margin",   key: "operatingMargin", of: "operatingProfit", label: "Operating margin", id: "Marjin laba usaha" },
  { kind: "section",  key: "otherIncome" },
  { kind: "section",  key: "otherExpense" },
  { kind: "subtotal", key: "profitBeforeTax", label: "Profit before tax",        id: "Laba sebelum pajak penghasilan" },
  { kind: "section",  key: "tax" },
  { kind: "subtotal", key: "netProfit",       label: "Net profit",               id: "Laba bersih", grand: true },
  { kind: "margin",   key: "netMargin",       of: "netProfit",       label: "Net margin",       id: "Marjin laba bersih" },
];

// Which statement bucket a P&L account belongs to.
export function plBucket(acct) {
  if (acct.type === "contra_revenue") return "contra";
  switch (acct.section) {
    case "Revenue":       return acct.type === "revenue" ? "revenue" : "otherExpense";
    case "Other Revenue": return "otherIncome";
    case "COGS":          return "cogs";
    case "OpEx":          return acct.parent === "g-selling" ? "selling" : "ga";
    case "Other":         return "otherExpense";
    case "Tax":           return "tax";
    default:              return acct.type === "revenue" ? "otherIncome" : "otherExpense";
  }
}

export const plAccounts = (coa = COA) => coa.filter((n) => n.code && n.type !== "group" && n.fs === "PL");

// Does a journal count under an adjustments mode?
const adjOk = (je, adjustments) => (
  adjustments === "excluded" ? !je.is_adjusting
    : adjustments === "only" ? !!je.is_adjusting
      : true
);

// Raw credit − debit per P&L account code over posted entries dated in
// [from, to] (inclusive ISO dates). Entries carry the date; lines don't.
export function plMovements(entries, { from, to }, { lineFilter = null, adjustments = "included" } = {}, coa = COA) {
  const isPl = new Set(plAccounts(coa).map((a) => a.code));
  const net = {};
  for (const je of entries || []) {
    if (je.status !== "posted") continue;
    const d = je.je_date;
    if (!d || d < from || d > to) continue;
    if (!adjOk(je, adjustments)) continue;
    for (const l of je.lines || []) {
      if (!isPl.has(l.account_code)) continue;
      if (lineFilter && !lineFilter(je, l)) continue;
      net[l.account_code] = (net[l.account_code] || 0) + (Number(l.credit) || 0) - (Number(l.debit) || 0);
    }
  }
  return net;
}

// Rounds away float dust from summing Rupiah amounts.
const r2 = (n) => Math.round(n * 100) / 100 + 0;

export function computeProfitLoss(entries, { from, to }, opts = {}, coa = COA) {
  const net = plMovements(entries, { from, to }, opts, coa);

  const sections = {};
  for (const b of PL_BUCKETS) sections[b.key] = { ...b, rows: [], total: 0 };
  const byCode = {};

  for (const acct of plAccounts(coa)) {
    const b = BUCKET_BY_KEY[plBucket(acct)];
    const raw = r2(net[acct.code] || 0);
    const amount = r2(b.deduct ? -raw : raw);
    sections[b.key].rows.push({ code: acct.code, name: acct.name, amount, raw, zero: amount === 0 });
    sections[b.key].total = r2(sections[b.key].total + amount);
    byCode[acct.code] = amount;
  }

  const t = (k) => sections[k].total;
  const netRevenue = r2(t("revenue") - t("contra"));
  const grossProfit = r2(netRevenue - t("cogs"));
  const opex = r2(t("selling") + t("ga"));
  const operatingProfit = r2(grossProfit - opex);
  const profitBeforeTax = r2(operatingProfit + t("otherIncome") - t("otherExpense"));
  const netProfit = r2(profitBeforeTax - t("tax"));
  // The independent rule the Trial Balance uses.
  const netProfitCheck = r2(Object.values(net).reduce((s, v) => s + v, 0));

  const totals = {
    revenue: t("revenue"), contra: t("contra"), netRevenue,
    cogs: t("cogs"), grossProfit,
    selling: t("selling"), ga: t("ga"), opex, operatingProfit,
    otherIncome: t("otherIncome"), otherExpense: t("otherExpense"), profitBeforeTax,
    tax: t("tax"), netProfit,
  };
  const margin = (v) => (netRevenue ? v / netRevenue : null);
  const margins = {
    grossMargin: margin(grossProfit),
    operatingMargin: margin(operatingProfit),
    netMargin: margin(netProfit),
  };

  return {
    from, to, sections, totals, margins, byCode,
    netProfitCheck,
    balanced: Math.abs(netProfitCheck - netProfit) < 0.5,
  };
}

// A statement line's amount in a result: section and subtotal totals, a
// margin as a fraction, nothing for a heading.
export function lineValue(res, line) {
  if (!res) return null;
  if (line.kind === "subtotal") return res.totals[line.key];
  if (line.kind === "section") return res.sections[line.key].total;
  if (line.kind === "margin") return res.margins[line.key];
  return null;
}

// Journals dated in the period that the report leaves out because they are not
// posted yet (draft or awaiting approval).
export function unpostedInPeriod(entries, { from, to }) {
  return (entries || []).filter((je) => (je.status === "draft" || je.status === "pending") && je.je_date >= from && je.je_date <= to);
}

// Posted adjusting journals dated in the period.
export function adjustingInPeriod(entries, { from, to }) {
  return (entries || []).filter((je) => je.is_adjusting && je.status === "posted" && je.je_date >= from && je.je_date <= to);
}

// Change between two amounts: { diff, pct } where pct is null when the base is 0.
export function change(current, prior) {
  const diff = r2((current || 0) - (prior || 0));
  const pct = prior ? diff / Math.abs(prior) : null;
  return { diff, pct };
}
