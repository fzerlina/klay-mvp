// The company this demo runs as — Settings → Company.
//
// Fiscal year and base currency live here, not under Accounting: they are set
// once when the company is created and every module reads them. Base currency
// locks once anything has been posted (changing it would re-denominate the
// ledger).
export const COMPANY = {
  id: "ENT-001",
  legalName: "PT Sejahtera Makmur",
  tradingName: "Sejahtera Makmur",
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
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
