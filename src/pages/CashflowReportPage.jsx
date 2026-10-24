import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { useInvoices } from "../state/InvoicesContext";
import { usePayments } from "../state/PaymentsContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useBankRecon } from "../state/BankReconContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { formatRupiah, formatDateEn } from "../lib/format";
import { todayIso, recentMonthEnds } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { buildAgingLines, buildSnapshot, buildVendorPivot, isAgingTableRow, AGE_BUCKETS } from "../lib/apAging";
import { buildArAgingLines, buildCustomerPivot, buildArSnapshot } from "../lib/arAging";
import { buildCashPosition } from "../lib/cashPosition";
import { accountBalanceAsOf } from "../lib/trialBalance";
import { reconciledThrough } from "../lib/bankRecon";
import { COA_BY_CODE } from "../data/seed/coa";
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";
import ApAgingTable from "../components/ApAgingTable";
import ArAgingTable from "../components/ArAgingTable";
import "./modules.css";
import "./cashflow-report.css";

const AGE_COLOR = { current: "#2E7D44", b1_30: "#C99A2E", b31_60: "#B8770F", b61_90: "#A8620C", b91_120: "#A32D2D", b_gt120: "#8C2420" };

// The general-ledger control account each aging must agree with: the default
// AR and AP accounts (seed/defaultAccounts.js).
const CONTROL = DEFAULT_ACCOUNTS;

const TABS = [
  { k: "insights", lbl: "Overview",  report: "Cash position" },
  { k: "ap",       lbl: "AP Aging",  report: "AP aging" },
  { k: "ar",       lbl: "AR Aging",  report: "AR aging" },
];
const VIEWS = [
  { k: "summary", lbl: "Summary" },
  { k: "detail",  lbl: "Detail" },
];

// The month-end check: does the aging total agree with its control account in
// the general ledger? Invoices and bills post to these accounts and nothing
// else does, so a difference means a document reached one side and not the
// other. The account opens in the General Ledger for the as-of month.
function LedgerTie({ aging, ledger, code, asOf }) {
  const navigate = useNavigate();
  const diff = Math.round(aging - ledger);
  const name = COA_BY_CODE[code]?.name || code;
  return (
    <div className={`cfr-tie ${diff === 0 ? "ok" : "off"}`}>
      <span className="cfr-tie-mark" aria-hidden>{diff === 0 ? "✓" : "!"}</span>
      <span className="cfr-tie-state">{diff === 0 ? "Ties to ledger" : `Differs from ledger by ${formatRupiah(Math.abs(diff))}`}</span>
      <button type="button" className="cfr-tie-link" onClick={() => navigate(`/general-ledger?account=${code}&period=${asOf.slice(0, 7)}`)}>
        {code} {name}{diff !== 0 ? ` · ${formatRupiah(ledger)}` : ""}
      </button>
    </div>
  );
}

// A horizontal age-bucket bar + legend, shared by the AP and AR summary blocks
// on the Overview dashboard.
function AgingBars({ label, total, buckets, note, tie, onOpen }) {
  return (
    <div className="cfr-side">
      <div className="cfr-side-head">
        <span className="cfr-side-lbl">{label}</span>
        <span className="cfr-side-total">{formatRupiah(total)}</span>
      </div>
      {tie}
      <div className="cfr-bar">
        {AGE_BUCKETS.map((b) => (
          <span key={b.key} style={{ flexGrow: buckets[b.key] || 0, minWidth: buckets[b.key] > 0 ? 4 : 0, background: AGE_COLOR[b.key] }} title={b.lbl} />
        ))}
      </div>
      <div className="cfr-legend">
        {AGE_BUCKETS.map((b) => (
          <div key={b.key} className="cfr-legend-row">
            <span className="cfr-legend-lbl"><i style={{ background: AGE_COLOR[b.key] }} />{b.lbl}</span>
            <span className="cfr-legend-amt">{formatRupiah(buckets[b.key])}</span>
          </div>
        ))}
      </div>
      {note && <div className="cfr-side-note">{note}</div>}
      <button type="button" className="cfr-side-open no-print" onClick={onOpen}>Open full table →</button>
    </div>
  );
}

// Overdue + due within 30 days of the as-of date — what is realistically
// coming in / going out next.
const dueWithin30 = (lines) => lines.reduce((s, l) => s + (l.daysOverdue >= -30 ? l.remaining : 0), 0);

