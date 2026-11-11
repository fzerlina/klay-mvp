// Reports → Profit & Loss.
//
// The V1 P&L from the competitor benchmark (Superhuman Docs › Reporting ›
// Profit & Loss - Competitor Analysis, §6), modelled on DualEntry:
//   • One statement, many columns: Total only, By month, By quarter or by a
//     dimension (one column per value + Untagged + Total); or a
//     comparison (previous period, same period last year, prior year to
//     date). One at a time, as DualEntry does.
//   • Rows from account types (lib/profitLoss.js), with a margin row under
//     gross, operating and net profit instead of a KPI bar.
//   • + Add filter for dimension values. Every posted journal counts,
//     adjusting ones included — the P&L has no Adjustments control (removed
//     11 Nov 2026); the Trial Balance keeps its unadjusted / adjusted view.
//   • An amount opens the General Ledger for that account, that column's
//     dates and the same dimension filter.
//   • Final / Preliminary from the period lock, with the journals not yet
//     posted; net profit tied to the Trial Balance.
//   • Saved views, last period preset remembered, Excel with live formulas,
//     CSV, and a signed print / PDF — with Bahasa Indonesia labels in print and
//     Excel by default.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { DIM_BY_KEY } from "../data/seed/dimensions";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useDimensions } from "../state/DimensionsContext";
import { computeProfitLoss, PL_LINES, lineValue, unpostedInPeriod, change, plAccounts } from "../lib/profitLoss";
import {
  periodPresets, previousPeriod, rangeLabel, monthLabel, sameDayLastYear,
  monthEnd, fiscalYearStartFor, splitPeriod,
} from "../lib/reportPeriods";
import { netProfitForPeriod, periodCloseState } from "../lib/trialBalance";
import { lineDimensions, UNTAGGED } from "../lib/generalLedger";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import {
  useClickOutside, Check, ChoicePopover, PeriodPopover, DimensionPopover,
  ViewsPopover, ExportPopover, loadLocal, saveLocal,
} from "../components/ReportControls";
import "./modules.css";
import "./invoices-ledger.css";
import "./trial-balance.css";
import "./profit-loss.css";

// ── Formatting ──────────────────────────────────────────────────────────────
const UNITS = {
  1:       { en: "Amounts in Rupiah",              id: "Dinyatakan dalam Rupiah",        head: "Rp" },
  1000:    { en: "Amounts in thousands of Rupiah", id: "Dinyatakan dalam ribuan Rupiah", head: "Rp '000" },
  1000000: { en: "Amounts in millions of Rupiah",  id: "Dinyatakan dalam jutaan Rupiah", head: "Rp m" },
};
// Statement amounts: id-ID grouping, negatives in parentheses, zero as a dash.
const num = (v, unit = 1) => {
  if (v == null) return "";
  const s = v / unit;
  if (Math.abs(s) < (unit === 1 ? 0.005 : 0.5)) return "—";
  const t = Math.abs(s).toLocaleString("id-ID", unit === 1 ? undefined : { maximumFractionDigits: 0 });
  return s < 0 ? `(${t})` : t;
};
const rp = (v) => {
  if (v == null) return "—";
  const s = "Rp " + Math.abs(v).toLocaleString("id-ID");
  return v < 0 ? `(${s})` : s;
};
const pct = (v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
  return v < 0 ? `(${s})` : s;
};
// A change in a margin, in percentage points.
const pp = (v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.0005) return "—";
  return `${v > 0 ? "+" : "−"}${Math.abs(v * 100).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const r2 = (v) => Math.round(v * 100) / 100;

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const longDate = (iso, months) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${months[m - 1]} ${y}`; };
const longRange = (from, to, lang) => {
  const months = lang === "id" ? ID_MONTHS : EN_MONTHS;
  return `${lang === "id" ? "Untuk periode" : "For the period"} ${longDate(from, months)} – ${longDate(to, months)}`;
};

// A label shown in English on screen and, when the print / Excel language is
// Bahasa Indonesia, in Bahasa on paper.
function Lbl({ en, id, lang }) {
  if (lang !== "id" || !id || id === en) return en;
  return <><span className="pl-lbl-screen">{en}</span><span className="pl-lbl-print">{id}</span></>;
}

const GEAR = <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
const CAL = <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;

// ── Choices ─────────────────────────────────────────────────────────────────
const COLUMN_LABELS = { total: "Total only", month: "By month", quarter: "By quarter" };
const COMPARE_LABELS = { none: "None", prev: "Previous period", prev_year: "Same period last year", prior_ytd: "Prior year to date" };
const MAX_PERIOD_COLS = 12;
// Dimensions the P&L can be split by — the ones its filters offer.
const SPLIT_DIMS = ["loc", "dept", "cc", "proj"];
const PL_CODES = new Set(plAccounts().map((a) => a.code));
const columnLabel = (mode) => (mode.startsWith("dim:") ? `By ${(DIM_BY_KEY[mode.slice(4)]?.label || mode.slice(4)).toLowerCase()}` : COLUMN_LABELS[mode]);

// Opens on year to date the first time (DualEntry does the same); after that,
// on the last preset this user picked. A custom range isn't remembered.
const DEFAULTS = {
  periodChoice: { key: "ytd" },
  colMode: "total",
  compare: "none",
  dims: {},
  showZero: false,
  // % of revenue on every line is off by default: DualEntry only offers it as
  // a custom formula column and Accurate / Jurnal don't show it; the margin
  // rows already carry gross, operating and net margin. QBO / NetSuite users
  // can turn it on in Report settings.
  showPct: false,
  unit: 1,
  lang: "id",
};

