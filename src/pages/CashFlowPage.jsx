// Reports → Cash Flow (Laporan Arus Kas).
//
// Direct method (team decision, 25 Nov 2026): the cash actually received and
// paid, in the company's own groups. The groups are built in Settings →
// Accounting → Cash flow, and each account is put in one on the Chart of
// accounts; a cash movement lands in the group of the account on its other
// side (lib/cashFlow.js). Net cash flow is proved against the change in cash
// on the Balance Sheet.
//
// Uses the shared "Whole" table type (one number per cell — Slack, 25 Nov):
// the Profit & Loss's frame — period presets, Columns (Total only / By month
// / By quarter) one at a time with Compare, the statement grid with a sticky
// line column, nested groups each with its total, the status line with its
// proof, print header and sign-off, and the Transactions panel for the
// journals behind an account.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import TransactionsPanel from "../components/TransactionsPanel";
import { computeCashFlow, cashEffectLines, cfAccounts, CF_SECTIONS, UNASSIGNED } from "../lib/cashFlow";
import { unpostedInPeriod, change } from "../lib/profitLoss";
import { periodCloseState } from "../lib/trialBalance";
import { periodPresets, rangeLabel, dayLabel, dayBefore, previousPeriod, sameDayLastYear, splitPeriod, monthLabel } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import { ChoicePopover, PeriodPopover, ExportPopover, loadLocal, saveLocal } from "../components/ReportControls";
import { UNITS, num, rp, pct, r2, plural, forPeriod, Lbl, GEAR, CAL, ARROW, DOWNLOAD, Chevron, FormatPopover, PrintHead, SignOff, signOffRows } from "../components/StatementKit";
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
const NONE = UNASSIGNED.key;

