// Reports → Profit & Loss.
//
// Income statement for a period, from posted journals only (lib/profitLoss.js
// does the arithmetic). Sections collapse to their totals; an account amount
// opens that account in the General Ledger for the period's end month.
// Optional comparison with the previous period of the same length.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { COMPANY } from "../data/seed/company";
import { computeProfitLoss, unpostedInPeriod, change } from "../lib/profitLoss";
import { periodPresets, previousPeriod, rangeLabel, monthLabel } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import "./modules.css";
import "./invoices-ledger.css";
import "./cashflow-report.css";
import "./profit-loss.css";

// ── Formatting ──────────────────────────────────────────────────────────────
// Statement amounts: id-ID grouping, negatives in parentheses, zero as a dash.
const num = (v) => {
  if (v == null) return "";
  if (Math.abs(v) < 0.005) return "—";
  const s = Math.abs(v).toLocaleString("id-ID");
  return v < 0 ? `(${s})` : s;
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

const CUSTOM = "custom";

function ChevronIcon({ open }) {
  return (
    <svg className={`pl-chev${open ? " open" : ""}`} viewBox="0 0 12 12" aria-hidden>
      <polyline points="4 2.5 7.5 6 4 9.5" />
    </svg>
  );
}

// Export menu: Excel (CSV) and Print / PDF.
function ExportMenu({ onCsv, onPrint }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (fn) => { setOpen(false); fn(); };
  return (
    <div className="lg-meta-btn-wrap" ref={ref}>
      <button type="button" className="lg-btn-brand" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        Export
      </button>
      {open && (
        <div className="lg-popover" role="menu">
          <div className="lg-popover-list">
            <button type="button" role="menuitem" className="lg-popover-item" onClick={() => pick(onCsv)}>Excel (CSV)</button>
            <button type="button" role="menuitem" className="lg-popover-item" onClick={() => pick(onPrint)}>Print / PDF</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfitLossPage() {
  const navigate = useNavigate();
  const { entries } = useJournalEntries();
  const { fiscalYearStart } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();

  // ── Period ────────────────────────────────────────────────────────────────
  const presets = useMemo(() => periodPresets({ fiscalYearStart }), [fiscalYearStart]);
  const ytd = presets.find((p) => p.key === "ytd") || presets[0];
  const [presetKey, setPresetKey] = useState("ytd");
  const [custom, setCustom] = useState({ from: ytd.from, to: ytd.to });
  const [compare, setCompare] = useState("none");
  const [showPct, setShowPct] = useState(true);
  const [showZero, setShowZero] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  const preset = presets.find((p) => p.key === presetKey);
  const rawPeriod = presetKey === CUSTOM || !preset ? custom : { from: preset.from, to: preset.to };
  // A custom range typed backwards still reads sensibly.
  const period = rawPeriod.from && rawPeriod.to && rawPeriod.from > rawPeriod.to
    ? { from: rawPeriod.to, to: rawPeriod.from }
    : rawPeriod;
  const validPeriod = Boolean(period.from && period.to);
  const comparing = compare === "prev" && validPeriod;
  // The previous period of the same length — shown in the Compare select even
  // before comparison is switched on.
  const nextPrior = validPeriod ? previousPeriod(period.from, period.to) : null;
  const prior = comparing ? nextPrior : null;

  const pickPreset = (key) => {
    if (key === CUSTOM) {
      // Start the custom range from whatever was showing.
      setCustom({ from: period.from, to: period.to });
    }
    setPresetKey(key);
  };

  // ── Compute ───────────────────────────────────────────────────────────────
  const pl = useMemo(
    () => (validPeriod ? computeProfitLoss(entries, period) : null),
    [entries, period.from, period.to, validPeriod], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const plPrior = useMemo(
    () => (prior ? computeProfitLoss(entries, prior) : null),
    [entries, prior?.from, prior?.to], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const unposted = useMemo(
    () => (validPeriod ? unpostedInPeriod(entries, period) : []),
    [entries, period.from, period.to, validPeriod], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const periodLabel = validPeriod ? rangeLabel(period.from, period.to) : "—";
  const priorLabel = prior ? rangeLabel(prior.from, prior.to) : "";
  const endYm = validPeriod ? period.to.slice(0, 7) : "";
  const isFinal = validPeriod && endYm <= closedThrough;

  // ── Row visibility ────────────────────────────────────────────────────────
  // A zero row is hidden unless "Show zero balances" is on — when comparing,
  // only if it is zero in both periods.
  const priorRow = (sectionKey, code) => plPrior?.sections[sectionKey].rows.find((r) => r.code === code);
  const visibleRows = (sectionKey) => {
    if (!pl) return [];
    return pl.sections[sectionKey].rows.filter((r) => showZero || !r.zero || (comparing && priorRow(sectionKey, r.code) && !priorRow(sectionKey, r.code).zero));
  };
  const sectionKeys = pl ? pl.statement.filter((l) => l.kind === "section").map((l) => l.key) : [];
  const expandable = sectionKeys.filter((k) => visibleRows(k).length > 0);
  const allExpanded = expandable.length > 0 && expandable.every((k) => expanded.has(k));
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(expandable));

  // Amounts in comparison: value for a statement line in either period.
  const lineAmount = (res, line) => {
    if (!res) return null;
    if (line.kind === "subtotal") return res.totals[line.key];
    if (line.kind === "section") return res.sections[line.key].total;
    return null;
  };

  const openLedger = (code, ym) => navigate(`/general-ledger?account=${encodeURIComponent(code)}&period=${ym}`);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportCsv = () => {
    if (!pl) return;
    const rows = [];
    for (const line of pl.statement) {
      if (line.kind === "heading") {
        rows.push({ section: line.label, code: "", line: line.label, amount: null, prior: null, blank: true });
        continue;
      }
      if (line.kind === "subtotal") {
        rows.push({ section: "Subtotal", code: "", line: line.label, amount: line.amount, prior: lineAmount(plPrior, line) });
        continue;
      }
      const sec = pl.sections[line.key];
      for (const r of visibleRows(line.key)) {
        rows.push({ section: sec.label, code: r.code, line: r.name, amount: r.amount, prior: priorRow(line.key, r.code)?.amount ?? null });
      }
      rows.push({ section: sec.label, code: "", line: `Total ${sec.label.replace(/^Less: /, "").toLowerCase()}`, amount: sec.total, prior: lineAmount(plPrior, line) });
    }
    const columns = [
      { label: "Section", value: (r) => r.section },
      { label: "Code", value: (r) => r.code },
      { label: "Line", value: (r) => r.line },
      { label: `Amount ${periodLabel} (Rp)`, value: (r) => (r.blank ? "" : r.amount) },
    ];
    if (comparing) {
      columns.push(
        { label: `Amount ${priorLabel} (Rp)`, value: (r) => (r.blank ? "" : r.prior ?? 0) },
        { label: "Change (Rp)", value: (r) => (r.blank ? "" : change(r.amount, r.prior).diff) },
        { label: "Change (%)", value: (r) => {
          if (r.blank) return "";
          const p = change(r.amount, r.prior).pct;
          return p == null ? "" : Math.round(p * 1000) / 10;
        } },
      );
    }
    downloadCsv(exportName("profit-loss", period.from, period.to), {
      header: reportHeader({
        report: "Profit & Loss",
        period: comparing ? `${periodLabel} (compared with ${priorLabel})` : periodLabel,
        runBy: user?.name,
      }),
      columns,
      rows,
    });
  };

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const t = pl?.totals;
  const tp = plPrior?.totals;
  const vsPrior = (key) => {
    if (!tp) return null;
    const c = change(t[key], tp[key]);
    if (c.pct == null) return `${rp(tp[key])} in ${priorLabel}`;
    return `${c.pct >= 0 ? "+" : "−"}${pct(Math.abs(c.pct))} vs ${priorLabel}`;
  };
  const kpis = t ? [
    { lbl: "Net revenue", val: rp(t.netRevenue), sub: vsPrior("netRevenue") || (t.contra ? `After ${rp(t.contra)} returns & discounts` : "Revenue less returns & discounts"), neg: t.netRevenue < 0 },
    { lbl: "Gross profit", val: rp(t.grossProfit), sub: `Margin ${pct(pl.grossMargin)}`, neg: t.grossProfit < 0 },
    { lbl: "Operating profit", val: rp(t.operatingProfit), sub: `Margin ${pct(pl.operatingMargin)}`, neg: t.operatingProfit < 0 },
    { lbl: "Net profit", val: rp(t.netProfit), sub: t.netProfit < 0 ? `Net loss · margin ${pct(pl.netMargin)}` : `Margin ${pct(pl.netMargin)}`, neg: t.netProfit < 0 },
  ] : [];

  // ── Table ─────────────────────────────────────────────────────────────────
  const colCount = 2 + (showPct ? 1 : 0) + (comparing ? 3 : 0);
  const pctOf = (v) => (pl && pl.totals.netRevenue ? v / pl.totals.netRevenue : null);

  const amountCells = ({ cur, prev, code, bold }) => {
    const c = comparing ? change(cur, prev) : null;
    return (
      <>
        <td className="pl-num">
          {code && Math.abs(cur) >= 0.005 ? (
            <button type="button" className="pl-amt-link" title={`Open ${code} in the General Ledger (${monthLabel(period.to)})`} onClick={() => openLedger(code, endYm)}>{num(cur)}</button>
          ) : num(cur)}
        </td>
        {showPct && <td className="pl-num pl-pct">{pctOf(cur) == null ? "—" : pct(pctOf(cur))}</td>}
        {comparing && (
          <>
            <td className="pl-num pl-cmp">
              {code && prev && Math.abs(prev) >= 0.005 ? (
                <button type="button" className="pl-amt-link" title={`Open ${code} in the General Ledger (${monthLabel(prior.to)})`} onClick={() => openLedger(code, prior.to.slice(0, 7))}>{num(prev)}</button>
              ) : num(prev ?? 0)}
            </td>
            <td className={`pl-num${bold ? "" : " pl-chg"}`}>{num(c.diff)}</td>
            <td className={`pl-num pl-pct${bold ? "" : " pl-chg"}`}>{c.pct == null ? "—" : pct(c.pct)}</td>
          </>
        )}
      </>
    );
  };

  return (
    <div className="lg-page pl-page">
      <div className="lg-scroll-container">
        {/* ── Print header ─────────────────────────────────────────────── */}
        <div className="print-only pl-print-head">
          <div className="pl-print-co">{COMPANY.legalName}</div>
          <div className="pl-print-title">Profit &amp; Loss</div>
          <div className="pl-print-period">
            {periodLabel}{comparing ? ` · compared with ${priorLabel}` : ""} · {isFinal ? "Final" : "Preliminary"}
          </div>
        </div>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="lg-head lg-head-plain pl-head no-print">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="cfr-back" onClick={() => navigate("/reports")}>← Reports</button>
              <h1 className="lg-title">Profit &amp; Loss</h1>
              <p className="cfr-lede">Revenue, costs and profit for {periodLabel}, from posted journals.</p>
            </div>
            <div className="lg-head-actions">
              <ExportMenu onCsv={exportCsv} onPrint={printReport} />
            </div>
          </div>

          {t && (
            <div className="lg-kpi-strip pl-kpis">
              {kpis.map((k) => (
                <div key={k.lbl} className="lg-kpi-cell pl-kpi">
                  <div className="lg-kpi-lbl">{k.lbl}</div>
                  <div className={`lg-kpi-val${k.neg ? " danger" : ""}`}>{k.val}</div>
                  <div className="lg-kpi-sub">{k.sub}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg-table-wrap pl-wrap">
          {/* ── Controls ───────────────────────────────────────────────── */}
          <div className="pl-controls no-print">
            <label className="pl-field">
              <span className="pl-field-lbl">Period</span>
              <select className="pl-select" value={presetKey} onChange={(e) => pickPreset(e.target.value)}>
                {presets.map((p) => <option key={p.key} value={p.key}>{p.label} · {rangeLabel(p.from, p.to)}</option>)}
                <option value={CUSTOM}>Custom range…</option>
              </select>
            </label>
            {presetKey === CUSTOM && (
              <div className="pl-field pl-dates">
                <span className="pl-field-lbl">From – to</span>
                <div className="pl-dates-row">
                  <input type="date" className="pl-select" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From date" />
                  <span className="pl-dash">–</span>
                  <input type="date" className="pl-select" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To date" />
                </div>
              </div>
            )}
            <label className="pl-field">
              <span className="pl-field-lbl">Compare with</span>
              <select className="pl-select" value={compare} onChange={(e) => setCompare(e.target.value)}>
                <option value="none">None</option>
                <option value="prev">Previous period{nextPrior ? ` · ${rangeLabel(nextPrior.from, nextPrior.to)}` : ""}</option>
              </select>
            </label>
            <div className="pl-toggles">
              <label className="pl-check"><input type="checkbox" checked={showPct} onChange={(e) => setShowPct(e.target.checked)} /> % of revenue</label>
              <label className="pl-check"><input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> Show zero balances</label>
            </div>
          </div>

          {/* ── Status line ────────────────────────────────────────────── */}
          {validPeriod && (
            <div className="pl-status">
              <span className={`pl-status-pill ${isFinal ? "final" : "prelim"}`}>{isFinal ? "Final" : "Preliminary"}</span>
              <span className="pl-status-text">
                {isFinal
                  ? `The period is closed (books closed through ${monthLabel(`${closedThrough}-01`)}).`
                  : "Preliminary — the period is still open."}
                {unposted.length > 0 && (
                  <>
                    {" "}
                    <button type="button" className="pl-status-link no-print" onClick={() => navigate("/journal-entry")}>
                      {unposted.length} draft or pending journal{unposted.length === 1 ? "" : "s"}
                    </button>
                    <span className="print-only pl-inline">{unposted.length} draft or pending journal{unposted.length === 1 ? "" : "s"}</span>
                    {" "}dated in the period {unposted.length === 1 ? "is" : "are"} not included.
                  </>
                )}
              </span>
            </div>
          )}

          {/* ── Statement ──────────────────────────────────────────────── */}
          <div className="lg-card pl-card">
            {!pl ? (
              <div className="pl-empty">Pick a start and end date to run the report.</div>
            ) : (
              <>
                <div className="pl-card-bar no-print">
                  <span className="pl-card-note">Click a section to see its accounts; click an amount to open the General Ledger.</span>
                  <button type="button" className="lg-meta-btn" onClick={toggleAll} disabled={expandable.length === 0}>
                    {allExpanded ? "Collapse all" : "Expand all"}
                  </button>
                </div>
                <div className="pl-table-scroll">
                  <table className={`pl-table${comparing ? " cmp" : ""}`}>
                    <thead>
                      <tr>
                        <th className="pl-th-line">Line</th>
                        <th className="pl-num">{comparing ? periodLabel : "Amount"} <span className="pl-th-unit">(Rp)</span></th>
                        {showPct && <th className="pl-num pl-pct">% of rev.</th>}
                        {comparing && (
                          <>
                            <th className="pl-num">{priorLabel} <span className="pl-th-unit">(Rp)</span></th>
                            <th className="pl-num">Change <span className="pl-th-unit">(Rp)</span></th>
                            <th className="pl-num pl-pct">Change %</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {pl.statement.map((line) => {
                        if (line.kind === "heading") {
                          return (
                            <tr key={line.key} className="pl-row-heading">
                              <td colSpan={colCount}>{line.label}</td>
                            </tr>
                          );
                        }
                        if (line.kind === "subtotal") {
                          return (
                            <tr key={line.key} className={`pl-row-subtotal${line.minor ? " minor" : ""}${line.grand ? " grand" : ""}`}>
                              <td className="pl-line">
                                {line.label}
                                {line.key === "grossProfit" && pl.grossMargin != null && <span className="pl-margin">margin {pct(pl.grossMargin)}</span>}
                              </td>
                              {amountCells({ cur: line.amount, prev: lineAmount(plPrior, line), bold: true })}
                            </tr>
                          );
                        }
                        const sec = pl.sections[line.key];
                        const rows = visibleRows(line.key);
                        const open = expanded.has(line.key) && rows.length > 0;
                        return (
                          <Fragment key={line.key}>
                            <tr className={`pl-row-section${line.nested ? " nested" : ""}${open ? " open" : ""}${rows.length ? "" : " empty"}`}>
                              <td className="pl-line">
                                <button type="button" className="pl-sec-btn" onClick={() => toggle(line.key)} disabled={!rows.length} aria-expanded={open}>
                                  <ChevronIcon open={open} />
                                  <span>{sec.label}</span>
                                  <span className="pl-sec-count">{rows.length ? `${rows.length} account${rows.length === 1 ? "" : "s"}` : "no activity"}</span>
                                </button>
                              </td>
                              {amountCells({ cur: sec.total, prev: lineAmount(plPrior, line) })}
                            </tr>
                            {open && rows.map((r) => (
                              <tr key={r.code} className={`pl-row-account${line.nested ? " nested" : ""}`}>
                                <td className="pl-line">
                                  <span className="pl-code">{r.code}</span>
                                  <span className="pl-name">{r.name}</span>
                                </td>
                                {amountCells({ cur: r.amount, prev: priorRow(line.key, r.code)?.amount ?? 0, code: r.code })}
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!pl.balanced && (
                  <div className="pl-warn">
                    Net profit ({num(pl.totals.netProfit)}) does not match the sum of P&amp;L accounts ({num(pl.netProfitCheck)}).
                  </div>
                )}
              </>
            )}
          </div>
          <p className="pl-foot">
            Expenses and deductions are shown as positive amounts and subtracted in the subtotals. Negative results are in parentheses.
            {showPct && " % of revenue is each line divided by net revenue."}
          </p>
        </div>
      </div>
    </div>
  );
}
