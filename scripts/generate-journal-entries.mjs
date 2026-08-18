// Generate a fresh seed/journalEntries.js with 300 balanced JEs against the
// current CoA. Run via:
//
//     node scripts/generate-journal-entries.mjs
//
// Deterministic: same seed produces the same output every run, so the demo
// stays stable across reloads. Re-run after CoA changes that rename codes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COA_BY_CODE } from "../src/data/seed/coa.js";
import { BILLS } from "../src/data/seed/bills.js";
import { INVOICES } from "../src/data/seed/invoices.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const OUT_PATH = path.resolve(__dirname, "../src/data/seed/journalEntries.js");

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20250423);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const moneyBetween = (min, max, step = 50000) =>
  Math.round((between(min, max) / step)) * step;

// ── Domain helpers ───────────────────────────────────────────────────────────
const acct = (code) => {
  const a = COA_BY_CODE[code];
  if (!a) throw new Error(`Unknown account: ${code}`);
  return { account_code: a.code, account_name: a.name };
};
const VAT_RATE = 0.11;
const vat = (n) => Math.round(n * VAT_RATE);
const wht2 = (n) => Math.round(n * 0.02);

const PEOPLE = ["Sarah Wijaya", "Budi Santoso", "Andi Prasetyo", "Rina Kusuma"];
const SYSTEM = "System";
const AI = "Klay AI";

const PRODUCT_LINES = [
  { rev: "4-1100", name: "Furniture", line: "FUR" },
  { rev: "4-1200", name: "Textiles",  line: "TEX" },
  { rev: "4-1300", name: "Packaging", line: "PKG" },
  { rev: "4-1400", name: "Electronics", line: "ELC" },
];

const BANK_ACCTS  = ["1-1300", "1-1400"];
const PETTY_CASH  = "1-1200";
const CASH_ON_HAND = "1-1100";
const AR          = "1-2100";
const AP          = "2-1100";
const ACCRUED     = "2-1200";
const VAT_IN      = "1-5100";
const VAT_OUT     = "2-2100";
const SALARIES_PAYABLE = "2-4100";
const WHT_PAYABLE = "2-2300";

const OPEX_CASH_ACCTS = [
  ["6-1200", "Marketing campaign"],
  ["6-1300", "Travel & client visit"],
  ["6-1600", "Trade show booth"],
  ["6-2300", "Monthly office rent"],
  ["6-2400", "Electricity & water"],
  ["6-2500", "Office supplies & stationery"],
  ["6-2600", "SaaS subscription renewal"],
  ["6-2700", "Professional services fee"],
  ["6-2800", "Insurance premium"],
  ["6-2900", "Telecom & internet"],
  ["6-3100", "Courier & shipping documents"],
  ["6-3200", "Equipment repair"],
  ["6-3300", "Staff training session"],
  ["6-3600", "Office cleaning service"],
  ["6-3800", "Industry membership renewal"],
  ["6-3900", "Legal advisory fee"],
];

const PURCHASE_EXPENSE_ACCTS = [
  ["6-2500", "Office supplies bulk order"],
  ["6-2600", "Annual SaaS license"],
  ["6-2700", "Audit firm engagement"],
  ["6-2900", "Telecom equipment lease"],
  ["6-3200", "Vehicle servicing contract"],
];

const INVENTORY_PURCHASE_ACCTS = [
  ["1-3100", "Raw materials — fabric"],
  ["1-3100", "Raw materials — wood"],
  ["1-3100", "Raw materials — metal components"],
  ["1-3300", "Finished goods received"],
];

// ── JE builder ───────────────────────────────────────────────────────────────
const collected = [];
let jeSeq = 0;

function pickStatus(forceDate) {
  // Most posted, sprinkle others. Within Apr 2025 (the "current month") more
  // pending/draft so the JE list has a believable backlog.
  const isCurrentMonth = forceDate.startsWith("2025-04");
  const r = rng();
  if (isCurrentMonth) {
    if (r < 0.55) return "posted";
    if (r < 0.78) return "draft";
    if (r < 0.95) return "pending";
    return "void";
  }
  if (r < 0.85) return "posted";
  if (r < 0.93) return "draft";
  if (r < 0.98) return "pending";
  return "void";
}

