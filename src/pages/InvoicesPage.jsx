import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CUSTOMERS as customers } from "../data/seed/customers";
import { useInvoices } from "../state/InvoicesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { TODAY, daysSince } from "../lib/clock";
import { formatRupiah, formatDateEn, initials } from "../lib/format";
import AiChatDrawer from "./AiChatDrawer";
import { makeInvoicesAiContext } from "./ai-invoices-context";
import "./modules.css";
import "./invoice-create.css";
import "./invoices-ledger.css";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtRp(n) {
  if (n == null) return "—";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function fmtRpShort(n) {
  if (n == null) return "—";
  if (n >= 1e9) return "Rp " + (n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " M";
  if (n >= 1e6) return "Rp " + (n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " jt";
  return "Rp " + n.toLocaleString("id-ID");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatMonthLabel(yyyymm) {
  if (!yyyymm || yyyymm.length < 7) return "—";
  const [y, m] = yyyymm.split("-");
  const idx = parseInt(m, 10) - 1;
  return `${MONTHS[idx] || m} ${y}`;
}

// First two meaningful words (skipping legal prefixes) for "3 customer (X, Y, Z)" copy
function shortName(name) {
  if (!name) return "—";
  const tokens = name.split(/\s+/).filter((t) => t && !/^(PT|CV|UD|Toko|Cooperative)$/i.test(t));
  return tokens.slice(0, 2).join(" ");
}

const APPROVAL_LABEL = { sent: "Sent", draft: "Draft", auto: "Auto", anomaly: "Anomaly" };
const PAY_LABEL = { paid: "Paid", overdue: "Overdue", unpaid: "Unpaid" };

// ── Klay command bar: intent + filter parsing (mock; replace with LLM later) ──
const INV_REF_RE = /^INV-[A-Z0-9]+-\d+$/i;
const ACTION_VERB_RE = /^(send|remind|draft|generate|create|issue|email|whatsapp)\s+/i;
const QUESTION_LEAD_RE = /^(what|why|how|when|where|who|which|whose|explain|show|tell|can|could|should|is|are|do|does|did|will|would|may|might)\b/i;

function detectKlayIntent(q) {
  const trimmed = q.trim();
  if (!trimmed) return null;
  if (INV_REF_RE.test(trimmed)) return "lookup";
  if (trimmed.endsWith("?") || QUESTION_LEAD_RE.test(trimmed)) return "question";
  if (ACTION_VERB_RE.test(trimmed)) return "action";
  return "filter";
}

function parseKlayFilters(q) {
  const out = {};
  const lower = q.toLowerCase();
  if (/\bauto\b/.test(lower)) out.status = "auto";
  else if (/\bdrafts?\b/.test(lower)) out.status = "draft";
  else if (/\bsent\b/.test(lower)) out.status = "sent";
  if (/\boverdue\b/.test(lower) || /\blate\b/.test(lower)) out.payStatus = "overdue";
  else if (/\bpaid\b/.test(lower)) out.payStatus = "paid";
  if (/\bfrom\s+whats?app\b|\bvia\s+whats?app\b|\bwhats?app\b/.test(lower)) out.source = "whatsapp";
  else if (/\bfrom\s+email\b|\bvia\s+email\b/.test(lower)) out.source = "email";
  const mShort = lower.match(/(\d+(?:[.,]\d+)?)\s*([mb])\b/);
  if (mShort) {
    const n = parseFloat(mShort[1].replace(",", "."));
    out.amountMin = Math.round(n * (mShort[2] === "b" ? 1e9 : 1e6));
  } else {
    const mLong = lower.match(/(?:above|over|>=?|min(?:imum)?)\s*rp?\s*([\d.,]+)/);
    if (mLong) out.amountMin = parseInt(mLong[1].replace(/[.,]/g, ""), 10);
  }
  if (/\bthis\s+week\b/.test(lower)) out.dateRange = "thisWeek";
  else if (/\bthis\s+month\b/.test(lower)) out.dateRange = "thisMonth";
  if (/\b(90\+|over\s*90|>\s*90)\b/.test(lower)) out.aging = "90+";
  else if (/\b60[-\s]*90\b/.test(lower)) out.aging = "60-90";
  else if (/\b30[-\s]*60\b/.test(lower)) out.aging = "30-60";
  else if (/\b0[-\s]*30\b/.test(lower)) out.aging = "0-30";
  if (Object.keys(out).length === 0) out.freeText = q.trim();
  return out;
}

function klayChipLabel(key, val) {
  if (key === "status") return `Status: ${val[0].toUpperCase()}${val.slice(1)}`;
  if (key === "payStatus") return `${val === "paid" ? "Paid" : "Overdue"}`;
  if (key === "source") return `From ${val === "whatsapp" ? "WhatsApp" : "Email"}`;
  if (key === "amountMin") return `≥ Rp ${val.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
  if (key === "dateRange") return val === "thisWeek" ? "This week" : "This month";
  if (key === "aging") return `Aging ${val}`;
  if (key === "freeText") return `“${val}”`;
  return String(val);
}

// Auto-invoices: mock dataset of drafts Klay AI parsed from WhatsApp / email
const AUTO_PROCESSED_COUNT = 8;
const ANOMALY_COUNT = 4;

function generateInvoiceAnomaly(inv, idx) {
  const cust = inv.customerName || "this customer";
  const totalShort = inv.total >= 1e9 ? `${(inv.total / 1e9).toFixed(1)} M` : `${(inv.total / 1e6).toFixed(1)} jt`;
  const templates = [
    `PO total Rp ${(inv.total * 0.78 / 1e6).toFixed(1)} jt doesn't match invoice total Rp ${totalShort} (22% variance).`,
    `Possible duplicate — same customer + amount as an invoice sent 4 days ago.`,
    `Unusual amount: 2.5× ${cust}'s typical order size in the last 6 months.`,
    `Customer terms say NET 30 but due date set to 14 days — confirm with ${cust}.`,
  ];
  return templates[idx % templates.length];
}

function generateInvoiceAiSummary(inv, source) {
  const n = inv.items?.length || 1;
  const cust = inv.customerName || "the customer";
  const po = inv.custPO && inv.custPO !== "—" ? inv.custPO : null;
  const totalShort =
    inv.total >= 1e9 ? `Rp ${(inv.total / 1e9).toFixed(1)} M`
    : inv.total >= 1e6 ? `Rp ${(inv.total / 1e6).toFixed(1)} jt`
    : `Rp ${inv.total?.toLocaleString("id-ID")}`;
  const conf = Math.round(88 + (parseInt(String(inv.id).replace(/\D/g, ""), 10) % 11));
  if (source === "whatsapp") {
    return po
      ? `Matched ${n} line items to PO ${po} from ${cust}. ${conf}% match to this customer's prior orders.`
      : `Parsed ${n} line items from ${cust}'s WhatsApp. ${conf}% pattern match to recent invoices.`;
  }
  return po
    ? `Extracted ${n} line items + PO ${po} from ${cust} email. ${conf}% match to ${cust}'s billing template.`
    : `Parsed ${n} line items from ${cust}'s email${inv.custEmail ? ` (${inv.custEmail})` : ""}. ${conf}% confidence.`;
}

function payBadgeClass(payStatus) {
  if (payStatus === "paid") return "badge-paid";
  if (payStatus === "overdue") return "badge-overdue";
  return "badge-unpaid";
}

// Map our internal invoice + customer master into the ledger row shape
function toRow(inv) {
  const cust = customers.find((c) => c.id === inv.customer);
  const dOver = daysSince(inv.due); // positive = late; negative = not yet due
  return {
    id: inv.id,
    no: inv.invNo === "—" ? "(Draft)" : inv.invNo,
    tgl: formatDateEn(inv.date),
    co: inv.customerName,
    addr: cust?.address || "",
    due: formatDateEn(inv.due),
    daysOverdue: dOver,
    total: inv.total,
    approval: inv.approval,
    payStatus: inv.payStatus,
    isAI: inv.isAI,
    raw: inv,
  };
}

// ─── Components ─────────────────────────────────────────────────────────────

function SparkleIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.5l1.1 2.7L9.8 5l-2.7 0.8L6 8.5l-1.1-2.7L2.2 5l2.7-0.8L6 1.5z" />
      <path d="M10 8.5l0.4 1L11.5 10l-1.1 0.4L10 11.5l-0.4-1.1L8.5 10l1.1-0.5L10 8.5z" />
    </svg>
  );
}

function KlayCommandBar({ inputRef, value, onChange, onSubmit, onClear, chips, onRemoveChip, onClearChips }) {
  return (
    <div className="lg-klay-bar">
      <span className="lg-klay-bar-icon" aria-hidden><SparkleIcon /></span>
      <input
        ref={inputRef}
        className="lg-klay-bar-input"
        placeholder="Search, filter, or ask Klay…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          else if (e.key === "Escape") { e.preventDefault(); onClear(); }
        }}
      />
      {chips.map((c) => (
        <span key={c.id} className="lg-klay-chip">
          {c.label}
          <button type="button" className="lg-klay-chip-x" onClick={() => onRemoveChip(c)} aria-label={`Remove ${c.label}`}>
            <svg viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
          </button>
        </span>
      ))}
      {chips.length > 0 && (
        <button type="button" className="lg-klay-chips-clear" onClick={onClearChips}>Clear all</button>
      )}
      <span className="lg-klay-bar-hint" aria-hidden>⌘K</span>
    </div>
  );
}