// Everything the Overview tab shows, as of one date. Shared by the tab and the
// page's CSV export so the two can't disagree.
function useOverview(asOf, paymentHistory) {
  const { bills } = useBills();
  const { invoices } = useInvoices();
  const { entries } = useJournalEntries();
  const { resolutions } = useBankRecon();

  return useMemo(() => {
    const cash = buildCashPosition(asOf, { extraPayments: paymentHistory });

    const apLines = buildAgingLines(asOf, bills, { paymentHistory });
    const apSnap = buildSnapshot(apLines, asOf);
    // AP outstanding = posted bills only, the same scope as the AP Aging
    // table's Total column. Accruals are reported beside it, never inside it.
    const apOpen = apLines.filter((l) => isAgingTableRow(l) && !l.is_accrual);
    const apTop = buildVendorPivot(apOpen)
      .map((r) => ({ id: r.vendorId, name: r.vendorName, overdue: r.total - r.buckets.current }))
      .filter((r) => r.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 5);

    const arLines = buildArAgingLines(asOf, invoices);
    const arSnap = buildArSnapshot(arLines, asOf);
    const arTop = buildCustomerPivot(arLines)
      .map((r) => ({ id: r.customerId, name: r.customerName, overdue: r.total - r.buckets.current }))
      .filter((r) => r.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 5);

    const ap = { snapshot: apSnap, topOverdue: apTop, due30: dueWithin30(apOpen), ledger: accountBalanceAsOf(CONTROL.ap, asOf, entries) };
    const ar = { snapshot: arSnap, topOverdue: arTop, due30: dueWithin30(arLines.filter((l) => l.remaining > 0)), ledger: accountBalanceAsOf(CONTROL.ar, asOf, entries) };
    // How far each bank account's book balance has been agreed to the bank.
    const reconciled = {};
    for (const a of cash.accounts) reconciled[a.id] = reconciledThrough(a.id, resolutions);
    return {
      cash, ap, ar, reconciled,
      // Available cash, plus what customers owe that falls due within 30 days,
      // less what we owe in the same window. Overdue items on both sides count:
      // they are due now.
      cash30: cash.available.total + ar.due30 - ap.due30,
    };
  }, [asOf, paymentHistory, bills, invoices, entries, resolutions]);
}

// Cash on hand — the book balance of every company bank and cash account on
// the as-of date. Deposits, restricted and tax accounts are listed apart as
// not available to spend.
const reconLabel = (r) => (!r || !r.inScope ? "Not reconciled here" : r.through ? formatDateEn(r.through) : "Not yet");

function CashOnHand({ cash, asOf, reconciled }) {
  const hasFallback = cash.accounts.some((a) => a.source === "opening");
  const hasFx = cash.accounts.some((a) => a.currency !== "IDR");
  const Row = ({ a }) => (
    <div className="cfr-cash-row">
      <div className="cfr-cash-acct">
        <i style={{ background: a.bankColor }} />
        <span className="cfr-cash-name">{a.name}{a.source === "opening" && <sup title="Opening balance — no ledger account linked">*</sup>}</span>
        <span className="cfr-cash-meta">{a.bank}{a.mask ? ` ${a.mask}` : ""}{a.currency !== "IDR" ? ` · ${a.currency}, IDR equiv.` : ""}</span>
      </div>
      <div className="cfr-cash-group">{a.available ? a.groupLabel : a.reason}</div>
      <div className={`cfr-cash-rec${reconciled[a.id]?.through ? "" : " muted"}`}>{reconLabel(reconciled[a.id])}</div>
      <div className="cfr-cash-amt">{formatRupiah(a.balance)}</div>
    </div>
  );
  return (
    <section className="cfr-cash">
      <div className="cfr-side-head">
        <span className="cfr-side-lbl">Cash on hand · {formatDateEn(asOf)}</span>
        <span className="cfr-side-total">{formatRupiah(cash.available.total)} <em>available</em></span>
      </div>
      <div className="cfr-cash-cols"><div>Account</div><div>Type</div><div>Reconciled through</div><div>Book balance</div></div>
      {cash.available.accounts.map((a) => <Row key={a.id} a={a} />)}
      <div className="cfr-cash-sub">
        <span>Available cash · {cash.available.accounts.length} account{cash.available.accounts.length === 1 ? "" : "s"}</span>
        <span>{formatRupiah(cash.available.total)}</span>
      </div>
      {cash.unavailable.accounts.length > 0 && (
        <>
          <div className="cfr-cash-sec">Not available to spend</div>
          {cash.unavailable.accounts.map((a) => <Row key={a.id} a={a} />)}
          <div className="cfr-cash-sub muted">
            <span>Not available · deposits, restricted &amp; tax</span>
            <span>{formatRupiah(cash.unavailable.total)}</span>
          </div>
        </>
      )}
      <div className="cfr-cash-foot">
        Book balances: opening balance plus cash movements recorded in Klay up to the date — not the bank's figure.
        Reconciled through is the last day Bank Reconciliation has agreed the account to its statement.
        {hasFx && " Foreign-currency accounts are shown at their IDR book value."}
        {hasFallback && " * No ledger account is linked to this account, so only its opening balance is shown."}
      </div>
    </section>
  );
}

