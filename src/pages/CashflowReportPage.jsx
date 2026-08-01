import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { useInvoices } from "../state/InvoicesContext";
import { TODAY } from "../lib/clock";
import { formatRupiah, formatDateEn } from "../lib/format";
import { buildAgingLines, buildSnapshot, buildVendorPivot, isAgingTableRow, AGE_BUCKETS } from "../lib/apAging";
import { buildArAgingLines, buildCustomerPivot, buildArSnapshot } from "../lib/arAging";
import ApAgingTable from "../components/ApAgingTable";
import ArAgingTable from "../components/ArAgingTable";
import "./modules.css";
import "./cashflow-report.css";

const AGE_COLOR = { current: "#2E7D44", b1_30: "#C99A2E", b31_60: "#B8770F", b61_90: "#A8620C", b91_120: "#A32D2D", b_gt120: "#8C2420" };

const TABS = [
  { k: "insights", lbl: "Aging Insights" },
  { k: "ap",       lbl: "AP Aging" },
  { k: "ar",       lbl: "AR Aging" },
];

// A horizontal age-bucket bar + legend, shared by the AP and AR summary blocks
// on the Aging Insights dashboard.
function AgingBars({ label, total, buckets, onOpen }) {
  return (
    <div className="cfr-side">
      <div className="cfr-side-head">
        <span className="cfr-side-lbl">{label}</span>
        <span className="cfr-side-total">{formatRupiah(total)}</span>
      </div>
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
      <button type="button" className="cfr-side-open" onClick={onOpen}>Open full table →</button>
    </div>
  );
}

// The Aging Insights tab — a combined AP + AR aging dashboard. It reads the two
// snapshots side-by-side (what we owe vs what we're owed), the net position, and
// the largest overdue counterparties on each side.
function AgingInsights({ onGoTo }) {
  const { bills } = useBills();
  const { invoices } = useInvoices();

  const ap = useMemo(() => {
    const lines = buildAgingLines(TODAY, bills);
    const snapshot = buildSnapshot(lines);
    const pivot = buildVendorPivot(lines.filter(isAgingTableRow));
    const topOverdue = pivot
      .map((r) => ({ name: r.vendorName, overdue: r.total - r.buckets.current }))
      .filter((r) => r.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 5);
    return { snapshot, topOverdue };
  }, [bills]);

  const ar = useMemo(() => {
    const lines = buildArAgingLines(TODAY, invoices);
    const snapshot = buildArSnapshot(lines);
    const pivot = buildCustomerPivot(lines);
    const topOverdue = pivot
      .map((r) => ({ name: r.customerName, overdue: r.total - r.buckets.current }))
      .filter((r) => r.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue)
      .slice(0, 5);
    return { snapshot, topOverdue };
  }, [invoices]);

  const net = ar.snapshot.arOutstanding - ap.snapshot.apOutstanding;

  const KPIS = [
    { lbl: "AP Outstanding", val: formatRupiah(ap.snapshot.apOutstanding), sub: `DPO ${ap.snapshot.dpoDays}d`, tone: "pay" },
    { lbl: "AR Outstanding", val: formatRupiah(ar.snapshot.arOutstanding), sub: `DSO ${ar.snapshot.dsoDays}d`, tone: "recv" },
    { lbl: "Net position", val: formatRupiah(Math.abs(net)), sub: net >= 0 ? "Receivables exceed payables" : "Payables exceed receivables", tone: net >= 0 ? "recv" : "pay" },
    { lbl: "Cash movement this week", val: formatRupiah(ar.snapshot.dueIn7Days - ap.snapshot.dueIn7Days), sub: `In ${formatRupiah(ar.snapshot.dueIn7Days)} · Out ${formatRupiah(ap.snapshot.dueIn7Days)}`, tone: "neutral" },
  ];

  return (
    <div className="cfr-insights">
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
        <AgingBars label="Payables · by age" total={ap.snapshot.apOutstanding} buckets={ap.snapshot.bucketTotals} onOpen={() => onGoTo("ap")} />
        <AgingBars label="Receivables · by age" total={ar.snapshot.arOutstanding} buckets={ar.snapshot.bucketTotals} onOpen={() => onGoTo("ar")} />
      </div>

      {/* Top overdue counterparties */}
      <div className="cfr-sides">
        <div className="cfr-side">
          <div className="cfr-side-head"><span className="cfr-side-lbl">Top overdue vendors</span></div>
          {ap.topOverdue.length === 0 ? (
            <div className="cfr-empty-row">No overdue payables.</div>
          ) : ap.topOverdue.map((r) => (
            <div key={r.name} className="cfr-rank-row">
              <span className="cfr-rank-name">{r.name}</span>
              <span className="cfr-rank-amt pay">{formatRupiah(r.overdue)}</span>
            </div>
          ))}
        </div>
        <div className="cfr-side">
          <div className="cfr-side-head"><span className="cfr-side-lbl">Top overdue customers</span></div>
          {ar.topOverdue.length === 0 ? (
            <div className="cfr-empty-row">No overdue receivables.</div>
          ) : ar.topOverdue.map((r) => (
            <div key={r.name} className="cfr-rank-row">
              <span className="cfr-rank-name">{r.name}</span>
              <span className="cfr-rank-amt recv">{formatRupiah(r.overdue)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Cashflow Report — the aging hub under Reports. Three lenses on the same
// as-of snapshot: a combined Aging Insights dashboard, the AP Aging table
// (payables), and the AR Aging table (receivables). Formerly two separate
// nav destinations; consolidated here.
export default function CashflowReportPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initial = TABS.some((t) => t.k === params.get("tab")) ? params.get("tab") : "insights";
  const [tab, setTab] = useState(initial);

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="cfr-back" onClick={() => navigate("/reports")}>← Reports</button>
              <h1 className="lg-title">Cashflow Report</h1>
              <p className="cfr-lede">Aging across payables and receivables as of {formatDateEn(TODAY.toISOString().slice(0, 10))}.</p>
            </div>
          </div>
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
        </div>

        {tab === "insights" && <AgingInsights onGoTo={setTab} />}
        {tab === "ap" && <ApAgingTable />}
        {tab === "ar" && <ArAgingTable />}
      </div>
    </div>
  );
}