function KlayActionModal({ intent, onClose }) {
  if (!intent) return null;
  return (
    <div className="lg-klay-modal-backdrop" onClick={onClose}>
      <div className="lg-klay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lg-klay-modal-head">
          <span className="lg-klay-bar-icon" aria-hidden><SparkleIcon /></span>
          <div className="lg-klay-modal-title">Draft invoice</div>
        </div>
        <div className="lg-klay-modal-body">
          Klay detected an <strong>action</strong> intent from your query: <code>{intent.query}</code>.
          <br /><br />
          The draft invoice flow will open here once it's wired up.
        </div>
        <div className="lg-klay-modal-foot">
          <button className="lg-klay-modal-btn" onClick={onClose}>Close</button>
          <button className="lg-klay-modal-btn primary" onClick={onClose}>Open draft (soon)</button>
        </div>
      </div>
    </div>
  );
}

const AGING_BUCKETS = [
  { key: "90+",    lbl: "Overdue > 90 days",    minDays: 90, maxDaysCap: 150, tone: "danger" },
  { key: "60-90",  lbl: "Overdue 60-90 days", minDays: 60, maxDaysCap: 90,  tone: "danger" },
  { key: "30-60",  lbl: "Overdue 30-60 days", minDays: 30, maxDaysCap: 60,  tone: "warn"   },
  { key: "0-30",   lbl: "Overdue < 30 days",    minDays:  0, maxDaysCap: 30,  tone: "warn"   },
];

function bucketOf(daysOverdue) {
  if (daysOverdue >= 90) return "90+";
  if (daysOverdue >= 60) return "60-90";
  if (daysOverdue >= 30) return "30-60";
  if (daysOverdue >= 0)  return "0-30";
  return null;
}

function LedgerRow({ r, bucket, isChecked, onCheck, onClick, onKebab, isSelected, isAlt }) {
  const isOverdue = r.payStatus === "overdue" && r.daysOverdue > 0;
  const isPaid = r.payStatus === "paid";
  const isDraft = r.approval === "draft";
  const isAuto = r.approval === "auto";
  const isAnomaly = r.approval === "anomaly";

  const dotTone =
    isAnomaly ? "" :
    isAuto ? "" :
    isOverdue ? (bucket?.tone === "warn" ? "warn" : "") :
    isPaid ? "success" :
    "muted";

  const pct = isOverdue && bucket
    ? Math.min(100, Math.max(8, ((r.daysOverdue - bucket.minDays) / ((bucket.maxDaysCap - bucket.minDays) || 30)) * 100))
    : 0;

  return (
    <div className={`lg-row${isSelected ? " selected" : ""}${isAlt ? " alt" : ""}${isAuto ? " auto" : ""}${isAnomaly ? " anomaly" : ""}`} onClick={onClick}>
      <div onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="lg-row-check" checked={isChecked} onChange={() => onCheck(r.id)} />
      </div>
      <div className="lg-cell-no">{r.no}</div>
      <div className="lg-cell-date">{r.tgl}</div>
      <div className="lg-cell-customer">
        <span className={`lg-cell-customer-dot${dotTone ? " " + dotTone : ""}`} />
        <div className="lg-cell-customer-body">
          <div className="lg-cell-customer-name">{r.co}</div>
          {isAnomaly && r.raw.anomaly ? (
            <div className="je-desc-anomaly" style={{ marginTop: 1 }}>
              <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor" stroke="none"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff" stroke="none"/></svg>
              <span className="je-desc-ai-text">{r.raw.anomaly}</span>
            </div>
          ) : isAuto && r.raw.ai_summary ? (
            <div className="je-desc-ai" style={{ marginTop: 1 }}>
              <SparkleIcon />
              <span className="je-desc-ai-text">{r.raw.ai_summary}</span>
            </div>
          ) : (
            <div className="lg-cell-customer-addr">{r.addr}</div>
          )}
        </div>
      </div>
      <div className="lg-cell-days">
        {isOverdue ? (
          <>{r.daysOverdue}<span className="lg-cell-days-suffix">d</span></>
        ) : (
          <span className="lg-cell-em-dash">—</span>
        )}
      </div>
      <div className="lg-cell-due">{r.due}</div>
      <div>
        {isAnomaly ? (
          <span className="badge badge-anomaly">
            <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor" stroke="none"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff" stroke="none"/></svg>
            Anomaly
          </span>
        ) : isAuto ? (
          <span className="badge badge-auto">
            <SparkleIcon />
            Auto · {r.raw.ai_source === "whatsapp" ? "WA" : "Email"}
          </span>
        ) : isOverdue ? (
          <>
            <div className="lg-cell-aging-track">
              <div
                className={`lg-cell-aging-fill${bucket?.tone === "warn" ? " warn" : ""}`}
                style={{ width: pct + "%" }}
              />
            </div>
            <div className="lg-cell-aging-scale">
              {bucket.minDays} ←—— {bucket.maxDaysCap} days
            </div>
          </>
        ) : isPaid ? (
          <span className="lg-cell-status-marker success"><span className="dot" />Paid</span>
        ) : isDraft ? (
          <span className="lg-cell-status-marker"><span className="dot" />Not yet sent</span>
        ) : (
          <span className="lg-cell-status-marker"><span className="dot" />Within terms</span>
        )}
      </div>
      <div className="lg-cell-total">
        <span className="lg-cell-total-rp">Rp</span>{fmtRp(r.total)}
      </div>
      <div className="lg-cell-kebab" onClick={(e) => e.stopPropagation()}>
        <button className="lg-kebab" onClick={() => onKebab(r.id)}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
        </button>
      </div>
    </div>
  );
}

function RowMenu({ inv, onClose, onAction }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  const canPay = inv.approval === "sent" && inv.payStatus !== "paid";
  return (
    <div className="row-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div className="row-menu-item" onClick={() => onAction("edit", inv)}>
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit
      </div>
      {canPay && (
        <div className="row-menu-item" onClick={() => onAction("payment", inv)}>
          <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          Catat Payment
        </div>
      )}
      <div className="row-menu-item" onClick={() => onAction("recurring", inv)}>
        <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        Create Berulang
      </div>
      <div className="row-menu-item" onClick={() => onAction("duplicate", inv)}>
        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        Duplicate
      </div>
      <div className="row-menu-sep" />
      <div className="row-menu-item danger" onClick={() => onAction("archive", inv)}>
        <svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
        Archive
      </div>
    </div>
  );
}

const AISvg = () => (
  <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
);

// ── Sort + Group popovers ─────────────────────────────────────────────────

const SORT_LABELS = {
  "days-late-desc": "Days Overdue ↓",
  "date-desc":    "Newest date ↓",
  "date-asc":     "Date oldest ↑",
  "total-desc":      "Total highest ↓",
  "total-asc":       "Total lowest ↑",
  "customer-asc":    "Customer A-Z",
  "customer-desc":   "Customer Z-A",
};

