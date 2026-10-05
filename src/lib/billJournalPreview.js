// Client-side GL Journal Entry preview — constructs the DR/CR lines this
// bill will write to the General Ledger on posting. Pure function; no side
// effects. Line shape mirrors src/data/seed/journalEntries.js so the preview
// reads as a draft journal entry against the canonical AP CoA accounts.
//
// Derivation rules (Indonesian AP standard):
//   DR  per line item     →  item.acct, item.subtotal           (cost / asset)
//   DR  VAT Input         →  bill.ppn  (1-5100)                  (creditable PPN)
//   CR  AP Trade          →  bill.total  (2-1100)                (gross payable)
//
// PPh is NOT booked here. It is recognised when the bill is paid: Record
// payment splits the gross payable into cash to the vendor and a withholding
// deduction to 2-2300, which is also the moment the bukti potong obligation
// arises (lib/paymentJournal.js). Booking it at posting as well counted the
// tax twice — once here, once at payment (decided 2026-10-05).
//
// Each line carries a `rule` explaining why the entry was generated. Lines
// that the rule engine generated with low confidence get a `flag` (PRD:
// "lines generated from low-confidence rule evaluations are shown with a
// yellow indicator"). The preview is read-only — FM edits the bill fields
// above and the preview updates.

import { TODAY } from "./clock";

// Canonical AP account codes — kept here as constants so the preview wires
// up to the same chart the existing journal-entry seeds use. In production
// these would come from a CoA mapping table per entity.
const ACCT_AP_TRADE    = { code: "2-1100", name: "Accounts Payable — Trade" };
const ACCT_VAT_INPUT   = { code: "1-5100", name: "VAT Input (PPN Masukan)" };

export function previewJournalLines(bill, vendor) {
  const lines = [];

  // 1) Expense DRs — one per line item, against the item's CoA mapping.
  //    Kept per-line so the FM can verify each item's account assignment.
  for (const item of bill.items || []) {
    lines.push({
      side:         "DR",
      account_code: item.acct,
      account_name: item.acctName,
      amount:       item.subtotal,
      description:  item.desc,
      rule:         `Mapped from CoA: ${item.acct} (rule: bill item category)`,
      flag:         null,
    });
  }

  // 2) VAT Input DR — PPN the vendor charges is not a cost, it is a claim
  //    against the tax office, so it debits an asset rather than the expense
  //    lines above. Without it the entry cannot balance: the line items sum to
  //    DPP while the vendor is owed DPP + PPN.
  if (bill.ppn > 0) {
    lines.push({
      side:         "DR",
      account_code: ACCT_VAT_INPUT.code,
      account_name: ACCT_VAT_INPUT.name,
      amount:       bill.ppn,
      description:  "Creditable input VAT",
      rule:         "Tax rule: PPN on a PKP vendor's faktur pajak is creditable",
      flag:         null,
    });
  }

  // 3) AP Trade CR — the gross the vendor invoiced. Any PPh is withheld out
  //    of this at payment, not here (see the header).
  lines.push({
    side:         "CR",
    account_code: ACCT_AP_TRADE.code,
    account_name: ACCT_AP_TRADE.name,
    amount:       bill.total,
    description:  `Trade payable to ${vendor?.name || bill.vendorName}`,
    rule:         bill.pph23 > 0
      ? "AP control rule: the gross invoice is payable; PPh is withheld from it when the bill is paid"
      : "AP control rule: the gross invoice is payable",
    flag:         null,
  });

  const totalDr = lines.filter((l) => l.side === "DR").reduce((s, l) => s + l.amount, 0);
  const totalCr = lines.filter((l) => l.side === "CR").reduce((s, l) => s + l.amount, 0);
  // Allow 1 IDR rounding tolerance — Indonesian invoices sometimes off by
  // rounding when computed from cents internally.
  const balanced = Math.abs(totalDr - totalCr) <= 1;
  const anyFlag  = lines.some((l) => l.flag);

  return { lines, totalDr, totalCr, balanced, anyFlag };
}

// Build a full journal entry record from a bill — used by the BillDetailPage
// Approve action to actually post the bill to the GL. Shape mirrors the seed
// records in src/data/seed/journalEntries.js so it slots into the same lists
// without special-casing on the GeneralLedger / TrialBalance / JournalEntry
// pages.
export function buildJournalEntry(bill, vendor, jeNumber, postedBy) {
  const { lines } = previewJournalLines(bill, vendor);
  // The demo clock, not the wall clock: every date in the prototype is 2025.
  // Local parts, not toISOString(), which shifts a midnight date back a day.
  const today = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;
  return {
    je_number:      jeNumber,
    je_date:        today,
    status:         "posted",
    memo:           `AP — ${vendor?.name || bill.vendorName} · ${bill.invNo !== "—" ? bill.invNo : bill.id}`,
    reference_type: "ap_bill",
    reference_id:   bill.id,
    created_by:     postedBy,
    created_date:   today,
    posted_by:      postedBy,
    posted_date:    today,
    lines: lines.map((l) => ({
      account_code: l.account_code,
      account_name: l.account_name,
      debit:        l.side === "DR" ? l.amount : 0,
      credit:       l.side === "CR" ? l.amount : 0,
      description:  l.description,
    })),
  };
}
