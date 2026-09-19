import { useState, useEffect, useMemo, useRef } from "react";
import "./modules.css";
import "./invoices-ledger.css";
import "./close.css";
import "./bank-reconciliation.css";
import { bankAccountById, statementLabelOf } from "../data/seed/bankAccounts";

function SparkleIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5l1.3 3.2L11.5 6l-3.2 1L7 10l-1.3-3L2.5 6l3.2-1.3L7 1.5z" />
      <path d="M11.5 9.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2z" />
    </svg>
  );
}

function fmtRp(n) {
  if (n == null) return "—";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function fmtAmt(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  return `${sign}Rp ${fmtRp(abs)}`;
}

function fmtDateShort(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`;
}

// ── Account mock — 16 accounts across 6 groups ──────────────────────────
export const ACCOUNTS = [
  // Operating (6)
  { id: "bca-op",          group: "operating", bank: "BCA",     color: "#0050A8", glAccount: "1101-100", name: "BCA Operating",     number: "0123456789", balance: 1245680000, matchedAmount: 960000000 },
  { id: "bni-op",          group: "operating", bank: "BNI",     color: "#F37021", glAccount: "1101-110", name: "BNI Operating",     number: "5678901234", balance:  380400000, matchedAmount: 380400000 },
  { id: "mandiri-op",      group: "operating", bank: "MDR",     color: "#003D7A", glAccount: "1101-115", name: "Mandiri Operating", number: "1300456789", balance:  528200000, matchedAmount: 528200000 },
  { id: "cimb-op",         group: "operating", bank: "CIMB",    color: "#7B2D8E", glAccount: "1101-120", name: "CIMB Operating",    number: "8765432109", balance:  215800000, matchedAmount: 215800000 },
  { id: "bri-op",          group: "operating", bank: "BRI",     color: "#003D7A", glAccount: "1101-130", name: "BRI Operating",     number: "0205017012", balance:  167900000, matchedAmount: 167900000 },
  { id: "permata-op",      group: "operating", bank: "PERMATA", color: "#1A8C53", glAccount: "1101-140", name: "Permata Operating", number: "4012345678", balance:   94250000, matchedAmount:  94250000 },
  // Tax (1)
  { id: "bni-tax",         group: "tax",       bank: "BNI",     color: "#F37021", glAccount: "1101-200", name: "BNI Tax Account",   number: "9876543210", balance:   88000000, matchedAmount:  88000000 },
  // Payroll (1)
  { id: "mandiri-payroll", group: "payroll",   bank: "MDR",     color: "#003D7A", glAccount: "1101-300", name: "Mandiri Payroll",   number: "1234567890", balance:   12500000, matchedAmount:  12500000 },
  // Petty Cash (2)
  { id: "bca-petty",       group: "petty",     bank: "BCA",     color: "#0050A8", glAccount: "1101-400", name: "BCA Petty Cash",    number: "1111222233", balance:    8500000, matchedAmount:         0 },
  { id: "mandiri-petty",   group: "petty",     bank: "MDR",     color: "#003D7A", glAccount: "1101-410", name: "Mandiri Petty Cash",number: "1290011122", balance:    4200000, matchedAmount:   4200000 },
  // Foreign Currency (3)
  { id: "bca-usd",         group: "fx",        bank: "BCA",     color: "#0050A8", glAccount: "1102-100", name: "BCA USD",           number: "2222333344", balance:  142300000, matchedAmount: 142300000, currency: "USD" },
  { id: "bca-sgd",         group: "fx",        bank: "BCA",     color: "#0050A8", glAccount: "1102-200", name: "BCA SGD",           number: "3333444455", balance:   47650000, matchedAmount:  47650000, currency: "SGD" },
  { id: "bca-eur",         group: "fx",        bank: "BCA",     color: "#0050A8", glAccount: "1102-300", name: "BCA EUR",           number: "5555666677", balance:   38900000, matchedAmount:  38900000, currency: "EUR" },
  // Deposit (3)
  { id: "bca-deposit",     group: "deposit",   bank: "BCA",     color: "#0050A8", glAccount: "1103-100", name: "BCA Time Deposit",  number: "4444555566", balance:  500000000, matchedAmount: 500000000 },
  { id: "mandiri-deposit", group: "deposit",   bank: "MDR",     color: "#003D7A", glAccount: "1103-110", name: "Mandiri Deposit",   number: "1377889900", balance:  250000000, matchedAmount: 250000000 },
  { id: "bca-restricted",  group: "deposit",   bank: "BCA",     color: "#0050A8", glAccount: "1103-200", name: "BCA Restricted",    number: "6666777788", balance:  120000000, matchedAmount: 120000000 },
].map((a) => ({
  // The statement period is not written here: it is derived from the coverage
  // on the shared bank-account seed, which the Payment tab also reads to say
  // whether a payment has been reconciled. One fact, one place.
  ...a,
  statementPeriod: statementLabelOf(bankAccountById(a.id) || a),
}));

// Mock unmatched book entries — pool that user can match a bank entry against
const UNMATCHED_BOOK_ENTRIES = [
  { ref: "JE-2025-0301",       date: "2025-04-22", desc: "PPN Output · April schedule",            amount:  -3300000, type: "je"      },
  { ref: "JE-2025-0302",       date: "2025-04-22", desc: "PPN top-up · manual adjustment",         amount:  -3350000, type: "je"      },
  { ref: "INV-C001-20250416",  date: "2025-04-16", desc: "PT Berkah Jaya · open AR",               amount:  12500000, type: "invoice" },
  { ref: "INV-C001-20250419",  date: "2025-04-19", desc: "PT Berkah Jaya · April",                 amount:  12500000, type: "invoice" },
  { ref: "INV-C001-20250420",  date: "2025-04-20", desc: "PT Berkah Jaya · Q2",                    amount:  12500000, type: "invoice" },
  { ref: "BILL-2025-0151",     date: "2025-04-14", desc: "PT Sumber Maju · pending",               amount: -46800000, type: "bill"    },
  { ref: "BILL-2025-0152",     date: "2025-04-15", desc: "PT Sumber Maju · April",                 amount: -47200000, type: "bill"    },
  { ref: "INV-C015-20250404",  date: "2025-04-04", desc: "Toko Sentosa · alt spelling",            amount:   8400000, type: "invoice" },
  { ref: "JE-2025-0305",       date: "2025-04-21", desc: "Bank charges · new category",            amount:    -75000, type: "je"      },
  { ref: "JE-2025-0308",       date: "2025-04-18", desc: "Service fee · BCA",                      amount:   -125000, type: "je"      },
  { ref: "INV-C019-20250412",  date: "2025-04-12", desc: "PT Karya Mandiri · partial payment",     amount:   5200000, type: "invoice" },
  { ref: "BILL-2025-0158",     date: "2025-04-20", desc: "PT Logistik Cepat · weekly",             amount:  -8400000, type: "bill"    },
];

const ACCOUNT_GROUPS = [
  { k: "all",        lbl: "All accounts" },
  { k: "operating",  lbl: "Operating" },
  { k: "tax",        lbl: "Tax" },
  { k: "payroll",    lbl: "Payroll" },
  { k: "petty",      lbl: "Petty Cash" },
  { k: "fx",         lbl: "Foreign Currency" },
  { k: "deposit",    lbl: "Deposit / Restricted" },
];

// Months for the period selector (mirrors General Ledger pattern)
const PERIODS = [
  { lbl: "Nov 2024", v: "2024-11", state: "locked" },
  { lbl: "Dec 2024", v: "2024-12", state: "locked" },
  { lbl: "Jan 2025", v: "2025-01", state: "locked" },
  { lbl: "Feb 2025", v: "2025-02", state: "locked" },
  { lbl: "Mar 2025", v: "2025-03", state: "locked" },
  { lbl: "Apr 2025", v: "2025-04", state: "active" },
  { lbl: "May 2025", v: "2025-05", state: "future" },
  { lbl: "Jun 2025", v: "2025-06", state: "future" },
];

// ── Transaction mock for BCA Operating ──────────────────────────────────
// 25 transactions covering all 4 statuses
export const INITIAL_TRANSACTIONS = {
  "bca-op": [
    // ── Matched (12) — already confirmed
    { id: "t01", date: "2025-04-21", desc: "Bank service charge",                          amount:    -150000, status: "matched", klay: { date: "2025-04-21", ref: "JE-2025-0285", desc: "Monthly bank fee",                   amount:    -150000, type: "je" } },
    { id: "t02", date: "2025-04-20", desc: "Transfer in · PT Berkah Jaya",                 amount:  18500000, status: "matched", klay: { date: "2025-04-18", ref: "INV-C001-20250418", desc: "Apr invoice · PT Berkah Jaya",      amount:  18500000, type: "invoice" } },
    { id: "t03", date: "2025-04-19", desc: "Wire OUT · PT Logistik Cepat",                 amount: -22300000, status: "matched", klay: { date: "2025-04-15", ref: "BILL-2025-0142",     desc: "Freight bill · PT Logistik Cepat",  amount: -22300000, type: "bill"   } },
    { id: "t04", date: "2025-04-18", desc: "Transfer in · Toko Sentosa",                   amount:  12750000, status: "matched", klay: { date: "2025-04-16", ref: "INV-C003-20250416", desc: "Order #4421 · Toko Sentosa",        amount:  12750000, type: "invoice" } },
    { id: "t05", date: "2025-04-17", desc: "Payroll batch · Apr 17",                       amount: -94500000, status: "matched", klay: { date: "2025-04-17", ref: "JE-2025-0289",       desc: "Payroll payment · April batch",     amount: -94500000, type: "je"     } },
    { id: "t06", date: "2025-04-16", desc: "Transfer in · CV Distributor Sukses",          amount:   8950000, status: "matched", klay: { date: "2025-04-14", ref: "INV-C006-20250414", desc: "Apr invoice · CV Distributor",      amount:   8950000, type: "invoice" } },
    { id: "t07", date: "2025-04-15", desc: "Wire OUT · PT Ritel Utama",                    amount: -15200000, status: "matched", klay: { date: "2025-04-12", ref: "BILL-2025-0138",     desc: "Vendor bill · PT Ritel Utama",      amount: -15200000, type: "bill"   } },
    { id: "t08", date: "2025-04-14", desc: "Transfer in · Koperasi Indah Lestari",         amount:  31200000, status: "matched", klay: { date: "2025-04-11", ref: "INV-C008-20250411", desc: "Q2 order · Koperasi Indah",         amount:  31200000, type: "invoice" } },
    { id: "t09", date: "2025-04-12", desc: "BPJS payment",                                 amount:  -8750000, status: "matched", klay: { date: "2025-04-12", ref: "JE-2025-0276",       desc: "BPJS Kesehatan · April",            amount:  -8750000, type: "je"     } },
    { id: "t10", date: "2025-04-10", desc: "Transfer in · UD Mekar Niaga",                 amount:   5400000, status: "matched", klay: { date: "2025-04-08", ref: "INV-C012-20250408", desc: "Stock order · UD Mekar Niaga",      amount:   5400000, type: "invoice" } },
    { id: "t11", date: "2025-04-08", desc: "Wire OUT · PT Bahan Baku Indonesia",           amount: -42600000, status: "matched", klay: { date: "2025-04-05", ref: "BILL-2025-0132",     desc: "Raw materials · PT Bahan Baku",     amount: -42600000, type: "bill"   } },
    { id: "t12", date: "2025-04-03", desc: "Office rent · April",                          amount: -28000000, status: "matched", klay: { date: "2025-04-01", ref: "JE-2025-0234",       desc: "Office rent expense · April",       amount: -28000000, type: "je"     } },

    // ── Auto (5) — Klay's pick, needs one-click confirm
    { id: "t13", date: "2025-04-23", desc: "Transfer in · ref 8821 / 12500000",            amount:  12500000, status: "auto",   confidence: 96, klay: { date: "2025-04-19", ref: "INV-C001-20250419", desc: "Apr invoice · PT Berkah Jaya",     amount:  12500000, type: "invoice" } },
    { id: "t14", date: "2025-04-22", desc: "Tax payment · OUT",                            amount:  -3300000, status: "auto",   confidence: 93, klay: { date: "2025-04-22", ref: "JE-2025-0301",       desc: "PPN Output · April",                amount:  -3300000, type: "je"      } },
    { id: "t15", date: "2025-04-21", desc: "Transfer in · 7400000",                        amount:   7400000, status: "auto",   confidence: 89, klay: { date: "2025-04-18", ref: "INV-C004-20250418", desc: "Order #4830 · Gunawan Rahmat",     amount:   7400000, type: "invoice" } },
    { id: "t16", date: "2025-04-19", desc: "Bank charge · payment fee",                    amount:    -85000, status: "auto",   confidence: 92, klay: { date: "2025-04-19", ref: "JE-2025-0291",       desc: "Bank charges · April",              amount:    -85000, type: "je"      } },
    { id: "t17", date: "2025-04-15", desc: "Wire OUT · ref 9912",                          amount: -16800000, status: "auto",   confidence: 87, klay: { date: "2025-04-12", ref: "BILL-2025-0140",     desc: "Maintenance bill · PT Service Pro",amount: -16800000, type: "bill"    } },

    // ── To Match (5) — Klay has a low-confidence guess but needs your call
    { id: "t18", date: "2025-04-23", desc: "BCA transfer in · ref 8821",                   amount:  12500000, status: "to-match", suggestion: { ref: "INV-C001-20250416", desc: "PT Berkah Jaya · open AR Rp 12.5jt",              amount:  12500000, reason: "Multiple matching invoices (3) — pick one" } },
    { id: "t19", date: "2025-04-23", desc: "Wire OUT · vendor unknown",                    amount: -47200000, status: "to-match", suggestion: { ref: "BILL-2025-0151",     desc: "PT Sumber Maju · 9 days old · Rp 46.8jt",         amount: -46800000, reason: "Closest match — amount off by Rp 400.000" } },
    { id: "t20", date: "2025-04-22", desc: "BNI tax payment",                              amount:  -3350000, status: "to-match", suggestion: { ref: "JE-2025-0302",       desc: "PPN Output schedule · Rp 3.3jt",                  amount:  -3300000, reason: "Amount off by Rp 50.000 vs schedule" } },
    { id: "t21", date: "2025-04-22", desc: "Customer payment in",                          amount:   8400000, status: "to-match", suggestion: { ref: "INV-C015-20250404", desc: "Toko Sentosa · alt spelling on statement",        amount:   8400000, reason: "Customer name on statement doesn't match records exactly" } },
    { id: "t22", date: "2025-04-21", desc: "Bank service charge · new",                    amount:    -75000, status: "to-match", suggestion: null,                                                                                                                                                                  reason: "New category — first time this period · suggest creating Bank Charges account" },

    // ── Excluded (3) — marked out of scope (e.g., personal, suspense)
    { id: "t23", date: "2025-04-20", desc: "ATM withdrawal · cash",                        amount:  -2500000, status: "excluded", excludeReason: "Personal cash withdrawal · not posted to GL" },
    { id: "t24", date: "2025-04-13", desc: "Internal transfer · between own accounts",     amount: -50000000, status: "excluded", excludeReason: "Inter-account transfer · netted via Mandiri Payroll" },
    { id: "t25", date: "2025-04-07", desc: "Reversal · duplicated charge",                 amount:    150000, status: "excluded", excludeReason: "Bank reversal · already netted in service charge" },
  ],
  "bni-tax": [
    { id: "n01", date: "2025-04-15", desc: "PPN payment · April",          amount: -22000000, status: "matched", klay: { date: "2025-04-15", ref: "JE-2025-0298", desc: "PPN April · Tax Account",         amount: -22000000, type: "je" } },
    { id: "n02", date: "2025-04-10", desc: "PPh 21 payment",                amount:  -9400000, status: "matched", klay: { date: "2025-04-10", ref: "JE-2025-0273", desc: "PPh 21 · April",                  amount:  -9400000, type: "je" } },
    { id: "n03", date: "2025-04-05", desc: "Transfer in from Operating",    amount: 120000000, status: "matched", klay: { date: "2025-04-05", ref: "JE-2025-0245", desc: "Funding · Operating → Tax",       amount: 120000000, type: "je" } },
    { id: "n04", date: "2025-04-02", desc: "PPh 23 payment",                amount:   -600000, status: "matched", klay: { date: "2025-04-02", ref: "JE-2025-0220", desc: "PPh 23 · March",                  amount:   -600000, type: "je" } },
  ],
  "bni-op": [
    { id: "bo01", date: "2025-04-20", desc: "Transfer in · PT Mandiri Logistik",amount: 75000000, status: "matched", klay: { date: "2025-04-18", ref: "INV-C014-20250418", desc: "Q2 freight services",        amount:  75000000, type: "invoice" } },
    { id: "bo02", date: "2025-04-19", desc: "Wire OUT · vendor unknown",         amount:-18400000, status: "auto",    confidence: 88, klay: { date: "2025-04-15", ref: "BILL-2025-0145",     desc: "Office supplies · ATK Maju",  amount: -18400000, type: "bill" } },
    { id: "bo03", date: "2025-04-17", desc: "Internet & phone · Telkom",         amount: -3200000, status: "matched", klay: { date: "2025-04-17", ref: "JE-2025-0265",       desc: "Telecoms expense · April",        amount:  -3200000, type: "je" } },
    { id: "bo04", date: "2025-04-15", desc: "Customer payment · Toko Mekar",     amount: 24500000, status: "matched", klay: { date: "2025-04-12", ref: "INV-C016-20250412", desc: "Bulk order · Toko Mekar",        amount:  24500000, type: "invoice" } },
    { id: "bo05", date: "2025-04-10", desc: "Wire OUT · PT Cetak Sukses",        amount: -8600000, status: "matched", klay: { date: "2025-04-08", ref: "BILL-2025-0135",     desc: "Print materials · PT Cetak",      amount:  -8600000, type: "bill" } },
  ],
  "cimb-op": [
    { id: "co01", date: "2025-04-22", desc: "Transfer in · Hendra Gunawan",      amount:  47200000, status: "matched", klay: { date: "2025-04-20", ref: "INV-C018-20250420", desc: "Custom order · Hendra Gunawan", amount:  47200000, type: "invoice" } },
    { id: "co02", date: "2025-04-18", desc: "Electricity · PLN",                 amount:  -6500000, status: "matched", klay: { date: "2025-04-18", ref: "JE-2025-0286",       desc: "Utilities · April",              amount:  -6500000, type: "je" } },
    { id: "co03", date: "2025-04-14", desc: "Customer payment · CV Anugerah",    amount:  13800000, status: "matched", klay: { date: "2025-04-12", ref: "INV-C020-20250412", desc: "March invoice · CV Anugerah",    amount:  13800000, type: "invoice" } },
    { id: "co04", date: "2025-04-08", desc: "Bank service fee",                  amount:   -125000, status: "matched", klay: { date: "2025-04-08", ref: "JE-2025-0252",       desc: "Bank charges · April",           amount:   -125000, type: "je" } },
  ],
  "mandiri-payroll": [
    { id: "mp01", date: "2025-04-17", desc: "Salary payment · April batch",      amount: -94500000, status: "matched", klay: { date: "2025-04-17", ref: "JE-2025-0289", desc: "Payroll · April",                 amount: -94500000, type: "je" } },
    { id: "mp02", date: "2025-04-17", desc: "Funded from BCA Operating",         amount:  94500000, status: "matched", klay: { date: "2025-04-17", ref: "JE-2025-0290", desc: "Funding · Operating → Payroll",   amount:  94500000, type: "je" } },
    { id: "mp03", date: "2025-04-05", desc: "Bonus payment · Q1",                amount: -12500000, status: "matched", klay: { date: "2025-04-05", ref: "JE-2025-0244", desc: "Q1 performance bonus",            amount: -12500000, type: "je" } },
    { id: "mp04", date: "2025-04-05", desc: "Funded from BCA Operating",         amount:  12500000, status: "matched", klay: { date: "2025-04-05", ref: "JE-2025-0245", desc: "Funding · bonus",                 amount:  12500000, type: "je" } },
  ],
  "bca-petty": [],
  "bca-usd": [
    { id: "u01", date: "2025-04-22", desc: "USD wire OUT · supplier US",         amount: -45000000, status: "matched", klay: { date: "2025-04-20", ref: "BILL-2025-0148", desc: "USD invoice · Tech Supplier Inc", amount: -45000000, type: "bill"  } },
    { id: "u02", date: "2025-04-15", desc: "USD payment in · client US",         amount:  82000000, status: "matched", klay: { date: "2025-04-12", ref: "INV-C022-20250412",desc: "USD invoice · Acme Corp",        amount:  82000000, type: "invoice" } },
    { id: "u03", date: "2025-04-10", desc: "FX conversion fee",                  amount:    -350000, status: "matched", klay: { date: "2025-04-10", ref: "JE-2025-0270",   desc: "FX fee · April",                 amount:   -350000, type: "je" } },
  ],
  "bca-sgd": [
    { id: "s01", date: "2025-04-20", desc: "SGD wire OUT · supplier SG",         amount: -28000000, status: "matched", klay: { date: "2025-04-17", ref: "BILL-2025-0146", desc: "SGD invoice · Singapore Supplier",amount: -28000000, type: "bill" } },
    { id: "s02", date: "2025-04-12", desc: "SGD payment in · client SG",         amount:  35000000, status: "matched", klay: { date: "2025-04-10", ref: "INV-C024-20250410",desc: "SGD invoice · SG Trading",       amount:  35000000, type: "invoice" } },
  ],
  "bca-deposit": [
    { id: "d01", date: "2025-04-01", desc: "Interest credit · Q1",               amount:   3400000, status: "matched", klay: { date: "2025-04-01", ref: "JE-2025-0212",   desc: "Time deposit interest · Q1",     amount:   3400000, type: "je" } },
  ],
  "mandiri-op": [
    { id: "mo01", date: "2025-04-22", desc: "Transfer in · Distributor Jaya",     amount:  68500000, status: "matched", klay: { date: "2025-04-19", ref: "INV-C026-20250419", desc: "Apr invoice · Distributor Jaya", amount:  68500000, type: "invoice" } },
    { id: "mo02", date: "2025-04-19", desc: "Wire OUT · Bahan Baku Sentral",      amount: -32400000, status: "matched", klay: { date: "2025-04-16", ref: "BILL-2025-0152",     desc: "Raw materials · April",          amount: -32400000, type: "bill"    } },
    { id: "mo03", date: "2025-04-16", desc: "Customer payment in",                amount:  22800000, status: "auto",    confidence: 91, klay: { date: "2025-04-13", ref: "INV-C028-20250413", desc: "Custom order · PT Kreatif",      amount:  22800000, type: "invoice" } },
    { id: "mo04", date: "2025-04-12", desc: "Wire OUT · Logistik Express",        amount: -14200000, status: "matched", klay: { date: "2025-04-10", ref: "BILL-2025-0143",     desc: "Freight · April",                amount: -14200000, type: "bill"    } },
  ],
  "bri-op": [
    { id: "br01", date: "2025-04-19", desc: "Customer payment · Toko Maju Bersama", amount: 18900000, status: "matched", klay: { date: "2025-04-17", ref: "INV-C030-20250417", desc: "Apr invoice · Toko Maju",     amount:  18900000, type: "invoice" } },
    { id: "br02", date: "2025-04-14", desc: "Bank fee · transfer",                  amount:   -25000, status: "matched", klay: { date: "2025-04-14", ref: "JE-2025-0271",       desc: "Bank charges",                 amount:    -25000, type: "je" } },
    { id: "br03", date: "2025-04-08", desc: "Wire OUT · supplier",                  amount: -7800000, status: "matched", klay: { date: "2025-04-05", ref: "BILL-2025-0130",     desc: "Vendor payment",               amount:  -7800000, type: "bill" } },
  ],
  "permata-op": [
    { id: "pm01", date: "2025-04-18", desc: "Customer payment in",                amount:  12700000, status: "matched", klay: { date: "2025-04-15", ref: "INV-C032-20250415", desc: "Apr invoice · CV Mitra",         amount:  12700000, type: "invoice" } },
    { id: "pm02", date: "2025-04-10", desc: "Wire OUT · supplier",                amount:  -4500000, status: "matched", klay: { date: "2025-04-08", ref: "BILL-2025-0137",     desc: "Vendor bill · April",            amount:  -4500000, type: "bill" } },
  ],
  "mandiri-petty": [
    { id: "mpc01", date: "2025-04-15", desc: "Office supplies · ATK",             amount:   -850000, status: "matched", klay: { date: "2025-04-15", ref: "JE-2025-0278",       desc: "Office supplies · April",        amount:   -850000, type: "je" } },
    { id: "mpc02", date: "2025-04-08", desc: "Meeting expenses · F&B",            amount:   -420000, status: "matched", klay: { date: "2025-04-08", ref: "JE-2025-0253",       desc: "Meeting catering",               amount:   -420000, type: "je" } },
  ],
  "bca-eur": [
    { id: "e01", date: "2025-04-15", desc: "EUR payment in · client EU",          amount:  28500000, status: "matched", klay: { date: "2025-04-12", ref: "INV-C034-20250412", desc: "EUR invoice · EU Trading SARL",  amount:  28500000, type: "invoice" } },
    { id: "e02", date: "2025-04-10", desc: "FX conversion fee",                   amount:   -180000, status: "matched", klay: { date: "2025-04-10", ref: "JE-2025-0268",       desc: "FX fee · April",                 amount:   -180000, type: "je" } },
  ],
  "mandiri-deposit": [
    { id: "md01", date: "2025-04-01", desc: "Interest credit · Q1",               amount:   1850000, status: "matched", klay: { date: "2025-04-01", ref: "JE-2025-0214",       desc: "Time deposit interest · Q1",     amount:   1850000, type: "je" } },
  ],
  "bca-restricted": [
    { id: "br101", date: "2025-04-01", desc: "Restricted deposit · escrow",       amount:         0, status: "matched", klay: { date: "2025-04-01", ref: "JE-2025-0218",       desc: "Escrow balance roll-forward",    amount:         0, type: "je" } },
  ],
};

// ── Tab counts helper ───────────────────────────────────────────────────
function countByStatus(txs) {
  return txs.reduce(
    (acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; acc.all++; return acc; },
    { all: 0, matched: 0, auto: 0, "to-match": 0, excluded: 0 },
  );
}

// ── Account carousel card ───────────────────────────────────────────────
function AccountCard({ account, counts, selected, onSelect }) {
  const total = (counts.matched || 0) + (counts.auto || 0) + (counts["to-match"] || 0) + (counts.excluded || 0);
  const needsAction = (counts.auto || 0) + (counts["to-match"] || 0);
  return (
    <button
      type="button"
      className={`bank-card${selected ? " selected" : ""}${total === 0 ? " empty" : ""}`}
      onClick={() => onSelect(account.id)}
      aria-pressed={selected}
    >
      <div className="bank-card-head">
        <div className="bank-card-logo" style={{ background: account.color }}>{account.bank.slice(0, 1)}</div>
        <div className="bank-card-id">
          <div className="bank-card-title">{account.glAccount} · {account.name}</div>
          <div className="bank-card-no">{account.bank} · {account.number}</div>
        </div>
        {total === 0 ? (
          <span className="bank-card-pill empty">No statement</span>
        ) : needsAction > 0 ? (
          <span className="bank-card-pill warn">{needsAction} to review</span>
        ) : (
          <span className="bank-card-pill ok">All matched</span>
        )}
      </div>
      <div className="bank-card-amt">Rp {fmtRp(account.balance)}</div>
      <div className="bank-card-meta">
        {total === 0 ? "no transactions" : <>Matched <strong>Rp {fmtRp(account.matchedAmount)}</strong></>}
      </div>
    </button>
  );
}

// ── Upload modal — picker → fake processing → result panel ──────────────
const PROC_STEPS = [
  { label: "Parsing 25 transactions from BCA · Apr 1–23, 2025…", ms: 900 },
  { label: "Matching against journal entries and open AR / AP…",   ms: 1000 },
  { label: "Detected account: BCA Operating · 1101-100",          ms: 800 },
];

function UploadStatementModal({ open, onClose, onComplete }) {
  const [phase, setPhase] = useState("picker");
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!open) { setPhase("picker"); setStepIdx(0); }
  }, [open]);

  useEffect(() => {
    if (phase !== "processing") return;
    if (stepIdx >= PROC_STEPS.length) {
      const t = setTimeout(() => setPhase("done"), 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStepIdx((i) => i + 1), PROC_STEPS[stepIdx].ms);
    return () => clearTimeout(t);
  }, [phase, stepIdx]);

  if (!open) return null;

  return (
    <div className="bank-upload-backdrop" onClick={onClose}>
      <div className="bank-upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bank-upload-head">
          <span className="bank-upload-icon" aria-hidden><SparkleIcon /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">
              {phase === "picker"     && "Upload bank statement"}
              {phase === "processing" && "Klay is processing your statement"}
              {phase === "done"       && "Recon ready · BCA Operating"}
            </div>
            <div className="bank-upload-sub">
              {phase === "picker"     && "Klay will auto-detect the account from the statement"}
              {phase === "processing" && "OCR + auto-matching in progress"}
              {phase === "done"       && "Switched to BCA Operating · 25 transactions"}
            </div>
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
          </button>
        </div>

        <div className="bank-upload-body">
          {phase === "picker" && (
            <>
              <div className="bank-upload-drop">
                <svg viewBox="0 0 32 32" className="bank-upload-drop-icon">
                  <path d="M16 6v16M10 12l6-6 6 6M6 26h20" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="bank-upload-drop-title">Drop your PDF e-statement</div>
                <div className="bank-upload-drop-sub">or click below to choose a file</div>
                <button type="button" className="bank-upload-browse" onClick={() => setPhase("processing")}>
                  Choose PDF
                </button>
              </div>
              <div className="bank-upload-hint">
                <SparkleIcon /> Klay will OCR the statement, auto-detect which account it belongs to, and auto-match against your existing JEs / bills / invoices.
              </div>
            </>
          )}

          {phase === "processing" && (
            <div className="bank-upload-processing">
              {PROC_STEPS.slice(0, stepIdx + 1).map((s, i) => (
                <div key={i} className={`bank-upload-step${i === stepIdx ? " active" : " done"}`}>
                  <span className="bank-upload-step-mark">
                    {i < stepIdx ? (
                      <svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    ) : (
                      <span className="bank-upload-spinner" />
                    )}
                  </span>
                  {s.label}
                </div>
              ))}
            </div>
          )}

          {phase === "done" && (
            <>
              <div className="bank-upload-result">
                <div className="bank-upload-result-stat ok">
                  <div className="bank-upload-result-val">17</div>
                  <div className="bank-upload-result-lbl">Klay handled</div>
                </div>
                <div className="bank-upload-result-stat warn">
                  <div className="bank-upload-result-val">5</div>
                  <div className="bank-upload-result-lbl">need review</div>
                </div>
                <div className="bank-upload-result-stat">
                  <div className="bank-upload-result-val">25</div>
                  <div className="bank-upload-result-lbl">total entries</div>
                </div>
              </div>
              <div className="bank-upload-result-summary">
                <SparkleIcon /> Klay auto-handled <strong>68%</strong> · the remaining <strong>5</strong> need your decision below.
              </div>
            </>
          )}
        </div>

        {phase === "done" && (
          <div className="bank-upload-foot">
            <button type="button" className="bank-upload-btn ghost" onClick={onClose}>Close</button>
            <button type="button" className="bank-upload-btn primary" onClick={() => { onComplete?.("bca-op"); onClose(); }}>
              Open BCA Operating →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status pill ─────────────────────────────────────────────────────────
const STATUS_LABEL = { matched: "Matched", auto: "Auto", "to-match": "To Match", excluded: "Excluded" };

function StatusPill({ status, confidence }) {
  return (
    <span className={`recon-pill ${status}`}>
      {status === "matched"  && <svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      {status === "auto"     && <SparkleIcon />}
      {status === "to-match" && <svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5"/><line x1="6" y1="4" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1.4"/><circle cx="6" cy="8.2" r="0.65" fill="currentColor"/></svg>}
      {status === "excluded" && <svg viewBox="0 0 12 12"><line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>}
      {STATUS_LABEL[status]}
      {status === "auto" && confidence != null && <span className="recon-pill-conf">{confidence}%</span>}
    </span>
  );
}

// ── Recon row ───────────────────────────────────────────────────────────
function ReconRow({ row, isChecked, onCheck, onAction }) {
  const klay = row.klay;
  const sug = row.suggestion;
  const isMatched  = row.status === "matched";
  const isAuto     = row.status === "auto";
  const isToMatch  = row.status === "to-match";
  const isExcluded = row.status === "excluded";

  return (
    <div className={`recon-row ${row.status}`} data-recon-row={row.id}>
      <div className="recon-cb" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="lg-row-check" checked={isChecked} onChange={() => onCheck(row.id)} />
      </div>

      {/* Bank side — 3 cells */}
      <div className="recon-cell recon-cell-date">{fmtDateShort(row.date)}</div>
      <div className="recon-cell recon-cell-desc" title={row.desc}>{row.desc}</div>
      <div className={`recon-cell recon-cell-amt${row.amount < 0 ? " neg" : " pos"}`}>{fmtAmt(row.amount)}</div>

      {isMatched ? (
        <div className="recon-divider matched" aria-hidden title="Linked to Klay entry">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </div>
      ) : (
        <div className="recon-divider" aria-hidden />
      )}

      {/* Klay side — 3 cells OR a wide spanning cell */}
      {(isMatched || isAuto) && klay && (
        <>
          <div className="recon-cell recon-cell-date">{fmtDateShort(klay.date)}</div>
          <div className="recon-cell recon-cell-desc">
            <span className="recon-klay-ref">{klay.ref}</span>
            <span className="recon-klay-desc" title={klay.desc}>{klay.desc}</span>
          </div>
          <div className={`recon-cell recon-cell-amt${klay.amount < 0 ? " neg" : " pos"}`}>{fmtAmt(klay.amount)}</div>
        </>
      )}
      {isToMatch && (
        <div className="recon-cell recon-klay-wide">
          <span className="recon-suggestion-icon"><SparkleIcon /></span>
          <div className="recon-suggestion-body">
            {sug ? (
              <>
                <div className="recon-suggestion-title">
                  Klay's guess: <span className="recon-klay-ref">{sug.ref}</span> · {sug.desc}
                </div>
                <div className="recon-suggestion-reason">{row.reason || ""}</div>
              </>
            ) : (
              <>
                <div className="recon-suggestion-title">No match found</div>
                <div className="recon-suggestion-reason">{row.reason || "Klay couldn't find a candidate."}</div>
              </>
            )}
          </div>
        </div>
      )}
      {isExcluded && (
        <div className="recon-cell recon-klay-wide recon-excluded-note">
          <svg viewBox="0 0 12 12"><line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.6"/><line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.6"/></svg>
          {row.excludeReason || "Excluded from reconciliation"}
        </div>
      )}

      {/* Gap column between Klay and Status */}
      <div className="recon-gap" aria-hidden />

      {/* Status */}
      <div className="recon-status-cell">
        <StatusPill status={row.status} confidence={row.confidence} />
      </div>

      {/* Actions */}
      <div className="recon-actions-cell" onClick={(e) => e.stopPropagation()}>
        {isAuto && (
          <>
            <button type="button" className="recon-action ghost" onClick={() => onAction("reject", row)}>Reject</button>
            <button type="button" className="recon-action primary" onClick={() => onAction("confirm", row)}>Confirm</button>
          </>
        )}
        {isToMatch && (
          <>
            <button type="button" className="recon-action ghost" onClick={() => onAction("create", row)}>+ Create</button>
            {sug && <button type="button" className="recon-action primary" onClick={() => onAction("use", row)}>Use this</button>}
            {!sug && <button type="button" className="recon-action primary" onClick={() => onAction("search", row)}>Search →</button>}
          </>
        )}
        {isExcluded && (
          <button type="button" className="recon-action ghost" onClick={() => onAction("restore", row)}>Restore</button>
        )}
        {isMatched && (
          <span className="recon-actions-quiet">—</span>
        )}
      </div>
    </div>
  );
}

// ── Search-to-Match modal ────────────────────────────────────────────────
function SearchMatchModal({ open, row, candidates, onClose, onPick }) {
  const [q, setQ] = useState("");
  useEffect(() => { if (!open) setQ(""); }, [open]);
  if (!open || !row) return null;
  const lower = q.toLowerCase().trim();
  const filtered = !lower
    ? candidates
    : candidates.filter((c) =>
        (c.ref || "").toLowerCase().includes(lower) ||
        (c.desc || "").toLowerCase().includes(lower) ||
        String(Math.abs(c.amount || 0)).includes(lower.replace(/[,.]/g, "")),
      );
  return (
    <div className="bank-modal-backdrop" onClick={onClose}>
      <div className="bank-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bank-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-modal-title">Find a matching entry</div>
            <div className="bank-modal-sub">
              For bank: <strong>{row.desc}</strong> · {fmtDateShort(row.date)} · <span className={row.amount < 0 ? "neg" : "pos"}>{fmtAmt(row.amount)}</span>
            </div>
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
          </button>
        </div>
        <div className="bank-modal-search">
          <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
          <input
            type="text"
            autoFocus
            placeholder="Search by reference, description, or amount…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="bank-modal-body">
          <div className="bank-modal-listhead">
            <span>{filtered.length} of {candidates.length} unmatched entries</span>
          </div>
          {filtered.length === 0 && (
            <div className="bank-modal-empty">No matches. Try different terms — or use <strong>+ Create</strong> to book a new entry.</div>
          )}
          {filtered.map((c) => {
            const amtMatches = Math.abs(c.amount) === Math.abs(row.amount);
            return (
              <div key={c.ref} className="bank-modal-row">
                <div className="bank-modal-row-info">
                  <div className="bank-modal-row-head">
                    <span className="recon-klay-ref">{c.ref}</span>
                    <span className="bank-modal-row-type">{c.type === "je" ? "Journal" : c.type === "bill" ? "Bill" : "Invoice"}</span>
                  </div>
                  <div className="bank-modal-row-desc">{c.desc}</div>
                  <div className="bank-modal-row-meta">{fmtDateShort(c.date)}</div>
                </div>
                <div className={`bank-modal-row-amt${c.amount < 0 ? " neg" : " pos"}`}>{fmtAmt(c.amount)}</div>
                <button
                  type="button"
                  className={`recon-action ${amtMatches ? "primary" : "ghost"}`}
                  onClick={() => onPick(c)}
                >
                  {amtMatches ? "Match" : "Match anyway"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Create-Entry modal ───────────────────────────────────────────────────
function CreateEntryModal({ open, row, onClose, onCreate }) {
  const [type, setType] = useState("je");
  useEffect(() => { if (!open) setType("je"); }, [open]);
  if (!open || !row) return null;
  const TYPES = [
    { k: "je",      lbl: "Journal Entry",    sub: "Bank fee, interest, transfer, FX adjustment — generic GL posting" },
    { k: "bill",    lbl: "Bill",             sub: "Vendor payment with no prior bill (one-off supplier)" },
    { k: "invoice", lbl: "Invoice payment",  sub: "Apply this receipt to an existing open AR invoice" },
  ];
  return (
    <div className="bank-modal-backdrop" onClick={onClose}>
      <div className="bank-modal create" onClick={(e) => e.stopPropagation()}>
        <div className="bank-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-modal-title">Create entry from bank line</div>
            <div className="bank-modal-sub">
              <strong>{row.desc}</strong> · {fmtDateShort(row.date)} · <span className={row.amount < 0 ? "neg" : "pos"}>{fmtAmt(row.amount)}</span>
            </div>
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
          </button>
        </div>
        <div className="bank-modal-body">
          {TYPES.map((t) => (
            <button
              key={t.k}
              type="button"
              className={`bank-modal-type${type === t.k ? " selected" : ""}`}
              onClick={() => setType(t.k)}
            >
              <div className="bank-modal-type-radio">{type === t.k && <span />}</div>
              <div className="bank-modal-type-body">
                <div className="bank-modal-type-lbl">{t.lbl}</div>
                <div className="bank-modal-type-sub">{t.sub}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="bank-modal-foot">
          <button type="button" className="bank-upload-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="bank-upload-btn primary" onClick={() => onCreate(type)}>Create &amp; match →</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function BankReconciliationPage() {
  const [selectedAccount, setSelectedAccount] = useState("bca-op");
  const [accountGroup, setAccountGroup] = useState("all");
  const [groupPopOpen, setGroupPopOpen] = useState(false);
  const groupPopRef = useRef(null);
  const [period, setPeriod] = useState("2025-04");
  const [statusFilter, setStatusFilter] = useState("all");
  const [transactions, setTransactions] = useState(INITIAL_TRANSACTIONS);
  const [searchModal, setSearchModal] = useState(null); // { accountId, row } when open
  const [createModal, setCreateModal] = useState(null);
  const [klayQuery, setKlayQuery] = useState("");
  const [highlightedRef, setHighlightedRef] = useState(null);
  const [accountListOpen, setAccountListOpen] = useState(false);
  const klayInputRef = useRef(null);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState(() => new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  useEffect(() => {
    if (!groupPopOpen) return;
    const onDoc = (e) => { if (groupPopRef.current && !groupPopRef.current.contains(e.target)) setGroupPopOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [groupPopOpen]);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1800);
  }

  const account = ACCOUNTS.find((a) => a.id === selectedAccount);
  const txs = transactions[selectedAccount] || [];
  const counts = useMemo(() => countByStatus(txs), [txs]);

  const filteredRows = useMemo(() => {
    let list = txs;
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((t) =>
        t.desc.toLowerCase().includes(q) ||
        (t.klay?.ref || "").toLowerCase().includes(q) ||
        (t.klay?.desc || "").toLowerCase().includes(q) ||
        (t.suggestion?.ref || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [txs, statusFilter, search]);

  // Bank vs Klay totals across the currently visible rows (excludes Excluded)
  const totals = useMemo(() => {
    let bank = 0;
    let klay = 0;
    for (const t of filteredRows) {
      if (t.status === "excluded") continue;
      bank += t.amount || 0;
      if ((t.status === "matched" || t.status === "auto") && t.klay) {
        klay += t.klay.amount || 0;
      }
    }
    return { bank, klay, diff: bank - klay };
  }, [filteredRows]);

  function toggleRow(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function clearChecks() { setChecked(new Set()); }

  function updateRow(rowId, patch) {
    setTransactions((prev) => ({
      ...prev,
      [selectedAccount]: (prev[selectedAccount] || []).map((t) => (t.id === rowId ? { ...t, ...patch } : t)),
    }));
  }

  function onRowAction(action, row) {
    if (action === "confirm") {
      // Auto → Matched: keep the existing klay match, drop the confidence pill
      updateRow(row.id, { status: "matched", confidence: undefined });
      showToast(`${row.id} confirmed — Klay's match is now posted`);
    } else if (action === "reject") {
      // Auto → To Match: the Klay match was wrong; demote to manual review
      updateRow(row.id, { status: "to-match", suggestion: row.klay, klay: null, confidence: undefined, reason: "Klay's auto-match was rejected — find the right entry" });
      showToast(`${row.id} rejected — moved to To Match`);
    } else if (action === "use") {
      // To Match → Matched: promote the suggestion to the matched klay entry
      const sug = row.suggestion || {};
      updateRow(row.id, { status: "matched", klay: { date: row.date, ref: sug.ref, desc: sug.desc, amount: sug.amount, type: "je" }, suggestion: null, reason: undefined });
      showToast(`${row.id} matched · ${sug.ref || ""}`);
    } else if (action === "create") {
      setCreateModal({ row });
    } else if (action === "search") {
      setSearchModal({ row });
    } else if (action === "restore") {
      // Excluded → To Match
      updateRow(row.id, { status: "to-match", excludeReason: undefined, reason: "Restored from Excluded — find a match" });
      showToast(`${row.id} restored to To Match`);
    }
  }

  function onSearchPick(candidate) {
    const row = searchModal?.row;
    if (!row) return;
    updateRow(row.id, { status: "matched", klay: { date: candidate.date, ref: candidate.ref, desc: candidate.desc, amount: candidate.amount, type: candidate.type }, suggestion: null, reason: undefined });
    showToast(`${row.id} matched · ${candidate.ref}`);
    setSearchModal(null);
  }

  // ⌘K / Ctrl+K to focus the Klay bar; Esc clears
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        klayInputRef.current?.focus();
        klayInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // After lookup, scroll + flash the matched row
  useEffect(() => {
    if (!highlightedRef) return;
    const el = document.querySelector(`[data-recon-row="${highlightedRef}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("lg-klay-flash");
      const tmr = setTimeout(() => {
        el.classList.remove("lg-klay-flash");
        setHighlightedRef(null);
      }, 2400);
      return () => clearTimeout(tmr);
    }
    setHighlightedRef(null);
  }, [highlightedRef]);

  function submitKlayQuery() {
    const q = klayQuery.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    // Lookup: reference like JE-2025-0301 / BILL-2025-0148 / INV-C001-20250419
    if (/^(je|bill|inv)[-_]/i.test(q)) {
      const upper = q.toUpperCase();
      // Find which account this ref lives in
      for (const acctId of Object.keys(transactions)) {
        const list = transactions[acctId];
        const hit = list.find((t) => (t.klay?.ref || "").toUpperCase() === upper || (t.suggestion?.ref || "").toUpperCase() === upper);
        if (hit) {
          setSelectedAccount(acctId);
          setStatusFilter("all");
          setSearch("");
          setHighlightedRef(hit.id);
          setKlayQuery("");
          return;
        }
      }
      showToast(`${q} not found in any account`);
      setKlayQuery("");
      return;
    }
    // Status keyword shortcuts
    if (/^(to[- ]match|unmatched|need[s]? review)$/i.test(lower)) {
      setStatusFilter("to-match"); setKlayQuery("");
      return;
    }
    if (/^auto$/i.test(lower)) { setStatusFilter("auto"); setKlayQuery(""); return; }
    if (/^matched$/i.test(lower)) { setStatusFilter("matched"); setKlayQuery(""); return; }
    if (/^excluded$/i.test(lower)) { setStatusFilter("excluded"); setKlayQuery(""); return; }
    // Otherwise treat as free-text filter
    setSearch(q);
    setKlayQuery("");
  }

  function onCreateEntry(type) {
    const row = createModal?.row;
    if (!row) return;
    const refPrefix = type === "je" ? "JE" : type === "bill" ? "BILL" : "INV";
    const newRef = `${refPrefix}-2025-${String(Math.floor(Math.random() * 900) + 100).padStart(4, "0")}`;
    const typeLabel = type === "je" ? "Journal Entry" : type === "bill" ? "Bill" : "Invoice payment";
    updateRow(row.id, {
      status: "matched",
      klay: { date: row.date, ref: newRef, desc: `${typeLabel} from bank: ${row.desc}`, amount: row.amount, type },
      suggestion: null,
      reason: undefined,
    });
    showToast(`Created ${newRef} · matched to ${row.id}`);
    setCreateModal(null);
  }

  function onBulk(action) {
    showToast(`${checked.size} entr${checked.size === 1 ? "y" : "ies"} ${action}`);
    clearChecks();
  }

  const TABS = [
    { k: "all",      lbl: "All" },
    { k: "auto",     lbl: "Auto",     tone: "warn"   },
    { k: "to-match", lbl: "To Match", tone: "danger" },
    { k: "matched",  lbl: "Matched",  tone: "ok"     },
    { k: "excluded", lbl: "Excluded" },
  ];

  return (
    <div className="lg-page bank-recon-page">
      <div className="lg-scroll-container">
        {/* ── Hero: title + period + accounts share one white surface ──── */}
        <div className="bank-recon-hero">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Bank Reconciliation</h1>
            </div>
            <div className="lg-head-actions">
              <button className="lg-btn-brand" onClick={() => setUploadOpen(true)}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Upload statement
              </button>
            </div>
          </div>
        </div>

        {/* ── Period tabs + Filter (matches General Ledger pattern) ────── */}
        <div className="bank-period-wrap">
          <div className="lg-period-tabs">
            <div className="lg-pt-arr"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></div>
            {PERIODS.map((p) => (
              <div
                key={p.v}
                className={`lg-pt-tab ${p.state}${period === p.v ? " active" : ""}`}
                onClick={() => setPeriod(p.v)}
                title={p.state === "locked" ? "Period locked" : p.state === "future" ? "Period hasn't started" : ""}
              >
                {p.state === "locked" && (
                  <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                )}
                {p.lbl}
              </div>
            ))}
            <div className="lg-pt-arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div>
          </div>
          <div className="bank-filter-wrap" ref={groupPopRef}>
            <button
              type="button"
              className={`bank-filter-btn${accountGroup !== "all" ? " active" : ""}`}
              onClick={() => setGroupPopOpen((v) => !v)}
              aria-expanded={groupPopOpen}
              aria-label="Filter accounts by group"
              title="Filter accounts by group"
            >
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 2.5h11l-4 5v4l-3 1.5v-5.5z" />
              </svg>
              <span className="bank-filter-label">
                {ACCOUNT_GROUPS.find((g) => g.k === accountGroup)?.lbl || "All"}
              </span>
              <svg viewBox="0 0 12 12" className="bank-filter-caret" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 5 6 8 9 5" />
              </svg>
            </button>
            {groupPopOpen && (
              <div className="bank-filter-pop">
                {ACCOUNT_GROUPS.map((g) => {
                  const count = g.k === "all" ? ACCOUNTS.length : ACCOUNTS.filter((a) => a.group === g.k).length;
                  const active = accountGroup === g.k;
                  return (
                    <button
                      key={g.k}
                      type="button"
                      className={`bank-filter-pop-item${active ? " active" : ""}`}
                      onClick={() => { setAccountGroup(g.k); setGroupPopOpen(false); }}
                    >
                      <span className="bank-filter-pop-label">{g.lbl}</span>
                      <span className="bank-filter-pop-count">{count}</span>
                      {active && (
                        <svg className="bank-filter-pop-check" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="2 6 5 9 10 3" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Account quick-access row (3 cards) + "more" → drawer ────── */}
        <div className="bank-carousel-row">
          <div className="bank-carousel">
            {(() => {
              const filtered = ACCOUNTS.filter((a) => accountGroup === "all" || a.group === accountGroup);
              const selectedInFiltered = filtered.find((a) => a.id === selectedAccount);
              let visible = filtered.slice(0, 3);
              if (selectedInFiltered && !visible.some((a) => a.id === selectedAccount)) {
                visible = [selectedInFiltered, ...filtered.slice(0, 2)];
              }
              const remaining = filtered.length - visible.length;
              return (
                <>
                  {visible.map((acct) => (
                    <AccountCard
                      key={acct.id}
                      account={acct}
                      counts={countByStatus(transactions[acct.id] || [])}
                      selected={selectedAccount === acct.id}
                      onSelect={(id) => { setSelectedAccount(id); clearChecks(); setStatusFilter("all"); }}
                    />
                  ))}
                  {remaining > 0 && (
                    <button
                      type="button"
                      className="bank-card bank-card-more"
                      onClick={() => setAccountListOpen(true)}
                    >
                      <div className="bank-card-more-icon">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="3" cy="7" r="1"/><circle cx="7" cy="7" r="1"/><circle cx="11" cy="7" r="1"/>
                        </svg>
                      </div>
                      <div className="bank-card-more-val">+{remaining}</div>
                      <div className="bank-card-more-lbl">more accounts</div>
                      <div className="bank-card-more-cta">View all →</div>
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>
        </div>

        {/* ── Selected account header ─────────────────────────────────── */}
        <div className="recon-acct-head">
          <div className="recon-acct-title">
            <strong>{account?.name}</strong>
            <span className="close-meta-sep">·</span>
            {account?.statementPeriod}
            <span className="close-meta-sep">·</span>
            {counts.all} transactions
          </div>
        </div>

        {/* ── Table card (pills + search/filter + table) ──────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card recon-card">
            {/* Status pills */}
            <div className="bp-tabs-row">
              {TABS.map((t) => (
                <button
                  key={t.k}
                  type="button"
                  className={`bp-tab${statusFilter === t.k ? " active" : ""}`}
                  onClick={() => setStatusFilter(t.k)}
                >
                  {t.lbl}
                  <span className="bp-tab-count">
                    {t.k === "all" ? counts.all : (counts[t.k] || 0)}
                  </span>
                </button>
              ))}
            </div>

            {/* Klay-powered search bar (consistent with JE / Invoices) */}
            <div className="lg-filter-row">
              <div className="lg-klay-bar">
                <span className="lg-klay-bar-icon" aria-hidden><SparkleIcon /></span>
                <input
                  ref={klayInputRef}
                  className="lg-klay-bar-input"
                  placeholder="Search, filter, or ask Klay — try ‘JE-2025-0301’, ‘to match’, or ‘from PT Berkah’"
                  value={klayQuery}
                  onChange={(e) => setKlayQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); submitKlayQuery(); }
                    else if (e.key === "Escape") { e.preventDefault(); setKlayQuery(""); }
                  }}
                />
                {search ? (
                  <span className="lg-klay-chip">
                    {`Search: "${search}"`}
                    <button type="button" className="lg-klay-chip-x" onClick={() => setSearch("")} aria-label="Clear search">
                      <svg viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
                    </button>
                  </span>
                ) : null}
                {statusFilter !== "all" ? (
                  <span className="lg-klay-chip">
                    {`Status: ${TABS.find((t) => t.k === statusFilter)?.lbl || ""}`}
                    <button type="button" className="lg-klay-chip-x" onClick={() => setStatusFilter("all")} aria-label="Clear status filter">
                      <svg viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
                    </button>
                  </span>
                ) : null}
                {(search || statusFilter !== "all") ? (
                  <button type="button" className="lg-klay-chips-clear" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Clear all</button>
                ) : null}
                <span className="lg-klay-bar-hint" aria-hidden>⌘K</span>
              </div>
            </div>

            {/* Per-account Klay summary — what Klay did for THIS account's statement */}
            {counts.all > 0 && (
              <div className="recon-account-summary">
                <span className="recon-account-summary-icon"><SparkleIcon /></span>
                <div className="recon-account-summary-text">
                  <strong>Klay handled {counts.matched + counts.auto} of {counts.all - counts.excluded} entries</strong>
                  {" "}in {account?.name}'s {account?.statementPeriod} statement
                  {(counts.auto + counts["to-match"]) > 0 && (
                    <> · <strong className="recon-account-summary-warn">{counts.auto + counts["to-match"]}</strong> need your review</>
                  )}
                </div>
                {(counts.auto + counts["to-match"]) > 0 && (
                  <button
                    type="button"
                    className="recon-account-summary-cta"
                    onClick={() => setStatusFilter(counts["to-match"] > 0 ? "to-match" : "auto")}
                  >
                    Review {counts.auto + counts["to-match"]} →
                  </button>
                )}
              </div>
            )}

            <div className="recon-table">
            {/* Group ribbon: thin row spanning bank vs klay */}
            <div className="recon-group-ribbon" aria-hidden>
              <div />
              <div className="recon-group-bank">BANK STATEMENT</div>
              <div />
              <div className="recon-group-klay"><SparkleIcon /> KLAY ENTRY</div>
              <div />
              <div className="recon-group-status">STATUS</div>
              <div />
            </div>
            {/* Column subheads, single row */}
            <div className="recon-row recon-row-head" aria-hidden>
              <div className="recon-cb"><input type="checkbox" className="lg-row-check" disabled /></div>
              <div className="recon-cell-head">Date</div>
              <div className="recon-cell-head">Description</div>
              <div className="recon-cell-head r">Amount</div>
              <div className="recon-divider" aria-hidden />
              <div className="recon-cell-head">Date</div>
              <div className="recon-cell-head">Description</div>
              <div className="recon-cell-head r">Amount</div>
              <div className="recon-gap" aria-hidden />
              <div className="recon-cell-head"></div>
              <div className="recon-cell-head"></div>
            </div>

            {filteredRows.length === 0 && (
              <div className="recon-empty">
                No transactions in this view.
                {counts.all === 0 && <> Upload a statement to get started.</>}
              </div>
            )}

            {filteredRows.map((row) => (
              <ReconRow
                key={row.id}
                row={row}
                isChecked={checked.has(row.id)}
                onCheck={toggleRow}
                onAction={onRowAction}
              />
            ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sticky footer — bank vs klay summation ───────────────────── */}
      <div className="lg-footer">
        <div className="lg-footer-left">
          {checked.size > 0 ? (
            <>
              <span><span className="lg-footer-num">{checked.size}</span> selected</span>
              <button type="button" className="lg-footer-bulk-btn" onClick={() => onBulk("confirmed")}>Confirm all auto</button>
              <button type="button" className="lg-footer-bulk-btn" onClick={() => onBulk("excluded")}>Exclude</button>
              <button type="button" className="lg-footer-clear" onClick={clearChecks}>Clear selection</button>
            </>
          ) : (
            <>
              <span>Showing <span className="lg-footer-num">{filteredRows.length}</span> {filteredRows.length === 1 ? "transaction" : "transactions"}</span>
              {counts["to-match"] > 0 && (
                <>
                  <span className="lg-footer-sep">·</span>
                  <span><span className="lg-footer-num">{counts["to-match"]}</span> still to match</span>
                </>
              )}
            </>
          )}
        </div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Bank</span>
          <span className="lg-footer-total">Rp {fmtRp(totals.bank)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Klay</span>
          <span className="lg-footer-total">Rp {fmtRp(totals.klay)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Difference</span>
          {totals.diff === 0 ? (
            <span className="lg-footer-total ok">✓ Balanced</span>
          ) : (
            <span className="lg-footer-total warn">Rp {fmtRp(Math.abs(totals.diff))}</span>
          )}
        </div>
      </div>

      {/* ── Full account list — side drawer ─────────────────────────── */}
      {accountListOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setAccountListOpen(false)} />
          <div className="drawer bank-accounts-list-drawer">
            <div className="drawer-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title">All bank accounts</div>
                <div className="drawer-sub">{ACCOUNTS.length} accounts across {ACCOUNT_GROUPS.length - 1} groups</div>
              </div>
              <button type="button" className="drawer-close" onClick={() => setAccountListOpen(false)}>
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="drawer-body">
              {ACCOUNT_GROUPS.filter((g) => g.k !== "all").map((g) => {
                const groupAccounts = ACCOUNTS.filter((a) => a.group === g.k);
                if (groupAccounts.length === 0) return null;
                return (
                  <div key={g.k} className="bank-list-group">
                    <div className="bank-list-group-head">
                      <span>{g.lbl}</span>
                      <span className="bank-list-group-count">{groupAccounts.length}</span>
                    </div>
                    {groupAccounts.map((acct) => {
                      const acctCounts = countByStatus(transactions[acct.id] || []);
                      const total = (acctCounts.matched || 0) + (acctCounts.auto || 0) + (acctCounts["to-match"] || 0) + (acctCounts.excluded || 0);
                      const needsAction = (acctCounts.auto || 0) + (acctCounts["to-match"] || 0);
                      const isSelected = selectedAccount === acct.id;
                      return (
                        <button
                          key={acct.id}
                          type="button"
                          className={`bank-list-item${isSelected ? " selected" : ""}`}
                          onClick={() => {
                            setSelectedAccount(acct.id);
                            clearChecks();
                            setStatusFilter("all");
                            setAccountListOpen(false);
                          }}
                        >
                          <span className="bank-list-item-logo" style={{ background: acct.color }}>{acct.bank.slice(0, 1)}</span>
                          <div className="bank-list-item-info">
                            <div className="bank-list-item-title">{acct.glAccount} · {acct.name}</div>
                            <div className="bank-list-item-meta">{acct.bank} · {acct.number}</div>
                          </div>
                          <div className="bank-list-item-right">
                            <div className="bank-list-item-amt">Rp {fmtRp(acct.balance)}</div>
                            {total === 0 ? (
                              <span className="bank-list-item-pill empty">No statement</span>
                            ) : needsAction > 0 ? (
                              <span className="bank-list-item-pill warn">{needsAction} to review</span>
                            ) : (
                              <span className="bank-list-item-pill ok">All matched</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <UploadStatementModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onComplete={(acctId) => setSelectedAccount(acctId)}
      />

      <SearchMatchModal
        open={!!searchModal}
        row={searchModal?.row}
        candidates={UNMATCHED_BOOK_ENTRIES}
        onClose={() => setSearchModal(null)}
        onPick={onSearchPick}
      />

      <CreateEntryModal
        open={!!createModal}
        row={createModal?.row}
        onClose={() => setCreateModal(null)}
        onCreate={onCreateEntry}
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
