// Reports → Cash Flow (Laporan Arus Kas).
//
// From the competitor benchmark (docs/research/cash-flow/README.md) and the
// Linear scope (P-TRA-36): indirect method; operating, investing and
// financing; every balance-sheet account mapped to a line; net cash flow
// proved against the change in cash on the Balance Sheet; drill-down, Bahasa
// labels, Excel / PDF.
//
// Reuses the Profit & Loss's frame: period presets, Columns (Total only / By
// month / By quarter) one at a time with Compare, the statement grid with a
// sticky line column, the status line with its proofs, print header and
// sign-off, and the Transactions panel for the journals behind an account.
// Lines open to the accounts mapped to them, like a P&L group. The mapping
// itself is a side panel (the panel shell the drill uses), one select per
// account; the default comes from the chart's groups (lib/cashFlow.js).

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import TransactionsPanel from "../components/TransactionsPanel";
import { computeCashFlow, cashEffectLines, cfAccounts, defaultCfLine, CF_LINES, CF_LINE_BY_KEY, CF_SECTIONS, CF_SUBS, CASH_LINE } from "../lib/cashFlow";
import { unpostedInPeriod, change } from "../lib/profitLoss";
import { periodCloseState } from "../lib/trialBalance";
import { periodPresets, rangeLabel, dayLabel, dayBefore, previousPeriod, sameDayLastYear, splitPeriod, monthLabel } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import { ChoicePopover, PeriodPopover, ExportPopover, loadLocal, saveLocal } from "../components/ReportControls";
import { UNITS, num, rp, pct, r2, plural, longDate, forPeriod, Lbl, GEAR, CAL, ARROW, DOWNLOAD, Chevron, FormatPopover, PrintHead, SignOff, signOffRows } from "../components/StatementKit";
import "./modules.css";
import "./invoices-ledger.css";
import "./trial-balance.css";
import "./profit-loss.css";
import "./balance-sheet.css";
import "./statements.css";
import "../components/transactions-panel.css";

const COLUMN_LABELS = { total: "Total only", month: "By month", quarter: "By quarter" };
const COMPARE_LABELS = { none: "None", prev: "Previous period", prev_year: "Same period last year" };
const MAX_COLS = 12;
const DEFAULTS = { period: { key: "ytd" }, colMode: "total", compare: "none", unit: 1, lang: "id", showEmpty: false };
const MAP_KEY = "klay.cashFlow.mapping"; // company-wide in the product; per browser in the prototype

