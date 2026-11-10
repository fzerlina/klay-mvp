import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getActiveAccounts } from "../data/seed/coa";
import { DIM_BY_KEY, paletteFor } from "../data/seed/dimensions";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useVendors } from "../state/VendorsContext";
import { TODAY } from "../lib/clock";
import {
  canEdit, canSubmit, canApprove, selfPostCheck, approvedEntry, manualPostBlock, withEvent, isoOf, periodOf,
  canReverse, reversalDateCheck, defaultReversalDateFor, reversalLines, reversalMemo, buildReversal,
} from "../lib/journalLifecycle";
import { formatDate } from "../lib/format";
import {
  blankLine, templateLines, seedLines, applicableDims, dimValues, validateForm, buildEntry, balancingAmount,
} from "../lib/journalForm";
import AccountCombobox from "../components/AccountCombobox";
import JournalTemplateMenu from "../components/JournalTemplateMenu";
import RecurrenceFields from "../components/RecurrenceFields";
import PayeeCombobox from "../components/PayeeCombobox";
import { defaultRecurrence } from "../lib/recurringJournals";
import "./modules.css";
import "./invoices-ledger.css";
import "./journal-entry-form.css";

// New / edit manual journal — a full page (decided 25 Oct 2026), replacing
// the Draft Journal Entry modal. Core Ledger & JE PRD §3:
//   • Header: posting date (today), memo (required — the business reason),
//     reference, reversal date for accruals, attachments.
//   • Lines: account picker with the chart's groups, one side per line,
//     description, the dimensions the account requires, and an optional payee
//     — set per line only, never on the header (27 Oct 2026). A credit to a
//     payable (reconcilable) account with a payee goes to Payment once posted.
//   • A sticky balance bar: Submit stays disabled until debits equal credits.
//   • Actions by role: anyone who prepares journals saves a draft or submits it
//     for approval; an approver also gets Post when Self-posting allows it
//     (Settings → General Settings → Preferences).
// Every check is the shared one (lib/journalForm.js, lib/journalLifecycle.js),
// so the list page's Submit and Approve say the same thing.
//
// mode "reverse" (/journal-entry/:jeNumber/reverse, from a posted entry's
// Reverse — 2 Nov 2026) is the same page as a preview of the reversal: the
// lines mirror the original with every side swapped and can't be changed; the
// posting date, memo, reference and attachments can. Post reversal posts it at
// once — reversing a posted entry is a posting act.

