// The company's own bank and cash accounts — the accounts money is paid FROM.
//
// This list used to live inside BankAccountsSettingsPage as local mock state.
// It moved here the moment a second screen needed it: Record Payment has to
// offer the same accounts the settings page administers, and a second copy
// would have drifted the first time someone added an account in Settings and
// found it missing from the payment picker.
//
// Not to be confused with a VENDOR's bank account, which lives on the vendor
// record (`vendor.banks`) and is where money is paid TO.

export const COMPANY_BANK_ACCOUNTS = [
  { id: "bca-op",          bank: "BCA",     bankColor: "#0050A8", name: "BCA Operating",     number: "0123456789", currency: "IDR", group: "operating", glAccount: "1101-100", glAccountName: "Cash - BCA Operating",       openingBalance: 1245680000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-20" },
  { id: "bni-op",          bank: "BNI",     bankColor: "#F37021", name: "BNI Operating",     number: "5678901234", currency: "IDR", group: "operating", glAccount: "1101-110", glAccountName: "Cash - BNI Operating",       openingBalance:  380400000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-20" },
  { id: "mandiri-op",      bank: "MDR",     bankColor: "#003D7A", name: "Mandiri Operating", number: "1300456789", currency: "IDR", group: "operating", glAccount: "1101-115", glAccountName: "Cash - Mandiri Operating",   openingBalance:  528200000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-20" },
  { id: "cimb-op",         bank: "CIMB",    bankColor: "#7B2D8E", name: "CIMB Operating",    number: "8765432109", currency: "IDR", group: "operating", glAccount: "1101-120", glAccountName: "Cash - CIMB Operating",      openingBalance:  215800000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-20" },
  { id: "bri-op",          bank: "BRI",     bankColor: "#003D7A", name: "BRI Operating",     number: "0205017012", currency: "IDR", group: "operating", glAccount: "1101-130", glAccountName: "Cash - BRI Operating",       openingBalance:  167900000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-19" },
  { id: "permata-op",      bank: "PERMATA", bankColor: "#1A8C53", name: "Permata Operating", number: "4012345678", currency: "IDR", group: "operating", glAccount: "1101-140", glAccountName: "Cash - Permata Operating",   openingBalance:   94250000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-18" },
  { id: "bni-tax",         bank: "BNI",     bankColor: "#F37021", name: "BNI Tax Account",   number: "9876543210", currency: "IDR", group: "tax",       glAccount: "1101-200", glAccountName: "Cash - Tax Holding",         openingBalance:   88000000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-15" },
  { id: "mandiri-payroll", bank: "MDR",     bankColor: "#003D7A", name: "Mandiri Payroll",   number: "1234567890", currency: "IDR", group: "payroll",   glAccount: "1101-300", glAccountName: "Cash - Payroll",             openingBalance:   12500000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-17" },
  { id: "bca-petty",       bank: "BCA",     bankColor: "#0050A8", name: "BCA Petty Cash",    number: "1111222233", currency: "IDR", group: "petty",     glAccount: null,       glAccountName: null,                         openingBalance:    8500000, active: true, statementFrom: null, statementThrough: null },
  { id: "mandiri-petty",   bank: "MDR",     bankColor: "#003D7A", name: "Mandiri Petty Cash",number: "1290011122", currency: "IDR", group: "petty",     glAccount: "1101-410", glAccountName: "Cash - Petty Mandiri",       openingBalance:    4200000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-15" },
  { id: "bca-usd",         bank: "BCA",     bankColor: "#0050A8", name: "BCA USD",           number: "2222333344", currency: "USD", group: "fx",        glAccount: "1102-100", glAccountName: "Cash - BCA USD",             openingBalance:  142300000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-20" },
  { id: "bca-sgd",         bank: "BCA",     bankColor: "#0050A8", name: "BCA SGD",           number: "3333444455", currency: "SGD", group: "fx",        glAccount: "1102-200", glAccountName: "Cash - BCA SGD",             openingBalance:   47650000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-20" },
  { id: "bca-eur",         bank: "BCA",     bankColor: "#0050A8", name: "BCA EUR",           number: "5555666677", currency: "EUR", group: "fx",        glAccount: "1102-300", glAccountName: "Cash - BCA EUR",             openingBalance:   38900000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-15" },
  { id: "bca-deposit",     bank: "BCA",     bankColor: "#0050A8", name: "BCA Time Deposit",  number: "4444555566", currency: "IDR", group: "deposit",   glAccount: "1103-100", glAccountName: "Time Deposits - BCA",        openingBalance:  500000000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-01" },
  { id: "mandiri-deposit", bank: "MDR",     bankColor: "#003D7A", name: "Mandiri Deposit",   number: "1377889900", currency: "IDR", group: "deposit",   glAccount: "1103-110", glAccountName: "Time Deposits - Mandiri",    openingBalance:  250000000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-01" },
  { id: "bca-restricted",  bank: "BCA",     bankColor: "#0050A8", name: "BCA Restricted",    number: "6666777788", currency: "IDR", group: "deposit",   glAccount: null,       glAccountName: null,                         openingBalance:  120000000, active: true, statementFrom: "2025-04-01", statementThrough: "2025-04-01" },
];

export const bankAccountById = (id) => COMPANY_BANK_ACCOUNTS.find((a) => a.id === id) || null;

// Last four digits, the way a bank statement or a payment confirmation shows it.
export const maskOf = (a) => (a?.number ? `••${String(a.number).slice(-4)}` : "");

// Which accounts a payment method can draw on.
//
// Cash comes out of a petty-cash float, never an operating account — that is
// the whole point of keeping a float. Giro is an Indonesian post-dated cheque
// drawn on a real bank account, so it offers the same accounts as a transfer;
// what differs is the timing, not the source.
//
// Time deposits and restricted accounts are excluded from all three: paying a
// vendor out of a locked deposit is not a thing anyone means to do, and a
// mis-click there is expensive to unwind.
export function accountsForMethod(method) {
  const usable = COMPANY_BANK_ACCOUNTS.filter((a) => a.active && a.group !== "deposit");
  if (method === "cash") return usable.filter((a) => a.group === "petty");
  return usable.filter((a) => a.group !== "petty");
}

// How far the loaded bank statement reaches for this account, worded the way
// Bank Reconciliation shows it ("Apr 1–22, 2025"). The recon page used to carry
// this string in its own copy of the account list; it is derived here instead,
// because the Payment tab reads the same coverage to say whether a payment has
// been reconciled, and two hand-written copies would have disagreed the first
// time a statement was loaded.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (iso) => parseInt(iso.slice(8, 10), 10);
const monthOf = (iso) => MONTHS[parseInt(iso.slice(5, 7), 10) - 1];

export function statementLabelOf(a) {
  if (!a?.statementThrough) return "no statement yet";
  const { statementFrom: from, statementThrough: to } = a;
  const head = `${monthOf(from)} ${dayOf(from)}`;
  const span = from === to ? head : `${head}–${dayOf(to)}`;
  return `${span}, ${to.slice(0, 4)}`;
}
