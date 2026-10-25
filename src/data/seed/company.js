// The company this demo runs as — Settings → Company.
//
// Fiscal year and base currency live here, not under Accounting: they are set
// once when the company is created and every module reads them. Base currency
// locks once anything has been posted (changing it would re-denominate the
// ledger).
export const COMPANY = {
  id: "ENT-001",
  legalName: "PT Sejahtera Makmur",
  aktaNo: "AHU-0012345.AH.01.01.Tahun 2025",
  logo: null, // data URL of the uploaded logo (Settings → Company)
  npwp: "01.234.567.8-901.000",
  industry: "Wholesale trade",
  email: "finance@sejahteramakmur.co.id",
  phone: "+62 21 5790 1234",
  address: "Jl. Jend. Sudirman Kav. 52–53, Senayan, Kebayoran Baru",
  city: "Jakarta Selatan",
  province: "DKI Jakarta",
  postalCode: "12190",
  baseCurrency: "IDR",
  fiscalYearStart: 1, // month number, 1 = January
  timezone: "Asia/Jakarta",
  createdAt: "2025-01-12",
  // Segregation-of-duties mode (ADR-003, settings.sod.mode). Chosen by Klay at
  // onboarding from how the team is staffed — ENFORCED for segregated teams,
  // RELAXED for lean ones where one person has to cover another — and not
  // changeable in the app. Shown as a value with an ⓘ on Settings → Users →
  // Roles (components/SodInfo).
  sodMode: "ENFORCED",
  // Books for a month close by this day of the following month (Settings →
  // General Ledger → Preferences → Closing).
  closeCutoffDay: 5,
  // Deleting posted journals — a backend switch Klay sets on request, never in
  // the app. On for this demo company so Preferences shows Delete journals.
  journalDeletionEnabled: true,
  // Whether people who approve journals (the Finance Manager) may post a
  // manual journal they prepared themselves, and up to what total (Settings →
  // General Ledger → Preferences → Self-posting). Off by default: preparer and
  // approver are two people. Agreed 25 Oct 2026.
  selfPost: { enabled: false, limit: 10_000_000 },
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
