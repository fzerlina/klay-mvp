// Reports → Changes in Equity (Laporan Perubahan Ekuitas / Perubahan Modal).
//
// From the competitor benchmark (docs/research/changes-in-equity/README.md)
// and the Linear scope (P-TRA-31): equity components as columns, movements as
// rows, current vs prior year, tied to the Balance Sheet, drill-down, Bahasa
// labels, Excel / PDF. Built from the Balance Sheet's pieces:
//   • the same page frame, status line, toolbar, statement grid, sticky
//     account column, print header and sign-off (.tb-report .pl-page);
//   • the Transactions panel for the journals behind a movement;
//   • lib/changesInEquity.js, which reads the Balance Sheet and the P&L so the
//     three statements can't disagree — and proves it on the status line.
// The comparative is the prior fiscal year stacked above the current period,
// the way SAK EP prints it: when the two run back to back, the prior year's
// closing balance is the current period's opening, shown once.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import TransactionsPanel from "../components/TransactionsPanel";
import { computeChangesInEquity, computeEquityAccounts } from "../lib/changesInEquity";
import { unpostedInPeriod } from "../lib/profitLoss";
import { periodCloseState } from "../lib/trialBalance";
import { periodPresets, rangeLabel, dayLabel, dayBefore, fiscalYearStartFor, sameDayLastYear, monthLabel } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import { ChoicePopover, PeriodPopover, ExportPopover, loadLocal, saveLocal } from "../components/ReportControls";
import { UNITS, num, rp, r2, plural, longDate, forPeriod, Lbl, GEAR, CAL, ARROW, DOWNLOAD, FormatPopover, PrintHead, SignOff, signOffRows } from "../components/StatementKit";
import "./modules.css";
import "./invoices-ledger.css";
import "./trial-balance.css";
import "./profit-loss.css";
import "./balance-sheet.css";
import "./statements.css";

const COMPARE_LABELS = { none: "None", prior_fy: "Prior fiscal year", prev_year: "Same period last year" };
// Opens on the fiscal year to the end of last month — the month the close
// reviews, the same date the Balance Sheet opens on (benchmark §6 #4).
// Two views (user, 24 Nov): By account — the layout the SME works with today
// (Mekari Jurnal: equity accounts × Permulaan · Debit · Kredit · Saldo akhir,
// Total, Pergerakan), the default — and Statement, the SAK EP matrix for the
// audited financials.
const DEFAULTS = { period: { key: "fy_to_last_month" }, compare: "prior_fy", unit: 1, lang: "id", viewMode: "accounts" };
const VIEWS = [{ k: "accounts", lbl: "By account" }, { k: "statement", lbl: "Statement (SAK EP)" }];
const ACCT_COLS = [
  { k: "opening", en: "Opening", id: "Permulaan" },
  { k: "debit", en: "Debit", id: "Debit" },
  { k: "credit", en: "Credit", id: "Kredit" },
  { k: "closing", en: "Closing", id: "Saldo akhir" },
];

