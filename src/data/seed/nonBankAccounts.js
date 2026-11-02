// Non-bank cash accounts, and the ledger and reconciliations behind them.
//
// Bank Reconciliation covers accounts with a bank statement. Everything else
// that holds cash is reconciled here, against evidence a person brings: a cash
// count, an e-wallet balance, a gateway settlement report, a schedule of what
// is in transit. One shape for all of them (lib/nonBankRecon.js):
//
//   ending balance (from the evidence)  =  beginning balance  +  the GL lines
//                                            the evidence includes (ticked)
//
// Petty cash is a payment method, not a voucher book: each cash payment is a
// posted journal crediting the cash account, so the count is checked against
// the GL balance and only a shortage or overage needs a journal.
//
// The journals here are their own seed, merged into JournalEntriesContext like
// the ledger backfill. Bank Reconciliation reads seed/journalEntries.js only,
// so the bank side of a top-up or a payout never shows up as a Klay record
// with no statement line behind it.

import { COA } from "./coa";
import { JOURNAL_ENTRIES } from "./journalEntries";
import { PAYMENT_HISTORY_JES } from "./paymentHistory";
import { LEDGER_BACKFILL_JES } from "./ledgerBackfill";

export const NON_BANK_TYPES = {
  cash:     { key: "cash",     label: "Cash box",        evidence: "Cash count",        logo: "Rp" },
  ewallet:  { key: "ewallet",  label: "E-wallet",        evidence: "Balance in the app", logo: "E" },
  gateway:  { key: "gateway",  label: "Payment gateway", evidence: "Settlement report", logo: "PG" },
  clearing: { key: "clearing", label: "Clearing",        evidence: "Open-items schedule", logo: "↔" },
};

// glAccount is 1:1 — no two accounts here, and no bank account, share a code.
export const NON_BANK_ACCOUNTS = [
  { id: "petty-hq",   type: "cash",     name: "Petty Cash — Head Office", glAccount: "1-1200", color: "#7A5C2E", custodian: "Dewi Anggraini", fundingAccount: "bca-op", differenceAccount: "7-1600" },
  { id: "cash-store", type: "cash",     name: "Cash on Hand — Showroom",  glAccount: "1-1100", color: "#5E6B2E", custodian: "Agus Salim",     fundingAccount: "bca-op", differenceAccount: "7-1600" },
  { id: "gopay",      type: "ewallet",  name: "GoPay Corporate",          glAccount: "1-1220", color: "#00AA5B", differenceAccount: "7-1500" },
  { id: "xendit",     type: "gateway",  name: "Xendit",                   glAccount: "1-1230", color: "#2E5BFF", differenceAccount: "6-3010" },
  { id: "transit",    type: "clearing", name: "Cash in Transit",          glAccount: "1-1240", color: "#5B6475", differenceAccount: "7-1500" },
];

export const nonBankAccountById = (id) => NON_BANK_ACCOUNTS.find((a) => a.id === id) || null;

// Rupiah notes and coins, largest first, for the cash count sheet.
export const DENOMINATIONS = [
  { value: 100000, kind: "note" }, { value: 50000, kind: "note" }, { value: 20000, kind: "note" },
  { value: 10000, kind: "note" }, { value: 5000, kind: "note" }, { value: 2000, kind: "note" },
  { value: 1000, kind: "note" }, { value: 1000, kind: "coin" }, { value: 500, kind: "coin" },
  { value: 200, kind: "coin" }, { value: 100, kind: "coin" },
];
export const denomKey = (d) => `${d.kind}-${d.value}`;

// ── The ledger ──────────────────────────────────────────────────────────────

const nameOf = (code) => COA.find((a) => a.code === code)?.name || code;
const BY = "Hana Wijoyo";
// Numbered after every other seeded 2025 journal, so no two share a number.
let seq = Math.max(
  ...[...JOURNAL_ENTRIES, ...PAYMENT_HISTORY_JES, ...LEDGER_BACKFILL_JES]
    .map((j) => /^JE-2025-(\d+)$/.exec(j.je_number || "")?.[1])
    .filter(Boolean)
    .map(Number),
);

