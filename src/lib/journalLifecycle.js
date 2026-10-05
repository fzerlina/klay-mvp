// Journal entry lifecycle — what can happen to an entry, and who may do it.
//
//   Draft ──submit──▶ Pending ──approve──▶ Posted ──reverse──▶ (new reversing entry)
//     │                  │ └──return──▶ Draft
//     └──void            └──void
//
// Rules, each returned as { ok, reason } so a disabled control can say why:
//   • Only a draft can be edited; posted history is never edited, it is reversed.
//   • Submitting needs a balanced entry dated in an open period.
//   • The person who prepared an entry cannot approve it (segregation of
//     duties) — approving IS posting, so this is the one control between a
//     preparer and the ledger.
//   • Nothing posts into a closed period.
//   • Only manual, recurring and scheduled entries are reversed here. An entry
//     a bill, payment, invoice or bank match wrote is corrected at that source,
//     or the source and the ledger would disagree.
//
// Every transition appends to `history`, which the Audit tab reads.

import { TODAY } from "./clock";

const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const periodOf = (date) => String(date || "").slice(0, 7);
export const isClosedDate = (date, closedThrough) => !!closedThrough && periodOf(date) <= closedThrough;

export function firstOfNextMonth(date) {
  const [y, m] = periodOf(date).split("-").map((n) => parseInt(n, 10));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

const sums = (je) => (je.lines || []).reduce((s, l) => ({ dr: s.dr + (l.debit || 0), cr: s.cr + (l.credit || 0) }), { dr: 0, cr: 0 });
export const isBalanced = (je) => { const { dr, cr } = sums(je); return dr > 0 && Math.round(dr) === Math.round(cr); };

const OK = { ok: true, reason: null };
const no = (reason) => ({ ok: false, reason });

// Entries other screens wrote. They change where they came from.
const SOURCE_TYPES = new Set(["bill", "ap_bill", "bill_payment", "invoice", "invoice_payment", "payment", "bank_reconciliation", "inventory_movement"]);
export const isSystemEntry = (je) => SOURCE_TYPES.has(je.reference_type);

export function canEdit(je) {
  if (je.status !== "draft") return no("Only a draft can be edited. Posted entries are reversed, not changed.");
  if (isSystemEntry(je)) return no("Written by another screen — change it at its source.");
  return OK;
}

export function canSubmit(je, { closedThrough } = {}) {
  if (je.status !== "draft") return no("Only a draft can be submitted.");
  if (!isBalanced(je)) return no("Debits and credits do not balance.");
  if (isClosedDate(je.je_date, closedThrough)) return no(`${periodOf(je.je_date)} is closed — date the entry in an open period.`);
  return OK;
}

export function canApprove(je, { user, closedThrough, canPost } = {}) {
  if (je.status !== "pending") return no("Only an entry awaiting approval can be approved.");
  if (!canPost) return no("Your role cannot approve journal entries.");
  if (user && je.created_by === user) return no("You prepared this entry — someone else has to approve it.");
  if (isClosedDate(je.je_date, closedThrough)) return no(`${periodOf(je.je_date)} is closed — it can no longer be posted.`);
  if (!isBalanced(je)) return no("Debits and credits do not balance.");
  return OK;
}

export function canReturn(je, { canPost } = {}) {
  if (je.status !== "pending") return no("Only an entry awaiting approval can be sent back.");
  if (!canPost) return no("Your role cannot review journal entries.");
  return OK;
}

export function canVoid(je) {
  if (je.status !== "draft" && je.status !== "pending") return no("Only a draft or pending entry can be voided. Reverse a posted one.");
  if (isSystemEntry(je)) return no("Written by another screen — change it at its source.");
  return OK;
}

export function canReverse(je, { canPost } = {}) {
  if (je.status !== "posted") return no("Only a posted entry can be reversed.");
  if (!canPost) return no("Your role cannot post journal entries.");
  if (je.reversed_by) return no(`Already reversed by ${je.reversed_by}.`);
  if (je.reversal_of) return no("This is itself a reversal.");
  if (isSystemEntry(je)) return no("Written by another screen — reverse it at its source.");
  return OK;
}

// A reversing date has to be on or after the original and in an open period.
export function reversalDateCheck(je, date, { closedThrough } = {}) {
  if (!date) return no("Pick a date.");
  if (date < je.je_date) return no("A reversal cannot be dated before the entry it reverses.");
  if (isClosedDate(date, closedThrough)) return no(`${periodOf(date)} is closed.`);
  return OK;
}

export function withEvent(je, action, by, note) {
  // Dated by the demo clock, like every other date in the prototype.
  return { ...je, history: [...(je.history || []), { at: isoOf(TODAY), action, by, note: note || "" }] };
}

// The reversing entry: same accounts, sides swapped, pointing back at the
// original. Posted directly — reversing a posted entry is a posting act.
export function buildReversal(je, { jeNumber, date, by, today }) {
  return withEvent({
    je_number: jeNumber,
    je_date: date,
    status: "posted",
    memo: `Reversal of ${je.je_number} — ${je.memo}`,
    reference_type: "reversal",
    reference_id: je.je_number,
    reversal_of: je.je_number,
    created_by: by, created_date: today,
    posted_by: by, posted_date: today,
    lines: (je.lines || []).map((l) => ({
      ...l,
      debit: l.credit || 0,
      credit: l.debit || 0,
      description: l.description ? `Reverse: ${l.description}` : "Reversal",
    })),
  }, "posted", by, `Reverses ${je.je_number}`);
}
