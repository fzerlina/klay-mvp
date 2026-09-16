import { useMemo, useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { usePayments, PAYMENT_STATUS_META } from "../state/PaymentsContext";
import { useVendors } from "../state/VendorsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import RelationshipTierControl from "../components/RelationshipTier";
import RecordPaymentModal from "../components/RecordPaymentModal";
import { buildAgingLines, AGE_BUCKETS } from "../lib/apAging";
import { DEDUCTION_TYPES, breakdownTotal, cashOut, defaultBreakdown } from "../lib/paymentBreakdown";
import { FLAG_TIERS, makeFlagger, releaseState, tierCounts } from "../lib/paymentFlags";
import {
  PAYMENT_ROLES, REQ_META, bucketOf, gatesRelease as gatesReleaseFor, payModeFor, paymentStatusOf,
} from "../lib/paymentStage";
import { TODAY, daysSince } from "../lib/clock";
import { formatRupiah, formatRupiahExact, formatDateEn } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./ap-aging.css";
import "./payments.css";

const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const FLAG_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="pm-flag-ico"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const BOLT = <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;

function dueMeta(l) {
  const d = l.daysOverdue;
  if (d > 0) return { text: `${d}d late`, cls: "overdue" };
  if (d === 0) return { text: "Due today", cls: "due-soon" };
  return { text: `in ${-d}d`, cls: "" };
}

// Audit-trail wording for an executed payment. The total paid leads so the
// Bill Detail payment history can still read the amount off the line; the
// components follow so the trail says what the money actually was.
function auditText(bd, full) {
  const parts = DEDUCTION_TYPES
    .filter((t) => (bd[t.key] || 0) > 0)
    .map((t) => `${t.short.toLowerCase()} ${formatRupiah(bd[t.key])}`);
  const head = `${full ? "Payment executed" : "Partial payment"} — ${formatRupiah(breakdownTotal(bd))}`;
  return parts.length
    ? `${head} (to vendor ${formatRupiah(cashOut(bd))}, ${parts.join(", ")})`
    : head;
}

// ── Filter popover ─────────────────────────────────────────────────────────
// The filters live behind one Filter button rather than a row of chips, per the
// list-page pattern: a chip rail grows every time a filter is added and gives
// no room to say what a filter means. Grouped by what you are filtering ON, so
// the two status axes stay visibly separate here too.
const BLANK_FILTER = { checks: "any", due: "any", payment: "any", ages: [] };

const FILTER_GROUPS = (counts) => [
  {
    key: "checks",
    label: "Release checks",
    options: [
      ["any", "Any"],
      ["blocked", `Blocked${counts.blocked ? ` (${counts.blocked})` : ""}`],
      ["toreview", `Needs review${counts.needsAck ? ` (${counts.needsAck})` : ""}`],
    ],
  },
  {
    key: "due",
    label: "Due",
    options: [["any", "Any"], ["overdue", "Overdue"], ["due7", "Due in 7 days"]],
  },
  {
    key: "payment",
    label: "Payment status",
    options: [["any", "Any"], ["unpaid", "Unpaid"], ["partial", "Partial"]],
  },
];

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

function FilterPopover({ values, flagStats, onChange, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [draft, setDraft] = useState(values);
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleAge = (key) => setDraft((d) => ({
    ...d,
    ages: d.ages.includes(key) ? d.ages.filter((a) => a !== key) : [...d.ages, key],
  }));

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        {FILTER_GROUPS(flagStats).map((g) => (
          <div className="lg-filter-fld" key={g.key}>
            <div className="lg-filter-fld-lbl">{g.label}</div>
            <div className="lg-toggle-row">
              {g.options.map(([k, lbl]) => (
                <button
                  key={k}
                  className={`lg-toggle${draft[g.key] === k ? " on" : ""}`}
                  onClick={() => update({ [g.key]: k })}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">
            Age {draft.ages.length > 0 ? `(${draft.ages.length} selected)` : "(all)"}
          </div>
          <div className="lg-toggle-row">
            {AGE_BUCKETS.filter((b) => b.key !== "current").map((b) => (
              <button
                key={b.key}
                className={`lg-toggle${draft.ages.includes(b.key) ? " on" : ""}`}
                onClick={() => toggleAge(b.key)}
              >
                {b.lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={() => setDraft({ ...BLANK_FILTER })}>Reset</button>
        <button className="lg-filter-apply" onClick={() => { onChange(draft); onClose(); }}>Apply filter</button>
      </div>
    </div>
  );
}

const countActiveFilters = (f) =>
  (f.checks !== "any" ? 1 : 0) + (f.due !== "any" ? 1 : 0) + (f.payment !== "any" ? 1 : 0) + (f.ages.length > 0 ? 1 : 0);

// ── Table row ──────────────────────────────────────────────────────────────
// One column per thing you need to decide with: which invoice, who is being
// paid, when it is due, both status axes, what the bill was, and what is still
// payable on it. The destination bank account is deliberately NOT here — it is
// verified at release, on the flag panel and in the record-payment step, not
// scanned across a list.
function PaymentRow({
  line, reqStatus, payKey, roleCfg, selectable, selected, onToggleSelect,
  onAction, onSecondary, onOpen, flags, release, gated, expanded, onToggleExpand, onAcknowledge,
}) {
  const req = REQ_META[reqStatus] || REQ_META.notyet;
  const pay = PAYMENT_STATUS_META[payKey] || PAYMENT_STATUS_META.unpaid;
  const dm = dueMeta(line);
  // A blocking flag stops the money leaving, not the clerk asking. Gating the
  // request too would mean the flag is only ever seen by the person who raised
  // the payment — the release gate exists precisely so a second person sees it.
  const blocked = gated && release.blocked;
  const canAct = roleCfg && roleCfg.actsOn(reqStatus) && !blocked;
  const withheld = Math.min(line.pph23 || 0, line.remaining || 0);
  const isPaid = payKey === "paid";
  const counts = tierCounts(flags);
  return (
    <>
    <div className={`pm-row2${selected ? " selected" : ""}${blocked ? " blocked" : ""}`} onClick={onOpen}>
      <div onClick={(e) => e.stopPropagation()}>
        {selectable && canAct ? (
          <span className={`apa-checkbox${selected ? " checked" : ""}`} role="checkbox" aria-checked={selected} onClick={() => onToggleSelect(line.id)}>
            {selected && CHECK}
          </span>
        ) : <span aria-hidden />}
      </div>

      <div className="pm-cell-inv">
        <span className="pm-id">{line.invNo}</span>
        {flags.length > 0 && (
          <button
            type="button"
            className={`pm-flag-chip ${counts.blocking > 0 ? "danger" : counts.review > 0 ? "review" : "muted"}`}
            onClick={(e) => { e.stopPropagation(); onToggleExpand(line.id); }}
            aria-expanded={expanded}
          >
            {FLAG_ICON}
            {counts.blocking > 0 ? `${counts.blocking} blocking`
              : release.needsAck ? `${release.unacked.length} to review`
                : `${flags.length}`}
          </button>
        )}
      </div>

      <div className="pm-cell-payee">
        <span className="pm-vendor">{line.vendorName}</span>
        <RelationshipTierControl vendorId={line.vendorId} editable={false} />
      </div>

      <div className="pm-cell-due">
        <div>{formatDateEn(line.dueDate)}</div>
        <div className={`pm-due-sub ${dm.cls}`}>{dm.text}</div>
      </div>

      {/* The two axes get a column each. They move independently — a bill can
          be Partial on one and Approved on the other — so neither can be read
          off the other, and collapsing them into one cell hid that. */}
      <div className="pm-cell-pay">
        <span className={`bp-pay-badge ${pay.tone}`}>{pay.label}</span>
      </div>

      <div className="pm-cell-req">
        <span className={`pm-req-pill tone-${req.tone}`}>{req.label}</span>
      </div>

      <div className="pm-num pm-cell-total">{formatRupiah(line.total)}</div>

      {/* Payable is what is still owed on this bill — the amount a payment
          would clear. The withheld split sits under it because that is the part
          of the payable that never reaches the vendor. */}
      <div className="pm-cell-amt">
        <div className="pm-num pm-amt-main">{isPaid ? "—" : formatRupiah(line.remaining)}</div>
        {withheld > 0 && !isPaid && (
          <div className="pm-num pm-amt-split">
            {formatRupiah(line.remaining - withheld)} to vendor · {formatRupiah(withheld)} withheld
          </div>
        )}
      </div>

      <div className="pm-cell-action" onClick={(e) => e.stopPropagation()}>
        {canAct && roleCfg ? (
          <div className="pm-actions">
            {roleCfg.secondary && (
              <button className="apa-row-action ghost" onClick={() => onSecondary(line.id)}>{roleCfg.secondary}</button>
            )}
            <button className="apa-row-action" onClick={() => onAction(line.id)}>{roleCfg.short}</button>
          </div>
        ) : roleCfg && roleCfg.actsOn(reqStatus) && blocked ? (
          <button type="button" className="pm-blocked-btn" onClick={(e) => { e.stopPropagation(); onToggleExpand(line.id); }}>
            Blocked
          </button>
        ) : <span aria-hidden />}
      </div>
    </div>

    {expanded && flags.length > 0 && (
      <div className="pm-flag-panel">
        <div className="pm-flag-panel-head">
          Checks that fired when this payment was assembled — {line.invNo}
        </div>
        {flags.map((f) => {
          const acked = release.review.some((r) => r.key === f.key) && !release.unacked.some((r) => r.key === f.key);
          return (
            <div key={f.key} className={`pm-flag-item tier-${f.tier}`}>
              <span className={`pm-flag-tier tone-${FLAG_TIERS[f.tier].tone}`}>{FLAG_TIERS[f.tier].label}</span>
              <div className="pm-flag-body">
                <div className="pm-flag-label">{f.label}</div>
                <div className="pm-flag-detail">{f.detail}</div>
              </div>
              <div className="pm-flag-act">
                {f.tier === "review" && (acked
                  ? <span className="pm-flag-acked">Acknowledged</span>
                  : onAcknowledge
                    ? <button type="button" className="apa-row-action ghost" onClick={() => onAcknowledge(line.id, f.key)}>Acknowledge</button>
                    : null)}
                {f.tier === "blocking" && <span className="pm-flag-fix">Fix the record or drop the bill</span>}
              </div>
            </div>
          );
        })}
      </div>
    )}
    </>
  );
}

export default function PaymentsPage() {
  const navigate = useNavigate();
  const { bills, updateBill } = useBills();
  const { requestStatusOf, returnedOf, acksOf, requestPayment, approvePayment, markPaid, recordPayment, acknowledgeFlag, returnRequest } = usePayments();
  const { versionsOf } = useVendors();
  const { hasCapability, user } = useCurrentUser();

  // Role-scoped stage and action set — shared with Bill Detail (paymentStage.js)
  // so the same bill offers the same CTA wherever it is opened.
  const payMode = payModeFor(hasCapability);
  const roleCfg = PAYMENT_ROLES[payMode];
  const gatesRelease = gatesReleaseFor(payMode);

  // Primary axis = Payment request status; the role's own stage is the default
  // landing tab. Paid is the terminal tab on the payment axis.
  const [tab, setTab] = useState(payMode === "approve" ? "requested" : payMode === "execute" ? "approved" : "notyet");
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(() => ({ ...BLANK_FILTER }));
  const [filterOpen, setFilterOpen] = useState(false);
  const [payingLine, setPayingLine] = useState(null);
  const [expandedFlags, setExpandedFlags] = useState(null);

  // Posted, non-accrual bills — the payable universe.
  const postedLines = useMemo(
    () => buildAgingLines(TODAY, bills).filter((l) => !l.is_accrual && l.raw.je_number),
    [bills],
  );

  // Release checks run over the payable universe (the duplicate check needs the
  // peers) and read live vendor history, so a bank change made in Vendor Master
  // shows up here immediately.
  const flagsFor = useMemo(
    () => makeFlagger({ lines: postedLines, versionsOf, returnedOf }),
    [postedLines, versionsOf, returnedOf],
  );
  const flagsOf = useMemo(() => {
    const m = new Map();
    for (const l of postedLines) m.set(l.id, flagsFor(l));
    return m;
  }, [postedLines, flagsFor]);
  const releaseOf = (l) => releaseState(flagsOf.get(l.id) || [], acksOf(l.id));

  // The two axes, read independently — a bill can be Approved AND Partial.
  const payStatusOf = (l) => paymentStatusOf(l.raw);
  const reqOf = (l) => requestStatusOf(l.id);

  // Which tab a bill belongs to: fully paid bills leave the request pipeline
  // and land in Paid; everything else is slotted by where its current request
  // sits. A partly paid bill whose remainder has not been asked for yet shows
  // under "Not yet requested" carrying a Partial badge.
  const tabOf = (l) => bucketOf(payStatusOf(l), reqOf(l));

  // Search-filtered universe — the base the tab counts reflect.
  const searchBase = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return postedLines;
    return postedLines.filter((l) => l.vendorName.toLowerCase().includes(q) || (l.invNo || "").toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postedLines, search]);

  const counts = useMemo(() => {
    const c = { notyet: 0, requested: 0, approved: 0, paid: 0 };
    for (const l of searchBase) c[tabOf(l)] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchBase, requestStatusOf]);

  // Filter groups compose with AND — picking "Blocked" and "Overdue" means
  // both, which the old single-select chip rail could not express.
  const rows = useMemo(() => {
    let list = searchBase.filter((l) => tabOf(l) === tab);
    if (filter.checks === "blocked") list = list.filter((l) => releaseOf(l).blocked);
    else if (filter.checks === "toreview") list = list.filter((l) => releaseOf(l).needsAck);
    if (filter.due === "overdue") list = list.filter((l) => l.daysOverdue > 0);
    else if (filter.due === "due7") list = list.filter((l) => { const dd = -daysSince(l.dueDate); return dd >= 0 && dd <= 7; });
    if (filter.payment !== "any") list = list.filter((l) => payStatusOf(l) === filter.payment);
    if (filter.ages.length > 0) list = list.filter((l) => filter.ages.includes(l.ageBucket));
    // Most overdue first.
    return [...list].sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0) || b.remaining - a.remaining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchBase, tab, filter]);

  const tabs = [
    { k: "notyet", lbl: "Not yet requested", count: counts.notyet },
    { k: "requested", lbl: "Requested", count: counts.requested },
    { k: "approved", lbl: "Approved", count: counts.approved },
    { k: "paid", lbl: "Paid", count: counts.paid },
  ];

  const totalOpen = useMemo(
    () => postedLines.filter((l) => payStatusOf(l) !== "paid").reduce((s, l) => s + (l.remaining || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postedLines],
  );

  // Withholding is a payment-moment legal event, not an invoice-moment one:
  // every open bill carrying PPh is a certificate the tax office will expect.
  const withholding = useMemo(() => {
    const open = postedLines.filter((l) => payStatusOf(l) !== "paid" && (l.pph23 || 0) > 0);
    return { count: open.length, sum: open.reduce((s, l) => s + Math.min(l.pph23, l.remaining), 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postedLines]);

  // ── Actions ────────────────────────────────────────────────────────────
  // Executing in bulk still types the payment: each line gets the default
  // split (everything to the vendor, less whatever PPh the bill carries), so
  // there is no path that pays a bill off with an untyped amount.
  const runAction = (rawIds) => {
    // A blocking flag stops the money, whether it was reached one row at a time
    // or through a bulk release. Bulk silently skipping them would defeat the
    // check, so the action bar says how many were held back. The request stage
    // is deliberately ungated — see PaymentRow.
    const ids = gatesRelease
      ? rawIds.filter((id) => {
        const l = rows.find((r) => r.id === id);
        return l ? !releaseOf(l).blocked : true;
      })
      : rawIds;
    if (!ids.length) return;
    if (payMode === "request") requestPayment(ids, user?.name || "AP Staff");
    else if (payMode === "approve") approvePayment(ids, user?.name || "Finance Manager");
    else if (payMode === "execute") {
      const by = user?.name || "Finance Staff";
      const dateISO = TODAY.toISOString().slice(0, 10);
      const linesById = {};
      for (const id of ids) {
        const l = rows.find((r) => r.id === id);
        if (l) linesById[id] = { remaining: l.remaining, pph23: l.pph23 };
      }
      markPaid(ids, by, linesById);
      for (const id of ids) {
        const bd = defaultBreakdown(linesById[id] || {});
        updateBill(id, { pay: "paid", sisa: 0 }, { type: "paid", action: auditText(bd, true), by, date: dateISO, time: "" });
      }
    }
  };
  const runRow = (id) => {
    // The execute stage always opens the breakdown — a single payment is where
    // withholding and deductions actually get decided.
    if (payMode === "execute") { setPayingLine(rows.find((r) => r.id === id) || null); return; }
    runAction([id]);
  };
  const runBulk = () => { runAction([...selected]); setSelected(new Set()); };
  const onSecondary = (id) => {
    // Returning drops the bill back to "not yet requested" and raises an
    // exception on it, so it reappears in AP Staff's queue with the reason.
    if (payMode === "approve") { returnRequest([id], user?.name || "Finance Manager"); setSelected((p) => { const n = new Set(p); n.delete(id); return n; }); }
  };
  // Only the releaser can clear a review flag — that is the acknowledgement the
  // trail records against their name.
  const onAcknowledge = (id, flagKey) => acknowledgeFlag(id, flagKey, user?.name || "Finance Manager");
  const confirmPayment = (id, breakdown) => {
    const line = rows.find((r) => r.id === id);
    const by = user?.name || "Finance Staff";
    const dateISO = TODAY.toISOString().slice(0, 10);
    if (line) {
      const total = breakdownTotal(breakdown);
      const full = total >= line.remaining;
      recordPayment([{ id, breakdown, paysInFull: full }], by);
      updateBill(
        id,
        full ? { pay: "paid", sisa: 0 } : { sisa: line.remaining - total },
        { type: "paid", action: auditText(breakdown, full), by, date: dateISO, time: "" },
      );
    }
    setPayingLine(null);
    setSelected((p) => { const n = new Set(p); n.delete(id); return n; });
  };

  const toggleSelect = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // A selection is the closest thing this page has to a batch, so it carries
  // the same split the payments themselves will: cash out versus withheld —
  // and the same release checks.
  const selectedTotals = useMemo(() => {
    const picked = rows.filter((r) => selected.has(r.id));
    const withheld = picked.reduce((s, r) => s + Math.min(r.pph23 || 0, r.remaining || 0), 0);
    const total = picked.reduce((s, r) => s + (r.remaining || 0), 0);
    const blocked = picked.filter((r) => releaseOf(r).blocked).length;
    const needsAck = picked.filter((r) => releaseOf(r).needsAck).length;
    return { total, withheld, cash: total - withheld, blocked, needsAck };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selected, flagsOf]);

  // How much of the tab the checks are holding up. Shown on the filter chips so
  // the releaser can jump straight to the problems.
  const flagStats = useMemo(() => {
    let blocked = 0; let needsAck = 0;
    for (const l of rows) {
      const st = releaseOf(l);
      if (st.blocked) blocked += 1;
      else if (st.needsAck) needsAck += 1;
    }
    return { blocked, needsAck };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, flagsOf]);

  const activeFilterCount = countActiveFilters(filter);

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
                {roleCfg && <> You're working the <strong>{roleCfg.stage}</strong> stage.</>}
                {withholding.count > 0 && (
                  <> Of that, <strong>{formatRupiah(withholding.sum)}</strong> is withheld for the tax office across{" "}
                    <strong>{withholding.count}</strong> bill{withholding.count === 1 ? "" : "s"} — each one a bukti potong to issue.</>
                )}
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
              <div className="lg-filter-meta">
                {activeFilterCount > 0 && (
                  <button type="button" className="lg-filter-reset pm-filter-clear" onClick={() => setFilter({ ...BLANK_FILTER })}>
                    Reset all
                  </button>
                )}
                <div className="lg-meta-btn-wrap">
                  <button
                    type="button"
                    className={`lg-meta-btn${activeFilterCount > 0 ? " active" : ""}`}
                    onClick={() => setFilterOpen((o) => !o)}
                  >
                    <svg viewBox="0 0 12 12"><path d="M2 3h8M3 6h6M4 9h4" strokeLinecap="round" /></svg>
                    Filter
                    {activeFilterCount > 0 && <span className="lg-filter-badge">{activeFilterCount}</span>}
                  </button>
                  {filterOpen && (
                    <FilterPopover
                      values={filter}
                      flagStats={flagStats}
                      onChange={setFilter}
                      onClose={() => setFilterOpen(false)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* The table scrolls sideways on its own below ~900px of card
                width. Eight meaningful columns do not compress into a narrow
                pane, and clipping the action column silently is worse than a
                scrollbar. */}
            <div className="pm-table-scroll">
            <div className="pm-table2-head">
              <div />
              <div>Invoice no.</div>
              <div>Payment to</div>
              <div>Due date</div>
              <div>Payment status</div>
              <div>Request status</div>
              <div className="pm-num">Total bill</div>
              <div className="pm-num">Payable</div>
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
                  payKey={payStatusOf(line)}
                  roleCfg={roleCfg}
                  selectable={payMode !== "view"}
                  selected={selected.has(line.id)}
                  onToggleSelect={toggleSelect}
                  onAction={runRow}
                  onSecondary={onSecondary}
                  onOpen={() => navigate(`/bills/${line.id}`)}
                  flags={flagsOf.get(line.id) || []}
                  release={releaseOf(line)}
                  gated={gatesRelease}
                  expanded={expandedFlags === line.id}
                  onToggleExpand={(id) => setExpandedFlags((cur) => (cur === id ? null : id))}
                  onAcknowledge={payMode === "approve" ? onAcknowledge : null}
                />
              ))
            )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bulk action bar ─────────────────────────────────────────── */}
      {roleCfg && selected.size > 0 && (
        <div className="apa-action-bar">
          <div className="apa-action-bar-info">
            <span className="apa-action-bar-count">{selected.size} selected</span>
            <span className="apa-action-bar-total">
              {selectedTotals.withheld > 0
                ? <>Leaves the bank <strong>{formatRupiah(selectedTotals.cash)}</strong> · withheld <strong>{formatRupiah(selectedTotals.withheld)}</strong></>
                : <>Total <strong>{formatRupiah(selectedTotals.total)}</strong></>}
            </span>
            {selectedTotals.blocked > 0 && (
              <span className="pm-bar-warn">{selectedTotals.blocked} blocked — held back from this release</span>
            )}
          </div>
          <div className="apa-action-bar-actions">
            <button className="apa-action-bar-btn" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="apa-action-bar-btn primary" onClick={runBulk}>{BOLT}{roleCfg.bulk}</button>
          </div>
        </div>
      )}

      {payingLine && <RecordPaymentModal bill={payingLine} onConfirm={confirmPayment} onClose={() => setPayingLine(null)} />}
    </div>
  );
}