function je(date, memo, lines, reference_type = "manual") {
  seq += 1;
  return {
    je_number: `JE-2025-${String(seq).padStart(4, "0")}`,
    je_date: date, status: "posted", memo, reference_type, reference_id: null,
    created_by: BY, created_date: date, posted_by: BY, posted_date: date,
    lines: lines.map(([code, debit, credit, description]) => ({ account_code: code, account_name: nameOf(code), debit, credit, description })),
  };
}

// A payment in cash out of a petty-cash box: the bill's expense on one side,
// the box on the other.
const pettyPay = (date, payee, expense, amount) =>
  je(date, `Paid in cash — ${payee}`, [[expense, amount, 0, payee], ["1-1200", 0, amount, "Petty cash"]], "petty_cash_payment");
const topUp = (date, amount) =>
  je(date, "Petty cash top-up from BCA Operating", [["1-1200", amount, 0, "Top-up"], ["1-1500", 0, amount, "Transfer to petty cash"]], "transfer");

// A showroom cash sale, PPN 11% on top.
const cashSale = (date, net) =>
  je(date, "Showroom cash sales", [["1-1100", Math.round(net * 1.11), 0, "Cash takings"], ["4-1100", 0, net, "Furniture sales"], ["2-2100", 0, Math.round(net * 0.11), "VAT output 11%"]]);
// Takings leave the showroom for the bank: cash on hand → in transit → bank.
const deposit = (date, amount) =>
  je(date, "Showroom takings deposited", [["1-1240", amount, 0, "Deposit in transit"], ["1-1100", 0, amount, "Cash to bank"]], "transfer");
const arrives = (date, amount, onDate) =>
  je(date, `Showroom deposit of ${onDate} credited`, [["1-1500", amount, 0, "Deposit credited"], ["1-1240", 0, amount, "Deposit cleared"]], "transfer");

const gopayTopUp = (date, amount) =>
  je(date, "GoPay Corporate top-up", [["1-1220", amount, 0, "Top-up"], ["1-1500", 0, amount, "Transfer to GoPay"]], "transfer");
const gopaySpend = (date, what, expense, amount) =>
  je(date, `GoPay — ${what}`, [[expense, amount, 0, what], ["1-1220", 0, amount, "GoPay Corporate"]], "ewallet_payment");

const xenditIn = (date, customer, amount) =>
  je(date, `Customer payment via Xendit — ${customer}`, [["1-1230", amount, 0, customer], ["1-2100", 0, amount, customer]], "ar_receipt");
const xenditOut = (date, amount) =>
  je(date, "Xendit payout to BCA Operating", [["1-1500", amount, 0, "Payout credited"], ["1-1230", 0, amount, "Payout"]], "transfer");

