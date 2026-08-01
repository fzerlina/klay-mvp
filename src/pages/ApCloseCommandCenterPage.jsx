import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "../state/CurrentUserContext";
import {
  AP_CLOSE_RECORDS,
  AP_CLOSE_PERIOD_LABEL,
  AP_CLOSE_NEXT_PERIOD_LABEL,
  AP_CLOSE_TARGET_DATE,
  AP_CLOSE_TARGET_LABEL,
  GATE_BY_ID,
  GATE_ACTION,
  GATE_EMPTY_LINE,
  AP_PERIODS,
  computeGates,
  computeApCloseSummary,
  computeReconciliation,
  computeBankRecon,
  computeInsights,
  computeClosedInsights,
  recordSeverity,
  formatRp,
} from "../data/seed/apClose";
import { ACCRUAL_CANDIDATES } from "../data/seed/accrualCandidates";
import { daysSince } from "../lib/clock";
import "./ap-close.css";

// Accrual candidate lookup + derived PPh/net at a given (possibly adjusted) amount.
const ACCRUAL_BY_ID = Object.fromEntries(ACCRUAL_CANDIDATES.map((c) => [c.id, c]));
function accrualDerived(candidate, amount) {
  const rate = candidate.pph_rate || 0;
  const pph = Math.round(amount * rate);
  return { rate, pph, net: amount - pph };
}
function fmtAccrualDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ─── Small building blocks ───────────────────────────────────────────────────

function Spark({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 1.5l1.1 2.7L9.8 5l-2.7 0.8L6 8.5l-1.1-2.7L2.2 5l2.7-0.8L6 1.5z" />
      <path d="M10 8.5l0.4 1L11.5 10l-1.1 0.4L10 11.5l-0.4-1.1L8.5 10l1.1-0.5L10 8.5z" />
    </svg>
  );
}

function LockIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="5.5" width="7" height="5" rx="0.8" />
      <path d="M4.2 5.5V3.8a1.8 1.8 0 0 1 3.6 0v1.7" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6h7M6.5 3l3 3-3 3" />
    </svg>
  );
}

function Avatar({ initials, tone }) {
  return <span className={`apc-avatar${tone ? " " + tone : ""}`}>{initials}</span>;
}


// ─── Status cell — reason clause + optional statutory countdown (red) ─────────

function StatusCell({ r }) {
  const emphasized = r.status_clause.includes("Klay");
  return (
    <div className="apc-status">
      <span className="apc-status-clause">{r.status_clause}</span>
      {r.statutory_days != null && (
        <span className="apc-status-statutory"> — PPN credit expires in {r.statutory_days} days</span>
      )}
      {emphasized && <Spark size={10} />}
    </div>
  );
}

// ─── Records table row ───────────────────────────────────────────────────────

