// Company-wide accounting settings.
//
// The inventory COSTING METHOD is a foundational policy chosen once at setup and
// then left alone — changing how stock is valued mid-life distorts COGS and the
// balance sheet, so it is NOT editable per product. It lives here (surfaced in
// Accounting Settings) and every product reads the single company value.
//
// Two methods (MVP):
//   • actual_cost  — each unit carried at its own purchase cost (specific ID).
//   • average_cost — weighted-average cost across all units on hand.
export const COSTING_METHOD_LABELS = {
  actual_cost:  "Actual Cost",
  average_cost: "Average Cost",
};

// RECON DIFFERENCE ACCOUNTS are where Reconcile manually may book the small gap
// between a bank line and the Klay records it stands for — bank rounding, a few
// rupiah a transfer lost. Chosen in Settings → Bank reconciliation. Codes from
// data/seed/coa.js.
export const ACCOUNTING_SETTINGS = {
  inventory_costing_method: "average_cost",
  recon_difference_accounts: ["7-1500", "4-2300"],
};
