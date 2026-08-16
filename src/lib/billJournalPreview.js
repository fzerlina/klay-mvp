// Client-side GL Journal Entry preview — constructs the DR/CR lines this
// bill will write to the General Ledger on posting. Pure function; no side
// effects. Line shape mirrors src/data/seed/journalEntries.js so the preview
// reads as a draft journal entry against the canonical AP CoA accounts.
//
// Derivation rules (Indonesian AP standard):
//   DR  per line item     →  item.acct, item.subtotal           (cost / asset)
//   CR  AP Trade          →  total − pph23  (2-1100)             (vendor payable)
//   CR  PPh withholding   →  bill.pph23  (2-2300 or 2-2400)      (tax payable to DJP)
//
// Each line carries a `rule` explaining why the entry was generated. Lines
// that the rule engine generated with low confidence get a `flag` (PRD:
// "lines generated from low-confidence rule evaluations are shown with a
// yellow indicator"). The preview is read-only — FM edits the bill fields
// above and the preview updates.

import { ruleExplanation } from "./billConfidence";

// Canonical AP account codes — kept here as constants so the preview wires
// up to the same chart the existing journal-entry seeds use. In production
// these would come from a CoA mapping table per entity.
const ACCT_AP_TRADE    = { code: "2-1100", name: "Accounts Payable — Trade" };
const ACCT_PPH23       = { code: "2-2300", name: "PPh 23 Payable" };
const ACCT_PPH4_FINAL  = { code: "2-2400", name: "PPh 4(2) Payable" };

function pphAccount(vendor) {
  if (vendor?.pph === "pph4_final") return ACCT_PPH4_FINAL;
  return ACCT_PPH23;
}

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

  // 2) AP Trade CR — what's actually owed to the vendor (total − pph23).
  //    The vendor invoices the gross; we withhold PPh and pay them the net.
  const apAmount = bill.total - (bill.pph23 || 0);
  lines.push({
    side:         "CR",
    account_code: ACCT_AP_TRADE.code,
    account_name: ACCT_AP_TRADE.name,
    amount:       apAmount,
    description:  `Trade payable to ${vendor?.name || bill.vendorName}`,
    rule:         "AP control rule: gross invoice less withholding = vendor payable",
    flag:         null,
  });

  // 3) PPh withholding CR — when applicable. Account routes by article
  //    (PPh 23 → 2-2300, PPh 4(2) → 2-2400). PPh 21 is out-of-scope for MVP
  //    per the latest PRD revision.
  if (bill.pph23 > 0) {
    const acct = pphAccount(vendor);
    lines.push({
      side:         "CR",
      account_code: acct.code,
      account_name: acct.name,
      amount:       bill.pph23,
      description:  "Withholding payable to DJP",
      rule:         ruleExplanation("pph23", vendor),
      flag:         null,
    });
  }

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
  const today = new Date().toISOString().slice(0, 10);
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