export default function ChangesInEquityPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { entries } = useJournalEntries();
  const { fiscalYearStart } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const storeKey = (what) => `klay.changesInEquity.${what}.${user?.id || "anon"}`;

  const [periodChoice, setPeriodChoice] = useState(() => loadLocal(storeKey("period"), DEFAULTS.period));
  const [compare, setCompare] = useState(DEFAULTS.compare);
  const [viewMode, setViewMode] = useState(() => loadLocal(storeKey("view"), DEFAULTS.viewMode));
  useEffect(() => { saveLocal(storeKey("view"), viewMode); }, [viewMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const byAccount = viewMode === "accounts";
  const [unit, setUnit] = useState(DEFAULTS.unit);
  const [lang, setLang] = useState(DEFAULTS.lang);
  const [openPop, setOpenPop] = useState(null);
  const togglePop = (k) => setOpenPop((p) => (p === k ? null : k));
  const closePop = () => setOpenPop(null);
  const [toast, setToast] = useState("");
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  // Arriving from the Director's Summary: that period.
  useEffect(() => {
    const p = location.state?.period;
    if (!p) return;
    setPeriodChoice({ key: "custom", from: p.from, to: p.to });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Period ────────────────────────────────────────────────────────────────
  const presets = useMemo(() => {
    const base = periodPresets({ fiscalYearStart });
    const lastMonth = base.find((p) => p.key === "last_month");
    const fyStart = fiscalYearStartFor(lastMonth.to, fiscalYearStart);
    return [{ key: "fy_to_last_month", label: "Year to last month-end", from: fyStart, to: lastMonth.to }, ...base];
  }, [fiscalYearStart]);
  const period = useMemo(() => {
    if (periodChoice.key === "custom") return { key: "custom", from: periodChoice.from, to: periodChoice.to, label: "Custom" };
    const p = presets.find((x) => x.key === periodChoice.key) || presets.find((x) => x.key === DEFAULTS.period.key);
    return { key: p.key, from: p.from, to: p.to, label: p.label };
  }, [periodChoice, presets]);
  useEffect(() => { saveLocal(storeKey("period"), period.key === "custom" ? { key: "custom", from: period.from, to: period.to } : { key: period.key }); }, [period.key, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const { from, to } = period;

  // The comparative block: the whole fiscal year before the one `from` is in
  // (the statutory comparative), or the same dates a year earlier.
  const prior = useMemo(() => {
    if (compare === "prior_fy") {
      const fyStart = fiscalYearStartFor(from, fiscalYearStart);
      const end = dayBefore(fyStart);
      return { from: fiscalYearStartFor(end, fiscalYearStart), to: end };
    }
    if (compare === "prev_year") return { from: sameDayLastYear(from), to: sameDayLastYear(to) };
    return null;
  }, [compare, from, to, fiscalYearStart]);

  const cur = useMemo(() => computeChangesInEquity(entries, { from, to }, { fiscalYearStart }), [entries, from, to, fiscalYearStart]);
  const prv = useMemo(() => (prior ? computeChangesInEquity(entries, prior, { fiscalYearStart }) : null), [entries, prior, fiscalYearStart]);
  const acc = useMemo(() => computeEquityAccounts(entries, { from, to }, { fiscalYearStart }), [entries, from, to, fiscalYearStart]);
  const chained = !!prv && dayBefore(from) === prv.to; // prior closing = current opening
  const comps = cur.comps;
  const keys = [...comps.map((c) => c.key), "total"];

  // ── Status ────────────────────────────────────────────────────────────────
  const isFinal = periodCloseState(from, to, closedThrough) === "closed";
  const unposted = useMemo(() => unpostedInPeriod(entries, { from, to }), [entries, from, to]);
  const allTie = byAccount ? acc.ties : cur.ties && (!prv || prv.ties);
  const bsTies = byAccount ? acc.bsTies : cur.bsTies && (!prv || prv.bsTies);

  // ── Drill ─────────────────────────────────────────────────────────────────
  const [drill, setDrill] = useState(null); // { block: "cur"|"prv", row, comp }
  const closeDrill = useCallback(() => setDrill(null), []);
  const blockRes = (b) => (b === "prv" ? prv : cur);
  // By account: one account's journals for the period, from Permulaan to
  // Saldo akhir. Retained earnings shows the year-end roll as its own line;
  // the computed profit row is the P&L plus that roll.
  const acctDrill = (code) => {
    const r = acc.rows.find((x) => x.code === code);
    if (!r) return null;
    const rollLine = (amount, desc) => ({ key: "roll", date: from, source: "roll", synthetic: true, amount, desc });
    const lines = r.computed
      ? [
        { key: "pl", date: from, source: "roll", synthetic: true, amount: r.profit, desc: `Profit/(loss) ${rangeLabel(from, to)} — from the Profit & Loss, not a posting` },
        ...(Math.abs(r.roll) >= 0.5 ? [rollLine(-r.roll, "Previous year's profit/(loss) moved to retained earnings at year-end")] : []),
      ]
      : [...r.lines, ...(Math.abs(r.roll) >= 0.5 ? [rollLine(r.roll, "Year-end roll of the previous year's profit/(loss) — calculated, not a posting")] : [])]
        .sort((a, b) => a.date.localeCompare(b.date));
    return {
      kind: "lines", code: r.computed ? null : r.code, name: r.name,
      rangeLabel: `${rangeLabel(from, to)} · posted journals`,
      opening: { label: `Permulaan · ${dayLabel(acc.openDate)}`, amount: r.opening },
      closing: { label: `Saldo akhir · ${dayLabel(to)}`, amount: r.closing }, lines,
      glTo: r.computed ? "/reports/profit-loss" : `/reports/general-ledger?${new URLSearchParams({ account: r.code, period: "custom", from, to })}`,
      note: "Increase is a credit, decrease a debit: equity grows with credits.",
    };
  };
  const drillView = (() => {
    if (!drill) return null;
    if (drill.acct) return acctDrill(drill.acct);
    const res = blockRes(drill.block);
    const row = res?.rows.find((r) => r.key === drill.row);
    if (!row) return null;
    const comp = comps.find((c) => c.key === drill.comp) || { label: "Total equity" };
    const lines = drill.comp === "total" ? Object.values(row.lines).flat().sort((a, b) => a.date.localeCompare(b.date)) : row.lines[drill.comp] || [];
    return {
      kind: "lines", code: null, name: `${row.label} — ${comp.label}`,
      rangeLabel: `${rangeLabel(res.from, res.to)} · posted journals on equity accounts`,
      opening: null, closing: { label: "Movement", amount: row.byComp[drill.comp] || 0 }, lines,
      glTo: `/reports/general-ledger?${new URLSearchParams({ account: drill.comp === "total" || drill.comp === "re" ? (comp.codes?.[0] || "3-1300") : drill.comp, period: "custom", from: res.from, to: res.to })}`,
      note: "Increase and decrease are on equity's side: a credit to an equity account grows it.",
    };
  })();
  const isOn = (block, row, comp) => drill?.block === block && drill.row === row && drill.comp === comp;

  // ── Rows ──────────────────────────────────────────────────────────────────
  const unitHead = UNITS[unit].head;
  const dash = <span className="lg-cell-em-dash">—</span>;
  const balanceLbl = (d) => ({ en: `Balance at ${longDate(d, "en")}`, id: `Saldo per ${longDate(d, "id")}` });
  const bsLink = (d) => ({ pathname: "/reports/balance-sheet", state: { period: { to: d } } });

  const AmountCells = ({ byComp, block, row, kind }) => keys.map((k) => {
    const v = byComp[k] || 0;
    const neg = v < -0.005;
    const cls = `lg-cell-total${k === "total" ? " tb-cell-end" : ""}${kind === "profit" && neg ? " pl-loss" : ""}`;
    const text = num(v, unit);
    const body = text === "—" ? dash : text;
    if (Math.abs(v) < 0.005) return <div key={k} className={cls}>{body}</div>;
    if (kind === "balance") {
      return <div key={k} className={cls}><Link className="pl-amt-link" to={bsLink(row)} title={`Open the Balance Sheet at ${dayLabel(row)}`}>{body}</Link></div>;
    }
    if (kind === "profit") {
      const res = blockRes(block);
      return <div key={k} className={cls}><Link className="pl-amt-link" to="/reports/profit-loss" state={{ period: { from: res.from, to: res.to } }} title={`Open the Profit & Loss for ${rangeLabel(res.from, res.to)}`}>{body}</Link></div>;
    }
    return (
      <div key={k} className={cls}>
        <button type="button" className={`txp-amt${isOn(block, row, k) ? " on" : ""}`} onClick={() => setDrill({ block, row, comp: k })}
          title="Show the journal lines behind this movement">{body}</button>
      </div>
    );
  });

  const Block = ({ res, block, showOpening, heading }) => (
    <Fragment>
      <div className="lg-row tb-group-row ce-period-row">
        <div className="tb-group-name"><span className="lg-group-lbl"><Lbl en={heading.en} id={heading.id} lang={lang} /></span></div>
        {keys.map((k) => <div key={k} />)}
      </div>
      {showOpening && (
        <div className="lg-row subtotal pl-subtotal ce-balance-row">
          <div className="tb-total-lbl"><Lbl {...balanceLbl(res.opening.date)} lang={lang} /></div>
          <AmountCells byComp={res.opening.byComp} kind="balance" row={res.opening.date} />
        </div>
      )}
      {res.rows.map((r) => (
        <div key={r.key} className="lg-row tb-acct-row">
          <div className="tb-cell-name" style={{ paddingLeft: 18 }}>
            <span className="tb-name"><Lbl en={r.label} id={r.id} lang={lang} /></span>
            {r.key === "profit" && (
              <Link className="tb-gl-btn no-print" to="/reports/profit-loss" state={{ period: { from: res.from, to: res.to } }}>Profit &amp; Loss {ARROW}</Link>
            )}
          </div>
          <AmountCells byComp={r.byComp} block={block} row={r.key} kind={r.key === "profit" ? "profit" : "move"} />
        </div>
      ))}
      <div className={`lg-row subtotal pl-subtotal ce-balance-row${block === "cur" ? " tb-total-row pl-grand" : ""}`}>
        <div className="tb-total-lbl"><Lbl {...balanceLbl(res.closing.date)} lang={lang} /></div>
        <AmountCells byComp={res.closing.byComp} kind="balance" row={res.closing.date} />
      </div>
    </Fragment>
  );

  const AcctAmt = ({ r, k, strong }) => {
    const v = r[k];
    const text = num(v, unit);
    const body = text === "—" ? dash : text;
    const cls = `lg-cell-total${k === "closing" ? " tb-cell-end" : ""}${(k === "opening" || k === "closing") && r.computed && v < -0.005 ? " pl-loss" : ""}`;
    if (strong || Math.abs(v) < 0.005) return <div className={cls}>{body}</div>;
    return (
      <div className={cls}>
        <button type="button" className={`txp-amt${drill?.acct === r.code ? " on" : ""}`} onClick={() => setDrill({ acct: r.code })}
          title={`Show ${r.name}'s journals from Permulaan to Saldo akhir`}>{body}</button>
      </div>
    );
  };
  const emptyCols = ACCT_COLS.map((c) => <div key={c.k} />);
  const accountRows = (
    <Fragment>
      <div className="lg-row tb-group-row ce-period-row">
        <div className="tb-group-name"><span className="lg-group-lbl"><Lbl en={`Period ${rangeLabel(from, to)}`} id={`Periode ${longDate(from, "id")} – ${longDate(to, "id")}`} lang={lang} /></span></div>
        {emptyCols}
      </div>
      <div className="lg-row tb-group-row tb-subgroup">
        <div className="tb-group-name" style={{ paddingLeft: 18 }}><span className="lg-group-lbl"><Lbl en="Equity" id="Modal" lang={lang} /></span></div>
        {emptyCols}
      </div>
      {acc.rows.map((r) => (
        <div key={r.code} className={`lg-row tb-acct-row${r.computed ? " bs-computed-row" : ""}${drill?.acct === r.code ? " selected" : ""}`}
          onDoubleClick={() => setDrill({ acct: r.code })}>
          <div className="tb-cell-name" style={{ paddingLeft: 36 }}>
            <span className="tb-code">{r.computed ? "" : r.code}</span>
            <button type="button" className="tb-name tb-acct-link bs-name-btn" onClick={() => setDrill({ acct: r.code })}><Lbl en={r.name} id={r.idName} lang={lang} /></button>
            {Math.abs(r.roll) >= 0.5 && !r.computed && (
              <span className="bs-rolled no-print" title="The previous fiscal year's profit/(loss) moved here at year-end, as a closing journal would. Calculated, not a posting.">incl. year-end roll</span>
            )}
            {r.computed
              ? <Link className="tb-gl-btn no-print" to="/reports/profit-loss" state={{ period: { from, to } }}>Profit &amp; Loss {ARROW}</Link>
              : <Link className="tb-gl-btn no-print" to={`/reports/general-ledger?${new URLSearchParams({ account: r.code, period: "custom", from, to })}`}>General Ledger {ARROW}</Link>}
          </div>
          {ACCT_COLS.map((c) => <AcctAmt key={c.k} r={r} k={c.k} />)}
        </div>
      ))}
      <div className="lg-row subtotal pl-subtotal tb-total-row pl-grand">
        <div className="tb-total-lbl"><Lbl en="Total" id="Total" lang={lang} /></div>
        {ACCT_COLS.map((c) => <AcctAmt key={c.k} r={acc.totals} k={c.k} strong />)}
      </div>
      <div className="lg-row subtotal ce-move-row">
        <div className="tb-total-lbl"><Lbl en="Net movement" id="Pergerakan" lang={lang} /></div>
        <div /><div /><div />
        <div className={`lg-cell-total tb-cell-end${acc.movement < -0.005 ? " pl-loss" : ""}`} title="Closing less opening: credits less debits for the period">{num(acc.movement, unit)}</div>
      </div>
    </Fragment>
  );

  const heading = (res) => {
    const fy = fiscalYearStartFor(res.from, fiscalYearStart);
    const [y, m] = fy.split("-");
    const fyEnd = dayBefore(`${Number(y) + 1}-${m}-01`);
    if (res.from === fy && res.to === fyEnd) return { en: `Year ended ${longDate(res.to, "en")}`, id: `Tahun yang berakhir ${longDate(res.to, "id")}` };
    return { en: `Period ${rangeLabel(res.from, res.to)}`, id: `Periode ${longDate(res.from, "id")} – ${longDate(res.to, "id")}` };
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const title = (l) => (l === "id" ? "Laporan Perubahan Ekuitas" : "Statement of Changes in Equity");
  const L = (o) => (lang === "id" ? o.id : o.en || o.label);
  const blocks = () => [prv && { res: prv, block: "prv", open: true }, { res: cur, block: "cur", open: !chained }].filter(Boolean);
  const exportBase = exportName("changes-in-equity", from, to);

  // By account: Jurnal's columns, with live formulas (closing = opening −
  // debit + credit; totals; Pergerakan = closing − opening).
  const exportAccountsXlsx = () => {
    const scaled = (v) => r2((v || 0) / unit);
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }], [{ v: lang === "id" ? "Perubahan Modal" : "Changes in Equity", s: "title" }], [forPeriod(from, to, lang)],
      [{ v: `(${UNITS[unit][lang === "id" ? "id" : "en"]})`, s: "muted" }], [{ v: isFinal ? "Final" : lang === "id" ? "Sementara" : "Preliminary", s: "muted" }], [],
      [{ v: lang === "id" ? "Kode Akun" : "Account code", s: "head" }, { v: lang === "id" ? "Nama Akun" : "Account name", s: "head" }, ...ACCT_COLS.map((c) => ({ v: lang === "id" ? c.id : c.en, s: "headNum" }))],
    ];
    const freeze = rows.length;
    rows.push(["", { v: lang === "id" ? "MODAL" : "EQUITY", s: "bold" }]);
    const first = rows.length + 1;
    acc.rows.forEach((r) => {
      const n = rows.length + 1;
      rows.push([r.computed ? "" : r.code, `   ${lang === "id" ? r.idName : r.name}`, { v: scaled(r.opening), s: "num" }, { v: scaled(r.debit), s: "num" }, { v: scaled(r.credit), s: "num" },
        { f: `C${n}-D${n}+E${n}`, v: scaled(r.closing), s: "num" }]);
    });
    const last = rows.length;
    const tot = rows.length + 1;
    rows.push(["", { v: "Total", s: "bold" }, ...["C", "D", "E", "F"].map((c, i) => ({ f: `SUM(${c}${first}:${c}${last})`, v: scaled(acc.totals[ACCT_COLS[i].k]), s: "numBold" }))]);
    rows.push(["", { v: lang === "id" ? "Pergerakan" : "Net movement", s: "bold" }, null, null, null, { f: `F${tot}-C${tot}`, v: scaled(acc.movement), s: "numBold" }]);
    rows.push(...signOffRows(lang, user?.name));
    downloadXlsx(exportBase.replace(/\.csv$/, ".xlsx"), { sheet: "Perubahan Modal", rows, widths: [12, 40, 20, 20, 20, 20], freeze });
    showToast("Perubahan Modal exported to Excel");
  };
  const exportAccountsCsv = () => {
    downloadCsv(exportBase, {
      header: [...reportHeader({ report: lang === "id" ? "Perubahan Modal" : "Changes in Equity", period: forPeriod(from, to, lang), runBy: user?.name }), [UNITS[unit][lang === "id" ? "id" : "en"]]],
      columns: [
        { label: lang === "id" ? "Kode Akun" : "Account code", value: (r) => (r.computed ? "" : r.code || "") },
        { label: lang === "id" ? "Nama Akun" : "Account name", value: (r) => (lang === "id" ? r.idName : r.name) },
        ...ACCT_COLS.map((c) => ({ label: lang === "id" ? c.id : c.en, value: (r) => (r[c.k] == null ? "" : r2(r[c.k] / unit)) })),
      ],
      rows: [...acc.rows, { name: "Total", idName: "Total", ...acc.totals }, { name: "Net movement", idName: "Pergerakan", closing: acc.movement }],
    });
    showToast("Perubahan Modal exported to CSV");
  };

  function exportXlsx() {
    closePop();
    if (byAccount) { exportAccountsXlsx(); return; }
    const scaled = (v) => r2((v || 0) / unit);
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }],
      [{ v: title(lang), s: "title" }],
      [forPeriod(from, to, lang)],
      [{ v: `(${UNITS[unit][lang === "id" ? "id" : "en"]})`, s: "muted" }],
      [{ v: isFinal ? "Final" : lang === "id" ? "Sementara" : "Preliminary", s: "muted" }],
      [],
      [{ v: lang === "id" ? "Keterangan" : "Line", s: "head" }, ...comps.map((c) => ({ v: lang === "id" ? c.id : c.label, s: "headNum" })), { v: lang === "id" ? "Jumlah ekuitas" : "Total equity", s: "headNum" }],
    ];
    const freeze = rows.length;
    let openRow = null;
    blocks().forEach(({ res, open }) => {
      rows.push([{ v: L(heading(res)), s: "bold" }]);
      if (open) {
        rows.push([{ v: L(balanceLbl(res.opening.date)), s: "bold" }, ...comps.map((c) => ({ v: scaled(res.opening.byComp[c.key]), s: "numBold" })), null]);
        openRow = rows.length;
        rows[rows.length - 1][comps.length + 1] = { f: `SUM(${colName(1)}${openRow}:${colName(comps.length)}${openRow})`, v: scaled(res.opening.byComp.total), s: "numBold" };
      }
      const first = rows.length + 1;
      res.rows.forEach((r) => {
        rows.push([`   ${L(r)}`, ...comps.map((c) => (r.byComp[c.key] ? { v: scaled(r.byComp[c.key]), s: "num" } : null)), null]);
        const n = rows.length;
        rows[n - 1][comps.length + 1] = { f: `SUM(${colName(1)}${n}:${colName(comps.length)}${n})`, v: scaled(r.byComp.total), s: "num" };
      });
      const last = rows.length;
      const close = [{ v: L(balanceLbl(res.closing.date)), s: "bold" }];
      [...comps.map((c) => c.key), "total"].forEach((k, i) => {
        const col = colName(1 + i);
        close.push({ f: `${col}${openRow}+SUM(${col}${first}:${col}${last})`, v: scaled(res.closing.byComp[k]), s: "numBold" });
      });
      rows.push(close);
      openRow = rows.length;
    });
    rows.push(...signOffRows(lang, user?.name));
    downloadXlsx(exportBase.replace(/\.csv$/, ".xlsx"), { sheet: lang === "id" ? "Perubahan Ekuitas" : "Changes in Equity", rows, widths: [48, ...comps.map(() => 20), 20], freeze });
    showToast("Changes in Equity exported to Excel");
  }
  function exportCsv() {
    closePop();
    if (byAccount) { exportAccountsCsv(); return; }
    const items = [];
    blocks().forEach(({ res, open }) => {
      items.push({ label: L(heading(res)), byComp: null });
      if (open) items.push({ label: L(balanceLbl(res.opening.date)), byComp: res.opening.byComp });
      res.rows.forEach((r) => items.push({ label: L(r), byComp: r.byComp }));
      items.push({ label: L(balanceLbl(res.closing.date)), byComp: res.closing.byComp });
    });
    downloadCsv(exportBase, {
      header: [...reportHeader({ report: title(lang), period: forPeriod(from, to, lang), runBy: user?.name }), [UNITS[unit][lang === "id" ? "id" : "en"]]],
      columns: [
        { label: lang === "id" ? "Keterangan" : "Line", value: (it) => it.label },
        ...[...comps, { key: "total", label: "Total equity", id: "Jumlah ekuitas" }].map((c) => ({
          label: lang === "id" ? c.id : c.label, value: (it) => (it.byComp ? r2((it.byComp[c.key] || 0) / unit) : ""),
        })),
      ],
      rows: items,
    });
    showToast("Changes in Equity exported to CSV");
  }
  const exportPrint = () => { closePop(); setTimeout(printReport, 50); };

  const compareItems = [
    { k: "none", lbl: "No comparison" },
    { k: "prior_fy", lbl: "Prior fiscal year", hint: (() => { const e = dayBefore(fiscalYearStartFor(from, fiscalYearStart)); return rangeLabel(fiscalYearStartFor(e, fiscalYearStart), e); })() },
    { k: "prev_year", lbl: "Same period last year", hint: rangeLabel(sameDayLastYear(from), sameDayLastYear(to)) },
  ];
  const isDefault = period.key === DEFAULTS.period.key && compare === DEFAULTS.compare && unit === DEFAULTS.unit && lang === DEFAULTS.lang && viewMode === DEFAULTS.viewMode;

  return (
    <div className={`lg-page tb-report pl-page ce-page${drillView ? " txp-is-open" : ""}`}>
      <div className="lg-scroll-container">
        <PrintHead title={byAccount ? (lang === "id" ? "Perubahan Modal" : "Changes in Equity") : title(lang)} lines={[forPeriod(from, to, lang), `(${UNITS[unit][lang === "id" ? "id" : "en"]}) · ${isFinal ? "Final" : lang === "id" ? "Sementara" : "Preliminary"}`]} />

        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Changes in Equity <span className="ce-title-id">Perubahan Modal</span></h1>
              <p className="st-sub">{byAccount
                ? "Each equity account from the start of the period to the end: opening, debits, credits and closing."
                : "The statement for the audited financials: how each equity component moved, with the prior year above."}</p>
            </div>
            <div className="lg-head-actions no-print">
              <div className="lg-meta-btn-wrap">
                <button className="lg-btn-brand" onClick={() => togglePop("export")} aria-haspopup="menu" aria-expanded={openPop === "export"}>{DOWNLOAD} Export</button>
                {openPop === "export" && <ExportPopover onXlsx={exportXlsx} onCsv={exportCsv} onPrint={exportPrint} onClose={closePop} />}
              </div>
            </div>
          </div>
          <div className="tb-status no-print">
            <span className={`tb-status-chip ${isFinal ? "closed" : "open"}`}>{isFinal ? "Final" : "Preliminary"}</span>
            <span>{isFinal ? `Books are closed through ${monthLabel(`${closedThrough}-01`)}.` : "This period is open — equity may change as journals are posted."}</span>
            {unposted.length > 0 && (
              <><span className="tb-status-sep">·</span>
                <button className="tb-status-link" onClick={() => navigate("/journal-entry")}>{plural(unposted.length, "draft or pending journal")} in this period {unposted.length === 1 ? "isn't" : "aren't"} included</button></>
            )}
            <span className="tb-status-sep">·</span>
            <span className={`tb-foot ${allTie ? "ok" : "off"}`} title="Opening balance plus every movement equals the closing balance, column by column.">
              <span aria-hidden="true">{allTie ? "✓" : "✕"}</span> {allTie ? (byAccount ? "Opening − debit + credit = closing" : "Opening + movements = closing") : byAccount ? "An account doesn't roll forward" : `Movements are off by ${rp(cur.difference.total)}`}
            </span>
            <span className="tb-status-sep">·</span>
            <Link className={`tb-foot st-foot-link ${bsTies ? "ok" : "off"}`} to={bsLink(to)} title="Closing total equity against the Balance Sheet's total equity at the same date.">
              <span aria-hidden="true">{bsTies ? "✓" : "✕"}</span> Ties to Balance Sheet equity at {dayLabel(to)}
            </Link>
            <span className="tb-status-sep">·</span>
            <span className="tb-unit-note">{UNITS[unit].en}</span>
          </div>
        </div>

        <div className="lg-table-wrap pl-wrap">
          <div className={`lg-card lg-table-tb pl-card${byAccount ? " ce-by-account" : ""}`} style={{ "--tb-n": byAccount ? ACCT_COLS.length : keys.length }}>
            <div className="lg-filter-row no-print tb-filter-row pl-toolbar">
              <div className="tb-toolbar-left">
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn tb-period-btn" onClick={() => togglePop("period")} aria-haspopup="dialog" aria-expanded={openPop === "period"}>
                    {CAL}<span className="meta-lbl">Period</span><span className="meta-val">{rangeLabel(from, to)}</span>
                    {period.key !== "custom" && <span className="meta-lbl">· {period.label}</span>}
                  </button>
                  {openPop === "period" && <PeriodPopover presets={presets} period={period} onPick={(c) => { setPeriodChoice(c); closePop(); }} onClose={closePop} />}
                </div>
                <div className="rc-seg ce-view-seg" role="group" aria-label="View">
                  {VIEWS.map((v) => (
                    <button key={v.k} type="button" className={viewMode === v.k ? "on" : ""} aria-pressed={viewMode === v.k} onClick={() => { setViewMode(v.k); setDrill(null); }}>{v.lbl}</button>
                  ))}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${prior && !byAccount ? " active" : ""}`} onClick={() => togglePop("compare")} disabled={byAccount}
                    title={byAccount ? "The account view covers one period. Switch to Statement to stack the prior year above." : undefined} aria-haspopup="menu" aria-expanded={openPop === "compare"}>
                    <span className="meta-lbl">Compare:</span><span className="meta-val">{byAccount ? "None" : COMPARE_LABELS[compare]}</span>
                  </button>
                  {openPop === "compare" && <ChoicePopover className="tb-compare-pop" items={compareItems} value={compare} onPick={(k) => { setCompare(k); closePop(); }} onClose={closePop}
                    note="The comparative period is stacked above the current one, as the statement is printed." />}
                </div>
              </div>
              <div className="lg-filter-meta">
                <div className="lg-meta-btn-wrap">
                  <button className={`tb-icon-btn${openPop === "settings" ? " on" : ""}`} onClick={() => togglePop("settings")} title="Report settings" aria-label="Open report settings">{GEAR}</button>
                  {openPop === "settings" && <FormatPopover unit={unit} onUnit={setUnit} lang={lang} onLang={setLang} onClose={closePop} />}
                </div>
                {!isDefault && <button className="lg-reset-all" onClick={() => { setPeriodChoice(DEFAULTS.period); setCompare(DEFAULTS.compare); setUnit(DEFAULTS.unit); setLang(DEFAULTS.lang); setViewMode(DEFAULTS.viewMode); }}>Reset all</button>}
              </div>
            </div>

            {byAccount ? (
            <div className="pl-statement">
              <div className="lg-col-header">
                <div><Lbl en="Account" id="Kode / Nama Akun" lang={lang} /></div>
                {ACCT_COLS.map((c) => <div key={c.k} style={{ textAlign: "right" }}><Lbl en={c.en} id={c.id} lang={lang} /> <span className="pl-th-unit">({unitHead})</span></div>)}
              </div>
              <div>{accountRows}</div>
            </div>
            ) : (
            <div className="pl-statement">
              <div className="lg-col-header">
                <div><Lbl en="Line" id="Keterangan" lang={lang} /></div>
                {comps.map((c) => (
                  <div key={c.key} style={{ textAlign: "right" }} title={c.codes.filter((x) => !x.startsWith("__")).join(", ")}>
                    <Lbl en={c.label} id={c.id} lang={lang} /> <span className="pl-th-unit">({unitHead})</span>
                  </div>
                ))}
                <div style={{ textAlign: "right" }}><Lbl en="Total equity" id="Jumlah ekuitas" lang={lang} /> <span className="pl-th-unit">({unitHead})</span></div>
              </div>
              <div>
                {prv && <Block res={prv} block="prv" showOpening heading={heading(prv)} />}
                {prv && !chained && <div className="ce-gap" />}
                <Block res={cur} block="cur" showOpening={!chained} heading={heading(cur)} />
              </div>
            </div>
            )}
            {!allTie && !byAccount && (
              <div className="pl-warn">Opening balance plus movements doesn&apos;t reach the closing balance ({rp(cur.difference.total)}). A posting on an equity account may be missing its classification.</div>
            )}
            <SignOff lang={lang} preparedBy={user?.name} />
          </div>
          {byAccount ? (
          <p className="pl-foot no-print">
            Every equity account in code order, as a Trial Balance would show it: Permulaan at {dayLabel(acc.openDate)}, the period&apos;s debits and credits, Saldo akhir at {dayLabel(to)}.
            {" "}Current year profit/(loss) has no account in Klay (no closing journal), so it&apos;s its own row, from the Profit &amp; Loss; when the period crosses a year-end, last year&apos;s result moves into retained earnings as a closing journal would.
            {" "}Click an account to see its journals. Switch to Statement (SAK EP) for the version that goes into the audited financials.
          </p>
          ) : (
          <p className="pl-foot no-print">
            Each equity account is a column; retained earnings, current year earnings and dividends share the Retained earnings column (saldo laba), as SAK EP prints it.
            {" "}Profit/(loss) is the Profit &amp; Loss for the same dates. Click a movement to see its journals beside the statement; a balance opens the Balance Sheet at that date.
          </p>
          )}
        </div>
      </div>

      <div className="lg-footer no-print">
        <div className="lg-footer-left"><span>{byAccount ? `${plural(acc.rows.length - 1, "equity account")} + current year profit/(loss)` : `${plural(cur.rows.length, "movement")} this period`}</span></div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Equity at {dayLabel(dayBefore(from))}</span>
          <span className="lg-footer-total">{rp(cur.opening.byComp.total)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Equity at {dayLabel(to)}</span>
          <span className={`lg-footer-total${cur.closing.byComp.total < 0 ? " pl-footer-loss" : ""}`}>{rp(cur.closing.byComp.total)}</span>
          <span className="lg-footer-sep">·</span>
          <span className={`tb-balance-flag ${bsTies ? "ok" : "off"}`}>{bsTies ? "✓ Ties to Balance Sheet" : "Off the Balance Sheet"}</span>
        </div>
      </div>

      {drillView && <TransactionsPanel view={drillView} onClose={closeDrill} />}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
