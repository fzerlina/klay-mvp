// The manual journal form — line shapes, validation and the entry it saves.
// Shared by the Journal Entry page (pages/JournalEntryFormPage.jsx) and
// anything else that drafts a manual journal, so the rules live in one place.
//
// Two levels of checks:
//   • lineErrors — what a draft needs before it can be saved at all: each line
//     has one side, an amount and its dimensions, and the entry balances. A
//     payee is optional on every line (agreed 25 Oct 2026).
//   • submitBlocks — what submitting or posting adds on top: a memo, an open
//     period, a valid reversal date, a valid repeat schedule, and no line on an
//     account a manual journal can't post to (lib/journalLifecycle.js
//     manualPostBlock).
// A draft may sit on a control account or in a closed period — it is
// re-pointed or re-dated before it goes anywhere.

import { COA_BY_CODE } from "../data/seed/coa";
import { DIM_BY_KEY, dimensionsForAccount } from "../data/seed/dimensions";
import { manualPostBlock, isClosedDate, periodOf, firstOfNextMonth } from "./journalLifecycle";
import { recurrenceProblem } from "./recurringJournals";

let LINE_SEQ = 0;
export function blankLine() {
  return { id: ++LINE_SEQ, account_code: "", debit: "", credit: "", description: "", dims: {}, payee: "" };
}

// A journal template's lines (Settings → Journal templates): its accounts and
// the side each sits on; amounts stay blank. An account the template leaves
// open is picked here.
export function templateLines(template) {
  return template.lines.map((l) => ({ ...blankLine(), account_code: l.account || "", side: l.side }));
}

// Lines from an existing draft or another page into the form's shape.
// Amounts come in as numbers; the inputs want strings.
export function seedLines(initialLines) {
  if (!Array.isArray(initialLines) || !initialLines.length) return [blankLine(), blankLine()];
  return initialLines.map((l) => ({
    id: ++LINE_SEQ,
    account_code: l.account_code || "",
    debit: l.debit ? String(l.debit) : "",
    credit: l.credit ? String(l.credit) : "",
    description: l.description || "",
    payee: l.payee ? `${l.payee.kind}:${l.payee.id}` : "",
    dims: { ...(l.dimensions || {}) },
  }));
}

export const applicableDims = (code) => {
  const acct = COA_BY_CODE[code];
  return acct ? dimensionsForAccount(acct) : [];
};

// Real dimension values only — "—" is the "not applicable" placeholder.
export const dimValues = (key) => (DIM_BY_KEY[key]?.values || []).filter((v) => v !== "—");

export const amountOf = (raw) => parseInt(raw, 10) || 0;

export function totalsOf(lines) {
  const active = lines.filter((l) => l.account_code);
  const debit = active.reduce((s, l) => s + amountOf(l.debit), 0);
  const credit = active.reduce((s, l) => s + amountOf(l.credit), 0);
  return { active, debit, credit, diff: debit - credit, balanced: debit > 0 && debit === credit };
}

export function validateForm({ lines, memo, jeDate, closedThrough, reversal, recurrence = null }) {
  const totals = totalsOf(lines);
  const lineErrors = {};
  const lineBlocks = {};
  for (const l of lines) {
    if (!l.account_code) continue;
    const d = amountOf(l.debit);
    const c = amountOf(l.credit);
    const missing = [];
    if (d === 0 && c === 0) missing.push("amount");
    if (d > 0 && c > 0) missing.push("one side only");
    for (const k of applicableDims(l.account_code)) if (!l.dims[k]) missing.push(DIM_BY_KEY[k]?.label || k);
    if (missing.length) lineErrors[l.id] = missing;
    const block = manualPostBlock(l.account_code);
    if (block) lineBlocks[l.id] = block;
  }

  const draftBlocks = [];
  if (totals.active.length < 2) draftBlocks.push("Add at least two lines.");
  else if (!totals.balanced) draftBlocks.push("Debits and credits do not balance.");
  if (Object.keys(lineErrors).length) draftBlocks.push("Some lines are incomplete.");

  const submitBlocks = [...draftBlocks];
  if (!memo.trim()) submitBlocks.push("Add a memo — the business reason for the entry.");
  if (isClosedDate(jeDate, closedThrough)) submitBlocks.push(`${periodOf(jeDate)} is closed — move the posting date into an open period.`);
  if (Object.keys(lineBlocks).length) submitBlocks.push("A line posts to an account manual journals can't use.");
  if (reversal.on) {
    if (!reversal.date) submitBlocks.push("Pick the reversal date.");
    else if (reversal.date <= jeDate) submitBlocks.push("The reversal date must be after the entry date.");
    else if (isClosedDate(reversal.date, closedThrough)) submitBlocks.push(`The reversal date is in ${periodOf(reversal.date)}, which is closed.`);
  }
  const repeatProblem = recurrence && recurrenceProblem(recurrence, jeDate);
  if (repeatProblem) submitBlocks.push(repeatProblem);

  return { totals, lineErrors, lineBlocks, draftBlocks, submitBlocks, canSave: draftBlocks.length === 0, canSubmit: submitBlocks.length === 0 };
}

export const defaultReversalDate = (jeDate) => firstOfNextMonth(jeDate);

// The entry the form saves, always as a draft — submitting and posting are
// lifecycle moves the page applies afterwards (lib/journalLifecycle.js).
// A payee lives on its line only; an older draft's header payee is dropped
// here (the form has already moved it onto the payable lines). `recurrence` is
// the repeat schedule (lib/recurringJournals.js) or null.
export function buildEntry({ editing, jeNumber, jeDate, memo, reference, reversal, recurrence, attachments, lines, createdBy, today, payeeOf }) {
  const active = lines.filter((l) => l.account_code);
  const { auto_reverse: _ar, reversal_date: _rd, payee: _pe, recurrence: _rc, ...kept } = editing || {};
  return {
    ...kept,
    je_number: editing?.je_number || jeNumber,
    je_date: jeDate,
    status: "draft",
    memo: memo.trim(),
    reference: reference.trim() || null,
    reference_type: editing?.reference_type || "manual",
    reference_id: editing?.reference_id ?? null,
    created_by: editing?.created_by || createdBy,
    created_date: editing?.created_date || today,
    posted_by: null,
    posted_date: null,
    ...(reversal.on ? { auto_reverse: true, reversal_date: reversal.date } : {}),
    ...(recurrence ? { recurrence } : {}),
    attachments,
    lines: active.map((l) => ({
      account_code: l.account_code,
      account_name: COA_BY_CODE[l.account_code]?.name || "",
      debit: amountOf(l.debit),
      credit: amountOf(l.credit),
      // Blank reads the memo (PRD §3: "Description — optional, inherits memo").
      description: l.description.trim() || memo.trim(),
      dimensions: { ...l.dims },
      ...(payeeOf(l.payee) ? { payee: payeeOf(l.payee) } : {}),
    })),
  };
}
