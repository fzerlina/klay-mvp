import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { COMPANY_BANK_ACCOUNTS } from "../data/seed/bankAccounts";
import { NON_BANK_ACCOUNTS } from "../data/seed/nonBankAccounts";
import { DIM_BY_KEY } from "../data/seed/dimensions";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useBankRecon } from "../state/BankReconContext";
import { useNonBankRecon } from "../state/NonBankReconContext";
import { useDimensions } from "../state/DimensionsContext";
import { periodPresets, rangeLabel, monthLabel, previousPeriod, todayIso } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import { lineDimensions } from "../lib/generalLedger";
import { reconciledThrough } from "../lib/bankRecon";
import {
  computeTrialBalance, ledgerBalance, unpostedInPeriod, periodCloseState,
  netProfitForPeriod, tieOut, coaTree,
} from "../lib/trialBalance";
import { FILTER_DIMS } from "./GlPanels";
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
const fmtShortDate = (s) =>
  new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pctText = (v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const r2 = (v) => Math.round(v * 100) / 100;

const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEndOf = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(lastDay(y, m))}`; };
// The same day a year earlier; a month-end stays a month-end (29 Feb → 28 Feb).
function shiftYear(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const end = d === lastDay(y, m);
  const day = end ? lastDay(y - 1, m) : Math.min(d, lastDay(y - 1, m));
  return `${y - 1}-${pad(m)}-${pad(day)}`;
}

// Drawer lists grow in pages of this many lines.
const PAGE = 50;

// ── Columns ───────────────────────────────────────────────────────────────
// Three layouts over the same rows:
//   six      Opening · Movement · Ending, each split Debit / Credit — the
//            Indonesian neraca saldo layout (Saldo Awal · Mutasi · Saldo Akhir)
//   net      Opening and Ending as one Dr/(Cr) column — debits positive,
//            credits in brackets, so each column sums to zero when it foots
//   compare  Ending Dr / Cr for the comparison period and this one, then the
//            change on the account's normal side (brackets = it went down)
function columnsFor(layout, compareLbl, currentLbl) {
  if (layout === "compare") {
    return [
      { key: "prev_ending_dr", label: "Debit",  sup: compareLbl, sum: true, tone: "muted" },
      { key: "prev_ending_cr", label: "Credit", sup: compareLbl, sum: true, tone: "muted" },
      { key: "ending_dr",      label: "Debit",  sup: currentLbl, sum: true, strong: true },
      { key: "ending_cr",      label: "Credit", sup: currentLbl, sum: true, strong: true },
      { key: "change",         label: "Amount", sup: "Change",   sum: true, title: "Ending balance now less the comparison period's, on the account's normal side. Brackets: the balance went down." },
      { key: "change_pct",     label: "%",      sup: "Change",   pct: true },
    ];
  }
  if (layout === "net") {
    return [
      { key: "opening_net",   label: "Opening Dr/(Cr)", sum: true, tone: "muted", title: "Debit balances positive, credit balances in brackets." },
      { key: "period_debit",  label: "Debit",           sum: true, tone: "dr" },
      { key: "period_credit", label: "Credit",          sum: true, tone: "cr" },
      { key: "closing_net",   label: "Ending Dr/(Cr)",  sum: true, strong: true, title: "Debit balances positive, credit balances in brackets." },
    ];
  }
  return [
    { key: "opening_dr",    label: "Debit",  sup: "Opening",  sum: true, tone: "muted" },
    { key: "opening_cr",    label: "Credit", sup: "Opening",  sum: true, tone: "muted" },
    { key: "period_debit",  label: "Debit",  sup: "Movement", sum: true, tone: "dr" },
    { key: "period_credit", label: "Credit", sup: "Movement", sum: true, tone: "cr" },
    { key: "ending_dr",     label: "Debit",  sup: "Ending",   sum: true, strong: true },
    { key: "ending_cr",     label: "Credit", sup: "Ending",   sum: true, strong: true },
  ];
}
const TONE_COLOR = { muted: "var(--color-text-tertiary)", dr: "var(--color-action)", cr: "var(--color-success-text)" };

// Consecutive columns sharing a super label → [{ label, span }].
function superSpans(cols) {
  const out = [];
  cols.forEach((c) => {
    const last = out[out.length - 1];
    if (last && last.label === c.sup) last.span++;
    else out.push({ label: c.sup, span: 1 });
  });
  return out;
}

// Column totals. "change" is on each account's normal side, so a group's change
// nets its accounts on the group's own side (most of its accounts' normal
// balance): a contra-asset's growth reduces Assets. Across the whole chart it
// has no meaning, so the grand total leaves it blank (`grand`).
function sumCols(rows, cols, { grand = false } = {}) {
  const t = {};
  const debits = rows.filter((r) => r.normal_balance === "debit").length;
  const side = debits * 2 >= rows.length ? "debit" : "credit";
  cols.forEach((c) => {
    if (!c.sum) return;
    if (c.key === "change") {
      t.change = grand ? null : r2(rows.reduce((s, r) => s + (r.change || 0) * (r.normal_balance === side ? 1 : -1), 0));
      return;
    }
    t[c.key] = r2(rows.reduce((s, r) => s + (r[c.key] || 0), 0));
  });
  return t;
}

// Every account under a group node, nested groups included.
const nodeRows = (n) => [...n.rows, ...n.groups.flatMap(nodeRows)];
const nodeIds = (n) => [n.id, ...n.groups.flatMap(nodeIds)];

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
//   variance    A big move against the previous period: a P&L account's
//               activity, or a balance-sheet account's ending balance, changed
//               by at least VARIANCE.pct AND a materiality amount (both, so
//               small accounts don't trip on percentages and big ones don't
//               trip on rounding). Materiality scales with the ledger, the way
//               an auditor sets it: VARIANCE.share of total ending debits, never
//               below VARIANCE.floor. Thresholds are a draft pending the SME.
//   unreconciled  A bank or cash account not reconciled to the end of a period
//               that is already over.
const CLEARING = /clearing|suspense/i;
const VARIANCE = { pct: 0.5, share: 0.01, floor: 10_000_000 };
const materialityFor = (totalDebits) => Math.max(VARIANCE.floor, Math.round(totalDebits * VARIANCE.share / 1_000_000) * 1_000_000);

function reviewChecks(tb, { prevByCode, prevLabel, curLabel, reconByCode, dateTo, periodOver, materiality }) {
  const out = [];
  tb.forEach((r) => {
    const normal = r.normal_balance;
    const other = normal === "debit" ? "credit" : "debit";
    if (r.closing_balance < 0 && r.type !== "equity") {
      out.push({
        code: r.code, kind: "side",
        title: `Ending on the ${other} side`,
        desc: `${r.name} ends with a ${other} balance of ${rp(-r.closing_balance)}; as ${/^[aeiou]/i.test(TYPE_NAMES[r.type]) ? "an" : "a"} ${TYPE_NAMES[r.type].toLowerCase()} account it normally carries a ${normal} balance.`,
        action: "Look through the period's journal lines for a reversed, duplicated or misposted entry.",
      });
    }
    if (CLEARING.test(r.name) && r.closing_balance !== 0) {
      out.push({
        code: r.code, kind: "clearing",
        title: "Clearing account not at zero",
        desc: `${r.name} still holds ${rp(Math.abs(r.closing_balance))}. A clearing account should empty once each item is moved to where it belongs.`,
        action: "Clear the open items before closing the period.",
      });
    }
    if (!r.is_active && r.closing_balance !== 0) {
      out.push({
        code: r.code, kind: "inactive",
        title: "Inactive account with a balance",
        desc: `${r.name} is inactive but ends at ${rp(Math.abs(r.closing_balance))}.`,
        action: "Move the balance to an active account, or reactivate this one.",
      });
    }
    const prev = prevByCode?.[r.code];
    if (prev) {
      const isPl = r.fs === "PL";
      const cur = isPl ? r.movement : r.closing_balance;
      const was = isPl ? prev.movement : prev.closing_balance;
      const delta = r2(cur - was);
      const pct = was ? delta / Math.abs(was) : null;
      if (Math.abs(delta) >= materiality && (pct === null || Math.abs(pct) >= VARIANCE.pct)) {
        const what = isPl ? "activity" : "ending balance";
        out.push({
          code: r.code, kind: "variance",
          title: pct === null ? `New ${what} vs ${prevLabel}` : `${what[0].toUpperCase() + what.slice(1)} ${pctText(pct)} vs ${prevLabel}`,
          desc: `${r.name}'s ${what} was ${rp(was) === "—" ? "Rp 0" : rp(was)} in ${prevLabel} and ${rp(cur) === "—" ? "Rp 0" : rp(cur)} in ${curLabel} — a change of ${rp(delta)}.`,
          action: "Check the period's journals for a one-off, a missed or doubled accrual, or a mispost, and note the reason before closing.",
        });
      }
    }
    const rec = reconByCode?.[r.code];
    if (rec && periodOver && (!rec.through || rec.through < dateTo)) {
      out.push({
        code: r.code, kind: "recon",
        title: "Not reconciled to period end",
        desc: rec.through
          ? `${rec.name} is reconciled to ${fmtIdDate(rec.through)}, but the period ends ${fmtIdDate(dateTo)}.`
          : `${rec.name} has no finished reconciliation, and the period ended ${fmtIdDate(dateTo)}.`,
        action: `Finish the ${rec.kind === "bank" ? "bank" : "non-bank"} reconciliation for ${monthLabel(dateTo)} before closing.`,
        to: rec.to,
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
  "change-desc":  "Largest change",
};
const GROUP_LABELS = {
  "type":  "Account Type",
  "coa":   "COA hierarchy",
  "none":  "—",
};
const COMPARE_LABELS = { none: "None", prev: "Previous period", prev_year: "Same period last year" };

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

const Check = () => <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>;

// A plain pick-one menu.
function ChoicePopover({ items, value, onPick, onClose, className = "" }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className={`lg-popover ${className}`} ref={ref}>
      <div className="lg-popover-list">
        {items.map((it) => (
          <button key={it.k} className={`lg-popover-item${value === it.k ? " selected" : ""}`} onClick={() => onPick(it.k)}>
            <span>{it.lbl}</span>
            <span className="tb-period-range">{it.hint}{value === it.k && <Check />}</span>
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

// Dimension filter — one dimension, one value (the GL's filter dimensions).
function DimensionPopover({ value, valuesOf, onApply, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [key, setKey] = useState(value?.key || FILTER_DIMS[0]);
  const opts = valuesOf(key);
  const [val, setVal] = useState(value?.value && opts.includes(value.value) ? value.value : opts[0] || "");
  return (
    <div className="lg-popover lg-filter-pop tb-dim-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Dimension</div>
          <select className="lg-filter-input" value={key} onChange={(e) => { setKey(e.target.value); setVal(valuesOf(e.target.value)[0] || ""); }} aria-label="Dimension">
            {FILTER_DIMS.map((k) => <option key={k} value={k}>{DIM_BY_KEY[k]?.label || k}</option>)}
          </select>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Value</div>
          <select className="lg-filter-input" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Dimension value">
            {opts.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="tb-pop-note">Shows only journal lines tagged with this value. Opening balances and untagged lines are left out, so a filtered trial balance needn't balance.</div>
      </div>
      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={() => onApply(null)}>{value ? "Clear filter" : "Cancel"}</button>
        <button className="lg-filter-apply" disabled={!val} onClick={() => onApply({ key, value: val })}>Apply</button>
      </div>
    </div>
  );
}

// Saved views — the period, columns, comparison, grouping, sort and filters
// under a name. Kept per user in this browser (a per-viewer convenience).
function ViewsPopover({ views, activeId, onApply, onDelete, onSave, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [name, setName] = useState("");
  const save = () => { if (name.trim()) { onSave(name.trim()); setName(""); } };
  return (
    <div className="lg-popover tb-views-pop" ref={ref}>
      <div className="lg-popover-section-lbl">Saved views</div>
      <div className="lg-popover-list">
        {views.length === 0 && (
          <div className="tb-pop-note" style={{ padding: "4px 10px 8px" }}>No saved views yet. Set the period, columns, grouping and filters the way you like, then save them here.</div>
        )}
        {views.map((v) => (
          <div key={v.id} className="tb-view-item">
            <button className={`lg-popover-item${activeId === v.id ? " selected" : ""}`} onClick={() => onApply(v)}>
              <span>{v.name}</span>
              {activeId === v.id && <Check />}
            </button>
            <button className="tb-view-del" title="Delete view" aria-label={`Delete view ${v.name}`} onClick={() => onDelete(v.id)}>×</button>
          </div>
        ))}
      </div>
      <div className="lg-filter-foot tb-views-foot">
        <input className="lg-filter-input" placeholder="Name this view…" value={name} maxLength={40}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="View name" />
        <button className="lg-filter-apply" disabled={!name.trim()} onClick={save}>Save</button>
      </div>
    </div>
  );
}

function ExportPopover({ onXlsx, onCsv, onPrint, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        <button className="lg-popover-item" onClick={onXlsx}>
          <span>Excel (.xlsx)</span>
          <span className="tb-period-range">with formulas</span>
        </button>
        <button className="lg-popover-item" onClick={onCsv}>CSV</button>
        <button className="lg-popover-item" onClick={onPrint}>Print / PDF</button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

// Opens on last month — the month being closed. The ending balances are the
// same for any range ending on that date; only the activity columns change.
const DEFAULT_PERIOD = { key: "last_month" };
const viewsKey = (userId) => `klay.trialBalance.views.${userId || "anon"}`;
function loadViews(userId) {
  try { return JSON.parse(window.localStorage.getItem(viewsKey(userId))) || []; } catch { return []; }
}

export default function TrialBalancePage() {
  const navigate = useNavigate();
  const { fiscalYearStart } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { resolutions } = useBankRecon();
  const { records: nonBankRecords } = useNonBankRecon();
  const { valuesOf } = useDimensions();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState({ kind: "tab", value: "all" });
  const [sortChoice, setSortChoice] = useState(null);
  const [groupChoice, setGroupChoice] = useState(null);
  // { key } for a preset, or { key: "custom", from, to }.
  const [periodChoice, setPeriodChoice] = useState(DEFAULT_PERIOD);
  const [showZero, setShowZero] = useState(false);
  const [layoutChoice, setLayoutChoice] = useState("six");
  const [compare, setCompare] = useState("none");
  const [dim, setDim] = useState(null); // { key, value }

  const [drawerCode, setDrawerCode] = useState(null);
  const [drawerTab, setDrawerTab] = useState("detail");
  const [drawerLimit, setDrawerLimit] = useState(PAGE);

  const [openPop, setOpenPop] = useState(null); // sort | group | period | export | compare | dim | views
  const togglePop = (k) => setOpenPop((p) => (p === k ? null : k));
  const closePop = () => setOpenPop(null);

  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  const [views, setViews] = useState(() => loadViews(user?.id));
  useEffect(() => { setViews(loadViews(user?.id)); }, [user?.id]);
  const persistViews = (next) => {
    setViews(next);
    try { window.localStorage.setItem(viewsKey(user?.id), JSON.stringify(next)); } catch { /* per-viewer nicety only */ }
  };

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
  const periodOver = dateTo < todayIso();

  const prevRange = useMemo(() => previousPeriod(dateFrom, dateTo), [dateFrom, dateTo]);
  const compRange = useMemo(() => {
    if (compare === "prev") return prevRange;
    if (compare === "prev_year") return { from: shiftYear(dateFrom), to: shiftYear(dateTo) };
    return null;
  }, [compare, prevRange, dateFrom, dateTo]);
  const compLabel = compRange ? rangeLabel(compRange.from, compRange.to) : "";
  const layout = compRange ? "compare" : layoutChoice;
  const cols = useMemo(() => columnsFor(layout, compLabel, periodRange), [layout, compLabel, periodRange]);
  const spans = cols.some((c) => c.sup) ? superSpans(cols) : null;

  // ── Numbers ──
  const { entries: JOURNAL_ENTRIES } = useJournalEntries();
  const lineFilter = useMemo(
    () => (dim ? (je, l) => lineDimensions(je, l)[dim.key] === dim.value : null),
    [dim],
  );
  const run = (from, to) => computeTrialBalance({ from, to, entries: JOURNAL_ENTRIES, fiscalYearStart, lineFilter });
  const CUR_TB = useMemo(() => run(dateFrom, dateTo), [dateFrom, dateTo, JOURNAL_ENTRIES, fiscalYearStart, lineFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const PREV_TB = useMemo(() => run(prevRange.from, prevRange.to), [prevRange, JOURNAL_ENTRIES, fiscalYearStart, lineFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const COMP_TB = useMemo(() => {
    if (!compRange) return null;
    if (compare === "prev") return PREV_TB;
    return run(compRange.from, compRange.to);
  }, [compRange, compare, PREV_TB, JOURNAL_ENTRIES, fiscalYearStart, lineFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevByCode = useMemo(() => Object.fromEntries(PREV_TB.map((r) => [r.code, r])), [PREV_TB]);

  // Rows with the comparison laid on: the comparison period's ending sides,
  // and the change on the account's normal side.
  const ALL_TB = useMemo(() => {
    if (!COMP_TB) return CUR_TB;
    const byCode = Object.fromEntries(COMP_TB.map((r) => [r.code, r]));
    return CUR_TB.map((r) => {
      const p = byCode[r.code];
      const change = r2(r.closing_balance - (p?.closing_balance || 0));
      return {
        ...r,
        prev_ending_dr: p?.ending_dr || 0,
        prev_ending_cr: p?.ending_cr || 0,
        prev_closing: p?.closing_balance || 0,
        change,
        change_pct: p?.closing_balance ? change / Math.abs(p.closing_balance) : null,
        has_activity: r.has_activity || !!p?.has_activity,
      };
    });
  }, [CUR_TB, COMP_TB]);

  // Bank and cash accounts: how far each is reconciled (Bank and Non-Bank Reconciliation).
  const reconByCode = useMemo(() => {
    const m = {};
    COMPANY_BANK_ACCOUNTS.forEach((a) => {
      if (!a.glAccount || !a.active) return;
      m[a.glAccount] = { kind: "bank", name: a.name, through: reconciledThrough(a.id, resolutions).through, to: "/bank-reconciliation" };
    });
    NON_BANK_ACCOUNTS.forEach((a) => {
      let through = null;
      Object.values(nonBankRecords || {}).forEach((rec) => {
        if (rec.accountId !== a.id || rec.status !== "approved") return;
        const end = monthEndOf(rec.period);
        if (!through || end > through) through = end;
      });
      m[a.glAccount] = { kind: "nonbank", name: a.name, through, to: "/non-bank-reconciliation" };
    });
    return m;
  }, [resolutions, nonBankRecords]);

  const balance = useMemo(() => ledgerBalance(CUR_TB), [CUR_TB]);
  const netProfit = useMemo(() => netProfitForPeriod({ from: dateFrom, to: dateTo, entries: JOURNAL_ENTRIES }).netProfit, [dateFrom, dateTo, JOURNAL_ENTRIES]);
  const ties = useMemo(() => tieOut(CUR_TB, { netProfit }), [CUR_TB, netProfit]);
  const prevLabel = rangeLabel(prevRange.from, prevRange.to);
  // Materiality comes from the full ledger, so a dimension filter doesn't shrink it.
  const fullDebits = useMemo(
    () => (dim ? ledgerBalance(computeTrialBalance({ from: dateFrom, to: dateTo, entries: JOURNAL_ENTRIES, fiscalYearStart })).dr : balance.dr),
    [dim, balance.dr, dateFrom, dateTo, JOURNAL_ENTRIES, fiscalYearStart],
  );
  const materiality = materialityFor(fullDebits);
  const findings = useMemo(
    () => reviewChecks(CUR_TB, { prevByCode, prevLabel, curLabel: periodRange, reconByCode: dim ? null : reconByCode, dateTo, periodOver, materiality }),
    [CUR_TB, prevByCode, prevLabel, periodRange, reconByCode, dim, dateTo, periodOver, materiality],
  );
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
    { lbl: "Total debits",  card: null, val: rp(balance.dr), sub: "Ending debit balances" },
    { lbl: "Total credits", card: null, val: rp(balance.cr), sub: "Ending credit balances" },
    dim
      ? { lbl: "Difference", card: null, val: "—", sub: "Not checked while filtered" }
      : { lbl: "Difference", card: null, val: balance.balanced ? "Rp 0" : rp(balance.variance), sub: balance.balanced ? "Debits equal credits" : "Out of balance", tone: balance.balanced ? "ok" : "danger" },
    { lbl: "Needs review",  card: flaggedCount > 0 ? "review" : null, val: String(flaggedCount), sub: flaggedCount > 0 ? plural(flaggedCount, "account") + " flagged" : "Nothing flagged", tone: flaggedCount > 0 ? "warn" : null },
  ];

  // Zero-balance accounts (no opening, no movement, no closing) are hidden
  // unless asked for; tab counts follow what the table can show.
  const baseRows = useMemo(() => (showZero ? ALL_TB : ALL_TB.filter((r) => r.has_activity)), [ALL_TB, showZero]);

  const tabs = TABS.map((t) => ({ ...t, count: baseRows.filter((r) => t.types.includes(r.type)).length }));

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

  const viewState = {
    periodChoice, layoutChoice, compare, groupChoice, sortChoice, showZero, dim,
    tab: filter.kind === "tab" ? filter.value : "all",
  };
  const viewSig = JSON.stringify(viewState);
  const activeViewId = views.find((v) => JSON.stringify(v.state) === viewSig)?.id || null;

  const hasActiveFilters = (
    periodChoice.key !== DEFAULT_PERIOD.key ||
    showZero || layoutChoice !== "six" || compare !== "none" || dim ||
    sortChoice !== null || groupChoice !== null || search.trim() !== ""
  );

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return corpus;
    return corpus.filter((r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [corpus, search]);

  // "Largest change" only means something with a comparison on.
  const effectiveSort = sortChoice === "change-desc" && !compRange ? "code-asc" : (sortChoice || "code-asc");
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
      case "change-desc": arr.sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0)); break;
      default: break;
    }
    return arr;
  }, [filteredRows, effectiveSort]);

  // Totals of exactly the rows on screen (tab, search, zero toggle applied).
  const shownTotals = useMemo(() => sumCols(sortedRows, cols, { grand: true }), [sortedRows, cols]);

  // Group tree: flat type groups, or the chart's own hierarchy.
  const tree = useMemo(() => {
    if (effectiveGroup === "none") return null;
    if (effectiveGroup === "coa") return coaTree(sortedRows);
    const map = new Map();
    TYPE_ORDER.forEach((t) => map.set(t, []));
    sortedRows.forEach((r) => { (map.get(r.type) || map.set(r.type, []).get(r.type)).push(r); });
    return Array.from(map.entries())
      .filter(([, rows]) => rows.length > 0)
      .map(([t, rows]) => ({ id: t, label: TYPE_LABELS[t] || t, level: 0, groups: [], rows }));
  }, [effectiveGroup, sortedRows]);
  const allGroupIds = useMemo(() => (tree ? tree.flatMap(nodeIds) : []), [tree]);
  const allCollapsed = allGroupIds.length > 0 && allGroupIds.every((id) => collapsedGroups.has(id));

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
    setLayoutChoice("six");
    setCompare("none");
    setDim(null);
    setSearch("");
    setFilter({ kind: "tab", value: "all" });
  }

  function applyView(v) {
    const s = v.state;
    setPeriodChoice(s.periodChoice || DEFAULT_PERIOD);
    setLayoutChoice(s.layoutChoice || "six");
    setCompare(s.compare || "none");
    setGroupChoice(s.groupChoice ?? null);
    setSortChoice(s.sortChoice ?? null);
    setShowZero(!!s.showZero);
    setDim(s.dim || null);
    setFilter({ kind: "tab", value: s.tab || "all" });
    closePop();
    showToast(`View “${v.name}” applied`);
  }
  function saveView(name) {
    const existing = views.find((v) => v.name.toLowerCase() === name.toLowerCase());
    const view = { id: existing?.id || `v${Date.now()}`, name, state: viewState };
    persistViews(existing ? views.map((v) => (v.id === existing.id ? view : v)) : [...views, view]);
    showToast(existing ? `View “${name}” updated` : `View “${name}” saved`);
  }
  function deleteView(id) { persistViews(views.filter((v) => v.id !== id)); }

  function toggleGroup(key) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleAllGroups() { setCollapsedGroups(allCollapsed ? new Set() : new Set(allGroupIds)); }

  // ── Drill-down ──
  function openDrawer(code) {
    setDrawerCode(code);
    setDrawerTab("detail");
    setDrawerLimit(PAGE);
  }
  const openGl = (code) => navigate(`/reports/general-ledger?account=${encodeURIComponent(code)}&period=${periodEndYm}`);
  const openJe = (jeNumber) => navigate(`/journal-entry?je=${encodeURIComponent(jeNumber)}`);

  // ── Export ──
  const dimLabel = dim ? `${DIM_BY_KEY[dim.key]?.label || dim.key}: ${dim.value}` : null;
  const colTitle = (c) => (c.sup ? `${c.sup} ${c.label}` : c.label);
  const viewNote = [
    compRange ? `Compared with ${compLabel}` : layout === "net" ? "Net balances" : "Six columns",
    `Grouped by ${GROUP_LABELS[effectiveGroup] === "—" ? "nothing" : GROUP_LABELS[effectiveGroup]}`,
    dimLabel ? `Filtered to ${dimLabel}` : null,
  ].filter(Boolean).join(" · ");

  function exportCsv() {
    closePop();
    const totalRow = { code: "", name: `Total — ${plural(sortedRows.length, "account")}`, type: null, ...shownTotals, change_pct: null };
    downloadCsv(exportName("trial-balance", dateFrom, dateTo), {
      header: [...reportHeader({ report: "Trial Balance", period: periodRange, runBy: user?.name }), [viewNote]],
      columns: [
        { label: "Code",    value: (r) => r.code },
        { label: "Account", value: (r) => r.name },
        { label: "Type",    value: (r) => TYPE_NAMES[r.type] || "" },
        ...cols.map((c) => ({ label: colTitle(c), value: (r) => (c.pct ? (r[c.key] == null ? null : r2(r[c.key] * 100)) : r[c.key]) })),
      ],
      rows: [...sortedRows, totalRow],
    });
    showToast(`${plural(sortedRows.length, "account")} exported to CSV`);
  }

  // A real workbook: the company header, the column header (two rows when the
  // layout has super labels), group heads, and subtotal rows written as
  // SUBTOTAL(9, …) — which skips the nested subtotals inside its range, so a
  // parent's total and the grand total never double-count. A sign-off block
  // closes the sheet.
  function exportXlsx() {
    closePop();
    const runAt = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const FIRST = 3; // index of the first amount column (after Code, Account, Type)
    const L = (ci) => colName(FIRST + ci);
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }],
      [{ v: "Trial Balance", s: "title" }],
      [periodRange],
      [{ v: viewNote, s: "muted" }],
      [{ v: `Run ${runAt}${user?.name ? ` by ${user.name}` : ""} · Amounts in IDR`, s: "muted" }],
      [],
    ];
    if (spans) {
      const sup = [{ v: "", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }];
      spans.forEach((sp) => { sup.push({ v: sp.label, s: "headNum" }); for (let i = 1; i < sp.span; i++) sup.push({ v: "", s: "head" }); });
      rows.push(sup);
    }
    rows.push([{ v: "Code", s: "head" }, { v: "Account", s: "head" }, { v: "Type", s: "head" }, ...cols.map((c) => ({ v: c.label, s: "headNum" }))]);
    const freeze = rows.length;
    const bodyStart = rows.length + 1;

    const accountRow = (r, depth) => [
      r.code,
      `${"   ".repeat(depth)}${r.name}`,
      TYPE_NAMES[r.type] || "",
      ...cols.map((c) => {
        const v = r[c.key];
        if (c.pct) return v == null ? null : { v: r2(v * 100), s: "num" };
        return v ? { v, s: "num" } : null;
      }),
    ];
    const totalRow = (label, from, to, vals, fn = "SUBTOTAL(9,") => [
      "", { v: label, s: "bold" }, "",
      // Change nets on the group's side (see sumCols), which no SUM reproduces: written as a value.
      ...cols.map((c, ci) => {
        if (!c.sum) return null;
        if (c.key === "change") return vals.change == null ? null : { v: vals.change, s: "numBold" };
        return { f: `${fn}${L(ci)}${from}:${L(ci)}${to})`, v: vals[c.key], s: "numBold" };
      }),
    ];
    const walk = (node, depth) => {
      rows.push(["", { v: `${"   ".repeat(depth)}${node.label}`, s: "bold" }]);
      const start = rows.length + 1;
      node.rows.forEach((r) => rows.push(accountRow(r, depth + 1)));
      node.groups.forEach((g) => walk(g, depth + 1));
      rows.push(totalRow(`${"   ".repeat(depth)}Total ${node.label}`, start, rows.length, sumCols(nodeRows(node), cols)));
    };
    if (tree) tree.forEach((n) => walk(n, 0));
    else sortedRows.forEach((r) => rows.push(accountRow(r, 0)));
    const bodyEnd = rows.length;
    rows.push(totalRow(`Total — ${plural(sortedRows.length, "account")}`, bodyStart, bodyEnd, shownTotals));
    const totalAt = rows.length;
    // Footing line under the two ending columns (six / compare layouts).
    const drIdx = cols.findIndex((c) => c.key === "ending_dr");
    if (drIdx >= 0 && !dim) {
      const line = ["", { v: "Difference (Ending Dr − Cr)", s: "muted" }, ""];
      cols.forEach((c, ci) => line.push(ci === drIdx ? { f: `${L(ci)}${totalAt}-${L(ci + 1)}${totalAt}`, v: r2(shownTotals.ending_dr - shownTotals.ending_cr), s: "num" } : null));
      rows.push(line);
    }
    rows.push([], []);
    rows.push(["", { v: "Prepared by", s: "bold" }, "", { v: "Reviewed by", s: "bold" }, "", { v: "Approved by", s: "bold" }]);
    rows.push([], ["", user?.name || "Name", "", "Name", "", "Name"], ["", { v: "Date:", s: "muted" }, "", { v: "Date:", s: "muted" }, "", { v: "Date:", s: "muted" }]);

    downloadXlsx(exportName("trial-balance", dateFrom, dateTo).replace(/\.csv$/, ".xlsx"), {
      sheet: "Trial Balance",
      rows,
      widths: [10, 46, 14, ...cols.map(() => 18)],
      freeze,
    });
    showToast(`${plural(sortedRows.length, "account")} exported to Excel`);
  }
  function exportPrint() {
    closePop();
    // Let the menu close before the print dialog snapshots the page.
    setTimeout(printReport, 50);
  }

  // Drawer data
  const drawerRow = drawerCode ? ALL_TB.find((r) => r.code === drawerCode) : null;
  const drawerFindings = drawerCode ? (findingsByCode[drawerCode] || []) : [];
  const drawerLines = drawerRow ? drawerRow.entries.slice(0, drawerLimit) : [];
  const drawerMore = drawerRow ? drawerRow.entries.length - drawerLines.length : 0;
  const drawerRecon = drawerRow && !dim ? reconByCode[drawerRow.code] : null;
  const drawerPrev = drawerRow ? prevByCode[drawerRow.code] : null;

  const ShowMore = () => (drawerMore > 0 ? (
    <button className="tb-show-more" onClick={() => setDrawerLimit((n) => n + PAGE)}>
      Show {Math.min(PAGE, drawerMore)} more · {drawerMore} remaining
    </button>
  ) : null);

  const reconState = (rec) => (!rec ? null : rec.through && rec.through >= dateTo ? "ok" : rec.through ? "partial" : "none");
  const reconText = (rec) => (rec.through ? `Reconciled to ${fmtShortDate(rec.through)}` : "Not reconciled");

  const cellView = (c, r) => {
    const v = r[c.key];
    if (c.pct) return v == null ? (r.change ? <span className="tb-cell-new">New</span> : <span className="lg-cell-em-dash">—</span>) : pctText(v);
    if (!v) return <span className="lg-cell-em-dash">—</span>;
    return <span style={c.tone ? { color: TONE_COLOR[c.tone] } : undefined}>{rp(v)}</span>;
  };
  const gridStyle = { "--tb-n": cols.length };
  const INDENT = 18;

  // Render a TB row
  function TbRow({ r, isAlt, depth = 0 }) {
    const flags = findingsByCode[r.code] || [];
    const tint = flags.length ? " anomaly-warn" : "";
    const rec = dim ? null : reconByCode[r.code];
    const rs = reconState(rec);
    return (
      <div className={`lg-row${isAlt ? " alt" : ""}${tint}${drawerCode === r.code ? " selected" : ""}`} onClick={() => openDrawer(r.code)}>
        <div className="lg-cell-no">{r.code}</div>
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingLeft: depth * INDENT }}>
          <span style={{ fontSize: 12, color: "var(--color-text-primary)", fontWeight: 500 }}>{r.name}</span>
          {effectiveGroup !== "coa" && <span className={`badge badge-${TYPE_BADGE_CLS[r.type]}`} style={{ fontSize: 9 }}>{TYPE_LABELS[r.type]}</span>}
          {rec && (
            <button type="button" className={`tb-recon-chip ${rs}`} title={`${rec.kind === "bank" ? "Bank" : "Non-bank"} reconciliation — open it`}
              onClick={(e) => { e.stopPropagation(); navigate(rec.to); }}>
              {rs === "ok" ? "✓ " : ""}{reconText(rec)}
            </button>
          )}
          {flags.length > 0 && (
            <span className="lg-anom-flag warn" title={flags.map((f) => f.title).join(" · ")}>
              {REVIEW_ICON}
              {flags.length > 1 ? `${flags.length} checks` : "Review"}
            </span>
          )}
        </div>
        {cols.map((c) => (
          <div key={c.key} className={`lg-cell-total${c.strong ? " tb-cell-end" : ""}`}>{cellView(c, r)}</div>
        ))}
        <div className="lg-cell-kebab no-print" onClick={(e) => e.stopPropagation()}>
          <button className="lg-kebab tb-gl-btn" title="View in General Ledger" aria-label={`View ${r.code} in General Ledger`} onClick={() => openGl(r.code)}>
            {GL_ICON}
          </button>
        </div>
      </div>
    );
  }

  function TotalRow({ label, totals, depth = 0, className = "" }) {
    return (
      <div className={`lg-row subtotal ${className}`}>
        <div />
        <div className="tb-total-lbl" style={{ paddingLeft: depth * INDENT }}>{label}</div>
        {cols.map((c) => (
          <div key={c.key} className={`lg-cell-total${c.strong ? " tb-cell-end" : ""}`} style={c.tone && c.tone !== "muted" ? { color: TONE_COLOR[c.tone] } : c.tone === "muted" ? { color: "var(--color-text-tertiary)" } : undefined}>
            {c.sum && totals[c.key] != null ? rp(totals[c.key]) : ""}
          </div>
        ))}
        <div />
      </div>
    );
  }

  function GroupNode({ node, depth }) {
    const collapsed = collapsedGroups.has(node.id);
    const rows = nodeRows(node);
    return (
      <Fragment>
        <div className={`lg-group-head muted${depth ? " tb-subgroup" : ""}`} style={{ paddingLeft: 32 + depth * INDENT }} onClick={() => toggleGroup(node.id)}>
          <div className="lg-group-left">
            <svg className={`lg-group-chevron${collapsed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>
            <span className="lg-group-lbl">{node.label}</span>
            <span className="lg-group-count">{rows.length}</span>
          </div>
        </div>
        {!collapsed && node.rows.map((r, i) => <TbRow key={r.code} r={r} isAlt={i % 2 === 1} depth={effectiveGroup === "coa" ? depth + 1 : 0} />)}
        {!collapsed && node.groups.map((g) => <GroupNode key={g.id} node={g} depth={depth + 1} />)}
        <TotalRow label={`${collapsed ? "" : "Subtotal "}${node.label}`} totals={sumCols(rows, cols)} depth={effectiveGroup === "coa" ? depth : 0} />
      </Fragment>
    );
  }

  const closedLabel = closedThrough ? monthLabel(`${closedThrough}-01`) : null;
  const unpostedParts = [
    unposted.drafts ? plural(unposted.drafts, "draft") : null,
    unposted.pending ? plural(unposted.pending, "journal awaiting approval", "journals awaiting approval") : null,
  ].filter(Boolean);

  const compareItems = [
    { k: "none", lbl: "No comparison" },
    { k: "prev", lbl: "Previous period", hint: rangeLabel(prevRange.from, prevRange.to) },
    { k: "prev_year", lbl: "Same period last year", hint: rangeLabel(shiftYear(dateFrom), shiftYear(dateTo)) },
  ];
  const groupItems = [
    { k: "type", lbl: "Account Type (default)" },
    { k: "coa", lbl: "COA hierarchy", hint: "groups and subtotals" },
    { k: "none", lbl: "Not grouped" },
  ];
  const sortItems = Object.entries(SORT_LABELS)
    .filter(([k]) => k !== "change-desc" || compRange)
    .map(([k, lbl]) => ({ k, lbl }));

  return (
    <div className="lg-page tb-report">
      <div className="lg-scroll-container">
        {/* ── Print header (print / PDF only) ───────────────────────── */}
        <div className="print-only tb-print-head">
          <div className="tb-print-company">{COMPANY.legalName}</div>
          <div className="tb-print-title">Trial Balance</div>
          <div className="tb-print-period">
            {periodRange}{compRange ? ` compared with ${compLabel}` : ""} · {dim ? `Filtered to ${dimLabel}` : balance.balanced ? "In balance" : `Out of balance by ${rp(balance.variance)}`} · Amounts in IDR
          </div>
        </div>

        {/* ── Editorial header ──────────────────────────────────────── */}
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Trial Balance</h1>
            </div>
            <div className="lg-head-actions no-print">
              <div className="lg-meta-btn-wrap">
                <button className={`lg-btn-ghost${activeViewId ? " tb-btn-on" : ""}`} onClick={() => togglePop("views")} aria-haspopup="dialog" aria-expanded={openPop === "views"}>
                  <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                  {activeViewId ? views.find((v) => v.id === activeViewId)?.name : "Views"}
                </button>
                {openPop === "views" && <ViewsPopover views={views} activeId={activeViewId} onApply={applyView} onDelete={deleteView} onSave={saveView} onClose={closePop} />}
              </div>
              <div className="lg-meta-btn-wrap">
                <button className="lg-btn-ghost" onClick={() => togglePop("period")} aria-haspopup="dialog" aria-expanded={openPop === "period"}>
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  {period.label} · {periodRange}
                </button>
                {openPop === "period" && <PeriodPopover presets={presets} period={period} onPick={(c) => { setPeriodChoice(c); closePop(); }} onClose={closePop} />}
              </div>
              <div className="lg-meta-btn-wrap">
                <button className={`lg-btn-ghost${compRange ? " tb-btn-on" : ""}`} onClick={() => togglePop("compare")} aria-haspopup="menu" aria-expanded={openPop === "compare"}>
                  <svg viewBox="0 0 24 24"><path d="M8 3v18M16 3v18M3 8h5M16 16h5"/></svg>
                  {compRange ? `vs ${compLabel}` : "Compare"}
                </button>
                {openPop === "compare" && (
                  <ChoicePopover className="tb-compare-pop" items={compareItems} value={compare}
                    onPick={(k) => { setCompare(k); if (k === "none" && sortChoice === "change-desc") setSortChoice(null); closePop(); }} onClose={closePop} />
                )}
              </div>
              <div className="lg-meta-btn-wrap">
                <button className="lg-btn-brand" onClick={() => togglePop("export")} aria-haspopup="menu" aria-expanded={openPop === "export"}>
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export
                </button>
                {openPop === "export" && <ExportPopover onXlsx={exportXlsx} onCsv={exportCsv} onPrint={exportPrint} onClose={closePop} />}
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

          {dim && (
            <div className="tb-status tb-dim-note">
              <span className="tb-status-chip open">Filtered</span>
              <span>Showing only journal lines tagged <strong>{dimLabel}</strong>. Opening balances and untagged lines are left out, so these totals needn't balance.</span>
              <button className="tb-status-link no-print" onClick={() => setDim(null)}>Clear filter</button>
            </div>
          )}

          {/* Tie-out — the footing a reviewer checks before trusting the numbers */}
          <div className="tb-ties">
            <span className="tb-ties-lbl">Tie-out</span>
            {dim ? (
              <span className="tb-tie muted">Runs on the full ledger. Clear the dimension filter to check.</span>
            ) : ties.map((t) => (
              <span key={t.key} className={`tb-tie ${t.ok ? "ok" : "off"}`} title={`${t.aLbl} ${rp(t.a) === "—" ? "Rp 0" : rp(t.a)} · ${t.bLbl} ${rp(t.b) === "—" ? "Rp 0" : rp(t.b)}`}>
                <span aria-hidden="true">{t.ok ? "✓" : "✕"}</span>
                {t.key === "pl" ? (
                  <button className="tb-tie-link no-print" onClick={() => navigate("/reports/profit-loss")}>{t.label}</button>
                ) : t.label}
                {t.key === "pl" && <span className="print-only">{t.label}</span>}
                {!t.ok && <span className="tb-tie-diff">off by {rp(t.diff)}</span>}
              </span>
            ))}
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
                title={k.lbl === "Needs review" ? `Accounts ending on the wrong side of their normal balance, clearing accounts not at zero, inactive accounts with a balance, moves of ${Math.round(VARIANCE.pct * 100)}% and ${rp(materiality)} (${VARIANCE.share * 100}% of total debits) or more against ${prevLabel}, and bank or cash accounts not reconciled to the end of a finished period.` : undefined}
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
          <div className="lg-card lg-table-tb" style={gridStyle}>
            <div className="lg-pills-row no-print">
              {tabs.map((t) => (
                <button key={t.k} className={`lg-pill${isTabActive(t.k) ? " active" : ""}`} onClick={() => selectTab(t.k)}>
                  {t.lbl}
                  <span className="lg-pill-count">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row no-print tb-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input placeholder="Search account code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta">
                <div className="tb-seg" role="group" aria-label="Columns" title={compRange ? "A comparison shows ending balances side by side; turn it off to choose columns." : undefined}>
                  <button className={`tb-seg-btn${layout === "six" ? " on" : ""}`} disabled={!!compRange} onClick={() => setLayoutChoice("six")} aria-pressed={layout === "six"}>6 columns</button>
                  <button className={`tb-seg-btn${layout === "net" ? " on" : ""}`} disabled={!!compRange} onClick={() => setLayoutChoice("net")} aria-pressed={layout === "net"}>Net</button>
                </div>
                <button className={`lg-toggle${showZero ? " on" : ""}`} onClick={() => setShowZero((v) => !v)} aria-pressed={showZero}>
                  Show zero balances
                </button>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${dim ? " active" : ""}`} onClick={() => togglePop("dim")}>
                    <span className="meta-lbl">Dimension:</span>
                    <span className="meta-val">{dimLabel || "All"}</span>
                  </button>
                  {openPop === "dim" && <DimensionPopover value={dim} valuesOf={valuesOf} onApply={(v) => { setDim(v); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => togglePop("sort")}>
                    <span className="meta-lbl">Sort:</span>
                    <span className="meta-val">{SORT_LABELS[effectiveSort]}</span>
                  </button>
                  {openPop === "sort" && <ChoicePopover items={sortItems} value={effectiveSort} onPick={(v) => { setSortChoice(v); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => togglePop("group")}>
                    <span className="meta-lbl">Group:</span>
                    <span className="meta-val">{GROUP_LABELS[effectiveGroup]}</span>
                  </button>
                  {openPop === "group" && <ChoicePopover items={groupItems} value={effectiveGroup} onPick={(v) => { setGroupChoice(v); setCollapsedGroups(new Set()); closePop(); }} onClose={closePop} />}
                </div>
                {tree && <button className="lg-reset-all tb-collapse-all" onClick={toggleAllGroups}>{allCollapsed ? "Expand all" : "Collapse all"}</button>}
                {hasActiveFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            {spans && (
              <div className="lg-col-header tb-col-super">
                <div />
                <div />
                {spans.map((s, i) => <div key={i} style={{ gridColumn: `span ${s.span}` }}>{s.label}</div>)}
                <div />
              </div>
            )}
            <div className="lg-col-header">
              <div>Code</div>
              <div>Account Name</div>
              {cols.map((c) => <div key={c.key} style={{ textAlign: "right" }} title={c.title}>{c.label}</div>)}
              <div />
            </div>

            <div>
              {sortedRows.length === 0 && (
                <div className="lg-empty">
                  {!showZero && search.trim() === "" && filter.kind === "tab" ? "No accounts with a balance here. Turn on “Show zero balances” to see them all." : "No accounts match."}
                </div>
              )}
              {tree
                ? tree.map((n) => <GroupNode key={n.id} node={n} depth={0} />)
                : sortedRows.map((r, i) => <TbRow key={r.code} r={r} isAlt={i % 2 === 1} />)}
              {sortedRows.length > 0 && (
                <TotalRow className="tb-total-row" label={`Total — ${plural(sortedRows.length, "account")} shown`} totals={shownTotals} />
              )}
            </div>

            {/* ── Sign-off block (print / PDF only) ── */}
            <div className="print-only tb-signoff">
              {[["Prepared by", user?.name], ["Reviewed by", ""], ["Approved by", ""]].map(([lbl, name]) => (
                <div key={lbl} className="tb-sign">
                  <div className="tb-sign-lbl">{lbl}</div>
                  <div className="tb-sign-line" />
                  <div className="tb-sign-name">{name || "Name"}</div>
                  <div className="tb-sign-date">Date:</div>
                </div>
              ))}
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
          {dim ? (
            <span className="tb-balance-flag">Filtered — not checked</span>
          ) : (
            <span className={`tb-balance-flag${balance.balanced ? " ok" : " off"}`}>
              {balance.balanced ? "✓ In balance" : `Out of balance by ${rp(balance.variance)}`}
            </span>
          )}
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
                      <div className="drawer-stat-val" style={{ color: "var(--color-text-tertiary)" }}>
                        {drawerRow.opening_dr ? `Dr ${rp(drawerRow.opening_dr)}` : drawerRow.opening_cr ? `Cr ${rp(drawerRow.opening_cr)}` : "—"}
                      </div>
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
                    {drawerRecon && (
                      <div className="drawer-row">
                        <div className="drawer-label">Reconciliation</div>
                        <div className="drawer-value">
                          <span className={`tb-recon-chip ${reconState(drawerRecon)}`} style={{ cursor: "default" }}>{reconText(drawerRecon)}</span>{" "}
                          <button className="tb-je-link" onClick={() => navigate(drawerRecon.to)}>Open {drawerRecon.kind === "bank" ? "Bank" : "Non-Bank"} Reconciliation</button>
                        </div>
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
                    {drawerPrev && (
                      <div className="drawer-row">
                        <div className="drawer-label">{drawerRow.fs === "PL" ? "Activity" : "Ending"} in {prevLabel}</div>
                        <div className="drawer-value">
                          {rp(drawerRow.fs === "PL" ? drawerPrev.movement : drawerPrev.closing_balance)}
                          {" → "}
                          {rp(drawerRow.fs === "PL" ? drawerRow.movement : drawerRow.closing_balance)} now
                        </div>
                      </div>
                    )}
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
                      Nothing flagged for this account.
                    </div>
                  ) : drawerFindings.map((f, i) => (
                    <div key={i} style={{ padding: 12, background: "var(--color-warning-surface)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--radius-md)", marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>{f.title}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.55, marginBottom: 6 }}>{f.desc}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                        Next step: {f.action}
                        {f.to && <> <button className="tb-je-link" onClick={() => navigate(f.to)}>Open reconciliation</button></>}
                      </div>
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
