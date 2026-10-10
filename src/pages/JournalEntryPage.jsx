import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useAssets } from "../state/AssetsContext";
import { scheduledEntries } from "../lib/scheduledJournals";
import { nextPeriod } from "../lib/fixedAssets";
import {
  canEdit, canSubmit, canApprove as canApproveEntry, canReturn, canVoid, canReverse,
  isSystemEntry, reversibleHere, withEvent, buildReversal, isoOf,
} from "../lib/journalLifecycle";
import { ReturnDialog, ReverseDialog, RecurringDialog, TemplatesDrawer } from "./JeActionDialogs";
import { TODAY } from "../lib/clock";
import { formatDate } from "../lib/format";
import AiChatDrawer from "./AiChatDrawer";
import SummaryDrawer from "./SummaryDrawer";
import ReconReviewModal, { RECON_TOTAL, RECON_MATCHED, RECON_UNMATCHED } from "../components/ReconReviewModal";
import { computeJournalTasks, makeJournalAiContext } from "./ai-journal-context";
import DraftJournalModal from "./DraftJournalModal";
import { DIM_BY_KEY, paletteFor, dimensionsForAccount, sampleDimensionValue } from "../data/seed/dimensions";
import { COA_BY_CODE } from "../data/seed/coa";
import "./modules.css";
import "./invoices-ledger.css";