export const NON_BANK_JES = [
  // February
  je("2025-02-03", "Petty cash fund set up at head office", [["1-1200", 5000000, 0, "Petty cash float"], ["1-1500", 0, 5000000, "Transfer to petty cash"]], "transfer"),
  gopayTopUp("2025-02-03", 3000000),
  pettyPay("2025-02-05", "Parking and tolls", "6-1300", 185000),
  gopaySpend("2025-02-06", "GoCar, client visit", "6-1300", 145000),
  xenditIn("2025-02-06", "PT Graha Interior", 15540000),
  pettyPay("2025-02-07", "Toko ATK Sinar", "6-2500", 420000),
  cashSale("2025-02-08", 10000000),
  deposit("2025-02-10", 11100000),
  pettyPay("2025-02-11", "JNE", "6-3100", 96000),
  arrives("2025-02-11", 11100000, "10 Feb"),
  gopaySpend("2025-02-12", "GoSend, documents", "6-3100", 62000),
  xenditIn("2025-02-13", "CV Rumah Kayu", 8325000),
  pettyPay("2025-02-14", "Warung Padang Sederhana", "6-1300", 650000),
  gopaySpend("2025-02-18", "GoCar, site survey", "6-1300", 230000),
  pettyPay("2025-02-19", "Drinking water", "6-4000", 240000),
  xenditOut("2025-02-20", 23000000),
  cashSale("2025-02-21", 6000000),
  pettyPay("2025-02-24", "SiCepat", "6-3100", 78000),
  gopaySpend("2025-02-25", "GoCar, client visit", "6-1300", 188000),
  pettyPay("2025-02-27", "Cleaning supplies", "6-3600", 310000),
  topUp("2025-02-28", 1979000),
  deposit("2025-02-28", 6660000),
  je("2025-02-28", "Xendit fees — February", [["6-3010", 238650, 0, "Gateway fees"], ["1-1230", 0, 238650, "Fees deducted"]]),

  // March
  arrives("2025-03-03", 6660000, "28 Feb"),
  pettyPay("2025-03-04", "Parking and tolls", "6-1300", 210000),
  gopaySpend("2025-03-05", "GoCar, client visit", "6-1300", 172000),
  pettyPay("2025-03-06", "Toko ATK Sinar", "6-2500", 385000),
  xenditIn("2025-03-07", "PT Graha Interior", 19980000),
  cashSale("2025-03-07", 8000000),
  pettyPay("2025-03-10", "JNE", "6-3100", 112000),
  deposit("2025-03-10", 8880000),
  arrives("2025-03-11", 8880000, "10 Mar"),
  gopaySpend("2025-03-11", "GoSend, samples", "6-3100", 85000),
  pettyPay("2025-03-13", "Snacks for client meeting", "6-1300", 275000),
  xenditIn("2025-03-14", "PT Sinar Mebel", 12210000),
  pettyPay("2025-03-17", "Drinking water", "6-4000", 240000),
  xenditOut("2025-03-17", 32000000),
  gopaySpend("2025-03-19", "GoCar, site survey", "6-1300", 264000),
  pettyPay("2025-03-20", "Door lock repair", "6-3200", 450000),
  cashSale("2025-03-21", 12000000),
  gopaySpend("2025-03-24", "GoSend, documents", "6-3100", 48000),
  pettyPay("2025-03-25", "SiCepat", "6-3100", 94000),
  xenditIn("2025-03-26", "CV Rumah Kayu", 27750000),
  pettyPay("2025-03-27", "Parking and tolls", "6-1300", 160000),
  topUp("2025-03-31", 1926000),
  deposit("2025-03-31", 13320000),
  gopayTopUp("2025-03-31", 2000000),
  xenditIn("2025-03-31", "PT Graha Interior", 9990000),
  // Hana's March count came to Rp 4.980.000 against Rp 5.000.000 in the books.
  je("2025-03-31", "Petty cash count short — March", [["7-1600", 20000, 0, "Count short"], ["1-1200", 0, 20000, "Petty Cash — Head Office"]], "nonbank_reconciliation"),

  // April, up to today
  pettyPay("2025-04-02", "Parking and tolls", "6-1300", 150000),
  arrives("2025-04-02", 13320000, "31 Mar"),
  gopaySpend("2025-04-03", "GoCar, client visit", "6-1300", 198000),
  pettyPay("2025-04-04", "Toko ATK Sinar", "6-2500", 520000),
  xenditIn("2025-04-08", "PT Sinar Mebel", 14430000),
  pettyPay("2025-04-09", "JNE", "6-3100", 88000),
  gopaySpend("2025-04-10", "GoSend, samples", "6-3100", 54000),
  cashSale("2025-04-11", 5000000),
  xenditOut("2025-04-11", 20000000),
  deposit("2025-04-14", 5550000),
  arrives("2025-04-15", 5550000, "14 Apr"),
  pettyPay("2025-04-15", "Drinking water", "6-4000", 240000),
  gopaySpend("2025-04-16", "GoCar, site survey", "6-1300", 221000),
  pettyPay("2025-04-18", "Warung Padang Sederhana", "6-1300", 580000),
  cashSale("2025-04-19", 7000000),
  pettyPay("2025-04-22", "SiCepat", "6-3100", 70000),
];

const jeOn = (memo, date) => NON_BANK_JES.find((j) => j.memo === memo && j.je_date === date)?.je_number;

// ── Reconciliations already worked ──────────────────────────────────────────
//
// February is closed and approved for every account. March is mid-close:
// petty cash waiting on a reviewer, the showroom approved, Cash in Transit sent
// back, GoPay and Xendit not started. `untick` names the journals left
// outstanding; every other line up to the statement date was ticked.