// Report settings (DualEntry's gear): how the report is laid out and printed.
function SettingsPopover({ showZero, onShowZero, showPct, onShowPct, unit, onUnit, lang, onLang, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const units = [[1, "Rupiah"], [1000, "Thousands"], [1000000, "Millions"]];
  const langs = [["id", "Bahasa Indonesia"], ["en", "English"]];
  return (
    <div className="lg-popover tb-settings-pop pl-settings-pop" ref={ref}>
      <div className="lg-popover-section-lbl">Report format</div>
      <label className="tb-switch-row">
        <span>Exclude zero balance</span>
        <input type="checkbox" className="tb-switch" checked={!showZero} onChange={(e) => onShowZero(!e.target.checked)} />
      </label>
      <label className="tb-switch-row">
        <span>% of revenue column</span>
        <input type="checkbox" className="tb-switch" checked={showPct} onChange={(e) => onShowPct(e.target.checked)} />
      </label>
      <div className="lg-popover-section-lbl">Amounts in</div>
      <div className="lg-popover-list">
        {units.map(([k, lbl]) => (
          <button key={k} className={`lg-popover-item${unit === k ? " selected" : ""}`} onClick={() => onUnit(k)}>
            <span>{lbl}</span>{unit === k && <Check />}
          </button>
        ))}
      </div>
      <div className="lg-popover-section-lbl">Labels in print and Excel</div>
      <div className="lg-popover-list">
        {langs.map(([k, lbl]) => (
          <button key={k} className={`lg-popover-item${lang === k ? " selected" : ""}`} onClick={() => onLang(k)}>
            <span>{lbl}</span>{lang === k && <Check />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function ProfitLossPage() {
  const navigate = useNavigate();
  const { entries } = useJournalEntries();
  const { fiscalYearStart } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { valuesOf } = useDimensions();

  const storeKey = (what) => `klay.profitLoss.${what}.${user?.id || "anon"}`;

  const [periodChoice, setPeriodChoice] = useState(() => {
    const k = loadLocal(storeKey("period"), null);
    return k ? { key: k } : DEFAULTS.periodChoice;
  });
  const [colMode, setColMode] = useState(DEFAULTS.colMode);
  const [compare, setCompare] = useState(DEFAULTS.compare);
  const [dims, setDims] = useState(DEFAULTS.dims);
  const [showZero, setShowZero] = useState(DEFAULTS.showZero);
  const [showPct, setShowPct] = useState(DEFAULTS.showPct);
  const [unit, setUnit] = useState(DEFAULTS.unit);
  const [lang, setLang] = useState(DEFAULTS.lang);
  // Collapsed groups, remembered per user (DualEntry keeps the last expansion
  // level). Everything starts open, as on the Trial Balance.
  const [collapsed, setCollapsed] = useState(() => new Set(loadLocal(storeKey("collapsed"), [])));
  useEffect(() => { saveLocal(storeKey("collapsed"), [...collapsed]); }, [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState("");
  // A row the user clicked to keep their place across the columns.
  const [focusCode, setFocusCode] = useState(null);

  const [openPop, setOpenPop] = useState(null); // period | columns | compare | dim | settings | views | export
  const [dimEdit, setDimEdit] = useState(null); // the dimension key being edited, or null to add one
  const togglePop = (k) => setOpenPop((p) => (p === k ? null : k));
  const closePop = () => setOpenPop(null);

  const [views, setViews] = useState(() => loadLocal(storeKey("views"), []));
  useEffect(() => { setViews(loadLocal(storeKey("views"), [])); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const persistViews = (next) => { setViews(next); saveLocal(storeKey("views"), next); };

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1800);
  };

  // ── Period ────────────────────────────────────────────────────────────────
  const presets = useMemo(() => {
    const base = periodPresets({ fiscalYearStart });
    const tq = base.find((p) => p.key === "this_quarter");
    const out = [...base];
    if (tq) {
      // The full fiscal quarter before this one.
      const [y, m] = tq.from.split("-").map(Number);
      const t = y * 12 + (m - 1) + 2;
      const qEnd = monthEnd(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`);
      const lq = previousPeriod(tq.from, qEnd);
      out.splice(out.indexOf(tq) + 1, 0, { key: "last_quarter", label: "Last quarter", from: lq.from, to: lq.to });
    }
    // Anchored to the period lock, so a saved view rolls forward on its own.
    if (closedThrough) {
      const to = monthEnd(`${closedThrough}-01`);
      out.push({ key: "locked", label: "Through last locked period", from: fiscalYearStartFor(to, fiscalYearStart), to });
    } else {
      out.push({ key: "locked", label: "Through last locked period", disabled: true, hint: "no period locked yet", title: "Lock a period in the close to use this." });
    }
    return out;
  }, [fiscalYearStart, closedThrough]);

  const period = useMemo(() => {
    if (periodChoice.key === "custom") return { ...periodChoice, label: "Custom" };
    const p = presets.find((x) => x.key === periodChoice.key && !x.disabled) || presets.find((x) => x.key === "ytd");
    return { key: p.key, from: p.from, to: p.to, label: p.label };
  }, [periodChoice, presets]);
  useEffect(() => { if (period.key !== "custom") saveLocal(storeKey("period"), period.key); }, [period.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { from, to } = period;
  const periodRange = rangeLabel(from, to);

  // ── Dimension filters ─────────────────────────────────────────────────────
  const dimList = Object.entries(dims).filter(([, v]) => v);
  const lineFilter = useMemo(() => {
    const active = Object.entries(dims).filter(([, v]) => v);
    if (!active.length) return null;
    return (je, l) => { const d = lineDimensions(je, l); return active.every(([k, v]) => d[k] === v); };
  }, [dims]);

  // ── Layout: one at a time ───────────────────────────────────────────────
  const monthPieces = useMemo(() => splitPeriod(from, to, "month", fiscalYearStart), [from, to, fiscalYearStart]);
  const quarterPieces = useMemo(() => splitPeriod(from, to, "quarter", fiscalYearStart), [from, to, fiscalYearStart]);
  // Split by a dimension: one column per value with activity in the period
  // (after the filters), an Untagged column for P&L lines without a value, so
  // the columns add up to Total — Jurnal's "Non-Departemen" column; DualEntry
  // and QBO have no such column and their split doesn't visibly tie.
  const dimActivity = useMemo(() => {
    const out = Object.fromEntries(SPLIT_DIMS.map((k) => [k, { values: new Set(), untagged: false }]));
    for (const je of entries) {
      if (je.status !== "posted" || je.je_date < from || je.je_date > to) continue;
      for (const l of je.lines || []) {
        if (!PL_CODES.has(l.account_code) || !(Number(l.debit) || Number(l.credit))) continue;
        if (lineFilter && !lineFilter(je, l)) continue;
        const d = lineDimensions(je, l);
        for (const k of SPLIT_DIMS) { if (d[k]) out[k].values.add(d[k]); else out[k].untagged = true; }
      }
    }
    return out;
  }, [entries, from, to, lineFilter]);
  const splitValues = (k) => {
    const seen = dimActivity[k].values;
    const known = valuesOf(k).filter((v) => seen.has(v));
    return [...known, ...[...seen].filter((v) => !known.includes(v)).sort()];
  };
  const splitKeyOf = (mode) => (mode.startsWith("dim:") ? mode.slice(4) : null);
  // A split can't run on a dimension that is also filtered (one value left).
  const splitBlocked = (k) => !!dims[k] || splitValues(k).length > MAX_PERIOD_COLS;
  const tooMany = { month: monthPieces.length > MAX_PERIOD_COLS, quarter: quarterPieces.length > MAX_PERIOD_COLS };
  const colEff = colMode === "total" || tooMany[colMode] || (splitKeyOf(colMode) && splitBlocked(splitKeyOf(colMode))) ? "total" : colMode;
  const splitKey = splitKeyOf(colEff);
  const multi = colEff !== "total";
  const compareRanges = useMemo(() => ({
    prev: previousPeriod(from, to),
    prev_year: { from: sameDayLastYear(from), to: sameDayLastYear(to) },
    prior_ytd: { from: fiscalYearStartFor(sameDayLastYear(to), fiscalYearStart), to: sameDayLastYear(to) },
  }), [from, to, fiscalYearStart]);
  const compRange = !multi && compare !== "none" ? compareRanges[compare] : null;
  const compLabel = compRange ? rangeLabel(compRange.from, compRange.to) : "";
  const layout = compRange ? "compare" : splitKey ? "dims" : multi ? "periods" : "total";

  // ── Numbers ───────────────────────────────────────────────────────────────
  // A column's own dimension value narrows the filters further.
  const run = (range, dim) => {
    if (!dim) return computeProfitLoss(entries, range, { lineFilter });
    const own = (je, l) => {
      const v = lineDimensions(je, l)[dim.key];
      return dim.value === UNTAGGED ? !v : v === dim.value;
    };
    return computeProfitLoss(entries, range, { lineFilter: (je, l) => (!lineFilter || lineFilter(je, l)) && own(je, l) });
  };

  // Amount columns for the layout. `main` is the column % of revenue, margins
  // and the status line refer to.
  const amountCols = useMemo(() => {
    const cur = { id: "cur", range: { from, to }, main: true };
    if (layout === "compare") {
      return [
        { ...cur, label: periodRange },
        { id: "cmp", range: compRange, label: compLabel, muted: true },
      ];
    }
    if (layout === "periods") {
      const pieces = colEff === "month" ? monthPieces : quarterPieces;
      return [
        ...pieces.map((p, i) => ({ id: `p${i}`, range: { from: p.from, to: p.to }, label: p.label })),
        { ...cur, label: "Total", id_label: "Jumlah" },
      ];
    }
    if (layout === "dims") {
      const range = { from, to };
      return [
        ...splitValues(splitKey).map((v, i) => ({ id: `d${i}`, range, dim: { key: splitKey, value: v }, label: v })),
        ...(dimActivity[splitKey].untagged
          ? [{ id: "dU", range, dim: { key: splitKey, value: UNTAGGED }, label: "Untagged", id_label: "Tanpa tag", muted: true,
            title: `P&L lines with no ${DIM_BY_KEY[splitKey]?.label || splitKey} — e.g. accounts that don't carry it` }]
          : []),
        { ...cur, label: "Total", id_label: "Jumlah" },
      ];
    }
    return [{ ...cur, label: periodRange }];
  }, [layout, from, to, periodRange, compRange, compLabel, colEff, monthPieces, quarterPieces, splitKey, dimActivity]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const out = {};
    for (const c of amountCols) out[c.id] = run(c.range, c.dim);
    return out;
  }, [amountCols, entries, lineFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const main = results.cur;

  // Display columns: the amounts, then % of revenue after the main column, and
  // the change for a comparison.
  const cells = useMemo(() => {
    const out = [];
    for (const c of amountCols) {
      out.push({ key: c.id, kind: "amt", col: c, label: c.label, id_label: c.id_label || c.label, muted: c.muted, strong: c.main && amountCols.length > 1 });
      if (c.main && showPct) out.push({ key: `${c.id}-pct`, kind: "pct", col: c, label: "% of rev.", id_label: "% pendapatan" });
    }
    if (layout === "compare") {
      out.push({ key: "diff", kind: "diff", label: "Change", id_label: "Perubahan" });
      out.push({ key: "diffPct", kind: "diffPct", label: "Change %", id_label: "Perubahan %" });
    }
    return out;
  }, [amountCols, showPct, layout]);

  // ── Status ────────────────────────────────────────────────────────────────
  const closeState = periodCloseState(from, to, closedThrough);
  const isFinal = closeState === "closed";
  const closedLabel = closedThrough ? monthLabel(`${closedThrough}-01`) : null;
  const unposted = useMemo(() => unpostedInPeriod(entries, { from, to }), [entries, from, to]);
  const tbNet = useMemo(() => netProfitForPeriod({ from, to, entries }).netProfit, [from, to, entries]);
  const partialView = dimList.length > 0;
  const tiesOk = Math.abs(r2(tbNet - main.totals.netProfit)) < 0.5 && main.balanced;

  // ── Rows ──────────────────────────────────────────────────────────────────
  const anyNonZero = (code) => amountCols.some((c) => Math.abs(results[c.id].byCode[code] || 0) >= 0.005);
  // Accounts in a section: zero rows hidden unless asked for (exports use
  // these); the search narrows what's on screen only — totals stay whole.
  // Sales returns & discounts always lists its accounts, even at zero, so the
  // "Less:" line never stands alone (SME, 11 Nov); a company with no such
  // accounts doesn't get the line — nor Net revenue, which would repeat Total
  // revenue.
  const hasContra = main.sections.contra.rows.length > 0;
  const hiddenLine = (line) => !hasContra && (line.key === "contra" || line.key === "netRevenue");
  const visibleRows = (key) => main.sections[key].rows.filter((r) => key === "contra" || showZero || anyNonZero(r.code));
  const q = search.trim().toLowerCase();
  const shownRows = (key) => visibleRows(key).filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  const sectionKeys = PL_LINES.filter((l) => l.kind === "section").map((l) => l.key);
  const totalAccounts = sectionKeys.reduce((n, k) => n + visibleRows(k).length, 0);
  const shownAccounts = sectionKeys.reduce((n, k) => n + shownRows(k).length, 0);

  // The group tree for Expand / Collapse one level: every section is a group;
  // Selling and G&A sit under an Operating expenses group.
  const nestedKeys = PL_LINES.filter((l) => l.kind === "section" && l.nested).map((l) => l.key);
  const levelNodes = [
    ...sectionKeys.filter((k) => !nestedKeys.includes(k) && shownRows(k).length).map((k) => ({ id: k, depth: 0 })),
    ...(nestedKeys.some((k) => shownRows(k).length) ? [{ id: "opex", depth: 0 }] : []),
    ...nestedKeys.filter((k) => shownRows(k).length).map((k) => ({ id: k, depth: 1, parent: "opex" })),
  ];
  const isShown = (n) => !n.parent || !collapsed.has(n.parent);
  const closedShown = levelNodes.filter((n) => isShown(n) && collapsed.has(n.id));
  const openShown = levelNodes.filter((n) => isShown(n) && !collapsed.has(n.id));
  const toExpand = closedShown.filter((n) => n.depth === Math.min(...closedShown.map((x) => x.depth)));
  const toCollapse = openShown.filter((n) => n.depth === Math.max(...openShown.map((x) => x.depth)));
  const setLevel = (nodes, open) => setCollapsed((prev) => {
    const s = new Set(prev);
    nodes.forEach((n) => (open ? s.delete(n.id) : s.add(n.id)));
    return s;
  });
  const toggleGroup = (id) => setCollapsed((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  // A cell's value. `src` is an account code (account row) or a statement line.
  const amountOf = (colId, src) => {
    const res = results[colId];
    if (!res) return null;
    return typeof src === "string" ? res.byCode[src] ?? 0 : lineValue(res, src);
  };
  const isMarginLine = (src) => typeof src !== "string" && src.kind === "margin";
  const cellValue = (cell, src) => {
    const margin = isMarginLine(src);
    if (cell.kind === "amt") return amountOf(cell.col.id, src);
    if (cell.kind === "pct") {
      if (margin) return null;
      const v = amountOf("cur", src);
      return main.totals.netRevenue ? v / main.totals.netRevenue : null;
    }
    const cur = amountOf("cur", src);
    const prev = amountOf("cmp", src);
    if (cell.kind === "diff") return margin ? (cur == null || prev == null ? null : cur - prev) : change(cur, prev).diff;
    if (cell.kind === "diffPct") return margin ? null : change(cur, prev).pct;
    return null;
  };
  const cellText = (cell, src) => {
    const v = cellValue(cell, src);
    const margin = isMarginLine(src);
    if (cell.kind === "pct" || cell.kind === "diffPct") return v == null ? (margin ? "" : "—") : pct(v);
    if (margin) return cell.kind === "diff" ? pp(v) : pct(v);
    return num(v, unit);
  };

  // ── Drill: the General Ledger for the account, the column's dates and the
  // same dimension filter. One whole month goes as that month.
  // A dimension column adds its own value (or Untagged).
  const glUrl = (code, range, dim = null) => {
    const qs = new URLSearchParams({ account: code });
    const whole = range.from.slice(0, 7) === range.to.slice(0, 7) && range.from.endsWith("-01") && range.to === monthEnd(range.from);
    if (whole) qs.set("period", range.from.slice(0, 7));
    else { qs.set("period", "custom"); qs.set("from", range.from); qs.set("to", range.to); }
    for (const [k, v] of dimList) qs.set(`dim_${k}`, v);
    if (dim) qs.set(`dim_${dim.key}`, dim.value);
    return `/reports/general-ledger?${qs}`;
  };

  // ── Views ─────────────────────────────────────────────────────────────────
  const viewState = { periodChoice: period.key === "custom" ? periodChoice : { key: period.key }, colMode, compare, dims, showZero, showPct, unit, lang };
  const viewSig = JSON.stringify(viewState);
  // Views saved before the Adjustments control was removed still carry `adjMode`; it's ignored.
  const activeViewId = views.find((v) => JSON.stringify({ ...v.state, adjMode: undefined }) === viewSig)?.id || null;
  const applyState = (s) => {
    setPeriodChoice(s.periodChoice || DEFAULTS.periodChoice);
    setColMode(s.colMode || DEFAULTS.colMode);
    setCompare(s.compare || DEFAULTS.compare);
    setDims(s.dims || {});
    setShowZero(!!s.showZero);
    setShowPct(s.showPct ?? DEFAULTS.showPct);
    setUnit(s.unit || DEFAULTS.unit);
    setLang(s.lang || DEFAULTS.lang);
  };
  const applyView = (v) => { applyState(v.state); closePop(); showToast(`View “${v.name}” applied`); };
  const saveView = (name) => {
    const existing = views.find((v) => v.name.toLowerCase() === name.toLowerCase());
    const saved = { id: existing?.id || `v${Date.now()}`, name, state: viewState };
    persistViews(existing ? views.map((v) => (v.id === existing.id ? saved : v)) : [...views, saved]);
    showToast(existing ? `View “${name}” updated` : `View “${name}” saved`);
  };
  const deleteView = (id) => persistViews(views.filter((v) => v.id !== id));
  const isDefault = JSON.stringify({ ...viewState, periodChoice: undefined }) === JSON.stringify({ ...DEFAULTS, periodChoice: undefined }) && period.key === "ytd" && !search.trim();
  const resetAll = () => { applyState(DEFAULTS); setSearch(""); };

  // ── Descriptions ──────────────────────────────────────────────────────────
  const dimText = dimList.map(([k, v]) => `${DIM_BY_KEY[k]?.label || k}: ${v}`).join(" · ");
  const layoutNote = {
    compare: `Compared with ${COMPARE_LABELS[compare].toLowerCase()} (${compLabel})`,
    periods: columnLabel(colEff),
    dims: `${columnLabel(colEff)}, with Untagged`,
    total: null,
  }[layout];
  const viewNote = [layoutNote, dimText ? `Filtered to ${dimText}` : null].filter(Boolean).join(" · ");
  const unitInfo = UNITS[unit];
  const statusWord = (l) => (isFinal ? "Final" : l === "id" ? "Sementara" : "Preliminary");

  // ── Export ────────────────────────────────────────────────────────────────
  // Rows in statement order, with every visible account under its section.
  const exportItems = () => {
    const items = [];
    for (const line of PL_LINES) {
      if (hiddenLine(line)) continue;
      if (line.kind === "section") {
        const sec = main.sections[line.key];
        const rows = visibleRows(line.key);
        items.push({ type: "secHead", line, label: sec.label, id: sec.id });
        rows.forEach((r) => items.push({ type: "acct", line, code: r.code, label: r.name, id: r.name }));
        const strip = (s) => s.replace(/^Less: /, "").replace(/^Dikurangi: /, "");
        items.push({ type: "secTotal", line, label: `Total ${strip(sec.label).toLowerCase()}`, id: `Jumlah ${strip(sec.id).toLowerCase()}` });
      } else {
        items.push({ type: line.kind, line, label: line.label, id: line.id });
      }
    }
    return items;
  };
  const L = (item) => (lang === "id" ? item.id : item.label);
  const exportBase = exportName("profit-loss", from, to);

  function exportXlsx() {
    closePop();
    const runAt = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const items = exportItems();
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }],
      [{ v: lang === "id" ? "Laporan Laba Rugi" : "Profit & Loss", s: "title" }],
      [longRange(from, to, lang)],
      [{ v: `(${unitInfo[lang === "id" ? "id" : "en"]})`, s: "muted" }],
      [{ v: [statusWord(lang), viewNote].filter(Boolean).join(" · "), s: "muted" }],
      [{ v: `Run ${runAt}${user?.name ? ` by ${user.name}` : ""}`, s: "muted" }],
      [],
      [{ v: lang === "id" ? "Kode" : "Code", s: "head" }, { v: lang === "id" ? "Keterangan" : "Line", s: "head" },
        ...cells.map((c) => ({ v: lang === "id" ? c.id_label : c.label, s: "headNum" }))],
    ];
    const freeze = rows.length;
    const first = rows.length + 1; // 1-based row of the first item
    // Where each section total, subtotal and margin lands.
    const at = {};
    items.forEach((it, i) => {
      if (it.type === "secTotal" || it.type === "subtotal" || it.type === "margin") at[it.line.key] = first + i;
    });
    // No returns & discounts line: total revenue is the net revenue.
    if (!at.netRevenue) at.netRevenue = at.revenue;
    const secStart = {};
    items.forEach((it, i) => { if (it.type === "secHead") secStart[it.line.key] = first + i + 1; });
    const cellCol = (k) => colName(2 + cells.findIndex((c) => c.key === k));
    const FORMULAS = {
      netRevenue: (c) => `${c}${at.revenue}-${c}${at.contra}`,
      grossProfit: (c) => `${c}${at.netRevenue}-${c}${at.cogs}`,
      opex: (c) => `${c}${at.selling}+${c}${at.ga}`,
      operatingProfit: (c) => `${c}${at.grossProfit}-${c}${at.opex}`,
      profitBeforeTax: (c) => `${c}${at.operatingProfit}+${c}${at.otherIncome}-${c}${at.otherExpense}`,
      netProfit: (c) => `${c}${at.profitBeforeTax}-${c}${at.tax}`,
    };
    const scaled = (v) => (v == null ? null : r2(v / unit));
    items.forEach((it, i) => {
      const rowNo = first + i;
      const bold = it.type === "secTotal" || it.type === "subtotal";
      const label = it.type === "acct" ? `   ${L(it)}` : it.type === "margin" ? `   ${L(it)}` : L(it);
      const row = [it.type === "acct" ? it.code : "", { v: label, s: bold || it.type === "secHead" || it.type === "heading" ? "bold" : it.type === "margin" ? "muted" : "text" }];
      if (it.type === "secHead" || it.type === "heading") { rows.push(row); return; }
      const src = it.type === "acct" ? it.code : it.line;
      for (const c of cells) {
        const colL = cellCol(c.key);
        if (c.kind === "amt") {
          const v = cellValue(c, src);
          if (it.type === "acct") row.push(v ? { v: scaled(v), s: "num" } : null);
          else if (it.type === "secTotal") {
            const s0 = secStart[it.line.key];
            row.push(rowNo > s0 ? { f: `SUM(${colL}${s0}:${colL}${rowNo - 1})`, v: scaled(v), s: "numBold" } : { v: scaled(v) || 0, s: "numBold" });
          } else if (it.type === "subtotal") row.push({ f: FORMULAS[it.line.key](colL), v: scaled(v), s: "numBold" });
          else if (it.type === "margin") row.push({ f: `IF(${colL}${at.netRevenue}=0,"",${colL}${at[it.line.of]}/${colL}${at.netRevenue})`, v: v ?? null, s: "pct" });
        } else if (c.kind === "pct") {
          if (it.type === "margin") { row.push(null); continue; }
          const m = cellCol("cur");
          row.push({ f: `IF(${m}$${at.netRevenue}=0,"",${m}${rowNo}/${m}$${at.netRevenue})`, v: cellValue(c, src), s: bold ? "pctBold" : "pct" });
        } else if (c.kind === "diff") {
          const a = cellCol("cur"), b = cellCol("cmp");
          row.push({ f: `${a}${rowNo}-${b}${rowNo}`, v: it.type === "margin" ? cellValue(c, src) : scaled(cellValue(c, src)), s: it.type === "margin" ? "pct" : bold ? "numBold" : "num" });
        } else if (c.kind === "diffPct") {
          if (it.type === "margin") { row.push(null); continue; }
          const a = cellCol("cur"), b = cellCol("cmp");
          row.push({ f: `IF(${b}${rowNo}=0,"",(${a}${rowNo}-${b}${rowNo})/ABS(${b}${rowNo}))`, v: cellValue(c, src), s: bold ? "pctBold" : "pct" });
        }
      }
      rows.push(row);
    });
    const sign = lang === "id" ? ["Disiapkan oleh", "Diperiksa oleh", "Disetujui oleh", "Tanggal:", "Nama"] : ["Prepared by", "Reviewed by", "Approved by", "Date:", "Name"];
    rows.push([], []);
    rows.push(["", { v: sign[0], s: "bold" }, { v: sign[1], s: "bold" }, { v: sign[2], s: "bold" }]);
    rows.push([], ["", user?.name || sign[4], sign[4], sign[4]], ["", { v: sign[3], s: "muted" }, { v: sign[3], s: "muted" }, { v: sign[3], s: "muted" }]);
    downloadXlsx(exportBase.replace(/\.csv$/, ".xlsx"), {
      sheet: lang === "id" ? "Laba Rugi" : "Profit & Loss",
      rows,
      widths: [10, 46, ...cells.map((c) => (c.kind === "pct" || c.kind === "diffPct" ? 12 : 18))],
      freeze,
    });
    showToast("Profit & Loss exported to Excel");
  }

  function exportCsv() {
    closePop();
    const items = exportItems().filter((it) => it.type !== "heading");
    downloadCsv(exportBase, {
      header: [
        ...reportHeader({ report: lang === "id" ? "Laporan Laba Rugi" : "Profit & Loss", period: longRange(from, to, lang), runBy: user?.name }),
        [unitInfo[lang === "id" ? "id" : "en"]],
        ...(viewNote ? [[viewNote]] : []),
      ],
      columns: [
        { label: lang === "id" ? "Kode" : "Code", value: (it) => (it.type === "acct" ? it.code : "") },
        { label: lang === "id" ? "Keterangan" : "Line", value: (it) => L(it) },
        ...cells.map((c) => ({
          label: `${lang === "id" ? c.id_label : c.label}${c.kind === "pct" || c.kind === "diffPct" ? " (%)" : ""}`,
          value: (it) => {
            if (it.type === "secHead") return "";
            const src = it.type === "acct" ? it.code : it.line;
            const v = cellValue(c, src);
            if (v == null) return "";
            if (c.kind === "pct" || c.kind === "diffPct" || it.type === "margin") return r2(v * 100);
            return r2(v / unit);
          },
        })),
      ],
      rows: items,
    });
    showToast("Profit & Loss exported to CSV");
  }
  const exportPrint = () => { closePop(); setTimeout(printReport, 50); };

  // ── Toolbar items ─────────────────────────────────────────────────────────
  const columnItems = [
    { k: "total", lbl: "Total only", hint: periodRange },
    { k: "month", lbl: "By month", hint: tooMany.month ? `more than ${MAX_PERIOD_COLS} months` : plural(monthPieces.length, "column"),
      disabled: tooMany.month || !!compRange, title: compRange ? "Turn Compare off to split the period into columns." : tooMany.month ? "Pick a shorter period, or split by quarter." : undefined },
    { k: "quarter", lbl: "By quarter", hint: tooMany.quarter ? `more than ${MAX_PERIOD_COLS} quarters` : plural(quarterPieces.length, "column"),
      disabled: tooMany.quarter || !!compRange, title: compRange ? "Turn Compare off to split the period into columns." : undefined },
    ...SPLIT_DIMS.map((k) => {
      const label = DIM_BY_KEY[k]?.label || k;
      const n = splitValues(k).length;
      const filtered = !!dims[k];
      return {
        k: `dim:${k}`, lbl: columnLabel(`dim:${k}`),
        hint: filtered ? "filtered" : n > MAX_PERIOD_COLS ? `more than ${MAX_PERIOD_COLS} values` : n ? `${plural(n, "value")}${dimActivity[k].untagged ? " + Untagged" : ""}` : "no values",
        disabled: !!compRange || filtered || !n || n > MAX_PERIOD_COLS,
        title: compRange ? "Turn Compare off to split by a dimension."
          : filtered ? `Remove the ${label} filter to split by ${label.toLowerCase()}.`
            : !n ? `No P&L lines carry a ${label.toLowerCase()} in this period.` : undefined,
      };
    }),
  ];
  const compareItems = [
    { k: "none", lbl: "No comparison" },
    ...["prev", "prev_year", "prior_ytd"].map((k) => ({ k, lbl: COMPARE_LABELS[k], hint: rangeLabel(compareRanges[k].from, compareRanges[k].to) })),
  ];
  const usedDimKeys = dimList.map(([k]) => k);
  // Filtering on the dimension the columns split by would leave one column.
  const addableKeys = ["loc", "proj", "cc", "dept"].filter((k) => k !== splitKey && (!usedDimKeys.includes(k) || k === dimEdit));

  // ── Render ────────────────────────────────────────────────────────────────
  const unitHead = unitInfo.head;
  const INDENT = 18;
  const GL_ICON = <svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>;
  const Chevron = ({ closed }) => <svg className={`lg-group-chevron${closed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>;
  const dash = <span className="lg-cell-em-dash">—</span>;

  // The amount cells of a row, in the Trial Balance's column style. On an
  // account row an amount also opens the ledger for that column's dates.
  // A loss on a profit line (or its margin) is red, so it reads at a glance.
  const amountCells = (src, { code, show = true } = {}) => cells.map((cell) => {
    const v = show ? cellValue(cell, src) : null;
    const loss = typeof src !== "string" && src.profit && cell.kind === "amt" && v != null && v < (src.kind === "margin" ? -0.0005 : -0.005);
    const cls = `lg-cell-total${cell.strong ? " tb-cell-end" : ""}${cell.muted ? " tb-cell-muted" : ""}${cell.kind !== "amt" ? " pl-cell-sub" : ""}${loss ? " pl-loss" : ""}`;
    if (!show) return <div key={cell.key} className={cls} />;
    const text = cellText(cell, src);
    const body = text === "—" ? dash : text;
    if (code && cell.kind === "amt" && v && Math.abs(v) >= 0.005) {
      const c = cell.col;
      const scope = [dimText, c.dim ? `${DIM_BY_KEY[c.dim.key]?.label || c.dim.key}: ${c.label}` : ""].filter(Boolean).join(" · ");
      return (
        <div key={cell.key} className={cls}>
          <Link className="pl-amt-link" to={glUrl(code, c.range, c.dim)} onClick={(e) => e.stopPropagation()}
            title={`Open ${code} in the General Ledger for ${rangeLabel(c.range.from, c.range.to)}${scope ? ` (${scope})` : ""}`}>{body}</Link>
        </div>
      );
    }
    return <div key={cell.key} className={cls}>{body}</div>;
  });

  // An account row: code, name (the link to the General Ledger for the
  // report's dates, with a "General Ledger" button on hover), numbers.
  // Clicking elsewhere only highlights the row, as on the Trial Balance.
  const AcctRow = ({ r, isAlt, depth }) => {
    const to = glUrl(r.code, { from, to: period.to });
    const onRowClick = () => {
      if (window.getSelection?.().toString()) return;
      setFocusCode((c) => (c === r.code ? null : r.code));
    };
    return (
      <div className={`lg-row tb-acct-row${isAlt ? " alt" : ""}${focusCode === r.code ? " selected" : ""}`} onClick={onRowClick}>
        <div className="tb-cell-name" style={{ paddingLeft: (depth + 1) * INDENT }}>
          <span className="tb-code">{r.code}</span>
          <Link className="tb-name tb-acct-link" to={to} title={`Open ${r.name} in the General Ledger`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
          <Link className="tb-gl-btn no-print" to={to} onClick={(e) => e.stopPropagation()} aria-label={`Open ${r.code} ${r.name} in the General Ledger`}>
            General Ledger {GL_ICON}
          </Link>
        </div>
        {amountCells(r.code, { code: r.code })}
      </div>
    );
  };

  // A section is a group: one row when collapsed, its total on the same line;
  // open, its accounts then a "Total …" row. A section with nothing in it
  // stays one row so the statement keeps its shape.
  const Group = ({ id, label, idLabel, src, rows, subgroups = [], depth = 0 }) => {
    const count = rows.length + subgroups.reduce((n, g) => n + g.rows.length, 0);
    const empty = count === 0;
    const isClosed = collapsed.has(id) || empty;
    const strip = (s) => s.replace(/^Less: /, "").replace(/^Dikurangi: /, "");
    return (
      <Fragment>
        <div className={`lg-row tb-group-row${depth ? " tb-subgroup" : ""}${isClosed ? " collapsed" : ""}${empty ? " pl-group-empty" : ""}`}
          onClick={empty ? undefined : () => toggleGroup(id)} aria-expanded={empty ? undefined : !isClosed} title={empty ? "No activity in this period" : isClosed ? "Expand" : "Collapse"}>
          <div className="tb-group-name" style={{ paddingLeft: depth * INDENT }}>
            <Chevron closed={isClosed} />
            <span className="lg-group-lbl"><Lbl en={label} id={idLabel} lang={lang} /></span>
          </div>
          {amountCells(src, { show: isClosed })}
        </div>
        {!isClosed && rows.map((r, i) => <AcctRow key={r.code} r={r} isAlt={i % 2 === 1} depth={depth} />)}
        {!isClosed && subgroups.map((g) => <Group key={g.id} {...g} depth={depth + 1} />)}
        {!isClosed && (
          <div className="lg-row subtotal pl-group-total">
            <div className="tb-total-lbl" style={{ paddingLeft: depth * INDENT }}>
              <Lbl en={`Total ${strip(label).toLowerCase()}`} id={`Jumlah ${strip(idLabel).toLowerCase()}`} lang={lang} />
            </div>
            {amountCells(src)}
          </div>
        )}
      </Fragment>
    );
  };
  const sectionGroup = (key) => {
    const line = PL_LINES.find((l) => l.kind === "section" && l.key === key);
    const sec = main.sections[key];
    return { id: key, label: sec.label, idLabel: sec.id, src: line, rows: shownRows(key) };
  };

  // The statement in order: groups, subtotals and margin rows.
  const statementRows = () => {
    const out = [];
    for (const line of PL_LINES) {
      if (hiddenLine(line)) continue;
      if (line.kind === "section" && !line.nested) {
        out.push(<Group key={line.key} {...sectionGroup(line.key)} />);
      } else if (line.kind === "heading") {
        const opexLine = PL_LINES.find((l) => l.key === "opex");
        out.push(<Group key="opex" id="opex" label={line.label} idLabel={line.id} src={opexLine} rows={[]} subgroups={nestedKeys.map(sectionGroup)} />);
      } else if (line.kind === "subtotal" && !line.minor) {
        out.push(
          <div key={line.key} className={`lg-row subtotal pl-subtotal${line.grand ? " tb-total-row pl-grand" : ""}`}>
            <div className="tb-total-lbl"><Lbl en={line.label} id={line.id} lang={lang} /></div>
            {amountCells(line)}
          </div>,
        );
      } else if (line.kind === "margin") {
        out.push(
          <div key={line.key} className="lg-row pl-margin-row">
            <div className="pl-margin-lbl"><Lbl en={line.label} id={line.id} lang={lang} /></div>
            {amountCells(line)}
          </div>,
        );
      }
    }
    return out;
  };

  return (
    <div className="lg-page tb-report pl-page">
      <div className="lg-scroll-container">
        {/* ── Print header (print / PDF only) ───────────────────────── */}
        <div className="print-only tb-print-head">
          <div className="tb-print-company">{COMPANY.legalName}</div>
          <div className="tb-print-title">{lang === "id" ? "Laporan Laba Rugi" : "Profit & Loss"}</div>
          <div className="tb-print-period">{longRange(from, to, lang)}</div>
          <div className="tb-print-period">({unitInfo[lang === "id" ? "id" : "en"]}) · {statusWord(lang)}{viewNote ? ` · ${viewNote}` : ""}</div>
        </div>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Profit &amp; Loss</h1>
            </div>
            <div className="lg-head-actions no-print">
              <div className="lg-meta-btn-wrap">
                <button className={`lg-btn-ghost${activeViewId ? " tb-btn-on" : ""}`} onClick={() => togglePop("views")} aria-haspopup="dialog" aria-expanded={openPop === "views"}>
                  <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                  {activeViewId ? views.find((v) => v.id === activeViewId)?.name : "Views"}
                </button>
                {openPop === "views" && (
                  <ViewsPopover views={views} activeId={activeViewId} onApply={applyView} onDelete={deleteView} onSave={saveView} onClose={closePop}
                    emptyText="No saved views yet. Set the period, columns, comparison and filters the way you like, then save them here. A preset period rolls forward on its own." />
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

          {/* Status — Final or Preliminary, what isn't posted yet, and whether net profit ties to the TB */}
          <div className="tb-status no-print">
            <span className={`tb-status-chip ${isFinal ? "closed" : "open"}`}>{isFinal ? "Final" : "Preliminary"}</span>
            <span>
              {closeState === "closed" && `Books are closed through ${closedLabel} — these figures are final.`}
              {closeState === "partial" && `Closed through ${closedLabel}; later months are still open and may change.`}
              {closeState === "open" && "This period is still open — figures may change as journals are posted."}
            </span>
            {unposted.length > 0 && (
              <>
                <span className="tb-status-sep">·</span>
                <button className="tb-status-link" onClick={() => navigate("/journal-entry")}>
                  {plural(unposted.length, "draft or pending journal")} dated in the period {unposted.length === 1 ? "isn't" : "aren't"} included
                </button>
              </>
            )}
            <span className="tb-status-sep">·</span>
            {partialView ? (
              <span className="tb-foot" title="The Trial Balance tie-out uses every posted journal and every line.">Tie-out to the Trial Balance not checked while filtered</span>
            ) : (
              <span className={`tb-foot ${tiesOk ? "ok" : "off"}`} title="Net profit here against the sum of P&L accounts in the Trial Balance for the same dates.">
                <span aria-hidden="true">{tiesOk ? "✓" : "✕"}</span> {tiesOk ? "Net profit/(loss) ties to the Trial Balance" : `Net profit/(loss) is off the Trial Balance by ${rp(r2(tbNet - main.totals.netProfit))}`}
              </span>
            )}
            <span className="tb-status-sep">·</span>
            <span className="tb-unit-note">{unitInfo.en}</span>
          </div>
        </div>

        <div className="lg-table-wrap pl-wrap">
          <div className="lg-card lg-table-tb pl-card" style={{ "--tb-n": cells.length }}>
            {/* ── Toolbar: what the report covers ─────────────────────── */}
            <div className="lg-filter-row no-print tb-filter-row pl-toolbar">
              <div className="tb-toolbar-left">
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn tb-period-btn" onClick={() => togglePop("period")} aria-haspopup="dialog" aria-expanded={openPop === "period"}>
                    {CAL}
                    <span className="meta-val">{period.label}</span>
                    <span className="meta-lbl">{periodRange}</span>
                  </button>
                  {openPop === "period" && <PeriodPopover presets={presets} period={period} onPick={(c) => { setPeriodChoice(c); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${multi ? " active" : ""}`} onClick={() => togglePop("columns")} aria-haspopup="menu" aria-expanded={openPop === "columns"}>
                    <span className="meta-lbl">Columns:</span>
                    <span className="meta-val">{columnLabel(colEff)}</span>
                  </button>
                  {openPop === "columns" && <ChoicePopover className="tb-compare-pop" items={columnItems} value={colEff} onPick={(k) => { setColMode(k); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${compRange ? " active" : ""}`} onClick={() => togglePop("compare")} disabled={multi}
                    title={multi ? "Comparison works on a single Total column. Set Columns to Total only to compare." : undefined}
                    aria-haspopup="menu" aria-expanded={openPop === "compare"}>
                    <span className="meta-lbl">Compare:</span>
                    <span className="meta-val">{compRange ? COMPARE_LABELS[compare] : "None"}</span>
                  </button>
                  {openPop === "compare" && <ChoicePopover className="tb-compare-pop" items={compareItems} value={compRange ? compare : "none"} onPick={(k) => { setCompare(k); closePop(); }} onClose={closePop} />}
                </div>
                {dimList.map(([k, v]) => (
                  <div key={k} className="lg-meta-btn-wrap pl-chip-wrap">
                    <button className="lg-meta-btn active pl-chip" onClick={() => { setDimEdit(k); togglePop("dim"); }} title="Change this filter">
                      <span className="meta-lbl">{DIM_BY_KEY[k]?.label || k}:</span>
                      <span className="meta-val">{v}</span>
                    </button>
                    <button className="pl-chip-x" aria-label={`Remove ${DIM_BY_KEY[k]?.label || k} filter`}
                      onClick={() => setDims((d) => { const n = { ...d }; delete n[k]; return n; })}>×</button>
                    {openPop === "dim" && dimEdit === k && (
                      <DimensionPopover value={{ key: k, value: v }} valuesOf={valuesOf} keys={[k]} applyLabel="Apply" clearLabel="Remove filter"
                        note="Only journal lines tagged with this value count. Untagged lines are left out."
                        onApply={(val) => { setDims((d) => { const n = { ...d }; delete n[k]; if (val) n[val.key] = val.value; return n; }); closePop(); }} onClose={closePop} />
                    )}
                  </div>
                ))}
                {addableKeys.length > 0 && (
                  <div className="lg-meta-btn-wrap">
                    <button className="lg-meta-btn pl-add-filter" onClick={() => { setDimEdit(null); togglePop("dim"); }} aria-haspopup="dialog" aria-expanded={openPop === "dim" && !dimEdit}>
                      + Add filter
                    </button>
                    {openPop === "dim" && !dimEdit && (
                      <DimensionPopover value={null} valuesOf={valuesOf} keys={addableKeys} applyLabel="Add filter" clearLabel="Cancel"
                        note="Only journal lines tagged with this value count. Filters on different dimensions all apply."
                        onApply={(val) => { if (val) setDims((d) => ({ ...d, [val.key]: val.value })); closePop(); }} onClose={closePop} />
                    )}
                  </div>
                )}
                <div className="lg-search">
                  <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                  <input placeholder="Search account code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="lg-filter-meta">
                <button className="tb-icon-btn" onClick={() => setLevel(toCollapse, false)} disabled={!toCollapse.length} title="Collapse one level" aria-label="Collapse one level">
                  <svg viewBox="0 0 24 24"><polyline points="7 15 12 10 17 15"/><line x1="5" y1="20" x2="19" y2="20"/></svg>
                </button>
                <button className="tb-icon-btn" onClick={() => setLevel(toExpand, true)} disabled={!toExpand.length} title="Expand one level" aria-label="Expand one level">
                  <svg viewBox="0 0 24 24"><polyline points="7 9 12 14 17 9"/><line x1="5" y1="4" x2="19" y2="4"/></svg>
                </button>
                <div className="lg-meta-btn-wrap">
                  <button className={`tb-icon-btn${openPop === "settings" ? " on" : ""}`} onClick={() => togglePop("settings")} title="Report settings" aria-label="Open report settings" aria-haspopup="dialog" aria-expanded={openPop === "settings"}>
                    {GEAR}
                  </button>
                  {openPop === "settings" && (
                    <SettingsPopover showZero={showZero} onShowZero={setShowZero} showPct={showPct} onShowPct={setShowPct}
                      unit={unit} onUnit={setUnit} lang={lang} onLang={setLang} onClose={closePop} />
                  )}
                </div>
                {!isDefault && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            {/* ── Statement: the Trial Balance's grid, no wider than its
                 columns need, so an amount stays close to its account ── */}
            <div className="pl-statement">
            <div className="lg-col-header">
              <div><Lbl en="Account" id="Akun" lang={lang} /></div>
              {cells.map((c) => (
                <div key={c.key} style={{ textAlign: "right" }} className={c.kind !== "amt" ? "pl-cell-sub" : undefined}
                  title={c.col ? (c.col.title || rangeLabel(c.col.range.from, c.col.range.to)) : undefined}>
                  <Lbl en={c.label} id={c.id_label} lang={lang} />
                  {(c.kind === "amt" || c.kind === "diff") && <span className="pl-th-unit"> ({unitHead})</span>}
                </div>
              ))}
            </div>
            <div>
              {q && shownAccounts === 0 && <div className="lg-empty">No accounts match “{search.trim()}”. The totals below still cover every account.</div>}
              {statementRows()}
            </div>
            </div>
            {!main.balanced && (
              <div className="pl-warn">
                Net profit/(loss) ({num(main.totals.netProfit)}) does not match the sum of P&amp;L accounts ({num(main.netProfitCheck)}).
              </div>
            )}

            {/* ── Sign-off block (print / PDF only) ── */}
            <div className="print-only tb-signoff">
              {(lang === "id" ? [["Disiapkan oleh", user?.name], ["Diperiksa oleh", ""], ["Disetujui oleh", ""]] : [["Prepared by", user?.name], ["Reviewed by", ""], ["Approved by", ""]]).map(([lbl, name]) => (
                <div key={lbl} className="tb-sign">
                  <div className="tb-sign-lbl">{lbl}</div>
                  <div className="tb-sign-line" />
                  <div className="tb-sign-name">{name || (lang === "id" ? "Nama" : "Name")}</div>
                  <div className="tb-sign-date">{lang === "id" ? "Tanggal:" : "Date:"}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="pl-foot no-print">
            Click a group to open or close it. An account&apos;s name opens the General Ledger for the period; an amount opens it for that column&apos;s dates{dimList.length ? ", with the same filters" : ""}.
            {" "}Expenses and deductions are shown as positive amounts and subtracted in the subtotals; negative results are in parentheses.
            {" "}Margins and % of revenue are against net revenue.
          </p>
        </div>
      </div>

      {/* ── Sticky footer ──────────────────────────────────────────── */}
      <div className="lg-footer no-print">
        <div className="lg-footer-left">
          <span><span className="lg-footer-num">{shownAccounts}</span> of {totalAccounts} accounts shown</span>
        </div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Net revenue</span>
          <span className="lg-footer-total">{rp(main.totals.netRevenue)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Net profit/(loss)</span>
          <span className={`lg-footer-total${main.totals.netProfit < -0.005 ? " pl-footer-loss" : ""}`}>{rp(main.totals.netProfit)}</span>
          {main.margins.netMargin != null && <span className="lg-footer-lbl">margin {pct(main.margins.netMargin)}</span>}
          <span className="lg-footer-sep">·</span>
          {partialView ? (
            <span className="tb-balance-flag" title="A dimension filter leaves journal lines out, so the Trial Balance tie-out isn't checked.">Filtered — not checked</span>
          ) : (
            <span className={`tb-balance-flag ${tiesOk ? "ok" : "off"}`}>{tiesOk ? "✓ Ties to the Trial Balance" : `Off the TB by ${rp(Math.abs(r2(tbNet - main.totals.netProfit)))}`}</span>
          )}
        </div>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
