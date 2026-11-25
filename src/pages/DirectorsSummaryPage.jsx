// Reports → Director's Summary (Ringkasan Direksi; the CEO calls it the
// Executive Summary).
//
// Simplified 25 Nov 2026 (user): no breakdown tables, no rule-based
// highlights (they repeated the boxes), bigger boxes, and AR / AP aging —
// because what the CEO always asks is:
//   · how much cash do I have now        → Cash now
//   · how much is still owed             → Customers owe us · We owe vendors
//   · how much cash will I have          → Cash in 30 days
// then how the period went (revenue, profit, equity), then who owes what by
// age. The Finance commentary stays, as the one place for the story.
//
// Nothing is computed on its own: cash and performance come from the
// statements' libs (cashFlow, profitLoss, balanceSheet), aging from the same
// libs as Reports → Cashflow Report (apAging, arAging), so every number is the
// number its report shows; each box opens its drill-down (lib/directorsDrill).
//
// Worth a look (26 Nov 2026): the system can't say why a number moved, but
// it lists what might explain it — new and changed customers and vendors,
// large documents, manual journals that move profit without cash, cash
// outside operations, cash below the minimum (lib/anomalies.js). Finance can
// mark one as known with a note; that goes to the shared Review log, and the
// item comes back if its amount changes.

const PL_CODES = new Set(COA.filter((a) => a.code && a.fs === "PL").map((a) => a.code));

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COA, COA_BY_CODE } from "../data/seed/coa";
import SummaryDrill from "../components/SummaryDrill";
import { resolveDrill, AGE_LABEL } from "../lib/directorsDrill";
import { detectAnomalies, BOX_LABEL } from "../lib/anomalies";
import { useVarianceReviews, reviewKey } from "../state/VarianceReviewsContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useBills } from "../state/BillsContext";
import { useInvoices } from "../state/InvoicesContext";
import { usePayments } from "../state/PaymentsContext";
import { computeProfitLoss, change, unpostedInPeriod } from "../lib/profitLoss";
import { computeBalanceSheet } from "../lib/balanceSheet";
import { computeCashFlow } from "../lib/cashFlow";
import { computeChangesInEquity } from "../lib/changesInEquity";
import { buildAgingLines, buildSnapshot, buildVendorPivot, isAgingTableRow, AGE_BUCKETS } from "../lib/apAging";
import { buildArAgingLines, buildArSnapshot, buildCustomerPivot } from "../lib/arAging";
import { periodCloseState } from "../lib/trialBalance";
import { periodPresets, rangeLabel, dayLabel, dayBefore, previousPeriod, sameDayLastYear, monthLabel, todayIso } from "../lib/reportPeriods";
import { ChoicePopover, PeriodPopover, loadLocal, saveLocal } from "../components/ReportControls";
import { rp, rpShort, pct, plural, forPeriod, CAL, ARROW, PrintHead, SignOff } from "../components/StatementKit";
import "./modules.css";
import "./invoices-ledger.css";
import "./trial-balance.css";
import "./profit-loss.css";
import "./statements.css";

const COMPARE_LABELS = { prev: "Previous period", prev_year: "Same period last year" };
const DEFAULTS = { period: { key: "last_month" }, compare: "prev" };
// Same colours as the Cashflow Report's aging bars.
const AGE_COLOR = { current: "#2E7D44", b1_30: "#C99A2E", b31_60: "#B8770F", b61_90: "#A8620C", b91_120: "#A32D2D", b_gt120: "#8C2420" };

