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
// RECONCILABLE ACCOUNTS are payables that are not bills: a journal line
// crediting one of these is something the company owes and has to pay, so it
// appears on the Payment list (and in bank reconciliation) until a payment
// settles it. Such a line must name a payee, because a payment needs someone
// to go to. Set per account in Settings → Chart of Accounts.
//
// PLACEHOLDER LIST. Fidya is going through the chart to decide which accounts
// belong here (Slack, 2026-10-01); these are the obvious non-trade payables in
// the meantime. Trade AP (2-1100) is deliberately absent — bills already carry
// it, and listing it here would put every bill on the Payment list twice.
export const ACCOUNTING_SETTINGS = {
  inventory_costing_method: "average_cost",
  recon_difference_accounts: ["7-1500", "4-2300"],
  reconcilable_accounts: ["2-4100", "2-4400", "2-4500", "2-4600"],
};