export default function CashFlowPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { entries } = useJournalEntries();
  const { fiscalYearStart } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const storeKey = (what) => `klay.cashFlow.${what}.${user?.id || "anon"}`;

  const [periodChoice, setPeriodChoice] = useState(() => loadLocal(storeKey("period"), DEFAULTS.period));
  const [colMode, setColMode] = useState(DEFAULTS.colMode);
  const [compare, setCompare] = useState(DEFAULTS.compare);
  const [unit, setUnit] = useState(DEFAULTS.unit);
  const [lang, setLang] = useState(DEFAULTS.lang);
  const [showEmpty, setShowEmpty] = useState(DEFAULTS.showEmpty);
  const [expanded, setExpanded] = useState(() => new Set());
  const [mapping, setMapping] = useState(() => loadLocal(MAP_KEY, {}));
  useEffect(() => { saveLocal(MAP_KEY, mapping); }, [mapping]);
  const [openPop, setOpenPop] = useState(null);
  const togglePop = (k) => setOpenPop((p) => (p === k ? null : k));
  const closePop = () => setOpenPop(null);
  const [panel, setPanel] = useState(null); // "map" | { code, colId }
  const closePanel = useCallback(() => setPanel(null), []);
  const [toast, setToast] = useState("");
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  useEffect(() => {
    const p = location.state?.period;
    if (!p) return;
    setPeriodChoice({ key: "custom", from: p.from, to: p.to });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Period and columns ───────────────────────────────────────────────────
  const presets = useMemo(() => periodPresets({ fiscalYearStart }), [fiscalYearStart]);
  const period = useMemo(() => {
    if (periodChoice.key === "custom") return { key: "custom", from: periodChoice.from, to: periodChoice.to, label: "Custom" };
    const p = presets.find((x) => x.key === periodChoice.key) || presets.find((x) => x.key === DEFAULTS.period.key);
    return { key: p.key, from: p.from, to: p.to, label: p.label };
  }, [periodChoice, presets]);
  useEffect(() => { saveLocal(storeKey("period"), period.key === "custom" ? { key: "custom", from: period.from, to: period.to } : { key: period.key }); }, [period.key, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const { from, to } = period;

  const pieces = useMemo(() => ({
    month: splitPeriod(from, to, "month", fiscalYearStart),
    quarter: splitPeriod(from, to, "quarter", fiscalYearStart),
  }), [from, to, fiscalYearStart]);
  const tooFew = { month: pieces.month.length < 2 || pieces.month.length > MAX_COLS, quarter: pieces.quarter.length < 2 };
  const colEff = colMode !== "total" && !tooFew[colMode] ? colMode : "total";
  const multi = colEff !== "total";
  const cmpRange = !multi && compare !== "none"
    ? (compare === "prev" ? previousPeriod(from, to) : { from: sameDayLastYear(from), to: sameDayLastYear(to) })
    : null;

  const amountCols = useMemo(() => {
    const cur = { id: "cur", from, to, main: true, label: rangeLabel(from, to) };
    if (cmpRange) return [cur, { id: "cmp", ...cmpRange, label: rangeLabel(cmpRange.from, cmpRange.to), muted: true }];
    if (multi) {
      const cols = pieces[colEff].map((p, i) => ({ id: `p${i}`, from: p.from, to: p.to, label: p.label, muted: false }));
      return [...cols, { ...cur, label: "Total" }];
    }
    return [cur];
  }, [from, to, cmpRange?.from, cmpRange?.to, multi, colEff, pieces]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const out = {};
    for (const c of amountCols) out[c.id] = computeCashFlow(entries, { from: c.from, to: c.to }, { mapping, fiscalYearStart });
    return out;
  }, [amountCols, entries, mapping, fiscalYearStart]);
  const main = results.cur;

  const cells = useMemo(() => {
    const out = amountCols.map((c) => ({ key: c.id, kind: "amt", col: c, label: c.label, muted: c.muted, strong: c.main && amountCols.length > 1 }));
    if (cmpRange) {
      out.push({ key: "diff", kind: "diff", label: "Change", id_label: "Perubahan" });
      out.push({ key: "diffPct", kind: "diffPct", label: "Change %", id_label: "Perubahan %" });
    }
    return out;
  }, [amountCols, cmpRange]);

  // ── Status ────────────────────────────────────────────────────────────────
  const isFinal = periodCloseState(from, to, closedThrough) === "closed";
  const unposted = useMemo(() => unpostedInPeriod(entries, { from, to }), [entries, from, to]);
  const ties = amountCols.every((c) => results[c.id].ties);
  const unclassified = main.lines.unclassified.accounts.filter((a) => Math.abs(a.amount) >= 0.005);
  const changedMap = Object.keys(mapping).filter((k) => mapping[k]).length;

  // ── Values ────────────────────────────────────────────────────────────────
  // src: { line } | { acct } | { section } | { key: profit|netChange|cashStart|cashEnd }
  const valueOf = (colId, src) => {
    const res = results[colId];
    if (!res) return null;
    if (src.line) return res.lines[src.line].amount;
    if (src.acct) return res.lines[src.inLine].accounts.find((a) => a.code === src.acct)?.amount ?? 0;
    if (src.section) return res.sections[src.section];
    return res[src.key];
  };
  const cellValue = (cell, src) => {
    if (cell.kind === "amt") return valueOf(cell.col.id, src);
    const cur = valueOf("cur", src), prev = valueOf("cmp", src);
    if (cur == null || prev == null) return null;
    return cell.kind === "diff" ? change(cur, prev).diff : change(cur, prev).pct;
  };
  const lineShown = (key) => showEmpty || amountCols.some((c) => Math.abs(results[c.id].lines[key].amount) >= 0.005) || (key === "unclassified" && unclassified.length);

  // ── Drill ─────────────────────────────────────────────────────────────────
  const drillView = (() => {
    if (!panel || panel === "map") return null;
    const col = amountCols.find((c) => c.id === panel.colId) || amountCols.find((c) => c.main);
    const a = cfAccounts().find((x) => x.code === panel.code);
    const lines = cashEffectLines(entries, panel.code, col);
    const amount = results[col.id].lines[panel.line].accounts.find((x) => x.code === panel.code)?.amount || 0;
    return {
      kind: "lines", code: panel.code, name: a?.name || panel.code,
      rangeLabel: `${rangeLabel(col.from, col.to)} · cash effect of posted journals`,
      periods: amountCols.filter((c) => !c.muted || c.id === "cmp").map((c) => ({ id: c.id, label: c.label })),
      periodId: col.id, onPeriod: (id) => setPanel((p) => ({ ...p, colId: id })),
      opening: null, closing: { label: "Cash effect", amount }, lines,
      glTo: `/reports/general-ledger?${new URLSearchParams({ account: panel.code, period: "custom", from: col.from, to: col.to })}`,
      note: "Signed as cash: a credit to this account brought cash in (+), a debit took it out (−).",
    };
  })();
  const isOn = (code, colId) => panel && panel !== "map" && panel.code === code && panel.colId === colId;

  // ── Rows ──────────────────────────────────────────────────────────────────
  const unitHead = UNITS[unit].head;
  const dash = <span className="lg-cell-em-dash">—</span>;
  const Cells = ({ src, show = true, acct = null, inLine = null, link = null, profit = false }) => cells.map((cell) => {
    const v = show ? cellValue(cell, src) : null;
    const cls = `lg-cell-total${cell.strong ? " tb-cell-end" : ""}${cell.muted ? " tb-cell-muted" : ""}${cell.kind !== "amt" ? " pl-cell-sub" : ""}${profit && cell.kind === "amt" && v < -0.005 ? " pl-loss" : ""}`;
    if (!show) return <div key={cell.key} className={cls} />;
    const text = cell.kind === "diffPct" ? pct(v) : num(v, unit);
    const body = text === "—" ? dash : text;
    if (cell.kind === "amt" && v && Math.abs(v) >= 0.005) {
      if (acct) {
        return <div key={cell.key} className={cls}><button type="button" className={`txp-amt${isOn(acct, cell.col.id) ? " on" : ""}`} onClick={() => setPanel({ code: acct, line: inLine, colId: cell.col.id })} title="Show the journal lines behind this cash effect">{body}</button></div>;
      }
      if (link) return <div key={cell.key} className={cls}><Link className="pl-amt-link" {...link(cell.col)}>{body}</Link></div>;
    }
    return <div key={cell.key} className={cls}>{body}</div>;
  });
  const toggle = (k) => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const LineRow = ({ line, depth }) => {
    const open = expanded.has(line.key);
    const accts = main.lines[line.key].accounts.filter((a) => showEmpty || amountCols.some((c) => Math.abs(results[c.id].lines[line.key].accounts.find((x) => x.code === a.code)?.amount || 0) >= 0.005));
    return (
      <Fragment>
        <div className={`lg-row tb-acct-row${open ? " selected" : ""}`} onClick={() => accts.length && toggle(line.key)}>
          <div className="tb-cell-name" style={{ paddingLeft: depth * 18 }}>
            <button type="button" className="cf-line-btn" aria-expanded={open} disabled={!accts.length}>
              <Chevron closed={!open} />
              <span className="tb-name"><Lbl en={line.label} id={line.id} lang={lang} /></span>
              <span className="cf-acct-count no-print">{plural(accts.length, "account")}</span>
            </button>
            {line.key === "unclassified" && accts.length > 0 && (
              <button type="button" className="var-pill no-print open" onClick={(e) => { e.stopPropagation(); setPanel("map"); }} title="These accounts aren't mapped to a cash flow line. Map them so they land in the right activity.">Map accounts</button>
            )}
          </div>
          <Cells src={{ line: line.key }} />
        </div>
        {open && accts.map((a) => (
          <div key={a.code} className="lg-row tb-acct-row">
            <div className="tb-cell-name" style={{ paddingLeft: (depth + 1) * 18 + 14 }}>
              <span className="tb-code">{a.code}</span>
              {a.pl
                ? <span className="tb-name">{a.name}</span>
                : <button type="button" className="tb-name tb-acct-link bs-name-btn" onClick={() => setPanel({ code: a.code, line: line.key, colId: "cur" })}>{a.name}</button>}
              <Link className="tb-gl-btn no-print" to={`/reports/general-ledger?${new URLSearchParams({ account: a.code, period: "custom", from, to })}`}>General Ledger {ARROW}</Link>
            </div>
            {/* A P&L account (gain/loss on disposal) has no cash effect of its
                own to drill: its amount opens the General Ledger. */}
            {a.pl
              ? <Cells src={{ acct: a.code, inLine: line.key }} link={(col) => ({ to: `/reports/general-ledger?${new URLSearchParams({ account: a.code, period: "custom", from: col.from, to: col.to })}`, title: "Open in the General Ledger" })} />
              : <Cells src={{ acct: a.code, inLine: line.key }} acct={a.code} inLine={line.key} />}
          </div>
        ))}
      </Fragment>
    );
  };

  const plLink = (col) => ({ to: "/reports/profit-loss", state: { period: { from: col.from, to: col.to } }, title: `Open the Profit & Loss for ${rangeLabel(col.from, col.to)}` });
  const bsLink = (dateOf) => (col) => ({ to: "/reports/balance-sheet", state: { period: { to: dateOf(col) } }, title: `Open the Balance Sheet at ${dayLabel(dateOf(col))}` });

  const Section = ({ s }) => {
    const lines = CF_LINES.filter((l) => l.section === s.key && lineShown(l.key));
    const subs = s.key === "operating" ? ["noncash", "wc"] : [];
    return (
      <Fragment>
        <div className="lg-row tb-group-row cf-section-row">
          <div className="tb-group-name"><span className="lg-group-lbl"><Lbl en={s.label} id={s.id} lang={lang} /></span></div>
          {cells.map((c) => <div key={c.key} />)}
        </div>
        {s.key === "operating" && (
          <div className="lg-row tb-acct-row">
            <div className="tb-cell-name" style={{ paddingLeft: 18 }}>
              <span className="tb-name"><Lbl en="Profit/(loss) for the period" id="Laba (rugi) periode berjalan" lang={lang} /></span>
              <Link className="tb-gl-btn no-print" to="/reports/profit-loss" state={{ period: { from, to } }}>Profit &amp; Loss {ARROW}</Link>
            </div>
            <Cells src={{ key: "profit" }} link={plLink} profit />
          </div>
        )}
        {subs.map((sub) => {
          const inSub = lines.filter((l) => l.sub === sub);
          if (!inSub.length) return null;
          return (
            <Fragment key={sub}>
              <div className="lg-row tb-group-row tb-subgroup cf-sub-row">
                <div className="tb-group-name" style={{ paddingLeft: 18 }}><span className="lg-group-lbl"><Lbl en={CF_SUBS[sub].label} id={CF_SUBS[sub].id} lang={lang} /></span></div>
                {cells.map((c) => <div key={c.key} />)}
              </div>
              {inSub.map((l) => <LineRow key={l.key} line={l} depth={2} />)}
            </Fragment>
          );
        })}
        {lines.filter((l) => !l.sub).map((l) => <LineRow key={l.key} line={l} depth={1} />)}
        <div className="lg-row subtotal pl-subtotal">
          <div className="tb-total-lbl"><Lbl en={s.total} id={s.totalId} lang={lang} /></div>
          <Cells src={{ section: s.key }} profit />
        </div>
      </Fragment>
    );
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const title = (l) => (l === "id" ? "Laporan Arus Kas" : "Statement of Cash Flows");
  const L = (o) => (lang === "id" ? o.id : o.label);
  const exportItems = () => {
    const items = [];
    CF_SECTIONS.forEach((s) => {
      items.push({ type: "head", label: L(s) });
      if (s.key === "operating") items.push({ type: "line", label: L({ label: "Profit/(loss) for the period", id: "Laba (rugi) periode berjalan" }), src: { key: "profit" } });
      CF_LINES.filter((l) => l.section === s.key && lineShown(l.key)).forEach((l) => items.push({ type: "line", label: L(l), src: { line: l.key }, section: s.key }));
      items.push({ type: "total", label: lang === "id" ? s.totalId : s.total, src: { section: s.key }, section: s.key });
    });
    items.push({ type: "grand", key: "net", label: lang === "id" ? "Kenaikan (penurunan) neto kas dan setara kas" : "Net increase/(decrease) in cash and cash equivalents", src: { key: "netChange" } });
    items.push({ type: "line", key: "start", label: lang === "id" ? "Kas dan setara kas awal periode" : "Cash and cash equivalents at beginning of period", src: { key: "cashStart" } });
    items.push({ type: "grand", key: "end", label: lang === "id" ? "Kas dan setara kas akhir periode" : "Cash and cash equivalents at end of period", src: { key: "cashEnd" } });
    return items;
  };
  const exportBase = exportName("cash-flow", from, to);
  function exportXlsx() {
    closePop();
    const amt = cells.filter((c) => c.kind === "amt");
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }], [{ v: title(lang), s: "title" }], [forPeriod(from, to, lang)],
      [{ v: `(${UNITS[unit][lang === "id" ? "id" : "en"]}) · ${lang === "id" ? "Metode tidak langsung" : "Indirect method"}`, s: "muted" }], [],
      [{ v: lang === "id" ? "Keterangan" : "Line", s: "head" }, ...amt.map((c) => ({ v: c.label, s: "headNum" }))],
    ];
    const freeze = rows.length;
    const sectionRows = {};
    let firstInSection = null;
    let netRow = null, startRow = null;
    exportItems().forEach((it) => {
      const n = rows.length + 1;
      if (it.type === "head") { rows.push([{ v: it.label, s: "bold" }]); firstInSection = n + 1; return; }
      const row = [{ v: it.type === "line" && !it.key ? `   ${it.label}` : it.label, s: it.type === "line" ? "text" : "bold" }];
      amt.forEach((c, i) => {
        const col = colName(1 + i);
        const v = r2((valueOf(c.col.id, it.src) || 0) / unit);
        if (it.type === "total") row.push({ f: `SUM(${col}${firstInSection}:${col}${n - 1})`, v, s: "numBold" });
        else if (it.key === "net") row.push({ f: Object.values(sectionRows).map((r) => `${col}${r}`).join("+"), v, s: "numBold" });
        else if (it.key === "end") row.push({ f: `${col}${netRow}+${col}${startRow}`, v, s: "numBold" });
        else row.push({ v, s: "num" });
      });
      if (it.type === "total") sectionRows[it.section] = n;
      if (it.key === "net") netRow = n;
      if (it.key === "start") startRow = n;
      rows.push(row);
    });
    rows.push(...signOffRows(lang, user?.name));
    downloadXlsx(exportBase.replace(/\.csv$/, ".xlsx"), { sheet: lang === "id" ? "Arus Kas" : "Cash Flow", rows, widths: [56, ...amt.map(() => 18)], freeze });
    showToast("Cash Flow exported to Excel");
  }
  function exportCsv() {
    closePop();
    downloadCsv(exportBase, {
      header: [...reportHeader({ report: title(lang), period: forPeriod(from, to, lang), runBy: user?.name }), [UNITS[unit][lang === "id" ? "id" : "en"]]],
      columns: [
        { label: lang === "id" ? "Keterangan" : "Line", value: (it) => it.label },
        ...cells.filter((c) => c.kind === "amt").map((c) => ({ label: c.label, value: (it) => (it.src ? r2((valueOf(c.col.id, it.src) || 0) / unit) : "") })),
      ],
      rows: exportItems(),
    });
    showToast("Cash Flow exported to CSV");
  }
  const exportPrint = () => { closePop(); setTimeout(printReport, 50); };

  const columnItems = [
    { k: "total", lbl: "Total only", hint: rangeLabel(from, to) },
    { k: "month", lbl: "By month", hint: tooFew.month ? (pieces.month.length > MAX_COLS ? "over 12 months" : "one month") : plural(pieces.month.length, "column"), disabled: tooFew.month },
    { k: "quarter", lbl: "By quarter", hint: tooFew.quarter ? "one quarter" : plural(pieces.quarter.length, "column"), disabled: tooFew.quarter },
  ];
  const compareItems = [
    { k: "none", lbl: "No comparison" },
    { k: "prev", lbl: "Previous period", hint: (() => { const p = previousPeriod(from, to); return rangeLabel(p.from, p.to); })() },
    { k: "prev_year", lbl: "Same period last year", hint: rangeLabel(sameDayLastYear(from), sameDayLastYear(to)) },
  ];
  const isDefault = period.key === DEFAULTS.period.key && colMode === DEFAULTS.colMode && compare === DEFAULTS.compare && unit === DEFAULTS.unit && lang === DEFAULTS.lang && showEmpty === DEFAULTS.showEmpty;
  const layoutNote = cmpRange ? `Compared with ${COMPARE_LABELS[compare].toLowerCase()} (${rangeLabel(cmpRange.from, cmpRange.to)})` : multi ? COLUMN_LABELS[colEff] : null;

  return (
    <div className={`lg-page tb-report pl-page cf-page${panel ? " txp-is-open" : ""}`}>
      <div className="lg-scroll-container">
        <PrintHead title={title(lang)} lines={[forPeriod(from, to, lang), `(${UNITS[unit][lang === "id" ? "id" : "en"]}) · ${lang === "id" ? "Metode tidak langsung" : "Indirect method"} · ${isFinal ? "Final" : lang === "id" ? "Sementara" : "Preliminary"}${layoutNote ? ` · ${layoutNote}` : ""}`]} />

        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Cash Flow</h1>
              <p className="st-sub">Arus Kas — where cash came from and went, by operating, investing and financing activity (indirect method).</p>
            </div>
            <div className="lg-head-actions no-print">
              <button className={`lg-btn-ghost${panel === "map" ? " tb-btn-on" : ""}`} onClick={() => setPanel((p) => (p === "map" ? null : "map"))} title="Which cash flow line each balance-sheet account lands on">
                <svg viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h6"/></svg>
                Account mapping{changedMap ? ` · ${changedMap} changed` : ""}
              </button>
              <div className="lg-meta-btn-wrap">
                <button className="lg-btn-brand" onClick={() => togglePop("export")} aria-haspopup="menu" aria-expanded={openPop === "export"}>{DOWNLOAD} Export</button>
                {openPop === "export" && <ExportPopover onXlsx={exportXlsx} onCsv={exportCsv} onPrint={exportPrint} onClose={closePop} />}
              </div>
            </div>
          </div>
          <div className="tb-status no-print">
            <span className={`tb-status-chip ${isFinal ? "closed" : "open"}`}>{isFinal ? "Final" : "Preliminary"}</span>
            <span>{isFinal ? `Books are closed through ${monthLabel(`${closedThrough}-01`)}.` : "This period is open — cash flows may change as journals are posted."}</span>
            {unposted.length > 0 && (
              <><span className="tb-status-sep">·</span>
                <button className="tb-status-link" onClick={() => navigate("/journal-entry")}>{plural(unposted.length, "draft or pending journal")} in this period {unposted.length === 1 ? "isn't" : "aren't"} included</button></>
            )}
            <span className="tb-status-sep">·</span>
            <Link className={`tb-foot st-foot-link ${ties ? "ok" : "off"}`} to="/reports/balance-sheet" state={{ period: { to } }} title="Cash at the start plus the net change against cash and cash equivalents on the Balance Sheet at the end of the period.">
              <span aria-hidden="true">{ties ? "✓" : "✕"}</span> {ties ? "Net change ties to cash on the Balance Sheet" : `Off the Balance Sheet's cash by ${rp(main.difference)}`}
            </Link>
            {unclassified.length > 0 && (
              <><span className="tb-status-sep">·</span>
                <button className="tb-status-link" onClick={() => setPanel("map")}>{plural(unclassified.length, "account")} not mapped</button></>
            )}
            <span className="tb-status-sep">·</span>
            <span className="tb-unit-note">{UNITS[unit].en}</span>
          </div>
        </div>

        <div className="lg-table-wrap pl-wrap">
          <div className="lg-card lg-table-tb pl-card" style={{ "--tb-n": cells.length }}>
            <div className="lg-filter-row no-print tb-filter-row pl-toolbar">
              <div className="tb-toolbar-left">
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn tb-period-btn" onClick={() => togglePop("period")} aria-haspopup="dialog" aria-expanded={openPop === "period"}>
                    {CAL}<span className="meta-lbl">Period</span><span className="meta-val">{rangeLabel(from, to)}</span>
                    {period.key !== "custom" && <span className="meta-lbl">· {period.label}</span>}
                  </button>
                  {openPop === "period" && <PeriodPopover presets={presets} period={period} onPick={(c) => { setPeriodChoice(c); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${multi ? " active" : ""}`} onClick={() => togglePop("columns")} aria-haspopup="menu" aria-expanded={openPop === "columns"}>
                    <span className="meta-lbl">Columns:</span><span className="meta-val">{COLUMN_LABELS[colEff]}</span>
                  </button>
                  {openPop === "columns" && <ChoicePopover className="tb-compare-pop" items={columnItems} value={colEff} onPick={(k) => { setColMode(k); closePop(); }} onClose={closePop} note="Months or quarters of the period, oldest first, then the total." />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${cmpRange ? " active" : ""}`} onClick={() => togglePop("compare")} disabled={multi}
                    title={multi ? "Comparison works on Total only. Set Columns to Total only to compare." : undefined} aria-haspopup="menu" aria-expanded={openPop === "compare"}>
                    <span className="meta-lbl">Compare:</span><span className="meta-val">{cmpRange ? COMPARE_LABELS[compare] : "None"}</span>
                  </button>
                  {openPop === "compare" && <ChoicePopover className="tb-compare-pop" items={compareItems} value={cmpRange ? compare : "none"} onPick={(k) => { setCompare(k); closePop(); }} onClose={closePop} />}
                </div>
              </div>
              <div className="lg-filter-meta">
                <button className="tb-icon-btn" onClick={() => setExpanded(new Set())} disabled={!expanded.size} title="Collapse all lines" aria-label="Collapse all lines">
                  <svg viewBox="0 0 24 24"><polyline points="7 15 12 10 17 15"/><line x1="5" y1="20" x2="19" y2="20"/></svg>
                </button>
                <button className="tb-icon-btn" onClick={() => setExpanded(new Set(CF_LINES.map((l) => l.key)))} title="Show the accounts under every line" aria-label="Expand all lines">
                  <svg viewBox="0 0 24 24"><polyline points="7 9 12 14 17 9"/><line x1="5" y1="4" x2="19" y2="4"/></svg>
                </button>
                <div className="lg-meta-btn-wrap">
                  <button className={`tb-icon-btn${openPop === "settings" ? " on" : ""}`} onClick={() => togglePop("settings")} title="Report settings" aria-label="Open report settings">{GEAR}</button>
                  {openPop === "settings" && <FormatPopover unit={unit} onUnit={setUnit} lang={lang} onLang={setLang} onClose={closePop}
                    switches={[{ label: "Hide lines with no movement", checked: !showEmpty, onChange: (v) => setShowEmpty(!v) }]} />}
                </div>
                {!isDefault && <button className="lg-reset-all" onClick={() => { setPeriodChoice(DEFAULTS.period); setColMode(DEFAULTS.colMode); setCompare(DEFAULTS.compare); setUnit(DEFAULTS.unit); setLang(DEFAULTS.lang); setShowEmpty(DEFAULTS.showEmpty); }}>Reset all</button>}
              </div>
            </div>

            <div className="pl-statement">
              <div className="lg-col-header">
                <div><Lbl en="Line" id="Keterangan" lang={lang} /></div>
                {cells.map((c) => (
                  <div key={c.key} style={{ textAlign: "right" }} className={c.kind !== "amt" ? "pl-cell-sub" : undefined}>
                    <Lbl en={c.label} id={c.id_label} lang={lang} />
                    {(c.kind === "amt" || c.kind === "diff") && <span className="pl-th-unit"> ({unitHead})</span>}
                  </div>
                ))}
              </div>
              <div>
                {CF_SECTIONS.map((s) => <Section key={s.key} s={s} />)}
                <div className="lg-row subtotal pl-subtotal tb-total-row pl-grand">
                  <div className="tb-total-lbl"><Lbl en="Net increase/(decrease) in cash and cash equivalents" id="Kenaikan (penurunan) neto kas dan setara kas" lang={lang} /></div>
                  <Cells src={{ key: "netChange" }} profit />
                </div>
                <div className="lg-row subtotal cf-recon-row">
                  <div className="tb-total-lbl"><Lbl en="Cash and cash equivalents at beginning of period" id="Kas dan setara kas awal periode" lang={lang} /></div>
                  <Cells src={{ key: "cashStart" }} link={bsLink((col) => dayBefore(col.from))} />
                </div>
                <div className="lg-row subtotal pl-subtotal tb-total-row pl-grand">
                  <div className="tb-total-lbl"><Lbl en="Cash and cash equivalents at end of period" id="Kas dan setara kas akhir periode" lang={lang} /></div>
                  <Cells src={{ key: "cashEnd" }} link={bsLink((col) => col.to)} />
                </div>
              </div>
            </div>
            {!ties && <div className="pl-warn">Cash at the start plus the net change doesn&apos;t reach the Balance Sheet&apos;s cash ({amountCols.filter((c) => !results[c.id].ties).map((c) => `${c.label} off by ${rp(results[c.id].difference)}`).join(" · ")}). A journal that doesn&apos;t balance is the usual cause.</div>}
            <SignOff lang={lang} preparedBy={user?.name} />
          </div>
          <p className="pl-foot no-print">
            Indirect method: profit for the period, plus non-cash items, plus the change in every other balance-sheet account, equals the change in cash. Each account&apos;s line comes from the chart&apos;s groups unless it&apos;s been mapped elsewhere (Account mapping).
            {" "}Open a line to see its accounts; click an account&apos;s amount to see the journals behind it.
          </p>
        </div>
      </div>

      <div className="lg-footer no-print">
        <div className="lg-footer-left"><span>{plural(main.cashCodes.length, "cash account")} counted as cash</span></div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Cash at {dayLabel(dayBefore(from))}</span>
          <span className="lg-footer-total">{rp(main.cashStart)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Net change</span>
          <span className={`lg-footer-total${main.netChange < 0 ? " pl-footer-loss" : ""}`}>{rp(main.netChange)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Cash at {dayLabel(to)}</span>
          <span className="lg-footer-total">{rp(main.cashEnd)}</span>
          <span className="lg-footer-sep">·</span>
          <span className={`tb-balance-flag ${ties ? "ok" : "off"}`}>{ties ? "✓ Ties" : "Off"}</span>
        </div>
      </div>

      {panel === "map" && <MappingPanel mapping={mapping} onChange={setMapping} onClose={closePanel} onSaved={showToast} />}
      {drillView && <TransactionsPanel view={drillView} onClose={closePanel} />}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// Account mapping — every balance-sheet account and the line it lands on.
// The default is shown as "(default)"; picking another line saves an
// override, which the statement uses at once. In the product this is a
// company setting behind accounting-settings permission; here it's kept in
// the browser.
function MappingPanel({ mapping, onChange, onClose, onSaved }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const accts = cfAccounts();
  const needle = q.trim().toLowerCase();
  const shown = accts.filter((a) => !needle || a.code.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle));
  const options = [{ key: "cash", label: CASH_LINE.label, section: "cash" }, ...CF_LINES.filter((l) => l.key !== "disposal")];
  const sectionLabel = { cash: "Cash and cash equivalents", operating: "Operating", investing: "Investing", financing: "Financing" };
  const lineOf = (a) => mapping[a.code] || defaultCfLine(a);
  const groups = ["cash", "operating", "investing", "financing"].map((sec) => ({
    sec, accts: shown.filter((a) => (lineOf(a) === "cash" ? "cash" : CF_LINE_BY_KEY[lineOf(a)]?.section) === sec),
  })).filter((g) => g.accts.length);
  const changed = Object.keys(mapping).length;
  const set = (a, key) => {
    const next = { ...mapping };
    if (key === defaultCfLine(a)) delete next[a.code]; else next[a.code] = key;
    onChange(next);
    onSaved(`${a.code} → ${key === "cash" ? CASH_LINE.label : CF_LINE_BY_KEY[key].label}`);
  };
  return (
    <aside className="txp no-print" role="dialog" aria-label="Cash flow account mapping">
      <div className="txp-head">
        <div className="txp-title-row">
          <div className="txp-title"><span className="txp-name">Account mapping</span></div>
          <button type="button" className="txp-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="txp-sub">The cash flow line each balance-sheet account lands on. Defaults follow the chart of accounts&apos; groups.</div>
      </div>
      <div className="txp-tools">
        <div className="lg-search txp-search">
          <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
          <input placeholder="Search account code or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="txp-count">{accts.length} accounts</span>
      </div>
      <div className="cf-map">
        <div className="cf-map-body">
          {groups.map((g) => (
            <Fragment key={g.sec}>
              <div className="cf-map-grp">{sectionLabel[g.sec]}</div>
              {g.accts.map((a) => (
                <div key={a.code} className={`cf-map-row${mapping[a.code] ? " changed" : ""}`}>
                  <span className="cf-map-name" title={a.name}><span className="tb-code">{a.code}</span>{a.name}</span>
                  <select value={lineOf(a)} onChange={(e) => set(a, e.target.value)} aria-label={`Cash flow line for ${a.code} ${a.name}`}>
                    {["cash", "operating", "investing", "financing"].map((sec) => (
                      <optgroup key={sec} label={sectionLabel[sec]}>
                        {options.filter((o) => (o.section || "cash") === sec || (sec === "cash" && o.key === "cash")).filter((o) => sec !== "cash" || o.key === "cash").map((o) => (
                          <option key={o.key} value={o.key}>{o.label}{o.key === defaultCfLine(a) ? " (default)" : ""}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
        <div className="cf-map-foot">
          <span>{changed ? `${plural(changed, "account")} moved from its default` : "Every account on its default line"}</span>
          {changed > 0 && <button type="button" className="lg-btn-ghost" onClick={() => { onChange({}); onSaved("Mapping reset to defaults"); }}>Reset to defaults</button>}
        </div>
      </div>
    </aside>
  );
}
