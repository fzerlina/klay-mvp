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
} from "../lib/journalLifecycle";
import {
  blankLine, templateLines, seedLines, applicableDims, dimValues, validateForm, buildEntry, defaultReversalDate,
} from "../lib/journalForm";
import AccountCombobox from "../components/AccountCombobox";
import JournalTemplateMenu from "../components/JournalTemplateMenu";
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
//     (Settings → General Ledger → Preferences).
// Every check is the shared one (lib/journalForm.js, lib/journalLifecycle.js),
// so the list page's Submit and Approve say the same thing.

const ACCOUNTS = getActiveAccounts().slice().sort((a, b) => a.code.localeCompare(b.code));
const fmtRp = (n) => (n || 0).toLocaleString("id-ID", { maximumFractionDigits: 0 });
const TODAY_ISO = isoOf(TODAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodLabel = (iso) => (iso ? `${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}` : "—");

export default function JournalEntryFormPage() {
  const { jeNumber: editNumber } = useParams();
  const { state: navState } = useLocation();
  const navigate = useNavigate();
  const { entries, addJournalEntry, updateJournalEntry, peekNextJeNumber, pendingDraft, clearPendingDraft } = useJournalEntries();
  const { user, hasLevel } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { reconcilableAccounts, journalTemplates, selfPost } = useAccountingSettings();
  const { vendors } = useVendors();

  const editing = editNumber ? entries.find((e) => e.je_number === editNumber) : null;
  const editCheck = editing ? canEdit(editing) : null;
  const actor = user?.name || "You";
  const canPostGl = hasLevel("gl", "approve+post");
  const backTo = `/journal-entry${navState?.fromTab ? `?tab=${navState.fromTab}` : ""}`;

  // A draft staged by another page (a stock adjustment) opens here pre-filled.
  const [staged] = useState(() => (!editNumber ? pendingDraft : null));
  useEffect(() => { if (staged) clearPendingDraft(); }, [staged, clearPendingDraft]);

  // A new journal can start from a journal template: picked on the list's
  // New Manual Journal split button, or later from the chip in the header.
  const canPickTemplate = !editing && !staged?.lines?.length && journalTemplates.length > 0;
  const [templateId, setTemplateId] = useState(() => (
    canPickTemplate && journalTemplates.some((t) => t.id === navState?.templateId) ? navState.templateId : ""
  ));
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const startTemplate = journalTemplates.find((t) => t.id === templateId) || null;

  const [jeNumber] = useState(() => editing?.je_number || peekNextJeNumber());
  const [jeDate, setJeDate] = useState(editing?.je_date || TODAY_ISO);
  const [memo, setMemo] = useState(editing?.memo || staged?.memo || navState?.memo || startTemplate?.name || "");
  const [reference, setReference] = useState(editing?.reference || "");
  // An older draft may carry its payee on the header; it moves onto the lines
  // that would have read it, the payable ones.
  const [lines, setLines] = useState(() => (startTemplate ? templateLines(startTemplate) : seedLines(
    editing?.payee
      ? editing.lines.map((l) => (l.payee || !reconcilableAccounts.includes(l.account_code) ? l : { ...l, payee: editing.payee }))
      : editing?.lines || staged?.lines,
  )));
  const [reversalOn, setReversalOn] = useState(!!editing?.auto_reverse);
  const [reversalDate, setReversalDate] = useState(editing?.reversal_date || defaultReversalDate(editing?.je_date || TODAY_ISO));
  const [attachments, setAttachments] = useState(() => editing?.attachments || []);
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

  const reversal = { on: reversalOn, date: reversalDate };
  const v = validateForm({ lines, memo, jeDate, closedThrough, reversal });
  const { totals } = v;

  const draft = () => buildEntry({
    editing, jeNumber, jeDate, memo, reference, reversal, attachments, lines,
    createdBy: actor, today: TODAY_ISO, payeeOf,
  });

  // Post is offered to approvers only; it works when Self-posting allows it.
  const selfCheck = canPostGl ? selfPostCheck(draft(), selfPost) : null;
  const postBlock = !canPostGl ? null : !selfCheck.ok ? selfCheck.reason : v.submitBlocks[0] || null;

  // ── Line edits ─────────────────────────────────────────────────────────
  const patchLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const onAccountChange = touch((id, code) => setLines((prev) => prev.map((l) => {
    if (l.id !== id) return l;
    const keys = code ? applicableDims(code) : [];
    const dims = {};
    for (const k of keys) if (l.dims[k]) dims[k] = l.dims[k];
    return { ...l, account_code: code, dims };
  })));
  const onAmountChange = touch((id, field, raw) => {
    const val = raw.replace(/[^\d]/g, "");
    const other = field === "debit" ? "credit" : "debit";
    patchLine(id, { [field]: val, ...(val ? { [other]: "" } : {}) });
  });
  const setDim = touch((id, key, value) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, dims: { ...l.dims, [key]: value } } : l))));
  const addLine = touch(() => setLines((prev) => [...prev, blankLine()]));
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
    // The reversal date follows the entry date until someone sets it by hand.
    if (reversalDate === defaultReversalDate(jeDate)) setReversalDate(defaultReversalDate(next));
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

  // ── Render ─────────────────────────────────────────────────────────────
  if (editNumber && (!editing || !editCheck.ok)) {
    return (
      <div className="lg-page">
        <div className="lg-scroll-container jef">
          <button type="button" className="jef-back" onClick={() => navigate(backTo)}>← Journal Entries</button>
          <div className="jef-blocked">
            <div className="jef-blocked-title">{editing ? `${editNumber} can't be edited` : `${editNumber} not found`}</div>
            <p>{editing ? editCheck.reason : "There is no journal entry with this number."}</p>
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

  return (
    <div className="lg-page jef-page">
      <div className="lg-scroll-container jef">
        <div className="jef-head">
          <button type="button" className="jef-back" onClick={leave}>← Journal Entries</button>
          <div className="jef-head-main">
            <div>
              <h1 className="jef-title">{editing ? `Edit ${editing.je_number}` : "New manual journal"}</h1>
              <div className="jef-sub">
                <span className="jef-mono">{jeNumber}</span>
                <span className="badge badge-draft">Draft</span>
                <span>Manual journal</span>
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

        {/* ── Details ─────────────────────────────────────────────────── */}
        <section className="jef-card">
          <div className="jef-card-title">Details</div>
          <div className="jef-grid">
            <label className="jef-field">
              <span className="jef-lbl">Posting date</span>
              <input type="date" className="jef-input" value={jeDate} onChange={(e) => onDateChange(e.target.value)} />
              <span className="jef-field-hint">The day it hits the ledger — sets the period ({periodLabel(jeDate)}).</span>
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
          {periodClosed && (
            <div className="jef-warn">
              {periodLabel(jeDate)} is closed. You can save a draft here, but it can only be submitted or posted once its posting date is in an open period.
            </div>
          )}
          <div className="jef-reversal">
            <label className="jef-check">
              <input type="checkbox" checked={reversalOn} onChange={(e) => { setDirty(true); setReversalOn(e.target.checked); }} />
              <span>
                <strong>Reverse this entry automatically</strong>
                <span className="jef-hint">For accruals: once posted, a reversing entry is scheduled on this date (Scheduled tab).</span>
              </span>
            </label>
            {reversalOn && (
              <label className="jef-field jef-field-inline">
                <span className="jef-lbl">Reversal date</span>
                <input type="date" className="jef-input" value={reversalDate} min={jeDate} onChange={(e) => { setDirty(true); setReversalDate(e.target.value); }} />
              </label>
            )}
          </div>
        </section>

        {/* ── Lines ───────────────────────────────────────────────────── */}
        <section className="jef-card jef-card-lines">
          <div className="jef-card-head">
            <div className="jef-card-title">Lines</div>
            <span className="jef-hint">Pick an account — the dimensions it requires appear under the line.</span>
          </div>

          <div className="jef-lines" role="table" aria-label="Journal lines">
            <div className="jef-row jef-row-head" role="row">
              <span>#</span><span>Account</span><span>Description</span><span className="num">Debit</span><span className="num">Credit</span><span />
            </div>
            {lines.map((l, i) => {
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
                      className={`jef-input jef-amt${l.side === "debit" && !l.debit && !l.credit ? " expected" : ""}`}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Line ${i + 1} debit`}
                      value={l.debit ? Number(l.debit).toLocaleString("id-ID") : ""}
                      onChange={(e) => onAmountChange(l.id, "debit", e.target.value)}
                    />
                    <input
                      className={`jef-input jef-amt${l.side === "credit" && !l.debit && !l.credit ? " expected" : ""}`}
                      inputMode="numeric"
                      placeholder="0"
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
                        <select className={`jef-input jef-payee-sel${l.payee ? " set" : ""}`} value={l.payee} onChange={(e) => { setDirty(true); patchLine(l.id, { payee: e.target.value }); }} aria-label={`Line ${i + 1} payee`}>
                          <option value="">None</option>
                          {payeeVendors.map((vd) => <option key={vd.id} value={`vendor:${vd.id}`}>{vd.name}</option>)}
                        </select>
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
          <button type="button" className="jef-add" onClick={addLine}>+ Add line</button>
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
          {(showErrors || totals.debit > 0 || totals.credit > 0) && v.submitBlocks[0] && (
            <span className="jef-bar-why">{v.submitBlocks[0]}</span>
          )}
        </div>
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
      </div>
    </div>
  );
}