const ACCOUNTS = getActiveAccounts().slice().sort((a, b) => a.code.localeCompare(b.code));
const fmtRp = (n) => (n || 0).toLocaleString("id-ID", { maximumFractionDigits: 0 });
const TODAY_ISO = isoOf(TODAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodLabel = (iso) => (iso ? `${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}` : "—");

export default function JournalEntryFormPage({ mode = "edit" }) {
  const { jeNumber: routeNumber } = useParams();
  const reversing = mode === "reverse";
  const editNumber = reversing ? undefined : routeNumber;
  const { state: navState } = useLocation();
  const navigate = useNavigate();
  const { entries, addJournalEntry, updateJournalEntry, peekNextJeNumber, pendingDraft, clearPendingDraft } = useJournalEntries();
  const { user, hasLevel, hasCapability } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { reconcilableAccounts, journalTemplates, selfPost } = useAccountingSettings();
  const { vendors } = useVendors();

  const editing = editNumber ? entries.find((e) => e.je_number === editNumber) : null;
  const editCheck = editing ? canEdit(editing) : null;
  // The posted entry being reversed, in reverse mode.
  const original = reversing ? entries.find((e) => e.je_number === routeNumber) : null;
  const reverseCheck = original ? canReverse(original, { canReverse: hasCapability("gl.je.reverse") }) : null;
  const actor = user?.name || "You";
  const canPostGl = hasLevel("gl", "approve+post");
  const backTo = reversing
    ? `/journal-entry/${encodeURIComponent(routeNumber)}`
    : `/journal-entry${navState?.fromTab ? `?tab=${navState.fromTab}` : ""}`;

  // A draft staged by another page (a stock adjustment) opens here pre-filled.
  const [staged] = useState(() => (!routeNumber ? pendingDraft : null));
  useEffect(() => { if (staged) clearPendingDraft(); }, [staged, clearPendingDraft]);

  // A new journal can start from a journal template: picked on the list's
  // New Manual Journal split button, or later from the chip in the header.
  const canPickTemplate = !editing && !reversing && !staged?.lines?.length && journalTemplates.length > 0;
  const [templateId, setTemplateId] = useState(() => (
    canPickTemplate && journalTemplates.some((t) => t.id === navState?.templateId) ? navState.templateId : ""
  ));
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const startTemplate = journalTemplates.find((t) => t.id === templateId) || null;

  const [jeNumber] = useState(() => editing?.je_number || peekNextJeNumber());
  const [jeDate, setJeDate] = useState(editing?.je_date || (original ? defaultReversalDateFor(original, closedThrough) : TODAY_ISO));
  const [memo, setMemo] = useState(editing?.memo || (original && reversalMemo(original)) || staged?.memo || navState?.memo || startTemplate?.name || "");
  const [reference, setReference] = useState(editing?.reference || "");
  // An older draft may carry its payee on the header; it moves onto the lines
  // that would have read it, the payable ones.
  const [lines, setLines] = useState(() => (startTemplate ? templateLines(startTemplate) : seedLines(
    original ? reversalLines(original)
    : editing?.payee
      ? editing.lines.map((l) => (l.payee || !reconcilableAccounts.includes(l.account_code) ? l : { ...l, payee: editing.payee }))
      : editing?.lines || staged?.lines,
  )));
  // Repeat (lib/recurringJournals.js). A copy a schedule made can't itself
  // repeat.
  const canRepeatHere = !reversing && !editing?.recurring_of;
  const [repeatOn, setRepeatOn] = useState(!!editing?.recurrence);
  const [repeat, setRepeat] = useState(() => editing?.recurrence || defaultRecurrence(editing?.je_date || TODAY_ISO));
  const [attachments, setAttachments] = useState(() => editing?.attachments || []);
  // Adjusting entry (jurnal penyesuaian). A reversal inherits it from the original.
  const [isAdjusting, setIsAdjusting] = useState(() => !!(editing?.is_adjusting || staged?.is_adjusting));
  const [showErrors, setShowErrors] = useState(false);
  const [dirty, setDirty] = useState(false);
  const touch = (fn) => (...args) => { setDirty(true); fn(...args); };

  // Reconcilable accounts need a payee; payees come from the vendor master.
  const isReconcilable = (code) => !!code && reconcilableAccounts.includes(code);
  const payeeOf = (key) => {
    const [kind, id] = String(key || "").split(":");
    const rec = kind === "vendor" ? vendors.find((v) => v.id === id) : null;
    return rec ? { kind, id, name: rec.name } : null;
  };
  const payeeVendors = useMemo(
    () => vendors.filter((v) => v.status !== "inactive").slice().sort((a, b) => a.name.localeCompare(b.name)),
    [vendors],
  );

  // Accounts this person used most recently on manual journals, for the
  // picker's Recent section.
  const recent = useMemo(() => {
    const seen = [];
    const mine = entries
      .filter((e) => (e.reference_type || "manual") === "manual" && e.created_by === actor)
      .sort((a, b) => String(b.created_date || b.je_date).localeCompare(String(a.created_date || a.je_date)));
    for (const e of mine) for (const l of e.lines || []) {
      if (!seen.includes(l.account_code) && !manualPostBlock(l.account_code)) seen.push(l.account_code);
      if (seen.length >= 6) return seen;
    }
    return seen;
  }, [entries, actor]);

  const recurrence = repeatOn && canRepeatHere ? {
    ...repeat,
    every: parseInt(repeat.every, 10) || 0,
    end: { ...repeat.end, count: parseInt(repeat.end.count, 10) || 0 },
    status: editing?.recurrence?.status || "active",
    set_by: editing?.recurrence?.set_by || actor,
    set_date: editing?.recurrence?.set_date || TODAY_ISO,
  } : null;
  const v = validateForm({ lines, memo, jeDate, closedThrough, recurrence });
  const { totals } = v;

  const draft = () => buildEntry({
    editing, jeNumber, jeDate, memo, reference, recurrence, attachments, lines,
    createdBy: actor, today: TODAY_ISO, payeeOf, isAdjusting,
  });

  // Post is offered to approvers only; it works when Self-posting allows it.
  const selfCheck = canPostGl ? selfPostCheck(draft(), selfPost) : null;
  const postBlock = !canPostGl ? null : !selfCheck.ok ? selfCheck.reason : v.submitBlocks[0] || null;

  // ── Line edits ─────────────────────────────────────────────────────────
  const patchLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  // Auto-balance: a line that gets its account with no amount yet, and a new
  // line, take whatever balances the entry, on the side that's short (debit
  // 20.000 and a 10.000 credit → the next line credits 10.000). It's only a
  // starting value: `auto` marks it until someone types over or clears it.
  const withBalance = (all, l) => {
    if (l.debit || l.credit) return l;
    const fill = balancingAmount(all, l);
    return fill ? { ...l, [fill.field]: fill.value, auto: true } : l;
  };
  const onAccountChange = touch((id, code) => setLines((prev) => prev.map((l) => {
    if (l.id !== id) return l;
    const keys = code ? applicableDims(code) : [];
    const dims = {};
    for (const k of keys) if (l.dims[k]) dims[k] = l.dims[k];
    const next = { ...l, account_code: code, dims };
    return code && !l.account_code ? withBalance(prev, next) : next;
  })));
  const onAmountChange = touch((id, field, raw) => {
    const val = raw.replace(/[^\d]/g, "");
    const other = field === "debit" ? "credit" : "debit";
    patchLine(id, { [field]: val, ...(val ? { [other]: "" } : {}), auto: false });
  });
  const setDim = touch((id, key, value) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, dims: { ...l.dims, [key]: value } } : l))));
  const addLine = touch(() => setLines((prev) => [...prev, withBalance(prev, blankLine())]));
  const removeLine = touch((id) => setLines((prev) => (prev.length <= 2 ? prev.map((l) => (l.id === id ? blankLine() : l)) : prev.filter((l) => l.id !== id))));

  // `id` "" is a blank journal. Anything other than what's already there
  // replaces the lines (asking first if amounts are in).
  function applyTemplate(id) {
    setTemplateMenuOpen(false);
    const t = journalTemplates.find((x) => x.id === id) || null;
    const current = startTemplate;
    if (id === templateId) return;
    const typed = lines.some((l) => l.debit || l.credit);
    const ask = t ? `Replace the lines with “${t.name}”?` : "Start over with blank lines?";
    if (typed && !window.confirm(`${ask} Amounts you entered will be cleared.`)) return;
    setTemplateId(id);
    setLines(t ? templateLines(t) : [blankLine(), blankLine()]);
    // The memo follows the template until someone writes their own.
    if (!memo.trim() || memo === current?.name) setMemo(t ? t.name : "");
    setDirty(true);
  }

  const addFiles = touch((files) => setAttachments((prev) => [
    ...prev,
    ...[...files].map((f) => ({ name: f.name, size: f.size, type: f.type, url: URL.createObjectURL(f) })),
  ]));

  function onDateChange(next) {
    setDirty(true);
    // The repeat's first date (and day of the month) follows the entry date
    // until someone sets it by hand.
    const was = defaultRecurrence(jeDate, repeat);
    if (next && repeat.start === was.start && repeat.day === was.day) {
      const now = defaultRecurrence(next, repeat);
      setRepeat((r) => ({ ...r, start: now.start, day: now.day }));
    }
    setJeDate(next);
  }

  function leave() {
    if (dirty && !window.confirm("Leave without saving? Your changes will be lost.")) return;
    navigate(backTo);
  }

  // ── Save / submit / post ───────────────────────────────────────────────
  // Each action saves the draft first, then applies the same lifecycle move
  // the list page uses, and lands on the entry's own page.
  function done(je, toast) {
    navigate(`/journal-entry/${encodeURIComponent(je.je_number)}`, { state: { toast, fromTab: navState?.fromTab } });
  }

  function save(mode) {
    const needs = mode === "draft" ? v.canSave : v.canSubmit;
    if (!needs || (mode === "post" && postBlock)) { setShowErrors(true); return; }
    let je = withEvent(draft(), editing ? "edited" : "created", actor);
    if (mode === "submit" || mode === "post") {
      const check = canSubmit(je, { closedThrough });
      if (!check.ok) { setShowErrors(true); return; }
      je = withEvent({ ...je, status: "pending" }, "submitted", actor);
    }
    if (mode === "post") {
      const check = canApprove(je, { user: actor, closedThrough, canPost: canPostGl, selfPost });
      if (!check.ok) { setShowErrors(true); return; }
      je = approvedEntry(je, { by: actor, today: TODAY_ISO, self: check.self });
    }
    if (editing) updateJournalEntry(editing.je_number, () => je);
    else addJournalEntry(je);
    const verb = mode === "post" ? "posted" : mode === "submit" ? "submitted for approval" : editing ? "updated" : "saved as draft";
    done(je, `${je.je_number} ${verb}`);
  }

  // Reverse mode: the first thing stopping the post, or null.
  const revDateCheck = original ? reversalDateCheck(original, jeDate, { closedThrough }) : null;
  const revBlock = !original ? null
    : !revDateCheck.ok ? revDateCheck.reason
    : !memo.trim() ? "Add a memo — the business reason for the reversal."
    : null;

  function postReversal() {
    const check = canReverse(original, { canReverse: hasCapability("gl.je.reverse") });
    if (!check.ok || revBlock) { setShowErrors(true); return; }
    addJournalEntry(buildReversal(original, {
      jeNumber, date: jeDate, by: actor, today: TODAY_ISO, memo: memo.trim(), reference: reference.trim() || null, attachments,
    }));
    updateJournalEntry(original.je_number, (cur) => withEvent({ ...cur, reversed_by: jeNumber }, "reversed", actor, `By ${jeNumber}`));
    done({ je_number: jeNumber }, `${original.je_number} reversed by ${jeNumber}`);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if ((editNumber && (!editing || !editCheck.ok)) || (reversing && (!original || !reverseCheck.ok))) {
    const found = reversing ? original : editing;
    return (
      <div className="lg-page">
        <div className="lg-scroll-container jef">
          <button type="button" className="jef-back" onClick={() => navigate(backTo)}>← {reversing && found ? found.je_number : "Journal Entries"}</button>
          <div className="jef-blocked">
            <div className="jef-blocked-title">{found ? `${routeNumber} can't be ${reversing ? "reversed" : "edited"}` : `${routeNumber} not found`}</div>
            <p>{found ? (reversing ? reverseCheck : editCheck).reason : "There is no journal entry with this number."}</p>
          </div>
        </div>
      </div>
    );
  }

  const periodClosed = closedThrough && periodOf(jeDate) <= closedThrough;
  const memoMissing = showErrors && !memo.trim();
  const balanceLabel = totals.debit === 0 && totals.credit === 0
    ? "Enter amounts"
    : totals.balanced ? "Balanced" : `Out by Rp ${fmtRp(Math.abs(totals.diff))}`;

  // Reverse mode: the original's lines, sides swapped, shown as locked cells
  // in the same grid as the editable form.
  const reversalRows = original && reversalLines(original).map((line, i) => {
    const l = { ...line, account_name: line.account_name || ACCOUNTS.find((a) => a.code === line.account_code)?.name || "" };
    const dims = Object.entries(l.dimensions || {}).filter(([k, val]) => val && DIM_BY_KEY[k]);
    return (
      <div key={i} className="jef-line">
        <div className="jef-row jef-row-ro" role="row">
          <span className="jef-idx">{i + 1}</span>
          <span className="jef-ro" title={l.account_name}><span className="jef-mono">{l.account_code}</span> {l.account_name}</span>
          <span className="jef-ro jef-ro-desc" title={l.description}>{l.description}</span>
          <span className="jef-ro jef-amt">{l.debit ? fmtRp(l.debit) : ""}</span>
          <span className="jef-ro jef-amt">{l.credit ? fmtRp(l.credit) : ""}</span>
          <span />
        </div>
        {(dims.length > 0 || l.payee) && (
          <div className="jef-sub-row">
            {dims.length > 0 && (
              <div className="jef-dims">
                <span className="jef-sub-lbl">Dimensions</span>
                {dims.map(([k, val]) => {
                  const pal = paletteFor(DIM_BY_KEY[k].cls);
                  return (
                    <span key={k} className="jef-dim set jef-dim-ro" style={{ background: pal.bg, color: pal.fg, borderColor: pal.bg }}>
                      <span className="jef-dim-dot" style={{ background: pal.dot }} />
                      {DIM_BY_KEY[k].label}: {val}
                    </span>
                  );
                })}
              </div>
            )}
            {l.payee && <div className="jef-payee"><span className="jef-sub-lbl">Payee</span><span className="jef-ro-payee">{l.payee.name}</span></div>}
          </div>
        )}
      </div>
    );
  });

  return (
    <div className="lg-page jef-page">
      <div className="lg-scroll-container jef">
        <div className="jef-head">
          <button type="button" className="jef-back" onClick={leave}>← {original ? original.je_number : "Journal Entries"}</button>
          <div className="jef-head-main">
            <div>
              <h1 className="jef-title">{original ? `Reverse ${original.je_number}` : editing ? `Edit ${editing.je_number}` : "New manual journal"}</h1>
              <div className="jef-sub">
                <span className="jef-mono">{jeNumber}</span>
                <span className="badge badge-draft">{original ? "Preview" : "Draft"}</span>
                <span>{original ? "Reversing journal" : "Manual journal"}</span>
                {canPickTemplate && (
                  <span className="jef-tpl-wrap">
                    <button
                      type="button"
                      className={`jef-tpl${startTemplate ? " set" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={templateMenuOpen}
                      onClick={() => setTemplateMenuOpen((o) => !o)}
                    >
                      <svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" /><path d="M1.5 4.5h9M4.5 4.5v6" /></svg>
                      {startTemplate ? startTemplate.name : "Use a template"}
                      <svg className="jef-tpl-caret" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" /></svg>
                    </button>
                    {templateMenuOpen && (
                      <JournalTemplateMenu
                        templates={journalTemplates}
                        current={templateId}
                        showBlank={!!startTemplate}
                        align="left"
                        onPick={applyTemplate}
                        onClose={() => setTemplateMenuOpen(false)}
                      />
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="jef-head-totals">
              <div><span>Debit</span><strong>Rp {fmtRp(totals.debit)}</strong></div>
              <div><span>Credit</span><strong>Rp {fmtRp(totals.credit)}</strong></div>
            </div>
          </div>
        </div>

        {original && (
          <div className="jef-rev-note">
            <strong>Nothing is posted yet.</strong> This preview reverses {original.je_number} ({original.memo}): every debit and
            credit swapped, on the same accounts, dimensions and payees — the lines can't be changed. {original.je_number} stays in
            the ledger, marked Reversed. Check the posting date, then Post reversal.
          </div>
        )}

        {/* ── Details ─────────────────────────────────────────────────── */}
        <section className="jef-card">
          <div className="jef-card-title">Details</div>
          <div className="jef-grid">
            <label className="jef-field">
              <span className="jef-lbl">Posting date</span>
              <input
                type="date"
                className={`jef-input${original && !revDateCheck.ok ? " invalid" : ""}`}
                value={jeDate}
                min={original?.je_date}
                onChange={(e) => onDateChange(e.target.value)}
              />
              <span className="jef-field-hint">
                {original && !revDateCheck.ok
                  ? revDateCheck.reason
                  : original
                    ? `Sets the period (${periodLabel(jeDate)}). ${original.je_number} posted on ${formatDate(original.je_date)}.`
                    : `The day it hits the ledger — sets the period (${periodLabel(jeDate)}).`}
              </span>
            </label>
            <label className="jef-field jef-field-wide">
              <span className="jef-lbl">Memo <em>required</em></span>
              <input
                className={`jef-input${memoMissing ? " invalid" : ""}`}
                placeholder="The business reason — e.g. Accrue October electricity (PLN)"
                value={memo}
                onChange={(e) => { setDirty(true); setMemo(e.target.value); }}
              />
            </label>
            <label className="jef-field">
              <span className="jef-lbl">Reference</span>
              <input className="jef-input" placeholder="Document no. (optional)" value={reference} onChange={(e) => { setDirty(true); setReference(e.target.value); }} />
            </label>
          </div>
          {periodClosed && !original && (
            <div className="jef-warn">
              {periodLabel(jeDate)} is closed. You can save a draft here, but it can only be submitted or posted once its posting date is in an open period.
            </div>
          )}
          {!original && (
            <div className="jef-reversal jef-adjusting">
              <label className="jef-check">
                <input type="checkbox" checked={isAdjusting} onChange={(e) => { setDirty(true); setIsAdjusting(e.target.checked); }} />
                <span>
                  <strong>Adjusting entry</strong>
                  <span className="jef-hint">
                    A period-end or audit adjustment (jurnal penyesuaian) — an accrual, a provision, or a correction the auditor proposed.
                    The Trial Balance can show these apart from regular postings, as an unadjusted and an adjusted balance.
                  </span>
                </span>
              </label>
            </div>
          )}
          {canRepeatHere && (
            <div className="jef-reversal jef-repeat">
              <label className="jef-check">
                <input type="checkbox" checked={repeatOn} onChange={(e) => { setDirty(true); setRepeatOn(e.target.checked); }} />
                <span>
                  <strong>Repeat this entry</strong>
                  <span className="jef-hint">
                    Approved once with this entry: after it posts, each copy posts itself on its date — no further approval. Pause or end it from the entry any time.
                  </span>
                </span>
              </label>
              {repeatOn && (
                <div className="jef-repeat-fields">
                  <RecurrenceFields value={repeat} jeDate={jeDate} onChange={(r) => { setDirty(true); setRepeat(r); }} />
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Lines ───────────────────────────────────────────────────── */}
        <section className="jef-card jef-card-lines">
          <div className="jef-card-head">
            <div className="jef-card-title">Lines</div>
            <span className="jef-hint">
              {original
                ? `${original.je_number}'s lines with debits and credits swapped — locked, so the reversal nets it off exactly.`
                : "Pick an account — the dimensions it requires appear under the line."}
            </span>
          </div>

          <div className="jef-lines" role="table" aria-label="Journal lines">
            <div className="jef-row jef-row-head" role="row">
              <span>#</span><span>Account</span><span>Description</span><span className="num">Debit</span><span className="num">Credit</span><span />
            </div>
            {original ? reversalRows : lines.map((l, i) => {
              const keys = applicableDims(l.account_code);
              // A line says what it still needs once it has an amount.
              const errs = showErrors || l.debit || l.credit ? v.lineErrors[l.id] : null;
              const block = v.lineBlocks[l.id];
              // A credit to a payable account is what reaches Payment.
              const toPayment = isReconcilable(l.account_code) && !!l.credit && !!payeeOf(l.payee);
              return (
                <div key={l.id} className={`jef-line${errs || (showErrors && block) ? " has-err" : ""}`}>
                  <div className="jef-row" role="row">
                    <span className="jef-idx">{i + 1}</span>
                    <AccountCombobox
                      value={l.account_code}
                      onChange={(code) => onAccountChange(l.id, code)}
                      accounts={ACCOUNTS}
                      recent={recent}
                      blockOf={manualPostBlock}
                      hint={l.side && !l.account_code ? `Select ${l.side} account…` : undefined}
                      invalid={showErrors && !!block}
                    />
                    <input
                      className="jef-input"
                      placeholder={memo.trim() || "Line description (optional)"}
                      value={l.description}
                      onChange={(e) => { setDirty(true); patchLine(l.id, { description: e.target.value }); }}
                    />
                    <input
                      className={`jef-input jef-amt${l.side === "debit" && !l.debit && !l.credit ? " expected" : ""}${l.auto && l.debit ? " auto" : ""}`}
                      inputMode="numeric"
                      placeholder="0"
                      title={l.auto && l.debit ? "Filled to balance the entry — change or clear it" : undefined}
                      aria-label={`Line ${i + 1} debit`}
                      value={l.debit ? Number(l.debit).toLocaleString("id-ID") : ""}
                      onChange={(e) => onAmountChange(l.id, "debit", e.target.value)}
                    />
                    <input
                      className={`jef-input jef-amt${l.side === "credit" && !l.debit && !l.credit ? " expected" : ""}${l.auto && l.credit ? " auto" : ""}`}
                      inputMode="numeric"
                      placeholder="0"
                      title={l.auto && l.credit ? "Filled to balance the entry — change or clear it" : undefined}
                      aria-label={`Line ${i + 1} credit`}
                      value={l.credit ? Number(l.credit).toLocaleString("id-ID") : ""}
                      onChange={(e) => onAmountChange(l.id, "credit", e.target.value)}
                    />
                    <button type="button" className="jef-del" onClick={() => removeLine(l.id)} aria-label={`Remove line ${i + 1}`} title={lines.length <= 2 ? "Clear line" : "Remove line"}>×</button>
                  </div>

                  {l.account_code && (
                    <div className="jef-sub-row">
                      {keys.length > 0 && (
                        <div className="jef-dims">
                          <span className="jef-sub-lbl">Dimensions</span>
                          {keys.map((k) => {
                            const dim = DIM_BY_KEY[k];
                            const pal = paletteFor(dim.cls);
                            const set = !!l.dims[k];
                            return (
                              <span key={k} className={`jef-dim${set ? " set" : ""}`} style={set ? { background: pal.bg, color: pal.fg, borderColor: pal.bg } : undefined}>
                                <span className="jef-dim-dot" style={{ background: pal.dot }} />
                                <select value={l.dims[k] || ""} onChange={(e) => setDim(l.id, k, e.target.value)} style={set ? { color: pal.fg } : undefined} aria-label={dim.label}>
                                  <option value="">{dim.label}…</option>
                                  {dimValues(k).map((val) => <option key={val} value={val}>{val}</option>)}
                                </select>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {/* Optional on every line — the only place a payee is set.
                          Employees are set up as vendors. */}
                      <div className="jef-payee">
                        <span className="jef-sub-lbl">Payee</span>
                        <PayeeCombobox
                          value={l.payee}
                          vendors={payeeVendors}
                          onChange={(key) => { setDirty(true); patchLine(l.id, { payee: key }); }}
                          ariaLabel={`Line ${i + 1} payee`}
                        />
                        {toPayment && <span className="jef-hint">Goes to Payment once posted.</span>}
                      </div>
                    </div>
                  )}

                  {block && l.account_code && (
                    <div className="jef-line-block">{block} Pick another account for this line.</div>
                  )}
                  {errs && <div className="jef-line-err">Needs: {errs.join(", ")}</div>}
                </div>
              );
            })}
          </div>
          {!original && <button type="button" className="jef-add" onClick={addLine}>+ Add line</button>}
        </section>

        {/* ── Attachments ─────────────────────────────────────────────── */}
        <section className="jef-card">
          <div className="jef-card-head">
            <div className="jef-card-title">Attachments</div>
            <span className="jef-hint">The invoice, calculation or approval behind this entry.</span>
          </div>
          {attachments.map((a, i) => (
            <div key={`${a.name}-${i}`} className="jef-attach">
              <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
              <span>{Math.max(1, Math.round((a.size || 0) / 1024))} KB</span>
              <button type="button" className="jef-del" onClick={() => { setDirty(true); setAttachments((p) => p.filter((_, j) => j !== i)); }} aria-label={`Remove ${a.name}`}>×</button>
            </div>
          ))}
          <label className="jef-attach-add">
            + Attach file
            <input type="file" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </section>
        <div style={{ height: 24 }} />
      </div>

      {/* ── Sticky balance bar + actions ──────────────────────────────── */}
      <div className="jef-bar">
        <div className="jef-bar-totals">
          <span>Dr <strong>Rp {fmtRp(totals.debit)}</strong></span>
          <span>Cr <strong>Rp {fmtRp(totals.credit)}</strong></span>
          <span className={`jef-bal ${totals.balanced ? "ok" : totals.debit || totals.credit ? "off" : "idle"}`}>{balanceLabel}</span>
          {/* Why Submit is still disabled — the first thing to fix. */}
          {original
            ? revBlock && <span className="jef-bar-why">{revBlock}</span>
            : (showErrors || totals.debit > 0 || totals.credit > 0) && v.submitBlocks[0] && (
              <span className="jef-bar-why">{v.submitBlocks[0]}</span>
            )}
        </div>
        {original ? (
          <div className="jef-bar-actions">
            <button type="button" className="jef-btn" onClick={leave}>Cancel</button>
            <button type="button" className="jef-btn primary" onClick={postReversal} disabled={!!revBlock} title={revBlock || `Post the reversal, dated ${formatDate(jeDate)}`}>
              Post reversal
            </button>
          </div>
        ) : (
        <div className="jef-bar-actions">
          <button type="button" className="jef-btn" onClick={leave}>Cancel</button>
          <button type="button" className="jef-btn" onClick={() => save("draft")} disabled={!v.canSave} title={v.draftBlocks[0] || "Save without sending for approval"}>
            Save draft
          </button>
          <button
            type="button"
            className={`jef-btn${canPostGl ? "" : " primary"}`}
            onClick={() => save("submit")}
            disabled={!v.canSubmit}
            title={v.submitBlocks[0] || "Save and send for approval"}
          >
            Submit for approval
          </button>
          {canPostGl && (
            <button type="button" className="jef-btn primary" onClick={() => save("post")} disabled={!!postBlock} title={postBlock || "Post now — self-posted, recorded in the audit trail"}>
              Post
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
