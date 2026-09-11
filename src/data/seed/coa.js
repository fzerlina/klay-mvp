// Chart of Accounts — single source of truth.
//
// Schema:
//   Group nodes:   { id, type:'group', level, parent?, label }
//   Account nodes: { id, code, name, type, normal_balance, fs, section, parent, level, is_active }
//
//   type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'contra_asset' | 'contra_revenue'
//   normal_balance: 'debit' | 'credit'
//   fs: 'BS' (Balance Sheet) | 'PL' (Profit & Loss)
//   section: free-form grouping label used by Trial Balance (e.g. "Current Asset")
//
// 102 leaf accounts + 25 groups. English-only. Codes follow Indonesian-SMB
// convention (1-asset, 2-liability, 3-equity, 4-revenue, 5-cogs, 6-opex,
// 7-other, 8-tax). Every JE in the seed references one of these codes.

export const COA = [
  // ─── ASSETS ────────────────────────────────────────────────────────────────
  { id: 'g-asset',          type: 'group', level: 0,                              label: 'Assets' },
  { id: 'g-current-asset',  type: 'group', level: 1, parent: 'g-asset',           label: 'Current Assets' },
  { id: 'g-cash',           type: 'group', level: 2, parent: 'g-current-asset',   label: 'Cash and Cash Equivalents' },
  { id: '1-1100', code: '1-1100', name: 'Cash on Hand',                  type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-cash',  level: 3, is_active: true },
  { id: '1-1200', code: '1-1200', name: 'Petty Cash',                    type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-cash',  level: 3, is_active: true },
  { id: '1-1300', code: '1-1300', name: 'Bank — BCA Operating',          type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-cash',  level: 3, is_active: true },
  { id: '1-1400', code: '1-1400', name: 'Bank — Mandiri Operating',      type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-cash',  level: 3, is_active: true },

  { id: 'g-ar',             type: 'group', level: 2, parent: 'g-current-asset',   label: 'Trade Receivables' },
  { id: '1-2100', code: '1-2100', name: 'Accounts Receivable — Trade',   type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-ar', level: 3, is_active: true },
  { id: '1-2200', code: '1-2200', name: 'Allowance for Doubtful Accounts', type: 'contra_asset', normal_balance: 'credit', fs: 'BS', section: 'Current Asset', parent: 'g-ar', level: 3, is_active: true },
  { id: '1-2300', code: '1-2300', name: 'Other Receivables',             type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-ar', level: 3, is_active: true },

  { id: 'g-inventory',      type: 'group', level: 2, parent: 'g-current-asset',   label: 'Inventory' },
  { id: '1-3100', code: '1-3100', name: 'Raw Materials',                 type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-inventory', level: 3, is_active: true },
  { id: '1-3200', code: '1-3200', name: 'Work in Progress',              type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-inventory', level: 3, is_active: true },
  { id: '1-3300', code: '1-3300', name: 'Finished Goods',                type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-inventory', level: 3, is_active: true },

  { id: 'g-prepaid',        type: 'group', level: 2, parent: 'g-current-asset',   label: 'Prepaid Expenses' },
  { id: '1-4100', code: '1-4100', name: 'Prepaid Rent',                  type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-prepaid', level: 3, is_active: true },
  { id: '1-4200', code: '1-4200', name: 'Prepaid Insurance',             type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-prepaid', level: 3, is_active: true },
  { id: '1-4300', code: '1-4300', name: 'Prepaid Software Licenses',     type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-prepaid', level: 3, is_active: true },

  { id: 'g-other-current',  type: 'group', level: 2, parent: 'g-current-asset',   label: 'Other Current Assets' },
  { id: '1-5100', code: '1-5100', name: 'VAT Input (PPN Masukan)',       type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-other-current', level: 3, is_active: true },
  { id: '1-5200', code: '1-5200', name: 'Advance to Suppliers',          type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-other-current', level: 3, is_active: true },
  { id: '1-5300', code: '1-5300', name: 'Employee Advances',             type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Current Asset', parent: 'g-other-current', level: 3, is_active: true },

  { id: 'g-non-current-asset', type: 'group', level: 1, parent: 'g-asset',        label: 'Non-Current Assets' },
  { id: 'g-ppe',            type: 'group', level: 2, parent: 'g-non-current-asset', label: 'Property, Plant & Equipment' },
  { id: '1-6100', code: '1-6100', name: 'Land',                          type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6200', code: '1-6200', name: 'Buildings',                     type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6210', code: '1-6210', name: 'Accumulated Depreciation — Buildings',     type: 'contra_asset', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6300', code: '1-6300', name: 'Office Equipment',              type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6310', code: '1-6310', name: 'Accumulated Depreciation — Office Equipment', type: 'contra_asset', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6400', code: '1-6400', name: 'Vehicles',                      type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6410', code: '1-6410', name: 'Accumulated Depreciation — Vehicles',      type: 'contra_asset', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6500', code: '1-6500', name: 'Machinery',                     type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  { id: '1-6510', code: '1-6510', name: 'Accumulated Depreciation — Machinery',    type: 'contra_asset', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },
  // Fixed Asset Clearing — a suspense account for costs received but not yet
  // capitalised. Nothing posts to it today: capitalise-from-bill via a clearing
  // account is out of scope for the Fixed Asset register (PRD §10). Kept because
  // a real chart carries one, and because that flow is a candidate to come back.
  { id: '1-6900', code: '1-6900', name: 'Fixed Asset Clearing',          type: 'asset',         normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-ppe', level: 3, is_active: true },

  { id: 'g-intangible',     type: 'group', level: 2, parent: 'g-non-current-asset', label: 'Intangible Assets' },
  { id: '1-7100', code: '1-7100', name: 'Software & Licenses',           type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-intangible', level: 3, is_active: true },
  { id: '1-7110', code: '1-7110', name: 'Accumulated Amortisation — Software', type: 'contra_asset', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Asset', parent: 'g-intangible', level: 3, is_active: true },

  { id: 'g-other-nc',       type: 'group', level: 2, parent: 'g-non-current-asset', label: 'Other Non-Current Assets' },
  { id: '1-8100', code: '1-8100', name: 'Security Deposits',             type: 'asset', normal_balance: 'debit',  fs: 'BS', section: 'Non-Current Asset', parent: 'g-other-nc', level: 3, is_active: true },

  // ─── LIABILITIES ───────────────────────────────────────────────────────────
  { id: 'g-liab',           type: 'group', level: 0,                              label: 'Liabilities' },
  { id: 'g-current-liab',   type: 'group', level: 1, parent: 'g-liab',            label: 'Current Liabilities' },
  { id: 'g-trade-payable',  type: 'group', level: 2, parent: 'g-current-liab',    label: 'Trade Payables' },
  { id: '2-1100', code: '2-1100', name: 'Accounts Payable — Trade',      type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-trade-payable', level: 3, is_active: true },
  { id: '2-1200', code: '2-1200', name: 'Accrued Expenses',              type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-trade-payable', level: 3, is_active: true },

  { id: 'g-tax-payable',    type: 'group', level: 2, parent: 'g-current-liab',    label: 'Tax Payables' },
  { id: '2-2100', code: '2-2100', name: 'VAT Output (PPN Keluaran)',     type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-tax-payable', level: 3, is_active: true },
  { id: '2-2200', code: '2-2200', name: 'Income Tax Payable',            type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-tax-payable', level: 3, is_active: true },
  { id: '2-2300', code: '2-2300', name: 'Withholding Tax Payable',       type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-tax-payable', level: 3, is_active: true },

  { id: 'g-short-debt',     type: 'group', level: 2, parent: 'g-current-liab',    label: 'Short-term Debt' },
  { id: '2-3100', code: '2-3100', name: 'Short-term Bank Loans',         type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-short-debt', level: 3, is_active: true },
  { id: '2-3200', code: '2-3200', name: 'Current Portion of Long-term Debt', type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-short-debt', level: 3, is_active: true },

  { id: 'g-other-current-liab', type: 'group', level: 2, parent: 'g-current-liab', label: 'Other Current Liabilities' },
  { id: '2-4100', code: '2-4100', name: 'Salaries & Wages Payable',      type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-other-current-liab', level: 3, is_active: true },
  { id: '2-4200', code: '2-4200', name: 'Customer Deposits',             type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-other-current-liab', level: 3, is_active: true },
  { id: '2-4300', code: '2-4300', name: 'Deferred Revenue',              type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-other-current-liab', level: 3, is_active: true },
  { id: '2-4400', code: '2-4400', name: 'Bonus Payable',                 type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-other-current-liab', level: 3, is_active: true },
  { id: '2-4500', code: '2-4500', name: 'Dividends Payable',             type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Current Liability', parent: 'g-other-current-liab', level: 3, is_active: true },

  { id: 'g-nc-liab',        type: 'group', level: 1, parent: 'g-liab',            label: 'Non-Current Liabilities' },
  { id: '2-5100', code: '2-5100', name: 'Long-term Bank Loans',          type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Liability', parent: 'g-nc-liab', level: 2, is_active: true },
  { id: '2-5200', code: '2-5200', name: 'Lease Liabilities (PSAK 73)',   type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Liability', parent: 'g-nc-liab', level: 2, is_active: true },
  { id: '2-5300', code: '2-5300', name: 'Deferred Tax Liability',        type: 'liability', normal_balance: 'credit', fs: 'BS', section: 'Non-Current Liability', parent: 'g-nc-liab', level: 2, is_active: true },

  // ─── EQUITY ────────────────────────────────────────────────────────────────
  { id: 'g-equity',         type: 'group', level: 0,                              label: 'Equity' },
  { id: '3-1100', code: '3-1100', name: 'Share Capital',                 type: 'equity', normal_balance: 'credit', fs: 'BS', section: 'Equity', parent: 'g-equity', level: 1, is_active: true },
  { id: '3-1200', code: '3-1200', name: 'Additional Paid-in Capital',    type: 'equity', normal_balance: 'credit', fs: 'BS', section: 'Equity', parent: 'g-equity', level: 1, is_active: true },
  { id: '3-1300', code: '3-1300', name: 'Retained Earnings',             type: 'equity', normal_balance: 'credit', fs: 'BS', section: 'Equity', parent: 'g-equity', level: 1, is_active: true },
  { id: '3-1400', code: '3-1400', name: 'Current Year Earnings',         type: 'equity', normal_balance: 'credit', fs: 'BS', section: 'Equity', parent: 'g-equity', level: 1, is_active: true },
  { id: '3-1500', code: '3-1500', name: 'Dividends Distributed',         type: 'equity', normal_balance: 'debit',  fs: 'BS', section: 'Equity', parent: 'g-equity', level: 1, is_active: true },

  // ─── REVENUE ───────────────────────────────────────────────────────────────
  { id: 'g-revenue',        type: 'group', level: 0,                              label: 'Revenue' },
  { id: 'g-operating-rev',  type: 'group', level: 1, parent: 'g-revenue',         label: 'Operating Revenue' },
  { id: '4-1100', code: '4-1100', name: 'Product Sales — Furniture',     type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Revenue', parent: 'g-operating-rev', level: 2, is_active: true },
  { id: '4-1200', code: '4-1200', name: 'Product Sales — Textiles',      type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Revenue', parent: 'g-operating-rev', level: 2, is_active: true },
  { id: '4-1300', code: '4-1300', name: 'Product Sales — Packaging',     type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Revenue', parent: 'g-operating-rev', level: 2, is_active: true },
  { id: '4-1400', code: '4-1400', name: 'Product Sales — Electronics',   type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Revenue', parent: 'g-operating-rev', level: 2, is_active: true },
  { id: '4-1500', code: '4-1500', name: 'Service Revenue',               type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Revenue', parent: 'g-operating-rev', level: 2, is_active: true },

  { id: 'g-other-rev',      type: 'group', level: 1, parent: 'g-revenue',         label: 'Other Revenue' },
  { id: '4-2100', code: '4-2100', name: 'Interest Income',               type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Other Revenue', parent: 'g-other-rev', level: 2, is_active: true },
  { id: '4-2200', code: '4-2200', name: 'Foreign Exchange Gain',         type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Other Revenue', parent: 'g-other-rev', level: 2, is_active: true },
  { id: '4-2300', code: '4-2300', name: 'Miscellaneous Income',          type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Other Revenue', parent: 'g-other-rev', level: 2, is_active: true },
  { id: '4-2400', code: '4-2400', name: 'Gain on Asset Disposal',        type: 'revenue', normal_balance: 'credit', fs: 'PL', section: 'Other Revenue', parent: 'g-other-rev', level: 2, is_active: true },

  { id: 'g-contra-rev',     type: 'group', level: 1, parent: 'g-revenue',         label: 'Contra Revenue' },
  { id: '4-3100', code: '4-3100', name: 'Sales Returns and Allowances',  type: 'contra_revenue', normal_balance: 'debit', fs: 'PL', section: 'Revenue', parent: 'g-contra-rev', level: 2, is_active: true },
  { id: '4-3200', code: '4-3200', name: 'Sales Discounts',               type: 'contra_revenue', normal_balance: 'debit', fs: 'PL', section: 'Revenue', parent: 'g-contra-rev', level: 2, is_active: true },

  // ─── COST OF GOODS SOLD ────────────────────────────────────────────────────
  { id: 'g-cogs',           type: 'group', level: 0,                              label: 'Cost of Goods Sold' },
  { id: '5-1100', code: '5-1100', name: 'Materials Cost',                type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1200', code: '5-1200', name: 'Direct Labor',                  type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1300', code: '5-1300', name: 'Manufacturing Overhead',        type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1400', code: '5-1400', name: 'Freight In',                    type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1500', code: '5-1500', name: 'Inventory Adjustments',         type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1600', code: '5-1600', name: 'Production Utilities',          type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1700', code: '5-1700', name: 'Subcontracted Services',        type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1800', code: '5-1800', name: 'Quality Control & Testing',     type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-1900', code: '5-1900', name: 'Packaging Materials',           type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },
  { id: '5-2000', code: '5-2000', name: 'Production Wages',              type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'COGS', parent: 'g-cogs', level: 1, is_active: true },

  // ─── OPERATING EXPENSES ────────────────────────────────────────────────────
  { id: 'g-opex',           type: 'group', level: 0,                              label: 'Operating Expenses' },
  { id: 'g-selling',        type: 'group', level: 1, parent: 'g-opex',            label: 'Selling Expenses' },
  { id: '6-1100', code: '6-1100', name: 'Sales Commissions',             type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },
  { id: '6-1200', code: '6-1200', name: 'Marketing & Advertising',       type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },
  { id: '6-1300', code: '6-1300', name: 'Travel & Entertainment',        type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },
  { id: '6-1400', code: '6-1400', name: 'Sales Salaries',                type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },
  { id: '6-1500', code: '6-1500', name: 'Customer Support',              type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },
  { id: '6-1600', code: '6-1600', name: 'Trade Show Expenses',           type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },
  { id: '6-1700', code: '6-1700', name: 'Sales Office Rent',             type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },
  { id: '6-1800', code: '6-1800', name: 'Sales Vehicle Expense',         type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-selling', level: 2, is_active: true },

  { id: 'g-ga',             type: 'group', level: 1, parent: 'g-opex',            label: 'General & Administrative' },
  { id: '6-2100', code: '6-2100', name: 'Management Salaries',           type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2200', code: '6-2200', name: 'Admin Salaries',                type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2300', code: '6-2300', name: 'Office Rent',                   type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2400', code: '6-2400', name: 'Office Utilities',              type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2500', code: '6-2500', name: 'Office Supplies',               type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2600', code: '6-2600', name: 'Software Subscriptions',        type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2700', code: '6-2700', name: 'Professional Services',         type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2800', code: '6-2800', name: 'Insurance',                     type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-2900', code: '6-2900', name: 'Telecommunications',            type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3000', code: '6-3000', name: 'Bank Charges',                  type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3100', code: '6-3100', name: 'Postage & Courier',             type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3200', code: '6-3200', name: 'Repairs & Maintenance',         type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3300', code: '6-3300', name: 'Training & Development',        type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3400', code: '6-3400', name: 'Depreciation Expense',          type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3500', code: '6-3500', name: 'Bad Debt Expense',              type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3600', code: '6-3600', name: 'Office Cleaning',               type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3700', code: '6-3700', name: 'Recruitment Expense',           type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3800', code: '6-3800', name: 'Subscriptions & Memberships',   type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-3900', code: '6-3900', name: 'Legal Fees',                    type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },
  { id: '6-4000', code: '6-4000', name: 'Miscellaneous Office Expense',  type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'OpEx', parent: 'g-ga', level: 2, is_active: true },

  // ─── OTHER INCOME / EXPENSE ────────────────────────────────────────────────
  { id: 'g-other-exp',      type: 'group', level: 0,                              label: 'Other Expenses' },
  { id: '7-1100', code: '7-1100', name: 'Interest Expense',              type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Other', parent: 'g-other-exp', level: 1, is_active: true },
  { id: '7-1200', code: '7-1200', name: 'Foreign Exchange Loss',         type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Other', parent: 'g-other-exp', level: 1, is_active: true },
  { id: '7-1300', code: '7-1300', name: 'Loss on Asset Disposal',        type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Other', parent: 'g-other-exp', level: 1, is_active: true },
  { id: '7-1400', code: '7-1400', name: 'Bank Loan Origination Fees',    type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Other', parent: 'g-other-exp', level: 1, is_active: true },
  { id: '7-1500', code: '7-1500', name: 'Miscellaneous Other Expense',   type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Other', parent: 'g-other-exp', level: 1, is_active: true },

  // ─── INCOME TAX ────────────────────────────────────────────────────────────
  { id: 'g-tax-exp',        type: 'group', level: 0,                              label: 'Income Tax' },
  { id: '8-1100', code: '8-1100', name: 'Current Income Tax Expense',    type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Tax', parent: 'g-tax-exp', level: 1, is_active: true },
  { id: '8-1200', code: '8-1200', name: 'Deferred Tax Expense',          type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Tax', parent: 'g-tax-exp', level: 1, is_active: true },
  { id: '8-1300', code: '8-1300', name: 'Final Tax (PPh Final)',         type: 'expense', normal_balance: 'debit', fs: 'PL', section: 'Tax', parent: 'g-tax-exp', level: 1, is_active: true },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getAccountRows() {
  return COA.filter((node) => Boolean(node.code));
}

export function getAccountGroups() {
  return COA.filter((node) => node.type === 'group');
}

export function getActiveAccounts() {
  return COA.filter((node) => Boolean(node.code) && node.is_active !== false);
}

// Map of code → account, for fast lookups by JE lines / Trial Balance.
export const COA_BY_CODE = Object.fromEntries(
  COA.filter((n) => n.code).map((n) => [n.code, n])
);
