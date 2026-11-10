// Adjusting entries (jurnal penyesuaian) for March 2025, the month the Trial
// Balance opens on, so its adjusted / unadjusted views have something to show.
// Posted manual journals flagged `is_adjusting: true`: month-end accruals, a
// deferral released, and a provision the external auditor (KAP) proposed in
// its Q1 review — which the client posts in its own books so the ledger
// matches the audited figures (SME, 10 Nov 2026).
//
// Numbered after every other seeded 2025 journal, so no two share a number.

import { COA } from "./coa";
import { JOURNAL_ENTRIES } from "./journalEntries";
import { PAYMENT_HISTORY_JES } from "./paymentHistory";
import { LEDGER_BACKFILL_JES } from "./ledgerBackfill";
import { NON_BANK_JES } from "./nonBankAccounts";

const BY = "Rina Kusuma";
const APPROVER = "Hana Wijoyo";
const nameOf = (code) => COA.find((a) => a.code === code)?.name || code;

let seq = Math.max(
  ...[...JOURNAL_ENTRIES, ...PAYMENT_HISTORY_JES, ...LEDGER_BACKFILL_JES, ...NON_BANK_JES]
    .map((j) => /^JE-2025-(\d+)$/.exec(j.je_number || "")?.[1])
    .filter(Boolean)
    .map(Number),
);

function adj(date, memo, reference, lines) {
  seq += 1;
  return {
    je_number: `JE-2025-${String(seq).padStart(4, "0")}`,
    je_date: date, status: "posted", memo, reference,
    reference_type: "manual", reference_id: null,
    is_adjusting: true,
    created_by: BY, created_date: "2025-04-02", posted_by: APPROVER, posted_date: "2025-04-03",
    lines: lines.map(([code, debit, credit, description]) => ({ account_code: code, account_name: nameOf(code), debit, credit, description: description || memo })),
  };
}

export const ADJUSTING_JES = [
  adj("2025-03-31", "Accrue March electricity — PLN bill not yet received", null, [
    ["6-2400", 18_500_000, 0, "March electricity (estimate)"],
    ["2-1200", 0, 18_500_000, "Accrued electricity"],
  ]),
  adj("2025-03-31", "Accrue Q1 staff bonus", null, [
    ["6-2200", 45_000_000, 0, "Q1 bonus — admin staff"],
    ["2-4400", 0, 45_000_000, "Bonus payable"],
  ]),
  adj("2025-03-31", "Release deferred revenue earned in March — annual service contracts", null, [
    ["2-4300", 32_000_000, 0, "Deferred revenue released"],
    ["4-1500", 0, 32_000_000, "Service revenue earned"],
  ]),
  adj("2025-03-31", "Audit adjustment (KAP) — provision for doubtful receivables", "AJE-01 Q1 review", [
    ["6-3500", 25_000_000, 0, "Bad debt expense"],
    ["1-2200", 0, 25_000_000, "Allowance for doubtful accounts"],
  ]),
];
