// Statement of Cash Flows (Laporan Arus Kas) — pure computation, no React.
//
// Indirect method (PSAK 2 / SAK EP allow both; it's what Indonesian SMEs and
// their auditors are used to, and it needs nothing the ledger doesn't hold).
// Starts from the P&L's profit for the period and turns it into cash:
//
//   cash effect of a non-cash balance-sheet account = −(its debit movement)
//
// because every journal balances: the debit movement of the cash accounts
// equals minus the debit movement of everything else, and the P&L accounts'
// part of "everything else" is the profit. So
//   net change in cash = profit + Σ cash effects of the non-cash BS accounts
// with no estimate anywhere, and the statement proves it against the Balance
// Sheet: cash at the start + net change = cash at the end.
//
// Each balance-sheet account maps to one statement line (CF_LINES), and each
// line sits in operating, investing or financing. The default comes from the
// chart's own groups (defaultCfLine); a company can move an account to
// another line (the page keeps that as `mapping`). An account mapped to
// "unclassified" still counts — it shows on its own line so nothing goes
// missing from the total.

import { COA } from "../data/seed/coa";
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";
import { computeBalanceSheet, byAccountCode } from "./balanceSheet";
import { computeProfitLoss, plMovements, plAccounts } from "./profitLoss";
import { dayBefore } from "./reportPeriods";

const r2 = (v) => Math.round(v * 100) / 100 + 0;

export const CF_SECTIONS = [
  { key: "operating", label: "Cash flows from operating activities", id: "Arus kas dari aktivitas operasi",
    total: "Net cash from operating activities", totalId: "Kas neto dari aktivitas operasi" },
  { key: "investing", label: "Cash flows from investing activities", id: "Arus kas dari aktivitas investasi",
    total: "Net cash from investing activities", totalId: "Kas neto dari aktivitas investasi" },
  { key: "financing", label: "Cash flows from financing activities", id: "Arus kas dari aktivitas pendanaan",
    total: "Net cash from financing activities", totalId: "Kas neto dari aktivitas pendanaan" },
];

// Sub-headings inside operating activities.
export const CF_SUBS = {
  noncash: { label: "Adjustments for non-cash items", id: "Penyesuaian untuk pos non-kas" },
  wc: { label: "Changes in working capital", id: "Perubahan modal kerja" },
};

// Every line a balance-sheet account can map to, in print order.
export const CF_LINES = [
  { key: "dep",          section: "operating", sub: "noncash", label: "Depreciation and amortisation",                 id: "Penyusutan dan amortisasi" },
  { key: "disposal",     section: "operating", sub: "noncash", label: "(Gain)/loss on disposal of fixed assets",       id: "(Laba) rugi pelepasan aset tetap" },
  { key: "deferred_tax", section: "operating", sub: "noncash", label: "Deferred tax",                                  id: "Pajak tangguhan" },
  { key: "ar",           section: "operating", sub: "wc",      label: "Trade and other receivables",                   id: "Piutang usaha dan piutang lain-lain" },
  { key: "inventory",    section: "operating", sub: "wc",      label: "Inventories",                                   id: "Persediaan" },
  { key: "prepaid",      section: "operating", sub: "wc",      label: "Prepaid expenses",                              id: "Biaya dibayar di muka" },
  { key: "other_ca",     section: "operating", sub: "wc",      label: "Other current assets",                          id: "Aset lancar lainnya" },
  { key: "ap",           section: "operating", sub: "wc",      label: "Trade and other payables",                      id: "Utang usaha dan utang lain-lain" },
  { key: "tax",          section: "operating", sub: "wc",      label: "Taxes payable",                                 id: "Utang pajak" },
  { key: "other_cl",     section: "operating", sub: "wc",      label: "Other current liabilities",                     id: "Liabilitas jangka pendek lainnya" },
  { key: "unclassified", section: "operating", sub: null,      label: "Unclassified movements",                        id: "Perubahan belum diklasifikasikan" },
  { key: "ppe",          section: "investing", sub: null,      label: "Acquisition of property, plant and equipment",  id: "Perolehan aset tetap" },
  { key: "intangible",   section: "investing", sub: null,      label: "Acquisition of intangible assets",              id: "Perolehan aset takberwujud" },
  { key: "other_nca",    section: "investing", sub: null,      label: "Other non-current assets",                      id: "Aset tidak lancar lainnya" },
  { key: "deposits",     section: "investing", sub: null,      label: "Time deposits and restricted cash",             id: "Deposito berjangka dan kas yang dibatasi penggunaannya" },
  { key: "st_debt",      section: "financing", sub: null,      label: "Short-term borrowings, net",                    id: "Pinjaman jangka pendek, neto" },
  { key: "lt_debt",      section: "financing", sub: null,      label: "Long-term borrowings and leases, net",          id: "Pinjaman jangka panjang dan liabilitas sewa, neto" },
  { key: "capital",      section: "financing", sub: null,      label: "Proceeds from issue of share capital",          id: "Penerimaan setoran modal" },
  { key: "dividends",    section: "financing", sub: null,      label: "Dividends paid",                                id: "Pembayaran dividen" },
  { key: "other_eq",     section: "financing", sub: null,      label: "Other equity movements",                        id: "Perubahan ekuitas lainnya" },
];
export const CF_LINE_BY_KEY = Object.fromEntries(CF_LINES.map((l) => [l.key, l]));
export const CASH_LINE = { key: "cash", label: "Cash and cash equivalents", id: "Kas dan setara kas" };