function makeJE({ je_date, reference_type = "manual", reference_id = null, memo, lines, created_by, posted_by, status }) {
  jeSeq++;
  const je_number = `JE-2025-${String(jeSeq).padStart(4, "0")}`;
  status = status || pickStatus(je_date);
  const created = created_by || pick(PEOPLE);
  const posted_by_final = status === "posted" ? (posted_by || pick(PEOPLE)) : null;
  const posted_date = status === "posted" ? offsetDays(je_date, between(0, 5)) : null;

  // Sanity: balance check
  const dr = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (dr !== cr) throw new Error(`JE ${je_number} unbalanced: DR ${dr} != CR ${cr}`);

  const je = {
    je_number,
    je_date,
    status,
    memo,
    reference_type,
    reference_id,
    created_by: created,
    created_date: je_date,
    posted_by: posted_by_final,
    posted_date,
    lines: lines.map((l) => ({
      account_code: l.account_code,
      account_name: l.account_name,
      debit: l.debit || 0,
      credit: l.credit || 0,
      description: l.description || "",
    })),
  };
  collected.push(je);
  return je;
}

function offsetDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Templates ────────────────────────────────────────────────────────────────
function tplProductSale(amount, opts = {}) {
  const pl = opts.productLine || pick(PRODUCT_LINES);
  const v = vat(amount);
  return {
    memo: `Sales — ${pl.name} delivery to customer`,
    lines: [
      { ...acct(AR),     debit: amount + v, credit: 0,      description: `${pl.name} sale` },
      { ...acct(pl.rev), debit: 0,          credit: amount, description: `Revenue ${pl.name}` },
      { ...acct(VAT_OUT), debit: 0,         credit: v,      description: "VAT output 11%" },
    ],
  };
}

function tplCashSale(amount) {
  const pl = pick(PRODUCT_LINES);
  const v = vat(amount);
  const bank = pick(BANK_ACCTS);
  return {
    memo: `Cash sale — ${pl.name}`,
    lines: [
      { ...acct(bank),    debit: amount + v, credit: 0,      description: `Cash receipt — ${pl.name}` },
      { ...acct(pl.rev),  debit: 0,          credit: amount, description: `Revenue ${pl.name}` },
      { ...acct(VAT_OUT), debit: 0,          credit: v,      description: "VAT output 11%" },
    ],
  };
}

function tplCollectAR(amount, opts = {}) {
  const bank = opts.bank || pick(BANK_ACCTS);
  return {
    memo: opts.memo || "Customer payment received against open invoice",
    lines: [
      { ...acct(bank), debit: amount, credit: 0,      description: "Cash receipt from customer" },
      { ...acct(AR),   debit: 0,      credit: amount, description: "Settle trade receivable" },
    ],
  };
}

function tplPurchaseInventory(amount, opts = {}) {
  const [code, desc] = opts.kind || pick(INVENTORY_PURCHASE_ACCTS);
  const v = vat(amount);
  return {
    memo: `Inventory purchase — ${desc.toLowerCase()}`,
    lines: [
      { ...acct(code),    debit: amount, credit: 0,           description: desc },
      { ...acct(VAT_IN),  debit: v,      credit: 0,           description: "VAT input 11%" },
      { ...acct(AP),      debit: 0,      credit: amount + v,  description: "Trade payable to supplier" },
    ],
  };
}

function tplPurchaseExpenseOnAccount(amount) {
  const [code, desc] = pick(PURCHASE_EXPENSE_ACCTS);
  const v = vat(amount);
  return {
    memo: `Bill received — ${desc.toLowerCase()}`,
    lines: [
      { ...acct(code),   debit: amount, credit: 0,          description: desc },
      { ...acct(VAT_IN), debit: v,      credit: 0,          description: "VAT input 11%" },
      { ...acct(AP),     debit: 0,      credit: amount + v, description: "Trade payable to supplier" },
    ],
  };
}

function tplPayAP(amount, opts = {}) {
  const bank = opts.bank || pick(BANK_ACCTS);
  return {
    memo: opts.memo || "Supplier payment cleared from operating bank",
    lines: [
      { ...acct(AP),   debit: amount, credit: 0,      description: "Settle trade payable" },
      { ...acct(bank), debit: 0,      credit: amount, description: "Cash disbursement" },
    ],
  };
}

