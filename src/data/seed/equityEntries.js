// Equity and financing journals for 2025, so the Statement of Changes in
// Equity (Perubahan Modal) and the Cash Flow statement (Arus Kas) have
// something besides profit to show:
//   • a capital injection (setoran modal) split between share capital and
//     additional paid-in capital, received in BCA;
//   • a dividend declared at the RUPS (Dr dividends distributed, Cr dividends
//     payable) and paid a month later, with PPh withheld;
//   • a bank loan drawn and its first instalment repaid — financing cash flows.
//
// Loaded into the journal store (JournalEntriesContext) like the adjusting
// entries, not into journalEntries.js, which bank reconciliation builds its
// statements from. Numbered after every other seeded 2025 journal.

import { COA } from "./coa";
import { JOURNAL_ENTRIES } from "./journalEntries";
import { PAYMENT_HISTORY_JES } from "./paymentHistory";
import { LEDGER_BACKFILL_JES } from "./ledgerBackfill";
import { NON_BANK_JES } from "./nonBankAccounts";
import { ADJUSTING_JES } from "./adjustingEntries";

const BY = "Rina Kusuma";
const APPROVER = "Hana Wijoyo";
const nameOf = (code) => COA.find((a) => a.code === code)?.name || code;

let seq = Math.max(
  ...[...JOURNAL_ENTRIES, ...PAYMENT_HISTORY_JES, ...LEDGER_BACKFILL_JES, ...NON_BANK_JES, ...ADJUSTING_JES]
    .map((j) => /^JE-2025-(\d+)$/.exec(j.je_number || "")?.[1])
    .filter(Boolean)
    .map(Number),
);

function je(date, memo, reference, lines) {
  seq += 1;
  return {
    je_number: `JE-2025-${String(seq).padStart(4, "0")}`,
    je_date: date, status: "posted", memo, reference,
    reference_type: "manual", reference_id: null,
    created_by: BY, created_date: date, posted_by: APPROVER, posted_date: date,
    lines: lines.map(([code, debit, credit, description]) => ({ account_code: code, account_name: nameOf(code), debit, credit, description: description || memo })),
  };
}

export const EQUITY_JES = [
  je("2025-01-20", "Drawdown — BCA investment loan, 36 months", "PK/BCA/2025/017", [
    ["1-1500", 500_000_000, 0, "Loan proceeds received"],
    ["2-5100", 0, 500_000_000, "BCA investment loan"],
  ]),
  je("2025-02-14", "Capital injection — PT Buana Investama (RUPSLB 10 Feb 2025)", "Akta No. 12/2025", [
    ["1-1500", 300_000_000, 0, "Setoran modal received"],
    ["3-1100", 0, 250_000_000, "2,500 new shares at Rp 100.000 par"],
    ["3-1200", 0, 50_000_000, "Share premium (agio saham)"],
  ]),
  je("2025-02-20", "BCA investment loan — instalment 1", "PK/BCA/2025/017", [
    ["2-5100", 13_888_889, 0, "Principal"],
    ["1-1500", 0, 13_888_889, "Instalment debited"],
  ]),
  je("2025-03-20", "BCA investment loan — instalment 2", "PK/BCA/2025/017", [
    ["2-5100", 13_888_889, 0, "Principal"],
    ["1-1500", 0, 13_888_889, "Instalment debited"],
  ]),
  je("2025-03-28", "Final dividend FY2024 declared — RUPS Tahunan 28 Mar 2025", "Notulen RUPST 2025", [
    ["3-1500", 75_000_000, 0, "Dividend Rp 100 per share"],
    ["2-4500", 0, 75_000_000, "Payable to shareholders"],
  ]),
  je("2025-04-15", "Final dividend FY2024 paid", "Notulen RUPST 2025", [
    ["2-4500", 75_000_000, 0, "Dividend settled"],
    ["1-1500", 0, 67_500_000, "Paid to shareholders"],
    ["2-2300", 0, 7_500_000, "PPh 4(2) final withheld — individual shareholders (10%)"],
  ]),
];
