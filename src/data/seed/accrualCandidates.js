// Accrual candidates for AP Close → Gate 5 (Accrual Readiness).
// PRD: ap_invoices records with source=ACCRUAL, identified from invoice history
// via Signal 1 (recurring vendor gap), Signal 2 (prior accrual pattern), or
// Signal 3 (manual flag). Suggested amounts derived from last invoice,
// 3-month rolling average, or prior accrual. PPh component computed from
// vendor master at booking time.
//
// Seed mirrors the PRD's ASCII mockup vendors and adds a few more that match
// the existing VENDORS seed (V004 Konsultasi, V008 Teknologi Digital — both
// PKP + pph23_2 service vendors that fit the recurring-gap pattern).

import { VENDORS } from "./vendors";

const PPH23_RATE = 0.02;
const PPH4_2_RATE = 0.10; // Not used in seed but kept for future
const ROUNDING_THRESHOLD = 5000;

// Pull vendor metadata to keep PKP + PPh handling consistent with the master.
function v(id) {
  return VENDORS.find((x) => x.id === id);
}

// Helper: build a candidate from vendor + suggestion basis + gross amount.
function buildCandidate({ id, vendorId, signal, basis, basisLabel, basisHistory, grossAmount, expenseAccount, expenseAccountLabel, periodEnd, reversalDate, dismissReason }) {
  const vendor = v(vendorId);
  if (!vendor) return null;
  const isPph23 = vendor.pph === "pph23_2";
  const pphAmount = isPph23 ? Math.round(grossAmount * PPH23_RATE) : 0;
  const netToVendor = grossAmount - pphAmount;

  return {
    id,
    vendor_id: vendor.id,
    vendor_code: vendor.code,
    vendor_name: vendor.name,
    vendor_initials: vendor.initials,
    pkp_status: vendor.pkp,
    pph_category: vendor.pph,
    pph_rate: isPph23 ? PPH23_RATE : 0,
    period: periodEnd.slice(0, 7) + "-01",     // first day of accrual period
    detection_signal: signal,                  // RECURRING_GAP | PRIOR_ACCRUAL_PATTERN | MANUAL_FLAG
    suggested_basis: basis,                    // LAST_INVOICE | ROLLING_AVERAGE | PRIOR_ACCRUAL
    basis_label: basisLabel,                   // human-readable
    basis_history: basisHistory,               // amounts that fed the suggestion
    gross_amount: grossAmount,
    pph_amount: pphAmount,
    net_to_vendor: netToVendor,
    expense_account: expenseAccount,
    expense_account_label: expenseAccountLabel,
    accrual_reversal_date: reversalDate,
    status: dismissReason ? "DISMISSED" : "PENDING_REVIEW",
    dismiss_reason: dismissReason || null,
  };
}

// April 2025 close period. Candidates surface from vendors that have invoiced
// in ≥3 of the last 6 months but haven't invoiced in April yet (TODAY = Apr 23).
export const ACCRUAL_CANDIDATES = [
  buildCandidate({
    id: "AC-2025-04-001",
    vendorId: "V004",                          // PT Penyedia Layanan Konsultasi (PKP, pph23_2)
    signal: "RECURRING_GAP",
    basis: "LAST_INVOICE",
    basisLabel: "Last invoice Rp 46M (22 Apr 2025)",
    basisHistory: [{ date: "2025-04-22", amount: 46000000, source: "BILL-prior-period" }],
    grossAmount: 46000000,
    expenseAccount: "6-2700",
    expenseAccountLabel: "Professional Services",
    periodEnd: "2025-04-30",
    reversalDate: "2025-05-01",
  }),
  buildCandidate({
    id: "AC-2025-04-002",
    vendorId: "V003",                          // PT Jasa Logistik Cepat (PKP, pph23_2)
    signal: "RECURRING_GAP",
    basis: "ROLLING_AVERAGE",
    basisLabel: "3-month average (Rp 20M, Rp 22M, Rp 24M)",
    basisHistory: [
      { date: "2025-01-15", amount: 20000000 },
      { date: "2025-02-14", amount: 22000000 },
      { date: "2025-03-15", amount: 24000000 },
    ],
    grossAmount: 22000000,
    expenseAccount: "6-2300",
    expenseAccountLabel: "Logistics & Delivery",
    periodEnd: "2025-04-30",
    reversalDate: "2025-05-01",
  }),
  buildCandidate({
    id: "AC-2025-04-003",
    vendorId: "V008",                          // PT Teknologi Solusi Digital (PKP, pph23_2)
    signal: "PRIOR_ACCRUAL_PATTERN",
    basis: "PRIOR_ACCRUAL",
    basisLabel: "Prior accrual Mar 2025 (Rp 12.5M)",
    basisHistory: [{ date: "2025-03-31", amount: 12500000, source: "ACCRUAL-2025-03-009" }],
    grossAmount: 12500000,
    expenseAccount: "6-2700",
    expenseAccountLabel: "IT Support & SaaS",
    periodEnd: "2025-04-30",
    reversalDate: "2025-05-01",
  }),
  // Utility accrual — electricity consumed in April, PLN invoices in arrears
  // (bill arrives in May, after close). PKP vendor but electricity carries no PPh.
  // MANUAL_FLAG = the "always accrue this vendor every month" signal (Signal 3).
  // Hand-built (PLN isn't in the generic vendor seed).
  {
    id: "AC-2025-04-004",
    vendor_id: null,
    vendor_code: "PLN",
    vendor_name: "PLN (Persero)",
    vendor_initials: "PL",
    pkp_status: "PKP",
    pph_category: "none",
    pph_rate: 0,
    period: "2025-04-01",
    detection_signal: "MANUAL_FLAG",
    suggested_basis: "ROLLING_AVERAGE",
    basis_label: "3-month average (Rp 27M, Rp 28M, Rp 29M)",
    basis_history: [
      { date: "2025-01-31", amount: 27000000 },
      { date: "2025-02-28", amount: 28000000 },
      { date: "2025-03-31", amount: 29000000 },
    ],
    gross_amount: 28000000,
    pph_amount: 0,
    net_to_vendor: 28000000,
    expense_account: "6-2400",
    expense_account_label: "Utilities — Electricity",
    accrual_reversal_date: "2025-05-01",
    status: "PENDING_REVIEW",
    dismiss_reason: null,
  },
];

