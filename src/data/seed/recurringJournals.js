// Recurring journal templates — entries that repeat every month with the same
// lines. Each active template drafts one Scheduled entry per open month on
// the Journal Entry page (lib/scheduledJournals.js); the template was approved
// when it was set up, so its monthly entries post without a second approval.
//
// `day`: "last" for the last day of the month, or a day number (1–28).
// `auto_reverse`: the posted entry reverses on the 1st of the next month — the
// usual shape of an accrual, booked now and undone when the invoice arrives.
//
// Seeded with two month-end accruals the seed ledger does not already carry.

export const RECURRING_TEMPLATES = [
  {
    id: "TPL-001",
    name: "Utilities accrual",
    memo: "Utilities accrual",
    day: "last",
    start: "2025-04",
    end: null,
    active: true,
    auto_reverse: true,
    created_by: "Sari Dewanti",
    created_date: "2025-03-28",
    lines: [
      { account_code: "6-2400", account_name: "Office Utilities", debit: 18500000, credit: 0, description: "Electricity and water, accrued before the invoice" },
      { account_code: "2-1200", account_name: "Accrued Expenses", debit: 0, credit: 18500000, description: "Utilities accrued" },
    ],
  },
  {
    id: "TPL-002",
    name: "Telecommunications accrual",
    memo: "Telecommunications accrual",
    day: "last",
    start: "2025-04",
    end: "2025-12",
    active: true,
    auto_reverse: true,
    created_by: "Lutfi Hakim",
    created_date: "2025-03-28",
    lines: [
      { account_code: "6-2900", account_name: "Telecommunications", debit: 6200000, credit: 0, description: "Internet and phone lines, accrued" },
      { account_code: "2-1200", account_name: "Accrued Expenses", debit: 0, credit: 6200000, description: "Telecommunications accrued" },
    ],
  },
];