function tplOperatingExpenseCash(amount, opts = {}) {
  const [code, desc] = opts.kind || pick(OPEX_CASH_ACCTS);
  const bank = opts.bank || pick(BANK_ACCTS);
  const includeVat = opts.vat !== false && rng() < 0.6;
  const v = includeVat ? vat(amount) : 0;
  const lines = [
    { ...acct(code), debit: amount, credit: 0, description: desc },
  ];
  if (v > 0) lines.push({ ...acct(VAT_IN), debit: v, credit: 0, description: "VAT input 11%" });
  lines.push({ ...acct(bank), debit: 0, credit: amount + v, description: "Bank disbursement" });
  return { memo: `${desc} — paid from operating bank`, lines };
}

function tplPayrollAccrue(month, opts = {}) {
  // Split gross payroll across roles, accrue and book WHT.
  const total = opts.total || moneyBetween(120000000, 165000000, 500000);
  const wht   = wht2(total);
  const sales = Math.round(total * 0.25);
  const mgmt  = Math.round(total * 0.30);
  const admin = Math.round(total * 0.20);
  const prod  = total - sales - mgmt - admin;
  return {
    memo: `Payroll accrual — ${month}`,
    lines: [
      { ...acct("6-2100"), debit: mgmt,  credit: 0, description: "Management salaries" },
      { ...acct("6-2200"), debit: admin, credit: 0, description: "Admin salaries" },
      { ...acct("6-1400"), debit: sales, credit: 0, description: "Sales salaries" },
      { ...acct("5-2000"), debit: prod,  credit: 0, description: "Production wages" },
      { ...acct(SALARIES_PAYABLE), debit: 0, credit: total - wht, description: "Net salaries owed to staff" },
      { ...acct(WHT_PAYABLE),      debit: 0, credit: wht,         description: "Article 21 withholding tax" },
    ],
  };
}

function tplPayrollPay(amount) {
  return {
    memo: "Payroll payment — payroll batch transfer",
    lines: [
      { ...acct(SALARIES_PAYABLE), debit: amount, credit: 0,      description: "Settle salaries payable" },
      { ...acct(BANK_ACCTS[0]),    debit: 0,      credit: amount, description: "Net payroll bank transfer" },
    ],
  };
}

function tplDepreciation(month, total) {
  const bldg = Math.round(total * 0.45);
  const oe   = Math.round(total * 0.25);
  const veh  = total - bldg - oe;
  return {
    memo: `Monthly depreciation — ${month}`,
    lines: [
      { ...acct("6-3400"), debit: total, credit: 0, description: "Depreciation expense for the month" },
      { ...acct("1-6210"), debit: 0, credit: bldg, description: "Accumulated depreciation — buildings" },
      { ...acct("1-6310"), debit: 0, credit: oe,   description: "Accumulated depreciation — office equipment" },
      { ...acct("1-6410"), debit: 0, credit: veh,  description: "Accumulated depreciation — vehicles" },
    ],
  };
}

function tplBankFee(amount) {
  const bank = pick(BANK_ACCTS);
  return {
    memo: "Bank service charge",
    lines: [
      { ...acct("6-3000"), debit: amount, credit: 0, description: "Monthly bank charges" },
      { ...acct(bank),     debit: 0, credit: amount, description: "Auto-debited from operating bank" },
    ],
  };
}

function tplInterestExpense(amount) {
  return {
    memo: "Interest expense — bank loan",
    lines: [
      { ...acct("7-1100"), debit: amount, credit: 0, description: "Loan interest charge" },
      { ...acct(BANK_ACCTS[1]), debit: 0, credit: amount, description: "Auto-debited from reserve bank" },
    ],
  };
}

function tplInterestIncome(amount) {
  return {
    memo: "Bank interest credited",
    lines: [
      { ...acct(BANK_ACCTS[0]), debit: amount, credit: 0, description: "Interest credited" },
      { ...acct("4-2100"),      debit: 0, credit: amount, description: "Interest income" },
    ],
  };
}

function tplTaxProvision(amount) {
  return {
    memo: "Quarterly income tax provision",
    lines: [
      { ...acct("8-1100"), debit: amount, credit: 0, description: "Current income tax expense" },
      { ...acct("2-2200"), debit: 0, credit: amount, description: "Income tax payable" },
    ],
  };
}

