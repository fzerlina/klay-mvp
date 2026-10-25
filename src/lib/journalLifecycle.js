// Journal entry lifecycle — what can happen to an entry, and who may do it.
//
//   Draft ──submit──▶ Pending ──approve──▶ Posted ──reverse──▶ (new reversing entry)
//     │                  │ └──return──▶ Draft      │
//     └──void            └──void                   └──delete (Settings → Preferences) ──▶ Deleted
//                                                     (only when Klay has turned deletion on)
//
// Rules, each returned as { ok, reason } so a disabled control can say why:
//   • Only a draft can be edited; posted history is never edited, it is reversed.
//   • Submitting needs a memo and a balanced entry dated in an open period,
//     with no line on an account a manual journal can't post to (inactive,
//     a group, or a control account only its module writes — PRD §2).
//   • The person who prepared an entry cannot approve it (segregation of
//     duties) — approving IS posting, so this is the one control between a
//     preparer and the ledger. The one exception is opt-in: Settings → General
//     Ledger → Self-posting lets an approver post their own manual journal up
//     to a limit, and every such post is marked self-approved.
//   • Nothing posts into a closed period.
//   • Only manual, recurring and scheduled entries are reversed here. An entry
//     a bill, payment, invoice or bank match wrote is corrected at that source,
//     or the source and the ledger would disagree.
//
// Every transition appends to `history`, which the Audit tab reads.

import { TODAY } from "./clock";
import { COA_BY_CODE } from "../data/seed/coa";
import { DIM_BY_KEY, dimensionsForAccount } from "../data/seed/dimensions";

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
export const entryTotal = (je) => sums(je).dr;

const OK = { ok: true, reason: null };
const no = (reason) => ({ ok: false, reason });

// Why a manual journal line can't post to this account, or null. Checked in
// the PRD's order (§2 Posting Eligibility): active, a leaf (groups have no
// code), then manual posting allowed — a control account is written only by
// its module, so the subledger and the ledger always agree.
export function manualPostBlock(code) {
  const acct = COA_BY_CODE[code];
  if (!acct || acct.is_active === false) return "This account is inactive.";
  if (acct.manual_post === false) return `Posted by the ${acct.posted_by_module} module — correct via credit note.`;
  return null;
}

// A line missing a dimension its account requires — the form's rule, so an
// entry can't skip it by being submitted or approved from the list. Submit is
// strict (a draft can still be edited). Approve leaves alone lines with no
// dimensions at all: they predate per-line tagging (shown as simulated), and
// an entry already submitted that way shouldn't get stuck in the queue.
function untaggedLine(je, { strict = false } = {}) {
  const lines = je.lines || [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.dimensions && !strict) continue;
    const dims = l.dimensions || {};
    const missing = dimensionsForAccount(COA_BY_CODE[l.account_code]).filter((k) => !dims[k]);
    if (missing.length) return `Line ${i + 1} (${l.account_code}) needs ${missing.map((k) => DIM_BY_KEY[k]?.label || k).join(", ")}.`;
  }
  return null;
}

function blockedLine(je) {
  const i = (je.lines || []).findIndex((l) => manualPostBlock(l.account_code));
  if (i < 0) return null;
  const l = je.lines[i];
  return `Line ${i + 1} (${l.account_code}): ${manualPostBlock(l.account_code)}`;
}

// Entries other screens wrote. They change where they came from.
const SOURCE_TYPES = new Set(["bill", "ap_bill", "bill_payment", "invoice", "invoice_payment", "payment", "bank_reconciliation", "inventory_movement"]);
export const isSystemEntry = (je) => SOURCE_TYPES.has(je.reference_type);

// Written by another screen, but reversed here. The bank reconciliation never
// undoes a journal it posted — a wrong one is reversed in the GL, and the
// reconciliation follows (the bank line needs a journal again). Edit and void
// stay at the source like any other system entry.
const REVERSED_IN_GL = new Set(["bank_reconciliation"]);
export const reversibleHere = (je) => !isSystemEntry(je) || REVERSED_IN_GL.has(je.reference_type);

