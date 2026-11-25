// Reports → Director's Summary (Ringkasan Direksi; the CEO calls it the
// Executive Summary).
//
// From the competitor benchmark (docs/research/directors-summary/README.md)
// and the Linear scope (P-TRA-37): one page the finance team hands the
// directors — headline numbers from the P&L, Balance Sheet, Cash Flow and
// Changes in Equity against the prior period, short commentary, Print / PDF.
//
// Nothing here is computed on its own: every figure comes from the same lib
// the statement uses (profitLoss, balanceSheet, cashFlow, changesInEquity),
// so a number on this page is the number on its statement, and each card
// opens that statement for the same dates. Layout borrows the Klay Impact
// summary boxes (figure first, then what made it up) and the statements'
// toolbar, status line, print header and sign-off.
//
// Commentary: Klay drafts bullet highlights from the numbers (largest moves,
// losses, cash runway); the finance team writes the note the directors read.
// The note is kept per period (browser storage in the prototype).

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { computeProfitLoss, change, unpostedInPeriod } from "../lib/profitLoss";
import { computeBalanceSheet, bsRatios } from "../lib/balanceSheet";
import { computeCashFlow } from "../lib/cashFlow";
import { computeChangesInEquity } from "../lib/changesInEquity";
import { periodCloseState } from "../lib/trialBalance";
import { periodPresets, rangeLabel, dayLabel, dayBefore, previousPeriod, sameDayLastYear, fiscalYearStartFor, monthLabel } from "../lib/reportPeriods";
import { printReport } from "../lib/reportExport";
import { downloadXlsx } from "../lib/xlsxExport";
import { ChoicePopover, PeriodPopover, ExportPopover, loadLocal, saveLocal } from "../components/ReportControls";
import { num, rp, rpShort, pct, r2, plural, forPeriod, CAL, ARROW, DOWNLOAD, PrintHead, SignOff } from "../components/StatementKit";
import "./modules.css";
import "./invoices-ledger.css";
import "./trial-balance.css";
import "./profit-loss.css";
import "./statements.css";

