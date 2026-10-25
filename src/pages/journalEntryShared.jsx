import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useAssets } from "../state/AssetsContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { scheduledEntries, postedFromSchedule } from "../lib/scheduledJournals";
import {
  canEdit, canSubmit, canApprove as canApproveEntry, canReturn, canVoid, canReverse,
  isSystemEntry, reversibleHere, withEvent, buildReversal, approvedEntry, isoOf,
} from "../lib/journalLifecycle";
import { ReturnDialog, ReverseDialog } from "./JeActionDialogs";
import { TODAY } from "../lib/clock";

// What the Journal Entry list and the Journal Entry detail page share: the
// rows they show (stored entries plus derived Auto and Scheduled ones), and
// every lifecycle action with its dialogs — so a row menu, a bulk action and
// the detail page's buttons all run the same checks and say the same thing.

export function fmtRp(n) {
  if (n == null) return "—";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function lineSums(je) {
  let debit = 0, credit = 0;
  for (const l of je.lines) {
    debit += l.debit || 0;
    credit += l.credit || 0;
  }
  return { debit, credit };
}

export const STATUS_LABEL = { posted: "Posted", draft: "Draft", pending: "Pending", void: "Void", scheduled: "Scheduled", deleted: "Deleted" };
export const STATUS_BADGE_CLASS = { posted: "approved", draft: "draft", pending: "review", void: "rejected", scheduled: "scheduled", deleted: "rejected" };

// Which screen wrote an entry, for the list's Source column and filter.
// Manual = the Journal Entry form, plus reversals of its entries — by hand or
// automatic (only a manual entry can be set to auto-reverse);
// Fixed assets = the register's monthly depreciation and amortisation.
export const JE_SOURCES = [
  { key: "manual", label: "Manual" },
  { key: "bills", label: "Bills" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "bankrec", label: "Bank rec" },
  { key: "fixedassets", label: "Fixed assets" },
  { key: "inventory", label: "Inventory" },
];
export const JE_SOURCE_LABEL = Object.fromEntries(JE_SOURCES.map((s) => [s.key, s.label]));

export function entrySource(je) {
  switch (je.reference_type) {
    case "bill": case "ap_bill": return "bills";
    case "invoice": return "invoices";
    case "bill_payment": case "payment": case "invoice_payment": return "payments";
    case "bank_reconciliation": case "bank_quick_draft": return "bankrec";
    case "schedule": return "fixedassets";
    case "inventory_movement": return "inventory";
    default: return "manual";
  }
}

export function KlaySparkleIcon() {
  return (
    <svg viewBox="0 0 14 14"><path d="M7 1.5l1.3 3.2L11.5 6l-3.2 1L7 10.2 5.7 7 2.5 6l3.2-1.3L7 1.5z"/><path d="M11.5 10l.4 1.1L13 11.5l-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1z"/></svg>
  );
}

// The actions an entry offers, built once per entry (actionsFor) and shown in
// the row menu and on the detail page, so the two never disagree. A blocked
// action stays visible, greyed, with the reason as its tooltip — "you
// prepared this, someone else approves it" is worth seeing.
export const ACTION_ICON = {
  check: <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  send: <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  edit: <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  back: <svg viewBox="0 0 24 24"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>,
  reverse: <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>,
  repeat: <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  link: <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  void: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
  trash: <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
};

// Every row the Journal Entry screens show: stored entries plus the Scheduled
// entries derived from the asset register and auto-reversals.
export function useJournalRows() {
  const { entries } = useJournalEntries();
  const { assets, closedThrough } = useAssets();
  return useMemo(() => {
    const stored = entries.map((je) => ({ ...je, ...lineSums(je) }));
    // A month drops off once its posted entry exists (lib/scheduledJournals.js).
    const scheduled = scheduledEntries(assets, { entries, closedThrough, today: TODAY })
      .map((je) => ({ ...je, ...lineSums(je) }));
    return [...stored, ...scheduled];
  }, [entries, assets, closedThrough]);
}

// Lifecycle actions and their dialogs.
//   showToast(msg)              — the screen's toast
//   fromTab                     — the list tab to come back to from the form
//   onPostedScheduled(new, row) — a scheduled entry was posted as `new`
export function useJournalActions({ showToast, fromTab = null, onPostedScheduled } = {}) {
  const navigate = useNavigate();
  const {
    entries, addJournalEntry, updateJournalEntry, peekNextJeNumber,
  } = useJournalEntries();
  const { hasLevel, hasCapability, user } = useCurrentUser();
  const { closedThrough } = useAssets();
  const { selfPost } = useAccountingSettings();
  const [dialog, setDialog] = useState(null);

  const canApprove = hasLevel("gl", "approve+post");
  const canTransact = hasLevel("gl", "transact");
  const actor = user?.name || "You";
  const todayIso = isoOf(TODAY);
  const ctx = { user: actor, closedThrough, canPost: canApprove, selfPost };
  // Rows can carry a display status (Auto) over the stored one, so every check
  // and every write goes through the stored entry.
  const storedOf = (r) => entries.find((j) => j.je_number === r.je_number) || r;
  const openEntry = (n) => navigate(`/journal-entry/${encodeURIComponent(n)}`);

  // Where an entry came from, for its Source row and "Open source".
  function sourceOf(je) {
    const id = je.reference_id;
    if (je.status === "scheduled" && je.schedule) {
      if (je.schedule.kind === "reversal") return { label: `Entry ${je.schedule.reverses}`, open: () => openEntry(je.schedule.reverses) };
      return { label: "Fixed asset register", open: () => navigate("/assets") };
    }
    if (["bill", "ap_bill", "bill_payment"].includes(je.reference_type) && id) return { label: `Bill ${id}`, open: () => navigate(`/bills/${id}`) };
    if (je.reference_type === "payment" && id) {
      return /^BILL/.test(id)
        ? { label: `Payment on bill ${id}`, open: () => navigate(`/bills/${id}`) }
        : { label: `Payment on ${id}`, open: () => navigate("/payments") };
    }
    if (["invoice", "invoice_payment"].includes(je.reference_type)) return { label: `Invoice ${id || ""}`.trim(), open: () => navigate("/invoices") };
    if (je.reference_type === "bank_reconciliation") return { label: "Bank reconciliation", open: () => navigate("/bank-reconciliation") };
    if (je.reference_type === "inventory_movement") return { label: "Stock movement", open: () => navigate("/inventory") };
    if (je.reference_type === "schedule") return { label: "Fixed asset register", open: () => navigate("/assets") };
    if (je.reversal_of) return { label: `Reverses ${je.reversal_of}`, open: () => openEntry(je.reversal_of) };
    return null;
  }

  function actionsFor(row) {
    if (row.status === "scheduled") {
      const src = sourceOf(row);
      return [
        // A due one posts itself; only a future one can be posted early.
        ...(canApprove && !row.schedule?.due ? [{ key: "post_scheduled", label: "Post early", icon: "check", primary: true, check: { ok: true } }] : []),
        ...(src ? [{ key: "open_source", label: `Open ${src.label.replace(/^Fixed/, "fixed").replace(/^Entry/, "entry")}`, icon: "link", check: { ok: true } }] : []),
      ];
    }
    const je = storedOf(row);
    const sys = isSystemEntry(je);
    const out = [];
    if (je.status === "draft" && !sys) {
      out.push({ key: "submit", label: "Submit for approval", icon: "send", primary: true, check: canTransact ? canSubmit(je, ctx) : { ok: false, reason: "Your role cannot prepare journal entries." } });
      out.push({ key: "edit", label: "Edit", icon: "edit", check: canTransact ? canEdit(je) : { ok: false, reason: "Your role cannot prepare journal entries." } });
    }
    if (je.status === "pending") {
      out.push({ key: "approve", label: "Approve & post", icon: "check", primary: true, check: canApproveEntry(je, ctx) });
      out.push({ key: "return", label: "Send back", icon: "back", check: canReturn(je, ctx) });
    }
    if (je.status === "posted" && reversibleHere(je)) out.push({ key: "reverse", label: "Reverse", icon: "reverse", check: canReverse(je, { canReverse: hasCapability("gl.je.reverse") }) });
    const src = sourceOf(je);
    if (src) out.push({ key: "open_source", label: "Open source", icon: "link", check: { ok: true } });
    if ((je.status === "draft" || je.status === "pending") && !sys) out.push({ key: "void", label: "Void", icon: "void", danger: true, check: canVoid(je) });
    return out;
  }

  const submitQuiet = (je) => {
    const check = canSubmit(je, ctx);
    if (check.ok) updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "pending" }, "submitted", actor));
    return check;
  };
  const approveQuiet = (je) => {
    const check = canApproveEntry(je, ctx);
    if (check.ok) updateJournalEntry(je.je_number, (cur) => approvedEntry(cur, { by: actor, today: todayIso, self: check.self }));
    return check;
  };

  // Posting a future scheduled entry early, by hand. One whose date has come
  // posts itself (state/ScheduledAutoPost.jsx); both write the same entry
  // (lib/scheduledJournals.js postedFromSchedule).
  function postScheduled(je) {
    const jeNumber = peekNextJeNumber();
    addJournalEntry(postedFromSchedule(je, { jeNumber, by: actor, today: todayIso }));
    if (je.reversal_of) {
      updateJournalEntry(je.reversal_of, (cur) => withEvent({ ...cur, reversed_by: jeNumber }, "reversed", actor, `By ${jeNumber}`));
    }
    onPostedScheduled?.(jeNumber, je);
    showToast(`${je.memo} posted as ${jeNumber}`);
  }

  // `view` is the caller's (the list opens the detail page; the detail page
  // is already there).
  function runAction(action, row) {
    if (action === "post_scheduled") { postScheduled(row); return; }
    if (action === "open_source") { sourceOf(row.status === "scheduled" ? row : storedOf(row))?.open(); return; }
    const je = storedOf(row);
    if (action === "submit") { const c = submitQuiet(je); showToast(c.ok ? `${je.je_number} submitted for approval` : c.reason); }
    else if (action === "approve") { const c = approveQuiet(je); showToast(c.ok ? `${je.je_number} approved and posted` : c.reason); }
    else if (action === "edit") {
      const check = canEdit(je);
      if (!check.ok) { showToast(check.reason); return; }
      navigate(`/journal-entry/${encodeURIComponent(je.je_number)}/edit`, { state: { fromTab } });
    }
    else if (action === "return") setDialog({ kind: "return", je });
    else if (action === "reverse") setDialog({ kind: "reverse", je });
    else if (action === "void") {
      const check = canVoid(je);
      if (!check.ok) { showToast(check.reason); return; }
      updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "void" }, "voided", actor));
      showToast(`${je.je_number} voided`);
    }
  }

  // Bulk runs each selected entry through the same checks as one at a time,
  // and says how many it skipped and why rather than failing silently.
  function bulk(action, jeNumbers) {
    const picked = jeNumbers.map((n) => entries.find((j) => j.je_number === n)).filter(Boolean);
    const run = action === "submit" ? submitQuiet : approveQuiet;
    let done = 0;
    const skipped = [];
    for (const je of picked) { const r = run(je); if (r.ok) done += 1; else skipped.push(r.reason); }
    const verb = action === "submit" ? "submitted" : "approved and posted";
    const why = skipped.length ? ` · ${skipped.length} skipped (${[...new Set(skipped)][0]})` : "";
    showToast(`${done} ${verb}${why}`);
  }

  function confirmReturn(je, reason) {
    updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "draft" }, "sent back", actor, reason));
    setDialog(null);
    showToast(`${je.je_number} sent back to ${je.created_by}`);
  }

  function confirmReverse(je, date) {
    const check = canReverse(je, { canReverse: hasCapability("gl.je.reverse") });
    if (!check.ok) { showToast(check.reason); return; }
    const jeNumber = peekNextJeNumber();
    addJournalEntry(buildReversal(je, { jeNumber, date, by: actor, today: todayIso }));
    updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, reversed_by: jeNumber }, "reversed", actor, `By ${jeNumber}`));
    setDialog(null);
    showToast(`${je.je_number} reversed by ${jeNumber}`);
  }

  const dialogs = (
    <>
      {dialog?.kind === "return" && (
        <ReturnDialog je={dialog.je} onClose={() => setDialog(null)} onConfirm={(reason) => confirmReturn(dialog.je, reason)} />
      )}
      {dialog?.kind === "reverse" && (
        <ReverseDialog je={dialog.je} closedThrough={closedThrough} onClose={() => setDialog(null)} onConfirm={(date) => confirmReverse(dialog.je, date)} />
      )}
    </>
  );

  return { actionsFor, runAction, bulk, sourceOf, storedOf, openEntry, dialogs, canApprove, canTransact, actor };
}
