// Profit & Loss — pure computation, no React.
//
// Built from each account's `section` and `type` in the chart of accounts, not
// from the account tree: Other Revenue sits under the Revenue group in the
// tree, but on the statement it belongs below operating profit.
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

import { COA } from "../data/seed/coa";

// The statement's buckets, in display order. `deduct` buckets are presented as
// positive amounts and subtracted.
export const PL_BUCKETS = [
  { key: "revenue",      label: "Revenue",                         deduct: false },
  { key: "contra",       label: "Less: sales returns & discounts",  deduct: true },
  { key: "cogs",         label: "Cost of goods sold",              deduct: true },
  { key: "selling",      label: "Selling expenses",                deduct: true, group: "opex" },
  { key: "ga",           label: "General & administrative",        deduct: true, group: "opex" },
  { key: "otherIncome",  label: "Other income",                    deduct: false },
  { key: "otherExpense", label: "Other expenses",                  deduct: true },
  { key: "tax",          label: "Income tax",                      deduct: true },
];
const BUCKET_BY_KEY = Object.fromEntries(PL_BUCKETS.map((b) => [b.key, b]));

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

// Raw credit − debit per P&L account code over posted entries dated in
// [from, to] (inclusive ISO dates). Entries carry the date; lines don't.
export function plMovements(entries, { from, to }, coa = COA) {
  const isPl = new Set(plAccounts(coa).map((a) => a.code));
  const net = {};
  for (const je of entries || []) {
    if (je.status !== "posted") continue;
    const d = je.je_date;
    if (!d || d < from || d > to) continue;
    for (const l of je.lines || []) {
      if (!isPl.has(l.account_code)) continue;
      net[l.account_code] = (net[l.account_code] || 0) + (Number(l.credit) || 0) - (Number(l.debit) || 0);
    }
  }
  return net;
}

// Rounds away float dust from summing Rupiah amounts.
const r2 = (n) => Math.round(n * 100) / 100 + 0;

export function computeProfitLoss(entries, { from, to }, coa = COA) {
  const net = plMovements(entries, { from, to }, coa);

  const sections = {};
  for (const b of PL_BUCKETS) sections[b.key] = { ...b, rows: [], total: 0 };

  for (const acct of plAccounts(coa)) {
    const b = BUCKET_BY_KEY[plBucket(acct)];
    const raw = r2(net[acct.code] || 0);
    const amount = r2(b.deduct ? -raw : raw);
    sections[b.key].rows.push({ code: acct.code, name: acct.name, amount, raw, zero: amount === 0 });
    sections[b.key].total = r2(sections[b.key].total + amount);
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

  // The statement, top to bottom. `section` lines expand to their account
  // rows; `heading` lines carry no amount; `subtotal` lines are bold.
  const statement = [
    { kind: "section", key: "revenue" },
    { kind: "section", key: "contra" },
    { kind: "subtotal", key: "netRevenue", label: "Net revenue" },
    { kind: "section", key: "cogs" },
    { kind: "subtotal", key: "grossProfit", label: "Gross profit" },
    { kind: "heading", key: "opexHead", label: "Operating expenses" },
    { kind: "section", key: "selling", nested: true },
    { kind: "section", key: "ga", nested: true },
    { kind: "subtotal", key: "opex", label: "Total operating expenses", minor: true },
    { kind: "subtotal", key: "operatingProfit", label: "Operating profit" },
    { kind: "section", key: "otherIncome" },
    { kind: "section", key: "otherExpense" },
    { kind: "subtotal", key: "profitBeforeTax", label: "Profit before tax" },
    { kind: "section", key: "tax" },
    { kind: "subtotal", key: "netProfit", label: "Net profit", grand: true },
  ].map((l) => (l.kind === "subtotal" ? { ...l, amount: totals[l.key] } : l));

  return {
    from, to, sections, totals, statement,
    grossMargin: margin(grossProfit),
    operatingMargin: margin(operatingProfit),
    netMargin: margin(netProfit),
    netProfitCheck,
    balanced: Math.abs(netProfitCheck - netProfit) < 0.5,
  };
}

// Journals dated in the period that the report leaves out because they are not
// posted yet (draft or awaiting approval).
export function unpostedInPeriod(entries, { from, to }) {
  return (entries || []).filter((je) => (je.status === "draft" || je.status === "pending") && je.je_date >= from && je.je_date <= to);
}

// Change between two amounts: { diff, pct } where pct is null when the base is 0.
export function change(current, prior) {
  const diff = r2((current || 0) - (prior || 0));
  const pct = prior ? diff / Math.abs(prior) : null;
  return { diff, pct };
}
