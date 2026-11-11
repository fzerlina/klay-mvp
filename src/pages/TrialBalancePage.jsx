import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { periodPresets, rangeLabel, monthLabel, previousPeriod, todayIso, sameDayLastYear } from "../lib/reportPeriods";
import { useClickOutside, Check, ChoicePopover, ADJ_NOTE, PeriodPopover, DimensionPopover, ViewsPopover, ExportPopover } from "../components/ReportControls";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx, colName } from "../lib/xlsxExport";
import { lineDimensions } from "../lib/generalLedger";
import { reconciledThrough } from "../lib/bankRecon";
import {
  computeTrialBalance, ledgerBalance, unpostedInPeriod, periodCloseState,
  netProfitForPeriod, tieOut, coaTree,
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
// Table cells: plain numbers, credits / decreases in brackets. The currency is
// stated once above the table.
const amt = (v) => (v < 0 ? `(${(-v).toLocaleString("id-ID")})` : v.toLocaleString("id-ID"));
const fmtIdDate = (s) =>
  new Date(s + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pctText = (v) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const r2 = (v) => Math.round(v * 100) / 100;

const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEndOf = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${pad(lastDay(y, m))}`; };
// ── Columns ───────────────────────────────────────────────────────────────
// Every layout splits balances into Debit and Credit, the way the Indonesian
// neraca saldo and the Excel export do — a credit balance is never shown as a
// bracketed "negative" (SME feedback: Liabilities, Equity and Revenue read as
// negative otherwise).
//   six      Opening · Movement · Ending, each Debit / Credit (Saldo Awal ·
//            Mutasi · Saldo Akhir). With adjustments excluded, Movement and
//            Ending leave out the period's adjusting journals.
//   worksheet  Unadjusted · Adjustments · Adjusted, each Debit / Credit — the
//            neraca saldo → jurnal penyesuaian → neraca saldo setelah
//            penyesuaian columns of the neraca lajur.
//   compare  Ending Debit / Credit for the comparison period and this one, then
//            the change on the account's normal side (brackets = it went down)
function columnsFor(layout, compareLbl, currentLbl) {
  if (layout === "compare") {
    return [
      { key: "prev_ending_dr", label: "Debit",  sup: compareLbl, sum: true, muted: true },
      { key: "prev_ending_cr", label: "Credit", sup: compareLbl, sum: true, muted: true },
      { key: "ending_dr",      label: "Debit",  sup: currentLbl, sum: true, strong: true },
      { key: "ending_cr",      label: "Credit", sup: currentLbl, sum: true, strong: true },
      { key: "change",         label: "Amount", sup: "Change",   sum: true, title: "Ending balance now less the comparison period's, on the account's normal side. Brackets: the balance went down." },
      { key: "change_pct",     label: "%",      sup: "Change",   pct: true },
    ];
  }
  if (layout === "worksheet") {
    return [
      { key: "unadj_dr",    label: "Debit",  sup: "Unadjusted",  sum: true, muted: true, title: "Ending balance before this period's adjusting journals" },
      { key: "unadj_cr",    label: "Credit", sup: "Unadjusted",  sum: true, muted: true, title: "Ending balance before this period's adjusting journals" },
      { key: "adj_debit",   label: "Debit",  sup: "Adjustments", sum: true, title: "Adjusting journals dated in this period" },
      { key: "adj_credit",  label: "Credit", sup: "Adjustments", sum: true, title: "Adjusting journals dated in this period" },
      { key: "ending_dr",   label: "Debit",  sup: "Adjusted",    sum: true, strong: true },
      { key: "ending_cr",   label: "Credit", sup: "Adjusted",    sum: true, strong: true },
    ];
  }
  return [
    { key: "opening_dr",    label: "Debit",  sup: "Opening",  sum: true, muted: true },
    { key: "opening_cr",    label: "Credit", sup: "Opening",  sum: true, muted: true },
    { key: "period_debit",  label: "Debit",  sup: "Movement", sum: true },
    { key: "period_credit", label: "Credit", sup: "Movement", sum: true },
    { key: "ending_dr",     label: "Debit",  sup: "Ending",   sum: true, strong: true },
    { key: "ending_cr",     label: "Credit", sup: "Ending",   sum: true, strong: true },
  ];
}

// Adjusting journals in the period: included (the adjusted TB), excluded (the
// unadjusted TB) or shown as their own columns (the worksheet).
const ADJ_LABELS = { included: "Included", excluded: "Excluded", columns: "As columns" };
// A row as it stood before this period's adjusting journals.
const unadjustedRow = (r) => ({
  ...r,
  period_debit: r2(r.period_debit - r.adj_debit),
  period_credit: r2(r.period_credit - r.adj_credit),
  movement: r2(r.movement - r.adj_movement),
  closing_balance: r.unadj_closing,
  closing_net: r.unadj_net,
  ending_dr: r.unadj_dr,
  ending_cr: r.unadj_cr,
});

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

// ── Review checks ─────────────────────────────────────────────────────────
// Two checks from the benchmark (docs/research/trial-balance, P1 #7 and #8),
// built from the ledger itself so they hold for any company's chart — no
// account codes or amounts are hard-coded.
//   variance    A big move against the previous period: a P&L account's
//               activity, or a balance-sheet account's ending balance, changed
//               by at least `variancePct` AND a fixed amount, `materiality`
//               (both, so small accounts don't trip on percentages and big ones
//               don't trip on rounding). Both are the company's own settings
//               (Accounting Preferences; defaults 30% and Rp 20.000.000, from
//               the SME). A share of total debits was tried first, but on a
//               large ledger it climbed to ~Rp 900M and missed big moves.
//   unreconciled  A bank or cash account not reconciled to the end of a period
//               that is already over.
function reviewChecks(tb, { prevByCode, prevLabel, curLabel, reconByCode, dateTo, periodOver, materiality, variancePct }) {
  const out = [];
  tb.forEach((r) => {
    const prev = prevByCode?.[r.code];
    if (prev) {
      const isPl = r.fs === "PL";
      const cur = isPl ? r.movement : r.closing_balance;
      const was = isPl ? prev.movement : prev.closing_balance;
      const delta = r2(cur - was);
      const pct = was ? delta / Math.abs(was) : null;
      if (Math.abs(delta) >= materiality && (pct === null || Math.abs(pct) >= variancePct)) {
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
        toLabel: `Open ${rec.kind === "bank" ? "Bank" : "Non-Bank"} Reconciliation`,
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

// Report settings (DualEntry's gear): how the report is laid out, as opposed
// to what it covers (period, comparison, dimension), which sit in the toolbar.
const GROUP_ITEMS = [
  { k: "type", lbl: "Account type" },
  { k: "coa",  lbl: "COA hierarchy" },
  { k: "none", lbl: "No grouping" },
];
function SettingsPopover({ excludeZero, onExcludeZero, group, onGroup, sort, sortItems, onSort, reviewRule, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className="lg-popover tb-settings-pop" ref={ref}>
      <div className="lg-popover-section-lbl">Report format</div>
      <label className="tb-switch-row">
        <span>Exclude zero balance</span>
        <input type="checkbox" className="tb-switch" checked={excludeZero} onChange={(e) => onExcludeZero(e.target.checked)} />
      </label>
      <div className="lg-popover-section-lbl">Group rows by</div>
      <div className="lg-popover-list">
        {GROUP_ITEMS.map((it) => (
          <button key={it.k} className={`lg-popover-item${group === it.k ? " selected" : ""}`} onClick={() => onGroup(it.k)}>
            <span>{it.lbl}</span>{group === it.k && <Check />}
          </button>
        ))}
      </div>
      <div className="lg-popover-section-lbl">Sort accounts by</div>
      <div className="lg-popover-list">
        {sortItems.map((it) => (
          <button key={it.k} className={`lg-popover-item${sort === it.k ? " selected" : ""}`} onClick={() => onSort(it.k)}>
            <span>{it.lbl}</span>{sort === it.k && <Check />}
          </button>
        ))}
      </div>
      {/* The big-move threshold is a company setting, not a view choice: say what
          it is and link to where it's changed. */}
      <div className="lg-popover-section-lbl">Needs review</div>
      <div className="tb-settings-rule">
        <span>Flags moves of {reviewRule} or more against the previous period.</span>
        <Link to="/accounting-preferences#trial-balance" onClick={onClose}>Change in Settings</Link>
      </div>
    </div>
  );
}

// The review checks on one account, anchored to its ⓘ marker. Fixed to the
// viewport so the table's sideways scroll can't clip it; opens below the
// marker, or above it near the bottom of the screen. Closes on a click
// elsewhere, Esc, scroll or resize. Each finding links to where it's fixed.
function ReviewPopover({ anchor, account, findings, glTo, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      // The marker toggles the popover itself; let its click do that.
      if (e.target.closest?.(`[data-review-code="${account.code}"]`)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    // Scrolling the page moves the marker away; scrolling the popover itself doesn't.
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [account.code, onClose]);
  const W = 340;
  const left = Math.max(12, Math.min(anchor.left - 12, window.innerWidth - W - 12));
  const below = anchor.bottom < window.innerHeight * 0.6;
  const style = below
    ? { position: "fixed", left, right: "auto", width: W, top: anchor.bottom + 6, bottom: "auto" }
    : { position: "fixed", left, right: "auto", width: W, top: "auto", bottom: window.innerHeight - anchor.top + 6 };
  return (
    <div className="lg-popover tb-review-pop" ref={ref} style={style} role="dialog" aria-label={`Review checks on ${account.name}`}>
      <div className="tb-review-head">
        <span className="tb-review-code">{account.code}</span>
        <span className="tb-review-name">{account.name}</span>
      </div>
      {findings.map((f, i) => (
        <div key={i} className="tb-review-item">
          <div className="tb-review-title">{f.title}</div>
          <div className="tb-review-desc">{f.desc}</div>
          <div className="tb-review-next"><strong>Next step:</strong> {f.action}</div>
          <Link className="tb-review-link" to={f.to || glTo} onClick={onClose}>
            {f.to ? f.toLabel : "Open in General Ledger"} {GL_ICON}
          </Link>
        </div>
      ))}
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
  const { fiscalYearStart, varianceThreshold } = useAccountingSettings();
  const { user } = useCurrentUser();
  const { closedThrough } = useClosePeriod();
  const { resolutions } = useBankRecon();
  const { records: nonBankRecords } = useNonBankRecon();
  const { valuesOf } = useDimensions();

  const [search, setSearch] = useState("");
  // The Needs review toggle narrows the table to flagged accounts.
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sortChoice, setSortChoice] = useState(null);
  const [groupChoice, setGroupChoice] = useState(null);
  // { key } for a preset, or { key: "custom", from, to }.
  const [periodChoice, setPeriodChoice] = useState(DEFAULT_PERIOD);
  const [showZero, setShowZero] = useState(false);
  const [compare, setCompare] = useState("none");
  const [adjMode, setAdjMode] = useState("included"); // included | excluded | columns
  const [dim, setDim] = useState(null); // { key, value }
  // A row the user clicked to keep their place across the columns.
  const [focusCode, setFocusCode] = useState(null);
  // The account whose review popover is open, and where its marker sits.
  const [reviewPop, setReviewPop] = useState(null); // { code, anchor: { left, top, bottom } }
  const closeReview = useCallback(() => setReviewPop(null), []);


  const [openPop, setOpenPop] = useState(null); // settings | period | export | compare | dim | views
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
    if (compare === "prev_year") return { from: sameDayLastYear(dateFrom), to: sameDayLastYear(dateTo) };
    return null;
  }, [compare, prevRange, dateFrom, dateTo]);
  const compLabel = compRange ? rangeLabel(compRange.from, compRange.to) : "";
  // A comparison lays ending balances side by side, with every posted journal
  // in them; the adjustments choice applies when not comparing.
  const adjEff = compRange ? "included" : adjMode;
  const layout = compRange ? "compare" : adjEff === "columns" ? "worksheet" : "six";
  const adjNote = { included: "Adjusted (adjusting journals included)", excluded: "Unadjusted (adjusting journals left out)", columns: "Unadjusted · Adjustments · Adjusted" }[adjEff];
  const cols = useMemo(() => columnsFor(layout, compLabel, periodRange), [layout, compLabel, periodRange]);
  const spans = useMemo(() => superSpans(cols), [cols]);
  // Excel and CSV export exactly what's on screen.
  const exportCols = cols;
  const exportSpans = spans;

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
  // With adjustments excluded, every row reads as it stood before them.
  const ALL_TB = useMemo(() => {
    if (!COMP_TB) return adjEff === "excluded" ? CUR_TB.map(unadjustedRow) : CUR_TB;
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
  }, [CUR_TB, COMP_TB, adjEff]);
  // Adjusting journals posted and dated in the period, for the Adjustments menu.
  const adjustingCount = useMemo(
    () => JOURNAL_ENTRIES.filter((je) => je.is_adjusting && je.status === "posted" && je.je_date >= dateFrom && je.je_date <= dateTo).length,
    [JOURNAL_ENTRIES, dateFrom, dateTo],
  );

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
  // The company's own variance thresholds (Settings → Accounting Preferences).
  const variancePct = varianceThreshold.pct;
  const materiality = varianceThreshold.amount;
  const findings = useMemo(
    () => reviewChecks(CUR_TB, { prevByCode, prevLabel, curLabel: periodRange, reconByCode: dim ? null : reconByCode, dateTo, periodOver, materiality, variancePct }),
    [CUR_TB, prevByCode, prevLabel, periodRange, reconByCode, dim, dateTo, periodOver, materiality, variancePct],
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

  // Does the ledger foot? Debits = credits plus the tie-out checks (opening,
  // period and ending foot; ties to P&L), shown as one line in the status bar.
  const tiesOff = ties.filter((t) => !t.ok);
  const tiesTitle = ties.map((t) => `${t.ok ? "✓" : "✕"} ${t.label}${t.ok ? "" : ` — off by ${rp(t.diff)}`}`).join("\n");
  const footsOk = balance.balanced && tiesOff.length === 0;
  const footText = !balance.balanced
    ? `Out of balance by ${rp(balance.variance)}`
    : tiesOff.length
      ? `${tiesOff[0].label}: off by ${rp(tiesOff[0].diff)}${tiesOff.length > 1 ? ` · +${tiesOff.length - 1} more` : ""}`
      : "In balance";

  // Zero-balance accounts (no opening, no movement, no closing) are hidden
  // unless asked for. A flagged account stays visible in the review filter
  // even if it would otherwise be hidden as zero.
  const corpus = useMemo(() => {
    if (reviewOnly) {
      const codes = new Set(findings.map((f) => f.code));
      return ALL_TB.filter((r) => codes.has(r.code));
    }
    return showZero ? ALL_TB : ALL_TB.filter((r) => r.has_activity);
  }, [reviewOnly, findings, showZero, ALL_TB]);

  const viewState = { periodChoice, compare, adjMode, groupChoice, sortChoice, showZero, dim };
  const viewSig = JSON.stringify(viewState);
  const activeViewId = views.find((v) => JSON.stringify(v.state) === viewSig)?.id || null;

  const hasActiveFilters = (
    periodChoice.key !== DEFAULT_PERIOD.key ||
    showZero || compare !== "none" || adjMode !== "included" || dim || reviewOnly ||
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

  // Totals of exactly the rows on screen (review filter, search, zero toggle applied).
  const shownTotals = useMemo(() => sumCols(sortedRows, cols, { grand: true }), [sortedRows, cols]);
  const exportTotals = useMemo(() => sumCols(sortedRows, exportCols, { grand: true }), [sortedRows, exportCols]);
  // The footer's totals: debit and credit balances at period end for the rows
  // on screen — the classic TB footing. The table's net Ending column sums to
  // zero when it foots, so the amounts themselves are shown here.
  const footTotals = useMemo(() => {
    let dr = 0, cr = 0;
    sortedRows.forEach((r) => { dr += r.ending_dr; cr += r.ending_cr; });
    return { dr: r2(dr), cr: r2(cr), diff: r2(dr - cr) };
  }, [sortedRows]);
  // Search, the review filter or a dimension leave out accounts, so the shown
  // totals needn't balance and the footer says so instead of flagging it.
  const partialView = !!(search.trim() || reviewOnly || dim);

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
  // Expand one level / Collapse one level (DualEntry's tree controls) over the
  // group tree. Expanding opens the shallowest closed level on screen;
  // collapsing closes the deepest open level. A trial balance stops at the
  // account: journal lines are the General Ledger's job.
  const levelNodes = useMemo(() => {
    const out = [];
    const walk = (n, parent) => {
      const me = { id: n.id, parent, depth: parent ? parent.depth + 1 : 0 };
      out.push(me);
      n.groups.forEach((g) => walk(g, me));
    };
    (tree || []).forEach((n) => walk(n, null));
    return out;
  }, [tree]);
  const isOpen = (n) => !collapsedGroups.has(n.id);
  const isShown = (n) => { for (let p = n.parent; p; p = p.parent) if (!isOpen(p)) return false; return true; };
  const closedShown = levelNodes.filter((n) => isShown(n) && !isOpen(n));
  const openShown = levelNodes.filter((n) => isShown(n) && isOpen(n));
  const expandDepth = Math.min(...closedShown.map((n) => n.depth));
  const collapseDepth = Math.max(...openShown.map((n) => n.depth));
  const toExpand = closedShown.filter((n) => n.depth === expandDepth);
  const toCollapse = openShown.filter((n) => n.depth === collapseDepth);
  function setLevel(nodes, open) {
    setCollapsedGroups((prev) => {
      const s = new Set(prev);
      nodes.forEach((n) => (open ? s.delete(n.id) : s.add(n.id)));
      return s;
    });
  }

  function resetAll() {
    setSortChoice(null);
    setGroupChoice(null);
    setPeriodChoice(DEFAULT_PERIOD);
    setShowZero(false);
    setCompare("none");
    setAdjMode("included");
    setDim(null);
    setSearch("");
    setReviewOnly(false);
  }

  function applyView(v) {
    const s = v.state;
    setPeriodChoice(s.periodChoice || DEFAULT_PERIOD);
    setCompare(s.compare || "none");
    setAdjMode(s.adjMode || "included");
    setGroupChoice(s.groupChoice ?? null);
    setSortChoice(s.sortChoice ?? null);
    setShowZero(!!s.showZero);
    setDim(s.dim || null);
    setReviewOnly(false);
    closePop();
    showToast(`View “${v.name}” applied`);
  }
  function saveView(name) {
    const existing = views.find((v) => v.name.toLowerCase() === name.toLowerCase());
    const saved = { id: existing?.id || `v${Date.now()}`, name, state: viewState };
    persistViews(existing ? views.map((v) => (v.id === existing.id ? saved : v)) : [...views, saved]);
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

  // The General Ledger for the same account and the same dates: one calendar
  // month goes as that month, any other range as a custom from–to.
  const isWholeMonth = dateFrom.slice(0, 7) === periodEndYm && dateFrom.endsWith("-01") && dateTo === monthEndOf(periodEndYm);
  const glPeriodQs = isWholeMonth ? `period=${periodEndYm}` : `period=custom&from=${dateFrom}&to=${dateTo}`;
  const glUrl = (code) => `/reports/general-ledger?account=${encodeURIComponent(code)}&${glPeriodQs}`;


  // ── Export ──
  const dimLabel = dim ? `${DIM_BY_KEY[dim.key]?.label || dim.key}: ${dim.value}` : null;
  const colTitle = (c) => (c.sup ? `${c.sup} ${c.label}` : c.label);
  const viewNote = [
    compRange ? `Compared with ${compLabel}` : adjNote,
    `Grouped by ${GROUP_LABELS[effectiveGroup] === "—" ? "nothing" : GROUP_LABELS[effectiveGroup]}`,
    dimLabel ? `Filtered to ${dimLabel}` : null,
  ].filter(Boolean).join(" · ");

  function exportCsv() {
    closePop();
    const totalRow = { code: "", name: `Total — ${plural(sortedRows.length, "account")}`, type: null, ...exportTotals, change_pct: null };
    downloadCsv(exportName("trial-balance", dateFrom, dateTo), {
      header: [...reportHeader({ report: "Trial Balance", period: periodRange, runBy: user?.name }), [viewNote]],
      columns: [
        { label: "Code",    value: (r) => r.code },
        { label: "Account", value: (r) => r.name },
        { label: "Type",    value: (r) => TYPE_NAMES[r.type] || "" },
        ...exportCols.map((c) => ({ label: colTitle(c), value: (r) => (c.pct ? (r[c.key] == null ? null : r2(r[c.key] * 100)) : r[c.key]) })),
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
    if (exportSpans) {
      const sup = [{ v: "", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }];
      exportSpans.forEach((sp) => { sup.push({ v: sp.label, s: "headNum" }); for (let i = 1; i < sp.span; i++) sup.push({ v: "", s: "head" }); });
      rows.push(sup);
    }
    rows.push([{ v: "Code", s: "head" }, { v: "Account", s: "head" }, { v: "Type", s: "head" }, ...exportCols.map((c) => ({ v: c.label, s: "headNum" }))]);
    const freeze = rows.length;
    const bodyStart = rows.length + 1;

    const accountRow = (r, depth) => [
      r.code,
      `${"   ".repeat(depth)}${r.name}`,
      TYPE_NAMES[r.type] || "",
      ...exportCols.map((c) => {
        const v = r[c.key];
        if (c.pct) return v == null ? null : { v: r2(v * 100), s: "num" };
        return v ? { v, s: "num" } : null;
      }),
    ];
    const totalRow = (label, from, to, vals, fn = "SUBTOTAL(9,") => [
      "", { v: label, s: "bold" }, "",
      // Change nets on the group's side (see sumCols), which no SUM reproduces: written as a value.
      ...exportCols.map((c, ci) => {
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
      rows.push(totalRow(`${"   ".repeat(depth)}Total ${node.label}`, start, rows.length, sumCols(nodeRows(node), exportCols)));
    };
    if (tree) tree.forEach((n) => walk(n, 0));
    else sortedRows.forEach((r) => rows.push(accountRow(r, 0)));
    const bodyEnd = rows.length;
    rows.push(totalRow(`Total — ${plural(sortedRows.length, "account")}`, bodyStart, bodyEnd, exportTotals));
    const totalAt = rows.length;
    // Footing line under the two ending columns (six / compare layouts).
    const drIdx = exportCols.findIndex((c) => c.key === "ending_dr");
    if (drIdx >= 0 && !dim) {
      const line = ["", { v: "Difference (Ending Dr − Cr)", s: "muted" }, ""];
      exportCols.forEach((c, ci) => line.push(ci === drIdx ? { f: `${L(ci)}${totalAt}-${L(ci + 1)}${totalAt}`, v: r2(exportTotals.ending_dr - exportTotals.ending_cr), s: "num" } : null));
      rows.push(line);
    }
    rows.push([], []);
    rows.push(["", { v: "Prepared by", s: "bold" }, "", { v: "Reviewed by", s: "bold" }, "", { v: "Approved by", s: "bold" }]);
    rows.push([], ["", user?.name || "Name", "", "Name", "", "Name"], ["", { v: "Date:", s: "muted" }, "", { v: "Date:", s: "muted" }, "", { v: "Date:", s: "muted" }]);

    downloadXlsx(exportName("trial-balance", dateFrom, dateTo).replace(/\.csv$/, ".xlsx"), {
      sheet: "Trial Balance",
      rows,
      widths: [10, 46, 14, ...exportCols.map(() => 18)],
      freeze,
    });
    showToast(`${plural(sortedRows.length, "account")} exported to Excel`);
  }
  function exportPrint() {
    closePop();
    // Let the menu close before the print dialog snapshots the page.
    setTimeout(printReport, 50);
  }

  const cellView = (c, r) => {
    const v = r[c.key];
    if (c.pct) return v == null ? (r.change ? <span className="tb-cell-new">New</span> : <span className="lg-cell-em-dash">—</span>) : pctText(v);
    if (!v) return <span className="lg-cell-em-dash">—</span>;
    return amt(v);
  };
  const cellCls = (c) => `lg-cell-total${c.strong ? " tb-cell-end" : ""}${c.muted ? " tb-cell-muted" : ""}`;
  const gridStyle = { "--tb-n": cols.length };
  const INDENT = 18;

  // A flagged account gets one small marker; clicking it opens the review
  // popover with what was flagged, why, and where to fix it.
  const ReviewFlag = ({ r }) => {
    const flags = findingsByCode[r.code] || [];
    if (!flags.length) return null;
    const open = reviewPop?.code === r.code;
    return (
      <button type="button" className={`tb-flag no-print${open ? " on" : ""}`} data-review-code={r.code}
        aria-label={`${plural(flags.length, "review check")} on ${r.name}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          const { left, top, bottom } = e.currentTarget.getBoundingClientRect();
          setReviewPop((p) => (p?.code === r.code ? null : { code: r.code, anchor: { left, top, bottom } }));
        }}>
        {REVIEW_ICON}
      </button>
    );
  };
  const Chevron = ({ closed }) => <svg className={`lg-group-chevron${closed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>;

  // An account row: code, name, numbers. The account name is the link to the
  // General Ledger for the same dates (as in QuickBooks, Xero, DualEntry), with
  // an explicit "General Ledger" button on hover or keyboard focus. Clicking
  // elsewhere only highlights the row, so selecting an amount to copy it
  // never navigates away.
  function TbRow({ r, isAlt, depth = 0 }) {
    const onRowClick = () => {
      if (window.getSelection?.().toString()) return; // the user is selecting text
      setFocusCode((c) => (c === r.code ? null : r.code));
    };
    return (
      <div className={`lg-row tb-acct-row${isAlt ? " alt" : ""}${focusCode === r.code || reviewPop?.code === r.code ? " selected" : ""}`} onClick={onRowClick}>
        <div className="tb-cell-name" style={{ paddingLeft: (depth + 1) * INDENT }}>
          <span className="tb-code">{r.code}</span>
          <Link className="tb-name tb-acct-link" to={glUrl(r.code)} title={`Open ${r.name} in the General Ledger`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
          <ReviewFlag r={r} />
          <Link className="tb-gl-btn no-print" to={glUrl(r.code)} onClick={(e) => e.stopPropagation()} aria-label={`Open ${r.code} ${r.name} in the General Ledger`}>
            General Ledger {GL_ICON}
          </Link>
        </div>
        {cols.map((c) => <div key={c.key} className={cellCls(c)}>{cellView(c, r)}</div>)}
      </div>
    );
  }


  // Subtotals and the grand total; a zero total reads "—", like a zero row.
  function TotalRow({ label, totals, depth = 0, className = "" }) {
    return (
      <div className={`lg-row subtotal ${className}`}>
        <div className="tb-total-lbl" style={{ paddingLeft: depth * INDENT }}>{label}</div>
        {cols.map((c) => (
          <div key={c.key} className={cellCls(c)}>
            {c.sum && totals[c.key] != null ? (totals[c.key] ? amt(totals[c.key]) : <span className="lg-cell-em-dash">—</span>) : ""}
          </div>
        ))}
      </div>
    );
  }

  // A group is one row when collapsed — its heading carries the subtotal on the
  // same line. Expanded, the heading is just a label and a "Total …" row closes
  // the group under its last account.
  function GroupNode({ node, depth }) {
    const collapsed = collapsedGroups.has(node.id);
    const rows = nodeRows(node);
    const totals = sumCols(rows, cols);
    const indent = effectiveGroup === "coa" ? depth : 0;
    return (
      <Fragment>
        <div className={`lg-row tb-group-row${depth ? " tb-subgroup" : ""}${collapsed ? " collapsed" : ""}`}
          onClick={() => toggleGroup(node.id)} aria-expanded={!collapsed} title={collapsed ? "Expand" : "Collapse"}>
          <div className="tb-group-name" style={{ paddingLeft: indent * INDENT }}>
            <Chevron closed={collapsed} />
            <span className="lg-group-lbl">{node.label}</span>
          </div>
          {cols.map((c) => (
            <div key={c.key} className={cellCls(c)}>
              {collapsed && c.sum && totals[c.key] != null ? (totals[c.key] ? amt(totals[c.key]) : <span className="lg-cell-em-dash">—</span>) : ""}
            </div>
          ))}
        </div>
        {!collapsed && node.rows.map((r, i) => <TbRow key={r.code} r={r} isAlt={i % 2 === 1} depth={effectiveGroup === "coa" ? depth + 1 : 0} />)}
        {!collapsed && node.groups.map((g) => <GroupNode key={g.id} node={g} depth={depth + 1} />)}
        {!collapsed && <TotalRow label={`Total ${node.label}`} totals={totals} depth={indent} />}
      </Fragment>
    );
  }

  const closedLabel = closedThrough ? monthLabel(`${closedThrough}-01`) : null;
  const unpostedParts = [
    unposted.drafts ? plural(unposted.drafts, "draft") : null,
    unposted.pending ? plural(unposted.pending, "journal awaiting approval", "journals awaiting approval") : null,
  ].filter(Boolean);

  const adjItems = [
    { k: "included", lbl: "Included", hint: "adjusted trial balance" },
    { k: "excluded", lbl: "Excluded", hint: "unadjusted trial balance" },
    { k: "columns", lbl: "As columns", hint: "Unadjusted · Adjustments · Adjusted" },
  ];
  const compareItems = [
    { k: "none", lbl: "No comparison" },
    { k: "prev", lbl: "Previous period", hint: rangeLabel(prevRange.from, prevRange.to) },
    { k: "prev_year", lbl: "Same period last year", hint: rangeLabel(sameDayLastYear(dateFrom), sameDayLastYear(dateTo)) },
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
            {periodRange}{compRange ? ` compared with ${compLabel}` : ` · ${adjNote}`} · {dim ? `Filtered to ${dimLabel}` : balance.balanced ? "In balance" : `Out of balance by ${rp(balance.variance)}`} · Amounts in IDR
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
                {openPop === "views" && <ViewsPopover views={views} activeId={activeViewId} onApply={applyView} onDelete={deleteView} onSave={saveView} onClose={closePop}
                  emptyText="No saved views yet. Set the period, columns, grouping and filters the way you like, then save them here." />}
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

          {/* Period status — closed or open, what isn't posted yet, and whether the ledger foots */}
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
            <span className="tb-status-sep">·</span>
            {dim ? (
              <span className="tb-foot">Balance not checked while filtered</span>
            ) : (
              <span className={`tb-foot ${footsOk ? "ok" : "off"}`} title={tiesTitle}>
                <span aria-hidden="true">{footsOk ? "✓" : "✕"}</span> {footText}
              </span>
            )}
            <span className="tb-status-sep">·</span>
            <span className="tb-unit-note">Amounts in IDR</span>
          </div>

          {dim && (
            <div className="tb-status tb-dim-note">
              <span className="tb-status-chip open">Filtered</span>
              <span>Showing only journal lines tagged <strong>{dimLabel}</strong>. Opening balances and untagged lines are left out, so these totals needn't balance.</span>
              <button className="tb-status-link no-print" onClick={() => setDim(null)}>Clear filter</button>
            </div>
          )}
        </div>

        {/* ── Report card: the toolbar says what the report covers ── */}
        <div className="lg-table-wrap">
          <div className="lg-card lg-table-tb" style={gridStyle}>

            <div className="lg-filter-row no-print tb-filter-row">
              <div className="tb-toolbar-left">
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn tb-period-btn" onClick={() => togglePop("period")} aria-haspopup="dialog" aria-expanded={openPop === "period"}>
                    <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span className="meta-val">{period.label}</span>
                    <span className="meta-lbl">{periodRange}</span>
                  </button>
                  {openPop === "period" && <PeriodPopover presets={presets} period={period} onPick={(c) => { setPeriodChoice(c); closePop(); }} onClose={closePop} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${compRange ? " active" : ""}`} onClick={() => togglePop("compare")} aria-haspopup="menu" aria-expanded={openPop === "compare"}>
                    <span className="meta-lbl">Compare:</span>
                    <span className="meta-val">{compRange ? compLabel : "None"}</span>
                  </button>
                  {openPop === "compare" && (
                    <ChoicePopover className="tb-compare-pop" items={compareItems} value={compare}
                      onPick={(k) => { setCompare(k); if (k === "none" && sortChoice === "change-desc") setSortChoice(null); closePop(); }} onClose={closePop} />
                  )}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${adjEff !== "included" ? " active" : ""}`} onClick={() => togglePop("adj")} disabled={!!compRange}
                    title={compRange ? "A comparison includes every posted journal. Turn Compare off to leave adjustments out or show them as columns." : `${plural(adjustingCount, "adjusting journal")} dated in this period`}
                    aria-haspopup="menu" aria-expanded={openPop === "adj"}>
                    <span className="meta-lbl">Adjustments:</span>
                    <span className="meta-val">{ADJ_LABELS[adjEff]}</span>
                    {adjustingCount > 0 && <span className="tb-adj-count">{adjustingCount}</span>}
                  </button>
                  {openPop === "adj" && (
                    <ChoicePopover className="tb-adj-pop" items={adjItems} value={adjMode} note={ADJ_NOTE}
                      onPick={(k) => { setAdjMode(k); closePop(); }} onClose={closePop} />
                  )}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${dim ? " active" : ""}`} onClick={() => togglePop("dim")}>
                    <span className="meta-lbl">Dimension:</span>
                    <span className="meta-val">{dimLabel || "All"}</span>
                  </button>
                  {openPop === "dim" && <DimensionPopover value={dim} valuesOf={valuesOf} onApply={(v) => { setDim(v); closePop(); }} onClose={closePop}
                    note="Shows only journal lines tagged with this value. Opening balances and untagged lines are left out, so a filtered trial balance needn't balance." />}
                </div>
                <div className="lg-search">
                  <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                  <input placeholder="Search account code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="lg-filter-meta">
                <button className={`lg-toggle${reviewOnly ? " on" : ""}`} onClick={() => setReviewOnly((v) => !v)} aria-pressed={reviewOnly} disabled={flaggedCount === 0 && !reviewOnly}
                  title={`Moves of ${Math.round(variancePct * 100)}% and ${rp(materiality)} or more against ${prevLabel} (Settings › General Settings › Preferences), and bank or cash accounts not reconciled to the end of a finished period.`}>
                  Needs review <span className="tb-toggle-count">{flaggedCount}</span>
                </button>
                {tree && (
                <>
                <span className="tb-tool-sep" aria-hidden="true" />
                <button className="tb-icon-btn" onClick={() => setLevel(toCollapse, false)} disabled={!toCollapse.length} title="Collapse one level" aria-label="Collapse one level">
                  <svg viewBox="0 0 24 24"><polyline points="7 15 12 10 17 15"/><line x1="5" y1="20" x2="19" y2="20"/></svg>
                </button>
                <button className="tb-icon-btn" onClick={() => setLevel(toExpand, true)} disabled={!toExpand.length} title="Expand one level" aria-label="Expand one level">
                  <svg viewBox="0 0 24 24"><polyline points="7 9 12 14 17 9"/><line x1="5" y1="4" x2="19" y2="4"/></svg>
                </button>
                </>
                )}
                <div className="lg-meta-btn-wrap">
                  <button className={`tb-icon-btn${openPop === "settings" ? " on" : ""}`} onClick={() => togglePop("settings")} title="Report settings" aria-label="Open report settings" aria-haspopup="dialog" aria-expanded={openPop === "settings"}>
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                  </button>
                  {openPop === "settings" && (
                    <SettingsPopover
                      excludeZero={!showZero} onExcludeZero={(v) => setShowZero(!v)}
                      group={effectiveGroup} onGroup={(v) => { setGroupChoice(v); setCollapsedGroups(new Set()); }}
                      sort={effectiveSort} sortItems={sortItems} onSort={setSortChoice}
                      reviewRule={`${Math.round(variancePct * 100)}% and ${rp(materiality)}`}
                      onClose={closePop} />
                  )}
                </div>
                {hasActiveFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            <div className="lg-col-header tb-col-super" aria-hidden="true">
              <div />
              {spans.map((sp, i) => <div key={i} style={{ gridColumn: `span ${sp.span}` }}>{sp.label}</div>)}
            </div>
            <div className="lg-col-header">
              <div>Account</div>
              {cols.map((c) => <div key={c.key} style={{ textAlign: "right" }} title={c.title}>{c.label}</div>)}
            </div>

            <div>
              {sortedRows.length === 0 && (
                <div className="lg-empty">
                  {!showZero && search.trim() === "" && !reviewOnly ? "No accounts with a balance here. Turn off “Exclude zero balance” in Report settings to see them all." : "No accounts match."}
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
        </div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Total debit balances</span>
          <span className="lg-footer-total">{rp(footTotals.dr)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Total credit balances</span>
          <span className="lg-footer-total">{rp(footTotals.cr)}</span>
          <span className="lg-footer-sep">·</span>
          {partialView ? (
            <span className="tb-balance-flag" title="Search, Needs review or a dimension filter leaves accounts out, so these totals needn't balance.">Filtered — not checked</span>
          ) : (
            <span className={`tb-balance-flag ${footTotals.diff === 0 ? "ok" : "off"}`}>
              {footTotals.diff === 0 ? "✓ In balance" : `Off by ${rp(Math.abs(footTotals.diff))}`}
            </span>
          )}
        </div>
      </div>

      {reviewPop && findingsByCode[reviewPop.code] && (
        <ReviewPopover anchor={reviewPop.anchor} account={ALL_TB.find((r) => r.code === reviewPop.code)}
          findings={findingsByCode[reviewPop.code]} glTo={glUrl(reviewPop.code)} onClose={closeReview} />
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