const GROUP_LABELS = {
  "none":     "—",
  "aging":    "Aging",
  "customer": "Customer",
  "bulan":    "Month",
  "status":   "Payment Status",
};

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

function SortPopover({ value, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        {Object.entries(SORT_LABELS).map(([k, lbl]) => (
          <button
            key={k}
            className={`lg-popover-item${value === k ? " selected" : ""}`}
            onClick={() => onPick(k)}
          >
            {lbl}
            {value === k && <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupPopover({ value, canAging, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const items = [
    { k: "none",     lbl: "Not grouped" },
    { k: "aging",    lbl: "Aging", disabled: !canAging },
    { k: "customer", lbl: "Customer" },
    { k: "bulan",    lbl: "Month (Date Invoice)" },
    { k: "status",   lbl: "Payment Status" },
  ];
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        {items.map((it) => (
          <button
            key={it.k}
            className={`lg-popover-item${value === it.k ? " selected" : ""}`}
            disabled={it.disabled}
            onClick={() => !it.disabled && onPick(it.k)}
          >
            {it.lbl}
            {value === it.k && <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterPopover({ values, onChange, customers: custList, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [draft, setDraft] = useState(values);
  const [custSearch, setCustSearch] = useState("");

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleCust = (id) => {
    setDraft((d) => {
      const next = new Set(d.customers);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...d, customers: next };
    });
  };

  const filteredCusts = custList.filter((c) =>
    !custSearch || c.name.toLowerCase().includes(custSearch.toLowerCase()),
  );

  const reset = () => {
    setDraft({
      customers: new Set(),
      minAmount: "",
      maxAmount: "",
      dateFrom: "",
      dateTo: "",
      dateField: "date",
      source: "all",
    });
  };
  const apply = () => { onChange(draft); onClose(); };

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Customer ({draft.customers.size > 0 ? `${draft.customers.size} selected` : "all"})</div>
          <div className="lg-cust-multi">
            <div className="lg-cust-search">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="5" cy="5" r="3"/><path d="M7.5 7.5l3 3"/></svg>
              <input
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                placeholder="Search customer…"
              />
            </div>
            <div className="lg-cust-list">
              {filteredCusts.length === 0 && (
                <div className="lg-cust-empty">No matching customer</div>
              )}
              {filteredCusts.map((c) => (
                <label key={c.id} className="lg-cust-item">
                  <input type="checkbox" checked={draft.customers.has(c.id)} onChange={() => toggleCust(c.id)} />
                  <span className="lg-cust-item-name">{c.name}</span>
                  <span className="lg-cust-item-count">{c.count}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Range Nominal (Rp)</div>
          <div className="lg-filter-row2">
            <input
              type="number"
              className="lg-filter-input"
              placeholder="Min"
              value={draft.minAmount}
              onChange={(e) => update({ minAmount: e.target.value })}
            />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>—</span>
            <input
              type="number"
              className="lg-filter-input"
              placeholder="Max"
              value={draft.maxAmount}
              onChange={(e) => update({ maxAmount: e.target.value })}
            />
          </div>
        </div>

        <div className="lg-filter-fld">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="lg-filter-fld-lbl">Range Date</div>
            <div className="lg-segmented">
              <button
                className={`lg-seg${draft.dateField === "date" ? " on" : ""}`}
                onClick={() => update({ dateField: "date" })}
              >
                Date Invoice
              </button>
              <button
                className={`lg-seg${draft.dateField === "due" ? " on" : ""}`}
                onClick={() => update({ dateField: "due" })}
              >
                Overdue
              </button>
            </div>
          </div>
          <div className="lg-filter-row2">
            <input
              type="date"
              className="lg-filter-input"
              value={draft.dateFrom}
              onChange={(e) => update({ dateFrom: e.target.value })}
            />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>—</span>
            <input
              type="date"
              className="lg-filter-input"
              value={draft.dateTo}
              onChange={(e) => update({ dateTo: e.target.value })}
            />
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Sumber</div>
          <div className="lg-toggle-row">
            {[["all", "All"], ["ai", "AI"], ["manual", "Manual"]].map(([k, lbl]) => (
              <button
                key={k}
                className={`lg-toggle${draft.source === k ? " on" : ""}`}
                onClick={() => update({ source: k })}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={reset}>Reset</button>
        <button className="lg-filter-apply" onClick={apply}>Apply filter</button>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { invoices, sendInvoice } = useInvoices();
  const { hasLevel } = useCurrentUser();
  const canTransact = hasLevel("ar", "transact");

  const [filter, setFilter] = useState({ kind: "tab", value: "all" });
  // Sort + group choices override per-tab defaults when non-null
  const [sortChoice, setSortChoice]   = useState(null);
  const [groupChoice, setGroupChoice] = useState(null);
  // Advanced filter (applied additively on top of pill/card)
  const emptyFilters = {
    customers: new Set(),
    minAmount: "",
    maxAmount: "",
    dateFrom: "",
    dateTo: "",
    dateField: "date", // 'date' | 'due'
    source: "all",     // 'all' | 'ai' | 'manual'
  };
  const [filterValues, setFilterValues] = useState(emptyFilters);
  // Popover open flags
  const [sortPopOpen, setSortPopOpen]     = useState(false);
  const [groupPopOpen, setGroupPopOpen]   = useState(false);
  const [filterPopOpen, setFilterPopOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [drawerTab, setDrawerTab] = useState("detail");
  const [checked, setChecked] = useState(() => new Set());
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  const [choiceOpen, setChoiceOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeedQuestion, setAiSeedQuestion] = useState(null);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendCC, setSendCC] = useState("");
  const [sendMsg, setSendMsg] = useState("Our invoice is attached — please arrange payment.");
  const [sendSuccess, setSendSuccess] = useState(false);

  // Klay command bar state
  const [klayQuery, setKlayQuery] = useState("");
  const [klayFilters, setKlayFilters] = useState({});
  const [klayAction, setKlayAction] = useState(null);
  const [highlightedRef, setHighlightedRef] = useState(null);
  const klayInputRef = useRef(null);

  // Promote N drafts to auto, then flag a few non-auto invoices as anomalies
  const allRows = useMemo(() => {
    const drafts = invoices
      .filter((i) => i.approval === "draft")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, AUTO_PROCESSED_COUNT);
    const autoIds = new Set(drafts.map((i) => i.id));
    const anomalyCandidates = invoices
      .filter((i) => !autoIds.has(i.id) && (i.approval === "sent" || i.approval === "draft"))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, ANOMALY_COUNT);
    const anomalyIndex = new Map(anomalyCandidates.map((i, k) => [i.id, k]));
    let autoIdx = 0;
    return invoices.map((inv) => {
      if (autoIds.has(inv.id)) {
        const source = autoIdx++ % 2 === 0 ? "whatsapp" : "email";
        return { ...inv, approval: "auto", ai_source: source, ai_summary: generateInvoiceAiSummary(inv, source) };
      }
      if (anomalyIndex.has(inv.id)) {
        return { ...inv, approval: "anomaly", anomaly: generateInvoiceAnomaly(inv, anomalyIndex.get(inv.id)) };
      }
      return inv;
    });
  }, [invoices]);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1800);
  }

  // ── Tab counts (derived from allRows so auto is reflected) ──────────────
  const tabCounts = useMemo(() => ({
    all:        allRows.length,
    anomaly:    allRows.filter(i => i.approval === "anomaly").length,
    auto:       allRows.filter(i => i.approval === "auto").length,
    sent:       allRows.filter(i => i.approval === "sent").length,
    draft:      allRows.filter(i => i.approval === "draft").length,
    jatuhtempo: allRows.filter(i => i.payStatus === "overdue").length,
    paid:      allRows.filter(i => i.payStatus === "paid").length,
  }), [allRows]);

  const monthPfx = useMemo(() => `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`, []);

  // ── KPI stats — action-framed cells (mirror Bills) ──────────────────────
  const invStats = useMemo(() => {
    const active        = allRows.filter(i => i.payStatus !== "paid");
    const overdue       = allRows.filter(i => i.payStatus === "overdue");
    const overdueMonth  = overdue.filter(i => i.due && i.due.startsWith(monthPfx));
    const drafts        = allRows.filter(i => i.approval === "draft");
    return {
      totalAR:           active.reduce((s, i) => s + i.total, 0),
      activeCount:       active.length,
      overdueCount:      overdue.length,
      overdueSum:        overdue.reduce((s, i) => s + i.total, 0),
      overdueMonthCount: overdueMonth.length,
      overdueMonthSum:   overdueMonth.reduce((s, i) => s + i.total, 0),
      draftCount:        drafts.length,
      draftSum:          drafts.reduce((s, i) => s + i.total, 0),
    };
  }, [allRows, monthPfx]);

  const aiContext = useMemo(() => makeInvoicesAiContext(allRows), [allRows]);

  function askAi(question) {
    setAiSeedQuestion(question);
    setAiOpen(true);
  }

  // ── Step 1: corpus (pill / card filter only) ────────────────────────────
  const corpus = useMemo(() => {
    let list = allRows;
    if (filter.kind === "tab") {
      if (filter.value === "anomaly")         list = list.filter(i => i.approval === "anomaly");
      else if (filter.value === "auto")       list = list.filter(i => i.approval === "auto");
      else if (filter.value === "sent")       list = list.filter(i => i.approval === "sent");
      else if (filter.value === "draft")      list = list.filter(i => i.approval === "draft");
      else if (filter.value === "jatuhtempo") list = list.filter(i => i.payStatus === "overdue");
      else if (filter.value === "paid")      list = list.filter(i => i.payStatus === "paid");
    } else if (filter.kind === "card") {
      if (filter.value === "total")             list = list.filter(i => i.payStatus !== "paid");
      else if (filter.value === "overdueMonth") list = list.filter(i => i.payStatus === "overdue" && i.due && i.due.startsWith(monthPfx));
    }
    return list;
  }, [allRows, filter, monthPfx]);

  // ── Customers present in the current corpus (for Filter popover list) ───
  const customersInCorpus = useMemo(() => {
    const counts = new Map();
    for (const inv of corpus) {
      const c = customers.find((x) => x.id === inv.customer);
      if (!c) continue;
      const prev = counts.get(c.id) || { id: c.id, name: c.name, count: 0 };
      prev.count += 1;
      counts.set(c.id, prev);
    }
    return Array.from(counts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [corpus]);

  const klayFilterKeys = useMemo(() => Object.keys(klayFilters), [klayFilters]);

  // ── Has-any-filter flag for the "Reset all" affordance ────────────────
  const hasActiveFilters = useMemo(() => {
    return (
      filterValues.customers.size > 0 ||
      filterValues.minAmount !== "" ||
      filterValues.maxAmount !== "" ||
      filterValues.dateFrom !== "" ||
      filterValues.dateTo !== "" ||
      filterValues.source !== "all" ||
      klayFilterKeys.length > 0 ||
      sortChoice !== null ||
      groupChoice !== null
    );
  }, [filterValues, klayFilterKeys, sortChoice, groupChoice]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.customers.size > 0) n++;
    if (filterValues.minAmount !== "" || filterValues.maxAmount !== "") n++;
    if (filterValues.dateFrom !== "" || filterValues.dateTo !== "") n++;
    if (filterValues.source !== "all") n++;
    return n;
  }, [filterValues]);

  // Unified chip list — Klay-parsed + manual FilterPopover values
  const activeChips = useMemo(() => {
    const chips = [];
    for (const key of klayFilterKeys) {
      chips.push({ id: `klay:${key}`, source: "klay", key, label: klayChipLabel(key, klayFilters[key]) });
    }
    if (filterValues.customers.size > 0) {
      chips.push({ id: "manual:customers", source: "manual", key: "customers", label: `${filterValues.customers.size} customer` });
    }
    if (filterValues.minAmount !== "" || filterValues.maxAmount !== "") {
      const lo = filterValues.minAmount !== "" ? `Rp ${Number(filterValues.minAmount).toLocaleString("id-ID")}` : "—";
      const hi = filterValues.maxAmount !== "" ? `Rp ${Number(filterValues.maxAmount).toLocaleString("id-ID")}` : "—";
      chips.push({ id: "manual:amount", source: "manual", key: "amount", label: `${lo} – ${hi}` });
    }
    if (filterValues.dateFrom !== "" || filterValues.dateTo !== "") {
      chips.push({ id: "manual:date", source: "manual", key: "date", label: `${filterValues.dateFrom || "—"} → ${filterValues.dateTo || "—"}` });
    }
    if (filterValues.source !== "all") {
      chips.push({ id: "manual:source", source: "manual", key: "source", label: filterValues.source === "ai" ? "Source: AI" : "Source: Manual" });
    }
    return chips;
  }, [klayFilters, klayFilterKeys, filterValues]);

  // ── Step 2: apply advanced filter + Klay parsed filters to the corpus ───
  const filteredRows = useMemo(() => {
    let list = corpus;

    // Manual filter popover
    if (filterValues.customers.size > 0) list = list.filter(i => filterValues.customers.has(i.customer));
    const min = filterValues.minAmount === "" ? null : Number(filterValues.minAmount);
    const max = filterValues.maxAmount === "" ? null : Number(filterValues.maxAmount);
    if (min != null && !isNaN(min)) list = list.filter(i => i.total >= min);
    if (max != null && !isNaN(max)) list = list.filter(i => i.total <= max);
    if (filterValues.dateFrom) list = list.filter(i => (i[filterValues.dateField] || "") >= filterValues.dateFrom);
    if (filterValues.dateTo)   list = list.filter(i => (i[filterValues.dateField] || "") <= filterValues.dateTo);
    if (filterValues.source === "ai")     list = list.filter(i => i.isAI === true || i.approval === "auto");
    if (filterValues.source === "manual") list = list.filter(i => !i.isAI && i.approval !== "auto");

    // Klay-parsed filters
    if (klayFilters.status === "auto")      list = list.filter(i => i.approval === "auto");
    else if (klayFilters.status === "sent") list = list.filter(i => i.approval === "sent");
    else if (klayFilters.status === "draft")list = list.filter(i => i.approval === "draft");
    if (klayFilters.payStatus === "overdue") list = list.filter(i => i.payStatus === "overdue");
    if (klayFilters.payStatus === "paid")   list = list.filter(i => i.payStatus === "paid");
    if (klayFilters.source === "whatsapp")   list = list.filter(i => i.ai_source === "whatsapp");
    if (klayFilters.source === "email")      list = list.filter(i => i.ai_source === "email");
    if (typeof klayFilters.amountMin === "number") list = list.filter(i => i.total >= klayFilters.amountMin);
    if (klayFilters.dateRange === "thisMonth") {
      const ym = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;
      list = list.filter(i => (i.date || "").startsWith(ym));
    } else if (klayFilters.dateRange === "thisWeek") {
      const t = new Date(TODAY); const wAgo = new Date(t); wAgo.setDate(wAgo.getDate() - 7);
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const lo = fmt(wAgo); const hi = fmt(t);
      list = list.filter(i => i.date >= lo && i.date <= hi);
    }
    if (klayFilters.aging) {
      list = list.filter(i => {
        if (i.payStatus !== "overdue") return false;
        const d = daysSince(i.due);
        if (klayFilters.aging === "90+") return d >= 90;
        if (klayFilters.aging === "60-90") return d >= 60 && d < 90;
        if (klayFilters.aging === "30-60") return d >= 30 && d < 60;
        if (klayFilters.aging === "0-30") return d >= 0 && d < 30;
        return true;
      });
    }
    if (klayFilters.freeText) {
      const ft = klayFilters.freeText.toLowerCase();
      list = list.filter(i =>
        (i.invNo || "").toLowerCase().includes(ft) ||
        (i.customerName || "").toLowerCase().includes(ft) ||
        (i.custPO || "").toLowerCase().includes(ft),
      );
    }

    return list.map(toRow);
  }, [corpus, filterValues, klayFilters]);

  // ── Sort + Group derivation ─────────────────────────────────────────────
  const onJatuhTempo = filter.kind === "tab" && filter.value === "jatuhtempo";
  const onPaid      = filter.kind === "tab" && filter.value === "paid";
  const onDraft      = filter.kind === "tab" && filter.value === "draft";

  const defaultSort  = onJatuhTempo ? "days-late-desc" : "date-desc";
  const effectiveSort = sortChoice || defaultSort;

  const defaultGroup = onJatuhTempo ? "aging" : "none";
  const effectiveGroup = groupChoice || defaultGroup;

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    const cmpBy = (a, b) => {
      switch (effectiveSort) {
        case "days-late-desc": return b.daysOverdue - a.daysOverdue;
        case "date-desc":      return (b.raw.date || "").localeCompare(a.raw.date || "");
        case "date-asc":       return (a.raw.date || "").localeCompare(b.raw.date || "");
        case "total-desc":     return b.total - a.total;
        case "total-asc":      return a.total - b.total;
        case "customer-asc":   return a.co.localeCompare(b.co);
        case "customer-desc":  return b.co.localeCompare(a.co);
        default: return 0;
      }
    };
    // Pin Anomaly first (urgent), then Auto (needs confirmation), then chosen sort
    const tier = (r) => r.approval === "anomaly" ? 0 : r.approval === "auto" ? 1 : 2;
    arr.sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      return cmpBy(a, b);
    });
    return arr;
  }, [filteredRows, effectiveSort]);

  // Aging group computation moved into a memo over sortedRows
  const showAgingGroups = effectiveGroup === "aging";

  function selectTab(t) { setFilter({ kind: "tab", value: t }); clearChecks(); }
  function selectCard(c) {
    if (c === null) setFilter({ kind: "tab", value: "all" });
    // 'overdue', 'auto', 'anomaly' route to their tabs so they share UI state
    else if (c === "overdue") setFilter({ kind: "tab", value: "jatuhtempo" });
    else if (c === "auto")    setFilter({ kind: "tab", value: "auto" });
    else if (c === "anomaly") setFilter({ kind: "tab", value: "anomaly" });
    else setFilter({ kind: "card", value: c });
    clearChecks();
  }
  // Deep-link focus from the Home task hub: /invoices?tab=draft.
  const [focusParams, setFocusParams] = useSearchParams();
  useEffect(() => {
    const card = focusParams.get("card");
    const tab = focusParams.get("tab");
    if (!card && !tab) return;
    if (card) selectCard(card);
    else selectTab(tab);
    setFocusParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isTabActive  = (t) => filter.kind === "tab"  && filter.value === t;
  const isCardActive = (c) => {
    if (c === "overdue") return filter.value === "jatuhtempo";
    if (c === "auto")    return filter.value === "auto";
    if (c === "anomaly") return filter.value === "anomaly";
    return filter.kind === "card" && filter.value === c;
  };

  const groups = useMemo(() => {
    if (effectiveGroup === "none") return null;

    if (effectiveGroup === "aging") {
      const byBucket = new Map();
      for (const b of AGING_BUCKETS) byBucket.set(b.key, []);
      for (const r of sortedRows) {
        const key = bucketOf(r.daysOverdue);
        if (key) byBucket.get(key).push(r);
      }
      return AGING_BUCKETS.map((b) => {
        const rows = byBucket.get(b.key);
        return { ...b, key: b.key, label: b.lbl, rows, sum: rows.reduce((s, r) => s + r.total, 0), kind: "aging" };
      }).filter((g) => g.rows.length > 0);
    }

    // Generic grouping by a key function
    const keyFn = (r) => {
      if (effectiveGroup === "customer") return r.co;
      if (effectiveGroup === "bulan") return (r.raw.date || "").slice(0, 7); // YYYY-MM
      if (effectiveGroup === "status") {
        if (r.approval === "auto") return "Auto";
        if (r.payStatus === "paid") return "Paid";
        if (r.payStatus === "overdue") return "Overdue";
        if (r.approval === "draft") return "Draft";
        return "Unpaid";
      }
      return "—";
    };
    const map = new Map();
    for (const r of sortedRows) {
      const k = keyFn(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return Array.from(map.entries()).map(([k, rows]) => ({
      key: k,
      label: effectiveGroup === "bulan" ? formatMonthLabel(k) : k,
      rows,
      sum: rows.reduce((s, r) => s + r.total, 0),
      tone: "muted",
      kind: effectiveGroup,
    }));
  }, [effectiveGroup, sortedRows]);

  // ── Selected rows summary ───────────────────────────────────────────────
  const selected = allRows.find((i) => i.id === selectedId);
  const selectedCustomer = selected ? customers.find((c) => c.id === selected.customer) : null;

  const pageTotal = filteredRows.reduce((s, r) => s + r.total, 0);
  const selectedTotal = filteredRows.filter((r) => checked.has(r.id)).reduce((s, r) => s + r.total, 0);

  function toggleRow(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleGroup(key) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function clearChecks() { setChecked(new Set()); }

  function resetAll() {
    setSortChoice(null);
    setGroupChoice(null);
    setFilterValues(emptyFilters);
    setKlayFilters({});
    setKlayQuery("");
  }

  // ── Klay command bar handlers ─────────────────────────────────────────
  function submitKlayQuery() {
    const q = klayQuery.trim();
    if (!q) return;
    const intent = detectKlayIntent(q);
    if (intent === "lookup") {
      const upper = q.toUpperCase();
      const hit = allRows.find((i) => (i.invNo || "").toUpperCase() === upper);
      if (!hit) { showToast(`${q} not found`); return; }
      setFilter({ kind: "tab", value: "all" });
      setFilterValues(emptyFilters);
      setKlayFilters({});
      setHighlightedRef(hit.id);
      setKlayQuery("");
    } else if (intent === "question") {
      askAi(q);
      setKlayQuery("");
    } else if (intent === "action") {
      console.log("[Klay] action intent:", { query: q, verb: q.match(ACTION_VERB_RE)?.[1]?.toLowerCase() });
      setKlayAction({ query: q });
      setKlayQuery("");
    } else if (intent === "filter") {
      const parsed = parseKlayFilters(q);
      setKlayFilters((prev) => ({ ...prev, ...parsed }));
      setKlayQuery("");
    }
  }

  function removeChip(chip) {
    if (chip.source === "klay") {
      setKlayFilters((prev) => { const next = { ...prev }; delete next[chip.key]; return next; });
    } else if (chip.source === "manual") {
      if (chip.key === "customers") setFilterValues((v) => ({ ...v, customers: new Set() }));
      else if (chip.key === "amount") setFilterValues((v) => ({ ...v, minAmount: "", maxAmount: "" }));
      else if (chip.key === "date") setFilterValues((v) => ({ ...v, dateFrom: "", dateTo: "" }));
      else if (chip.key === "source") setFilterValues((v) => ({ ...v, source: "all" }));
    }
  }

  function clearAllChips() {
    setKlayFilters({});
    setFilterValues(emptyFilters);
  }

  function onAutoAction(action, inv) {
    if (action === "confirm") showToast(`${inv.invNo === "—" ? inv.id : inv.invNo} confirmed and ready to send`);
    else if (action === "reject") showToast(`${inv.invNo === "—" ? inv.id : inv.invNo} rejected — Klay will re-learn`);
  }

  // Listen for global launcher submissions
  useEffect(() => {
    const onOpenChat = (e) => askAi(e.detail?.question || "");
    window.addEventListener("klay:open-chat", onOpenChat);
    return () => window.removeEventListener("klay:open-chat", onOpenChat);
  }, []);

  // Listen for "open results in table" from chat replies
  useEffect(() => {
    const onApply = (e) => {
      const q = e.detail?.query || "";
      const parsed = parseKlayFilters(q);
      setKlayFilters((prev) => ({ ...prev, ...parsed }));
      setAiOpen(false);
      setAiSeedQuestion(null);
      const n = e.detail?.count;
      showToast(typeof n === "number" ? `${n} invoice${n === 1 ? "" : "s"} — filter applied` : "Filter applied");
    };
    window.addEventListener("klay:apply-filters", onApply);
    return () => window.removeEventListener("klay:apply-filters", onApply);
  }, []);

  // ⌘K / Ctrl+K to focus the bar
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        klayInputRef.current?.focus();
        klayInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Scroll to + flash the highlighted row after a lookup
  useEffect(() => {
    if (!highlightedRef) return;
    const el = document.querySelector(`[data-inv-row="${highlightedRef}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("lg-klay-flash");
      const tmr = setTimeout(() => {
        el.classList.remove("lg-klay-flash");
        setHighlightedRef(null);
      }, 2400);
      return () => clearTimeout(tmr);
    }
    setHighlightedRef(null);
  }, [highlightedRef]);

  function exportCsv() {
    const rowsToExport = checked.size > 0
      ? sortedRows.filter((r) => checked.has(r.id))
      : sortedRows;
    const headers = ["Invoice", "Date", "Customer", "Address", "Overdue", "Days Overdue", "Total", "Invoice Status", "Payment Status"];
    const escapeCell = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of rowsToExport) {
      lines.push([
        r.no, r.tgl, r.co, r.addr, r.due, r.daysOverdue, r.total, r.approval, r.payStatus,
      ].map(escapeCell).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = `${TODAY.getFullYear()}${String(TODAY.getMonth() + 1).padStart(2, "0")}${String(TODAY.getDate()).padStart(2, "0")}`;
    a.download = `klay-invoices-${filter.value}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${rowsToExport.length} invoice exported to CSV`);
  }

  function onRowAction(action, inv) {
    setMenuOpenFor(null);
    if (action === "edit") showToast(`Edit ${inv.id} (demo)`);
    else if (action === "payment") showToast(`Catat payment for ${inv.id}`);
    else if (action === "recurring") showToast(`Create invoice berulang from ${inv.id}`);
    else if (action === "duplicate") showToast(`Duplicate ${inv.id}`);
    else if (action === "archive") showToast(`${inv.id} diarsipkan`);
  }

  function onBulk(action) {
    const count = checked.size;
    if (action === "remind") showToast(`Reminder sent to ${count} customer`);
    else if (action === "paid") showToast(`${count} invoice${count === 1 ? "" : "s"} marked Paid`);
    else if (action === "archive") showToast(`${count} invoice diarsipkan`);
    clearChecks();
  }

  function openSendForSelected() {
    if (!selected) return;
    setSendEmail(selected.custEmail || "");
    setSendCC("");
    setSendMsg("Our invoice is attached — please arrange payment.");
    setSendSuccess(false);
    setSendOpen(true);
  }
  function confirmSend() {
    if (!selected) return;
    sendInvoice(selected.id, { channel: "email" });
    setSendSuccess(true);
    setTimeout(() => { setSendOpen(false); setSelectedId(null); }, 1300);
  }

  const tabs = [
    { k: "all",      lbl: "All",     count: tabCounts.all },
    { k: "anomaly",    lbl: "Anomaly", count: tabCounts.anomaly },
    { k: "auto",       lbl: "Auto",    count: tabCounts.auto },
    { k: "sent",       lbl: "Sent",    count: tabCounts.sent },
    { k: "draft",      lbl: "Draft",   count: tabCounts.draft },
    { k: "jatuhtempo", lbl: "Overdue", count: tabCounts.jatuhtempo },
    { k: "paid",      lbl: "Paid",    count: tabCounts.paid },
  ];

  return (
    <div className="lg-page">
    <div className="lg-scroll-container">
      {/* ── Editorial header ─────────────────────────────────────────── */}
      <div className="lg-head">
        <div className="lg-head-top">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="lg-title">Invoices</h1>
          </div>
          <div className="lg-head-actions">
            <button className="lg-btn-brand" onClick={() => setChoiceOpen(true)}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create invoice
            </button>
          </div>
        </div>

        {/* KPI strip — action-framed cells. Your Tasks moved to /dashboard;
            AR insights moved to /insights. */}
        <div className="bp-kpi-wrap">
          <div className="bp-kpi-row">
            {canTransact && (
              <div className="bp-kpi-card">
                <div className="bp-kpi-lbl">Ready to Send</div>
                <div className="bp-kpi-val">{invStats.draftCount} · {formatRupiah(invStats.draftSum)}</div>
                <div className="bp-kpi-sub">Send to customer</div>
                <button type="button" className="bp-kpi-cta" onClick={() => selectTab("draft")}>View →</button>
              </div>
            )}

            {canTransact && (
              <div className="bp-kpi-card">
                <div className="bp-kpi-lbl">Overdue</div>
                <div className="bp-kpi-val">{invStats.overdueCount} · {formatRupiah(invStats.overdueSum)}</div>
                <div className="bp-kpi-sub">Chase for payment</div>
                <button type="button" className="bp-kpi-cta" onClick={() => selectTab("jatuhtempo")}>View →</button>
              </div>
            )}

            <div className="bp-kpi-card">
              <div className="bp-kpi-lbl">Overdue This Month</div>
              <div className="bp-kpi-val">{invStats.overdueMonthCount}</div>
              <div className="bp-kpi-sub">{formatRupiah(invStats.overdueMonthSum)} newly late</div>
              <button type="button" className="bp-kpi-cta" onClick={() => selectCard("overdueMonth")}>View →</button>
            </div>

            <div className="bp-kpi-card">
              <div className="bp-kpi-lbl">AR Outstanding</div>
              <div className="bp-kpi-val">{formatRupiah(invStats.totalAR)}</div>
              <div className="bp-kpi-sub">{invStats.activeCount} invoice{invStats.activeCount === 1 ? "" : "s"} active</div>
              <button type="button" className="bp-kpi-cta" onClick={() => selectCard("total")}>View →</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Table card ──────────────────────────────────────────────── */}
      <div className="lg-table-wrap">
        <div className="lg-card">

          {/* Pills row */}
          <div className="bp-tabs-row">
            {tabs.map((t) => (
              <button
                key={t.k}
                className={`bp-tab${isTabActive(t.k) ? " active" : ""}`}
                onClick={() => selectTab(t.k)}
              >
                {t.lbl}
                <span className="bp-tab-count">{t.count}</span>
              </button>
            ))}
          </div>

          {/* Klay command bar + Filter / Sort row */}
          <div className="lg-filter-row">
            <KlayCommandBar
              inputRef={klayInputRef}
              value={klayQuery}
              onChange={setKlayQuery}
              onSubmit={submitKlayQuery}
              onClear={() => setKlayQuery("")}
              chips={activeChips}
              onRemoveChip={removeChip}
              onClearChips={clearAllChips}
            />
            <div className="lg-filter-meta">
              <div className="lg-meta-btn-wrap">
                <button
                  className={`lg-meta-btn${activeFilterCount > 0 ? " active" : ""}`}
                  onClick={() => { setFilterPopOpen(!filterPopOpen); setSortPopOpen(false); setGroupPopOpen(false); }}
                >
                  <svg viewBox="0 0 12 12"><path d="M2 3h8M3 6h6M4 9h4" strokeLinecap="round"/></svg>
                  Filter
                  {activeFilterCount > 0 && <span className="lg-filter-badge">{activeFilterCount}</span>}
                </button>
                {filterPopOpen && (
                  <FilterPopover
                    values={filterValues}
                    onChange={setFilterValues}
                    customers={customersInCorpus}
                    onClose={() => setFilterPopOpen(false)}
                  />
                )}
              </div>
              <div className="lg-meta-btn-wrap">
                <button
                  className="lg-meta-btn"
                  onClick={() => { setSortPopOpen(!sortPopOpen); setFilterPopOpen(false); setGroupPopOpen(false); }}
                >
                  <span className="meta-lbl">Sort:</span>
                  <span className="meta-val">{SORT_LABELS[effectiveSort]}</span>
                </button>
                {sortPopOpen && (
                  <SortPopover
                    value={effectiveSort}
                    onPick={(v) => { setSortChoice(v); setSortPopOpen(false); }}
                    onClose={() => setSortPopOpen(false)}
                  />
                )}
              </div>
              <div className="lg-meta-btn-wrap">
                <button
                  className="lg-meta-btn"
                  onClick={() => { setGroupPopOpen(!groupPopOpen); setSortPopOpen(false); setFilterPopOpen(false); }}
                >
                  <span className="meta-lbl">Group:</span>
                  <span className="meta-val">{GROUP_LABELS[effectiveGroup]}</span>
                </button>
                {groupPopOpen && (
                  <GroupPopover
                    value={effectiveGroup}
                    canAging={!onPaid && !onDraft}
                    onPick={(v) => { setGroupChoice(v); setGroupPopOpen(false); }}
                    onClose={() => setGroupPopOpen(false)}
                  />
                )}
              </div>
              {hasActiveFilters && (
                <button className="lg-reset-all" onClick={resetAll}>Reset all</button>
              )}
            </div>
          </div>

          {/* Column header */}
          <div className="lg-col-header">
            <div><input type="checkbox" className="lg-row-check" disabled /></div>
            <div>Invoice</div>
            <div>Date</div>
            <div>Customer</div>
            <div style={{ textAlign: "right" }}>Days Overdue</div>
            <div style={{ paddingLeft: 12 }}>Overdue</div>
            <div>Status</div>
            <div style={{ textAlign: "right" }}>Total · IDR</div>
            <div />
          </div>

          {/* Rows (page-level scroll, only column header sticks) */}
          <div>
            {groups ? (
              groups.map((g) => {
                const isCollapsed = collapsedGroups.has(g.key);
                const isAging = g.kind === "aging";
                return (
                  <div key={g.key}>
                    <div className={`lg-group-head${!isAging ? " muted" : ""}`} onClick={() => toggleGroup(g.key)}>
                      <div className="lg-group-left">
                        <svg className={`lg-group-chevron${isCollapsed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>
                        <span className={`lg-group-lbl${isAging ? (g.tone === "danger" ? " danger" : " warn") : ""}`}>
                          {g.label}
                        </span>
                        <span className={`lg-group-count${isAging ? (g.tone === "danger" ? " danger" : " warn") : ""}`}>
                          {g.rows.length}
                        </span>
                      </div>
                      <div className="lg-group-subtotal">
                        <span className="lg-group-subtotal-lbl">Subtotal</span>
                        Rp {fmtRp(g.sum)}
                      </div>
                    </div>
                    {!isCollapsed && g.rows.map((r, i) => {
                      const isOverdue = r.payStatus === "overdue" && r.daysOverdue > 0;
                      const rowBucket = isAging ? g : (
                        isOverdue ? {
                          minDays: r.daysOverdue >= 90 ? 90 : r.daysOverdue >= 60 ? 60 : r.daysOverdue >= 30 ? 30 : 0,
                          maxDaysCap: r.daysOverdue >= 90 ? 150 : r.daysOverdue >= 60 ? 90 : r.daysOverdue >= 30 ? 60 : 30,
                          tone: r.daysOverdue >= 60 ? "danger" : "warn",
                        } : null
                      );
                      return (
                        <div key={r.id} data-inv-row={r.id} style={{ position: "relative" }}>
                          <LedgerRow
                            r={r}
                            bucket={rowBucket}
                            isChecked={checked.has(r.id)}
                            onCheck={toggleRow}
                            onClick={() => { setSelectedId(r.id); setDrawerTab("detail"); }}
                            onKebab={(id) => setMenuOpenFor(menuOpenFor === id ? null : id)}
                            isSelected={selectedId === r.id}
                            isAlt={i % 2 === 1}
                          />
                          {menuOpenFor === r.id && (
                            <div style={{ position: "absolute", right: 32, top: 32, zIndex: 5 }}>
                              <RowMenu inv={r.raw} onClose={() => setMenuOpenFor(null)} onAction={onRowAction} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              <>
                {sortedRows.length === 0 && (
                  <div className="lg-empty">None invoice matching</div>
                )}
                {sortedRows.map((r, i) => {
                  const isOverdue = r.payStatus === "overdue" && r.daysOverdue > 0;
                  const bucket = isOverdue
                    ? {
                        minDays: r.daysOverdue >= 90 ? 90 : r.daysOverdue >= 60 ? 60 : r.daysOverdue >= 30 ? 30 : 0,
                        maxDaysCap: r.daysOverdue >= 90 ? 150 : r.daysOverdue >= 60 ? 90 : r.daysOverdue >= 30 ? 60 : 30,
                        tone: r.daysOverdue >= 60 ? "danger" : "warn",
                      }
                    : null;
                  return (
                    <div key={r.id} data-inv-row={r.id} style={{ position: "relative" }}>
                      <LedgerRow
                        r={r}
                        bucket={bucket}
                        isChecked={checked.has(r.id)}
                        onCheck={toggleRow}
                        onClick={() => { setSelectedId(r.id); setDrawerTab("detail"); }}
                        onKebab={(id) => setMenuOpenFor(menuOpenFor === id ? null : id)}
                        isSelected={selectedId === r.id}
                        isAlt={i % 2 === 1}
                      />
                      {menuOpenFor === r.id && (
                        <div style={{ position: "absolute", right: 32, top: 32, zIndex: 5 }}>
                          <RowMenu inv={r.raw} onClose={() => setMenuOpenFor(null)} onAction={onRowAction} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      </div>{/* /lg-scroll-container */}

      {/* ── Sticky footer ───────────────────────────────────────────── */}
      <div className="lg-footer">
        <div className="lg-footer-left">
          <span><span className="lg-footer-num">{checked.size}</span> selected</span>
          {checked.size > 0 ? (
            <>
              <button className="lg-footer-bulk-btn" onClick={() => onBulk("remind")}>Send Reminder</button>
              <button className="lg-footer-clear" onClick={clearChecks}>Clear selection</button>
            </>
          ) : (
            <>
              <span className="lg-footer-sep">·</span>
              <span>Showing <span className="lg-footer-num">{filteredRows.length}</span> invoices</span>
            </>
          )}
        </div>
        <div className="lg-footer-right">
          <button className="lg-footer-export" onClick={exportCsv} title="Export the rows shown above to CSV">
            <svg viewBox="0 0 12 12"><path d="M6 2v6M3 6l3 3 3-3M2 10.5h8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Export {checked.size > 0 ? `${checked.size} selected` : `${filteredRows.length} visible`}
          </button>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">{checked.size > 0 ? "Subtotal selected" : "Subtotal page"}</span>
          <span className="lg-footer-total">Rp {fmtRp(checked.size > 0 ? selectedTotal : pageTotal)}</span>
        </div>
      </div>

      {/* ── Side drawer (detail) ────────────────────────────────────── */}
      {selected && (
        <>
          <div className="drawer-overlay" onClick={() => setSelectedId(null)} />
          <div className="drawer">
            <div className="drawer-head">
              <div className={`drawer-av ${selectedCustomer?.type || "perusahaan"}`}>{initials(selected.customerName)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title">{selected.customerName}</div>
                <div className="drawer-sub">{selected.invNo === "—" ? "Draft" : selected.invNo}</div>
              </div>
              <button className="drawer-close" onClick={() => setSelectedId(null)}>
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="drawer-tabs">
              {[["detail","Detail"],["items","Items"],["audit","Audit"],["ai","AI Insight"]].map(([t,label]) => (
                <div key={t} className={`drawer-tab${drawerTab===t?" active":""}`} onClick={()=>setDrawerTab(t)}>
                  {t === "ai" && <span style={{ marginRight: 4, color: "var(--color-action)" }}>✦</span>}
                  {label}
                </div>
              ))}
            </div>
            <div className="drawer-body">
              {drawerTab === "detail" && (
                <>
                  {selected.approval === "auto" && selected.ai_summary && (
                    <div className="drawer-ai-callout">
                      <div className="drawer-ai-eyebrow"><SparkleIcon /> Klay's interpretation</div>
                      <p className="drawer-ai-text">{selected.ai_summary}</p>
                      <div className="drawer-ai-meta">
                        Auto-drafted from {selected.ai_source === "whatsapp" ? "WhatsApp" : "email"} on {formatDateEn(selected.date)} · awaiting your confirmation
                      </div>
                    </div>
                  )}
                  {selected.approval === "anomaly" && selected.anomaly && (
                    <div className="drawer-anomaly-callout">
                      <div className="drawer-anomaly-eyebrow">
                        <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor" stroke="none"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff" stroke="none"/></svg>
                        Anomaly flagged by Klay
                      </div>
                      <p className="drawer-anomaly-text">{selected.anomaly}</p>
                      <div className="drawer-anomaly-meta">Needs your review before period close</div>
                    </div>
                  )}
                  <div className="drawer-stat-row">
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Invoice Total</div>
                      <div className="drawer-stat-val">{formatRupiah(selected.total)}</div>
                    </div>
                    <div className="drawer-stat-card">
                      <div className="drawer-stat-lbl">Payment Status</div>
                      <div className={`drawer-stat-val${selected.payStatus==="paid"?" success":selected.payStatus==="overdue"?" danger":""}`} style={{ fontSize: 13 }}>
                        {PAY_LABEL[selected.payStatus] || selected.payStatus}
                      </div>
                    </div>
                  </div>
                  <div className="drawer-section">
                    <div className="drawer-section-title">Invoice Information</div>
                    {[
                      ["Invoice ID", selected.id],
                      ["Invoice Number", selected.invNo],
                      ["Customer PO", selected.custPO],
                      ["Customer", selected.customerName],
                      ["Email", selected.custEmail],
                      ["Date Created", formatDateEn(selected.date)],
                      ["Overdue", formatDateEn(selected.due)],
                      ["Invoice Status", APPROVAL_LABEL[selected.approval] || selected.approval],
                    ].map(([label, value]) => (
                      <div key={label} className="drawer-row">
                        <div className="drawer-label">{label}</div>
                        <div className="drawer-value">{value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {drawerTab === "items" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">Line Items</div>
                  <table className="items-table">
                    <thead><tr><th>Description</th><th className="r">Qty</th><th>Unit</th><th className="r">Price</th><th className="r">Subtotal</th></tr></thead>
                    <tbody>
                      {selected.items.map((item, i) => (
                        <tr key={i}>
                          <td>{item.desc}</td>
                          <td className="r">{item.qty}</td>
                          <td>{item.unit}</td>
                          <td className="r">{formatRupiah(item.price)}</td>
                          <td className="r">{formatRupiah(item.subtotal)}</td>
                        </tr>
                      ))}
                      <tr className="items-total-row"><td colSpan={4}>Total</td><td className="r">{formatRupiah(selected.total)}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}
              {drawerTab === "audit" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">Audit History</div>
                  <div className="audit-list">
                    {selected.audit.map((a, i) => (
                      <div key={i} className="audit-item">
                        <div className={`audit-dot ${a.type}`} />
                        <div>
                          <div className="audit-action">{a.action}</div>
                          <div className="audit-by">{a.by} · {formatDateEn(a.date)} {a.teame}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {drawerTab === "ai" && (
                <div className="drawer-section">
                  <div className="drawer-section-title">AI Insight</div>
                  {selected.isAI && (
                    <div style={{ padding: 12, background: "var(--ai-surface)", border: "1px solid var(--ai-border)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-action)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>✦ Created by AI</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                        This invoice was auto-generated from the customer PO. OCR confidence average <strong>96%</strong>. Mato sure any manually edited fields are finalized before sending.
                      </div>
                    </div>
                  )}
                  {selected.payStatus === "overdue" && (
                    <div style={{ padding: 12, background: "var(--color-danger-surface)", border: "1px solid var(--color-danger-border)", borderRadius: "var(--radius-md)", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-danger-text)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>⚠ Past Due</div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                        Invoice ini already passes due. Klay AI menyarankan reminder to <strong>{selected.customerName}</strong>{selected.custEmail && ` via ${selected.custEmail}`}.
                      </div>
                    </div>
                  )}
                  {selected.payStatus === "paid" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12, background: "var(--color-success-surface)", border: "1px solid var(--color-success-border)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--color-success-text)", marginBottom: 10 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      This invoice is already paid — no action needed.
                    </div>
                  )}
                  <div style={{ padding: 12, background: "var(--color-surface-sunken)", border: "1px solid var(--color-border-default)", borderRadius: "var(--radius-md)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>Customer Pattern</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                      {selected.customerName} typically pays in <strong>NET 30</strong>. Klay will trigger a reminder automatically 3 days before the due date.
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="drawer-footer">
              {selected.approval === "draft" && (
                <button className="drawer-btn primary" onClick={openSendForSelected}>
                  <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  Send Invoice
                </button>
              )}
              {selected.approval === "sent" && selected.payStatus !== "paid" && (
                <button className="drawer-btn primary">
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  Mark Paid
                </button>
              )}
              {selected.approval === "auto" && (
                <>
                  <button
                    className="drawer-btn ghost"
                    onClick={() => { onAutoAction("reject", selected); setSelectedId(null); }}
                  >
                    <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    Reject
                  </button>
                  <button
                    className="drawer-btn primary klay"
                    onClick={() => { onAutoAction("confirm", selected); openSendForSelected(); }}
                  >
                    <SparkleIcon />
                    Confirm &amp; send
                  </button>
                </>
              )}
              {selected.approval === "anomaly" && (
                <>
                  <button
                    className="drawer-btn ghost"
                    onClick={() => { showToast(`${selected.invNo === "—" ? selected.id : selected.invNo} dismissed — Klay will learn`); setSelectedId(null); }}
                  >
                    Dismiss
                  </button>
                  <button
                    className="drawer-btn primary danger"
                    onClick={() => { showToast(`Investigating ${selected.invNo === "—" ? selected.id : selected.invNo}`); setSelectedId(null); }}
                  >
                    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    Investigate
                  </button>
                </>
              )}
              <button className="drawer-btn ghost">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Choice modal (Create Invoice entry point) ─────────────────── */}
      {choiceOpen && (
        <div className="modal-overlay open" onClick={() => setChoiceOpen(false)}>
          <div className="choice-box" onClick={(e) => e.stopPropagation()}>
            <div className="choice-head">
              <div className="choice-title">New Invoice</div>
              <button className="choice-close" onClick={() => setChoiceOpen(false)}>
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="method-cards">
              <div className="method-card" onClick={() => { setChoiceOpen(false); navigate("/invoices/new?mode=upload"); }}>
                <div className="method-icon upload">
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div className="method-title">Upload PO Customer</div>
                <div className="method-sub">Upload the PO document and Klay extracts the data automatically.</div>
                <span className="method-tag ai"><AISvg />AI Ekstrak Automatic</span>
              </div>
              <div className="method-card" onClick={() => { setChoiceOpen(false); navigate("/invoices/new?mode=manual"); }}>
                <div className="method-icon manual">
                  <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </div>
                <div className="method-title">Isi Manual</div>
                <div className="method-sub">Input data invoice in manual with form terstruktur.</div>
                <span className="method-tag man">Form Manual</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Send modal (from drawer's "Send Invoice") ──────────────── */}
      {sendOpen && selected && (
        <div className="modal-overlay open" onClick={() => !sendSuccess && setSendOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            {sendSuccess ? (
              <div className="send-success">
                <div className="send-success-icon">
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div className="send-success-title">Invoice sent ✓</div>
                <div className="send-success-sub">Status berubah to "Unpaid"</div>
              </div>
            ) : (
              <>
                <div className="modal-title">Send Invoice</div>
                <div className="modal-sub">Invoice {selected.id} will be emailed to the customer with the PDF attached.</div>
                <div className="fld">
                  <label>Send to</label>
                  <input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} />
                </div>
                <div className="fld">
                  <label>CC (opsional)</label>
                  <input type="email" value={sendCC} onChange={(e) => setSendCC(e.target.value)} placeholder="cc@yourcompany.id" />
                </div>
                <div className="fld">
                  <label>Message</label>
                  <textarea value={sendMsg} onChange={(e) => setSendMsg(e.target.value)} />
                </div>
                <div className="modal-footer">
                  <button className="modal-cancel" onClick={() => setSendOpen(false)}>Cancel</button>
                  <button className="modal-confirm" onClick={confirmSend}>
                    <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Send Sekarang
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <KlayActionModal intent={klayAction} onClose={() => setKlayAction(null)} />

      {toast && <div className="toast show">{toast}</div>}

      {/* ── Klay AI chat drawer ─────────────────────────────────────── */}
      <div
        className={`ai-backdrop${aiOpen ? " open" : ""}`}
        onClick={() => { setAiOpen(false); }}
        aria-hidden={!aiOpen}
      />
      <AiChatDrawer
        open={aiOpen}
        onClose={() => { setAiOpen(false); setAiSeedQuestion(null); }}
        initialQuestion={aiSeedQuestion}
        onConsumedInitialQuestion={() => setAiSeedQuestion(null)}
        context={aiContext}
        contextLabel="Invoices"
      />
    </div>
  );
}
