import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { periodPresets, rangeLabel, monthLabel } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import {
  computeTrialBalance, ledgerBalance, unpostedInPeriod, periodCloseState,
} from "../lib/trialBalance";
import "./modules.css";
import "./invoices-ledger.css";
import "./trial-balance.css";

const TYPE_LABELS = {
  asset: "Assets",
  contra_asset: "Contra Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  contra_revenue: "Contra Revenue",
  expense: "Expenses",
};
// Singular, for the export's Type column.
const TYPE_NAMES = {
  asset: "Asset",
  contra_asset: "Contra asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  contra_revenue: "Contra revenue",
  expense: "Expense",
};
const TYPE_ORDER = ["asset", "contra_asset", "liability", "equity", "revenue", "contra_revenue", "expense"];
const TABS = [
  { k: "all",        lbl: "All",          types: TYPE_ORDER },
  { k: "asset",      lbl: "Assets",       types: ["asset", "contra_asset"] },
  { k: "liability",  lbl: "Liabilities",  types: ["liability"] },
  { k: "equity",     lbl: "Equity",       types: ["equity"] },
  { k: "revenue",    lbl: "Revenue",      types: ["revenue", "contra_revenue"] },
  { k: "expense",    lbl: "Expenses",     types: ["expense"] },
];
const TYPE_BADGE_CLS = {
  asset: "approved",
  contra_asset: "draft",
  liability: "rejected",
  equity: "review",
  revenue: "approved",
  contra_revenue: "draft",
  expense: "draft",
};

const REVIEW_ICON = <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const GL_ICON = <svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>;