export function canEdit(je) {
  if (je.status !== "draft") return no("Only a draft can be edited. Posted entries are reversed, not changed.");
  if (isSystemEntry(je)) return no("Written by another screen — change it at its source.");
  return OK;
}

export function canSubmit(je, { closedThrough } = {}) {
  if (je.status !== "draft") return no("Only a draft can be submitted.");
  if (!String(je.memo || "").trim()) return no("Add a memo — the business reason for the entry.");
  if (!isBalanced(je)) return no("Debits and credits do not balance.");
  if (isClosedDate(je.je_date, closedThrough)) return no(`${periodOf(je.je_date)} is closed — move the posting date into an open period.`);
  if (!isSystemEntry(je) && blockedLine(je)) return no(blockedLine(je));
  if (!isSystemEntry(je) && untaggedLine(je, { strict: true })) return no(untaggedLine(je, { strict: true }));
  return OK;
}

// Can this approver post their own entry? Only with Self-posting on, and only
// for a manual journal within the limit.
export function selfPostCheck(je, selfPost) {
  if (!selfPost?.enabled) return no("You prepared this entry — someone else has to approve it.");
  if (isSystemEntry(je)) return no("You prepared this entry — someone else has to approve it.");
  if (entryTotal(je) > selfPost.limit) {
    return no(`You prepared this entry and it is over your self-posting limit of Rp ${selfPost.limit.toLocaleString("id-ID")} — someone else has to approve it.`);
  }
  return OK;
}

// `self: true` on the result marks an approval of one's own entry, which the
// caller records as self-approved.
export function canApprove(je, { user, closedThrough, canPost, selfPost } = {}) {
  if (je.status !== "pending") return no("Only an entry awaiting approval can be approved.");
  if (!canPost) return no("Your role cannot approve journal entries.");
  const own = !!user && je.created_by === user;
  if (own) {
    const self = selfPostCheck(je, selfPost);
    if (!self.ok) return self;
  }
  if (isClosedDate(je.je_date, closedThrough)) return no(`${periodOf(je.je_date)} is closed — it can no longer be posted.`);
  if (!isBalanced(je)) return no("Debits and credits do not balance.");
  if (!isSystemEntry(je) && blockedLine(je)) return no(blockedLine(je));
  if (!isSystemEntry(je) && untaggedLine(je)) return no(untaggedLine(je));
  return own ? { ...OK, self: true } : OK;
}

// The posted entry an approval writes, marked self-approved when the approver
// prepared it — the Risk Flag spec's is_self_approved_flag.
export function approvedEntry(cur, { by, today, self }) {
  const posted = { ...cur, status: "posted", posted_by: by, posted_date: today, ...(self ? { self_approved: true } : {}) };
  return withEvent(posted, "approved and posted", by, self ? "Self-posted — prepared and posted by the same person" : "");
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

export function canReverse(je, { canReverse: allowed } = {}) {
  if (je.status !== "posted") return no("Only a posted entry can be reversed.");
  if (!allowed) return no("Your role cannot reverse journal entries.");
  if (je.reversed_by) return no(`Already reversed by ${je.reversed_by}.`);
  if (je.reversal_of) return no("This is itself a reversal.");
  if (!reversibleHere(je)) return no("Written by another screen — reverse it at its source.");
  return OK;
}

// Soft-delete (Settings → Accounting → Preferences → Delete journals). Only
// for a company Klay has turned it on for in the backend. Someone enters the
// JE numbers and confirms with a reason; each entry becomes "deleted" — out of
// every ledger total, still listed under Deleted, the deletion and its reason
// in the entry's own audit trail. Entries other screens wrote are deleted at
// their source; halves of a reversal pair and closed periods are left alone.
export function canDelete(je, { closedThrough } = {}) {
  if (je.status === "deleted") return no("Already deleted.");
  if (je.status !== "posted") return no("Only a posted entry can be deleted. Void a draft instead.");
  if (isSystemEntry(je)) return no("Written by another screen — delete it at its source.");
  if (je.reversed_by || je.reversal_of) return no("Part of a reversal — delete neither half on its own.");
  if (isClosedDate(je.je_date, closedThrough)) return no(`${periodOf(je.je_date)} is closed.`);
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
