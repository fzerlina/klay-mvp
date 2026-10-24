// Journal templates — Settings → Accounting → General Ledger → Journal
// templates. Pre-loaded at migration setup for the company's common
// transaction types; picking one on a new manual journal fills in its lines.
//
// A line is a side and an account. `account: null` means the account is
// chosen when the journal is created ("Select account during journal
// creation") — for the side that varies from one use to the next, like the
// expense on a vendor invoice. Amounts are never part of a template.
// Codes from data/seed/coa.js.
export const JOURNAL_TEMPLATES = [
  {
    id: "JT-01", name: "Vendor Invoice — Goods (non-PKP Vendor)",
    lines: [{ side: "debit", account: "1-1300" }, { side: "credit", account: "2-1100" }],
  },
  {
    id: "JT-02", name: "Vendor Invoice (domestic)",
    lines: [{ side: "debit", account: null }, { side: "debit", account: "1-5100" }, { side: "credit", account: "2-1100" }],
  },
  {
    id: "JT-03", name: "Vendor Credit Note",
    lines: [{ side: "debit", account: "2-1100" }, { side: "credit", account: null }, { side: "credit", account: "1-5100" }],
  },
  {
    id: "JT-04", name: "Prepaid Expense Payment",
    lines: [{ side: "debit", account: "1-4100" }, { side: "debit", account: "1-5100" }, { side: "credit", account: "2-1100" }],
  },
  {
    id: "JT-05", name: "Customer Invoice",
    lines: [{ side: "debit", account: "1-2100" }, { side: "credit", account: "4-1500" }, { side: "credit", account: "2-2100" }],
  },
  {
    id: "JT-06", name: "Customer Credit Note",
    lines: [{ side: "debit", account: "4-3100" }, { side: "debit", account: "2-2100" }, { side: "credit", account: "1-2100" }],
  },
  {
    id: "JT-07", name: "Depreciation",
    lines: [{ side: "debit", account: "6-3400" }, { side: "credit", account: "1-6310" }],
  },
  {
    id: "JT-08", name: "Prepaid Amortization",
    lines: [{ side: "debit", account: "6-2300" }, { side: "credit", account: "1-4100" }],
  },
  {
    id: "JT-09", name: "GRN Accrual",
    lines: [{ side: "debit", account: "1-1300" }, { side: "credit", account: "2-1200" }],
  },
];