const PREPARER = "Hana Wijoyo";
const REVIEWER = "Budi Santoso";
const count = (counts) => ({ counts, countedBy: PREPARER, witnessedBy: "Dewi Anggraini", countedAt: null });

export const NON_BANK_RECON_SEED = [
  // February
  { accountId: "petty-hq", period: "2025-02", status: "approved", statementDate: "2025-02-28", endingBalance: 5000000,
    evidence: { kind: "count", count: count({ "note-100000": 38, "note-50000": 16, "note-20000": 10, "note-10000": 15, "note-5000": 10 }), fileName: "petty-cash-count-feb.jpg" },
    preparedBy: PREPARER, submittedAt: "2025-03-03", reviewedBy: REVIEWER, approvedAt: "2025-03-04" },
  { accountId: "cash-store", period: "2025-02", status: "approved", statementDate: "2025-02-28", endingBalance: 25000000,
    evidence: { kind: "count", count: { ...count({ "note-100000": 210, "note-50000": 60, "note-20000": 50 }), witnessedBy: "Agus Salim" }, fileName: "showroom-count-feb.jpg" },
    preparedBy: PREPARER, submittedAt: "2025-03-03", reviewedBy: REVIEWER, approvedAt: "2025-03-04" },
  { accountId: "gopay", period: "2025-02", status: "approved", statementDate: "2025-02-28", endingBalance: 2375000,
    evidence: { kind: "file", fileName: "gopay-statement-feb.pdf" },
    preparedBy: PREPARER, submittedAt: "2025-03-03", reviewedBy: REVIEWER, approvedAt: "2025-03-04" },
  { accountId: "xendit", period: "2025-02", status: "approved", statementDate: "2025-02-28", endingBalance: 626350,
    evidence: { kind: "file", fileName: "xendit-settlement-feb.csv" },
    preparedBy: PREPARER, submittedAt: "2025-03-03", reviewedBy: REVIEWER, approvedAt: "2025-03-04" },
  { accountId: "transit", period: "2025-02", status: "approved", statementDate: "2025-02-28", endingBalance: 0,
    evidence: { kind: "file", fileName: "in-transit-schedule-feb.xlsx" },
    untick: [jeOn("Showroom takings deposited", "2025-02-28")],
    notes: { [jeOn("Showroom takings deposited", "2025-02-28")]: "Deposited Friday, credited Monday 3 Mar." },
    preparedBy: PREPARER, submittedAt: "2025-03-03", reviewedBy: REVIEWER, approvedAt: "2025-03-04" },

  // March
  { accountId: "petty-hq", period: "2025-03", status: "review", statementDate: "2025-03-31", endingBalance: 4980000,
    evidence: { kind: "count", count: count({ "note-100000": 36, "note-50000": 14, "note-20000": 20, "note-10000": 20, "note-5000": 10, "note-2000": 10, "note-1000": 5, "coin-500": 8, "coin-200": 5 }), fileName: "petty-cash-count-mar.jpg" },
    preparedBy: PREPARER, submittedAt: "2025-04-02" },
  { accountId: "cash-store", period: "2025-03", status: "approved", statementDate: "2025-03-31", endingBalance: 25000000,
    evidence: { kind: "count", count: { ...count({ "note-100000": 200, "note-50000": 80, "note-20000": 50 }), witnessedBy: "Agus Salim" }, fileName: "showroom-count-mar.jpg" },
    preparedBy: PREPARER, submittedAt: "2025-04-01", reviewedBy: REVIEWER, approvedAt: "2025-04-02" },
  { accountId: "transit", period: "2025-03", status: "draft", statementDate: "2025-03-31", endingBalance: 0,
    evidence: { kind: "file", fileName: "in-transit-schedule-mar.xlsx" },
    untick: [jeOn("Showroom takings deposited", "2025-03-31")],
    preparedBy: PREPARER, submittedAt: "2025-04-02",
    sentBack: { by: REVIEWER, at: "2025-04-03", comment: "Attach the BCA deposit slip for the 31 Mar showroom deposit, then resubmit." } },
];