// ── Anchored entries linked to seed bills / invoices ─────────────────────────
//
// For each bill in seed/bills.js:
//   - Receipt JE  (DR Inventory or Expense + DR VAT-in, CR AP)
//   - Payment JE  (DR AP, CR Bank) if pay status is paid
//
// For each invoice in seed/invoices.js:
//   - Issuance JE (DR AR, CR Revenue, CR VAT-out) if not draft
//   - Collection JE (DR Bank, CR AR) if pay status is paid
//
// Links are via reference_type + reference_id, so the GL drawer can show
// the source document.

function emitBillJEs(bill) {
  const { id, vendor, vendorName, total, dpp, date, due, items, pay, approval } = bill;
  if (approval === "draft") return; // unapproved drafts don't post
  const isInventory = items.some((it) => it.acct.startsWith("6-1") || it.acct.startsWith("1-3"));
  const expenseAcct = isInventory ? "1-3100" : "6-2700"; // simplified mapping
  const expenseDesc = isInventory ? "Inventory purchase from supplier" : "Service / professional fee";
  makeJE({
    je_date: date,
    reference_type: "bill",
    reference_id: id,
    memo: `Vendor bill received — ${vendorName}`,
    lines: [
      { ...acct(expenseAcct), debit: dpp,   credit: 0,     description: expenseDesc },
      { ...acct(AP),          debit: 0,     credit: total, description: `Trade payable to ${vendorName}` },
    ],
    status: "posted",
  });
  if (pay === "paid") {
    makeJE({
      je_date: offsetDays(due, -between(2, 10)),
      reference_type: "bill_payment",
      reference_id: id,
      memo: `Bill payment cleared — ${vendorName}`,
      lines: [
        { ...acct(AP),            debit: total, credit: 0, description: "Settle trade payable" },
        { ...acct(BANK_ACCTS[0]), debit: 0, credit: total, description: "Operating bank transfer" },
      ],
      status: "posted",
    });
  }
}

function emitInvoiceJEs(inv) {
  const { id, customerName, total, dpp, date, due, approval, payStatus, items } = inv;
  if (approval === "draft") return;
  const productLine = pick(PRODUCT_LINES);
  makeJE({
    je_date: date,
    reference_type: "invoice",
    reference_id: id,
    memo: `Invoice issued — ${customerName}`,
    lines: [
      { ...acct(AR),             debit: total, credit: 0,  description: `Trade receivable from ${customerName}` },
      { ...acct(productLine.rev), debit: 0, credit: dpp,   description: `Revenue ${productLine.name}` },
    ],
    status: "posted",
  });
  if (payStatus === "paid") {
    makeJE({
      je_date: offsetDays(due, -between(0, 8)),
      reference_type: "invoice_payment",
      reference_id: id,
      memo: `Customer payment received — ${customerName}`,
      lines: [
        { ...acct(BANK_ACCTS[0]), debit: total, credit: 0,    description: "Bank receipt" },
        { ...acct(AR),            debit: 0, credit: total,    description: "Settle receivable" },
      ],
      status: "posted",
    });
  }
}

// ── Generation driver ────────────────────────────────────────────────────────
const MONTHS = [
  { name: "Jan 2025", start: "2025-01-02", end: "2025-01-31", id: "01" },
  { name: "Feb 2025", start: "2025-02-03", end: "2025-02-28", id: "02" },
  { name: "Mar 2025", start: "2025-03-03", end: "2025-03-31", id: "03" },
  { name: "Apr 2025", start: "2025-04-01", end: "2025-04-23", id: "04" }, // demo "today"
];

function randomDateIn(month) {
  const start = new Date(month.start + "T00:00:00").getTime();
  const end   = new Date(month.end + "T00:00:00").getTime();
  const t = start + Math.floor(rng() * (end - start));
  return new Date(t).toISOString().slice(0, 10);
}

// 1. Anchored to the bills / invoices flagged isAnchor in their seeds.
// These are the hand-curated demo records the GL drawer "open source"
// linkage relies on. Synthetic bills/invoices without the flag don't need
// linked JEs to display in their own pages.
BILLS.filter((b) => b.isAnchor).forEach(emitBillJEs);
INVOICES.filter((i) => i.isAnchor).forEach(emitInvoiceJEs);
const anchoredCount = collected.length;