// The line an account maps to when nobody has said otherwise — from the
// chart's groups, which already sort the balance sheet the way the cash flow
// needs (current vs non-current, debt vs payables).
const GROUP_LINE = {
  "g-cash": "cash",
  "g-ar": "ar", "g-inventory": "inventory", "g-prepaid": "prepaid", "g-other-current": "other_ca",
  "g-trade-payable": "ap", "g-tax-payable": "tax", "g-other-current-liab": "other_cl",
  "g-short-debt": "st_debt",
  "g-ppe": "ppe", "g-intangible": "intangible", "g-other-nc": "other_nca",
};
export function defaultCfLine(a) {
  // PSAK 2: only short-term, freely usable cash is a cash equivalent. Time
  // deposits and restricted cash sit in the cash group of the chart but are
  // investing by default (benchmark §6); a company with 3-month deposits can
  // map them back to cash.
  if (/time deposit|restricted cash/i.test(a.name)) return "deposits";
  if (a.type === "contra_asset" && ["g-ppe", "g-intangible"].includes(a.parent)) return "dep";
  if (/dividend/i.test(a.name)) return "dividends";
  if (/current portion of long-term/i.test(a.name)) return "lt_debt";
  if (/deferred tax/i.test(a.name)) return "deferred_tax";
  if (a.parent === "g-nc-liab") return "lt_debt";
  if (a.type === "equity") {
    if (a.code === DEFAULT_ACCOUNTS.retainedEarnings || /current year earnings/i.test(a.name)) return "other_eq";
    return "capital";
  }
  if (a.type === "contra_asset") return GROUP_LINE[a.parent] || "unclassified";
  return GROUP_LINE[a.parent] || "unclassified";
}

export const cfAccounts = (coa = COA) => coa.filter((n) => n.code && n.type !== "group" && n.fs === "BS").sort(byAccountCode);

// The line each balance-sheet account maps to: the default, overridden by the
// company's own mapping ({ code: lineKey }).
export function cfMapping(mapping = {}, coa = COA) {
  const out = {};
  cfAccounts(coa).forEach((a) => { out[a.code] = mapping[a.code] || defaultCfLine(a); });
  return out;
}