const rp = (v) => {
  if (v === 0 || v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  return (v < 0 ? "(" : "") + "Rp " + abs.toLocaleString("id-ID") + (v < 0 ? ")" : "");
};
const fmtIdDate = (s) =>
  new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Column totals for a set of rows (a type group, or everything shown).
const sumRows = (rows) => ({
  sumOpen:   rows.reduce((s, r) => s + r.opening_balance, 0),
  sumDebit:  rows.reduce((s, r) => s + r.period_debit, 0),
  sumCredit: rows.reduce((s, r) => s + r.period_credit, 0),
  sumEndDr:  rows.reduce((s, r) => s + r.ending_dr, 0),
  sumEndCr:  rows.reduce((s, r) => s + r.ending_cr, 0),
});

// Drawer lists grow in pages of this many lines.
const PAGE = 50;

// ── Review checks ─────────────────────────────────────────────────────────
// The checks an accountant runs on a trial balance, built from the chart's own
// metadata (type, normal balance, name, active flag) so they hold for any
// company's chart — no account codes or amounts are hard-coded.
//   wrong side  An account ending on the opposite side to its normal balance:
//               an overdrawn bank, a contra-asset with a debit balance, a
//               payable with a debit balance. Equity is left out — a deficit in
//               retained earnings is a result, not a posting error.
//   clearing    A clearing or suspense account that isn't back at zero.
//   inactive    An inactive account still carrying a balance.
const CLEARING = /clearing|suspense/i;

function reviewChecks(tb) {
  const out = [];
  tb.forEach((r) => {
    const normal = r.normal_balance;
    const other = normal === "debit" ? "credit" : "debit";
    if (r.closing_balance < 0 && r.type !== "equity") {
      out.push({
        code: r.code,
        title: `Ending on the ${other} side`,
        desc: `${r.name} ends with a ${other} balance of ${rp(-r.closing_balance)}; as ${/^[aeiou]/i.test(TYPE_NAMES[r.type]) ? "an" : "a"} ${TYPE_NAMES[r.type].toLowerCase()} account it normally carries a ${normal} balance.`,
        action: "Look through the period's journal lines for a reversed, duplicated or misposted entry.",
      });
    }
    if (CLEARING.test(r.name) && r.closing_balance !== 0) {
      out.push({
        code: r.code,
        title: "Clearing account not at zero",
        desc: `${r.name} still holds ${rp(Math.abs(r.closing_balance))}. A clearing account should empty once each item is moved to where it belongs.`,
        action: "Clear the open items before closing the period.",
      });
    }
    if (!r.is_active && r.closing_balance !== 0) {
      out.push({
        code: r.code,
        title: "Inactive account with a balance",
        desc: `${r.name} is inactive but ends at ${rp(Math.abs(r.closing_balance))}.`,
        action: "Move the balance to an active account, or reactivate this one.",
      });
    }
  });
  return out;
}

// ── UI helpers ────────────────────────────────────────────────────────────

const SORT_LABELS = {
  "code-asc":     "Code A-Z",
  "code-desc":    "Code Z-A",
  "name-asc":     "Name A-Z",
  "close-desc":   "Ending balance ↓",
  "close-asc":    "Ending balance ↑",
  "debit-desc":   "Period debit ↓",
  "credit-desc":  "Period credit ↓",
};
const GROUP_LABELS = {
  "type":  "Account Type",
  "none":  "—",
};

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

const Check = () => <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>;

function SortPopover({ value, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        {Object.entries(SORT_LABELS).map(([k, lbl]) => (
          <button key={k} className={`lg-popover-item${value === k ? " selected" : ""}`} onClick={() => onPick(k)}>
            {lbl}
            {value === k && <Check />}
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
    { k: "type", lbl: "Account Type (default)" },
    { k: "none", lbl: "Not grouped" },
  ];
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        {items.map((it) => (
          <button key={it.k} className={`lg-popover-item${value === it.k ? " selected" : ""}`} onClick={() => onPick(it.k)}>
            {it.lbl}
            {value === it.k && <Check />}
          </button>
        ))}
      </div>
    </div>
  );
}

// Period picker — the shared report presets, plus a custom from/to range.
function PeriodPopover({ presets, period, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const invalid = !from || !to || from > to;
  return (
    <div className="lg-popover lg-filter-pop tb-period-pop" ref={ref}>
      <div className="lg-popover-list">
        {presets.map((p) => (
          <button key={p.key} className={`lg-popover-item${period.key === p.key ? " selected" : ""}`} onClick={() => onPick({ key: p.key })}>
            <span>{p.label}</span>
            <span className="tb-period-range">{rangeLabel(p.from, p.to)}{period.key === p.key && <Check />}</span>
          </button>
        ))}
      </div>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Custom range</div>
          <div className="lg-filter-row2">
            <input type="date" className="lg-filter-input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>—</span>
            <input type="date" className="lg-filter-input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          {from && to && from > to && <div className="tb-period-err">The start date is after the end date.</div>}
        </div>
      </div>
      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={onClose}>Cancel</button>
        <button className="lg-filter-apply" disabled={invalid} onClick={() => onPick({ key: "custom", from, to })}>Apply range</button>
      </div>
    </div>
  );
}

function ExportPopover({ onCsv, onPrint, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        <button className="lg-popover-item" onClick={onCsv}>Excel (CSV)</button>
        <button className="lg-popover-item" onClick={onPrint}>Print / PDF</button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

// Opens on last month — the month being closed. The ending balances are the
// same for any range ending on that date; only the activity columns change.
const DEFAULT_PERIOD = { key: "last_month" };

export default function TrialBalancePage() {
  const navigate = useNavigate();
  const { fiscalYearStart } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState({ kind: "tab", value: "all" });
  const [sortChoice, setSortChoice] = useState(null);
  const [groupChoice, setGroupChoice] = useState(null);
  // { key } for a preset, or { key: "custom", from, to }.
  const [periodChoice, setPeriodChoice] = useState(DEFAULT_PERIOD);
  const [showZero, setShowZero] = useState(false);

  const [drawerCode, setDrawerCode] = useState(null);
  const [drawerTab, setDrawerTab] = useState("detail");
  const [drawerLimit, setDrawerLimit] = useState(PAGE);

  const [sortPopOpen, setSortPopOpen] = useState(false);
  const [groupPopOpen, setGroupPopOpen] = useState(false);
  const [periodPopOpen, setPeriodPopOpen] = useState(false);
  const [exportPopOpen, setExportPopOpen] = useState(false);

  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1800);
  }

  // ── Period ──
  const presets = useMemo(() => periodPresets({ fiscalYearStart }), [fiscalYearStart]);
  const period = useMemo(() => {
    if (periodChoice.key === "custom") return { ...periodChoice, label: "Custom" };
    const p = presets.find((x) => x.key === periodChoice.key) || presets.find((x) => x.key === "ytd");
    return { key: p.key, from: p.from, to: p.to, label: p.label };
  }, [periodChoice, presets]);
  const { from: dateFrom, to: dateTo } = period;
  const periodRange = rangeLabel(dateFrom, dateTo);
  const periodEndYm = dateTo.slice(0, 7);

  // ── Numbers ──
  const { entries: JOURNAL_ENTRIES } = useJournalEntries();
  const ALL_TB = useMemo(
    () => computeTrialBalance({ from: dateFrom, to: dateTo, entries: JOURNAL_ENTRIES, fiscalYearStart }),
    [dateFrom, dateTo, JOURNAL_ENTRIES, fiscalYearStart],
  );
  const balance = useMemo(() => ledgerBalance(ALL_TB), [ALL_TB]);
  const findings = useMemo(() => reviewChecks(ALL_TB), [ALL_TB]);
  const findingsByCode = useMemo(() => {
    const m = {};
    findings.forEach((f) => { (m[f.code] ||= []).push(f); });
    return m;
  }, [findings]);
  const flaggedCount = Object.keys(findingsByCode).length;

  // Period status: closed / open, and what isn't in the numbers yet.
  const closeState = periodCloseState(dateFrom, dateTo, closedThrough);
  const unposted = useMemo(() => unpostedInPeriod(JOURNAL_ENTRIES, dateFrom, dateTo), [JOURNAL_ENTRIES, dateFrom, dateTo]);

  // Summary — does the ledger foot, and what needs a look.
  const kpis = [
    { lbl: "Total debits",  card: null,     val: rp(balance.dr), sub: "Ending debit balances" },
    { lbl: "Total credits", card: null,     val: rp(balance.cr), sub: "Ending credit balances" },
    { lbl: "Difference",    card: null,     val: balance.balanced ? "Rp 0" : rp(balance.variance), sub: balance.balanced ? "Debits equal credits" : "Out of balance", tone: balance.balanced ? "ok" : "danger" },
    { lbl: "Needs review",  card: flaggedCount > 0 ? "review" : null,val: String(flaggedCount), sub: flaggedCount > 0 ? plural(flaggedCount, "account") + " flagged" : "Nothing flagged", tone: flaggedCount > 0 ? "warn" : null },
  ];

  // Zero-balance accounts (no opening, no movement, no closing) are hidden
  // unless asked for; tab counts follow what the table can show.
  const baseRows = useMemo(() => (showZero ? ALL_TB : ALL_TB.filter((r) => r.has_activity)), [ALL_TB, showZero]);

  // Tabs by type chip
  const tabs = TABS.map((t) => ({ ...t, count: baseRows.filter((r) => t.types.includes(r.type)).length }));

  // Corpus
  const corpus = useMemo(() => {
    let list = baseRows;
    if (filter.kind === "tab" && filter.value !== "all") {
      const types = TABS.find((t) => t.k === filter.value)?.types || [];
      list = list.filter((r) => types.includes(r.type));
    } else if (filter.kind === "card") {
      const codes = new Set(findings.map((f) => f.code));
      // A flagged account stays visible even if it would otherwise be hidden as zero.
      list = ALL_TB.filter((r) => codes.has(r.code));
    }
    return list;
  }, [filter, findings, baseRows, ALL_TB]);

  const hasActiveFilters = (
    periodChoice.key !== DEFAULT_PERIOD.key ||
    showZero ||
    sortChoice !== null ||
    groupChoice !== null ||
    search.trim() !== ""
  );

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return corpus;
    return corpus.filter((r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [corpus, search]);

  const effectiveSort = sortChoice || "code-asc";
  const effectiveGroup = groupChoice || "type";

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    switch (effectiveSort) {
      case "code-asc":    arr.sort((a, b) => a.code.localeCompare(b.code)); break;
      case "code-desc":   arr.sort((a, b) => b.code.localeCompare(a.code)); break;
      case "name-asc":    arr.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "close-desc":  arr.sort((a, b) => b.closing_balance - a.closing_balance); break;
      case "close-asc":   arr.sort((a, b) => a.closing_balance - b.closing_balance); break;
      case "debit-desc":  arr.sort((a, b) => b.period_debit - a.period_debit); break;
      case "credit-desc": arr.sort((a, b) => b.period_credit - a.period_credit); break;
      default: break;
    }
    return arr;
  }, [filteredRows, effectiveSort]);

  // Totals of exactly the rows on screen (tab, search, zero toggle applied).
  const shownTotals = useMemo(() => sumRows(sortedRows), [sortedRows]);

  const groups = useMemo(() => {
    if (effectiveGroup === "none") return null;
    const map = new Map();
    TYPE_ORDER.forEach((t) => map.set(t, []));
    sortedRows.forEach((r) => { (map.get(r.type) || map.set(r.type, []).get(r.type)).push(r); });
    return Array.from(map.entries())
      .filter(([, rows]) => rows.length > 0)
      .map(([t, rows]) => ({ key: t, label: TYPE_LABELS[t] || t, rows, ...sumRows(rows) }));
  }, [effectiveGroup, sortedRows]);

  function selectTab(t) { setFilter({ kind: "tab", value: t }); }
  function selectCard(c) {
    if (!c) { setFilter({ kind: "tab", value: "all" }); return; }
    setFilter({ kind: "card", value: c });
  }
  const isTabActive  = (t) => filter.kind === "tab" && filter.value === t;
  const isCardActive = (c) => filter.kind === "card" && filter.value === c;

  function resetAll() {
    setSortChoice(null);
    setGroupChoice(null);
    setPeriodChoice(DEFAULT_PERIOD);
    setShowZero(false);
    setSearch("");
    setFilter({ kind: "tab", value: "all" });
  }

  function toggleGroup(key) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function closePops() {
    setSortPopOpen(false); setGroupPopOpen(false); setPeriodPopOpen(false); setExportPopOpen(false);
  }

  function pickPeriod(choice) {
    setPeriodChoice(choice);
    setPeriodPopOpen(false);
  }

  // ── Drill-down ──
  function openDrawer(code) {
    setDrawerCode(code);
    setDrawerTab("detail");
    setDrawerLimit(PAGE);
  }
  const openGl = (code) => navigate(`/general-ledger?account=${encodeURIComponent(code)}&period=${periodEndYm}`);
  const openJe = (jeNumber) => navigate(`/journal-entry?je=${encodeURIComponent(jeNumber)}`);

  // ── Export ──
  function exportCsv() {
    setExportPopOpen(false);
    const totalRow = {
      code: "", name: `Total — ${plural(sortedRows.length, "account")}`, type: null,
      opening_balance: null, period_debit: shownTotals.sumDebit, period_credit: shownTotals.sumCredit,
      ending_dr: shownTotals.sumEndDr, ending_cr: shownTotals.sumEndCr,
    };
    downloadCsv(exportName("trial-balance", dateFrom, dateTo), {
      header: reportHeader({ report: "Trial Balance", period: periodRange, runBy: user?.name }),
      columns: [
        { label: "Code",      value: (r) => r.code },
        { label: "Account",   value: (r) => r.name },
        { label: "Type",      value: (r) => TYPE_NAMES[r.type] || "" },
        { label: "Opening",   value: (r) => r.opening_balance },
        { label: "Debit",     value: (r) => r.period_debit },
        { label: "Credit",    value: (r) => r.period_credit },
        { label: "Ending Dr", value: (r) => r.ending_dr },
        { label: "Ending Cr", value: (r) => r.ending_cr },
      ],
      rows: [...sortedRows, totalRow],
    });
    showToast(`${plural(sortedRows.length, "account")} exported to CSV`);
  }
  function exportPrint() {
    setExportPopOpen(false);
    // Let the menu close before the print dialog snapshots the page.
    setTimeout(printReport, 50);
  }

  // Drawer data
  const drawerRow = drawerCode ? ALL_TB.find((r) => r.code === drawerCode) : null;
  const drawerFindings = drawerCode ? (findingsByCode[drawerCode] || []) : [];
  const drawerLines = drawerRow ? drawerRow.entries.slice(0, drawerLimit) : [];
  const drawerMore = drawerRow ? drawerRow.entries.length - drawerLines.length : 0;

  const ShowMore = () => (drawerMore > 0 ? (
    <button className="tb-show-more" onClick={() => setDrawerLimit((n) => n + PAGE)}>
      Show {Math.min(PAGE, drawerMore)} more · {drawerMore} remaining
    </button>
  ) : null);

  const amt = (v, color) => (v ? <span style={color ? { color } : undefined}>{rp(v)}</span> : <span className="lg-cell-em-dash">—</span>);

  // Render a TB row
  function TbRow({ r, isAlt }) {
    const flags = findingsByCode[r.code] || [];
    const tint = flags.length ? " anomaly-warn" : "";
    return (
      <div className={`lg-row${isAlt ? " alt" : ""}${tint}${drawerCode === r.code ? " selected" : ""}`} onClick={() => openDrawer(r.code)}>
        <div className="lg-cell-no">{r.code}</div>
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-primary)", fontWeight: 500 }}>{r.name}</span>
          <span className={`badge badge-${TYPE_BADGE_CLS[r.type]}`} style={{ fontSize: 9 }}>{TYPE_LABELS[r.type]}</span>
          {flags.length > 0 && (
            <span className="lg-anom-flag warn" title={flags.map((f) => f.title).join(" · ")}>
              {REVIEW_ICON}
              {flags.length > 1 ? `${flags.length} checks` : "Review"}
            </span>
          )}
        </div>
        <div className="lg-cell-total" style={{ color: "var(--color-text-tertiary)" }}>{rp(r.opening_balance)}</div>
        <div className="lg-cell-total">{amt(r.period_debit, "var(--color-action)")}</div>
        <div className="lg-cell-total">{amt(r.period_credit, "var(--color-success-text)")}</div>
        <div className="lg-cell-total tb-cell-end">{amt(r.ending_dr)}</div>
        <div className="lg-cell-total tb-cell-end">{amt(r.ending_cr)}</div>
        <div className="lg-cell-kebab no-print" onClick={(e) => e.stopPropagation()}>
          <button className="lg-kebab tb-gl-btn" title="View in General Ledger" aria-label={`View ${r.code} in General Ledger`} onClick={() => openGl(r.code)}>
            {GL_ICON}
          </button>
        </div>
      </div>
    );
  }

  const closedLabel = closedThrough ? monthLabel(`${closedThrough}-01`) : null;
  const unpostedParts = [
    unposted.drafts ? plural(unposted.drafts, "draft") : null,
    unposted.pending ? plural(unposted.pending, "journal awaiting approval", "journals awaiting approval") : null,
  ].filter(Boolean);

  return (
    <div className="lg-page tb-report">
      <div className="lg-scroll-container">
        {/* ── Print header (print / PDF only) ───────────────────────── */}
        <div className="print-only tb-print-head">
          <div className="tb-print-company">{COMPANY.legalName}</div>
          <div className="tb-print-title">Trial Balance</div>
          <div className="tb-print-period">{periodRange} · {balance.balanced ? "In balance" : `Out of balance by ${rp(balance.variance)}`}</div>
        </div>

        {/* ── Editorial header ──────────────────────────────────────── */}
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Trial Balance</h1>
            </div>
            <div className="lg-head-actions no-print">
              <div className="lg-meta-btn-wrap">
                <button className="lg-btn-ghost" onClick={() => { const o = !periodPopOpen; closePops(); setPeriodPopOpen(o); }} aria-haspopup="dialog" aria-expanded={periodPopOpen}>
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  {period.label} · {periodRange}
                </button>
                {periodPopOpen && <PeriodPopover presets={presets} period={period} onPick={pickPeriod} onClose={() => setPeriodPopOpen(false)} />}
              </div>
              <div className="lg-meta-btn-wrap">
                <button className="lg-btn-brand" onClick={() => { const o = !exportPopOpen; closePops(); setExportPopOpen(o); }} aria-haspopup="menu" aria-expanded={exportPopOpen}>
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export
                </button>
                {exportPopOpen && <ExportPopover onCsv={exportCsv} onPrint={exportPrint} onClose={() => setExportPopOpen(false)} />}
              </div>
            </div>
          </div>

          {/* Period status — closed or open, and what isn't posted yet */}
          <div className="tb-status">
            <span className={`tb-status-chip ${closeState}`}>
              {closeState === "closed" ? "Closed period" : closeState === "partial" ? "Partly closed" : "Open period"}
            </span>
            <span>
              {closeState === "closed" && `Books are closed through ${closedLabel} — these figures are final.`}
              {closeState === "partial" && `Closed through ${closedLabel}; later months are still open and may change.`}
              {closeState === "open" && "This period is still open — figures may change as journals are posted."}
            </span>
            {unpostedParts.length > 0 && (
              <>
                <span className="tb-status-sep">·</span>
                <button className="tb-status-link no-print" onClick={() => navigate("/journal-entry")}>
                  {unpostedParts.join(" and ")} dated in this period {unposted.drafts + unposted.pending === 1 ? "isn't" : "aren't"} included
                </button>
                <span className="print-only">{unpostedParts.join(" and ")} dated in this period {unposted.drafts + unposted.pending === 1 ? "isn't" : "aren't"} included</span>
              </>
            )}
          </div>

          <div className="lg-kpi-strip no-print">
            {kpis.map((k) => (
              <button
                type="button"
                className={`lg-kpi-cell${k.card && isCardActive(k.card) ? " active" : ""}`}
                key={k.lbl}
                onClick={() => k.card && selectCard(isCardActive(k.card) ? null : k.card)}
                aria-pressed={k.card ? isCardActive(k.card) : false}
                style={!k.card ? { cursor: "default" } : undefined}
                title={k.lbl === "Needs review" ?"Accounts ending on the wrong side of their normal balance, clearing accounts not at zero, and inactive accounts with a balance." : undefined}
              >
                <div className="lg-kpi-lbl">{k.lbl}</div>
                <div className={`lg-kpi-val${k.tone ? ` ${k.tone}` : ""}`}>{k.val}</div>
                <div className="lg-kpi-sub">{k.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Table card ── */}
        <div className="lg-table-wrap">
          <div className="lg-card lg-table-tb">
            <div className="lg-pills-row no-print">
              {tabs.map((t) => (
                <button key={t.k} className={`lg-pill${isTabActive(t.k) ? " active" : ""}`} onClick={() => selectTab(t.k)}>
                  {t.lbl}
                  <span className="lg-pill-count">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row no-print">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input placeholder="Search account code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta">
                <button className={`lg-toggle${showZero ? " on" : ""}`} onClick={() => setShowZero((v) => !v)} aria-pressed={showZero}>
                  Show zero balances
                </button>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => { const o = !sortPopOpen; closePops(); setSortPopOpen(o); }}>
                    <span className="meta-lbl">Sort:</span>
                    <span className="meta-val">{SORT_LABELS[effectiveSort]}</span>
                  </button>
                  {sortPopOpen && <SortPopover value={effectiveSort} onPick={(v) => { setSortChoice(v); setSortPopOpen(false); }} onClose={() => setSortPopOpen(false)} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => { const o = !groupPopOpen; closePops(); setGroupPopOpen(o); }}>
                    <span className="meta-lbl">Group:</span>
                    <span className="meta-val">{GROUP_LABELS[effectiveGroup]}</span>
                  </button>
                  {groupPopOpen && <GroupPopover value={effectiveGroup} onPick={(v) => { setGroupChoice(v); setGroupPopOpen(false); }} onClose={() => setGroupPopOpen(false)} />}
                </div>
                {hasActiveFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            <div className="lg-col-header">
              <div>Code</div>
              <div>Account Name</div>
              <div style={{ textAlign: "right" }}>Opening</div>
              <div style={{ textAlign: "right" }}>Debit</div>
              <div style={{ textAlign: "right" }}>Credit</div>
              <div style={{ textAlign: "right" }}>Ending Dr</div>
              <div style={{ textAlign: "right" }}>Ending Cr</div>
              <div />
            </div>

            <div>
              {sortedRows.length === 0 && (
                <div className="lg-empty">
                  {!showZero && search.trim() === "" && filter.kind === "tab" ? "No accounts with a balance here. Turn on “Show zero balances” to see them all." : "No accounts match."}
                </div>
              )}
              {groups ? (
                groups.map((g) => {
                  const isCollapsed = collapsedGroups.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <div className="lg-group-head muted" onClick={() => toggleGroup(g.key)}>
                        <div className="lg-group-left">
                          <svg className={`lg-group-chevron${isCollapsed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>
                          <span className="lg-group-lbl">{g.label}</span>
                          <span className="lg-group-count">{g.rows.length}</span>
                        </div>
                      </div>
                      {!isCollapsed && g.rows.map((r, i) => (
                        <TbRow key={r.code} r={r} isAlt={i % 2 === 1} />
                      ))}
                      {!isCollapsed && (
                        <div className="lg-row subtotal">
                          <div />
                          <div className="tb-total-lbl">Subtotal {g.label}</div>
                          <div className="lg-cell-total" style={{ color: "var(--color-text-tertiary)" }}>{rp(g.sumOpen)}</div>
                          <div className="lg-cell-total" style={{ color: "var(--color-action)" }}>{rp(g.sumDebit)}</div>
                          <div className="lg-cell-total" style={{ color: "var(--color-success-text)" }}>{rp(g.sumCredit)}</div>
                          <div className="lg-cell-total tb-cell-end">{rp(g.sumEndDr)}</div>
                          <div className="lg-cell-total tb-cell-end">{rp(g.sumEndCr)}</div>
                          <div />
                        </div>
                      )}
                    </Fragment>
                  );
                })
              ) : (
                sortedRows.map((r, i) => <TbRow key={r.code} r={r} isAlt={i % 2 === 1} />)
              )}
              {sortedRows.length > 0 && (
                <div className="lg-row subtotal tb-total-row">
                  <div />
                  <div className="tb-total-lbl">Total — {plural(sortedRows.length, "account")} shown</div>
                  <div />
                  <div className="lg-cell-total">{rp(shownTotals.sumDebit)}</div>
                  <div className="lg-cell-total">{rp(shownTotals.sumCredit)}</div>
                  <div className="lg-cell-total tb-cell-end">{rp(shownTotals.sumEndDr)}</div>
                  <div className="lg-cell-total tb-cell-end">{rp(shownTotals.sumEndCr)}</div>
                  <div />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>{/* /lg-scroll-container */}

      {/* ── Sticky footer ──────────────────────────────────────────── */}
      <div className="lg-footer no-print">
        <div className="lg-footer-left">
          <span><span className="lg-footer-num">{sortedRows.length}</span> of {ALL_TB.length} accounts shown</span>
          <span className="lg-footer-sep">·</span>
          <span>All accounts: Ending Dr <span className="lg-footer-num">{rp(balance.dr)}</span></span>
          <span>Ending Cr <span className="lg-footer-num">{rp(balance.cr)}</span></span>
          <span className="lg-footer-sep">·</span>
          <span className={`tb-balance-flag${balance.balanced ? " ok" : " off"}`}>
            {balance.balanced ? "✓ In balance" : `Out of balance by ${rp(balance.variance)}`}
          </span>
        </div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Period</span>
          <span className="lg-footer-total" style={{ fontSize: 13 }}>{periodRange}</span>
        </div>
      </div>

      {/* ── Side drawer (account detail) ─────────────────────────── */}
      {drawerRow && (
        <>
          <div className="drawer-overlay" onClick={() => setDrawerCode(null)} />
          <div className="drawer">
            <div className="drawer-head">
              <div className="drawer-av invoice" style={{ fontSize: 9 }}>{drawerRow.code.slice(0, 3)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title">{drawerRow.name}</div>
                <div className="drawer-sub">
                  <span style={{ fontFamily: "var(--font-mono)" }}>{drawerRow.code}</span> ·{" "}
                  <span className={`badge badge-${TYPE_BADGE_CLS[drawerRow.type]}`}>{TYPE_LABELS[drawerRow.type]}</span>
                </div>
              </div>
              <button className="drawer-close" onClick={() => setDrawerCode(null)}>
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="drawer-tabs">
              {[["detail", "Detail"], ["transactions", "Transactions"], ["audit", "Audit Trail"], ["review", "Review"]].map(([t, label]) => (
                <div key={t} className={`drawer-tab${drawerTab === t ? " active" : ""}`} onClick={() => setDrawerTab(t)}>
                  {label}
                  {t === "review" && drawerFindings.length > 0 && (
                    <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 9999, background: "var(--color-warning-surface)", color: "var(--color-warning-text)" }}>
                      {drawerFindings.length}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="drawer-body">
              {drawerTab === "detail" && (
                <>
                  <div className="drawer-stat-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Opening Balance</div>
                      <div className="drawer-stat-val" style={{ color: "var(--color-text-tertiary)" }}>{rp(drawerRow.opening_balance)}</div>
                    </div>
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Ending Balance</div>
                      <div className={`drawer-stat-val${drawerRow.closing_balance < 0 ? " danger" : ""}`}>
                        {drawerRow.ending_dr ? `Dr ${rp(drawerRow.ending_dr)}` : drawerRow.ending_cr ? `Cr ${rp(drawerRow.ending_cr)}` : "—"}
                      </div>
                    </div>
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Period Debit</div>
                      <div className="drawer-stat-val" style={{ color: "var(--color-action)" }}>{rp(drawerRow.period_debit)}</div>
                    </div>
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Period Credit</div>
                      <div className="drawer-stat-val" style={{ color: "var(--color-success-text)" }}>{rp(drawerRow.period_credit)}</div>
                    </div>
                  </div>
                  <div className="drawer-section">
                    <div className="drawer-section-title">Account information</div>
                    {[
                      ["Code", drawerRow.code],
                      ["Name", drawerRow.name],
                      ["Type", TYPE_NAMES[drawerRow.type]],
                      ["Normal Balance", drawerRow.normal_balance === "debit" ? "Debit" : "Credit"],
                      ["Status", drawerRow.is_active ? "Active" : "Inactive"],
                    ].map(([label, value]) => (
                      <div key={label} className="drawer-row">
                        <div className="drawer-label">{label}</div>
                        <div className="drawer-value">{value}</div>
                      </div>
                    ))}
                    {drawerRow.rolled_pl !== 0 && (
                      <div className="drawer-row">
                        <div className="drawer-label">Prior-year result</div>
                        <div className="drawer-value">{rp(drawerRow.rolled_pl)} rolled into the opening balance</div>
                      </div>
                    )}
                  </div>
                  <div className="drawer-section">
                    <div className="drawer-section-title">Period</div>
                    <div className="drawer-row">
                      <div className="drawer-label">Period start</div>
                      <div className="drawer-value">{fmtIdDate(dateFrom)}</div>
                    </div>
                    <div className="drawer-row">
                      <div className="drawer-label">Period end</div>
                      <div className="drawer-value">{fmtIdDate(dateTo)}</div>
                    </div>
                    <div className="drawer-row">
                      <div className="drawer-label">Journal lines</div>
                      <div className="drawer-value">{drawerRow.entries.length}</div>
                    </div>
                  </div>
                </>
              )}
              {drawerTab === "transactions" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">Period transactions · {plural(drawerRow.entries.length, "line")}</div>
                  {drawerRow.entries.length === 0 ? (
                    <div style={{ color: "var(--color-text-tertiary)", fontSize: 12, padding: "12px 0" }}>No transactions in this period.</div>
                  ) : drawerLines.map((e) => (
                    <div key={e.key} style={{ background: "var(--color-surface-sunken)", border: "1px solid var(--color-border-default)", borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <button className="tb-je-link" onClick={() => openJe(e.je_ref)} title="Open journal entry">{e.je_ref}</button>
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{e.memo}</div>
                          {e.description && e.description !== e.memo && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{e.description}</div>}
                          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{fmtIdDate(e.date)}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          {e.debit > 0 && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700 }}>Dr {rp(e.debit)}</div>}
                          {e.credit > 0 && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--color-action)" }}>Cr {rp(e.credit)}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                  <ShowMore />
                </div>
              )}
              {drawerTab === "audit" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">Audit Trail</div>
                  {drawerRow.entries.length === 0 && (
                    <div style={{ color: "var(--color-text-tertiary)", fontSize: 12, padding: "12px 0" }}>Nothing posted to this account in this period.</div>
                  )}
                  {drawerLines.map((e, i) => (
                    <div key={e.key} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < drawerLines.length - 1 ? "1px solid var(--color-surface-sunken)" : "none" }}>
                      <div style={{ width: 18, height: 18, borderRadius: 9, background: "var(--color-surface-sunken)", border: "1px solid var(--color-border-default)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          <button className="tb-je-link" onClick={() => openJe(e.je_ref)}>{e.je_ref}</button> posted
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{e.posted_by || "—"} · {e.posted_date ? fmtIdDate(e.posted_date) : "—"}</div>
                      </div>
                    </div>
                  ))}
                  <ShowMore />
                </div>
              )}
              {drawerTab === "review" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">Review checks</div>
                  {drawerFindings.length === 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, background: "var(--color-success-surface)", border: "1px solid var(--color-success-border)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--color-success-text)" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      Nothing flagged — the balance is on its normal side.
                    </div>
                  ) : drawerFindings.map((f, i) => (
                    <div key={i} style={{ padding: 12, background: "var(--color-warning-surface)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-md)", marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>{f.title}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.55, marginBottom: 6 }}>{f.desc}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Next step: {f.action}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="drawer-footer">
              <button className="drawer-btn primary" onClick={() => openGl(drawerRow.code)}>
                {GL_ICON}
                View in General Ledger
              </button>
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