// 2. Calendar JEs (recurring patterns)
MONTHS.forEach((m) => {
  // Payroll accrual at month-end
  makeJE({
    je_date: m.end,
    memo: `Payroll accrual — ${m.name}`,
    ...tplPayrollAccrue(m.name),
    status: "posted",
  });
  // Payroll payment a few days into next month (use last working day for Apr)
  const payDate = m.id === "04" ? "2025-04-23" : offsetDays(m.end, between(2, 4));
  const payAmount = moneyBetween(115000000, 160000000, 500000);
  makeJE({
    je_date: payDate,
    memo: `Payroll payment — ${m.name}`,
    ...tplPayrollPay(payAmount),
    status: m.id === "04" ? pickStatus(payDate) : "posted",
  });
  // Monthly depreciation
  makeJE({
    je_date: m.end,
    memo: `Monthly depreciation — ${m.name}`,
    ...tplDepreciation(m.name, moneyBetween(8500000, 12000000, 250000)),
    status: m.id === "04" ? pickStatus(m.end) : "posted",
  });
  // Bank fees twice a month
  for (let i = 0; i < 2; i++) {
    makeJE({
      je_date: randomDateIn(m),
      ...tplBankFee(moneyBetween(125000, 850000, 25000)),
    });
  }
  // Interest expense end of month
  makeJE({
    je_date: m.end,
    ...tplInterestExpense(moneyBetween(2400000, 4200000, 100000)),
    status: m.id === "04" ? pickStatus(m.end) : "posted",
  });
  // Interest income mid-month
  if (rng() < 0.7) {
    makeJE({
      je_date: offsetDays(m.start, 14),
      ...tplInterestIncome(moneyBetween(125000, 875000, 25000)),
    });
  }
});
// Tax provision at end of Q1
makeJE({
  je_date: "2025-03-31",
  ...tplTaxProvision(moneyBetween(38000000, 48000000, 500000)),
  status: "posted",
});

const calendarCount = collected.length - anchoredCount;

// 3. Random business activity to reach 300
const TARGET = 300;
const txDist = [
  { weight: 28, fn: () => tplProductSale(moneyBetween(8000000, 95000000, 250000)) },
  { weight: 8,  fn: () => tplCashSale(moneyBetween(1200000, 18000000, 100000)) },
  { weight: 18, fn: () => tplCollectAR(moneyBetween(8000000, 95000000, 250000)) },
  { weight: 14, fn: () => tplPurchaseInventory(moneyBetween(5000000, 65000000, 250000)) },
  { weight: 8,  fn: () => tplPurchaseExpenseOnAccount(moneyBetween(2500000, 35000000, 250000)) },
  { weight: 11, fn: () => tplPayAP(moneyBetween(5000000, 65000000, 250000)) },
  { weight: 13, fn: () => tplOperatingExpenseCash(moneyBetween(450000, 14000000, 50000)) },
];
const totalWeight = txDist.reduce((s, t) => s + t.weight, 0);
function pickTemplate() {
  const r = rng() * totalWeight;
  let acc = 0;
  for (const t of txDist) { acc += t.weight; if (r < acc) return t.fn; }
  return txDist[0].fn;
}

while (collected.length < TARGET) {
  const m = pick(MONTHS);
  const date = randomDateIn(m);
  const tpl = pickTemplate();
  const built = tpl();
  makeJE({ je_date: date, memo: built.memo, lines: built.lines });
}

// ── Sort by date and re-number sequentially ──────────────────────────────────
collected.sort((a, b) => {
  if (a.je_date !== b.je_date) return a.je_date.localeCompare(b.je_date);
  // Stable secondary sort to keep deterministic output
  return a.je_number.localeCompare(b.je_number);
});
collected.forEach((je, i) => {
  je.je_number = `JE-2025-${String(i + 1).padStart(4, "0")}`;
});