// The statement for [from, to].
//   lines: { lineKey: { ...CF_LINES entry, amount, accounts: [{ code, name, amount }] } }
//   sections: { operating|investing|financing: amount }
//   profit, netChange, cashStart, cashEnd, difference (0 when it ties),
//   cashCodes: the accounts counted as cash
export function computeCashFlow(entries, { from, to }, { mapping = {}, fiscalYearStart = 1 } = {}, coa = COA) {
  const map = cfMapping(mapping, coa);
  const acctBy = Object.fromEntries(cfAccounts(coa).map((a) => [a.code, a]));
  const move = {}; // debit movement per BS account in [from, to]
  const openingIn = {}; // the cut-over journal, when it falls in the period
  for (const je of entries || []) {
    if (je.status !== "posted" || !je.je_date || je.je_date < from || je.je_date > to) continue;
    // The cut-over from the previous system is where the books start: its
    // cash is part of cash at the beginning, not a cash flow.
    if (je.is_opening) {
      for (const l of je.lines || []) openingIn[l.account_code] = (openingIn[l.account_code] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0);
      continue;
    }
    for (const l of je.lines || []) {
      if (!acctBy[l.account_code]) continue;
      move[l.account_code] = (move[l.account_code] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0);
    }
  }
  const profit = r2(computeProfitLoss(entries, { from, to }).totals.netProfit);

  const lines = Object.fromEntries(CF_LINES.map((l) => [l.key, { ...l, amount: 0, accounts: [] }]));
  const cashCodes = [];
  for (const a of cfAccounts(coa)) {
    const key = map[a.code];
    if (key === "cash") { cashCodes.push(a.code); continue; }
    const effect = r2(-(move[a.code] || 0));
    const line = lines[key] || lines.unclassified;
    line.accounts.push({ code: a.code, name: a.name, amount: effect });
    line.amount = r2(line.amount + effect);
  }

  // A gain or loss on selling a fixed asset is in profit but isn't operating
  // cash: take it out of operating (non-cash adjustment) and put it with the
  // asset's proceeds in investing. The total doesn't change.
  const pl = plMovements(entries, { from, to }, {}, coa);
  plAccounts(coa).filter((a) => /on (asset|fixed asset) disposal|disposal of (fixed )?assets?/i.test(a.name)).forEach((a) => {
    const raw = r2(pl[a.code] || 0); // credit − debit: a gain is +
    lines.disposal.accounts.push({ code: a.code, name: a.name, amount: r2(-raw), pl: true });
    lines.disposal.amount = r2(lines.disposal.amount - raw);
    if (raw) {
      lines.ppe.accounts.push({ code: a.code, name: `${a.name} — part of the sale proceeds`, amount: raw, pl: true });
      lines.ppe.amount = r2(lines.ppe.amount + raw);
    }
  });

  const sections = { operating: profit, investing: 0, financing: 0 };
  CF_LINES.forEach((l) => { sections[l.section] = r2(sections[l.section] + lines[l.key].amount); });
  const netChange = r2(sections.operating + sections.investing + sections.financing);

  const cashAt = (d) => {
    const bs = computeBalanceSheet(entries, d, { fiscalYearStart });
    return r2(cashCodes.reduce((s, c) => s + (bs.byCode[c] || 0), 0));
  };
  const cashStart = r2(cashAt(dayBefore(from)) + cashCodes.reduce((s, c) => s + (openingIn[c] || 0), 0));
  const cashEnd = cashAt(to);
  const difference = r2(cashStart + netChange - cashEnd);

  return { from, to, lines, sections, profit, netChange, cashStart, cashEnd, difference, ties: Math.abs(difference) < 0.5, cashCodes, mapping: map };
}

// Posted journal lines on one account in [from, to], signed as cash effects
// (+ brings cash in) — the drill behind a statement line.
export function cashEffectLines(entries, code, { from, to }) {
  const out = [];
  for (const je of entries || []) {
    if (je.status !== "posted" || je.is_opening || !je.je_date || je.je_date < from || je.je_date > to) continue;
    (je.lines || []).forEach((l, i) => {
      if (l.account_code !== code) return;
      const amount = r2((Number(l.credit) || 0) - (Number(l.debit) || 0));
      if (!amount) return;
      out.push({
        key: `${je.je_number}-${i}`, date: je.je_date, je_number: je.je_number,
        source: !je.reference_type || je.reference_type === "manual" ? "manual" : je.reference_type,
        party: "", desc: l.description || je.memo || "", amount,
      });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