const COMPARE_LABELS = { prev: "Previous period", prev_year: "Same period last year" };
const DEFAULTS = { period: { key: "last_month" }, compare: "prev" };
const times = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`);

// A change with its direction judged: "good" when it moves the way a
// director wants (revenue up, costs down…).
function Delta({ cur, prev, goodUp = true, kind = "pct" }) {
  if (cur == null || prev == null) return null;
  const { diff, pct: p } = change(cur, prev);
  if (Math.abs(diff) < 0.5) return <span className="ds-delta flat">no change</span>;
  const good = goodUp ? diff > 0 : diff < 0;
  const text = kind === "pts" ? `${diff > 0 ? "+" : "−"}${Math.abs(diff * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })} pts`
    : p == null ? `${diff > 0 ? "+" : "−"}${rpShort(Math.abs(diff))}` : `${diff > 0 ? "▲" : "▼"} ${Math.abs(p * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
  return <span className={`ds-delta ${good ? "up" : "down"}`}>{text}</span>;
}

export default function DirectorsSummaryPage() {
  const navigate = useNavigate();
  const { entries } = useJournalEntries();
  const { fiscalYearStart, cfGroups, cfAssign } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const storeKey = (what) => `klay.directorsSummary.${what}.${user?.id || "anon"}`;

  const [periodChoice, setPeriodChoice] = useState(() => loadLocal(storeKey("period"), DEFAULTS.period));
  const [compare, setCompare] = useState(DEFAULTS.compare);
  const [openPop, setOpenPop] = useState(null);
  const togglePop = (k) => setOpenPop((p) => (p === k ? null : k));
  const closePop = () => setOpenPop(null);
  const [toast, setToast] = useState("");
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };

  const presets = useMemo(() => periodPresets({ fiscalYearStart }), [fiscalYearStart]);
  const period = useMemo(() => {
    if (periodChoice.key === "custom") return { key: "custom", from: periodChoice.from, to: periodChoice.to, label: "Custom" };
    const p = presets.find((x) => x.key === periodChoice.key) || presets.find((x) => x.key === DEFAULTS.period.key);
    return { key: p.key, from: p.from, to: p.to, label: p.label };
  }, [periodChoice, presets]);
  useEffect(() => { saveLocal(storeKey("period"), period.key === "custom" ? { key: "custom", from: period.from, to: period.to } : { key: period.key }); }, [period.key, period.from, period.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const { from, to } = period;
  const prior = compare === "prev" ? previousPeriod(from, to) : { from: sameDayLastYear(from), to: sameDayLastYear(to) };
  const fyStart = fiscalYearStartFor(to, fiscalYearStart);

  // ── Numbers, all from the statements' own libs ───────────────────────────
  const data = useMemo(() => {
    const opts = { fiscalYearStart };
    const pl = computeProfitLoss(entries, { from, to });
    const plPrev = computeProfitLoss(entries, prior);
    const plYtd = computeProfitLoss(entries, { from: fyStart, to });
    const bs = computeBalanceSheet(entries, to, opts);
    const bsPrev = computeBalanceSheet(entries, prior.to, opts);
    const cf = computeCashFlow(entries, { from, to }, { groups: cfGroups, assign: cfAssign, fiscalYearStart });
    const cfPrev = computeCashFlow(entries, prior, { groups: cfGroups, assign: cfAssign, fiscalYearStart });
    const eq = computeChangesInEquity(entries, { from, to }, opts);
    return { pl, plPrev, plYtd, bs, bsPrev, cf, cfPrev, eq };
  }, [entries, from, to, prior.from, prior.to, fyStart, fiscalYearStart, cfGroups, cfAssign]); // eslint-disable-line react-hooks/exhaustive-deps
  const { pl, plPrev, plYtd, bs, bsPrev, cf, cfPrev, eq } = data;
  const ratios = bsRatios(bs.totals), ratiosPrev = bsRatios(bsPrev.totals);
  const ar = bs.byCode[DEFAULT_ACCOUNTS.ar] || 0, arPrev = bsPrev.byCode[DEFAULT_ACCOUNTS.ar] || 0;
  const ap = bs.byCode[DEFAULT_ACCOUNTS.ap] || 0, apPrev = bsPrev.byCode[DEFAULT_ACCOUNTS.ap] || 0;


  // ── Status ────────────────────────────────────────────────────────────────
  const isFinal = periodCloseState(from, to, closedThrough) === "closed";
  const unposted = unpostedInPeriod(entries, { from, to });
  const proofs = bs.balanced && cf.ties && eq.ties;

  // ── Highlights Klay drafts from the numbers ──────────────────────────────
  const highlights = useMemo(() => {
    const out = [];
    const rev = change(pl.totals.netRevenue, plPrev.totals.netRevenue);
    out.push({ tone: rev.diff >= 0 ? "good" : "warn", text: `Net revenue ${rp(pl.totals.netRevenue)}, ${rev.pct == null ? "new this period" : `${rev.diff >= 0 ? "up" : "down"} ${pct(Math.abs(rev.pct))} on ${rangeLabel(prior.from, prior.to)}`}.` });
    const np = pl.totals.netProfit;
    out.push({ tone: np >= 0 ? "good" : "warn", text: np >= 0 ? `Net profit ${rp(np)}${pl.margins.netMargin != null ? ` (${pct(pl.margins.netMargin)} of revenue)` : ""}.` : `Net loss ${rp(-np)}${pl.margins.netMargin != null ? ` (${pct(-pl.margins.netMargin)} of revenue)` : ""} — against ${plPrev.totals.netProfit >= 0 ? "a profit" : "a loss"} of ${rp(Math.abs(plPrev.totals.netProfit))} last period.` });
    // Largest cost movement.
    const costs = ["cogs", "selling", "ga"].map((k) => ({ k, label: { cogs: "Cost of goods sold", selling: "Selling expenses", ga: "General & administrative expenses" }[k], ...change(pl.totals[k], plPrev.totals[k]) }))
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    if (costs && Math.abs(costs.diff) >= 1) out.push({ tone: costs.diff > 0 ? "warn" : "good", text: `${costs.label} ${costs.diff > 0 ? "rose" : "fell"} ${rp(Math.abs(costs.diff))}${costs.pct != null ? ` (${pct(Math.abs(costs.pct))})` : ""} — the largest cost movement.` });
    out.push({ tone: cf.netChange >= 0 ? "good" : "warn", text: `Cash ${cf.netChange >= 0 ? "grew" : "fell"} ${rp(Math.abs(cf.netChange))} to ${rp(cf.cashEnd)}: operating ${rp(cf.sections.operating)}, investing ${rp(cf.sections.investing)}, financing ${rp(cf.sections.financing)}.` });
    const issue = eq.rows.find((r) => r.key === "issue"), div = eq.rows.find((r) => r.key === "dividends");
    if (issue) out.push({ tone: "", text: `Shareholders injected ${rp(issue.byComp.total)} of new capital.` });
    if (div) out.push({ tone: "", text: `Dividends of ${rp(-div.byComp.total)} were declared.` });
    if (bs.totals.totalEquity < 0) out.push({ tone: "warn", text: `Equity is negative (${rp(bs.totals.totalEquity)}) at ${dayLabel(to)}: liabilities exceed assets.` });
    if (ratios.currentRatio != null && ratios.currentRatio < 1) out.push({ tone: "warn", text: `Current ratio ${times(ratios.currentRatio)} — short-term liabilities exceed current assets.` });
    return out;
  }, [pl, plPrev, cf, eq, bs, ratios, prior.from, prior.to, to]);

  // ── Commentary (per period) ──────────────────────────────────────────────
  const noteKey = `klay.directorsSummary.note.${from}_${to}`;
  const [note, setNote] = useState(() => loadLocal(noteKey, { text: "", by: null, at: null }));
  useEffect(() => { setNote(loadLocal(noteKey, { text: "", by: null, at: null })); }, [noteKey]);
  const saveNote = (text) => { const n = { text, by: user?.name || "You", at: new Date().toISOString() }; setNote(n); saveLocal(noteKey, n); };
  const draft = () => { saveNote(highlights.map((h) => `• ${h.text}`).join("\n") + "\n\nManagement comment: "); showToast("Highlights copied in — add the management comment"); };

  // ── Export ────────────────────────────────────────────────────────────────
  const curLbl = rangeLabel(from, to), prevLbl = rangeLabel(prior.from, prior.to);
  const plRows = [
    { label: "Net revenue", key: "netRevenue", good: true },
    { label: "Cost of goods sold", key: "cogs", good: false },
    { label: "Gross profit/(loss)", key: "grossProfit", good: true, strong: true },
    { label: "Operating expenses", key: "opex", good: false },
    { label: "Operating profit/(loss)", key: "operatingProfit", good: true, strong: true },
    { label: "Net profit/(loss)", key: "netProfit", good: true, strong: true },
  ];
  const bsRows = [
    { label: "Current assets", v: (b) => b.totals.currentAssets },
    { label: "Non-current assets", v: (b) => b.totals.nonCurrentAssets },
    { label: "Total assets", v: (b) => b.totals.totalAssets, strong: true },
    { label: "Total liabilities", v: (b) => b.totals.totalLiabilities },
    { label: "Total equity", v: (b) => b.totals.totalEquity, strong: true },
  ];
  const cfRows = [
    { label: "Cash at start", v: (c) => c.cashStart },
    { label: "Operating activities", v: (c) => c.sections.operating },
    { label: "Investing activities", v: (c) => c.sections.investing },
    { label: "Financing activities", v: (c) => c.sections.financing },
    { label: "Cash at end", v: (c) => c.cashEnd, strong: true },
  ];
  function exportXlsx() {
    closePop();
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }], [{ v: "Ringkasan Direksi — Director's Summary", s: "title" }], [forPeriod(from, to, "en")], [],
      [{ v: "Profit & Loss", s: "head" }, { v: curLbl, s: "headNum" }, { v: prevLbl, s: "headNum" }, { v: "Change %", s: "headNum" }, { v: "Year to date", s: "headNum" }],
      ...plRows.map((r) => [r.label, { v: pl.totals[r.key], s: "num" }, { v: plPrev.totals[r.key], s: "num" }, { v: change(pl.totals[r.key], plPrev.totals[r.key]).pct, s: "pct" }, { v: plYtd.totals[r.key], s: "num" }]),
      [],
      [{ v: "Balance Sheet", s: "head" }, { v: dayLabel(to), s: "headNum" }, { v: dayLabel(prior.to), s: "headNum" }],
      ...bsRows.map((r) => [r.label, { v: r.v(bs), s: "num" }, { v: r.v(bsPrev), s: "num" }]),
      ["Current ratio", { v: ratios.currentRatio, s: "num" }, { v: ratiosPrev.currentRatio, s: "num" }],
      [],
      [{ v: "Cash Flow", s: "head" }, { v: curLbl, s: "headNum" }, { v: prevLbl, s: "headNum" }],
      ...cfRows.map((r) => [r.label, { v: r.v(cf), s: "num" }, { v: r.v(cfPrev), s: "num" }]),
      [], [{ v: "Commentary", s: "head" }], ...(note.text || "").split("\n").map((l) => [l]),
    ];
    downloadXlsx(`directors-summary_${from}_${to}.xlsx`, { sheet: "Director's Summary", rows, widths: [40, 20, 20, 12, 20] });
    showToast("Director's Summary exported to Excel");
  }
  const exportPrint = () => { closePop(); setTimeout(printReport, 50); };

  const Tile = ({ label, sub, value, prevValue, goodUp = true, kind, to: href, state, loss, fmt = rpShort }) => (
    <Link className="ds-tile" to={href} state={state}>
      <span className="ds-tile-lbl">{label}{sub && <em>{sub}</em>}</span>
      <span className={`ds-tile-val${loss ? " loss" : ""}`}>{fmt(value)}</span>
      <span className="ds-tile-sub"><Delta cur={value} prev={prevValue} goodUp={goodUp} kind={kind} /> <span>vs {fmt(prevValue)}</span></span>
    </Link>
  );
  const plState = { period: { from, to } };
  const compareItems = [
    { k: "prev", lbl: "Previous period", hint: rangeLabel(previousPeriod(from, to).from, previousPeriod(from, to).to) },
    { k: "prev_year", lbl: "Same period last year", hint: rangeLabel(sameDayLastYear(from), sameDayLastYear(to)) },
  ];
  const cellCls = (v, profit) => (profit && v < -0.005 ? "loss" : undefined);

  return (
    <div className="lg-page tb-report pl-page ds-page">
      <div className="lg-scroll-container">
        <PrintHead title="Ringkasan Direksi — Director's Summary" lines={[forPeriod(from, to, "id"), `Dibandingkan dengan ${prevLbl} · ${isFinal ? "Final" : "Sementara"}`]} />
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Director&apos;s Summary</h1>
              <p className="st-sub">Ringkasan Direksi — the period on one page, for the board.</p>
            </div>
            <div className="lg-head-actions no-print">
              <div className="lg-meta-btn-wrap">
                <button className="lg-btn-brand" onClick={() => togglePop("export")} aria-haspopup="menu" aria-expanded={openPop === "export"}>{DOWNLOAD} Export</button>
                {openPop === "export" && <ExportPopover onXlsx={exportXlsx} onPrint={exportPrint} onClose={closePop} />}
              </div>
            </div>
          </div>
          <div className="tb-status no-print">
            <span className={`tb-status-chip ${isFinal ? "closed" : "open"}`}>{isFinal ? "Final" : "Preliminary"}</span>
            <span>{isFinal ? `Books are closed through ${monthLabel(`${closedThrough}-01`)}.` : "This period is open — close it before sending this to the directors."}</span>
            {unposted.length > 0 && (<><span className="tb-status-sep">·</span><button className="tb-status-link" onClick={() => navigate("/journal-entry")}>{plural(unposted.length, "draft or pending journal")} not included</button></>)}
            <span className="tb-status-sep">·</span>
            <span className={`tb-foot ${proofs ? "ok" : "off"}`} title="Balance Sheet balances, Cash Flow ties to cash, Changes in Equity ties to the Balance Sheet.">
              <span aria-hidden="true">{proofs ? "✓" : "✕"}</span> {proofs ? "Statements agree" : "A statement doesn't tie — open it before sharing"}
            </span>
          </div>
          <div className="lg-filter-row no-print tb-filter-row pl-toolbar" style={{ border: "none", padding: "10px 0 0" }}>
            <div className="tb-toolbar-left">
              <div className="lg-meta-btn-wrap">
                <button className="lg-meta-btn tb-period-btn" onClick={() => togglePop("period")}>{CAL}<span className="meta-lbl">Period</span><span className="meta-val">{curLbl}</span>{period.key !== "custom" && <span className="meta-lbl">· {period.label}</span>}</button>
                {openPop === "period" && <PeriodPopover presets={presets} period={period} onPick={(c) => { setPeriodChoice(c); closePop(); }} onClose={closePop} />}
              </div>
              <div className="lg-meta-btn-wrap">
                <button className="lg-meta-btn active" onClick={() => togglePop("compare")}><span className="meta-lbl">Compare:</span><span className="meta-val">{COMPARE_LABELS[compare]}</span></button>
                {openPop === "compare" && <ChoicePopover className="tb-compare-pop" items={compareItems} value={compare} onPick={(k) => { setCompare(k); closePop(); }} onClose={closePop} />}
              </div>
            </div>
          </div>
        </div>

        <div className="ds-wrap">
          {/* Four tiles (benchmark §6): what a director asks first — did we
              sell, did we make money, how much cash, what is the company worth. */}
          <div className="ds-tiles">
            <Tile label="Net revenue" value={pl.totals.netRevenue} prevValue={plPrev.totals.netRevenue} to="/reports/profit-loss" state={plState} />
            <Tile label="Net profit/(loss)" sub={pl.margins.netMargin != null ? `${pct(pl.margins.netMargin)} margin` : null} value={pl.totals.netProfit} prevValue={plPrev.totals.netProfit} to="/reports/profit-loss" state={plState} loss={pl.totals.netProfit < 0} />
            <Tile label="Cash and cash equivalents" sub={`at ${dayLabel(to)}`} value={cf.cashEnd} prevValue={cfPrev.cashEnd} to="/reports/cash-flow" state={plState} />
            <Tile label="Total equity" sub={`at ${dayLabel(to)}`} value={bs.totals.totalEquity} prevValue={bsPrev.totals.totalEquity} to="/reports/changes-in-equity" state={plState} loss={bs.totals.totalEquity < 0} />
          </div>

          {/* Commentary straight under the tiles: the directors read the story
              before the tables. Highlights are rule-based, not AI (MVP). */}
          <section className="ds-card ds-commentary" style={{ marginTop: 0, marginBottom: 14 }}>
            <div className="ds-card-head"><span className="ds-card-title">Highlights and commentary</span><span className="ds-note-hint" style={{ padding: 0 }}>Highlights by Klay from the numbers · commentary by Finance</span></div>
            <ul className="ds-highlights">
              {highlights.map((h) => <li key={h.text} className={h.tone}>{h.text}</li>)}
            </ul>
            <textarea className="ds-note no-print" value={note.text} placeholder="Management commentary: why things moved, what the team is doing about it, what the board should decide…" onChange={(e) => saveNote(e.target.value)} aria-label="Commentary for the directors" />
            <div className="ds-note-print">{note.text || ""}</div>
            <div className="ds-note-actions no-print">
              <button type="button" className="lg-btn-ghost" onClick={draft}>{note.text ? "Replace with the highlights" : "Start from the highlights"}</button>
              {note.at && <span className="ds-note-meta">Last edited by {note.by} · {new Date(note.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
          </section>

          <div className="ds-grid">
            <section className="ds-card">
              <div className="ds-card-head"><span className="ds-card-title">Performance</span><Link className="ds-card-link no-print" to="/reports/profit-loss" state={plState}>Profit &amp; Loss {ARROW}</Link></div>
              <table className="ds-table">
                <thead><tr><th>Rp</th><th>{curLbl}</th><th>{prevLbl}</th><th>Change</th><th>Year to date</th></tr></thead>
                <tbody>
                  {plRows.map((r) => {
                    const c = change(pl.totals[r.key], plPrev.totals[r.key]);
                    return (
                      <tr key={r.key} className={r.strong ? "strong" : undefined}>
                        <td>{r.label}</td>
                        <td className={cellCls(pl.totals[r.key], r.strong)}>{num(pl.totals[r.key], 1e6)}</td>
                        <td className={cellCls(plPrev.totals[r.key], r.strong)}>{num(plPrev.totals[r.key], 1e6)}</td>
                        <td><Delta cur={pl.totals[r.key]} prev={plPrev.totals[r.key]} goodUp={r.good} />{c.pct == null && Math.abs(c.diff) < 0.5 ? "" : ""}</td>
                        <td className={cellCls(plYtd.totals[r.key], r.strong)}>{num(plYtd.totals[r.key], 1e6)}</td>
                      </tr>
                    );
                  })}
                  <tr className="muted"><td>Gross margin</td><td>{pct(pl.margins.grossMargin)}</td><td>{pct(plPrev.margins.grossMargin)}</td><td /><td>{pct(plYtd.margins.grossMargin)}</td></tr>
                  <tr className="muted"><td>Net margin</td><td>{pct(pl.margins.netMargin)}</td><td>{pct(plPrev.margins.netMargin)}</td><td /><td>{pct(plYtd.margins.netMargin)}</td></tr>
                </tbody>
              </table>
            </section>

            <section className="ds-card">
              <div className="ds-card-head"><span className="ds-card-title">Financial position</span><Link className="ds-card-link no-print" to="/reports/balance-sheet" state={{ period: { to } }}>Balance Sheet {ARROW}</Link></div>
              <table className="ds-table">
                <thead><tr><th>Rp m</th><th>{dayLabel(to)}</th><th>{dayLabel(prior.to)}</th><th>Change</th></tr></thead>
                <tbody>
                  {bsRows.map((r) => (
                    <tr key={r.label} className={r.strong ? "strong" : undefined}>
                      <td>{r.label}</td><td className={cellCls(r.v(bs), r.strong)}>{num(r.v(bs), 1e6)}</td><td className={cellCls(r.v(bsPrev), r.strong)}>{num(r.v(bsPrev), 1e6)}</td>
                      <td><Delta cur={r.v(bs)} prev={r.v(bsPrev)} goodUp={!/liabilities/i.test(r.label)} /></td>
                    </tr>
                  ))}
                  <tr><td>Trade receivables</td><td>{num(ar, 1e6)}</td><td>{num(arPrev, 1e6)}</td><td><Delta cur={ar} prev={arPrev} goodUp={false} /></td></tr>
                  <tr><td>Trade payables</td><td>{num(ap, 1e6)}</td><td>{num(apPrev, 1e6)}</td><td><Delta cur={ap} prev={apPrev} goodUp={false} /></td></tr>
                  <tr><td>Working capital</td><td className={cellCls(bs.totals.workingCapital, true)}>{num(bs.totals.workingCapital, 1e6)}</td><td className={cellCls(bsPrev.totals.workingCapital, true)}>{num(bsPrev.totals.workingCapital, 1e6)}</td><td><Delta cur={bs.totals.workingCapital} prev={bsPrev.totals.workingCapital} /></td></tr>
                  <tr className="muted"><td>Current ratio</td><td>{times(ratios.currentRatio)}</td><td>{times(ratiosPrev.currentRatio)}</td><td /></tr>
                  <tr className="muted"><td>Debt to equity</td><td>{times(ratios.debtToEquity)}</td><td>{times(ratiosPrev.debtToEquity)}</td><td /></tr>
                </tbody>
              </table>
            </section>

            <section className="ds-card">
              <div className="ds-card-head"><span className="ds-card-title">Cash</span><Link className="ds-card-link no-print" to="/reports/cash-flow" state={plState}>Cash Flow {ARROW}</Link></div>
              <table className="ds-table">
                <thead><tr><th>Rp m</th><th>{curLbl}</th><th>{prevLbl}</th></tr></thead>
                <tbody>
                  {cfRows.map((r) => (
                    <tr key={r.label} className={r.strong ? "strong" : undefined}>
                      <td>{r.label}</td><td className={cellCls(r.v(cf), true)}>{num(r.v(cf), 1e6)}</td><td className={cellCls(r.v(cfPrev), true)}>{num(r.v(cfPrev), 1e6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="ds-card">
              <div className="ds-card-head"><span className="ds-card-title">Equity</span><Link className="ds-card-link no-print" to="/reports/changes-in-equity" state={plState}>Changes in Equity {ARROW}</Link></div>
              <table className="ds-table">
                <thead><tr><th>Rp m</th><th>{curLbl}</th></tr></thead>
                <tbody>
                  <tr><td>Equity at {dayLabel(dayBefore(from))}</td><td className={cellCls(eq.opening.byComp.total, true)}>{num(eq.opening.byComp.total, 1e6)}</td></tr>
                  {eq.rows.map((r) => <tr key={r.key}><td>{r.label}</td><td className={cellCls(r.byComp.total, true)}>{num(r.byComp.total, 1e6)}</td></tr>)}
                  <tr className="strong"><td>Equity at {dayLabel(to)}</td><td className={cellCls(eq.closing.byComp.total, true)}>{num(eq.closing.byComp.total, 1e6)}</td></tr>
                </tbody>
              </table>
            </section>
          </div>

          <SignOff lang="id" preparedBy={user?.name} roles={["Disiapkan oleh (Finance)", "Disetujui oleh (Direktur Keuangan)", "Diketahui oleh (Direktur Utama)"]} />
          <p className="pl-foot no-print" style={{ marginTop: 10 }}>Every figure is the same number its statement shows for these dates; click a tile or card to open it. Amounts in the cards are in millions of Rupiah.</p>
        </div>
      </div>
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
