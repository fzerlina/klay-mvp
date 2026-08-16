import { useMemo, useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { usePayments, PAYMENT_STATUS_META } from "../state/PaymentsContext";
import { useVendors } from "../state/VendorsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import RelationshipTierControl from "../components/RelationshipTier";
import { buildAgingLines, AGE_BUCKETS, RELATIONSHIP_LABEL } from "../lib/apAging";
import { TODAY, daysSince } from "../lib/clock";
import { formatRupiah, formatDateEn } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./ap-aging.css";
import "./payments.css";

// ── Request Status — the workflow axis, distinct from settlement ───────────
// Where a posted bill sits in the request → approve → pay pipeline. Paid bills
// are terminal ("Settled"); a partial bill's remainder drops back to "Not
// requested" so it can be requested again.
const REQ_META = {
  notyet:    { label: "Not yet requested", tone: "muted" },
  requested: { label: "Requested",     tone: "review" },
  approved:  { label: "Approved",      tone: "action" },
  returned:  { label: "Returned",      tone: "danger" },
  settled:   { label: "Settled",       tone: "success" },
};

// Role → the stage that persona works, and the action copy. Payment adapts to
// whoever is viewing (capabilities from roles.js): AP Staff request, FM approve,
// Finance Staff execute. Everyone else gets a read-only view.
const ROLE = {
  request: { rowLabel: "Request", bulkLabel: "Request payment", actsOn: (r) => r === "notyet" || r === "returned" },
  approve: { rowLabel: "Approve", bulkLabel: "Approve payment", secondary: "Return", actsOn: (r) => r === "requested" },
  execute: { rowLabel: "Mark paid", bulkLabel: "Mark as paid", secondary: "Partial", actsOn: (r) => r === "approved" },
  view:    null,
};

const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const BOLT = <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;

function dueMeta(l) {
  const d = l.daysOverdue;
  if (d > 0) return { text: `${d}d late`, cls: "overdue" };
  if (d === 0) return { text: "Due today", cls: "due-soon" };
  return { text: `in ${-d}d`, cls: "" };
}

// ── Partial-payment modal (execute stage) ─────────────────────────────────
function PartialPayModal({ line, onConfirm, onClose }) {
  const [raw, setRaw] = useState(String(line.remaining));
  const num = Number(String(raw).replace(/[^\d]/g, "")) || 0;
  const invalid = num <= 0 || num > line.remaining;
  const isFull = num >= line.remaining;
  return (
    <div className="apa-modal-scrim" onClick={onClose}>
      <div className="apa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="apa-modal-head">
          <h3>Record payment</h3>
          <button type="button" className="apa-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="apa-modal-body">
          <div className="apa-modal-row"><span>Vendor</span><strong>{line.vendorName}</strong></div>
          <div className="apa-modal-row"><span>Invoice</span><strong>{line.invNo}</strong></div>
          <div className="apa-modal-row"><span>Balance due</span><strong>{formatRupiah(line.remaining)}</strong></div>
          <label className="apa-modal-field">
            <span>Amount paid</span>
            <div className="apa-modal-input-wrap">
              <span className="apa-modal-prefix">Rp</span>
              <input inputMode="numeric" autoFocus value={num ? num.toLocaleString("id-ID") : ""} onChange={(e) => setRaw(e.target.value)} />
            </div>
          </label>
          <div className="apa-modal-helpers">
            <button type="button" onClick={() => setRaw(String(Math.round(line.remaining / 2)))}>50%</button>
            <button type="button" onClick={() => setRaw(String(line.remaining))}>Full balance</button>
          </div>
          <div className="apa-modal-note">
            {invalid ? "Enter an amount between Rp 1 and the balance due."
              : isFull ? "Full amount — this settles the bill and marks it Paid."
              : `Remaining after this payment: ${formatRupiah(line.remaining - num)}. Re-enters the request queue.`}
          </div>
        </div>
        <div className="apa-modal-foot">
          <button type="button" className="apa-modal-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="apa-modal-btn primary" disabled={invalid} onClick={() => onConfirm(line.id, num)}>
            {isFull ? "Mark as paid" : "Mark partial"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Table row ──────────────────────────────────────────────────────────────
function PaymentRow({ line, reqStatus, settleKey, roleCfg, selectable, selected, onToggleSelect, onAction, onSecondary, onOpen }) {
  const req = REQ_META[reqStatus] || REQ_META.notyet;
  const settle = PAYMENT_STATUS_META[settleKey] || PAYMENT_STATUS_META.unpaid;
  const dm = dueMeta(line);
  const canAct = roleCfg && roleCfg.actsOn(reqStatus);
  return (
    <div className={`pm-row2${selected ? " selected" : ""}`} onClick={onOpen}>
      <div onClick={(e) => e.stopPropagation()}>
        {selectable && canAct ? (
          <span className={`apa-checkbox${selected ? " checked" : ""}`} role="checkbox" aria-checked={selected} onClick={() => onToggleSelect(line.id)}>
            {selected && CHECK}
          </span>
        ) : <span aria-hidden />}
      </div>
      <div className="pm-cell-bill">
        <div className="pm-bill-top">
          <span className="pm-id">{line.invNo}</span>
        </div>
        <div className="pm-bill-sub">
          <span className="pm-vendor">{line.vendorName}</span>
          <RelationshipTierControl vendorId={line.vendorId} editable={false} />
        </div>
      </div>
      <div className="pm-cell-due">
        <div>{formatDateEn(line.dueDate)}</div>
        <div className={`pm-due-sub ${dm.cls}`}>{dm.text}</div>
      </div>
      <div><span className={`pm-req-pill tone-${req.tone}`}>{req.label}</span></div>
      <div><span className={`bp-pay-badge ${settle.tone}`}>{settle.label}</span></div>
      <div className="pm-num">{settleKey === "paid" ? formatRupiah(line.total) : formatRupiah(line.remaining)}</div>
      <div className="pm-cell-action" onClick={(e) => e.stopPropagation()}>
        {canAct && roleCfg ? (
          <div className="pm-actions">
            {roleCfg.secondary && (
              <button className="apa-row-action ghost" onClick={() => onSecondary(line.id)}>{roleCfg.secondary}</button>
            )}
            <button className="apa-row-action" onClick={() => onAction(line.id)}>{roleCfg.rowLabel}</button>
          </div>
        ) : <span aria-hidden />}
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  const navigate = useNavigate();
  const { bills, updateBill } = useBills();
  const { statusOf, requestPayment, approvePayment, markPaid, markPartial, returnPayment } = usePayments();
  const { tierOf } = useVendors();
  const { hasCapability, user } = useCurrentUser();

  // Role-scoped stage (capabilities from roles.js).
  const payMode = hasCapability("payment.approve") ? "approve"
    : hasCapability("payment.request") ? "request"
    : hasCapability("payment.execute") ? "execute"
    : "view";
  const roleCfg = ROLE[payMode];

  // Primary axis = Payment request status; the role's own stage is the default
  // landing tab. Paid is the terminal (settlement) tab.
  const [tab, setTab] = useState(payMode === "approve" ? "requested" : payMode === "execute" ? "approved" : "notyet");
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState(null);            // null | "due7" | "overdue" | "age:*" | "req:*"
  const [partialFor, setPartialFor] = useState(null);

  // Posted, non-accrual bills — the payable universe.
  const postedLines = useMemo(
    () => buildAgingLines(TODAY, bills).filter((l) => !l.is_accrual && l.raw.je_number),
    [bills],
  );

  const settleOf = (l) => {
    const k = l.raw.pay === "paid" ? "paid" : statusOf(l.id);
    if (k === "paid" || k === "reconciled") return "paid";
    if (k === "partial") return "partial";
    return "unpaid";
  };
  const reqOf = (l) => {
    if (l.raw.pay === "paid") return "settled";
    const k = statusOf(l.id);
    if (k === "requested") return "requested";
    if (k === "approved") return "approved";
    if (k === "returned") return "returned";
    return "notyet"; // unpaid or partial-remainder
  };

  // Which tab a bill belongs to: settled bills go to Paid; everything else is
  // slotted by its request stage. (A partially-paid bill's remainder is "not yet
  // requested", so it lands there — its Partial payment-status shows on the row.)
  const tabOf = (l) => (settleOf(l) === "paid" ? "paid" : reqOf(l));

  // Search-filtered universe — the base the tab counts reflect.
  const searchBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return postedLines;
    return postedLines.filter((l) => l.vendorName.toLowerCase().includes(q) || (l.invNo || "").toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postedLines, search, statusOf]);

  const counts = useMemo(() => {
    const c = { notyet: 0, requested: 0, approved: 0, returned: 0, paid: 0 };
    for (const l of searchBase) c[tabOf(l)] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchBase, statusOf]);

  const rows = useMemo(() => {
    let list = searchBase.filter((l) => tabOf(l) === tab);
    if (quick === "due7") list = list.filter((l) => { const dd = -daysSince(l.dueDate); return dd >= 0 && dd <= 7; });
    else if (quick === "overdue") list = list.filter((l) => l.daysOverdue > 0);
    else if (quick === "partial") list = list.filter((l) => settleOf(l) === "partial");
    else if (quick && quick.startsWith("age:")) list = list.filter((l) => l.ageBucket === quick.slice(4));
    // Most overdue first.
    return [...list].sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0) || b.remaining - a.remaining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchBase, tab, quick]);

  const tabs = [
    { k: "notyet", lbl: "Not yet requested", count: counts.notyet },
    { k: "requested", lbl: "Requested", count: counts.requested },
    { k: "approved", lbl: "Approved", count: counts.approved },
    { k: "returned", lbl: "Returned", count: counts.returned },
    { k: "paid", lbl: "Paid", count: counts.paid },
  ];

  const totalOpen = useMemo(
    () => postedLines.filter((l) => settleOf(l) !== "paid").reduce((s, l) => s + (l.remaining || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postedLines, statusOf],
  );

  // ── Actions ────────────────────────────────────────────────────────────
  const runAction = (ids) => {
    if (!ids.length) return;
    if (payMode === "request") requestPayment(ids, user?.name || "AP Staff");
    else if (payMode === "approve") approvePayment(ids, user?.name || "Finance Manager");
    else if (payMode === "execute") {
      markPaid(ids, user?.name || "Finance Staff");
      for (const id of ids) updateBill(id, { pay: "paid", sisa: 0 }, { type: "paid", action: "Payment executed & marked paid", by: user?.name || "Finance Staff", date: TODAY.toISOString().slice(0, 10), time: "" });
    }
  };
  const runRow = (id) => runAction([id]);
  const runBulk = () => { runAction([...selected]); setSelected(new Set()); };
  const onSecondary = (id) => {
    if (payMode === "approve") { returnPayment([id], user?.name || "Finance Manager"); setSelected((p) => { const n = new Set(p); n.delete(id); return n; }); }
    else if (payMode === "execute") setPartialFor(rows.find((r) => r.id === id) || null);
  };
  const confirmPartial = (id, amount) => {
    const line = rows.find((r) => r.id === id);
    const by = user?.name || "Finance Staff";
    const dateISO = TODAY.toISOString().slice(0, 10);
    if (line && amount > 0 && amount < line.remaining) {
      markPartial([id], by, amount);
      updateBill(id, { sisa: line.remaining - amount }, { type: "paid", action: `Partial payment — ${formatRupiah(amount)}`, by, date: dateISO, time: "" });
    } else if (line) {
      markPaid([id], by);
      updateBill(id, { pay: "paid", sisa: 0 }, { type: "paid", action: "Payment executed & marked paid", by, date: dateISO, time: "" });
    }
    setPartialFor(null);
    setSelected((p) => { const n = new Set(p); n.delete(id); return n; });
  };

  const toggleSelect = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedTotal = useMemo(() => rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.remaining, 0), [rows, selected]);

  const QUICK_CHIPS = [
    { k: "overdue", lbl: "Overdue" },
    { k: "due7", lbl: "Due in 7 days" },
    { k: "partial", lbl: "Partial" },
    ...AGE_BUCKETS.filter((b) => b.key !== "current").map((b) => ({ k: `age:${b.key}`, lbl: b.lbl })),
  ];

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Payment</h1>
              <p className="pm-lede">
                Posted bills by <strong>payment request status</strong> — <strong>{formatRupiah(totalOpen)}</strong> still open.
                {roleCfg && <> You're working the <strong>{payMode === "request" ? "request" : payMode === "approve" ? "approval" : "execution"}</strong> stage.</>}
              </p>
            </div>
          </div>
        </div>

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card bp-card">
            <div className="bp-tabs-row">
              {tabs.map((t) => (
                <button key={t.k} className={`bp-tab${tab === t.k ? " active" : ""}`} onClick={() => { setTab(t.k); setSelected(new Set()); }}>
                  {t.lbl}
                  <span className="bp-tab-count">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row pm-filter-row">
              <div className="apa-search">
                <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" /></svg>
                <input className="apa-search-input" placeholder="Search vendor or invoice…" value={search} onChange={(e) => setSearch(e.target.value)} />
                {search && <button type="button" className="apa-search-clear" onClick={() => setSearch("")} aria-label="Clear search">×</button>}
              </div>
              <div className="pm-quick">
                {QUICK_CHIPS.map((c) => (
                  <button key={c.k} type="button" className={`apa-fchip${quick === c.k ? " active" : ""}`} onClick={() => setQuick(quick === c.k ? null : c.k)}>{c.lbl}</button>
                ))}
              </div>
            </div>

            <div className="pm-table2-head">
              <div />
              <div>Bill · Vendor</div>
              <div>Due</div>
              <div>Payment request status</div>
              <div>Payment status</div>
              <div className="pm-num">Remaining balance</div>
              <div />
            </div>

            {rows.length === 0 ? (
              <div className="pm-empty">No posted bills in this state.</div>
            ) : (
              rows.map((line) => (
                <PaymentRow
                  key={line.id}
                  line={line}
                  reqStatus={reqOf(line)}
                  settleKey={settleOf(line)}
                  roleCfg={roleCfg}
                  selectable={payMode !== "view"}
                  selected={selected.has(line.id)}
                  onToggleSelect={toggleSelect}
                  onAction={runRow}
                  onSecondary={onSecondary}
                  onOpen={() => navigate(`/bills/${line.id}`)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Bulk action bar ─────────────────────────────────────────── */}
      {roleCfg && selected.size > 0 && (
        <div className="apa-action-bar">
          <div className="apa-action-bar-info">
            <span className="apa-action-bar-count">{selected.size} selected</span>
            <span className="apa-action-bar-total">Total <strong>{formatRupiah(selectedTotal)}</strong></span>
          </div>
          <div className="apa-action-bar-actions">
            <button className="apa-action-bar-btn" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="apa-action-bar-btn primary" onClick={runBulk}>{BOLT}{roleCfg.bulkLabel}</button>
          </div>
        </div>
      )}

      {partialFor && <PartialPayModal line={partialFor} onConfirm={confirmPartial} onClose={() => setPartialFor(null)} />}
    </div>
  );
}