export default function CashFlowPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { entries } = useJournalEntries();
  const { fiscalYearStart, cfGroups, cfAssign } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const storeKey = (what) => `klay.cashFlow.${what}.${user?.id || "anon"}`;

  const [periodChoice, setPeriodChoice] = useState(() => loadLocal(storeKey("period"), DEFAULTS.period));
  const [colMode, setColMode] = useState(DEFAULTS.colMode);
  const [compare, setCompare] = useState(DEFAULTS.compare);
  const [unit, setUnit] = useState(DEFAULTS.unit);
  const [lang, setLang] = useState(DEFAULTS.lang);
  const [showEmpty, setShowEmpty] = useState(DEFAULTS.showEmpty);
  // A group that holds other groups starts open; one that holds only accounts
  // starts closed. `flipped` holds the ones the user has toggled.
  const [flipped, setFlipped] = useState(() => new Set());
  const [openPop, setOpenPop] = useState(null);
  const togglePop = (k) => setOpenPop((p) => (p === k ? null : k));
  const closePop = () => setOpenPop(null);
  const [panel, setPanel] = useState(null); // { code, colId }
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
    for (const c of amountCols) out[c.id] = computeCashFlow(entries, { from: c.from, to: c.to }, { groups: cfGroups, assign: cfAssign, fiscalYearStart });
    return out;
  }, [amountCols, entries, cfGroups, cfAssign, fiscalYearStart]);
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
  const unassignedMoving = amountCols.some((c) => results[c.id].unassigned.accounts.some((a) => Math.abs(a.amount) >= 0.005));
  const unassignedCount = Object.values(main.assign).filter((v) => !v).length;

  // ── Values ────────────────────────────────────────────────────────────────
  // src: { group } | { acct, in } | { section } | { key: netChange|cashStart|cashEnd }
  const bucket = (res, key) => (key === NONE ? res.unassigned : res.groups[key]);
  const valueOf = (colId, src) => {
    const res = results[colId];
    if (!res) return null;
    if (src.group) return bucket(res, src.group)?.amount ?? 0;
    if (src.acct) return bucket(res, src.in)?.accounts.find((a) => a.code === src.acct)?.amount ?? 0;
    if (src.section) return res.sections[src.section];
    return res[src.key];
  };
  const cellValue = (cell, src) => {
    if (cell.kind === "amt") return valueOf(cell.col.id, src);
    const cur = valueOf("cur", src), prev = valueOf("cmp", src);
    if (cur == null || prev == null) return null;
    return cell.kind === "diff" ? change(cur, prev).diff : change(cur, prev).pct;
  };
  const moved = (v) => Math.abs(v || 0) >= 0.005;
  // A group shows when any account under it moved cash in any column.
  const groupMoved = (key) => amountCols.some((c) => {
    const res = results[c.id];
    const walk = (k) => { const g = bucket(res, k); return !!g && (g.accounts.some((a) => moved(a.amount)) || (g.children || []).some(walk)); };
    return walk(key);
  });
  const groupShown = (key) => showEmpty || groupMoved(key);
  const acctsShown = (key) => (main.groups[key] || main.unassigned).accounts.filter((a) => showEmpty || amountCols.some((c) => moved(bucket(results[c.id], key)?.accounts.find((x) => x.code === a.code)?.amount)));
  const isOpen = (key) => {
    const kids = (main.groups[key]?.children || []).length > 0;
    return kids !== flipped.has(key);
  };

  // ── Drill ─────────────────────────────────────────────────────────────────
  const drillView = (() => {
    if (!panel) return null;
    const col = amountCols.find((c) => c.id === panel.colId) || amountCols.find((c) => c.main);
    const a = cfAccounts().find((x) => x.code === panel.code);
    const lines = cashEffectLines(entries, panel.code, col, results[col.id].cashCodes);
    const amount = bucket(results[col.id], panel.in)?.accounts.find((x) => x.code === panel.code)?.amount || 0;
    return {
      kind: "lines", code: panel.code, name: a?.name || panel.code,
      rangeLabel: `${rangeLabel(col.from, col.to)} · cash received and paid against this account`,
      periods: amountCols.filter((c) => !c.muted || c.id === "cmp").map((c) => ({ id: c.id, label: c.label })),
      periodId: col.id, onPeriod: (id) => setPanel((p) => ({ ...p, colId: id })),
      opening: null, closing: { label: "Net cash", amount }, lines,
      glTo: `/reports/general-ledger?${new URLSearchParams({ account: panel.code, period: "custom", from: col.from, to: col.to })}`,
      note: "Only journals that moved cash. + cash came in (a credit to this account), − cash went out (a debit).",
    };
  })();
  const isOn = (code, colId) => panel && panel.code === code && panel.colId === colId;

  // ── Rows ──────────────────────────────────────────────────────────────────
  const unitHead = UNITS[unit].head;
  const dash = <span className="lg-cell-em-dash">—</span>;
  const Cells = ({ src, acct = null, inKey = null, link = null, signed = false }) => cells.map((cell) => {
    const v = cellValue(cell, src);
    const cls = `lg-cell-total${cell.strong ? " tb-cell-end" : ""}${cell.muted ? " tb-cell-muted" : ""}${cell.kind !== "amt" ? " pl-cell-sub" : ""}${signed && cell.kind === "amt" && v < -0.005 ? " pl-loss" : ""}`;
    const text = cell.kind === "diffPct" ? pct(v) : num(v, unit);
    const body = text === "—" ? dash : text;
    if (cell.kind === "amt" && moved(v)) {
      if (acct) {
        return <div key={cell.key} className={cls}><button type="button" className={`txp-amt${isOn(acct, cell.col.id) ? " on" : ""}`} onClick={() => setPanel({ code: acct, in: inKey, colId: cell.col.id })} title="Show the journals behind this cash">{body}</button></div>;
      }
      if (link) return <div key={cell.key} className={cls}><Link className="pl-amt-link" {...link(cell.col)}>{body}</Link></div>;
    }
    return <div key={cell.key} className={cls}>{body}</div>;
  });
  const toggle = (k) => setFlipped((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const AcctRows = ({ k, depth }) => acctsShown(k).map((a) => (
    <div key={a.code} className="lg-row tb-acct-row">
      <div className="tb-cell-name" style={{ paddingLeft: (depth + 1) * 18 + 14 }}>
        <span className="tb-code">{a.code}</span>
        <button type="button" className="tb-name tb-acct-link bs-name-btn" onClick={() => setPanel({ code: a.code, in: k, colId: "cur" })}>{a.name}</button>
        <Link className="tb-gl-btn no-print" to={`/reports/general-ledger?${new URLSearchParams({ account: a.code, period: "custom", from, to })}`}>General Ledger {ARROW}</Link>
      </div>
      <Cells src={{ acct: a.code, in: k }} acct={a.code} inKey={k} />
    </div>
  ));

  // A group: its row (with its total when closed or when it only holds
  // accounts), then — open — its subgroups and accounts and, for a group that
  // holds subgroups, a "Total …" row.
  const GroupRow = ({ k, depth }) => {
    const g = main.groups[k];
    const open = isOpen(k);
    const kids = g.children.filter(groupShown);
    const accts = acctsShown(k);
    const count = accts.length + kids.length;
    const withTotalRow = open && kids.length > 0;
    return (
      <Fragment>
        <div className={`lg-row ${kids.length ? "tb-group-row" : "tb-acct-row"}${depth ? " tb-subgroup" : ""}${open ? " selected" : ""}`} onClick={() => count && toggle(k)}>
          <div className="tb-cell-name" style={{ paddingLeft: depth * 18 + 18 }}>
            <button type="button" className="cf-line-btn" aria-expanded={open} disabled={!count}>
              <Chevron closed={!open} />
              <span className={kids.length ? "lg-group-lbl" : "tb-name"}><Lbl en={g.label} id={g.labelId} lang={lang} /></span>
              {!kids.length && <span className="cf-acct-count no-print">{plural(accts.length, "account")}</span>}
            </button>
          </div>
          {withTotalRow ? cells.map((c) => <div key={c.key} />) : <Cells src={{ group: k }} signed />}
        </div>
        {open && kids.map((c) => <GroupRow key={c} k={c} depth={depth + 1} />)}
        {open && <AcctRows k={k} depth={depth + 1} />}
        {withTotalRow && (
          <div className="lg-row subtotal pl-group-total">
            <div className="tb-total-lbl" style={{ paddingLeft: depth * 18 + 18 }}><Lbl en={`Total ${g.label.toLowerCase()}`} id={`Jumlah ${(g.labelId || g.label).toLowerCase()}`} lang={lang} /></div>
            <Cells src={{ group: k }} signed />
          </div>
        )}
      </Fragment>
    );
  };

  const UnassignedRow = () => {
    const open = flipped.has(NONE);
    const accts = acctsShown(NONE);
    return (
      <Fragment>
        <div className={`lg-row tb-acct-row${open ? " selected" : ""}`} onClick={() => accts.length && toggle(NONE)}>
          <div className="tb-cell-name" style={{ paddingLeft: 18 }}>
            <button type="button" className="cf-line-btn" aria-expanded={open} disabled={!accts.length}>
              <Chevron closed={!open} />
              <span className="tb-name"><Lbl en={UNASSIGNED.label} id={UNASSIGNED.id} lang={lang} /></span>
              <span className="cf-acct-count no-print">{plural(accts.length, "account")}</span>
            </button>
            <Link className="var-pill no-print open" to="/chart-of-accounts?cf=unassigned" onClick={(e) => e.stopPropagation()} title="These accounts aren't in a Cash Flow group. Put them in one on the Chart of accounts.">Assign accounts</Link>
          </div>
          <Cells src={{ group: NONE }} signed />
        </div>
        {open && <AcctRows k={NONE} depth={1} />}
      </Fragment>
    );
  };

  const bsLink = (dateOf) => (col) => ({ to: "/reports/balance-sheet", state: { period: { to: dateOf(col) } }, title: `Open the Balance Sheet at ${dayLabel(dateOf(col))}` });

  const Section = ({ s }) => (
    <Fragment>
      <div className="lg-row tb-group-row cf-section-row">
        <div className="tb-group-name"><span className="lg-group-lbl"><Lbl en={s.label} id={s.id} lang={lang} /></span></div>
        {cells.map((c) => <div key={c.key} />)}
      </div>
      {main.roots[s.key].filter(groupShown).map((k) => <GroupRow key={k} k={k} depth={0} />)}
      {s.key === "operating" && unassignedMoving && <UnassignedRow />}
      <div className="lg-row subtotal pl-subtotal">
        <div className="tb-total-lbl"><Lbl en={s.total} id={s.totalId} lang={lang} /></div>
        <Cells src={{ section: s.key }} signed />
      </div>
    </Fragment>
  );

  // ── Export ────────────────────────────────────────────────────────────────
  // Every shown group at its depth, each with its own total (a parent's total
  // is a SUM of its children's rows in Excel); a section total sums its
  // top-level rows.
  const title = (l) => (l === "id" ? "Laporan Arus Kas" : "Statement of Cash Flows");
  const L = (en, id) => (lang === "id" ? id || en : en);
  const exportItems = () => {
    const items = [];
    const walk = (k, depth, section) => {
      const g = main.groups[k];
      const kids = g.children.filter(groupShown);
      const item = { type: "line", label: L(g.label, g.labelId), src: { group: k }, depth, section, top: depth === 0, children: [] };
      items.push(item);
      kids.forEach((c) => item.children.push(walk(c, depth + 1, section)));
      return item;
    };
    CF_SECTIONS.forEach((s) => {
      items.push({ type: "head", label: L(s.label, s.id) });
      main.roots[s.key].filter(groupShown).forEach((k) => walk(k, 0, s.key));
      if (s.key === "operating" && unassignedMoving) items.push({ type: "line", label: L(UNASSIGNED.label, UNASSIGNED.id), src: { group: NONE }, depth: 0, section: s.key, top: true, children: [] });
      items.push({ type: "total", label: L(s.total, s.totalId), src: { section: s.key }, section: s.key });
    });
    items.push({ type: "grand", key: "net", label: L("Net increase/(decrease) in cash and cash equivalents", "Kenaikan (penurunan) neto kas dan setara kas"), src: { key: "netChange" } });
    items.push({ type: "line", key: "start", label: L("Cash and cash equivalents at beginning of period", "Kas dan setara kas awal periode"), src: { key: "cashStart" }, depth: -1 });
    items.push({ type: "grand", key: "end", label: L("Cash and cash equivalents at end of period", "Kas dan setara kas akhir periode"), src: { key: "cashEnd" } });
    return items;
  };
  const exportBase = exportName("cash-flow", from, to);
  function exportXlsx() {
    closePop();
    const amt = cells.filter((c) => c.kind === "amt");
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }], [{ v: title(lang), s: "title" }], [forPeriod(from, to, lang)],
      [{ v: `(${UNITS[unit][lang === "id" ? "id" : "en"]}) · ${lang === "id" ? "Metode langsung" : "Direct method"}`, s: "muted" }], [],
      [{ v: lang === "id" ? "Keterangan" : "Line", s: "head" }, ...amt.map((c) => ({ v: c.label, s: "headNum" }))],
    ];
    const freeze = rows.length;
    const items = exportItems();
    items.forEach((it, i) => { it.row = freeze + 1 + i; });
    const sectionRows = {};
    let netRow = null, startRow = null;
    items.forEach((it) => {
      if (it.type === "head") { rows.push([{ v: it.label, s: "bold" }]); return; }
      const parent = it.children?.length > 0;
      const indent = it.type === "line" && it.depth >= 0 ? "   ".repeat(it.depth + 1) : "";
      const row = [{ v: `${indent}${it.label}`, s: it.type === "line" && !parent ? "text" : "bold" }];
      amt.forEach((c, ci) => {
        const col = colName(1 + ci);
        const v = r2((valueOf(c.col.id, it.src) || 0) / unit);
        if (it.type === "total") {
          const tops = items.filter((x) => x.top && x.section === it.section).map((x) => `${col}${x.row}`);
          row.push({ f: tops.length ? tops.join("+") : "0", v, s: "numBold" });
        } else if (it.key === "net") row.push({ f: Object.values(sectionRows).map((r) => `${col}${r}`).join("+"), v, s: "numBold" });
        else if (it.key === "end") row.push({ f: `${col}${netRow}+${col}${startRow}`, v, s: "numBold" });
        else row.push({ v, s: parent ? "numBold" : "num" });
      });
      if (it.type === "total") sectionRows[it.section] = it.row;
      if (it.key === "net") netRow = it.row;
      if (it.key === "start") startRow = it.row;
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
        { label: lang === "id" ? "Keterangan" : "Line", value: (it) => `${it.type === "line" && it.depth >= 0 ? "  ".repeat(it.depth) : ""}${it.label}` },
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
  const allGroupKeys = Object.keys(main.groups);

  return (
    <div className={`lg-page tb-report pl-page cf-page${panel ? " txp-is-open" : ""}`}>
      <div className="lg-scroll-container">
        <PrintHead title={title(lang)} lines={[forPeriod(from, to, lang), `(${UNITS[unit][lang === "id" ? "id" : "en"]}) · ${lang === "id" ? "Metode langsung" : "Direct method"} · ${isFinal ? "Final" : lang === "id" ? "Sementara" : "Preliminary"}${layoutNote ? ` · ${layoutNote}` : ""}`]} />

        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Cash Flow</h1>
              <p className="st-sub">Arus Kas — cash received and paid, by operating, investing and financing activity, in your own groups (direct method).</p>
            </div>
            <div className="lg-head-actions no-print">
              <Link className="lg-btn-ghost" to="/cash-flow-structure" title="Build the groups this report shows (Settings → Accounting → Cash flow)">
                <svg viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M8 12h12"/><path d="M12 18h8"/></svg>
                Edit groups
              </Link>
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
            {unassignedCount > 0 && (
              <><span className="tb-status-sep">·</span>
                <Link className="tb-status-link" to="/chart-of-accounts?cf=unassigned">{plural(unassignedCount, "account")} not in a group</Link></>
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
                <button className="tb-icon-btn" onClick={() => setFlipped(new Set(allGroupKeys.filter((k) => main.groups[k].children.length)))} title="Collapse all groups" aria-label="Collapse all groups">
                  <svg viewBox="0 0 24 24"><polyline points="7 15 12 10 17 15"/><line x1="5" y1="20" x2="19" y2="20"/></svg>
                </button>
                <button className="tb-icon-btn" onClick={() => setFlipped(new Set([NONE, ...allGroupKeys.filter((k) => !main.groups[k].children.length)]))} title="Show the accounts under every group" aria-label="Expand all groups">
                  <svg viewBox="0 0 24 24"><polyline points="7 9 12 14 17 9"/><line x1="5" y1="4" x2="19" y2="4"/></svg>
                </button>
                <div className="lg-meta-btn-wrap">
                  <button className={`tb-icon-btn${openPop === "settings" ? " on" : ""}`} onClick={() => togglePop("settings")} title="Report settings" aria-label="Open report settings">{GEAR}</button>
                  {openPop === "settings" && <FormatPopover unit={unit} onUnit={setUnit} lang={lang} onLang={setLang} onClose={closePop}
                    switches={[{ label: "Hide groups with no cash movement", checked: !showEmpty, onChange: (v) => setShowEmpty(!v) }]} />}
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
                  <Cells src={{ key: "netChange" }} signed />
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
            Direct method: each journal that moved cash lands in the group of the account on its other side — set per account on the Chart of accounts; the groups are yours to build (<Link to="/cash-flow-structure">Edit groups</Link>). Transfers between cash accounts aren&apos;t cash flows and don&apos;t show.
            {" "}Open a group to see its accounts; click an account&apos;s amount to see the journals behind it.
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

      {drillView && <TransactionsPanel view={drillView} onClose={closePanel} />}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