function fmtRp(n) {
  if (n == null) return "—";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function lineSums(je) {
  let debit = 0, credit = 0;
  for (const l of je.lines) {
    debit += l.debit || 0;
    credit += l.credit || 0;
  }
  return { debit, credit };
}

const STATUS_LABEL = { posted: "Posted", draft: "Draft", pending: "Pending", void: "Void", auto: "Auto", anomaly: "Anomaly", scheduled: "Scheduled" };
const STATUS_BADGE_CLASS = { posted: "approved", draft: "draft", pending: "review", void: "rejected", auto: "auto", anomaly: "anomaly", scheduled: "scheduled" };

const AUTO_PROCESSED_COUNT = 8;
const ANOMALY_COUNT = 4;

function generateAnomaly(je, idx) {
  const accountName = je.lines[0]?.account_name || "this account";
  const amt = (je.lines[0]?.debit || je.lines[0]?.credit || 0) / 1e6;
  const templates = [
    `Unusual amount: Rp ${amt.toFixed(1)} jt is 3.2× typical for ${accountName} in this period.`,
    `Possible duplicate — same memo + amount as a JE booked 2 days ago.`,
    `PO total doesn't match the bill — Rp ${(amt * 0.86).toFixed(1)} jt vs Rp ${amt.toFixed(1)} jt (14% variance).`,
    `Recurring pattern broken — no prior JE in ${accountName} in the last 90 days.`,
  ];
  return templates[idx % templates.length];
}

function generateAiSummary(je) {
  const memo = (je.memo || "").toLowerCase();
  const n = je.lines.length;
  const conf = 90 + (parseInt(je.je_number.slice(-2), 10) % 9);
  if (memo.includes("payroll")) {
    return `Matched ${n} payroll lines to April register · Dr Salary Expense / Cr Bank · totals tie to Rp ${(je.lines[0]?.debit / 1e6 || 0).toFixed(1)} jt net pay. ${conf}% match to prior month.`;
  }
  if (memo.includes("inventory") || memo.includes("goods")) {
    return `Reconciled GRN to PO + vendor bill · Dr Inventory / Cr AP · quantities and prices match the PO line items. ${conf}% confidence.`;
  }
  if (memo.includes("depreciation")) {
    return `Straight-line depreciation across ${n} asset accounts per schedule · monthly amount unchanged from prior period. ${conf}% match to schedule.`;
  }
  if (memo.includes("interest") || memo.includes("loan")) {
    return `Bank interest charge tied to loan schedule · period and rate match · Dr Interest Expense / Cr Bank.`;
  }
  if (memo.includes("bank") || memo.includes("service charge")) {
    return `Bank service fee from statement · auto-classified to bank charges based on description pattern. ${conf}% match.`;
  }
  if (memo.includes("revenue") || memo.includes("sales") || memo.includes("invoice")) {
    return `Revenue from customer invoice batch · Dr AR / Cr Revenue + Cr PPN Output · taxable line items reconciled to invoice totals.`;
  }
  return `Reconciled ${n} lines against source documents · debits tie to credits · ${conf}% match to historical pattern.`;
}

// ── Klay command bar: intent + filter parsing (mock; replace with LLM later) ──
const JE_REF_RE = /^JE-\d{4}-\d{4}$/i;
const ACTION_VERB_RE = /^(record|create|post|draft|generate|make)\s+/i;
const QUESTION_LEAD_RE = /^(what|why|how|when|where|who|which|whose|explain|show|tell|can|could|should|is|are|do|does|did|will|would|may|might)\b/i;

function detectKlayIntent(q) {
  const trimmed = q.trim();
  if (!trimmed) return null;
  if (JE_REF_RE.test(trimmed)) return "lookup";
  if (trimmed.endsWith("?") || QUESTION_LEAD_RE.test(trimmed)) return "question";
  if (ACTION_VERB_RE.test(trimmed)) return "action";
  return "filter";
}

function parseKlayFilters(q) {
  const out = {};
  const lower = q.toLowerCase();
  if (/\bflagged\b/.test(lower)) out.status = "flagged";
  else if (/\bdrafts?\b/.test(lower)) out.status = "draft";
  else if (/\bpending\b/.test(lower)) out.status = "pending";
  else if (/\bposted\b/.test(lower)) out.status = "posted";
  if (/\binventory\b/.test(lower)) out.category = "inventory";
  else if (/\bpayroll\b/.test(lower)) out.category = "payroll";
  const mShort = lower.match(/(\d+(?:[.,]\d+)?)\s*([mb])\b/);
  if (mShort) {
    const n = parseFloat(mShort[1].replace(",", "."));
    out.amountMin = Math.round(n * (mShort[2] === "b" ? 1e9 : 1e6));
  } else {
    const mLong = lower.match(/(?:above|over|>=?|min(?:imum)?)\s*rp?\s*([\d.,]+)/);
    if (mLong) out.amountMin = parseInt(mLong[1].replace(/[.,]/g, ""), 10);
  }
  if (/\bthis\s+week\b/.test(lower)) out.dateRange = "thisWeek";
  else if (/\bthis\s+month\b/.test(lower)) out.dateRange = "thisMonth";
  if (Object.keys(out).length === 0) out.freeText = q.trim();
  return out;
}

function klayChipLabel(key, val) {
  if (key === "status") return `Status: ${val[0].toUpperCase()}${val.slice(1)}`;
  if (key === "category") return `Category: ${val[0].toUpperCase()}${val.slice(1)}`;
  if (key === "amountMin") return `≥ Rp ${val.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
  if (key === "dateRange") return val === "thisWeek" ? "This week" : "This month";
  if (key === "freeText") return `“${val}”`;
  return String(val);
}

function JeRow({ r, isChecked, onCheck, onClick, onKebab, isSelected, isAlt }) {
  const isAuto = r.status === "auto";
  const isAnomaly = r.status === "anomaly";
  return (
    <div className={`lg-row${isSelected ? " selected" : ""}${isAlt ? " alt" : ""}${isAuto ? " auto" : ""}${isAnomaly ? " anomaly" : ""}`} onClick={onClick}>
      <div onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="lg-row-check" checked={isChecked} onChange={() => onCheck(r.je_number)} />
      </div>
      <div className="lg-cell-date">{formatDate(r.je_date)}</div>
      <div className="lg-cell-no">{r.je_number}</div>
      <div className="je-desc-cell">
        <div className="je-desc-memo">{r.memo}</div>
        {isAuto && r.ai_summary && (
          <div className="je-desc-ai">
            <KlaySparkleIcon />
            <span className="je-desc-ai-text">{r.ai_summary}</span>
          </div>
        )}
        {r.status === "scheduled" && r.schedule && (
          <div className={`je-desc-sched${r.schedule.due ? " due" : ""}`}>
            {r.schedule.due
              ? `Due — was to post on ${formatDate(r.schedule.postsOn)}`
              : `Posts on ${formatDate(r.schedule.postsOn)}`}
            {" · "}{r.schedule.source}
          </div>
        )}
        {isAnomaly && r.anomaly && (
          <div className="je-desc-anomaly">
            <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor" stroke="none"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff" stroke="none"/></svg>
            <span className="je-desc-ai-text">{r.anomaly}</span>
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
        {r.lines.length}
      </div>
      <div className="lg-cell-total">
        {r.debit > 0 ? <><span className="lg-cell-total-rp">Rp</span>{fmtRp(r.debit)}</> : <span className="lg-cell-em-dash">—</span>}
      </div>
      <div className="lg-cell-total">
        {r.credit > 0 ? <><span className="lg-cell-total-rp">Rp</span>{fmtRp(r.credit)}</> : <span className="lg-cell-em-dash">—</span>}
      </div>
      <div>
        <span className={`badge badge-${STATUS_BADGE_CLASS[r.status]}`}>
          {isAuto && <KlaySparkleIcon />}
          {isAnomaly && <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor" stroke="none"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff" stroke="none"/></svg>}
          {STATUS_LABEL[r.status]}
        </span>
      </div>
      <div className="lg-cell-kebab" onClick={(e) => e.stopPropagation()}>
        <button className="lg-kebab" onClick={() => onKebab(r.je_number)}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
        </button>
      </div>
    </div>
  );
}

// The actions an entry offers, built once per entry by the page (actionsFor)
// and shown here and in the drawer footer, so the two never disagree. A
// blocked action stays visible, greyed, with the reason as its tooltip —
// "you prepared this, someone else approves it" is worth seeing.
const ACTION_ICON = {
  check: <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
  send: <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  edit: <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  back: <svg viewBox="0 0 24 24"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>,
  reverse: <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>,
  repeat: <svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  link: <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
  void: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
};

function RowMenu({ je, onClose, onAction, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  const main = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);
  return (
    <div className="row-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="row-menu-item" onClick={() => onAction("view", je)}>
        <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        View detail
      </div>
      {main.map((a) => (
        <div key={a.key} className={`row-menu-item${a.check.ok ? "" : " disabled"}`} title={a.check.ok ? "" : a.check.reason}
          onClick={() => a.check.ok && onAction(a.key, je)}>
          {ACTION_ICON[a.icon]}
          {a.label}
        </div>
      ))}
      {danger.length > 0 && <div className="row-menu-sep" />}
      {danger.map((a) => (
        <div key={a.key} className={`row-menu-item danger${a.check.ok ? "" : " disabled"}`} title={a.check.ok ? "" : a.check.reason}
          onClick={() => a.check.ok && onAction(a.key, je)}>
          {ACTION_ICON[a.icon]}
          {a.label}
        </div>
      ))}
    </div>
  );
}

const SORT_LABELS = {
  "date-desc":   "Newest date ↓",
  "date-asc":    "Date oldest ↑",
  "ref-asc":     "Reference A-Z",
  "ref-desc":    "Reference Z-A",
  "debit-desc":  "Debit highest ↓",
  "debit-asc":   "Debit lowest ↑",
  "lines-desc":  "Most lines ↓",
};
const GROUP_LABELS = {
  "none":   "—",
  "status": "Status",
  "month":  "Month",
};

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

function SortPopover({ value, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        {Object.entries(SORT_LABELS).map(([k, lbl]) => (
          <button key={k} className={`lg-popover-item${value === k ? " selected" : ""}`} onClick={() => onPick(k)}>
            {lbl}
            {value === k && <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupPopover({ value, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const items = [
    { k: "none",   lbl: "Not grouped" },
    { k: "status", lbl: "Status" },
    { k: "month",  lbl: "Month" },
  ];
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        {items.map((it) => (
          <button key={it.k} className={`lg-popover-item${value === it.k ? " selected" : ""}`} onClick={() => onPick(it.k)}>
            {it.lbl}
            {value === it.k && <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterPopover({ values, onChange, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [draft, setDraft] = useState(values);

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleCreator = (c) => setDraft((d) => {
    const next = new Set(d.creators);
    next.has(c) ? next.delete(c) : next.add(c);
    return { ...d, creators: next };
  });
  const reset = () => setDraft({ creators: new Set(), minAmt: "", maxAmt: "", dateFrom: "", dateTo: "" });
  const apply = () => { onChange(draft); onClose(); };

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Dibuat oleh ({draft.creators.size > 0 ? `${draft.creators.size} selected` : "semua"})</div>
          <div className="lg-toggle-row">
            {["Sside Wijaya", "Rina Kusuma", "Budi Santoso", "Andi Prasetyo"].map((c) => (
              <button key={c} className={`lg-toggle${draft.creators.has(c) ? " on" : ""}`} onClick={() => toggleCreator(c)}>{c}</button>
            ))}
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Range Debit (Rp)</div>
          <div className="lg-filter-row2">
            <input type="number" className="lg-filter-input" placeholder="Min" value={draft.minAmt} onChange={(e) => update({ minAmt: e.target.value })} />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>—</span>
            <input type="number" className="lg-filter-input" placeholder="Max" value={draft.maxAmt} onChange={(e) => update({ maxAmt: e.target.value })} />
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Period date</div>
          <div className="lg-filter-row2">
            <input type="date" className="lg-filter-input" value={draft.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>—</span>
            <input type="date" className="lg-filter-input" value={draft.dateTo} onChange={(e) => update({ dateTo: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={reset}>Reset</button>
        <button className="lg-filter-apply" onClick={apply}>Apply filter</button>
      </div>
    </div>
  );
}

function KlaySparkleIcon() {
  return (
    <svg viewBox="0 0 14 14"><path d="M7 1.5l1.3 3.2L11.5 6l-3.2 1L7 10.2 5.7 7 2.5 6l3.2-1.3L7 1.5z"/><path d="M11.5 10l.4 1.1L13 11.5l-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1z"/></svg>
  );
}

function KlayCommandBar({ inputRef, value, onChange, onSubmit, onClear, chips, onRemoveChip, onClearChips }) {
  return (
    <div className="lg-klay-bar">
      <span className="lg-klay-bar-icon" aria-hidden><KlaySparkleIcon /></span>
      <input
        ref={inputRef}
        className="lg-klay-bar-input"
        placeholder="Search, filter, or ask Klay…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          else if (e.key === "Escape") { e.preventDefault(); onClear(); }
        }}
      />
      {chips.map((c) => (
        <span key={c.id} className="lg-klay-chip">
          {c.label}
          <button type="button" className="lg-klay-chip-x" onClick={() => onRemoveChip(c)} aria-label={`Remove ${c.label}`}>
            <svg viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <button type="button" className="lg-klay-chips-clear" onClick={onClearChips}>Clear all</button>
      )}
      <span className="lg-klay-bar-hint" aria-hidden>⌘K</span>
    </div>
  );
}

function ReconStrip({ matched, total, unmatched, onReview, onDismiss }) {
  return (
    <div className="lg-recon-strip">
      <span className="lg-recon-icon"><KlaySparkleIcon /></span>
      <div className="lg-recon-text">
        <strong>Klay reconciled {matched} of {total} bank entries</strong> this morning · {unmatched} unmatched need your review
      </div>
      <button type="button" className="lg-recon-cta" onClick={onReview}>Review {unmatched} →</button>
      <button type="button" className="lg-recon-dismiss" onClick={onDismiss} aria-label="Dismiss">
        <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
      </button>
    </div>
  );
}

function KlayActionModal({ intent, onClose }) {
  if (!intent) return null;
  return (
    <div className="lg-klay-modal-backdrop" onClick={onClose}>
      <div className="lg-klay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lg-klay-modal-head">
          <span className="lg-klay-bar-icon" aria-hidden><KlaySparkleIcon /></span>
          <div className="lg-klay-modal-title">Draft entry</div>
        </div>
        <div className="lg-klay-modal-body">
          Klay detected an <strong>action</strong> intent from your query: <code>{intent.query}</code>.
          <br /><br />
          The draft entry panel will open here once it's wired up.
        </div>
        <div className="lg-klay-modal-foot">
          <button className="lg-klay-modal-btn" onClick={onClose}>Close</button>
          <button className="lg-klay-modal-btn primary" onClick={onClose}>Open draft (soon)</button>
        </div>
      </div>
    </div>
  );
}

export default function JournalEntryPage() {
  const {
    entries: JOURNAL_ENTRIES, addJournalEntry, updateJournalEntry, peekNextJeNumber, pendingDraft, clearPendingDraft,
    templates, addTemplate, updateTemplate, removeTemplate,
  } = useJournalEntries();
  const { hasLevel, user } = useCurrentUser();
  const canApprove = hasLevel("gl", "approve+post");
  const canTransact = hasLevel("gl", "transact");
  const insightsRole = canApprove ? "operator" : canTransact ? "preparer" : "viewer";
  const { assets, closedThrough } = useAssets();
  const navigate = useNavigate();
  const allRows = useMemo(() => {
    // Mark the AUTO_PROCESSED_COUNT most-recent pending JEs as auto-processed by Klay AI
    const pendingByDateDesc = JOURNAL_ENTRIES
      // Seeded entries only (no history yet): an entry someone made or moved
      // in-app is theirs, not a Klay draft, and must keep its real status.
      .filter((je) => je.status === "pending" && !je.history)
      .sort((a, b) => (b.je_date || "").localeCompare(a.je_date || ""))
      .slice(0, AUTO_PROCESSED_COUNT);
    const autoIds = new Set(pendingByDateDesc.map((je) => je.je_number));
    // Pick ANOMALY_COUNT anomalies from posted/draft (so the alert is varied)
    const anomalyCandidates = JOURNAL_ENTRIES
      .filter((je) => !autoIds.has(je.je_number) && !je.history && (je.status === "posted" || je.status === "draft"))
      .sort((a, b) => (b.je_date || "").localeCompare(a.je_date || ""));
    const anomalyArr = anomalyCandidates.slice(0, ANOMALY_COUNT);
    const anomalyIndex = new Map(anomalyArr.map((je, i) => [je.je_number, i]));
    const stored = JOURNAL_ENTRIES.map((je) => {
      const { debit, credit } = lineSums(je);
      if (autoIds.has(je.je_number)) {
        return { ...je, debit, credit, status: "auto", ai_summary: generateAiSummary(je) };
      }
      if (anomalyIndex.has(je.je_number)) {
        return { ...je, debit, credit, status: "anomaly", anomaly: generateAnomaly(je, anomalyIndex.get(je.je_number)) };
      }
      return { ...je, debit, credit };
    });
    // Entries drafted from a schedule and waiting for their date. Derived
    // from the asset register on every render, so they follow the assets;
    // a month drops off once its posted entry exists (lib/scheduledJournals.js).
    const scheduled = scheduledEntries(assets, { entries: JOURNAL_ENTRIES, templates, closedThrough, today: TODAY })
      .map((je) => ({ ...je, ...lineSums(je) }));
    return [...stored, ...scheduled];
  }, [JOURNAL_ENTRIES, assets, closedThrough, templates]);

  const [searchParams] = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get("tab");
    const valid = ["semua", "anomaly", "auto", "scheduled", "pending", "draft", "posted", "void"];
    return t && valid.includes(t) ? t : "semua";
  })();
  const [filter, setFilter] = useState({ kind: "tab", value: initialTab });

  // Respond to deep-link tab changes (e.g. navigating from Close → JE with ?tab=anomaly)
  useEffect(() => {
    const t = searchParams.get("tab");
    const valid = ["semua", "anomaly", "auto", "scheduled", "pending", "draft", "posted", "void"];
    if (t && valid.includes(t)) setFilter({ kind: "tab", value: t });
  }, [searchParams]);
  const [sortChoice, setSortChoice] = useState(null);
  const [groupChoice, setGroupChoice] = useState(null);
  const emptyFilters = { creators: new Set(), minAmt: "", maxAmt: "", dateFrom: "", dateTo: "" };
  const [filterValues, setFilterValues] = useState(emptyFilters);

  // Klay command bar state
  const [klayQuery, setKlayQuery] = useState("");
  const [klayFilters, setKlayFilters] = useState({});
  const [klayAction, setKlayAction] = useState(null); // { query } when action modal open
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftSeedMemo, setDraftSeedMemo] = useState("");
  const [draftInitialLines, setDraftInitialLines] = useState(null);
  const [draftKey, setDraftKey] = useState(0); // remounts the modal so pre-filled state re-seeds
  const [highlightedRef, setHighlightedRef] = useState(null);
  const klayInputRef = useRef(null);

  // Bank-reconciliation strip + review modal
  const [reconDismissed, setReconDismissed] = useState(false);
  const [reconReviewOpen, setReconReviewOpen] = useState(false);
  function onReconItemAction(action, item) {
    if (action === "match") showToast(`${item.id} matched — Klay will learn the pattern`);
    else if (action === "skip") showToast(`${item.id} skipped for now`);
  }

  const [selectedId, setSelectedId] = useState(null);
  // Lifecycle dialogs (send back, reverse, make recurring) and the templates
  // drawer; `editingJe` is the draft open in the editor, if any.
  const [dialog, setDialog] = useState(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editingJe, setEditingJe] = useState(null);
  const [drawerTab, setDrawerTab] = useState("detail");
  // A line this page was sent to, as an index into the open entry's lines.
  const [focusLine, setFocusLine] = useState(null);

  // Deep link to one entry, and optionally to one line inside it: the Payment
  // tab on a bill links each debit and credit it wrote straight to the line
  // that carries it. Filters are cleared first, because a deep link that lands
  // on a row the current tab filters out shows nothing and looks broken.
  useEffect(() => {
    const je = searchParams.get("je");
    if (!je) return;
    setFilter({ kind: "tab", value: "semua" });
    setFilterValues(emptyFilters);
    setKlayFilters({});
    setSelectedId(je);
    const line = searchParams.get("line");
    const idx = line == null ? null : parseInt(line, 10);
    setFocusLine(Number.isInteger(idx) ? idx : null);
    setDrawerTab(Number.isInteger(idx) ? "lines" : "detail");
    setHighlightedRef(je);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [checked, setChecked] = useState(() => new Set());
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  const [sortPopOpen, setSortPopOpen] = useState(false);
  const [groupPopOpen, setGroupPopOpen] = useState(false);
  const [filterPopOpen, setFilterPopOpen] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeedQuestion, setAiSeedQuestion] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1800);
  }

  function openDraft(seedMemo = "") {
    setKlayAction(null);
    setDraftSeedMemo(seedMemo);
    setDraftInitialLines(null);
    setDraftKey((k) => k + 1);
    setDraftOpen(true);
  }

  // A stock adjustment (or other page) can stage a pre-filled draft, then route
  // here — open the draft modal seeded with its lines for review + post.
  useEffect(() => {
    if (!pendingDraft) return;
    setDraftSeedMemo(pendingDraft.memo || "");
    setDraftInitialLines(pendingDraft.lines || null);
    setDraftKey((k) => k + 1);
    setDraftOpen(true);
    clearPendingDraft();
  }, [pendingDraft, clearPendingDraft]);
  function openEdit(je) {
    const check = canEdit(je);
    if (!check.ok) { showToast(check.reason); return; }
    setKlayAction(null);
    setEditingJe(je);
    setDraftSeedMemo("");
    setDraftInitialLines(null);
    setDraftKey((k) => k + 1);
    setDraftOpen(true);
  }
  function handleSaveDraft(je, { submit = false, editing = false } = {}) {
    const by = user?.name || "You";
    const saved = withEvent(je, editing ? "edited" : "created", by);
    if (editing) updateJournalEntry(je.je_number, () => saved);
    else addJournalEntry(saved);
    setDraftOpen(false);
    setEditingJe(null);
    setDraftSeedMemo("");
    if (submit) {
      // The same checks as the Submit action; the entry stays a draft if one fails.
      const check = canSubmit(saved, { closedThrough });
      if (check.ok) {
        updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "pending" }, "submitted", by));
        selectTab("pending");
        showToast(`${je.je_number} submitted for approval`);
        return;
      }
      showToast(`${je.je_number} saved as draft — ${check.reason}`);
      selectTab("draft");
      return;
    }
    selectTab("draft");
    showToast(`${je.je_number} ${editing ? "updated" : "saved as draft"}`);
  }

  const tasks = useMemo(() => computeJournalTasks(allRows, insightsRole), [allRows, insightsRole]);
  const aiContext = useMemo(() => makeJournalAiContext(allRows), [allRows]);

  function askAi(question) {
    setSummaryOpen(false);
    setAiSeedQuestion(question);
    setAiOpen(true);
  }

  // ── Deep-link a task to the relevant filtered view (mirror Bills/Invoices) ─
  function handleTaskAction(task) {
    if (!task) return;
    clearChecks();
    setKlayFilters({});
    setFilterValues(emptyFilters);
    switch (task.id) {
      case "anomaly":        selectTab("anomaly"); break;
      case "auto":           selectTab("auto"); break;
      case "drafts":         selectTab("draft"); break;
      case "pending":
      case "largestPending": selectTab("pending"); break;
      case "balanced":
      case "unbalanced":
      case "largestPosted":  selectTab("posted"); break;
      case "voids":          selectTab("void"); break;
      default:               askAi(task.question);
    }
  }

  // ── KPIs ───────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { posted: 0, draft: 0, pending: 0, void: 0, auto: 0, anomaly: 0, scheduled: 0 };
    allRows.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [allRows]);

  const jeStats = useMemo(() => {
    const draftSum   = allRows.filter((r) => r.status === "draft").reduce((s, r) => s + (r.debit || 0), 0);
    const pendingSum = allRows.filter((r) => r.status === "pending").reduce((s, r) => s + (r.debit || 0), 0);
    return { draftSum, pendingSum };
  }, [allRows]);

  const tabCounts = useMemo(() => ({
    semua:   allRows.length,
    anomaly: counts.anomaly,
    auto:    counts.auto,
    scheduled: counts.scheduled,
    pending: counts.pending,
    draft:   counts.draft,
    posted:  counts.posted,
    void:    counts.void,
  }), [allRows, counts]);
  const tabs = [
    { k: "semua",   lbl: "All",     count: tabCounts.semua },
    { k: "anomaly", lbl: "Anomaly", count: tabCounts.anomaly },
    { k: "auto",    lbl: "Auto",    count: tabCounts.auto },
    { k: "scheduled", lbl: "Scheduled", count: tabCounts.scheduled },
    { k: "pending", lbl: "Pending", count: tabCounts.pending },
    { k: "draft",   lbl: "Draft",   count: tabCounts.draft },
    { k: "posted",  lbl: "Posted",  count: tabCounts.posted },
    { k: "void",    lbl: "Void",    count: tabCounts.void },
  ];

  // ── Corpus ─────────────────────────────────────────────────────────────
  const corpus = useMemo(() => {
    let list = allRows;
    if (filter.kind === "tab" && filter.value !== "semua") list = list.filter((r) => r.status === filter.value);
    return list;
  }, [allRows, filter]);

  const klayFilterKeys = useMemo(() => Object.keys(klayFilters), [klayFilters]);

  const hasActiveFilters = useMemo(() => (
    filterValues.creators.size > 0 ||
    filterValues.minAmt !== "" ||
    filterValues.maxAmt !== "" ||
    filterValues.dateFrom !== "" ||
    filterValues.dateTo !== "" ||
    klayFilterKeys.length > 0 ||
    sortChoice !== null ||
    groupChoice !== null
  ), [filterValues, klayFilterKeys, sortChoice, groupChoice]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.creators.size > 0) n++;
    if (filterValues.minAmt !== "" || filterValues.maxAmt !== "") n++;
    if (filterValues.dateFrom !== "" || filterValues.dateTo !== "") n++;
    return n;
  }, [filterValues]);

  // Unified chip list (Klay-parsed + manual FilterPopover values) — same shape, removable
  const activeChips = useMemo(() => {
    const chips = [];
    for (const key of klayFilterKeys) {
      chips.push({ id: `klay:${key}`, source: "klay", key, label: klayChipLabel(key, klayFilters[key]) });
    }
    if (filterValues.creators.size > 0) {
      const list = Array.from(filterValues.creators).join(", ");
      chips.push({ id: "manual:creators", source: "manual", key: "creators", label: `Created by: ${list}` });
    }
    if (filterValues.minAmt !== "" || filterValues.maxAmt !== "") {
      const min = filterValues.minAmt !== "" ? `Rp ${Number(filterValues.minAmt).toLocaleString("id-ID")}` : "—";
      const max = filterValues.maxAmt !== "" ? `Rp ${Number(filterValues.maxAmt).toLocaleString("id-ID")}` : "—";
      chips.push({ id: "manual:amount", source: "manual", key: "amount", label: `Debit ${min} – ${max}` });
    }
    if (filterValues.dateFrom !== "" || filterValues.dateTo !== "") {
      const from = filterValues.dateFrom || "—";
      const to = filterValues.dateTo || "—";
      chips.push({ id: "manual:date", source: "manual", key: "date", label: `Date ${from} → ${to}` });
    }
    return chips;
  }, [klayFilters, klayFilterKeys, filterValues]);

  // ── Apply filters ─────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let list = corpus;
    if (filterValues.creators.size > 0) list = list.filter((r) => filterValues.creators.has(r.created_by));
    const min = filterValues.minAmt === "" ? null : Number(filterValues.minAmt);
    const max = filterValues.maxAmt === "" ? null : Number(filterValues.maxAmt);
    if (min != null && !isNaN(min)) list = list.filter((r) => r.debit >= min);
    if (max != null && !isNaN(max)) list = list.filter((r) => r.debit <= max);
    if (filterValues.dateFrom) list = list.filter((r) => r.je_date >= filterValues.dateFrom);
    if (filterValues.dateTo) list = list.filter((r) => r.je_date <= filterValues.dateTo);

    // Klay-parsed filters
    if (klayFilters.status === "flagged") list = list.filter((r) => r.status === "pending");
    else if (klayFilters.status) list = list.filter((r) => r.status === klayFilters.status);
    if (klayFilters.category === "inventory") {
      list = list.filter((r) =>
        /inventor/i.test(r.memo) || r.lines.some((l) => /inventor/i.test(l.account_name || "")),
      );
    } else if (klayFilters.category === "payroll") {
      list = list.filter((r) =>
        /payroll|salar|wage/i.test(r.memo) || r.lines.some((l) => /payroll|salar|wage/i.test(l.account_name || "")),
      );
    }
    if (typeof klayFilters.amountMin === "number") {
      list = list.filter((r) => r.debit >= klayFilters.amountMin);
    }
    if (klayFilters.dateRange === "thisMonth") {
      const ym = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
      list = list.filter((r) => (r.je_date || "").startsWith(ym));
    } else if (klayFilters.dateRange === "thisWeek") {
      const t = new Date(TODAY); const wAgo = new Date(t); wAgo.setDate(wAgo.getDate() - 7);
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const lo = fmt(wAgo); const hi = fmt(t);
      list = list.filter((r) => r.je_date >= lo && r.je_date <= hi);
    }
    if (klayFilters.freeText) {
      const ft = klayFilters.freeText.toLowerCase();
      list = list.filter((r) =>
        r.je_number.toLowerCase().includes(ft) ||
        (r.memo || "").toLowerCase().includes(ft),
      );
    }
    return list;
  }, [corpus, filterValues, klayFilters]);

  // ── Sort + Group ───────────────────────────────────────────────────────
  const effectiveSort = sortChoice || "date-desc";
  const effectiveGroup = groupChoice || "none";

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    const cmpBy = (a, b) => {
      switch (effectiveSort) {
        case "date-desc":  return (b.je_date || "").localeCompare(a.je_date || "");
        case "date-asc":   return (a.je_date || "").localeCompare(b.je_date || "");
        case "ref-asc":    return a.je_number.localeCompare(b.je_number);
        case "ref-desc":   return b.je_number.localeCompare(a.je_number);
        case "debit-desc": return b.debit - a.debit;
        case "debit-asc":  return a.debit - b.debit;
        case "lines-desc": return b.lines.length - a.lines.length;
        default: return 0;
      }
    };
    // Pin Anomaly first (urgent), then Auto (needs confirmation), then chosen sort
    const tier = (r) => r.status === "anomaly" ? 0 : r.status === "auto" ? 1 : 2;
    arr.sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      return cmpBy(a, b);
    });
    return arr;
  }, [filteredRows, effectiveSort]);

  const groups = useMemo(() => {
    if (effectiveGroup === "none") return null;
    const keyFn = (r) => {
      if (effectiveGroup === "status") return STATUS_LABEL[r.status] || r.status;
      if (effectiveGroup === "month") {
        const [y, m] = r.je_date.split("-");
        const names = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        return `${names[parseInt(m, 10) - 1]} ${y}`;
      }
      return "—";
    };
    const map = new Map();
    for (const r of sortedRows) {
      const k = keyFn(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return Array.from(map.entries()).map(([k, rows]) => ({
      key: k,
      label: k,
      rows,
      sum: rows.reduce((s, r) => s + r.debit, 0),
      kind: effectiveGroup,
    }));
  }, [effectiveGroup, sortedRows]);

  const selected = allRows.find((r) => r.je_number === selectedId);

  const pageDebit = filteredRows.reduce((s, r) => s + r.debit, 0);
  const pageCredit = filteredRows.reduce((s, r) => s + r.credit, 0);
  const selectedDebit = filteredRows.filter((r) => checked.has(r.je_number)).reduce((s, r) => s + r.debit, 0);

  // ── Handlers ───────────────────────────────────────────────────────────
  function toggleRow(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleGroup(key) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function clearChecks() { setChecked(new Set()); }
  function selectTab(t) { setFilter({ kind: "tab", value: t }); clearChecks(); }
  function selectCard(c) {
    if (c === null || c === "all") setFilter({ kind: "tab", value: "semua" });
    else                          setFilter({ kind: "tab", value: c });
    clearChecks();
  }
  const isTabActive  = (t) => filter.kind === "tab" && filter.value === t;
  const isCardActive = (c) => {
    if (c === "all") return filter.value === "semua";
    return filter.value === c;
  };

  function resetAll() {
    setSortChoice(null);
    setGroupChoice(null);
    setFilterValues(emptyFilters);
    setKlayFilters({});
    setKlayQuery("");
  }

  // ── Klay command bar handlers ─────────────────────────────────────────
  function submitKlayQuery() {
    const q = klayQuery.trim();
    if (!q) return;
    const intent = detectKlayIntent(q);
    if (intent === "lookup") {
      const upper = q.toUpperCase();
      const hit = allRows.find((r) => r.je_number.toUpperCase() === upper);
      if (!hit) {
        showToast(`${q} not found`);
        return;
      }
      // Clear filter state so the row is guaranteed visible
      setFilter({ kind: "tab", value: "semua" });
      setFilterValues(emptyFilters);
      setKlayFilters({});
      setHighlightedRef(hit.je_number);
      setKlayQuery("");
    } else if (intent === "question") {
      askAi(q);
      setKlayQuery("");
    } else if (intent === "action") {
      console.log("[Klay] action intent:", { query: q, verb: q.match(ACTION_VERB_RE)?.[1]?.toLowerCase() });
      if (canTransact) openDraft(q);
      else setKlayAction({ query: q });
      setKlayQuery("");
    } else if (intent === "filter") {
      const parsed = parseKlayFilters(q);
      setKlayFilters((prev) => ({ ...prev, ...parsed }));
      setKlayQuery("");
    }
  }

  function removeChip(chip) {
    if (chip.source === "klay") {
      setKlayFilters((prev) => {
        const next = { ...prev };
        delete next[chip.key];
        return next;
      });
    } else if (chip.source === "manual") {
      if (chip.key === "creators") setFilterValues((v) => ({ ...v, creators: new Set() }));
      else if (chip.key === "amount") setFilterValues((v) => ({ ...v, minAmt: "", maxAmt: "" }));
      else if (chip.key === "date") setFilterValues((v) => ({ ...v, dateFrom: "", dateTo: "" }));
    }
  }

  function clearAllChips() {
    setKlayFilters({});
    setFilterValues(emptyFilters);
  }

  // Listen for global launcher submissions
  useEffect(() => {
    const onOpenChat = (e) => askAi(e.detail?.question || "");
    window.addEventListener("klay:open-chat", onOpenChat);
    return () => window.removeEventListener("klay:open-chat", onOpenChat);
  }, []);

  // Listen for "open results in table" from chat replies
  useEffect(() => {
    const onApply = (e) => {
      const q = e.detail?.query || "";
      const parsed = parseKlayFilters(q);
      setKlayFilters((prev) => ({ ...prev, ...parsed }));
      setAiOpen(false);
      setAiSeedQuestion(null);
      const n = e.detail?.count;
      showToast(typeof n === "number" ? `${n} journal${n === 1 ? "" : "s"} — filter applied` : "Filter applied");
    };
    window.addEventListener("klay:apply-filters", onApply);
    return () => window.removeEventListener("klay:apply-filters", onApply);
  }, []);

  // ⌘K / Ctrl+K to focus the bar
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        klayInputRef.current?.focus();
        klayInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scroll to + flash the highlighted row after lookup
  useEffect(() => {
    if (!highlightedRef) return;
    const el = document.querySelector(`[data-je-row="${highlightedRef}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("lg-klay-flash");
      const tmr = setTimeout(() => {
        el.classList.remove("lg-klay-flash");
        setHighlightedRef(null);
      }, 2400);
      return () => clearTimeout(tmr);
    }
    setHighlightedRef(null);
  }, [highlightedRef]);

  function exportCsv() {
    const rowsToExport = checked.size > 0
      ? sortedRows.filter((r) => checked.has(r.je_number))
      : sortedRows;
    const headers = ["Journal No.", "Date", "Memo", "Status", "Lines", "Debit", "Credit", "Dibuat oleh"];
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of rowsToExport) {
      lines.push([r.je_number, r.je_date, r.memo, r.status, r.lines.length, r.debit, r.credit, r.created_by].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = `${TODAY.getFullYear()}${String(TODAY.getMonth() + 1).padStart(2, "0")}${String(TODAY.getDate()).padStart(2, "0")}`;
    a.download = `klay-journal-${filter.value}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${rowsToExport.length} journals exported to CSV`);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  // Rows can carry a display status (Auto, Anomaly) over the stored one, so
  // every check and every write goes through the stored entry.
  const actor = user?.name || "You";
  const todayIso = isoOf(TODAY);
  const storedOf = (r) => JOURNAL_ENTRIES.find((j) => j.je_number === r.je_number) || r;
  const ctx = { user: actor, closedThrough, canPost: canApprove };

  // Where an entry came from, for the drawer's Source row and "Open source".
  function sourceOf(je) {
    const id = je.reference_id;
    if (je.status === "scheduled" && je.schedule) {
      if (je.schedule.kind === "template") return { label: je.schedule.source, open: () => setTemplatesOpen(true) };
      if (je.schedule.kind === "reversal") return { label: `Entry ${je.schedule.reverses}`, open: () => { setSelectedId(je.schedule.reverses); setDrawerTab("detail"); } };
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
    if (je.reference_type === "recurring") return { label: "Recurring template", open: () => setTemplatesOpen(true) };
    if (je.reversal_of) return { label: `Reverses ${je.reversal_of}`, open: () => { setSelectedId(je.reversal_of); setDrawerTab("detail"); } };
    return null;
  }

  function actionsFor(row) {
    if (row.status === "scheduled") {
      const src = sourceOf(row);
      return [
        ...(canApprove ? [{ key: "post_scheduled", label: row.schedule?.due ? "Post now" : "Post early", icon: "check", primary: true, check: { ok: true } }] : []),
        ...(src ? [{ key: "open_source", label: `Open ${src.label.replace(/^Recurring template.*/, "recurring templates").replace(/^Fixed/, "fixed").replace(/^Entry/, "entry")}`, icon: "link", check: { ok: true } }] : []),
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
    if (je.status === "posted" && reversibleHere(je)) out.push({ key: "reverse", label: "Reverse", icon: "reverse", check: canReverse(je, ctx) });
    if (!sys && !je.reversal_of && ["draft", "posted"].includes(je.status) && canTransact) {
      out.push({ key: "recurring", label: "Make recurring", icon: "repeat", check: { ok: true } });
    }
    const src = sourceOf(je);
    if (src) out.push({ key: "open_source", label: "Open source", icon: "link", check: { ok: true } });
    if ((je.status === "draft" || je.status === "pending") && !sys) out.push({ key: "void", label: "Void", icon: "void", danger: true, check: canVoid(je) });
    return out;
  }

  function submitEntry(je) {
    const check = canSubmit(je, ctx);
    if (!check.ok) { showToast(check.reason); return false; }
    updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "pending" }, "submitted", actor));
    return true;
  }
  function approveEntry(je) {
    const check = canApproveEntry(je, ctx);
    if (!check.ok) { showToast(check.reason); return false; }
    updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "posted", posted_by: actor, posted_date: todayIso }, "approved and posted", actor));
    return true;
  }

  function onRowAction(action, row) {
    setMenuOpenFor(null);
    if (action === "view") { setSelectedId(row.je_number); setDrawerTab("detail"); return; }
    if (action === "post_scheduled") { postScheduled(row); return; }
    if (action === "open_source") { sourceOf(row.status === "scheduled" ? row : storedOf(row))?.open(); return; }
    const je = storedOf(row);
    if (action === "submit" && submitEntry(je)) showToast(`${je.je_number} submitted for approval`);
    else if (action === "approve" && approveEntry(je)) showToast(`${je.je_number} approved and posted`);
    else if (action === "edit") openEdit(je);
    else if (action === "return") setDialog({ kind: "return", je });
    else if (action === "reverse") setDialog({ kind: "reverse", je });
    else if (action === "recurring") setDialog({ kind: "recurring", je });
    else if (action === "void") {
      const check = canVoid(je);
      if (!check.ok) { showToast(check.reason); return; }
      updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "void" }, "voided", actor));
      showToast(`${je.je_number} voided`);
    }
  }

  function confirmReturn(je, reason) {
    updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "draft" }, "sent back", actor, reason));
    setDialog(null);
    showToast(`${je.je_number} sent back to ${je.created_by}`);
  }

  function confirmReverse(je, date) {
    const check = canReverse(je, ctx);
    if (!check.ok) { showToast(check.reason); return; }
    const jeNumber = peekNextJeNumber();
    addJournalEntry(buildReversal(je, { jeNumber, date, by: actor, today: todayIso }));
    updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, reversed_by: jeNumber }, "reversed", actor, `By ${jeNumber}`));
    setDialog(null);
    showToast(`${je.je_number} reversed by ${jeNumber}`);
  }

  function confirmRecurring(je, cfg) {
    const id = `TPL-${String(templates.length + 1 + Math.floor(Math.random() * 900)).padStart(3, "0")}`;
    addTemplate({
      id, ...cfg, memo: cfg.name, active: true, created_by: actor, created_date: todayIso,
      lines: je.lines.map(({ account_code, account_name, debit, credit, description, dimensions, payee }) => ({ account_code, account_name, debit, credit, description, dimensions, payee })),
    });
    setDialog(null);
    selectTab("scheduled");
    showToast(`Template “${cfg.name}” created — its months are on the Scheduled tab`);
  }

  // Posting a scheduled entry writes a real, numbered entry dated on its
  // schedule date and carrying its schedule_key, which is what takes the
  // scheduled one off the list (lib/scheduledJournals.js). A template's
  // auto-reverse flag travels with it; a scheduled reversal marks the entry
  // it reverses.
  function postScheduled(je) {
    const jeNumber = peekNextJeNumber();
    const kind = je.schedule?.kind;
    addJournalEntry(withEvent({
      je_number: jeNumber,
      je_date: je.je_date,
      status: "posted",
      memo: je.memo,
      reference_type: kind === "template" ? "recurring" : kind === "reversal" ? "reversal" : "schedule",
      reference_id: je.reference_id,
      schedule_key: je.schedule_key,
      ...(je.auto_reverse ? { auto_reverse: true } : {}),
      ...(je.reversal_of ? { reversal_of: je.reversal_of } : {}),
      created_by: "Klay schedule",
      created_date: todayIso,
      posted_by: actor,
      posted_date: todayIso,
      lines: je.lines.map(({ account_code, account_name, debit, credit, description }) => ({ account_code, account_name, debit, credit, description })),
    }, "posted from schedule", actor, je.schedule?.source));
    if (je.reversal_of) {
      updateJournalEntry(je.reversal_of, (cur) => withEvent({ ...cur, reversed_by: jeNumber }, "reversed", actor, `By ${jeNumber}`));
    }
    if (selectedId === je.je_number) setSelectedId(jeNumber);
    showToast(`${je.memo} posted as ${jeNumber}`);
  }

  function onAutoAction(action, je) {
    if (action === "confirm") showToast(`${je.je_number} confirmed and posted to GL`);
    else if (action === "reject") showToast(`${je.je_number} rejected — Klay will re-learn`);
  }
  // Bulk runs each selected entry through the same checks as one at a time,
  // and says how many it skipped and why rather than failing silently.
  function onBulk(action) {
    const picked = [...checked].map((n) => JOURNAL_ENTRIES.find((j) => j.je_number === n)).filter(Boolean);
    const run = action === "submit" ? submitEntryQuiet : approveEntryQuiet;
    let done = 0;
    const skipped = [];
    for (const je of picked) { const r = run(je); if (r.ok) done += 1; else skipped.push(r.reason); }
    const verb = action === "submit" ? "submitted" : "approved and posted";
    const why = skipped.length ? ` · ${skipped.length} skipped (${[...new Set(skipped)][0]})` : "";
    showToast(`${done} ${verb}${why}`);
    clearChecks();
  }
  function submitEntryQuiet(je) {
    const check = canSubmit(je, ctx);
    if (check.ok) updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "pending" }, "submitted", actor));
    return check;
  }
  function approveEntryQuiet(je) {
    const check = canApproveEntry(je, ctx);
    if (check.ok) updateJournalEntry(je.je_number, (cur) => withEvent({ ...cur, status: "posted", posted_by: actor, posted_date: todayIso }, "approved and posted", actor));
    return check;
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        {/* ── Editorial header ──────────────────────────────────────── */}
        {/* No summary strip for MVP: the status tabs below already carry the
            counts, and the list is where the work happens. */}
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Journal Entry</h1>
            </div>
            <div className="lg-head-actions">
              <button
                className="lg-btn-brand"
                disabled={!canTransact}
                title={canTransact ? "Draft a new journal entry" : "Your role can view journals but not draft them"}
                onClick={() => canTransact && openDraft()}
              >
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Journal Entry
              </button>
            </div>
          </div>
        </div>

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card lg-table-je">
            <div className="bp-tabs-row">
              {tabs.map((t) => (
                <button key={t.k} className={`bp-tab${isTabActive(t.k) ? " active" : ""}`} onClick={() => selectTab(t.k)}>
                  {t.lbl}
                  <span className="bp-tab-count">{t.count}</span>
                </button>
              ))}
              {/* The templates feeding the Scheduled tab live next to it. */}
              {isTabActive("scheduled") && (
                <button type="button" className="je-tpl-btn" onClick={() => setTemplatesOpen(true)}>
                  {ACTION_ICON.repeat}
                  Recurring templates · {templates.length}
                </button>
              )}
            </div>

            <div className="lg-filter-row">
              <KlayCommandBar
                inputRef={klayInputRef}
                value={klayQuery}
                onChange={setKlayQuery}
                onSubmit={submitKlayQuery}
                onClear={() => setKlayQuery("")}
                chips={activeChips}
                onRemoveChip={removeChip}
                onClearChips={clearAllChips}
              />
              <div className="lg-filter-meta">
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${activeFilterCount > 0 ? " active" : ""}`} onClick={() => { setFilterPopOpen(!filterPopOpen); setSortPopOpen(false); setGroupPopOpen(false); }}>
                    <svg viewBox="0 0 12 12"><path d="M2 3h8M3 6h6M4 9h4" strokeLinecap="round"/></svg>
                    Filter
                    {activeFilterCount > 0 && <span className="lg-filter-badge">{activeFilterCount}</span>}
                  </button>
                  {filterPopOpen && <FilterPopover values={filterValues} onChange={setFilterValues} onClose={() => setFilterPopOpen(false)} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => { setSortPopOpen(!sortPopOpen); setFilterPopOpen(false); setGroupPopOpen(false); }}>
                    <span className="meta-lbl">Sort:</span>
                    <span className="meta-val">{SORT_LABELS[effectiveSort]}</span>
                  </button>
                  {sortPopOpen && <SortPopover value={effectiveSort} onPick={(v) => { setSortChoice(v); setSortPopOpen(false); }} onClose={() => setSortPopOpen(false)} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => { setGroupPopOpen(!groupPopOpen); setSortPopOpen(false); setFilterPopOpen(false); }}>
                    <span className="meta-lbl">Group:</span>
                    <span className="meta-val">{GROUP_LABELS[effectiveGroup]}</span>
                  </button>
                  {groupPopOpen && <GroupPopover value={effectiveGroup} onPick={(v) => { setGroupChoice(v); setGroupPopOpen(false); }} onClose={() => setGroupPopOpen(false)} />}
                </div>
                {hasActiveFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            <div className="lg-col-header">
              <div><input type="checkbox" className="lg-row-check" disabled /></div>
              <div>Date</div>
              <div>Reference</div>
              <div>Description</div>
              <div style={{ textAlign: "right" }}>Lines</div>
              <div style={{ textAlign: "right" }}>Debit (Rp)</div>
              <div style={{ textAlign: "right" }}>Credit (Rp)</div>
              <div>Status</div>
              <div />
            </div>

            <div>
              {groups ? (
                groups.map((g) => {
                  const isCollapsed = collapsedGroups.has(g.key);
                  return (
                    <div key={g.key}>
                      <div className="lg-group-head muted" onClick={() => toggleGroup(g.key)}>
                        <div className="lg-group-left">
                          <svg className={`lg-group-chevron${isCollapsed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>
                          <span className="lg-group-lbl">{g.label}</span>
                          <span className="lg-group-count">{g.rows.length}</span>
                        </div>
                        {g.sum > 0 && (
                          <div className="lg-group-subtotal">
                            <span className="lg-group-subtotal-lbl">Debit</span>
                            Rp {fmtRp(g.sum)}
                          </div>
                        )}
                      </div>
                      {!isCollapsed && g.rows.map((r, i) => (
                        <div key={r.je_number} data-je-row={r.je_number} style={{ position: "relative" }}>
                          <JeRow
                            r={r}
                            isChecked={checked.has(r.je_number)}
                            onCheck={toggleRow}
                            onClick={() => { setSelectedId(r.je_number); setDrawerTab("detail"); }}
                            onKebab={(id) => setMenuOpenFor(menuOpenFor === id ? null : id)}
                            isSelected={selectedId === r.je_number}
                            isAlt={i % 2 === 1}
                          />
                          {menuOpenFor === r.je_number && (
                            <div style={{ position: "absolute", right: 32, top: 32, zIndex: 5 }}>
                              <RowMenu je={r} actions={actionsFor(r)} onClose={() => setMenuOpenFor(null)} onAction={onRowAction} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })
              ) : (
                <>
                  {sortedRows.length === 0 && <div className="lg-empty">None journals matching</div>}
                  {sortedRows.map((r, i) => (
                    <div key={r.je_number} data-je-row={r.je_number} style={{ position: "relative" }}>
                      <JeRow
                        r={r}
                        isChecked={checked.has(r.je_number)}
                        onCheck={toggleRow}
                        onClick={() => { setSelectedId(r.je_number); setDrawerTab("detail"); }}
                        onKebab={(id) => setMenuOpenFor(menuOpenFor === id ? null : id)}
                        isSelected={selectedId === r.je_number}
                        isAlt={i % 2 === 1}
                      />
                      {menuOpenFor === r.je_number && (
                        <div style={{ position: "absolute", right: 32, top: 32, zIndex: 5 }}>
                          <RowMenu je={r} actions={actionsFor(r)} onClose={() => setMenuOpenFor(null)} onAction={onRowAction} />
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>{/* /lg-scroll-container */}

      {/* ── Sticky footer ──────────────────────────────────────────── */}
      <div className="lg-footer">
        <div className="lg-footer-left">
          <span><span className="lg-footer-num">{checked.size}</span> selected</span>
          {checked.size > 0 ? (
            <>
              <button className="lg-footer-bulk-btn" onClick={() => onBulk("submit")}>Submit for approval</button>
              {canApprove && <button className="lg-footer-bulk-btn" onClick={() => onBulk("approve")}>Approve &amp; post</button>}
              <button className="lg-footer-clear" onClick={clearChecks}>Clear selection</button>
            </>
          ) : (
            <>
              <span className="lg-footer-sep">·</span>
              <span>Showing <span className="lg-footer-num">{filteredRows.length}</span> journals</span>
              <span className="lg-footer-sep">·</span>
              <span style={{ color: Math.abs(pageDebit - pageCredit) < 1 ? "var(--color-success-text)" : "var(--color-danger-text)" }}>
                {Math.abs(pageDebit - pageCredit) < 1 ? "✓ Balanced" : `Variance Rp ${fmtRp(Math.abs(pageDebit - pageCredit))}`}
              </span>
            </>
          )}
        </div>
        <div className="lg-footer-right">
          <button className="lg-footer-export" onClick={exportCsv} title="Export the rows shown above to CSV">
            <svg viewBox="0 0 12 12"><path d="M6 2v6M3 6l3 3 3-3M2 10.5h8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Export {checked.size > 0 ? `${checked.size} selected` : `${filteredRows.length} visible`}
          </button>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">{checked.size > 0 ? "Debit selected" : "Debit page"}</span>
          <span className="lg-footer-total">Rp {fmtRp(checked.size > 0 ? selectedDebit : pageDebit)}</span>
        </div>
      </div>

      {/* ── Side drawer (JE detail) ─────────────────────────────── */}
      {selected && (
        <>
          <div className="drawer-overlay" onClick={() => setSelectedId(null)} />
          <div className="drawer">
            <div className="drawer-head">
              <div className="drawer-av invoice">JE</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title">{selected.je_number}</div>
                <div className="drawer-sub">
                  {formatDate(selected.je_date)} ·{" "}
                  <span className={`badge badge-${STATUS_BADGE_CLASS[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                </div>
              </div>
              <button className="drawer-close" onClick={() => setSelectedId(null)}>
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="drawer-tabs">
              {[["detail", "Detail"], ["lines", "Lines Journal"], ["audit", "Audit"], ["ai", "AI Insight"]].map(([t, label]) => (
                <div key={t} className={`drawer-tab${drawerTab === t ? " active" : ""}`} onClick={() => setDrawerTab(t)}>
                  {t === "ai" && <span style={{ marginRight: 4, color: "var(--color-action)" }}>✦</span>}
                  {label}
                </div>
              ))}
            </div>
            <div className="drawer-body">
              {drawerTab === "detail" && (
                <>
                  {selected.status === "auto" && selected.ai_summary && (
                    <div className="drawer-ai-callout">
                      <div className="drawer-ai-eyebrow"><KlaySparkleIcon /> Klay's interpretation</div>
                      <p className="drawer-ai-text">{selected.ai_summary}</p>
                      <div className="drawer-ai-meta">Auto-drafted by Klay · awaiting your confirmation</div>
                    </div>
                  )}
                  {selected.status === "anomaly" && selected.anomaly && (
                    <div className="drawer-anomaly-callout">
                      <div className="drawer-anomaly-eyebrow">
                        <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor" stroke="none"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff" stroke="none"/></svg>
                        Anomaly flagged by Klay
                      </div>
                      <p className="drawer-anomaly-text">{selected.anomaly}</p>
                      <div className="drawer-anomaly-meta">Needs your review before period close</div>
                    </div>
                  )}
                  {selected.status === "scheduled" && selected.schedule && (
                    <div className={`drawer-sched-callout${selected.schedule.due ? " due" : ""}`}>
                      <div className="drawer-sched-eyebrow">
                        {selected.schedule.due ? "Due — not posted yet" : `Scheduled · posts on ${formatDate(selected.schedule.postsOn)}`}
                      </div>
                      <p className="drawer-sched-text">
                        {selected.schedule.kind === "template"
                          ? <>Drafted from {selected.schedule.source} for {selected.schedule.periodLabel}. It is read-only — change or pause the template and this entry follows. It posts without a second approval; the template was the approval.</>
                          : selected.schedule.kind === "reversal"
                            ? <>Undoes {selected.schedule.reverses} on {formatDate(selected.schedule.postsOn)}, the 1st of the month after it was booked — every debit and credit swapped.</>
                            : <>Drafted from the fixed asset register for {selected.schedule.periodLabel}. It is read-only — change an asset and this entry follows.</>}
                        {" "}It gets its journal number when it posts.
                        {selected.schedule.note && <> {selected.schedule.note}</>}
                      </p>
                      <div className="drawer-sched-list">
                        {selected.schedule.sources.map((s, i) => (
                          <div key={`${s.id}-${i}`} className="drawer-sched-item">
                            <span className="drawer-sched-tag">{s.tag}</span>
                            <span className="drawer-sched-name">{s.name}</span>
                            <span className="drawer-sched-amt">Rp {fmtRp(s.amount)}</span>
                          </div>
                        ))}
                      </div>
                      {selected.schedule.unmapped.length > 0 && (
                        <div className="drawer-sched-warn">
                          Left out — no account mapped for {selected.schedule.unmapped.join(", ")}. Set the accounts on the asset category.
                        </div>
                      )}
                    </div>
                  )}
                  <div className="drawer-stat-row">
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Total Debit</div>
                      <div className="drawer-stat-val">Rp {fmtRp(selected.debit)}</div>
                    </div>
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Total Credit</div>
                      <div className="drawer-stat-val">Rp {fmtRp(selected.credit)}</div>
                    </div>
                  </div>
                  <div className="drawer-section">
                    <div className="drawer-section-title">Journal Information</div>
                    {[
                      ["Journal No.", selected.status === "scheduled" ? "Assigned on posting" : selected.je_number],
                      ["Date", formatDate(selected.je_date)],
                      ["Description", selected.memo],
                      ["Reference", selected.reference || "—"],
                      ["Reference type", selected.reference_type || "—"],
                      ["Created by", selected.created_by],
                      ["Created on", formatDate(selected.created_date)],
                      ["Posted by", selected.posted_by || "—"],
                      ["Posted on", selected.posted_date ? formatDate(selected.posted_date) : "—"],
                    ].map(([label, value]) => (
                      <div key={label} className="drawer-row">
                        <div className="drawer-label">{label}</div>
                        <div className="drawer-value">{value}</div>
                      </div>
                    ))}
                    {/* Where the entry came from, one click away — the bill,
                        payment, asset or template that wrote it. */}
                    {(() => {
                      const src = sourceOf(selected.status === "scheduled" ? selected : storedOf(selected));
                      const stored = storedOf(selected);
                      return (
                        <>
                          <div className="drawer-row">
                            <div className="drawer-label">Source</div>
                            <div className="drawer-value">
                              {src ? <button type="button" className="je-link" onClick={src.open}>{src.label} →</button> : "Manual entry"}
                            </div>
                          </div>
                          {stored.reversed_by && (
                            <div className="drawer-row">
                              <div className="drawer-label">Reversed by</div>
                              <div className="drawer-value">
                                <button type="button" className="je-link" onClick={() => setSelectedId(stored.reversed_by)}>{stored.reversed_by} →</button>
                              </div>
                            </div>
                          )}
                          {stored.auto_reverse && !stored.reversed_by && stored.status !== "scheduled" && (
                            <div className="drawer-row">
                              <div className="drawer-label">Auto-reverse</div>
                              <div className="drawer-value">On the 1st of the month after it posts</div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  {selected.status !== "scheduled" && (() => {
                    const stored = storedOf(selected);
                    const files = stored.attachments || [];
                    return (
                      <div className="drawer-section">
                        <div className="drawer-section-title">Attachments · {files.length}</div>
                        {files.length === 0 && <div className="je-attach-empty">Nothing attached.</div>}
                        {files.map((a, i) => (
                          <div key={`${a.name}-${i}`} className="je-attach-row">
                            <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
                            <span>{Math.max(1, Math.round((a.size || 0) / 1024))} KB</span>
                          </div>
                        ))}
                        {/* Evidence can be added at any stage, posted included —
                            it changes nothing in the ledger. */}
                        {stored.status !== "void" && canTransact && (
                          <label className="dje-attach-add">
                            + Attach file
                            <input type="file" multiple onChange={(e) => {
                              const added = [...e.target.files].map((f) => ({ name: f.name, size: f.size, type: f.type, url: URL.createObjectURL(f) }));
                              e.target.value = "";
                              if (!added.length) return;
                              updateJournalEntry(stored.je_number, (cur) => withEvent({ ...cur, attachments: [...(cur.attachments || []), ...added] }, "attached", actor, added.map((a) => a.name).join(", ")));
                              showToast(`${added.length} file${added.length === 1 ? "" : "s"} attached to ${stored.je_number}`);
                            }} />
                          </label>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
              {drawerTab === "lines" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">Lines Journal · {selected.lines.length} rows</div>
                  {selected.lines.map((l, i) => (
                    <div key={i} className={focusLine === i ? "je-line-focus" : ""} style={{ background: "var(--color-surface-sunken)", border: "1px solid var(--color-border-default)", borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-action)" }}>{l.account_code}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{l.account_name}</div>
                          {l.description && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{l.description}</div>}
                          {l.payee && (
                            <div style={{ fontSize: 11, marginTop: 4, color: "var(--color-text-secondary)" }}>
                              Payee: <strong>{l.payee.name}</strong> <span style={{ color: "var(--color-text-tertiary)" }}>· {l.payee.kind === "customer" ? "customer" : "vendor"}</span>
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          {l.debit > 0 && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700 }}>Dr {fmtRp(l.debit)}</div>}
                          {l.credit > 0 && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--color-action)" }}>Cr {fmtRp(l.credit)}</div>}
                        </div>
                      </div>
                      {(() => {
                        const acct = COA_BY_CODE[l.account_code];
                        const keys = dimensionsForAccount(acct);
                        if (keys.length === 0) return null;
                        const simulated = !l.dimensions;
                        return (
                          <div className="je-line-dims">
                            {keys.map((k) => {
                              const dim = DIM_BY_KEY[k];
                              if (!dim) return null;
                              const pal = paletteFor(dim.cls);
                              const val = l.dimensions?.[k] ?? sampleDimensionValue(k, `${selected.je_number}|${l.account_code}|${k}`);
                              if (!val) return null;
                              return (
                                <span className="je-line-dim" key={k} style={{ background: pal.bg, color: pal.fg }}>
                                  <span className="je-line-dim-k">{dim.label}</span>
                                  <span className="je-line-dim-v">{val}</span>
                                </span>
                              );
                            })}
                            {simulated && <span className="je-line-dim-sim" title="Illustrative values — this entry predates per-line dimension tagging">simulated</span>}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
              {drawerTab === "audit" && (() => {
                const stored = storedOf(selected);
                // Every lifecycle move appends to `history` (lib/journalLifecycle.js).
                // Seeded entries predate it, so their creation and posting are
                // read off the record itself.
                const events = stored.history?.length
                  ? stored.history
                  : [
                    { at: stored.created_date, action: "created", by: stored.created_by },
                    ...(stored.posted_by ? [{ at: stored.posted_date, action: "posted", by: stored.posted_by }] : []),
                  ];
                return (
                  <div className="drawer-section">
                    <div className="drawer-section-title">Audit trail</div>
                    <div className="je-audit">
                      {events.map((ev, i) => (
                        <div key={i} className="je-audit-item">
                          <span className="je-audit-dot" />
                          <div>
                            <div className="je-audit-head"><strong>{ev.action.charAt(0).toUpperCase() + ev.action.slice(1)}</strong> · {ev.by}</div>
                            <div className="je-audit-date">{formatDate(ev.at)}</div>
                            {ev.note && <div className="je-audit-note">{ev.note}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="drawer-row">
                      <div className="drawer-label">Current status</div>
                      <div className="drawer-value">
                        <span className={`badge badge-${STATUS_BADGE_CLASS[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {drawerTab === "ai" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">AI Insight</div>
                  <div style={{ padding: 12, background: "var(--ai-surface)", border: "1px solid var(--ai-border)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-action)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>✦ AI Classification</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                      {selected.lines.length} rows di-tag automatic berdasarkan deskripsi & pattern historical. Akurasi average <strong>96%</strong>, model v2.1.
                    </div>
                  </div>
                  {selected.status === "draft" && (
                    <div style={{ padding: 12, background: "var(--color-warning-surface)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-warning-text)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Recommendation</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                        Draft ini siap posted — semua rows balanced and account already terklasificashi.
                      </div>
                    </div>
                  )}
                  {selected.status === "pending" && (
                    <div style={{ padding: 12, background: "var(--color-warning-surface)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-md)" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-warning-text)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Awaiting Approval</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                        Already awaiting {Math.max(1, Math.floor((new Date("2025-04-23") - new Date(selected.created_date)) / 86400000))} days. Perteambangkan eskalasi to whichger.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="drawer-footer">
              {/* Auto and Anomaly keep their own review buttons below; every
                  other status offers the same actions as its row menu. */}
              {selected.status !== "auto" && selected.status !== "anomaly" && (() => {
                const acts = actionsFor(selected);
                const secondary = acts.filter((a) => !a.primary && !a.danger);
                const primary = acts.filter((a) => a.primary);
                const danger = acts.filter((a) => a.danger);
                return (
                  <>
                    {danger.map((a) => (
                      <button key={a.key} className="drawer-btn ghost danger-text" disabled={!a.check.ok} title={a.check.ok ? "" : a.check.reason}
                        onClick={() => onRowAction(a.key, selected)}>
                        {ACTION_ICON[a.icon]}{a.label}
                      </button>
                    ))}
                    {secondary.map((a) => (
                      <button key={a.key} className="drawer-btn ghost" disabled={!a.check.ok} title={a.check.ok ? "" : a.check.reason}
                        onClick={() => onRowAction(a.key, selected)}>
                        {ACTION_ICON[a.icon]}{a.label}
                      </button>
                    ))}
                    {primary.map((a) => (
                      <button key={a.key} className="drawer-btn primary" disabled={!a.check.ok} title={a.check.ok ? "" : a.check.reason}
                        onClick={() => onRowAction(a.key, selected)}>
                        {ACTION_ICON[a.icon]}{a.label}
                      </button>
                    ))}
                  </>
                );
              })()}
              {selected.status === "auto" && (
                <>
                  <button
                    className="drawer-btn ghost"
                    onClick={() => { onAutoAction("reject", selected); setSelectedId(null); }}
                  >
                    <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Reject
                  </button>
                  <button
                    className="drawer-btn primary klay"
                    onClick={() => { onAutoAction("confirm", selected); setSelectedId(null); }}
                  >
                    <KlaySparkleIcon />
                    Confirm &amp; post
                  </button>
                </>
              )}
              {selected.status === "anomaly" && (
                <>
                  <button
                    className="drawer-btn ghost"
                    onClick={() => { showToast(`${selected.je_number} dismissed — Klay will learn`); setSelectedId(null); }}
                  >
                    Dismiss
                  </button>
                  <button
                    className="drawer-btn primary danger"
                    onClick={() => { showToast(`Investigating ${selected.je_number}`); setSelectedId(null); }}
                  >
                    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    Investigate
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Klay AI drawers ────────────────────────────────────────── */}
      <div
        className={`ai-backdrop${aiOpen || summaryOpen ? " open" : ""}`}
        onClick={() => { setAiOpen(false); setSummaryOpen(false); }}
        aria-hidden={!(aiOpen || summaryOpen)}
      />
      <SummaryDrawer
        open={summaryOpen}
        insights={tasks}
        onClose={() => setSummaryOpen(false)}
        mode="tasks"
        title={insightsRole === "viewer" ? "GL Insights" : "Your Tasks"}
        ctaLabel="View"
        contextLabel="Journal Entry"
        onAsk={askAi}
        onPick={(t) => { handleTaskAction(t); setSummaryOpen(false); }}
      />
      <AiChatDrawer
        open={aiOpen}
        onClose={() => { setAiOpen(false); setAiSeedQuestion(null); }}
        initialQuestion={aiSeedQuestion}
        onConsumedInitialQuestion={() => setAiSeedQuestion(null)}
        context={aiContext}
        contextLabel="Journal Entry"
      />

      <KlayActionModal intent={klayAction} onClose={() => setKlayAction(null)} />
      <DraftJournalModal
        key={draftKey}
        open={draftOpen}
        intentQuery={draftSeedMemo}
        initialMemo={draftSeedMemo}
        initialLines={draftInitialLines}
        nextJeNumber={peekNextJeNumber()}
        createdBy={user?.name}
        editing={editingJe}
        closedThrough={closedThrough}
        onClose={() => { setDraftOpen(false); setEditingJe(null); setDraftSeedMemo(""); setDraftInitialLines(null); }}
        onSave={handleSaveDraft}
      />

      {dialog?.kind === "return" && (
        <ReturnDialog je={dialog.je} onClose={() => setDialog(null)} onConfirm={(reason) => confirmReturn(dialog.je, reason)} />
      )}
      {dialog?.kind === "reverse" && (
        <ReverseDialog je={dialog.je} closedThrough={closedThrough} onClose={() => setDialog(null)} onConfirm={(date) => confirmReverse(dialog.je, date)} />
      )}
      {dialog?.kind === "recurring" && (
        <RecurringDialog
          je={dialog.je}
          firstOpen={closedThrough ? nextPeriod(closedThrough) : null}
          onClose={() => setDialog(null)}
          onConfirm={(cfg) => confirmRecurring(dialog.je, cfg)}
        />
      )}
      {templatesOpen && (
        <TemplatesDrawer
          templates={templates}
          onClose={() => setTemplatesOpen(false)}
          onToggle={(t) => { updateTemplate(t.id, { active: !t.active }); showToast(`${t.name} ${t.active ? "paused" : "resumed"}`); }}
          onRemove={(t) => { removeTemplate(t.id); showToast(`${t.name} deleted — posted entries stay in the ledger`); }}
        />
      )}

      <ReconReviewModal
        open={reconReviewOpen}
        items={RECON_UNMATCHED}
        onClose={() => setReconReviewOpen(false)}
        onAction={onReconItemAction}
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