// Suppressed candidates — surfaced behind "Show suppressed" toggle per PRD.
// Carry forward for one period after FM dismisses with reason.
export const SUPPRESSED_CANDIDATES = [
  buildCandidate({
    id: "AC-2025-04-S01",
    vendorId: "V016",                          // Toko Agung Sembako (PKP, pph23_2)
    signal: "RECURRING_GAP",
    basis: "LAST_INVOICE",
    basisLabel: "Last invoice Rp 8.4M (29 Mar 2025)",
    basisHistory: [{ date: "2025-03-29", amount: 8400000 }],
    grossAmount: 8400000,
    expenseAccount: "6-2700",
    expenseAccountLabel: "Service Contracts",
    periodEnd: "2025-04-30",
    reversalDate: "2025-05-01",
    dismissReason: "Vendor does not invoice this period",
  }),
];

export const ROUNDING_DIFFERENCES_THRESHOLD_IDR = ROUNDING_THRESHOLD;

// Close history for the demo — prior period declarations shown on Command Center.
// Jan + Feb 2025 already closed per AP_CLOSED_THROUGH = "2025-02" baseline.
export const CLOSE_HISTORY = [
  {
    period: "2025-02",
    period_label: "Feb 2025",
    declared_at: "2025-03-04T14:22:00",
    declared_by: "Sarah Wijaya",
    declared_by_role: "Finance Manager",
    days_after_period_end: 4,
    gate_snapshot: { gate_1: 0, gate_2: 0, gate_3a: 0, gate_3b: 0, gate_4: "FULLY_RECONCILED", gate_5: 0 },
  },
  {
    period: "2025-01",
    period_label: "Jan 2025",
    declared_at: "2025-02-03T09:45:00",
    declared_by: "Sarah Wijaya",
    declared_by_role: "Finance Manager",
    days_after_period_end: 3,
    gate_snapshot: { gate_1: 0, gate_2: 0, gate_3a: 0, gate_3b: 0, gate_4: "FULLY_RECONCILED", gate_5: 0 },
  },
];

// Exception sub-indicators for Gate 2 — PPh remittance, no-document bills.
// PRD: informational flags, don't block Gate 2 from being green.
export const GATE_2_SUB_INDICATORS = {
  pph_remittance: {
    label: "PPh remittance",
    detail: "Rp 14,200,000 PPh 23 due by 10 May 2025",
    count: 1,
    items: [
      { id: "PPH-23-APR", amount: 14200000, due: "2025-05-10", account: "2-1500", account_label: "PPh 23 Payable" },
    ],
  },
  no_document_bills: {
    label: "No-document bills",
    detail: "3 bills posted without source document",
    count: 3,
    items: [
      { bill_id: "BILL-0156", vendor_name: "PT Sumber Alam", amount: 8000000, justification: "Vendor refused to issue invoice" },
      { bill_id: "BILL-0189", vendor_name: "PT Indah Karya", amount: 12000000, justification: "Cash advance to field team" },
      { bill_id: "BILL-0204", vendor_name: "PT Maju Bersama", amount: 5000000, justification: "Receipt lost in transit" },
    ],
  },
};