// A change with its direction judged: "good" when it moves the way a
// director wants (revenue up, costs down…).
function Delta({ cur, prev, goodUp = true }) {
  if (cur == null || prev == null) return null;
  const { diff, pct: p } = change(cur, prev);
  if (Math.abs(diff) < 0.5) return <span className="ds-delta flat">no change</span>;
  const good = goodUp ? diff > 0 : diff < 0;
  const text = p == null ? `${diff > 0 ? "+" : "−"}${rpShort(Math.abs(diff))}` : `${diff > 0 ? "▲" : "▼"} ${Math.abs(p * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
  return <span className={`ds-delta ${good ? "up" : "down"}`}>{text}</span>;
}

// Overdue plus due within 30 days of the date — what is realistically coming
// in / going out next (the Cashflow Report's "Cash in 30 days" rule).
const dueWithin30 = (lines) => lines.reduce((s, l) => s + (l.daysOverdue >= -30 ? l.remaining : 0), 0);

// AP and AR as of one date, scoped like the Cashflow Report: AP = posted
// bills (accruals reported apart), AR = every open invoice.
// `lines` are the open documents behind each total — the drill-down lists them.
function agingAsOf(asOf, { bills, invoices, paymentHistory }) {
  const apAll = buildAgingLines(asOf, bills, { paymentHistory });
  const apSnap = buildSnapshot(apAll, asOf);
  const apLines = apAll.filter((l) => isAgingTableRow(l) && !l.is_accrual && l.workflow_status === "POSTED" && l.remaining > 0);
  const arLines = buildArAgingLines(asOf, invoices).filter((l) => l.remaining > 0);
  const arSnap = buildArSnapshot(arLines, asOf);
  const top = (rows) => rows.filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 3);
  return {
    ap: {
      lines: apLines,
      total: apSnap.apOutstanding, buckets: apSnap.bucketTotals, accrued: apSnap.accruedLiabilities,
      overdue: apSnap.apOutstanding - apSnap.bucketTotals.current, due30: dueWithin30(apLines),
      top: top(buildVendorPivot(apLines).map((r) => ({ id: r.vendorId, name: r.vendorName, overdue: r.total - r.buckets.current }))),
    },
    ar: {
      lines: arLines,
      total: arSnap.arOutstanding, buckets: arSnap.bucketTotals,
      overdue: arSnap.overdue, due30: dueWithin30(arLines),
      top: top(buildCustomerPivot(arLines).map((r) => ({ id: r.customerId, name: r.customerName, overdue: r.total - r.buckets.current }))),
    },
  };
}

export default function DirectorsSummaryPage() {
  const navigate = useNavigate();
  const { entries } = useJournalEntries();
  const { fiscalYearStart, cfGroups, cfAssign, varianceThreshold, anomalyThresholds } = useAccountingSettings();
  const { reviews, markReviewed, reopen } = useVarianceReviews();
  const { user, hasCapability } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { bills } = useBills();
  const { invoices } = useInvoices();
  const { payments } = usePayments();
  const storeKey = (what) => `klay.directorsSummary.${what}.${user?.id || "anon"}`;

  const [periodChoice, setPeriodChoice] = useState(() => loadLocal(storeKey("period"), DEFAULTS.period));
  // Opened from the Review log with a period: show that period.
  const location = useLocation();
  useEffect(() => {
    const p = location.state?.period;
    if (!p) return;
    setPeriodChoice({ key: "custom", from: p.from, to: p.to });
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // "Now" is the end of the period, or today while the period is still running.
  const today = todayIso();
  const asOf = to > today ? today : to;

  // Payments recorded this session count — the same map the Cashflow Report reads.
  const paymentHistory = useMemo(() => {
    const out = {};
    for (const [billId, p] of Object.entries(payments || {})) if (p?.history?.length) out[billId] = p.history;
    return Object.keys(out).length ? out : null;
  }, [payments]);

  // ── Numbers, all from the reports' own libs ──────────────────────────────
  const data = useMemo(() => {
    const opts = { fiscalYearStart };
    const cfOpts = { groups: cfGroups, assign: cfAssign, fiscalYearStart };
    return {
      pl: computeProfitLoss(entries, { from, to }),
      plPrev: computeProfitLoss(entries, prior),
      bs: computeBalanceSheet(entries, to, opts),
      bsPrev: computeBalanceSheet(entries, prior.to, opts),
      cf: computeCashFlow(entries, { from, to }, cfOpts),
      cfPrev: computeCashFlow(entries, prior, cfOpts),
      eq: computeChangesInEquity(entries, { from, to }, opts),
    };
  }, [entries, from, to, prior.from, prior.to, fiscalYearStart, cfGroups, cfAssign]); // eslint-disable-line react-hooks/exhaustive-deps
  const { pl, plPrev, bs, bsPrev, cf, cfPrev, eq } = data;
  const aging = useMemo(() => agingAsOf(asOf, { bills, invoices, paymentHistory }), [asOf, bills, invoices, paymentHistory]);
  const { ar, ap } = aging;
  const cashNow = cf.cashEnd;
  const cash30 = cashNow + ar.due30 - ap.due30;

  // ── Worth a look ──────────────────────────────────────────────────────────
  const anomalies = useMemo(() => detectAnomalies({
    from, to, invoices, bills, entries, cf, cash30, plCodes: PL_CODES, cashCodes: new Set(cf.cashCodes),
    t: { pct: varianceThreshold.pct, floor: varianceThreshold.amount, large: anomalyThresholds.large, minCash: anomalyThresholds.minCash },
  }), [from, to, invoices, bills, entries, cf, cash30, varianceThreshold, anomalyThresholds]);
  // Marked as known for this period, at this amount — a different amount
  // brings it back, like a variance review.
  const knownKey = (a) => reviewKey(`ds:${a.id}`, from, to);
  const knownOf = (a) => {
    const rv = reviews[knownKey(a)];
    return rv && !rv.reopened && Math.round(rv.amount) === Math.round(a.impact) ? rv : null;
  };
  const openAnoms = anomalies.list.filter((a) => !knownOf(a));
  const knownAnoms = anomalies.list.filter((a) => knownOf(a));
  // Directors see anomalies on the box they might explain (user, 26 Nov):
  // its biggest one on the box, all of them at the top of its panel. What
  // Finance marked as known isn't shown.
  const anomsFor = (box) => openAnoms.filter((a) => a.box === box);
  const BOX_OF = { cash: "cash", ar: "ar", ap: "ap", outlook: "outlook", equity: "equity" };
  const boxOfView = (v) => (v.t === "pl" ? (v.src === "revenue" ? "revenue" : "profit") : BOX_OF[v.t] && !v.bucket ? BOX_OF[v.t] : null);
  // Finance reviews the full list before sending: anyone who can post journals.
  const canReview = hasCapability("gl.post");
  const [reviewing, setReviewing] = useState(false);
  const [showKnown, setShowKnown] = useState(false);
  const [noting, setNoting] = useState(null); // anomaly id being marked as known
  const [noteText, setNoteText] = useState("");
  useEffect(() => { setNoting(null); }, [from, to]);
  useEffect(() => {
    if (!reviewing) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setReviewing(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reviewing]);
  const markKnown = (a) => {
    markReviewed(knownKey(a), { note: noteText.trim(), by: user?.name || "You", amount: a.impact, prev: null, report: "ds", title: `${a.label}: ${a.title}` });
    setNoting(null); setNoteText("");
    showToast("Marked as known — it's in the Review log");
  };

  // ── Drill-down (side panel, read only) ───────────────────────────────────
  // A stack of views: the box clicked first, then each level down. Changing
  // the period or the comparison closes it — the numbers under it changed.
  const [drill, setDrill] = useState(null);
  useEffect(() => { setDrill(null); }, [from, to, compare]);
  const bsOpen = useMemo(() => computeBalanceSheet(entries, dayBefore(from), { fiscalYearStart }), [entries, from, fiscalYearStart]);
  const drillCtx = {
    entries, from, to, asOf, dayBeforeFrom: dayBefore(from), aging, pl, bs, bsOpen, cf, eq, cashNow, cash30, invoices, bills,
    accountName: (code) => COA_BY_CODE[code]?.name || code,
  };
  const openDrill = (view) => { setReviewing(false); setDrill([view]); };
  // A box's panel opens with its Worth a look block above the breakdown.
  // The top few in the box panel; the rest one click further, so the
  // breakdown underneath stays in view.
  const ANOM_PREVIEW = 5;
  const anomRow = (a) => ({ key: a.id, label: a.title, meta: `${a.label} · ${a.detail}`, values: [a.impact], tone: a.impact < 0 ? "late" : null, open: a.view });
  const withAnoms = (spec, view) => {
    const box = boxOfView(view);
    const list = box ? anomsFor(box) : [];
    if (!list.length) return spec;
    const rows = list.slice(0, ANOM_PREVIEW).map(anomRow);
    if (list.length > ANOM_PREVIEW) rows.push({ key: "more", label: `See all ${list.length}`, meta: "Biggest first", values: [null], open: { t: "anoms", box } });
    return { ...spec, blocks: [{ head: `Worth a look · ${list.length}`, cols: ["Effect"], rows }, ...spec.blocks] };
  };
  // The full list for one box — a level of its own in the panel.
  const resolveView = (v) => (v.t === "anoms"
    ? { crumb: "Worth a look", title: `Worth a look · ${BOX_LABEL[v.box]}`, sub: "What might explain this number — not reasons. Biggest first.", blocks: [{ cols: ["Effect"], rows: anomsFor(v.box).map(anomRow) }] }
    : resolveDrill(v, drillCtx));
  const drillSpecs = drill ? drill.map((v, i) => (i === 0 ? withAnoms(resolveView(v), v) : resolveView(v))) : null;
  const pushDrill = useCallback((view) => setDrill((s) => [...s, view]), []);
  const backDrill = useCallback(() => setDrill((s) => (s && s.length > 1 ? s.slice(0, -1) : null)), []);
  const closeDrill = useCallback(() => setDrill(null), []);
  // The bucket chips swap the top view's filter in place.
  const chipDrill = (bucket) => setDrill((s) => [...s.slice(0, -1), { ...s[s.length - 1], bucket }]);
  const isOn = (t) => drill && drill[0].t === t;

  // ── Status ────────────────────────────────────────────────────────────────
  const isFinal = periodCloseState(from, to, closedThrough) === "closed";
  const unposted = unpostedInPeriod(entries, { from, to });
  const proofs = bs.balanced && cf.ties && eq.ties;

  // ── Commentary (per period) ──────────────────────────────────────────────
  const noteKey = `klay.directorsSummary.note.${from}_${to}`;
  const [note, setNote] = useState(() => loadLocal(noteKey, { text: "", by: null, at: null }));
  useEffect(() => { setNote(loadLocal(noteKey, { text: "", by: null, at: null })); }, [noteKey]);
  const saveNote = (text) => { const n = { text, by: user?.name || "You", at: new Date().toISOString() }; setNote(n); saveLocal(noteKey, n); };

  // No Export (user, 26 Nov): directors read it on screen. The browser's own
  // print still gets the print header and sign-off.
  const curLbl = rangeLabel(from, to), prevLbl = rangeLabel(prior.from, prior.to);

  // A box opens its drill-down; the report it comes from is one click further,
  // at the foot of the panel.
  const Tile = ({ label, sub, value, children, view, loss, hero }) => {
    const list = anomsFor(boxOfView(view));
    return (
      <button type="button" className={`ds-tile${hero ? " hero" : ""}${isOn(view.t) && !drill[0].bucket && drill[0].src === view.src ? " on" : ""}`}
        onClick={() => openDrill(view)} aria-haspopup="dialog">
        <span className="ds-tile-lbl">{label}{sub && <em>{sub}</em>}</span>
        <span className={`ds-tile-val${loss ? " loss" : ""}`}>{value}</span>
        <span className="ds-tile-sub">{children}</span>
        {list.length > 0 && (
          <span className="ds-tile-anom" title={`${list[0].label}: ${list[0].detail}`}>
            <span className="ds-tile-anom-txt">{list[0].title}</span>
            {list.length > 1 && <em>+{list.length - 1} more</em>}
          </span>
        )}
      </button>
    );
  };
  const signedShort = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${rpShort(Math.abs(v))}`;
  const AnomalyRow = ({ a, known }) => (
    <article className={`ds-anom${known ? " known" : ""}`}>
      <button type="button" className="ds-anom-main" onClick={() => openDrill(a.view)} aria-haspopup="dialog" title="Show what's behind it">
        <span className="ds-anom-tag">{a.label}</span>
        <span className="ds-anom-title">{a.title}</span>
        <span className="ds-anom-detail">{a.detail} · might explain <b>{BOX_LABEL[a.box]}</b></span>
        {known && <span className="ds-anom-known-note">Known — {known.note} <em>· {known.by}</em></span>}
      </button>
      <span className={`ds-anom-amt ${a.impact >= 0 ? "up" : "down"}`} title="Effect on cash or profit">{signedShort(a.impact)}</span>
      <span className="ds-anom-acts no-print">
        {known
          ? <button type="button" className="ds-anom-btn" onClick={() => reopen(knownKey(a), user?.name || "You", "ds")}>Bring back</button>
          : <button type="button" className="ds-anom-btn" onClick={() => { setNoting(a.id); setNoteText(""); }}>Mark as known</button>}
      </span>
      {noting === a.id && (
        <form className="ds-anom-note no-print" onSubmit={(e) => { e.preventDefault(); if (noteText.trim()) markKnown(a); }}>
          <input autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Why it's known, e.g. one-off machine purchase approved by the board" aria-label="Note" />
          <button type="submit" className="lg-btn-brand" disabled={!noteText.trim()}>Save</button>
          <button type="button" className="lg-btn-ghost" onClick={() => setNoting(null)}>Cancel</button>
        </form>
      )}
    </article>
  );
  const Vs = ({ cur, prev, goodUp = true }) => <><Delta cur={cur} prev={prev} goodUp={goodUp} /> <span>vs {rpShort(prev)}</span></>;
  const compareItems = [
    { k: "prev", lbl: "Previous period", hint: rangeLabel(previousPeriod(from, to).from, previousPeriod(from, to).to) },
    { k: "prev_year", lbl: "Same period last year", hint: rangeLabel(sameDayLastYear(from), sameDayLastYear(to)) },
  ];

  // The total, each age bucket and each of the largest overdue open the
  // drill-down at that level.
  const AgingCard = ({ title, side, d, href, note: foot }) => (
    <section className={`ds-card${drill && (drill[0].t === side || drill[0].side === side) ? " on" : ""}`}>
      <div className="ds-card-head">
        <span className="ds-card-title">{title}</span>
        <Link className="ds-card-link no-print" to={href}>{side.toUpperCase()} Aging {ARROW}</Link>
      </div>
      <button type="button" className="ds-aging-total ds-click" onClick={() => openDrill({ t: side })} title="Show who owes what">
        <b>{rp(d.total)}</b>
        <span>{d.overdue > 0.5 ? <><span className="warn">{rpShort(d.overdue)} overdue</span> · {pct(d.total ? d.overdue / d.total : 0)} of the total</> : "nothing overdue"}</span>
      </button>
      <div className="ds-bar" aria-hidden="true">
        {AGE_BUCKETS.map((b) => <span key={b.key} style={{ flexGrow: d.buckets[b.key] || 0, background: AGE_COLOR[b.key] }} title={`${AGE_LABEL[b.key]}: ${rp(d.buckets[b.key])}`} />)}
      </div>
      <div className="ds-legend">
        {AGE_BUCKETS.map((b) => (
          <button type="button" key={b.key} className="ds-click" disabled={!(d.buckets[b.key] > 0.5)} onClick={() => openDrill({ t: side, bucket: b.key })} title={`Show what is ${AGE_LABEL[b.key].toLowerCase()}`}>
            <span><i style={{ background: AGE_COLOR[b.key] }} />{AGE_LABEL[b.key]}</span>
            <b>{rpShort(d.buckets[b.key])}</b>
          </button>
        ))}
      </div>
      <div className="ds-top">
        <div className="ds-top-lbl">Largest overdue</div>
        {d.top.length === 0 ? <div className="ds-top-none">None overdue.</div> : d.top.map((r) => (
          <button type="button" key={r.id} className="ds-top-row ds-click" onClick={() => setDrill([{ t: side }, { t: "party", side, id: r.id }])}>
            <span>{r.name}</span><span>{rp(r.overdue)}</span>
          </button>
        ))}
        {foot && <div className="ds-top-none" style={{ marginTop: 6 }}>{foot}</div>}
      </div>
    </section>
  );

  return (
    <div className={`lg-page tb-report pl-page ds-page${drill || reviewing ? " txp-is-open" : ""}`}>
      <div className="lg-scroll-container">
        <PrintHead title="Ringkasan Direksi — Director's Summary" lines={[forPeriod(from, to, "id"), `Dibandingkan dengan ${prevLbl} · ${isFinal ? "Final" : "Sementara"}`]} />
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Director&apos;s Summary</h1>
            </div>
          </div>
          <div className="tb-status no-print">
            <span>{isFinal ? `Books are closed through ${monthLabel(`${closedThrough}-01`)}.` : "This period is open — close it before sending this to the directors."}</span>
            {unposted.length > 0 && (<><span className="tb-status-sep">·</span><button className="tb-status-link" onClick={() => navigate("/journal-entry")}>{plural(unposted.length, "draft or pending journal")} not included</button></>)}
            <span className="tb-status-sep">·</span>
            <span className={`tb-foot ${proofs ? "ok" : "off"}`} title="Balance Sheet balances, Cash Flow ties to cash, Changes in Equity ties to the Balance Sheet.">
              <span aria-hidden="true">{proofs ? "✓" : "✕"}</span> {proofs ? "Statements agree" : "A statement doesn't tie — open it before sharing"}
            </span>
            {canReview && (
              <><span className="tb-status-sep">·</span>
                <button className="tb-status-link" onClick={() => { setDrill(null); setReviewing(true); }}>
                  {openAnoms.length ? `${plural(openAnoms.length, "thing")} worth a look — review before sending` : "Nothing worth a look"}
                </button></>
            )}
          </div>
          <div className="lg-filter-row no-print tb-filter-row pl-toolbar" style={{ border: "none", padding: "10px 0 14px" }}>
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
          <div className="ds-sec-lbl">Cash · at {dayLabel(asOf)}</div>
          <div className="ds-tiles">
            <Tile hero label="Cash now" sub="cash and cash equivalents" value={rpShort(cashNow)} view={{ t: "cash" }}>
              <Vs cur={cashNow} prev={cfPrev.cashEnd} />
            </Tile>
            <Tile label="Customers owe us" sub="receivables" value={rpShort(ar.total)} view={{ t: "ar" }}>
              {ar.overdue > 0.5 ? <span className="warn">{rpShort(ar.overdue)} overdue</span> : <span>nothing overdue</span>}
              <span>· <b>{rpShort(ar.due30)}</b> due in 30 days</span>
            </Tile>
            <Tile label="We owe vendors" sub="payables" value={rpShort(ap.total)}  view={{ t: "ap" }}>
              {ap.overdue > 0.5 ? <span className="warn">{rpShort(ap.overdue)} overdue</span> : <span>nothing overdue</span>}
              <span>· <b>{rpShort(ap.due30)}</b> due in 30 days</span>
            </Tile>
            <Tile hero label="Cash in 30 days" sub="expected" value={`${cash30 < 0 ? "−" : ""}${rpShort(Math.abs(cash30))}`} loss={cash30 < 0}  view={{ t: "outlook" }}>
              <span>Cash now + {rpShort(ar.due30)} in − {rpShort(ap.due30)} out, if invoices and bills are paid when due (overdue counted as due now).</span>
            </Tile>
          </div>

          <div className="ds-sec-lbl">Performance · {curLbl}</div>
          <div className="ds-tiles three">
            <Tile label="Net revenue" value={rpShort(pl.totals.netRevenue)}  view={{ t: "pl", src: "revenue" }}>
              <Vs cur={pl.totals.netRevenue} prev={plPrev.totals.netRevenue} />
            </Tile>
            <Tile label="Net profit/(loss)" sub={pl.margins.netMargin != null ? `${pct(pl.margins.netMargin)} margin` : null} value={rpShort(pl.totals.netProfit)} loss={pl.totals.netProfit < 0}  view={{ t: "pl", src: "profit" }}>
              <Vs cur={pl.totals.netProfit} prev={plPrev.totals.netProfit} />
            </Tile>
            <Tile label="Total equity" sub={`at ${dayLabel(to)}`} value={rpShort(bs.totals.totalEquity)} loss={bs.totals.totalEquity < 0} view={{ t: "equity" }}>
              <Vs cur={bs.totals.totalEquity} prev={bsPrev.totals.totalEquity} />
            </Tile>
          </div>

          <div className="ds-sec-lbl">Who owes what · at {dayLabel(asOf)}</div>
          <div className="ds-grid">
            <AgingCard title="Customers owe us" side="ar" d={ar} href="/reports/cashflow?tab=ar" />
            <AgingCard title="We owe vendors" side="ap" d={ap} href="/reports/cashflow?tab=ap"
              note={ap.accrued > 0.5 ? `Plus ${rpShort(ap.accrued)} accrued but not yet billed — not in the total.` : null} />
          </div>

          <section className="ds-card ds-commentary">
            <div className="ds-card-head"><span className="ds-card-title">Commentary</span><span className="ds-note-hint">Written by Finance for the directors</span></div>
            <textarea className="ds-note no-print" value={note.text} placeholder="Why things moved, what the team is doing about it, what the board should decide…" onChange={(e) => saveNote(e.target.value)} aria-label="Commentary for the directors" />
            <div className="ds-note-print">{note.text || ""}</div>
            {note.at && <div className="ds-note-actions no-print"><span className="ds-note-meta">Last edited by {note.by} · {new Date(note.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>}
          </section>

          <SignOff lang="id" preparedBy={user?.name} roles={["Disiapkan oleh (Finance)", "Disetujui oleh (Direktur Keuangan)", "Diketahui oleh (Direktur Utama)"]} />
          <p className="pl-foot no-print" style={{ marginTop: 10 }}>Every figure is the number its report shows for these dates. Click a box, an age bucket or a name to see what makes it up — down to the invoice or bill — without leaving this page. Cash is cash and cash equivalents in the books; receivables and payables are open invoices and posted bills.</p>
        </div>
      </div>
      {reviewing && (
        // Finance only: every anomaly, biggest first, to mark as known before
        // the summary goes to the directors. The boxes then show what is left.
        <aside className="txp sd ds-review no-print" role="dialog" aria-label="Worth a look — review">
          <div className="txp-head">
            <div className="txp-title-row">
              <div className="txp-title"><span className="txp-name">Worth a look · {openAnoms.length}</span></div>
              <button type="button" className="txp-x" onClick={() => setReviewing(false)} aria-label="Close">×</button>
            </div>
            <div className="txp-sub">Before this goes to the directors: mark what is known, with a note. The rest shows on the box it might explain. Biggest first.</div>
          </div>
          <div className="txp-body">
            {openAnoms.length === 0 && <div className="txp-empty">Nothing left to look at.</div>}
            {openAnoms.map((a) => <AnomalyRow key={a.id} a={a} />)}
            {knownAnoms.length > 0 && (
              <div className="ds-anom-foot">
                <button type="button" className="ds-anom-btn" onClick={() => setShowKnown((v) => !v)}>{showKnown ? "Hide" : "Show"} {knownAnoms.length} marked as known</button>
              </div>
            )}
            {showKnown && knownAnoms.map((a) => <AnomalyRow key={a.id} a={a} known={knownOf(a)} />)}
          </div>
          <div className="txp-foot">
            <div className="ds-anom-rules">
              Customers and vendors against their usual (average of {anomalies.baseline.months.map((m) => monthLabel(`${m}-01`).split(" ")[0]).join(", ")}) · moves of {Math.round(varianceThreshold.pct * 100)}% and {rpShort(varianceThreshold.amount)} · large is {rpShort(anomalyThresholds.large)}+ · <Link to="/accounting-preferences#directors-summary">Change</Link>
              {anomalies.skipped.length > 0 && <> · New and changed {anomalies.skipped.join(" and ")} need 3 months of history before the period — not checked yet.</>}
            </div>
          </div>
        </aside>
      )}
      {drill && (
        <SummaryDrill
          spec={drillSpecs[drillSpecs.length - 1]}
          crumbs={drillSpecs.map((s) => s.crumb)}
          onOpen={pushDrill} onBack={backDrill} onClose={closeDrill}
          onJump={(i) => setDrill((s) => s.slice(0, i + 1))}
          onChip={chipDrill}
        />
      )}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
