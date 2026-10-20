// Default accounts — Settings → Accounting → Default accounts.
//
// The company-wide accounts each module falls back to or pre-fills when the
// record in hand doesn't name its own: the payable a bill credits, the
// receivable a new customer starts with, where Record payment books a small
// gap, where bank reconciliation books a fee… Before this they were constants
// scattered through lib/ and pages/.
//
// Like ITEM_CATEGORY_ACCOUNTS (items.js), this object is the LIVE registry:
// code reads it at call time (DEFAULT_ACCOUNTS.ap), and the settings page
// writes into it through AccountingSettingsContext.setDefaultAccount, so a
// change reaches every module at once.
//
// What's NOT here, because it's set per record and edited where the record
// lives (the Default accounts page lists it all the same):
//   • VAT and withholding accounts — on each tax code (taxCodes.js)
//   • each bank account's GL account — bankAccounts.js
//   • inventory, sales and COGS per item category — items.js
//   • asset, depreciation and disposal per asset category — fixedAssets.js
//   • the starting expense per vendor category — moduleSettings.js
//
// Codes from data/seed/coa.js.
export const DEFAULT_ACCOUNTS = {
  // Payables
  ap: "2-1100",                 // Accounts Payable — Trade
  billExpense: "6-4000",        // Miscellaneous Office Expense
  paymentDifference: "6-3000",  // Bank Charges
  // Receivables
  ar: "1-2100",                 // Accounts Receivable — Trade
  revenue: "4-1500",            // Service Revenue
  // Cash
  cash: "1-1100",               // Cash on Hand
  pettyCash: "1-1200",          // Petty Cash
  // Bank reconciliation
  bankIdr: "11110",             // Bank IDR
  bankFx: "11120",              // Bank Foreign Currency
  bankFee: "72050",             // Other Non-Operating Expenses
  interestIncome: "71010",      // Interest Income
  interestTax: "8-1300",        // Final Tax (PPh Final)
  // Inventory
  inventory: "1-3100",          // Raw Materials
  inventoryAdjustment: "5-1500", // Inventory Adjustments
  openingStock: "3-1300",       // Retained Earnings
  // Year end
  retainedEarnings: "3-1300",   // Retained Earnings
};
