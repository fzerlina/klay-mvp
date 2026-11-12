// Reports → Balance Sheet.
//
// The V1 Balance Sheet from the competitor benchmark (Superhuman Docs ›
// Reporting › Balance Sheet - Competitor Analysis, §6). Same model as the
// Profit & Loss, adapted to a point in time:
//   • One statement at one date (as of), columns one at a time: a single
//     date, month-ends or quarter-ends of the fiscal year (oldest → newest, no
//     Total — a total of balances means nothing; Accurate removed theirs), or
//     one comparison (previous month-end, end of last fiscal year — the
//     statutory comparative — or the same date last year).
//   • Rows from the chart's own tree (lib/balanceSheet.js), SAK EP order.
//     Equity carries a computed Current year profit/(loss) line and retained
//     earnings with every earlier year rolled in — no closing journal.
//   • Proved on screen, which no vendor in the benchmark does: Assets =
//     Liabilities + Equity, and current-year profit = the P&L year to date.
//   • Review: variance pills vs the previous month-end (the company's 30% and
//     Rp 20M rule), one review per account and month shared with the Trial
//     Balance, read on the Review log; an Unreconciled pill on bank and cash
//     accounts not reconciled to the date.
//   • No dimension filter: a balance sheet sliced by a tag doesn't balance
//     unless every line carries it (QBO, Xero), so V1 leaves it out.
//   • Ratios under the statement (working capital, current ratio, debt to
//     equity), Excel with live formulas, CSV, and a signed print in Bahasa.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { COA_BY_CODE } from "../data/seed/coa";
import { COMPANY_BANK_ACCOUNTS } from "../data/seed/bankAccounts";
import { NON_BANK_ACCOUNTS } from "../data/seed/nonBankAccounts";
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useBankRecon } from "../state/BankReconContext";
import { useNonBankRecon } from "../state/NonBankReconContext";
import { useVarianceReviews, reviewKey } from "../state/VarianceReviewsContext";
import VariancePopover from "../components/VariancePopover";
import { computeBalanceSheet, bsRatios, BS_SIDES, CURRENT_YEAR_PROFIT, change } from "../lib/balanceSheet";
import { computeProfitLoss, unpostedInPeriod } from "../lib/profitLoss";
import { periodCloseState } from "../lib/trialBalance";
import { reconciledThrough } from "../lib/bankRecon";
import {
  asOfPresets, dayLabel, fiscalYearStartFor, monthEnd, periodEnds, previousMonthEnd,
  sameDayLastYear, todayIso, monthLabel,
} from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import {
  useClickOutside, Check, ChoicePopover, AsOfPopover, ViewsPopover, ExportPopover, loadLocal, saveLocal,
} from "../components/ReportControls";
import "./modules.css";
import "./invoices-ledger.css";
import "./trial-balance.css";
import "./profit-loss.css";
import "./balance-sheet.css";

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
// A ratio: "1,08×"; a change in one: "+0,12×".
const times = (v, signed = false) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";
  if (signed) return Math.abs(v) < 0.005 ? "—" : `${v > 0 ? "+" : "−"}${s}`;
  return v < 0 ? `(${s})` : s;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const r2 = (v) => Math.round(v * 100) / 100;

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const longDate = (iso, lang) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${(lang === "id" ? ID_MONTHS : EN_MONTHS)[m - 1]} ${y}`; };
const asAt = (iso, lang) => `${lang === "id" ? "Per" : "As at"} ${longDate(iso, lang)}`;
const monthStartOf = (iso) => `${iso.slice(0, 7)}-01`;

function Lbl({ en, id, lang }) {
  if (lang !== "id" || !id || id === en) return en;
  return <><span className="pl-lbl-screen">{en}</span><span className="pl-lbl-print">{id}</span></>;
}

const GEAR = <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
const CAL = <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const GL_ICON = <svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>;

// ── Choices ─────────────────────────────────────────────────────────────────
const COLUMN_LABELS = { single: "Single date", month: "By month-end", quarter: "By quarter-end" };
const COMPARE_LABELS = { none: "None", prev_month: "Previous month-end", prior_fy: "End of last fiscal year", prev_year: "Same date last year" };
const MAX_COLS = 12;

// Opens on the end of last month — the date the close reviews — beside the end
// of last fiscal year: the comparative SAK EP asks for and every printed
// neraca carries (NetSuite's Comparative BS defaults to it too). After that,
// on the last preset this user picked.
const DEFAULTS = {
  asOfChoice: { key: "last_month_end" },
  colMode: "single",
  compare: "prior_fy",
  showZero: false,
  showRatios: true,
  unit: 1,
  lang: "id",
};

function SettingsPopover({ showZero, onShowZero, showRatios, onShowRatios, unit, onUnit, lang, onLang, onClose }) {
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
        <span>Ratios under the statement</span>
        <input type="checkbox" className="tb-switch" checked={showRatios} onChange={(e) => onShowRatios(e.target.checked)} />
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

// Ratio rows under the statement (Campfire puts them in its builder; here they
// are fixed). `of` reads a result's totals.
const RATIOS = [
  { key: "workingCapital", label: "Working capital", id: "Modal kerja", kind: "amount", title: "Current assets less current liabilities" },
  { key: "currentRatio", label: "Current ratio", id: "Rasio lancar", kind: "ratio", title: "Current assets ÷ current liabilities" },
  { key: "debtToEquity", label: "Debt to equity", id: "Rasio utang terhadap ekuitas", kind: "ratio", title: "Total liabilities ÷ total equity" },
];

// ── Page ────────────────────────────────────────────────────────────────────
export default function BalanceSheetPage() {
  const navigate = useNavigate();
  const { entries } = useJournalEntries();
  const { fiscalYearStart, varianceThreshold } = useAccountingSettings();
  const { reviews, markReviewed, reopen } = useVarianceReviews();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { resolutions } = useBankRecon();
  const { records: nonBankRecords } = useNonBankRecon();

  const storeKey = (what) => `klay.balanceSheet.${what}.${user?.id || "anon"}`;

  const [asOfChoice, setAsOfChoice] = useState(() => {
    const k = loadLocal(storeKey("asOf"), null);
    return k ? { key: k } : DEFAULTS.asOfChoice;
  });
  const [colMode, setColMode] = useState(DEFAULTS.colMode);
  const [compare, setCompare] = useState(DEFAULTS.compare);
  const [showZero, setShowZero] = useState(DEFAULTS.showZero);
  const [showRatios, setShowRatios] = useState(DEFAULTS.showRatios);
  const [unit, setUnit] = useState(DEFAULTS.unit);
  const [lang, setLang] = useState(DEFAULTS.lang);
  const [collapsed, setCollapsed] = useState(() => new Set(loadLocal(storeKey("collapsed"), [])));
  useEffect(() => { saveLocal(storeKey("collapsed"), [...collapsed]); }, [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState("");
  const [focusCode, setFocusCode] = useState(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewPop, setReviewPop] = useState(null); // { code, anchor }
  const closeReview = useCallback(() => setReviewPop(null), []);

  // Arriving from the Review log: that date, the account highlighted, flagged
  // accounts shown.
  const location = useLocation();
  useEffect(() => {
    const p = location.state?.period;
    if (!p) return;
    setAsOfChoice({ key: "custom", date: p.to });
    if (location.state.review) {
      setFocusCode(location.state.review);
      setReviewOnly(true);
      setTimeout(() => document.querySelector(".bs-page .tb-acct-row.selected")?.scrollIntoView({ block: "center" }), 150);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const [openPop, setOpenPop] = useState(null); // asOf | columns | compare | settings | views | export
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

  // ── Date ──────────────────────────────────────────────────────────────────
  const presets = useMemo(() => asOfPresets({ fiscalYearStart, closedThrough }), [fiscalYearStart, closedThrough]);
  const asOf = useMemo(() => {
    if (asOfChoice.key === "custom") return { key: "custom", date: asOfChoice.date, label: "Custom date" };
    const p = presets.find((x) => x.key === asOfChoice.key && !x.disabled) || presets.find((x) => x.key === DEFAULTS.asOfChoice.key);
    return { key: p.key, date: p.date, label: p.label };
  }, [asOfChoice, presets]);
  useEffect(() => { if (asOf.key !== "custom") saveLocal(storeKey("asOf"), asOf.key); }, [asOf.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const date = asOf.date;
  const dateLbl = dayLabel(date);
  const fyStart = fiscalYearStartFor(date, fiscalYearStart);
  const today = todayIso();

  // ── Layout: one at a time ─────────────────────────────────────────────────
  const monthEnds = useMemo(() => periodEnds(fyStart, date, "month", fiscalYearStart), [fyStart, date, fiscalYearStart]);
  const quarterEnds = useMemo(() => periodEnds(fyStart, date, "quarter", fiscalYearStart), [fyStart, date, fiscalYearStart]);
  const tooFew = { month: monthEnds.length < 2, quarter: quarterEnds.length < 2 };
  const colEff = colMode !== "single" && !tooFew[colMode] ? colMode : "single";
  const multi = colEff !== "single";
  const compareDates = useMemo(() => ({
    prev_month: previousMonthEnd(date),
    prior_fy: (() => { const [y, m] = fyStart.split("-").map(Number); return previousMonthEnd(`${y}-${String(m).padStart(2, "0")}-01`); })(),
    prev_year: sameDayLastYear(date),
  }), [date, fyStart]);
  // Reviewing variances lays the previous month-end beside — the flags' basis.
  const compareEff = reviewOnly && !multi ? "prev_month" : compare;
  const compDate = !multi && compareEff !== "none" ? compareDates[compareEff] : null;
  const layout = compDate ? "compare" : multi ? "periods" : "single";

  const amountCols = useMemo(() => {
    const cur = { id: "cur", date, main: true };
    if (layout === "compare") return [{ ...cur, label: dateLbl }, { id: "cmp", date: compDate, label: dayLabel(compDate), muted: true }];
    if (layout === "periods") {
      const ends = colEff === "month" ? monthEnds : quarterEnds;
      return ends.map((d, i) => (d === date ? { ...cur, label: dayLabel(d) } : { id: `p${i}`, date: d, label: dayLabel(d), muted: true }));
    }
    return [{ ...cur, label: dateLbl }];
  }, [layout, date, dateLbl, compDate, colEff, monthEnds, quarterEnds]);

  const results = useMemo(() => {
    const out = {};
    for (const c of amountCols) out[c.id] = computeBalanceSheet(entries, c.date, { fiscalYearStart });
    return out;
  }, [amountCols, entries, fiscalYearStart]);
  const main = results.cur;

  const cells = useMemo(() => {
    const out = amountCols.map((c) => ({ key: c.id, kind: "amt", col: c, label: c.label, muted: c.muted, strong: c.main && amountCols.length > 1 }));
    if (layout === "compare") {
      out.push({ key: "diff", kind: "diff", label: "Change", id_label: "Perubahan" });
      out.push({ key: "diffPct", kind: "diffPct", label: "Change %", id_label: "Perubahan %" });
    }
    return out;
  }, [amountCols, layout]);

  // ── Status ────────────────────────────────────────────────────────────────
  const closeState = periodCloseState(date, date, closedThrough);
  const isFinal = closeState === "closed";
  const unposted = useMemo(() => unpostedInPeriod(entries, { from: fyStart, to: date }), [entries, fyStart, date]);
  const plNet = useMemo(() => computeProfitLoss(entries, { from: fyStart, to: date }).totals.netProfit, [entries, fyStart, date]);
  const plTies = Math.abs(r2(plNet - main.currentYearProfit)) < 0.5;
  const balanced = main.balanced;

  // ── Review: variance vs the previous month-end, and reconciliation ────────
  // Flags compare each account's balance on its normal side with the previous
  // month-end, so a review written here and one written on the Trial Balance
  // for the same month (same key, same amount) are the same review.
  const prevDate = compareDates.prev_month;
  const prevLbl = dayLabel(prevDate);
  const prevRes = useMemo(() => computeBalanceSheet(entries, prevDate, { fiscalYearStart }), [entries, prevDate, fiscalYearStart]);
  const normal = (code, res) => {
    const a = COA_BY_CODE[code];
    const v = res.byCode[code] || 0;
    const assetSide = a.type === "asset" || a.type === "contra_asset";
    return (a.normal_balance === "debit") === assetSide ? v : -v;
  };
  const reviewFrom = monthStartOf(date);
  const variances = useMemo(() => {
    const out = {};
    for (const code of Object.keys(main.byCode)) {
      if (code === CURRENT_YEAR_PROFIT.code) continue;
      const cur = normal(code, main);
      const was = normal(code, prevRes);
      const delta = r2(cur - was);
      const p = was ? delta / Math.abs(was) : null;
      if (Math.abs(delta) < varianceThreshold.amount || (p !== null && Math.abs(p) < varianceThreshold.pct)) continue;
      const rv = reviews[reviewKey(code, reviewFrom, date)];
      const status = !rv || rv.reopened ? "open" : Math.abs((rv.amount || 0) - cur) >= 0.5 ? "changed" : "reviewed";
      out[code] = { code, cur, was, delta, pct: p, review: rv || null, status };
    }
    return out;
  }, [main, prevRes, varianceThreshold, reviews, reviewFrom, date]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bank and cash accounts: how far each is reconciled (Bank and Non-Bank
  // Reconciliation). Only a date already passed is checked.
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
        const end = monthEnd(`${rec.period}-01`);
        if (!through || end > through) through = end;
      });
      m[a.glAccount] = { kind: "nonbank", name: a.name, through, to: "/non-bank-reconciliation" };
    });
    return m;
  }, [resolutions, nonBankRecords]);
  const unreconciled = useMemo(() => {
    const out = {};
    if (date >= today) return out;
    for (const [code, rec] of Object.entries(reconByCode)) {
      if (!(code in main.byCode)) continue;
      if (!rec.through || rec.through < date) out[code] = rec;
    }
    return out;
  }, [reconByCode, main, date, today]);

  const varList = Object.values(variances);
  const openVar = varList.filter((v) => v.status !== "reviewed").length;
  const reviewedCount = varList.length - openVar;
  const reconCount = Object.keys(unreconciled).length;
  const needsCount = openVar + reconCount;
  const flagged = (code) => !!variances[code] || !!unreconciled[code];
  const compactPills = layout === "compare" && compareEff === "prev_month";

  const driversFor = (code) => {
    const out = [];
    for (const je of entries) {
      if (je.status !== "posted" || je.je_date <= prevDate || je.je_date > date) continue;
      (je.lines || []).forEach((l, i) => {
        if (l.account_code !== code) return;
        out.push({ je: je.je_number, i, desc: l.description || je.memo || "", amount: r2((Number(l.debit) || 0) - (Number(l.credit) || 0)) });
      });
    }
    return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 3);
  };
  const acctName = (code) => COA_BY_CODE[code]?.name || code;

  // ── Rows ──────────────────────────────────────────────────────────────────
  const anyNonZero = (code) => amountCols.some((c) => Math.abs(results[c.id].byCode[code] || 0) >= 0.005);
  const q = search.trim().toLowerCase();
  const visible = (r) => r.computed || showZero || anyNonZero(r.code) || flagged(r.code);
  const matches = (r) => (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) && (!reviewOnly || flagged(r.code));
  // A node's rows and sub-nodes as shown: empty branches drop out.
  const shape = useCallback((node) => {
    const rows = node.rows.filter((r) => visible(r) && matches(r));
    const nodes = node.nodes.map(shape).filter((n) => n.rows.length || n.nodes.length);
    return { ...node, rows, nodes };
  }, [showZero, q, reviewOnly, variances, unreconciled, results]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => BS_SIDES.map((s) => ({ side: s, node: shape(main.sides[s.key].node) })), [main, shape]);
  const countRows = (n) => n.rows.length + n.nodes.reduce((k, c) => k + countRows(c), 0);
  const shownAccounts = tree.reduce((k, t) => k + countRows(t.node), 0);
  const totalAccounts = useMemo(() => {
    const walk = (n) => n.rows.filter(visible).length + n.nodes.reduce((k, c) => k + walk(c), 0);
    return BS_SIDES.reduce((k, s) => k + walk(main.sides[s.key].node), 0);
  }, [main, showZero, results, variances, unreconciled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expand / Collapse one level over the nodes on screen.
  const levelNodes = useMemo(() => {
    const out = [];
    const walk = (n, depth, parent) => { out.push({ id: n.id, depth, parent }); n.nodes.forEach((c) => walk(c, depth + 1, n.id)); };
    tree.forEach((t) => walk(t.node, 0, null));
    return out;
  }, [tree]);
  const parentOf = Object.fromEntries(levelNodes.map((n) => [n.id, n.parent]));
  const isShown = (n) => { for (let p = n.parent; p; p = parentOf[p]) if (collapsed.has(p)) return false; return true; };
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

  // A cell's value. `src`: an account code, { node }, { total } or { ratio }.
  const ratioOf = (res, key) => (key === "workingCapital" ? res.totals.workingCapital : bsRatios(res.totals)[key]);
  const amountOf = (colId, src) => {
    const res = results[colId];
    if (!res) return null;
    if (typeof src === "string") return res.byCode[src] ?? 0;
    if (src.node) return res.byNode[src.node] ?? 0;
    if (src.total) return res.totals[src.total];
    if (src.ratio) return ratioOf(res, src.ratio);
    return null;
  };
  const isRatio = (src) => typeof src !== "string" && src.ratio && RATIOS.find((r) => r.key === src.ratio)?.kind === "ratio";
  const cellValue = (cell, src) => {
    if (cell.kind === "amt") return amountOf(cell.col.id, src);
    const cur = amountOf("cur", src);
    const prev = amountOf("cmp", src);
    if (cur == null || prev == null) return null;
    if (cell.kind === "diff") return isRatio(src) ? cur - prev : change(cur, prev).diff;
    if (cell.kind === "diffPct") return isRatio(src) ? null : change(cur, prev).pct;
    return null;
  };
  const cellText = (cell, src) => {
    const v = cellValue(cell, src);
    if (cell.kind === "diffPct") return v == null ? (isRatio(src) ? "" : "—") : pct(v);
    if (isRatio(src)) return times(v, cell.kind === "diff");
    return num(v, unit);
  };

  // ── Drill ─────────────────────────────────────────────────────────────────
  // An account opens the General Ledger from the start of that date's fiscal
  // year to the date: the opening balance plus every posting, ending on the
  // balance shown. Current year profit opens the P&L for the same dates.
  const glUrl = (code, d) => {
    const qs = new URLSearchParams({ account: code, period: "custom", from: fiscalYearStartFor(d, fiscalYearStart), to: d });
    return `/reports/general-ledger?${qs}`;
  };
  const plState = (d) => ({ period: { from: fiscalYearStartFor(d, fiscalYearStart), to: d } });

  // ── Views ─────────────────────────────────────────────────────────────────
  const viewState = { asOfChoice: asOf.key === "custom" ? asOfChoice : { key: asOf.key }, colMode, compare, showZero, showRatios, unit, lang };
  const viewSig = JSON.stringify(viewState);
  const activeViewId = views.find((v) => JSON.stringify(v.state) === viewSig)?.id || null;
  const applyState = (s) => {
    setAsOfChoice(s.asOfChoice || DEFAULTS.asOfChoice);
    setColMode(s.colMode || DEFAULTS.colMode);
    setCompare(s.compare || DEFAULTS.compare);
    setShowZero(!!s.showZero);
    setShowRatios(s.showRatios ?? DEFAULTS.showRatios);
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
  const isDefault = JSON.stringify({ ...viewState, asOfChoice: undefined }) === JSON.stringify({ ...DEFAULTS, asOfChoice: undefined }) && asOf.key === DEFAULTS.asOfChoice.key && !search.trim();
  const resetAll = () => { applyState(DEFAULTS); setSearch(""); setReviewOnly(false); };

  const layoutNote = {
    compare: `Compared with ${COMPARE_LABELS[compareEff].toLowerCase()} (${compDate ? dayLabel(compDate) : ""})`,
    periods: `${COLUMN_LABELS[colEff]}, this fiscal year`,
    single: null,
  }[layout];
  const unitInfo = UNITS[unit];
  const statusWord = (l) => (isFinal ? (l === "id" ? "Final" : "Final") : l === "id" ? "Sementara" : "Preliminary");
  const title = (l) => (l === "id" ? "Laporan Posisi Keuangan" : "Balance Sheet");

  // ── Export ────────────────────────────────────────────────────────────────
  // The statement in order, every visible account under its group (search and
  // Needs review don't narrow an export).
  const exportItems = () => {
    const items = [];
    const walk = (n, depth) => {
      const rows = n.rows.filter(visible);
      const kids = n.nodes;
      if (!rows.length && !kids.some((k) => countVisible(k))) return;
      items.push({ type: "head", depth, node: n, label: n.label, id: n.idLabel, n: rows.length });
      rows.forEach((r) => items.push({ type: "acct", depth, code: r.code, label: r.name, id: r.idName || r.name, computed: r.computed }));
      kids.forEach((k) => walk(k, depth + 1));
      items.push({ type: "total", depth, node: n, label: `Total ${n.label.toLowerCase()}`, id: `Jumlah ${n.idLabel.toLowerCase()}` });
    };
    const countVisible = (n) => n.rows.filter(visible).length + n.nodes.reduce((k, c) => k + countVisible(c), 0);
    for (const s of BS_SIDES) {
      walk(main.sides[s.key].node, 0);
      if (s.key === "equity") items.push({ type: "grand", key: "totalLiabilitiesEquity", label: "Total liabilities and equity", id: "Jumlah liabilitas dan ekuitas" });
    }
    if (showRatios) RATIOS.forEach((r) => items.push({ type: "ratio", key: r.key, label: r.label, id: r.id, kind: r.kind }));
    return items;
  };
  const L = (it) => (lang === "id" ? it.id : it.label);
  const exportBase = exportName("balance-sheet", date);

  function exportXlsx() {
    closePop();
    const runAt = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const items = exportItems();
    const rows = [
      [{ v: COMPANY.legalName, s: "bold" }],
      [{ v: title(lang), s: "title" }],
      [asAt(date, lang)],
      [{ v: `(${unitInfo[lang === "id" ? "id" : "en"]})`, s: "muted" }],
      [{ v: [statusWord(lang), layoutNote].filter(Boolean).join(" · "), s: "muted" }],
      [{ v: `Run ${runAt}${user?.name ? ` by ${user.name}` : ""}`, s: "muted" }],
      [],
      [{ v: lang === "id" ? "Kode" : "Code", s: "head" }, { v: lang === "id" ? "Keterangan" : "Line", s: "head" },
        ...cells.map((c) => ({ v: lang === "id" ? (c.id_label || c.label) : c.label, s: "headNum" }))],
    ];
    const freeze = rows.length;
    const first = rows.length + 1;
    const rowOf = (i) => first + i;
    // Each total sums its own accounts (contiguous after its heading) and the
    // totals of the groups under it.
    const totalRowOf = {};
    items.forEach((it, i) => { if (it.type === "total") totalRowOf[it.node.id] = rowOf(i); });
    const headOf = {};
    items.forEach((it, i) => { if (it.type === "head") headOf[it.node.id] = { row: rowOf(i), n: it.n }; });
    const scaled = (v) => (v == null ? null : r2(v / unit));
    const cellCol = (k) => colName(2 + cells.findIndex((c) => c.key === k));
    const totalFormula = (node, c) => {
      const { row: h, n } = headOf[node.id];
      const parts = [];
      if (n) parts.push(`SUM(${c}${h + 1}:${c}${h + n})`);
      node.nodes.forEach((k) => { if (totalRowOf[k.id]) parts.push(`${c}${totalRowOf[k.id]}`); });
      return parts.join("+") || "0";
    };
    const sideTotalRow = (key) => totalRowOf[BS_SIDES.find((s) => s.key === key).root];
    const nodeTotalRow = (id) => totalRowOf[id];
    items.forEach((it, i) => {
      const rowNo = rowOf(i);
      const indent = "   ".repeat(it.depth || 0);
      const bold = it.type === "total" || it.type === "grand" || it.type === "head";
      const label = it.type === "acct" ? `${indent}   ${L(it)}` : it.type === "ratio" ? L(it) : `${indent}${L(it)}`;
      const row = [it.type === "acct" && !it.computed ? it.code : "", { v: label, s: bold ? "bold" : it.type === "ratio" ? "muted" : "text" }];
      if (it.type === "head") { rows.push(row); return; }
      const src = it.type === "acct" ? it.code : it.type === "total" ? { node: it.node.id } : it.type === "grand" ? { total: it.key } : { ratio: it.key };
      for (const c of cells) {
        const colL = cellCol(c.key);
        const v = cellValue(c, src);
        if (c.kind === "amt") {
          if (it.type === "acct") row.push(v ? { v: scaled(v), s: "num" } : null);
          else if (it.type === "total") row.push({ f: totalFormula(it.node, colL), v: scaled(v), s: "numBold" });
          else if (it.type === "grand") row.push({ f: `${colL}${sideTotalRow("liabilities")}+${colL}${sideTotalRow("equity")}`, v: scaled(v), s: "numBold" });
          else if (it.key === "workingCapital") row.push({ f: `${colL}${nodeTotalRow("g-current-asset")}-${colL}${nodeTotalRow("g-current-liab")}`, v: scaled(v), s: "num" });
          else if (it.key === "currentRatio") row.push({ f: `IF(${colL}${nodeTotalRow("g-current-liab")}=0,"",${colL}${nodeTotalRow("g-current-asset")}/${colL}${nodeTotalRow("g-current-liab")})`, v, s: "num" });
          else if (it.key === "debtToEquity") row.push({ f: `IF(${colL}${sideTotalRow("equity")}=0,"",${colL}${sideTotalRow("liabilities")}/${colL}${sideTotalRow("equity")})`, v, s: "num" });
        } else if (c.kind === "diff") {
          const a = cellCol("cur"), b = cellCol("cmp");
          row.push({ f: `${a}${rowNo}-${b}${rowNo}`, v: isRatio(src) ? v : scaled(v), s: bold ? "numBold" : "num" });
        } else if (c.kind === "diffPct") {
          if (isRatio(src)) { row.push(null); continue; }
          const a = cellCol("cur"), b = cellCol("cmp");
          row.push({ f: `IF(${b}${rowNo}=0,"",(${a}${rowNo}-${b}${rowNo})/ABS(${b}${rowNo}))`, v, s: bold ? "pctBold" : "pct" });
        }
      }
      rows.push(row);
    });
    // The check, with live formulas: assets less liabilities and equity.
    const assetsRow = sideTotalRow("assets");
    const leRow = rowOf(items.findIndex((it) => it.type === "grand"));
    rows.push([], ["", { v: lang === "id" ? "Selisih (aset − liabilitas dan ekuitas)" : "Difference (assets − liabilities and equity)", s: "muted" },
      ...cells.map((c) => (c.kind === "amt" ? { f: `${cellCol(c.key)}${assetsRow}-${cellCol(c.key)}${leRow}`, v: scaled(results[c.col.id].difference), s: "num" } : null))]);
    const sign = lang === "id" ? ["Disiapkan oleh", "Diperiksa oleh", "Disetujui oleh", "Tanggal:", "Nama"] : ["Prepared by", "Reviewed by", "Approved by", "Date:", "Name"];
    rows.push([], []);
    rows.push(["", { v: sign[0], s: "bold" }, { v: sign[1], s: "bold" }, { v: sign[2], s: "bold" }]);
    rows.push([], ["", user?.name || sign[4], sign[4], sign[4]], ["", { v: sign[3], s: "muted" }, { v: sign[3], s: "muted" }, { v: sign[3], s: "muted" }]);
    downloadXlsx(exportBase.replace(/\.csv$/, ".xlsx"), {
      sheet: lang === "id" ? "Posisi Keuangan" : "Balance Sheet",
      rows,
      widths: [10, 50, ...cells.map((c) => (c.kind === "diffPct" ? 12 : 18))],
      freeze,
    });
    showToast("Balance Sheet exported to Excel");
  }

  function exportCsv() {
    closePop();
    const items = exportItems();
    downloadCsv(exportBase, {
      header: [
        ...reportHeader({ report: title(lang), period: asAt(date, lang), runBy: user?.name }),
        [unitInfo[lang === "id" ? "id" : "en"]],
        ...(layoutNote ? [[layoutNote]] : []),
      ],
      columns: [
        { label: lang === "id" ? "Kode" : "Code", value: (it) => (it.type === "acct" && !it.computed ? it.code : "") },
        { label: lang === "id" ? "Keterangan" : "Line", value: (it) => L(it) },
        ...cells.map((c) => ({
          label: `${lang === "id" ? (c.id_label || c.label) : c.label}${c.kind === "diffPct" ? " (%)" : ""}`,
          value: (it) => {
            if (it.type === "head") return "";
            const src = it.type === "acct" ? it.code : it.type === "total" ? { node: it.node.id } : it.type === "grand" ? { total: it.key } : { ratio: it.key };
            const v = cellValue(c, src);
            if (v == null) return "";
            if (c.kind === "diffPct") return r2(v * 100);
            if (isRatio(src)) return Math.round(v * 100) / 100;
            return r2(v / unit);
          },
        })),
      ],
      rows: items,
    });
    showToast("Balance Sheet exported to CSV");
  }
  const exportPrint = () => { closePop(); setTimeout(printReport, 50); };

  // ── Toolbar items ─────────────────────────────────────────────────────────
  // Month-ends or quarter-ends replace the comparison while they're on (the
  // statement opens with one, so making the user turn it off first would be a
  // dead end); Compare comes back with Single date.
  const columnItems = [
    { k: "single", lbl: "Single date", hint: dateLbl },
    { k: "month", lbl: "By month-end", hint: tooFew.month ? "one month-end this year" : plural(Math.min(monthEnds.length, MAX_COLS), "column"),
      disabled: tooFew.month, title: tooFew.month ? "The fiscal year has only reached its first month-end." : undefined },
    { k: "quarter", lbl: "By quarter-end", hint: tooFew.quarter ? "one quarter-end this year" : plural(quarterEnds.length, "column"),
      disabled: tooFew.quarter, title: tooFew.quarter ? "The fiscal year has only reached its first quarter." : undefined },
  ];
  const compareItems = [
    { k: "none", lbl: "No comparison" },
    ...["prev_month", "prior_fy", "prev_year"].map((k) => ({ k, lbl: COMPARE_LABELS[k], hint: dayLabel(compareDates[k]) })),
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  const unitHead = unitInfo.head;
  const INDENT = 18;
  const Chevron = ({ closed }) => <svg className={`lg-group-chevron${closed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>;
  const dash = <span className="lg-cell-em-dash">—</span>;

  const amountCells = (src, { code, show = true, profit = false } = {}) => cells.map((cell) => {
    const v = show ? cellValue(cell, src) : null;
    const loss = profit && cell.kind === "amt" && v != null && v < -0.005;
    const tripped = compactPills && cell.kind === "diffPct" && typeof src === "string" && variances[src] && variances[src].status !== "reviewed" && variances[src].pct !== null;
    const cls = `lg-cell-total${cell.strong ? " tb-cell-end" : ""}${cell.muted ? " tb-cell-muted" : ""}${cell.kind !== "amt" ? " pl-cell-sub" : ""}${loss ? " pl-loss" : ""}${tripped ? " var-cell" : ""}`;
    if (!show) return <div key={cell.key} className={cls} />;
    const text = cellText(cell, src);
    const body = text === "—" ? dash : text;
    if (code && cell.kind === "amt" && v && Math.abs(v) >= 0.005) {
      const d = cell.col.date;
      if (code === CURRENT_YEAR_PROFIT.code) {
        return (
          <div key={cell.key} className={cls}>
            <Link className="pl-amt-link" to="/reports/profit-loss" state={plState(d)} onClick={(e) => e.stopPropagation()}
              title={`Open the Profit & Loss for ${dayLabel(fiscalYearStartFor(d, fiscalYearStart))} – ${dayLabel(d)}`}>{body}</Link>
          </div>
        );
      }
      return (
        <div key={cell.key} className={cls}>
          <Link className="pl-amt-link" to={glUrl(code, d)} onClick={(e) => e.stopPropagation()}
            title={`Open ${code} in the General Ledger up to ${dayLabel(d)}`}>{body}</Link>
        </div>
      );
    }
    return <div key={cell.key} className={cls}>{body}</div>;
  });

  const VarPill = ({ v, name }) => {
    if (!v) return null;
    const open = reviewPop?.code === v.code;
    const text = v.status === "reviewed" ? "Reviewed" : v.status === "changed" ? "Changed" : v.pct === null ? "New" : `${v.delta > 0 ? "+" : "−"}${Math.round(Math.abs(v.pct) * 100).toLocaleString("id-ID")}%`;
    const iconOnly = compactPills && v.pct !== null && v.status !== "reviewed";
    return (
      <button type="button" className={`var-pill no-print ${v.status}${open ? " on" : ""}${iconOnly ? " icon-only" : ""}`} data-review-code={v.code}
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${name}: ${v.status === "reviewed" ? "variance reviewed" : `moved ${text} vs ${prevLbl}`} — open review`}
        title={v.status === "reviewed" ? `Reviewed by ${v.review?.by}` : `Moved ${rp(v.delta)} since ${prevLbl}`}
        onClick={(e) => {
          e.stopPropagation();
          const { left, top, bottom } = e.currentTarget.getBoundingClientRect();
          setReviewPop((p) => (p?.code === v.code ? null : { code: v.code, anchor: { left, top, bottom } }));
        }}>
        {v.status === "reviewed" ? <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> : <svg viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>}
        {!iconOnly && text}
      </button>
    );
  };
  // Reconciliation isn't explained, it's done: the pill opens the reconciliation.
  const ReconPill = ({ rec }) => (
    <Link className="var-pill no-print open bs-recon-pill" to={rec.to} onClick={(e) => e.stopPropagation()}
      title={rec.through ? `${rec.name} is reconciled to ${dayLabel(rec.through)} — finish the ${rec.kind === "bank" ? "bank" : "non-bank"} reconciliation to ${dateLbl}.` : `${rec.name} has no finished reconciliation. Reconcile it to ${dateLbl}.`}>
      Unreconciled
    </Link>
  );

  const reCode = DEFAULT_ACCOUNTS.retainedEarnings;
  const AcctRow = ({ r, isAlt, depth }) => {
    const computed = r.computed;
    const to = computed ? null : glUrl(r.code, date);
    const onRowClick = () => {
      if (window.getSelection?.().toString()) return;
      setFocusCode((c) => (c === r.code ? null : r.code));
    };
    return (
      <div className={`lg-row tb-acct-row${isAlt ? " alt" : ""}${computed ? " bs-computed-row" : ""}${focusCode === r.code || reviewPop?.code === r.code ? " selected" : ""}`} onClick={onRowClick}>
        <div className={`tb-cell-name${flagged(r.code) ? " has-var-pill" : ""}`} style={{ paddingLeft: (depth + 1) * INDENT }}>
          {computed ? (
            <>
              <span className="tb-code bs-code-calc" title="Calculated — not an account">Calc.</span>
              <Link className="tb-name tb-acct-link" to="/reports/profit-loss" state={plState(date)} onClick={(e) => e.stopPropagation()}
                title="Profit & Loss from the start of the fiscal year to this date — not a posting">
                <Lbl en={r.name} id={r.idName} lang={lang} />
              </Link>
              <Link className="tb-gl-btn no-print" to="/reports/profit-loss" state={plState(date)} onClick={(e) => e.stopPropagation()}>
                Profit &amp; Loss {GL_ICON}
              </Link>
            </>
          ) : (
            <>
              <span className="tb-code">{r.code}</span>
              <Link className="tb-name tb-acct-link" to={to} title={`Open ${r.name} in the General Ledger`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
              {r.code === reCode && Math.abs(main.rolledProfit) >= 0.5 && (
                <span className="bs-rolled no-print" title={`Includes ${rp(main.rolledProfit)} of earlier fiscal years' profit/(loss), rolled in at each year-end. It isn't a posting, so the General Ledger for this account won't show it.`}>
                  incl. earlier years
                </span>
              )}
              <VarPill v={variances[r.code]} name={r.name} />
              {unreconciled[r.code] && <ReconPill rec={unreconciled[r.code]} />}
              <Link className="tb-gl-btn no-print" to={to} onClick={(e) => e.stopPropagation()} aria-label={`Open ${r.code} ${r.name} in the General Ledger`}>
                General Ledger {GL_ICON}
              </Link>
            </>
          )}
        </div>
        {amountCells(r.code, { code: r.code, profit: computed })}
      </div>
    );
  };

  // A group: one row when collapsed, its total on the same line; open, its
  // accounts, its sub-groups, then a "Total …" row. A side (Assets,
  // Liabilities, Equity) closes with a bold total.
  const Group = ({ node, depth = 0, root = false }) => {
    const isClosed = collapsed.has(node.id);
    const totalLabel = root && node.id === "g-asset" ? { en: "Total assets", id: "Jumlah aset" } : { en: `Total ${node.label.toLowerCase()}`, id: `Jumlah ${node.idLabel.toLowerCase()}` };
    return (
      <Fragment>
        <div className={`lg-row tb-group-row${depth ? " tb-subgroup" : ""}${root ? " bs-side-row" : ""}${isClosed ? " collapsed" : ""}`}
          onClick={() => toggleGroup(node.id)} aria-expanded={!isClosed} title={isClosed ? "Expand" : "Collapse"}>
          <div className="tb-group-name" style={{ paddingLeft: depth * INDENT }}>
            <Chevron closed={isClosed} />
            <span className="lg-group-lbl"><Lbl en={node.label} id={node.idLabel} lang={lang} /></span>
          </div>
          {amountCells({ node: node.id }, { show: isClosed })}
        </div>
        {!isClosed && node.rows.map((r, i) => <AcctRow key={r.code} r={r} isAlt={i % 2 === 1} depth={depth} />)}
        {!isClosed && node.nodes.map((n) => <Group key={n.id} node={n} depth={depth + 1} />)}
        {!isClosed && (
          <div className={`lg-row subtotal ${root ? `pl-subtotal${node.id === "g-asset" ? " tb-total-row pl-grand" : ""}` : "pl-group-total"}`}>
            <div className="tb-total-lbl" style={{ paddingLeft: depth * INDENT }}><Lbl en={totalLabel.en} id={totalLabel.id} lang={lang} /></div>
            {amountCells({ node: node.id })}
          </div>
        )}
      </Fragment>
    );
  };

  const statementRows = () => {
    const out = [];
    tree.forEach(({ side, node }) => {
      out.push(<Group key={node.id} node={node} root />);
      if (side.key === "equity") {
        out.push(
          <div key="tle" className="lg-row subtotal pl-subtotal tb-total-row pl-grand">
            <div className="tb-total-lbl"><Lbl en="Total liabilities and equity" id="Jumlah liabilitas dan ekuitas" lang={lang} /></div>
            {amountCells({ total: "totalLiabilitiesEquity" })}
          </div>,
        );
      }
    });
    if (showRatios && !q && !reviewOnly) {
      out.push(<div key="ratio-gap" className="bs-ratio-gap" />);
      RATIOS.forEach((r) => out.push(
        <div key={r.key} className="lg-row pl-margin-row bs-ratio-row" title={r.title}>
          <div className="pl-margin-lbl"><Lbl en={r.label} id={r.id} lang={lang} /></div>
          {amountCells({ ratio: r.key })}
        </div>,
      ));
    }
    return out;
  };

  const diffNote = (res) => `off by ${rp(Math.abs(res.difference))}`;

  return (
    <div className="lg-page tb-report pl-page bs-page">
      <div className="lg-scroll-container">
        {/* ── Print header (print / PDF only) ───────────────────────── */}
        <div className="print-only tb-print-head">
          <div className="tb-print-company">{COMPANY.legalName}</div>
          <div className="tb-print-title">{title(lang)}</div>
          <div className="tb-print-period">{asAt(date, lang)}</div>
          <div className="tb-print-period">({unitInfo[lang === "id" ? "id" : "en"]}) · {statusWord(lang)}{layoutNote ? ` · ${layoutNote}` : ""}</div>
        </div>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Balance Sheet</h1>
            </div>
            <div className="lg-head-actions no-print">
              <Link className="lg-btn-ghost pl-log-btn" to="/reports/review-log" state={{ back: "/reports/balance-sheet" }} title="Every variance reason written on the Balance Sheet, P&L and Trial Balance">
                <svg viewBox="0 0 24 24"><path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></svg>
                Review log
              </Link>
              <div className="lg-meta-btn-wrap">
                <button className={`lg-btn-ghost${activeViewId ? " tb-btn-on" : ""}`} onClick={() => togglePop("views")} aria-haspopup="dialog" aria-expanded={openPop === "views"}>
                  <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
                  {activeViewId ? views.find((v) => v.id === activeViewId)?.name : "Views"}
                </button>
                {openPop === "views" && (
                  <ViewsPopover views={views} activeId={activeViewId} onApply={applyView} onDelete={deleteView} onSave={saveView} onClose={closePop}
                    emptyText="No saved views yet. Set the date, columns and comparison the way you like, then save them here. A preset date rolls forward on its own." />
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

          {/* Status — Final or Preliminary, what isn't posted, and the two proofs */}
          <div className="tb-status no-print">
            <span className={`tb-status-chip ${isFinal ? "closed" : "open"}`}>{isFinal ? "Final" : "Preliminary"}</span>
            <span>
              {isFinal
                ? `Books are closed through ${monthLabel(`${closedThrough}-01`)} — these balances are final.`
                : "This date is in an open period — balances may change as journals are posted."}
            </span>
            {unposted.length > 0 && (
              <>
                <span className="tb-status-sep">·</span>
                <button className="tb-status-link" onClick={() => navigate("/journal-entry")}>
                  {plural(unposted.length, "draft or pending journal")} this fiscal year {unposted.length === 1 ? "isn't" : "aren't"} included
                </button>
              </>
            )}
            <span className="tb-status-sep">·</span>
            <span className={`tb-foot ${balanced ? "ok" : "off"}`} title="Total assets against total liabilities and equity.">
              <span aria-hidden="true">{balanced ? "✓" : "✕"}</span> {balanced ? "Assets = Liabilities + Equity" : `Out of balance by ${rp(Math.abs(main.difference))}`}
            </span>
            <span className="tb-status-sep">·</span>
            <span className={`tb-foot ${plTies ? "ok" : "off"}`} title="Current year profit/(loss) here against the Profit & Loss's net profit from the start of the fiscal year to this date.">
              <span aria-hidden="true">{plTies ? "✓" : "✕"}</span> {plTies ? "Current year profit ties to the P&L" : `Current year profit is off the P&L by ${rp(r2(plNet - main.currentYearProfit))}`}
            </span>
            <span className="tb-status-sep">·</span>
            <span className="tb-unit-note">{unitInfo.en}</span>
          </div>
        </div>

        <div className="lg-table-wrap pl-wrap">
          <div className="lg-card lg-table-tb pl-card" style={{ "--tb-n": cells.length }}>
            {/* ── Toolbar ──────────────────────────────────────────────── */}
            <div className="lg-filter-row no-print tb-filter-row pl-toolbar">
              <div className="tb-toolbar-left">
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn tb-period-btn" onClick={() => togglePop("asOf")} aria-haspopup="dialog" aria-expanded={openPop === "asOf"}>
                    {CAL}
                    <span className="meta-lbl">As of</span>
                    <span className="meta-val">{dateLbl}</span>
                    {asOf.key !== "custom" && <span className="meta-lbl">· {asOf.label}</span>}
                  </button>
                  {openPop === "asOf" && <AsOfPopover presets={presets} asOf={asOf} dateLabel={dayLabel} onPick={(c) => { setAsOfChoice(c); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${multi ? " active" : ""}`} onClick={() => togglePop("columns")} aria-haspopup="menu" aria-expanded={openPop === "columns"}>
                    <span className="meta-lbl">Columns:</span>
                    <span className="meta-val">{COLUMN_LABELS[colEff]}</span>
                  </button>
                  {openPop === "columns" && <ChoicePopover className="tb-compare-pop" items={columnItems} value={colEff} onPick={(k) => { setColMode(k); if (k !== "single") setReviewOnly(false); closePop(); }} onClose={closePop}
                    note="Month-ends and quarter-ends of this fiscal year, oldest first. A balance sheet has no total across dates." />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${compDate ? " active" : ""}`} onClick={() => togglePop("compare")} disabled={multi}
                    title={multi ? "Comparison works on a single date. Set Columns to Single date to compare." : undefined}
                    aria-haspopup="menu" aria-expanded={openPop === "compare"}>
                    <span className="meta-lbl">Compare:</span>
                    <span className="meta-val">{compDate ? COMPARE_LABELS[compareEff] : "None"}</span>
                  </button>
                  {openPop === "compare" && <ChoicePopover className="tb-compare-pop" items={compareItems} value={compDate ? compareEff : "none"} onPick={(k) => { setCompare(k); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-search">
                  <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                  <input placeholder="Search account code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="lg-filter-meta">
                <button className={`lg-toggle pl-review-toggle${reviewOnly ? " on" : ""}`} onClick={() => setReviewOnly((x) => !x)} aria-pressed={reviewOnly}
                  disabled={multi || (!needsCount && !reviewedCount && !reviewOnly)}
                  title={multi ? "Review works on a single date. Set Columns to Single date."
                    : `Balances that moved ${Math.round(varianceThreshold.pct * 100)}% and ${rp(varianceThreshold.amount)} or more since ${prevLbl} (Settings › General Settings › Preferences), and bank or cash accounts not reconciled to ${dateLbl}. Shows them with ${prevLbl} beside.`}>
                  Needs review <span className="tb-toggle-count">{needsCount}</span>
                  {reviewedCount > 0 && <span className="pl-review-done">· {reviewedCount} reviewed</span>}
                </button>
                <span className="tb-tool-sep" aria-hidden="true" />
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
                    <SettingsPopover showZero={showZero} onShowZero={setShowZero} showRatios={showRatios} onShowRatios={setShowRatios}
                      unit={unit} onUnit={setUnit} lang={lang} onLang={setLang} onClose={closePop} />
                  )}
                </div>
                {!isDefault && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            {/* ── Statement ──────────────────────────────────────────── */}
            <div className="pl-statement">
              <div className="lg-col-header">
                <div><Lbl en="Account" id="Akun" lang={lang} /></div>
                {cells.map((c) => (
                  <div key={c.key} style={{ textAlign: "right" }} className={c.kind !== "amt" ? "pl-cell-sub" : undefined}
                    title={c.col ? `${lang === "id" ? "Per" : "As at"} ${dayLabel(c.col.date)}` : undefined}>
                    <Lbl en={c.label} id={c.id_label} lang={lang} />
                    {(c.kind === "amt" || c.kind === "diff") && <span className="pl-th-unit"> ({unitHead})</span>}
                  </div>
                ))}
              </div>
              <div>
                {q && shownAccounts === 0 && <div className="lg-empty">No accounts match “{search.trim()}”. The totals still cover every account.</div>}
                {reviewOnly && shownAccounts === 0 && <div className="lg-empty">Nothing needs review at {dateLbl}.</div>}
                {statementRows()}
              </div>
            </div>
            {amountCols.some((c) => !results[c.id].balanced) && (
              <div className="pl-warn">
                Out of balance: {amountCols.filter((c) => !results[c.id].balanced).map((c) => `${c.label} ${diffNote(results[c.id])}`).join(" · ")}. Check the opening balances and any journal that doesn&apos;t foot.
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
            Click a group to open or close it. An account opens the General Ledger from the start of the fiscal year to the date, ending on the balance shown; Current year profit/(loss) opens the Profit &amp; Loss for the same dates.
            {" "}Contra accounts (accumulated depreciation, allowances) and dividends are in parentheses and reduce their group.
            {" "}Retained earnings includes every earlier fiscal year&apos;s profit/(loss); no closing journal is needed.
          </p>
        </div>
      </div>

      {/* ── Sticky footer ──────────────────────────────────────────── */}
      <div className="lg-footer no-print">
        <div className="lg-footer-left">
          <span><span className="lg-footer-num">{shownAccounts}</span> of {totalAccounts} accounts shown</span>
        </div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Total assets</span>
          <span className="lg-footer-total">{rp(main.totals.totalAssets)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Liabilities + equity</span>
          <span className="lg-footer-total">{rp(main.totals.totalLiabilitiesEquity)}</span>
          <span className="lg-footer-sep">·</span>
          <span className={`tb-balance-flag ${balanced ? "ok" : "off"}`}>{balanced ? "✓ Balanced" : `Off by ${rp(Math.abs(main.difference))}`}</span>
        </div>
      </div>

      {reviewPop && variances[reviewPop.code] && (() => {
        const v = variances[reviewPop.code];
        const key = reviewKey(v.code, reviewFrom, date);
        const by = user?.name || "You";
        return (
          <VariancePopover key={`${v.code}-${v.status}`} anchor={reviewPop.anchor} account={{ code: v.code, name: acctName(v.code) }} v={v}
            prevLabel={prevLbl} curLabel={dateLbl} prep="at" driversTitle={`Biggest lines since ${prevLbl}`}
            rule={`${Math.round(varianceThreshold.pct * 100)}% and ${rp(varianceThreshold.amount)}`}
            drivers={driversFor(v.code)} glTo={glUrl(v.code, date)} onClose={closeReview}
            onSave={(note) => { markReviewed(key, { note, by, amount: v.cur, prev: v.was, report: "bs" }); showToast(`${v.code} marked reviewed`); }}
            onReopen={() => { reopen(key, by, "bs"); showToast(`${v.code} reopened for review`); }} />
        );
      })()}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