function RecordRow({ r, sideCol, emphasized, onAction, alt }) {
  const action = GATE_ACTION[r.gate];
  return (
    <div className={`apc-row apc-sev-${recordSeverity(r)}${sideCol ? " withpic" : ""}${emphasized ? " emphasized" : ""}${alt ? " alt" : ""}`}>
      <div className="apc-cell-item">
        <span className="apc-dot" />
        <span className="apc-item-code">{r.id}</span>
      </div>
      <div className="apc-cell-vendor">{r.vendor}</div>
      <div className="apc-cell-amount">
        {r.currency !== "IDR" && r.original ? (
          <>
            <span className="apc-amt-primary">{r.original.code} {r.original.amount.toLocaleString("en-US")}</span>
            <span className="apc-amt-idr">{formatRp(r.amount)}</span>
          </>
        ) : (
          <span className="apc-amt-primary">{formatRp(r.amount)}</span>
        )}
      </div>
      <div className="apc-cell-status"><StatusCell r={r} /></div>
      <div className="apc-cell-age">{r.age_days} {r.age_days === 1 ? "day" : "days"}</div>
      {sideCol === "pic" && (
        <div className="apc-cell-pic">
          <Avatar initials={r.assignee?.initials || "—"} />
          <span className="apc-pic-name">{r.assignee?.name || "Unassigned"}</span>
        </div>
      )}
      {sideCol === "gate" && (
        <div className="apc-cell-pic">
          <span className={`apc-legend-dot apc-seg-${r.gate}`} />
          <span className="apc-pic-name">{GATE_BY_ID[r.gate]?.label}</span>
        </div>
      )}
      <div className="apc-cell-action">
        {r.done ? (
          <span className={`apc-done-badge${r.doneLabel === "Skipped" ? " skipped" : ""}`}>✓ {r.doneLabel}</span>
        ) : (
          <button type="button" className="apc-row-action" onClick={() => onAction(r)}>
            {action?.label} <Arrow />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Insight card ────────────────────────────────────────────────────────────

function InsightSpark({ data, up }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={`apc-spark${up ? " up" : " down"}`} aria-hidden>
      {data.map((d, i) => (
        <div key={i} className="apc-spark-col" title={`${d.label}: ${d.value}`}>
          <div className="apc-spark-bar" style={{ height: `${Math.max(8, (d.value / max) * 100)}%` }} />
          <div className="apc-spark-lbl">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function InsightCard({ insight, onAction }) {
  return (
    <div className="apc-insight">
      <div className="apc-insight-label"><Spark size={11} /> {insight.label}</div>
      <div className="apc-insight-stat">
        {insight.stat}
        {insight.compare && <span className="apc-insight-compare"> {insight.compare}</span>}
      </div>
      <div className="apc-insight-expl">{insight.explanation}</div>
      {insight.spark && <InsightSpark data={insight.spark} up={insight.trendUp} />}
      {insight.action && (
        <button type="button" className="apc-insight-action" onClick={() => onAction(insight.action)}>
          {insight.action.label} <Arrow />
        </button>
      )}
    </div>
  );
}

// ─── Balance overview — does everything reconcile? ────────────────────────────
// Two sections in one glance: (1) subledger ↔ GL (Gate 3 — AP owns it: Accounts
// Payable + Accrued Liabilities tie to their GL control accounts); (2) bank ↔
// books (Gate 4 — AP consumes it from the bank-rec module: each account confirmed
// against its statement, timing differences allowed). Combined pill is green only
// when both are green. Recompute re-runs both.

function RecomputeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 7a5 5 0 1 1-1.5-3.5" />
      <path d="M12 1.5V4H9.5" />
    </svg>
  );
}

// Gate 3 — subledger ↔ GL. AP owns it: Accounts Payable + Accrued Liabilities
// each tie to their GL control account. Green when both deltas are within
// materiality.
function BalanceCard({ recon, onRecompute, checkedLabel }) {
  const glRows = [
    { key: "ap", name: "Accounts Payable", ...recon.a },
    { key: "accr", name: "Accrued Liabilities", ...recon.b },
  ];
  return (
    <div className="apc-balance">
      <div className="apc-balance-head">
        <span className={`apc-balance-state apc-sev-${recon.green ? "green" : "red"}`}>
          {recon.green ? "Ties to GL" : "Delta to resolve"}
        </span>
        <button type="button" className="apc-balance-recompute" onClick={onRecompute} title={`Recompute · ${checkedLabel}`} aria-label="Recompute reconciliation">
          <RecomputeIcon />
        </button>
      </div>
      <table className="apc-balance-table">
        <thead>
          <tr>
            <th>Account</th>
            <th className="apc-right">Subledger</th>
            <th className="apc-right">GL</th>
            <th className="apc-right">Delta</th>
          </tr>
        </thead>
        <tbody>
          {glRows.map((r) => (
            <tr key={r.key}>
              <td className="apc-balance-acct">
                <span className={`apc-balance-dot apc-sev-${r.state}`} />
                {r.name}
              </td>
              <td className="apc-right apc-balance-num">{formatRp(r.subledgerBalance)}</td>
              <td className="apc-right apc-balance-num">{formatRp(r.glBalance)}</td>
              <td className={`apc-right apc-balance-num apc-balance-delta apc-sev-${r.state}`}>
                {r.delta === 0 ? "Rp 0" : formatRp(r.delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="apc-balance-foot">Materiality Rp 0 · {checkedLabel}</div>
    </div>
  );
}

// Gate 4 — bank reconciliation. AP consumes it from the bank-rec module. With
// many accounts we show a rollup + only the exceptions (timing / unreconciled);
// fully-reconciled accounts stay invisible. Deep-links into the bank-rec module.
function BankCard({ bank, onRecompute, checkedLabel, onOpen }) {
  const headline = bank.unrec > 0
    ? `${bank.unrec} of ${bank.total} account${bank.total === 1 ? "" : "s"} unreconciled`
    : bank.timing > 0
      ? `All reconciled · ${bank.timing} with timing difference${bank.timing === 1 ? "" : "s"}`
      : "All accounts reconciled";
  return (
    <div className="apc-balance">
      <div className="apc-balance-head">
        <span className={`apc-balance-state apc-sev-${bank.green ? "green" : "red"}`}>
          {bank.green ? "Reconciled" : "Action needed"}
        </span>
        <button type="button" className="apc-balance-recompute" onClick={onRecompute} title={`Recompute · ${checkedLabel}`} aria-label="Recompute bank reconciliation">
          <RecomputeIcon />
        </button>
      </div>
      <div className="apc-bank-summary">
        <span className="apc-bank-count">{bank.reconciled}/{bank.total}</span>
        <span className="apc-bank-headline">{headline}</span>
      </div>
      {bank.exceptions.length > 0 && (
        <div className="apc-bank-ex">
          {bank.exceptions.map((r) => (
            <button key={r.id} type="button" className="apc-bank-exrow" onClick={onOpen} title="Open bank reconciliation">
              <span className={`apc-balance-dot apc-sev-${r.sev}`} />
              <span className="apc-bank-exname">{r.name} <span className="apc-balance-mask">{r.mask}</span></span>
              <span className={`apc-bank-exstate apc-sev-${r.sev}`}>{r.stateLabel}</span>
              <span className="apc-bank-examt">{r.delta === 0 ? "" : formatRp(Math.abs(r.delta))}</span>
            </button>
          ))}
        </div>
      )}
      <div className="apc-balance-foot apc-balance-foot-link">
        <span>{checkedLabel}</span>
        <button type="button" className="apc-balance-grouplink" onClick={onOpen}>Open bank reconciliation <Arrow /></button>
      </div>
    </div>
  );
}

// ─── Close confirmation dialog ───────────────────────────────────────────────

function ConfirmDialog({ onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="apc-modal-backdrop" onClick={onCancel}>
      <div className="apc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="apc-modal-title">Close AP for {AP_CLOSE_PERIOD_LABEL}?</div>
        <div className="apc-modal-body">
          New bills will post to {AP_CLOSE_NEXT_PERIOD_LABEL}. Everything for this period is posted and reconciled.
        </div>
        <div className="apc-modal-foot">
          <button type="button" className="apc-btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="apc-btn-primary" onClick={onConfirm}>Close AP period</button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ApCloseCommandCenterPage() {
  const navigate = useNavigate();

  // Role comes from the global "Viewing As" persona (sidebar) — no page-level
  // role toggle. Operators (FM/Admin, approve+post on AP) can declare the close;
  // preparers (AP Staff) handle the prep gates; viewers get the board read-only.
  const { user, hasLevel } = useCurrentUser();
  const canOperate = hasLevel("ap", "approve+post"); // FM/Admin — can declare close, book accruals

  const [tab, setTab] = useState("summary"); // "summary" | "alltasks"
  const [myOnly, setMyOnly] = useState(false); // "My tasks" filter on the All tasks tab

  // Period switcher — April 2025 is the live close; earlier months are closed
  // (retrospective view). Closed months still show insights at the top.
  const [selectedPeriod, setSelectedPeriod] = useState(AP_PERIODS.find((p) => p.current)?.key || AP_PERIODS[0].key);
  const period = AP_PERIODS.find((p) => p.key === selectedPeriod) || AP_PERIODS[0];
  const isCurrent = !!period.current;
  const histClosed = !!period.closed; // a historically-closed month
  const periodLabel = period.label;
  const closedInsights = useMemo(() => (histClosed ? computeClosedInsights(period.key) : []), [histClosed, period.key]);

  const [activeGate, setActiveGate] = useState(null); // gate id → card filter
  const [search, setSearch] = useState("");
  const [picFilter, setPicFilter] = useState("all"); // "all" | initials
  const [statusFilter, setStatusFilter] = useState("all"); // all|needs|statutory
  const [groupBy, setGroupBy] = useState("gate"); // "gate" (item group) | "pic" (assignee)
  const [insightRecordIds, setInsightRecordIds] = useState(null); // from PPN insight

  const [closed, setClosed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Accrual Intelligence (Gate 5) — per-candidate review state. Booking or
  // skipping marks the accrual Done (it drops out of the open count); the
  // suggested amount can be adjusted before booking. Local demo state only.
  const [accrualState, setAccrualState] = useState(() => {
    const m = {};
    for (const c of ACCRUAL_CANDIDATES) m[c.id] = { status: "pending", amount: c.gross_amount, reason: "" };
    return m;
  });
  const [drawerId, setDrawerId] = useState(null); // accrual candidate id shown in the review drawer
  const [adjusting, setAdjusting] = useState(false);
  const [draftAmount, setDraftAmount] = useState(0);
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState("Vendor does not invoice this period");
  // Demo-only: the page reads and routes, it never edits records — so blockers
  // won't clear organically here. This clearly-labelled demo switch lets a
  // presenter reach the ready→closed payoff moment. Not part of the real flow.
  const [demoResolved, setDemoResolved] = useState(false);

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1900);
  }

  // Records, with two overlays applied: the demo-resolve switch (blockers →
  // non-blocking) and per-accrual review state (amount / booked / skipped).
  const records = useMemo(() => {
    const base = demoResolved
      ? AP_CLOSE_RECORDS.map((r) => (r.is_blocker ? { ...r, is_blocker: false } : r))
      : AP_CLOSE_RECORDS;
    return base.map((r) => {
      if (r.gate !== "accr") return r;
      const st = accrualState[r.id];
      if (!st || st.status === "pending") return r;
      const doneLabel = st.status === "booked" ? "Booked" : "Skipped";
      const clause = st.status === "booked"
        ? `Booked — auto-reverses ${fmtAccrualDate(ACCRUAL_BY_ID[r.id]?.accrual_reversal_date)}`
        : `Skipped — ${st.reason || "not invoicing this period"}`;
      return { ...r, amount: st.amount, done: true, doneLabel, status_clause: clause };
    });
  }, [demoResolved, accrualState]);

  const gates = useMemo(() => computeGates(records), [records]);
  const summary = useMemo(() => computeApCloseSummary(records), [records]);
  const recon = useMemo(() => computeReconciliation(records), [records]);
  const bank = useMemo(() => computeBankRecon(), []);
  const daysToClose = -daysSince(AP_CLOSE_TARGET_DATE); // + = days remaining
  const insights = useMemo(() => computeInsights(records), [records]);
  const [reconCheckedLabel, setReconCheckedLabel] = useState("Last reconciled 5 min ago");
  const [bankCheckedLabel, setBankCheckedLabel] = useState("Bank feed synced 12 min ago");

  // ── Summary-tab filtering ───────────────────────────────────────────────
  // Distinct assignees present in the records — drives the PIC filter dropdown.
  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    for (const r of records) {
      if (r.assignee?.id && !seen.has(r.assignee.id)) seen.set(r.assignee.id, r.assignee.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [records]);

  const summaryFiltered = useMemo(() => {
    let list = records;
    if (myOnly) list = list.filter((r) => r.assignee?.id === user.id);
    if (activeGate) list = list.filter((r) => r.gate === activeGate);
    if (insightRecordIds) list = list.filter((r) => insightRecordIds.includes(r.id));
    if (picFilter !== "all") list = list.filter((r) => r.assignee?.id === picFilter);
    if (statusFilter === "needs") list = list.filter((r) => r.is_blocker);
    else if (statusFilter === "statutory") list = list.filter((r) => r.statutory_days != null);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        r.id.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q) ||
        r.status_clause.toLowerCase().includes(q) ||
        (r.assignee?.name || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [records, myOnly, user.id, activeGate, insightRecordIds, picFilter, statusFilter, search]);

  const grouped = !activeGate && !insightRecordIds;
  // When a narrowing filter is on, drop empty item-group rows (else My tasks /
  // assignee views show a wall of empty gate headers).
  const narrowing = myOnly || picFilter !== "all" || statusFilter !== "all" || !!search.trim();
  // The contextual 6th column: when grouped by PIC the row shows its gate;
  // otherwise (gate grouping, or flat filtered view) it shows the assignee.
  const rowSideCol = grouped && groupBy === "pic" ? "gate" : "pic";

  const summaryGroups = useMemo(() => {
    if (!grouped) return null;
    if (groupBy === "pic") {
      const map = new Map();
      for (const r of summaryFiltered) {
        const key = r.assignee?.id || "unassigned";
        if (!map.has(key)) map.set(key, { key, kind: "pic", label: r.assignee?.name || "Unassigned", initials: r.assignee?.initials || "—", rows: [] });
        map.get(key).rows.push(r);
      }
      return [...map.values()]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((g) => {
          let severity = "green";
          for (const r of g.rows) {
            const s = recordSeverity(r);
            if (s === "red" || (s === "amber" && severity !== "red")) severity = s;
          }
          return { ...g, severity, count: g.rows.filter((r) => !r.done).length };
        });
    }
    const gg = gates.map((g) => {
      const rows = summaryFiltered.filter((r) => r.gate === g.id);
      return { ...g, kind: "gate", rows, count: rows.filter((r) => !r.done).length };
    });
    return narrowing ? gg.filter((g) => g.rows.length > 0) : gg;
  }, [grouped, groupBy, gates, summaryFiltered, narrowing]);

  // ── Summary dashboard — open-task counts by assignee (item-group counts come
  //    from `gates`). Both drill into the All tasks tab pre-filtered.
  const assigneeCounts = useMemo(() => {
    const map = new Map();
    for (const r of records) {
      const key = r.assignee?.id || "unassigned";
      if (!map.has(key)) map.set(key, { id: r.assignee?.id || null, name: r.assignee?.name || "Unassigned", initials: r.assignee?.initials || "—", open: 0 });
      if (!r.done) map.get(key).open += 1;
    }
    return [...map.values()].sort((a, b) => b.open - a.open);
  }, [records]);
  const myOpen = useMemo(() => records.filter((r) => r.assignee?.id === user.id && !r.done).length, [records, user.id]);

  // ── Handlers ────────────────────────────────────────────────────────────
  function onRowAction(r) {
    if (r.gate === "accr") { openAccrualDrawer(r.id); return; }
    const to = GATE_ACTION[r.gate]?.route(r);
    if (to) navigate(to);
  }
  // Jump from a Summary count into the All tasks tab, pre-filtered.
  function goAllTasks({ gate = null, pic = "all", mine = false } = {}) {
    setInsightRecordIds(null);
    setActiveGate(gate);
    setPicFilter(pic);
    setMyOnly(mine);
    setTab("alltasks");
  }

  // ── Accrual Intelligence drawer ─────────────────────────────────────────
  function openAccrualDrawer(id) {
    const st = accrualState[id];
    setDrawerId(id);
    setAdjusting(false);
    setSkipping(false);
    setSkipReason("Vendor does not invoice this period");
    setDraftAmount(st ? st.amount : (ACCRUAL_BY_ID[id]?.gross_amount || 0));
  }
  function closeDrawer() { setDrawerId(null); setAdjusting(false); setSkipping(false); }
  function bookAccrual() {
    const c = ACCRUAL_BY_ID[drawerId];
    setAccrualState((prev) => ({ ...prev, [drawerId]: { ...prev[drawerId], status: "booked", amount: draftAmount } }));
    showToast(`Accrual booked for ${c.vendor_name} · ${formatRp(draftAmount)} — auto-reverses ${fmtAccrualDate(c.accrual_reversal_date)}`);
    closeDrawer();
  }
  function skipAccrual() {
    const c = ACCRUAL_BY_ID[drawerId];
    setAccrualState((prev) => ({ ...prev, [drawerId]: { ...prev[drawerId], status: "skipped", reason: skipReason } }));
    showToast(`Skipped ${c.vendor_name} — ${skipReason}`);
    closeDrawer();
  }
  function onInsightAction(action) {
    if (action.kind === "route") navigate(action.to);
    else if (action.kind === "filterRecords") {
      setActiveGate(null);
      setMyOnly(false);
      setInsightRecordIds(action.recordIds);
      setTab("alltasks");
      showToast(action.toast || `Filtered to ${action.recordIds.length} record${action.recordIds.length === 1 ? "" : "s"}`);
    }
  }
  function recomputeRecon() {
    setReconCheckedLabel("Reconciled just now");
    showToast(recon.green ? "Subledger ties to GL — reconciled" : "Reconciliation delta found — review balance overview");
  }
  function recomputeBank() {
    setBankCheckedLabel("Bank feed synced just now");
    showToast(bank.green
      ? `${bank.reconciled} of ${bank.total} bank accounts reconciled`
      : `${bank.unrec} bank account${bank.unrec === 1 ? "" : "s"} still unreconciled`);
  }
  function onCloseClick() {
    if (!summary.ready) {
      // Not ready — take the FM to the blocking tasks in the All tasks tab.
      const firstBlocking = gates.find((g) => g.blockerCount > 0);
      setInsightRecordIds(null);
      setMyOnly(false);
      setActiveGate(firstBlocking ? firstBlocking.id : null);
      setTab("alltasks");
      return;
    }
    setConfirmOpen(true);
  }
  function confirmClose() {
    setConfirmOpen(false);
    setClosed(true);
    showToast(`AP closed for ${AP_CLOSE_PERIOD_LABEL}`);
  }
  function reopen() {
    setClosed(false);
    showToast(`${AP_CLOSE_PERIOD_LABEL} reopened`);
  }

  // Header status — Status / Target close / Days to close (Dual-Entry style).
  const isClosedView = histClosed || (isCurrent && closed);
  const status = isClosedView
    ? { cls: "closed", text: "Closed" }
    : summary.ready
      ? { cls: "green", text: "Ready to close" }
      : { cls: "amber", text: "In progress" };
  const daysText = daysToClose > 0
    ? `${daysToClose} days`
    : daysToClose === 0 ? "Due today" : `${Math.abs(daysToClose)} days over`;

  return (
    <div className={`apc-page${closed ? " apc-closed" : ""}`}>
      <div className="apc-scroll">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="apc-head">
          <div className="apc-head-top">
            <div className="apc-head-titles">
              <h1 className="apc-title">Close</h1>
              <div className="apc-period-wrap">
                <select
                  className="apc-period-select"
                  value={selectedPeriod}
                  onChange={(e) => { setSelectedPeriod(e.target.value); setTab("summary"); setActiveGate(null); setInsightRecordIds(null); setSearch(""); }}
                >
                  {AP_PERIODS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}{p.closed ? " · closed" : ""}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="apc-head-controls">
              <div className="apc-status-cluster">
                <div className="apc-status-item">
                  <span className="apc-status-lbl">Status</span>
                  <span className={`apc-status-val apc-status-${status.cls}`}>
                    {status.cls === "closed" ? <LockIcon size={11} /> : <span className={`apc-status-dot apc-sev-${status.cls}`} />}
                    {status.text}
                  </span>
                </div>
                {isClosedView ? (
                  <div className="apc-status-item">
                    <span className="apc-status-lbl">Closed on</span>
                    <span className="apc-status-val">{histClosed ? period.closedOn : "Just now"}</span>
                  </div>
                ) : (
                  <>
                    <div className="apc-status-item">
                      <span className="apc-status-lbl">Target close</span>
                      <span className="apc-status-val">{AP_CLOSE_TARGET_LABEL}</span>
                    </div>
                    <div className="apc-status-item">
                      <span className="apc-status-lbl">Days to close</span>
                      <span className="apc-status-val">{daysText}</span>
                    </div>
                  </>
                )}
              </div>
              {canOperate && isCurrent && (
                <label className={`apc-demo-toggle${demoResolved ? " on" : ""}`} title="Demo only — simulate all blockers resolved so you can preview the ready-to-close state">
                  <input type="checkbox" checked={demoResolved} onChange={(e) => { setDemoResolved(e.target.checked); if (closed) setClosed(false); }} />
                  Demo: all resolved
                </label>
              )}
            </div>
          </div>

          {/* Tabs — only for the live period; closed months are a retrospective */}
          {isCurrent && (
            <div className="apc-tabs">
              <button type="button" className={`apc-tab${tab === "summary" ? " on" : ""}`} onClick={() => setTab("summary")}>
                Summary
              </button>
              <button type="button" className={`apc-tab${tab === "alltasks" ? " on" : ""}`} onClick={() => setTab("alltasks")}>
                All tasks
                {summary.open > 0 && <span className="apc-tab-badge">{summary.open}</span>}
              </button>
            </div>
          )}
        </div>

        {histClosed ? (
          /* ── Closed month — retrospective (insights on top + recap) ─── */
          <>
            {closedInsights.length > 0 && (
              <div className="apc-insights-section">
                <div className="apc-section-title"><Spark size={13} /> Klay's read on the {periodLabel} close</div>
                <div className="apc-insights">
                  {closedInsights.map((ins) => (
                    <InsightCard key={ins.id} insight={ins} onAction={onInsightAction} />
                  ))}
                </div>
              </div>
            )}
            <div className="apc-closed-recap">
              <div className="apc-closed-recap-badge"><LockIcon size={13} /> Closed</div>
              <div className="apc-closed-recap-body">
                <div className="apc-closed-recap-line"><strong>{periodLabel}</strong> was declared closed on {period.closedOn}.</div>
                <div className="apc-closed-recap-sub">{period.daysToClose} days after period-end · {period.blockers} blockers cleared · fully reconciled at close.</div>
              </div>
            </div>
          </>
        ) : tab === "summary" ? (
          <>
            {/* Top row — Balance overview + insight cards, section labels above
                each group at the same hierarchy. */}
            <div className="apc-toprow">
              <section className="apc-top-col apc-top-balance">
                <div className="apc-section-title">
                  <span className={`apc-status-dot apc-sev-${recon.green ? "green" : "red"}`} /> Balance overview
                </div>
                <BalanceCard recon={recon} onRecompute={recomputeRecon} checkedLabel={reconCheckedLabel} />
                <div className="apc-section-title apc-section-title-stacked">
                  <span className={`apc-status-dot apc-sev-${bank.green ? "green" : "red"}`} /> Bank reconciliation
                </div>
                <BankCard bank={bank} onRecompute={recomputeBank} checkedLabel={bankCheckedLabel} onOpen={() => navigate("/bank-reconciliation")} />
              </section>
              {insights.length > 0 && (
                <section className="apc-top-col apc-top-insights">
                  <div className="apc-section-title">
                    <Spark size={13} /> Klay's read — this month vs last
                  </div>
                  <div className="apc-insights">
                    {insights.map((ins) => (
                      <InsightCard key={ins.id} insight={ins} onAction={onInsightAction} />
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Outstanding tasks — counts by item group and by assignee; each
                drills into the All tasks tab pre-filtered. */}
            <div className="apc-outstanding">
              <div className="apc-section-title">
                Outstanding tasks
                <button type="button" className="apc-viewall" onClick={() => goAllTasks()}>
                  View all tasks <Arrow />
                </button>
              </div>
              <div className="apc-countgrid">
                <div className="apc-countcard">
                  <div className="apc-countcard-head">By item group</div>
                  {gates.map((g) => (
                    <button key={g.id} type="button" className="apc-countrow" onClick={() => goAllTasks({ gate: g.id })}>
                      <span className={`apc-gatecard-dot apc-sev-${g.severity}`} />
                      <span className="apc-countrow-name">{g.label}</span>
                      <span className="apc-countrow-num">{g.count}</span>
                    </button>
                  ))}
                </div>
                <div className="apc-countcard">
                  <div className="apc-countcard-head">By assignee</div>
                  {assigneeCounts.map((a) => (
                    <button key={a.id || "unassigned"} type="button" className="apc-countrow" onClick={() => goAllTasks({ pic: a.id || "all" })}>
                      <Avatar initials={a.initials} />
                      <span className="apc-countrow-name">{a.name}{a.id === user.id ? " · you" : ""}</span>
                      <span className="apc-countrow-num">{a.open}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          /* ── All tasks tab — the full records table + My-tasks filter ─── */
          <div className="apc-tablecard">
            <div className="apc-filterbar">
              <div className="apc-search">
                <Spark size={13} />
                <input
                  className="apc-search-input"
                  placeholder="Search item, vendor, or ask Klay…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="apc-filter-metas">
                <button type="button" className={`apc-mytoggle${myOnly ? " on" : ""}`} onClick={() => setMyOnly((v) => !v)}>
                  My tasks{myOpen > 0 && <span className="apc-mytoggle-num">{myOpen}</span>}
                </button>
                {(activeGate || insightRecordIds || myOnly || picFilter !== "all" || statusFilter !== "all") && (
                  <button type="button" className="apc-clear-filter" onClick={() => { setActiveGate(null); setInsightRecordIds(null); setMyOnly(false); setPicFilter("all"); setStatusFilter("all"); }}>
                    Clear filter
                  </button>
                )}
                <label className="apc-select">
                  Assignee
                  <select value={picFilter} onChange={(e) => setPicFilter(e.target.value)}>
                    <option value="all">All</option>
                    {assigneeOptions.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
                <label className="apc-select">
                  Status
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="needs">Blocking</option>
                    <option value="statutory">Statutory deadline</option>
                  </select>
                </label>
                <label className="apc-select">
                  Group by
                  <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option value="gate">Item group</option>
                    <option value="pic">PIC</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="apc-colhead withpic">
              <div>Item</div>
              <div>Vendor / description</div>
              <div className="apc-right">Amount</div>
              <div>Status</div>
              <div>Age</div>
              <div>{rowSideCol === "gate" ? "Item group" : "Assignee"}</div>
              <div />
            </div>

            {grouped ? (
              <div>
                {summaryGroups.length === 0 ? (
                  <div className="apc-empty">No records match</div>
                ) : summaryGroups.map((g) => (
                  <div key={g.key || g.id} className="apc-group">
                    <div className="apc-group-head">
                      {g.kind === "pic"
                        ? <Avatar initials={g.initials} />
                        : <span className={`apc-gatecard-dot apc-sev-${g.severity}`} />}
                      <span className="apc-group-name">{g.label}</span>
                      <span className="apc-group-count">{g.count}</span>
                    </div>
                    {g.rows.length === 0 ? (
                      <div className="apc-group-empty">{GATE_EMPTY_LINE[g.id]}</div>
                    ) : (
                      g.rows.map((r, i) => (
                        <RecordRow key={r.id} r={r} sideCol={rowSideCol} onAction={onRowAction} alt={i % 2 === 1} />
                      ))
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {summaryFiltered.length === 0 ? (
                  <div className="apc-empty">No records match</div>
                ) : (
                  summaryFiltered.map((r, i) => (
                    <RecordRow key={r.id} r={r} sideCol="pic" onAction={onRowAction} alt={i % 2 === 1} />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky bottom bar — live period (any tab) or a closed-month banner ─ */}
      {(histClosed || isCurrent) && (
        <div className={`apc-sticky${(histClosed || closed) ? " closed" : summary.ready ? " ready" : " blocked"}`}>
          <div className="apc-sticky-left">
            <LockIcon size={14} />
            {histClosed ? (
              <span>AP closed for {periodLabel} · {period.closedOn}</span>
            ) : closed ? (
              <span>AP closed for {periodLabel}</span>
            ) : summary.ready ? (
              <span>All clear — {periodLabel} is ready to close</span>
            ) : (
              <span>
                {summary.blockerCount} blocker{summary.blockerCount === 1 ? "" : "s"} remaining — resolve exceptions to close
              </span>
            )}
          </div>
          <div className="apc-sticky-right">
            {histClosed ? (
              <span className="apc-sticky-hint apc-sticky-hint-light">Reopen from Settings → Period Locking</span>
            ) : closed ? (
              canOperate ? <button type="button" className="apc-btn-reopen" onClick={reopen}>Reopen</button> : null
            ) : canOperate ? (
              <button
                type="button"
                className={`apc-close-cta${summary.ready ? " ready" : " quiet"}`}
                onClick={onCloseClick}
              >
                Close AP period
              </button>
            ) : (
              <span className="apc-sticky-hint">Your Finance Manager declares the close</span>
            )}
          </div>
        </div>
      )}

      {/* ── Accrual Intelligence — suggested journal draft (right drawer) ── */}
      {drawerId && (() => {
        const c = ACCRUAL_BY_ID[drawerId];
        const st = accrualState[drawerId];
        const amount = adjusting ? draftAmount : st.amount;
        const { rate, pph, net } = accrualDerived(c, amount);
        const isPph = rate > 0;
        const signalText =
          c.detection_signal === "RECURRING_GAP" ? "Hasn't invoiced this month — recurring vendor"
            : c.detection_signal === "PRIOR_ACCRUAL_PATTERN" ? "Prior accrual pattern — invoices in arrears"
              : "Manually flagged for monthly accrual";
        return (
          <>
            <div className="apc-drawer-backdrop" onClick={closeDrawer} />
            <div className="apc-drawer" role="dialog" aria-label="Accrual journal draft">
              <div className="apc-drawer-head">
                <div>
                  <div className="apc-drawer-eyebrow"><Spark size={11} /> Suggested accrual · {periodLabel}</div>
                  <div className="apc-drawer-title">{c.vendor_name}</div>
                  <div className="apc-drawer-meta">{c.pkp_status === "PKP" ? "PKP vendor" : "Non-PKP vendor"} · {isPph ? "PPh 23 @ 2%" : "No PPh"}</div>
                </div>
                <button type="button" className="apc-drawer-close" onClick={closeDrawer} aria-label="Close">×</button>
              </div>

              <div className="apc-drawer-signal"><Spark size={11} /> {signalText}</div>

              <div className="apc-drawer-amountblock">
                <div className="apc-drawer-amount-label">Suggested accrual</div>
                {adjusting ? (
                  <div className="apc-drawer-amount-edit">
                    <span className="apc-drawer-rp">Rp</span>
                    <input
                      type="number"
                      className="apc-drawer-amount-input"
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(Math.max(0, Number(e.target.value) || 0))}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="apc-drawer-amount">{formatRp(amount)}</div>
                )}
                <div className="apc-drawer-basis">Basis: {c.basis_label}</div>
                {isPph ? (
                  <div className="apc-drawer-pph">PPh 23 @2%: {formatRp(pph)} withheld · Net to vendor: {formatRp(net)}</div>
                ) : c.pkp_status === "PKP" ? (
                  <div className="apc-drawer-pph muted">No PPh on this expense · net to vendor {formatRp(net)}</div>
                ) : (
                  <div className="apc-drawer-pph muted">Non-PKP vendor · no PPh applicable</div>
                )}
              </div>

              <div className="apc-drawer-ledger">
                <div className="apc-drawer-ledger-head">Journal draft · auto-reverses {fmtAccrualDate(c.accrual_reversal_date)}</div>
                <div className="apc-drawer-ledger-line">
                  <span className="apc-ledger-side dr">DR</span>
                  <span className="apc-ledger-acct">{c.expense_account} {c.expense_account_label}</span>
                  <span className="apc-ledger-amt">{formatRp(amount)}</span>
                </div>
                <div className="apc-drawer-ledger-line">
                  <span className="apc-ledger-side cr">CR</span>
                  <span className="apc-ledger-acct">2-1300 Accrued Liabilities</span>
                  <span className="apc-ledger-amt">{formatRp(net)}</span>
                </div>
                {isPph && (
                  <div className="apc-drawer-ledger-line">
                    <span className="apc-ledger-side cr">CR</span>
                    <span className="apc-ledger-acct">2-1500 PPh 23 Payable</span>
                    <span className="apc-ledger-amt">{formatRp(pph)}</span>
                  </div>
                )}
              </div>

              {c.no_faktur_pajak_flag && (
                <div className="apc-drawer-note"><Spark size={11} /> PPN excluded — Faktur Pajak not yet received. PPN input credit is captured when the actual invoice arrives.</div>
              )}

              {skipping ? (
                <div className="apc-drawer-skip">
                  <div className="apc-drawer-skip-label">Reason for skipping</div>
                  <select className="apc-drawer-skip-select" value={skipReason} onChange={(e) => setSkipReason(e.target.value)}>
                    <option>Vendor does not invoice this period</option>
                    <option>Service not yet received</option>
                    <option>Invoice already expected shortly</option>
                    <option>Seasonal vendor — outside pattern</option>
                  </select>
                  <div className="apc-drawer-actions">
                    <button type="button" className="apc-btn-ghost" onClick={() => setSkipping(false)}>Back</button>
                    <button type="button" className="apc-drawer-skip-confirm" onClick={skipAccrual}>Confirm skip</button>
                  </div>
                </div>
              ) : canOperate ? (
                <div className="apc-drawer-actions">
                  <button type="button" className="apc-drawer-book" onClick={bookAccrual}>Book accrual</button>
                  <button type="button" className="apc-btn-ghost" onClick={() => { setAdjusting((a) => !a); if (!adjusting) setDraftAmount(st.amount); }}>
                    {adjusting ? "Done adjusting" : "Adjust amount"}
                  </button>
                  <button type="button" className="apc-drawer-skiplink" onClick={() => setSkipping(true)}>Skip this vendor</button>
                </div>
              ) : (
                <div className="apc-drawer-readonly"><Spark size={11} /> Klay suggested this accrual. Your Finance Manager books or skips it before close.</div>
              )}
            </div>
          </>
        );
      })()}

      {confirmOpen && <ConfirmDialog onCancel={() => setConfirmOpen(false)} onConfirm={confirmClose} />}
      {toast && <div className="apc-toast">{toast}</div>}
    </div>
  );
}
