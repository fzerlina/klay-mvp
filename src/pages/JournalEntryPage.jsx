import { useState, useMemo, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { isClosedDate } from "../lib/journalLifecycle";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import JournalTemplateMenu from "../components/JournalTemplateMenu";
import {
  fmtRp, STATUS_LABEL, STATUS_BADGE_CLASS, ACTION_ICON, KlaySparkleIcon, useJournalRows, useJournalActions,
  JE_SOURCES, JE_SOURCE_LABEL, entrySource,
} from "./journalEntryShared";
import { TODAY } from "../lib/clock";
import { formatDate } from "../lib/format";
import AiChatDrawer from "./AiChatDrawer";
import SummaryDrawer from "./SummaryDrawer";
import ReconReviewModal, { RECON_TOTAL, RECON_MATCHED, RECON_UNMATCHED } from "../components/ReconReviewModal";
import { computeJournalTasks, makeJournalAiContext } from "./ai-journal-context";
import "./modules.css";
import "./invoices-ledger.css";

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

function JeRow({ r, isChecked, onCheck, onClick, onKebab, isSelected, isAlt, closedThrough }) {
  // A pending entry dated in a closed period can't be approved until it is
  // re-dated (PRD §6) — say so on the row, not only in a tooltip.
  const stale = r.status === "pending" && isClosedDate(r.je_date, closedThrough);
  return (
    <div className={`lg-row${isSelected ? " selected" : ""}${isAlt ? " alt" : ""}`} onClick={onClick}>
      <div onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="lg-row-check" checked={isChecked} onChange={() => onCheck(r.je_number)} />
      </div>
      <div className="lg-cell-date">{formatDate(r.je_date)}</div>
      <div className="lg-cell-no">{r.je_number}</div>
      <div className="je-desc-cell">
        <div className="je-desc-memo">
          {r.memo}
          {r.self_approved && <span className="je-self-chip" title="Prepared and posted by the same person (Self-posting)">Self-posted</span>}
          {r.system_posted && <span className="je-sys-chip" title="Posted automatically on its scheduled date — nobody clicked Post">Auto-posted</span>}
          {stale && <span className="je-stale-chip" title="Its posting date is in a closed period — send it back to be re-dated">Period closed — re-date to post</span>}
        </div>
        {r.status === "scheduled" && r.schedule && (
          <div className={`je-desc-sched${r.schedule.due ? " due" : ""}`}>
            {r.schedule.due
              ? `Due — was to post on ${formatDate(r.schedule.postsOn)}`
              : `Posts itself on ${formatDate(r.schedule.postsOn)}`}
            {" · "}{r.schedule.source}
          </div>
        )}
      </div>
      <div className="je-src-cell">
        <span className={`je-src je-src-${entrySource(r)}`}>{JE_SOURCE_LABEL[entrySource(r)]}</span>
      </div>
      <div className="lg-cell-total">
        {r.debit > 0 ? <><span className="lg-cell-total-rp">Rp</span>{fmtRp(r.debit)}</> : <span className="lg-cell-em-dash">—</span>}
      </div>
      <div className="lg-cell-total">
        {r.credit > 0 ? <><span className="lg-cell-total-rp">Rp</span>{fmtRp(r.credit)}</> : <span className="lg-cell-em-dash">—</span>}
      </div>
      <div>
        <span className={`badge badge-${STATUS_BADGE_CLASS[r.status]}`}>
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
  // The approval queue's default (PRD US-CL04): biggest financial risk first,
  // then the longest-waiting — deliberately not chronological.
  "risk":        "Largest first, then oldest",
  "date-desc":   "Newest date ↓",
  "date-asc":    "Date oldest ↑",
  "ref-asc":     "Reference A-Z",
  "ref-desc":    "Reference Z-A",
  "debit-desc":  "Debit highest ↓",
  "debit-asc":   "Debit lowest ↑",
  "lines-desc":  "Most lines ↓",
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

function FilterPopover({ values, onChange, onClose, creators = [] }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [draft, setDraft] = useState(values);

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleSource = (k) => setDraft((d) => {
    const next = new Set(d.sources);
    next.has(k) ? next.delete(k) : next.add(k);
    return { ...d, sources: next };
  });
  const toggleCreator = (c) => setDraft((d) => {
    const next = new Set(d.creators);
    next.has(c) ? next.delete(c) : next.add(c);
    return { ...d, creators: next };
  });
  const reset = () => setDraft({ sources: new Set(), creators: new Set(), minAmt: "", maxAmt: "", dateFrom: "", dateTo: "" });
  const apply = () => { onChange(draft); onClose(); };

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Source ({draft.sources.size > 0 ? `${draft.sources.size} selected` : "all"})</div>
          <div className="lg-toggle-row">
            {JE_SOURCES.map((src) => (
              <button key={src.key} className={`lg-toggle${draft.sources.has(src.key) ? " on" : ""}`} onClick={() => toggleSource(src.key)}>{src.label}</button>
            ))}
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Dibuat oleh ({draft.creators.size > 0 ? `${draft.creators.size} selected` : "semua"})</div>
          <div className="lg-toggle-row">
            {creators.map((c) => (
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
    pendingDraft,
  } = useJournalEntries();
  const { hasLevel } = useCurrentUser();
  const canApprove = hasLevel("gl", "approve+post");
  const canTransact = hasLevel("gl", "transact");
  const insightsRole = canApprove ? "operator" : canTransact ? "preparer" : "viewer";
  const navigate = useNavigate();
  const allRows = useJournalRows();
  const { closedThrough } = useClosePeriod();
  // "Created by" choices: the people who actually prepared entries, most
  // entries first — not a fixed list that drifts from the data.
  const creatorOptions = useMemo(() => {
    const n = new Map();
    for (const r of allRows) if (r.created_by && r.status !== "scheduled") n.set(r.created_by, (n.get(r.created_by) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  }, [allRows]);

  const [searchParams] = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get("tab");
    const valid = ["semua", "scheduled", "pending", "draft", "posted"];
    return t && valid.includes(t) ? t : "semua";
  })();
  const [filter, setFilter] = useState({ kind: "tab", value: initialTab });

  // Respond to deep-link tab changes (e.g. navigating from Close → JE with ?tab=pending)
  useEffect(() => {
    const t = searchParams.get("tab");
    const valid = ["semua", "scheduled", "pending", "draft", "posted"];
    if (t && valid.includes(t)) setFilter({ kind: "tab", value: t });
  }, [searchParams]);
  const [sortChoice, setSortChoice] = useState(null);
  const emptyFilters = { sources: new Set(), creators: new Set(), minAmt: "", maxAmt: "", dateFrom: "", dateTo: "" };
  const [filterValues, setFilterValues] = useState(emptyFilters);

  // Klay command bar state
  const [klayQuery, setKlayQuery] = useState("");
  const [klayFilters, setKlayFilters] = useState({});
  const [klayAction, setKlayAction] = useState(null); // { query } when action modal open
  const [highlightedRef, setHighlightedRef] = useState(null);
  const klayInputRef = useRef(null);

  // Bank-reconciliation strip + review modal
  const [reconDismissed, setReconDismissed] = useState(false);
  const [reconReviewOpen, setReconReviewOpen] = useState(false);
  function onReconItemAction(action, item) {
    if (action === "match") showToast(`${item.id} matched — Klay will learn the pattern`);
    else if (action === "skip") showToast(`${item.id} skipped for now`);
  }

  // Old deep links (?je=…&line=…, from a bill's Payment tab) open the entry's
  // own page.
  const { state: arrivedState } = useLocation();
  useEffect(() => {
    const je = searchParams.get("je");
    if (!je) return;
    const line = searchParams.get("line");
    navigate(`/journal-entry/${encodeURIComponent(je)}${line != null ? `?line=${line}` : ""}`, { replace: true, state: arrivedState });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [checked, setChecked] = useState(() => new Set());
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  const [sortPopOpen, setSortPopOpen] = useState(false);
  const [filterPopOpen, setFilterPopOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const { journalTemplates } = useAccountingSettings();

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

  // New and edit open the full-page form (pages/JournalEntryFormPage.jsx),
  // which saves and comes back to the entry here with a toast.
  // `templateId` opens it already filled from that journal template.
  function openDraft(seedMemo = "", templateId = "") {
    setKlayAction(null);
    setTemplateMenuOpen(false);
    navigate("/journal-entry/new", { state: { memo: seedMemo, templateId, fromTab: filter.kind === "tab" ? filter.value : null } });
  }

  // A stock adjustment (or other page) can stage a pre-filled draft, then route
  // here — the form opens seeded with its lines for review + post.
  useEffect(() => {
    if (pendingDraft) navigate("/journal-entry/new");
  }, [pendingDraft, navigate]);

  // The form's result, carried back on navigation state, once.
  const location = useLocation();
  useEffect(() => {
    const msg = location.state?.toast;
    if (!msg) return;
    showToast(msg);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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
      case "drafts":         selectTab("draft"); break;
      case "pending":
      case "largestPending": selectTab("pending"); break;
      case "balanced":
      case "unbalanced":
      case "largestPosted":  selectTab("posted"); break;
      // Voided entries have no tab of their own; they sit in All.
      case "voids":          selectTab("semua"); break;
      default:               askAi(task.question);
    }
  }

  // ── KPIs ───────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { posted: 0, draft: 0, pending: 0, void: 0, scheduled: 0, deleted: 0 };
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
    scheduled: counts.scheduled,
    pending: counts.pending,
    draft:   counts.draft,
    posted:  counts.posted,
  }), [allRows, counts]);
  const tabs = [
    { k: "semua",   lbl: "All",     count: tabCounts.semua },
    { k: "scheduled", lbl: "Scheduled", count: tabCounts.scheduled },
    { k: "pending", lbl: "Pending", count: tabCounts.pending },
    { k: "draft",   lbl: "Draft",   count: tabCounts.draft },
    { k: "posted",  lbl: "Posted",  count: tabCounts.posted },
    // Void and deleted entries have no tab of their own; they sit in All.
  ];

  // ── Corpus ─────────────────────────────────────────────────────────────
  const corpus = useMemo(() => {
    let list = allRows;
    if (filter.kind === "tab" && filter.value !== "semua") list = list.filter((r) => r.status === filter.value);
    return list;
  }, [allRows, filter]);

  const klayFilterKeys = useMemo(() => Object.keys(klayFilters), [klayFilters]);

  const hasActiveFilters = useMemo(() => (
    filterValues.sources.size > 0 ||
    filterValues.creators.size > 0 ||
    filterValues.minAmt !== "" ||
    filterValues.maxAmt !== "" ||
    filterValues.dateFrom !== "" ||
    filterValues.dateTo !== "" ||
    klayFilterKeys.length > 0 ||
    sortChoice !== null
  ), [filterValues, klayFilterKeys, sortChoice]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.sources.size > 0) n++;
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
    if (filterValues.sources.size > 0) {
      const list = JE_SOURCES.filter((src) => filterValues.sources.has(src.key)).map((src) => src.label).join(", ");
      chips.push({ id: "manual:sources", source: "manual", key: "sources", label: `Source: ${list}` });
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
    if (filterValues.sources.size > 0) list = list.filter((r) => filterValues.sources.has(entrySource(r)));
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

  // ── Sort ───────────────────────────────────────────────────────────────
  const effectiveSort = sortChoice || (filter.kind === "tab" && filter.value === "pending" ? "risk" : "date-desc");

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    const cmpBy = (a, b) => {
      switch (effectiveSort) {
        case "risk":       return (b.debit - a.debit) || (a.je_date || "").localeCompare(b.je_date || "");
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
    arr.sort(cmpBy);
    return arr;
  }, [filteredRows, effectiveSort]);


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
      if (chip.key === "sources") setFilterValues((v) => ({ ...v, sources: new Set() }));
      else if (chip.key === "creators") setFilterValues((v) => ({ ...v, creators: new Set() }));
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
    const headers = ["Journal No.", "Posting date", "Memo", "Source", "Status", "Lines", "Debit", "Credit", "Dibuat oleh"];
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of rowsToExport) {
      lines.push([r.je_number, r.je_date, r.memo, JE_SOURCE_LABEL[entrySource(r)], r.status, r.lines.length, r.debit, r.credit, r.created_by].map(esc).join(","));
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
  // Actions and their dialogs are shared with the detail page
  // (pages/journalEntryShared.jsx); a row's "View detail" opens that page.
  const { actionsFor, runAction, bulk, openEntry, dialogs } = useJournalActions({
    showToast,
    fromTab: filter.kind === "tab" ? filter.value : null,
  });
  function onRowAction(action, row) {
    setMenuOpenFor(null);
    if (action === "view") { openEntry(row.je_number); return; }
    runAction(action, row);
  }
  function onBulk(action) {
    bulk(action, [...checked]);
    clearChecks();
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
              {/* Split button: the main part opens a blank journal; the caret
                  starts one from a journal template. */}
              <div className="jtm-split">
                <button
                  className={`lg-btn-brand${canTransact && journalTemplates.length ? " jtm-split-main" : ""}`}
                  disabled={!canTransact}
                  title={canTransact ? "Draft a new manual journal" : "Your role can view journals but not draft them"}
                  onClick={() => canTransact && openDraft()}
                >
                  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Manual Journal
                </button>
                {canTransact && journalTemplates.length > 0 && (
                  <button
                    className="lg-btn-brand jtm-split-caret"
                    title="Start from a template"
                    aria-label="Start from a template"
                    aria-haspopup="dialog"
                    aria-expanded={templateMenuOpen}
                    onClick={() => setTemplateMenuOpen((o) => !o)}
                  >
                    <svg viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" /></svg>
                  </button>
                )}
                {templateMenuOpen && (
                  <JournalTemplateMenu
                    templates={journalTemplates}
                    onPick={(id) => openDraft("", id)}
                    onClose={() => setTemplateMenuOpen(false)}
                  />
                )}
              </div>
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
                  <button className={`lg-meta-btn${activeFilterCount > 0 ? " active" : ""}`} onClick={() => { setFilterPopOpen(!filterPopOpen); setSortPopOpen(false); }}>
                    <svg viewBox="0 0 12 12"><path d="M2 3h8M3 6h6M4 9h4" strokeLinecap="round"/></svg>
                    Filter
                    {activeFilterCount > 0 && <span className="lg-filter-badge">{activeFilterCount}</span>}
                  </button>
                  {filterPopOpen && <FilterPopover values={filterValues} creators={creatorOptions} onChange={setFilterValues} onClose={() => setFilterPopOpen(false)} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => { setSortPopOpen(!sortPopOpen); setFilterPopOpen(false); }}>
                    <span className="meta-lbl">Sort:</span>
                    <span className="meta-val">{SORT_LABELS[effectiveSort]}</span>
                  </button>
                  {sortPopOpen && <SortPopover value={effectiveSort} onPick={(v) => { setSortChoice(v); setSortPopOpen(false); }} onClose={() => setSortPopOpen(false)} />}
                </div>
                {hasActiveFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            <div className="lg-col-header">
              <div><input type="checkbox" className="lg-row-check" disabled /></div>
              <div title="Posting date — the day the entry hits the ledger">Posting date</div>
              <div>Reference</div>
              <div>Description</div>
              <div>Source</div>
              <div style={{ textAlign: "right" }}>Debit (Rp)</div>
              <div style={{ textAlign: "right" }}>Credit (Rp)</div>
              <div>Status</div>
              <div />
            </div>

            <div>
              {sortedRows.length === 0 && <div className="lg-empty">None journals matching</div>}
              {sortedRows.map((r, i) => (
                <div key={r.je_number} data-je-row={r.je_number} style={{ position: "relative" }}>
                  <JeRow
                    r={r}
                    isChecked={checked.has(r.je_number)}
                    onCheck={toggleRow}
                    onClick={() => openEntry(r.je_number)}
                    onKebab={(id) => setMenuOpenFor(menuOpenFor === id ? null : id)}
                    isSelected={highlightedRef === r.je_number}
                    isAlt={i % 2 === 1}
                    closedThrough={closedThrough}
                  />
                  {menuOpenFor === r.je_number && (
                    <div style={{ position: "absolute", right: 32, top: 32, zIndex: 5 }}>
                      <RowMenu je={r} actions={actionsFor(r)} onClose={() => setMenuOpenFor(null)} onAction={onRowAction} />
                    </div>
                  )}
                </div>
              ))}
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

      {dialogs}

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