// ── Validation pass ──────────────────────────────────────────────────────────
let totalDr = 0, totalCr = 0;
const acctTotals = {};
for (const je of collected) {
  for (const l of je.lines) {
    totalDr += l.debit;
    totalCr += l.credit;
    if (!COA_BY_CODE[l.account_code]) {
      throw new Error(`JE ${je.je_number} references missing account ${l.account_code}`);
    }
    const t = (acctTotals[l.account_code] ||= { dr: 0, cr: 0 });
    t.dr += l.debit;
    t.cr += l.credit;
  }
}
if (totalDr !== totalCr) {
  throw new Error(`Total DR ${totalDr} != Total CR ${totalCr} across ${collected.length} JEs`);
}

console.log(`Generated ${collected.length} JEs`);
console.log(`  anchored to bills/invoices: ${anchoredCount}`);
console.log(`  recurring calendar:         ${calendarCount}`);
console.log(`  synthetic business:         ${collected.length - anchoredCount - calendarCount}`);
console.log(`  total DR / CR (should match): ${totalDr.toLocaleString()} / ${totalCr.toLocaleString()}`);
console.log(`  distinct accounts touched:   ${Object.keys(acctTotals).length}`);

// ── Emit the seed module ─────────────────────────────────────────────────────
function fmt(je) {
  return (
    "  " +
    JSON.stringify(je)
      .replace(/"([a-z_]+)":/g, "$1:")
      .replace(/,([a-z_]+):/g, ", $1:")
  );
}
const header = `// AUTO-GENERATED by scripts/generate-journal-entries.mjs.
// 300 balanced JEs against the current CoA, deterministic from seed 20250423.
// Re-run when the CoA changes:
//
//   node scripts/generate-journal-entries.mjs
//
// Field shape (snake_case to match the canonical ERP schema):
//   { je_number, je_date, status, memo, reference_type, reference_id,
//     created_by, created_date, posted_by, posted_date,
//     lines: [{ account_code, account_name, debit, credit, description }] }

export const JOURNAL_ENTRIES = [
`;
const body = collected.map(fmt).join(",\n");
const footer = `
];

// ── Demo-narrative side maps ────────────────────────────────────────────────
// These describe demo facts that hang off specific JE numbers. The numbers
// will change if you re-run the generator with a different seed. After regen,
// re-anchor by editing the JE numbers below to match meaningful entries in
// the new run (typically: a payroll, a bill receipt, an invoice issuance).

// Bank-reconciliation status keyed by JE number. Missing = unmatched.
export const RECONCILIATION = {};
${collected
    .filter((je) => je.reference_type !== "manual" && je.status === "posted")
    .slice(0, 24)
    .map((je) => `RECONCILIATION[${JSON.stringify(je.je_number)}] = "matched";`)
    .join("\n")}

// Anomaly flags for the AI to surface. One curated entry — the largest
// payroll accrual gets flagged as unusually high.
const ANOMALY_JE = ${JSON.stringify(
    [...collected]
      .filter((je) => je.memo.startsWith("Payroll accrual"))
      .sort((a, b) => b.lines.reduce((s, l) => s + l.debit, 0) - a.lines.reduce((s, l) => s + l.debit, 0))[0]?.je_number
  )};
export const ANOMALY_FLAGS = ANOMALY_JE ? { [ANOMALY_JE]: 1 } : {};
export const ANOMALIES = ANOMALY_JE ? {
  [ANOMALY_JE]: {
    type: "warn",
    flag: "Unusually high value",
    detail: "Monthly payroll accrual exceeds the trailing 3-month average by more than 15%.",
    grid: [
      { label: "3-month average", val: "Rp 138.500.000" },
      { label: "Current",          val: "Rp 162.000.000" },
      { label: "Variance",         val: "+17.0%" },
    ],
  },
} : {};

// FX-rate metadata for entries booked against foreign-currency invoices.
// Empty by default — re-run leaves this empty unless we curate it.
export const KURS = {};

// Dimension tags applied to each JE (Department / Project / Branch). Empty
// until re-anchored to specific JEs in the new dataset.
export const JE_DIMENSIONS = {};

// Bill display reference (separate from a vendor's invoice number). Reads
// from BILLS so renaming a bill display ref propagates.
export const BILL_REFS = {};
`;

fs.writeFileSync(OUT_PATH, header + body + footer);
console.log(`Wrote ${OUT_PATH}`);