// The Overview tab — cash on hand, the four figures (available cash, AR, AP,
// cash in 30 days), then AP and AR side by side with each total checked
// against its ledger control account, and the largest overdue counterparties.
function AgingInsights({ data, asOf, onGoTo }) {
  const navigate = useNavigate();
  const { cash, ap, ar, cash30, reconciled } = data;
  const accrued = ap.snapshot.accruedLiabilities;
  const nAvail = cash.available.accounts.length;

  const KPIS = [
    { lbl: "Available cash", val: formatRupiah(cash.available.total), sub: `${nAvail} account${nAvail === 1 ? "" : "s"}${cash.unavailable.total ? ` · excl. ${formatRupiah(cash.unavailable.total)} not available` : ""}`, tone: "neutral" },
    { lbl: "AR outstanding", val: formatRupiah(ar.snapshot.arOutstanding), sub: `Avg. age (weighted) ${ar.snapshot.dsoDays}d · overdue ${formatRupiah(ar.snapshot.overdue)}`, tone: "recv" },
    { lbl: "AP outstanding", val: formatRupiah(ap.snapshot.apOutstanding), sub: `Avg. age (weighted) ${ap.snapshot.dpoDays}d${accrued ? ` · excl. ${formatRupiah(accrued)} accrued` : ""}`, tone: "pay" },
    { lbl: "Cash in 30 days", val: (cash30 < 0 ? "− " : "") + formatRupiah(Math.abs(cash30)), sub: `Available + in ${formatRupiah(ar.due30)} − out ${formatRupiah(ap.due30)}, overdue incl.`, tone: cash30 >= 0 ? "recv" : "pay" },
  ];

  const TopList = ({ title, rows, empty, tone, to }) => (
    <div className="cfr-side">
      <div className="cfr-side-head"><span className="cfr-side-lbl">{title}</span></div>
      {rows.length === 0 ? (
        <div className="cfr-empty-row">{empty}</div>
      ) : rows.map((r) => (
        <button type="button" key={r.id} className="cfr-rank-row" onClick={() => navigate(`${to}/${r.id}`)}>
          <span className="cfr-rank-name">{r.name}</span>
          <span className={`cfr-rank-amt ${tone}`}>{formatRupiah(r.overdue)}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="cfr-insights">
      <CashOnHand cash={cash} asOf={asOf} reconciled={reconciled} />

      {/* KPI strip */}
      <div className="cfr-kpis">
        {KPIS.map((k) => (
          <div key={k.lbl} className={`cfr-kpi tone-${k.tone}`}>
            <div className="cfr-kpi-lbl">{k.lbl}</div>
            <div className="cfr-kpi-val">{k.val}</div>
            <div className="cfr-kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* AP vs AR aging bars */}
      <div className="cfr-sides">
        <AgingBars
          label="Payables · by age"
          total={ap.snapshot.apOutstanding}
          buckets={ap.snapshot.bucketTotals}
          note={accrued ? `Accrued, not yet invoiced: ${formatRupiah(accrued)} — not included above.` : null}
          tie={<LedgerTie aging={ap.snapshot.apOutstanding} ledger={ap.ledger} code={CONTROL.ap} asOf={asOf} />}
          onOpen={() => onGoTo("ap")}
        />
        <AgingBars
          label="Receivables · by age"
          total={ar.snapshot.arOutstanding}
          buckets={ar.snapshot.bucketTotals}
          tie={<LedgerTie aging={ar.snapshot.arOutstanding} ledger={ar.ledger} code={CONTROL.ar} asOf={asOf} />}
          onOpen={() => onGoTo("ar")}
        />
      </div>

      {/* Top overdue counterparties */}
      <div className="cfr-sides">
        <TopList title="Top overdue vendors" rows={ap.topOverdue} empty="No overdue payables." tone="pay" to="/vendors" />
        <TopList title="Top overdue customers" rows={ar.topOverdue} empty="No overdue receivables." tone="recv" to="/customers" />
      </div>
    </div>
  );
}

// The Overview tab's CSV: cash by account, then the AR / AP lines with their
// ledger balances, and the 30-day cash figure.
function overviewCsv({ cash, ap, ar, cash30, reconciled }) {
  const rows = [
    ...cash.available.accounts.map((a) => ({ section: "Cash available", item: a.name, detail: [a.bank, a.mask, a.groupLabel, a.currency !== "IDR" ? `${a.currency} at IDR book value` : "", a.source === "opening" ? "opening balance only" : "", `reconciled through: ${reconLabel(reconciled[a.id])}`].filter(Boolean).join(" · "), amount: a.balance })),
    { section: "Cash available", item: "Total available cash", detail: "", amount: cash.available.total },
    ...cash.unavailable.accounts.map((a) => ({ section: "Not available", item: a.name, detail: [a.bank, a.mask, a.reason, a.source === "opening" ? "opening balance only" : ""].filter(Boolean).join(" · "), amount: a.balance })),
    { section: "Not available", item: "Total not available", detail: "", amount: cash.unavailable.total },
    { section: "Receivables", item: "AR outstanding", detail: "", amount: ar.snapshot.arOutstanding },
    { section: "Receivables", item: "AR overdue", detail: "", amount: ar.snapshot.overdue },
    { section: "Receivables", item: `Ledger — ${CONTROL.ar} ${COA_BY_CODE[CONTROL.ar]?.name || ""}`, detail: Math.round(ar.snapshot.arOutstanding - ar.ledger) === 0 ? "ties to AR outstanding" : `differs by ${Math.round(ar.snapshot.arOutstanding - ar.ledger)}`, amount: ar.ledger },
    { section: "Payables", item: "AP outstanding (posted bills)", detail: "", amount: ap.snapshot.apOutstanding },
    { section: "Payables", item: "Accrued, not yet invoiced", detail: "not in AP outstanding", amount: ap.snapshot.accruedLiabilities },
    { section: "Payables", item: `Ledger — ${CONTROL.ap} ${COA_BY_CODE[CONTROL.ap]?.name || ""}`, detail: Math.round(ap.snapshot.apOutstanding - ap.ledger) === 0 ? "ties to AP outstanding" : `differs by ${Math.round(ap.snapshot.apOutstanding - ap.ledger)}`, amount: ap.ledger },
    { section: "Next 30 days", item: "AR due incl. overdue", detail: "", amount: ar.due30 },
    { section: "Next 30 days", item: "AP due incl. overdue", detail: "", amount: ap.due30 },
    { section: "Next 30 days", item: "Cash in 30 days", detail: "available cash + AR due − AP due", amount: cash30 },
  ];
  return {
    columns: [
      { label: "Section", value: (r) => r.section },
      { label: "Item", value: (r) => r.item },
      { label: "Detail", value: (r) => r.detail },
      { label: "Amount (IDR)", value: (r) => r.amount },
    ],
    rows,
  };
}

// Export menu — Excel (CSV) of what's on screen, or the browser's print
// dialog (which also saves to PDF).
function ExportMenu({ onCsv, onPrint }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="cfr-exp" ref={ref}>
      <button type="button" className="cfr-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" aria-hidden><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10" /></svg>
        Export
      </button>
      {open && (
        <div className="cfr-exp-menu" role="menu">
          <button type="button" role="menuitem" className="cfr-exp-item" onClick={() => { setOpen(false); onCsv(); }}>Excel (CSV)</button>
          <button type="button" role="menuitem" className="cfr-exp-item" onClick={() => { setOpen(false); onPrint(); }}>Print / PDF</button>
        </div>
      )}
    </div>
  );
}

// Cash Position & Aging — under Reports. Cash in the bank, what customers owe,
// and what you owe vendors, by age, as of a date. Three lenses on the same
// as-of snapshot: an Overview dashboard (cash on hand first), the AP Aging
// table (payables) and the AR Aging table (receivables), the tables in a
// per-party Summary or a per-document Detail view.
//
// Tab, as-of date and view live in the URL (?tab=ap&asof=2025-03-31&view=detail)
// so deep links (/ap-aging → ?tab=ap, Home insights) land on the right tab and
// a shared link reproduces the report.
export default function CashflowReportPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useCurrentUser();
  const { payments } = usePayments();

  const today = todayIso();
  const asOfOptions = useMemo(() => [
    { value: today, label: `Today · ${formatDateEn(today)}` },
    ...recentMonthEnds(6).map((d) => ({ value: d, label: `Month end · ${formatDateEn(d)}` })),
  ], [today]);

  const tab = TABS.some((t) => t.k === params.get("tab")) ? params.get("tab") : "insights";
  const asOf = asOfOptions.some((o) => o.value === params.get("asof")) ? params.get("asof") : today;
  const view = VIEWS.some((v) => v.k === params.get("view")) ? params.get("view") : "summary";

  // Write one param back to the URL, dropping it when it's the default.
  const setParam = (key, value, fallback) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });
  const setTab = (k) => setParam("tab", k, "insights");

  // Payments recorded this session count — the same map Bank Reconciliation
  // reads (it replaces the seed history; see bankLedger.js).
  const paymentHistory = useMemo(() => {
    const out = {};
    for (const [billId, p] of Object.entries(payments || {})) {
      if (p?.history?.length) out[billId] = p.history;
    }
    return Object.keys(out).length ? out : null;
  }, [payments]);

  const overview = useOverview(asOf, paymentHistory);
  const tableExport = useRef(null);

  const tabMeta = TABS.find((t) => t.k === tab);
  const viewLbl = VIEWS.find((v) => v.k === view).lbl;
  const reportTitle = tab === "insights" ? tabMeta.report : `${tabMeta.report} — ${viewLbl.toLowerCase()}`;
  const period = `As of ${formatDateEn(asOf)}`;
  const header = reportHeader({ report: `Cash Position & Aging · ${reportTitle}`, period, runBy: user?.name });

  const exportCsv = () => {
    const data = tab === "insights" ? overviewCsv(overview) : tableExport.current;
    if (!data) return;
    const slug = tab === "insights" ? "cash-position" : `${tab}-aging`;
    downloadCsv(exportName(slug, tab === "insights" ? null : view, asOf), { header, ...data });
  };

  return (
    <div className="lg-page cfr-page">
      <div className="lg-scroll-container">
        <div className="print-only cfr-print-head">
          {header.map((line, i) => <div key={i} className={i === 1 ? "cfr-print-title" : ""}>{line.join(" ")}</div>)}
        </div>

        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="cfr-back no-print" onClick={() => navigate("/reports")}>← Reports</button>
              <h1 className="lg-title">Cash Position &amp; Aging</h1>
              <p className="cfr-lede">Cash in the bank, what customers owe you and what you owe vendors — by age, as of {formatDateEn(asOf)}.</p>
            </div>
            <div className="cfr-controls no-print">
              <label className="cfr-asof">
                <span>As of</span>
                <select value={asOf} onChange={(e) => setParam("asof", e.target.value, today)}>
                  {asOfOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <ExportMenu onCsv={exportCsv} onPrint={printReport} />
            </div>
          </div>
          <div className="cfr-tabbar no-print">
            <div className="cc-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.k}
                  role="tab"
                  aria-selected={tab === t.k}
                  className={`cc-tab${tab === t.k ? " active" : ""}`}
                  onClick={() => setTab(t.k)}
                >
                  {t.lbl}
                </button>
              ))}
            </div>
            {tab !== "insights" && (
              <div className="cfr-seg" role="group" aria-label="View">
                {VIEWS.map((v) => (
                  <button key={v.k} type="button" className={view === v.k ? "on" : ""} aria-pressed={view === v.k} onClick={() => setParam("view", v.k, "summary")}>
                    {v.lbl}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {tab === "insights" && <AgingInsights data={overview} asOf={asOf} onGoTo={setTab} />}
        {tab === "ap" && (
          <ApAgingTable
            asOf={asOf} view={view} paymentHistory={paymentHistory} exportRef={tableExport}
            tie={<LedgerTie aging={overview.ap.snapshot.apOutstanding} ledger={overview.ap.ledger} code={CONTROL.ap} asOf={asOf} />}
          />
        )}
        {tab === "ar" && (
          <ArAgingTable
            asOf={asOf} view={view} exportRef={tableExport}
            tie={<LedgerTie aging={overview.ar.snapshot.arOutstanding} ledger={overview.ar.ledger} code={CONTROL.ar} asOf={asOf} />}
          />
        )}
      </div>
    </div>
  );
}
