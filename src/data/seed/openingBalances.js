// Opening balances as of 1 Jan 2025 — the state of the books before any JE
// in JOURNAL_ENTRIES is posted. Trial Balance = opening + sum(posted JE lines).
//
// Each entry: { account_code, debit, credit }. By construction, total debits
// equal total credits across the whole list (a balanced opening trial balance).
//
// References account codes in seed/coa.js — keep in sync if either changes.
//
// The previous system's open receivables and payables sit in Other Receivables
// and Other Payables, not in the trade control accounts: they weren't migrated
// as invoices and bills, and a control account holds only what its subledger
// can account for, document by document.

export const OPENING_BALANCES = [
  // Debits — assets at opening
  { account_code: "1-1100", debit:  25000000, credit: 0 },         // Cash on Hand
  { account_code: "1-1500", debit: 425000000, credit: 0 },         // Bank — BCA Operating
  { account_code: "1-1400", debit: 200000000, credit: 0 },         // Bank — Mandiri Operating
  { account_code: "1-2300", debit:  95000000, credit: 0 },         // Other Receivables (carry-over; see note above)
  { account_code: "1-1300", debit:  85000000, credit: 0 },         // Raw Materials
  { account_code: "1-1310", debit:  95000000, credit: 0 },         // Finished Goods
  { account_code: "1-6300", debit:  65000000, credit: 0 },         // Office Equipment
  { account_code: "1-6400", debit: 285000000, credit: 0 },         // Vehicles
  { account_code: "1-6310", debit: 0,         credit:  18000000 }, // AccDep — Office Equipment (contra)
  { account_code: "1-6410", debit: 0,         credit:  72000000 }, // AccDep — Vehicles (contra)

  // Credits — liabilities & equity at opening
  { account_code: "2-1150", debit: 0, credit:  87000000 },         // Other Payables (carry-over; see note above)
  { account_code: "2-4100", debit: 0, credit: 145000000 },         // Salaries Payable (Dec accrual)
  { account_code: "2-5100", debit: 0, credit: 350000000 },         // Long-term Bank Loans
  { account_code: "3-1100", debit: 0, credit: 500000000 },         // Share Capital
  { account_code: "3-1300", debit: 0, credit: 103000000 },         // Retained Earnings (prior years)
];

// Helper: returns { [account_code]: signed_balance } where positive means a
// debit balance, negative means a credit balance. Used by Trial Balance.
export function openingByCode() {
  const out = {};
  for (const r of OPENING_BALANCES) {
    out[r.account_code] = (out[r.account_code] || 0) + (r.debit - r.credit);
  }
  return out;
}
