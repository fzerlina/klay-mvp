import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomers } from "../state/CustomersContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { TODAY, daysSince } from "../lib/clock";
import { formatDate } from "../lib/format";
import AiChatDrawer from "./AiChatDrawer";
import SummaryDrawer from "./SummaryDrawer";
import { computeCustomersInsights, makeCustomersAiContext } from "./ai-customers-context";
import { TierPill } from "../components/RelationshipTier";
import "./modules.css";
import "./invoices-ledger.css";

const HEALTH_CHIP = {
  review:  { cls: "review",  lbl: "Review" },
  flagged: { cls: "flagged", lbl: "Flagged" },
};

function fmtRp(n) {
  if (n == null) return "—";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

// NPWP display — mask the prefix, reveal the last 6 digits (mirrors Vendor List).
function maskNpwp(taxId) {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, "");
  if (digits.length < 6) return taxId;
  const last6 = digits.slice(-6);
  return `••• ${last6.slice(0, 3)}.${last6.slice(3)}`;
}

function CustomerRow({ r, onClick, onKebab, isAlt, showKebab = true }) {
  const stale = r.lastInv && daysSince(r.lastInv) >= 60 && r.status === "active";
  const overLimit = r.creditLimit > 0 && r.ar > r.creditLimit;
  const chip = HEALTH_CHIP[r.health];
  const npwp = maskNpwp(r.npwp);
  return (
    <div className={`lg-row${isAlt ? " alt" : ""}`} onClick={onClick}>
      <div className="lg-cell-no">{r.code}</div>
      <div className="lg-cell-customer">
        <div className="lg-cell-customer-body">
          <div className="lg-cell-customer-name">
            <span className="vh-name">{r.name}</span>
            {chip && <span className={`vh-chip ${chip.cls}`} title={`Health: ${chip.lbl}`}>{chip.lbl}</span>}
            <TierPill tier={r.relationship_tier} />
          </div>
          <div className="lg-cell-customer-addr">{r.contact}{r.email ? ` · ${r.email}` : ""}</div>
        </div>
      </div>
      <div>
        <span className={`type-badge ${r.type}`}>{r.type === "perusahaan" ? "Company" : "Individual"}</span>
      </div>
      <div className="lg-cell-date">{npwp || <span className="lg-cell-em-dash">—</span>}</div>
      <div className="lg-cell-date">{r.top}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", textAlign: "right" }}>
        {r.creditLimit > 0 ? (
          <><span style={{ color: "var(--color-text-tertiary)", marginRight: 2 }}>Rp</span>{fmtRp(r.creditLimit)}</>
        ) : (
          <span className="lg-cell-em-dash">—</span>
        )}
      </div>
      <div className="lg-cell-total" style={(r.arOverdue || overLimit) ? { color: "var(--color-danger-text)" } : undefined}>
        {r.ar > 0 ? (
          <><span className="lg-cell-total-rp">Rp</span>{fmtRp(r.ar)}</>
        ) : (
          <span className="lg-cell-em-dash">—</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: stale ? "var(--color-warning-text)" : "var(--color-text-tertiary)", fontWeight: stale ? 600 : 400 }}>
        {r.lastInv ? (
          <>
            {formatDate(r.lastInv)}
            {stale && <div style={{ fontSize: 10, marginTop: 1 }}>{daysSince(r.lastInv)} days ago</div>}
          </>
        ) : (
          <span className="lg-cell-em-dash">—</span>
        )}
      </div>
      <div className="lg-cell-kebab" onClick={(e) => e.stopPropagation()}>
        {showKebab && (
          <button className="lg-kebab" onClick={() => onKebab(r.id)}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

function RowMenu({ customer, onClose, onAction, canTransact = true, canApprove = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div className="row-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      {canTransact && (
        <>
          <div className="row-menu-item" onClick={() => onAction("edit", customer)}>
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </div>
          <div className="row-menu-item" onClick={() => onAction("newInvoice", customer)}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            New Invoice
          </div>
          <div className="row-menu-item" onClick={() => onAction("duplicate", customer)}>
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Duplicate
          </div>
          <div className="row-menu-sep" />
          {customer.status === "active" && (
            <>
              <div className="row-menu-item" onClick={() => onAction("deactivate", customer)}>
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                Deactivate
              </div>
              {canApprove && (
                <div className="row-menu-item" onClick={() => onAction("block", customer)}>
                  <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Credit hold
                </div>
              )}
            </>
          )}
          {customer.status === "pending" && canApprove && (
            <div className="row-menu-item" onClick={() => onAction("approve", customer)}>
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Approve
            </div>
          )}
          {customer.status === "inactive" && (
            <div className="row-menu-item" onClick={() => onAction("activate", customer)}>
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Reactivate
            </div>
          )}
          {customer.status === "blocked" && canApprove && (
            <div className="row-menu-item" onClick={() => onAction("unblock", customer)}>
              <svg viewBox="0 0 24 24"><path d="M7 11V7a5 5 0 0 1 9.9-1"/><rect x="4" y="11" width="16" height="10" rx="2"/></svg>
              Release hold
            </div>
          )}
          <div className="row-menu-item danger" onClick={() => onAction("archive", customer)}>
            <svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            Archive
          </div>
        </>
      )}
    </div>
  );
}

const SORT_LABELS = {
  "name-asc":     "Name A-Z",
  "name-desc":    "Name Z-A",
  "code-asc":     "Code A-Z",
  "ar-desc":      "AR balance highest ↓",
  "ar-asc":       "AR balance lowest ↑",
  "limit-desc":   "Credit limit highest ↓",
  "lastinv-desc": "Last invoice newest ↓",
  "lastinv-asc":  "Last invoice oldest ↑",
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
          <button key={k} className={`lg-popover-item${value === k ? " selected" : ""}`} onClick={() => onPick(k)}>
            {lbl}
            {value === k && <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}

const TYPE_FILTER_OPTIONS = [["perusahaan", "Company"], ["individu", "Individual"]];
const HEALTH_FILTER_OPTIONS = [
  { k: "healthy", lbl: "Healthy" },
  { k: "review",  lbl: "Review" },
  { k: "flagged", lbl: "Flagged" },
];
const TIER_FILTER_OPTIONS = [
  { k: "strategic", lbl: "Strategic" },
  { k: "standard",  lbl: "Standard" },
  { k: "at_risk",   lbl: "In Dispute" },
];
const ALL_TERMS = ["COD", "NET 7", "NET 14", "NET 15", "NET 21", "NET 30", "NET 45", "NET 60"];

function FilterPopover({ values, onChange, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [draft, setDraft] = useState(values);

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleIn = (key, v) => setDraft((d) => {
    const next = new Set(d[key]);
    next.has(v) ? next.delete(v) : next.add(v);
    return { ...d, [key]: next };
  });

  const reset = () => setDraft({ types: new Set(), terms: new Set(), health: new Set(), tier: new Set(), minAr: "", maxAr: "" });
  const apply = () => { onChange(draft); onClose(); };

  const summary = (set) => (set.size > 0 ? `${set.size} selected` : "all");

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Type ({summary(draft.types)})</div>
          <div className="lg-toggle-row">
            {TYPE_FILTER_OPTIONS.map(([v, lbl]) => (
              <button key={v} className={`lg-toggle${draft.types.has(v) ? " on" : ""}`} onClick={() => toggleIn("types", v)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Payment Terms ({summary(draft.terms)})</div>
          <div className="lg-toggle-row">
            {ALL_TERMS.map((t) => (
              <button key={t} className={`lg-toggle${draft.terms.has(t) ? " on" : ""}`} onClick={() => toggleIn("terms", t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Health ({summary(draft.health)})</div>
          <div className="lg-toggle-row">
            {HEALTH_FILTER_OPTIONS.map((h) => (
              <button key={h.k} className={`lg-toggle${draft.health.has(h.k) ? " on" : ""}`} onClick={() => toggleIn("health", h.k)}>
                {h.lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Relationship ({summary(draft.tier)})</div>
          <div className="lg-toggle-row">
            {TIER_FILTER_OPTIONS.map((t) => (
              <button key={t.k} className={`lg-toggle${draft.tier.has(t.k) ? " on" : ""}`} onClick={() => toggleIn("tier", t.k)}>
                {t.lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">AR Balance range (Rp)</div>
          <div className="lg-filter-row2">
            <input type="number" className="lg-filter-input" placeholder="Min" value={draft.minAr} onChange={(e) => update({ minAr: e.target.value })} />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>—</span>
            <input type="number" className="lg-filter-input" placeholder="Max" value={draft.maxAr} onChange={(e) => update({ maxAr: e.target.value })} />
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

export default function CustomersPage() {
  const navigate = useNavigate();
  const { hasLevel, hasCapability } = useCurrentUser();
  const canCreate = hasLevel("ar", "transact");
  // Onboarding a customer is a discrete capability (roles.js): AR Staff holds it.
  const canCreateCustomer = hasCapability("customer.create");
  // Approving a pending customer, placing/releasing a credit hold is an approver
  // control action — SoD-separated from creating it. Gate on ar.post, which the
  // Finance Manager and Accounting Manager hold (AR Staff / Finance Staff do not).
  const canApprove = hasCapability("ar.post");
  const { customers, setCustomerStatus } = useCustomers();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState({ kind: "tab", value: "active" });
  const [sortChoice, setSortChoice] = useState(null);
  const emptyFilters = { types: new Set(), terms: new Set(), health: new Set(), tier: new Set(), minAr: "", maxAr: "" };
  const [filterValues, setFilterValues] = useState(emptyFilters);

  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [sortPopOpen, setSortPopOpen] = useState(false);
  const [filterPopOpen, setFilterPopOpen] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeedQuestion, setAiSeedQuestion] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1800);
  }

  const insights = useMemo(() => computeCustomersInsights(customers), [customers]);
  const aiContext = useMemo(() => makeCustomersAiContext(customers), [customers]);

  function askAi(question) {
    setSummaryOpen(false);
    setAiSeedQuestion(question);
    setAiOpen(true);
  }

  // ── Tab counts (by lifecycle status) ─────────────────────────────────────
  const statusCounts = useMemo(() => {
    const c = { active: 0, pending: 0, inactive: 0, blocked: 0 };
    for (const cust of customers) if (c[cust.status] != null) c[cust.status]++;
    return c;
  }, [customers]);
  const tabs = [
    { k: "active",   lbl: "Active",   count: statusCounts.active },
    { k: "pending",  lbl: "Pending",  count: statusCounts.pending },
    { k: "inactive", lbl: "Inactive", count: statusCounts.inactive },
    { k: "blocked",  lbl: "Blocked",  count: statusCounts.blocked },
  ];

  // ── Corpus — tabs map 1:1 to lifecycle status ───────────────────────────
  const corpus = useMemo(() => {
    if (filter.kind === "tab") return customers.filter((c) => c.status === filter.value);
    return customers;
  }, [filter, customers]);

  const hasActiveFilters = useMemo(() => (
    filterValues.types.size > 0 ||
    filterValues.terms.size > 0 ||
    filterValues.health.size > 0 ||
    filterValues.tier.size > 0 ||
    filterValues.minAr !== "" ||
    filterValues.maxAr !== "" ||
    sortChoice !== null
  ), [filterValues, sortChoice]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.types.size > 0) n++;
    if (filterValues.terms.size > 0) n++;
    if (filterValues.health.size > 0) n++;
    if (filterValues.tier.size > 0) n++;
    if (filterValues.minAr !== "" || filterValues.maxAr !== "") n++;
    return n;
  }, [filterValues]);

  // ── Apply filter values + search ───────────────────────────────────────
  const filteredRows = useMemo(() => {
    let list = corpus;
    if (filterValues.types.size > 0) list = list.filter((c) => filterValues.types.has(c.type));
    if (filterValues.terms.size > 0) list = list.filter((c) => filterValues.terms.has(c.top));
    if (filterValues.health.size > 0) list = list.filter((c) => filterValues.health.has(c.health || "healthy"));
    if (filterValues.tier.size > 0) list = list.filter((c) => filterValues.tier.has(c.relationship_tier || "standard"));
    const min = filterValues.minAr === "" ? null : Number(filterValues.minAr);
    const max = filterValues.maxAr === "" ? null : Number(filterValues.maxAr);
    if (min != null && !isNaN(min)) list = list.filter((c) => (c.ar || 0) >= min);
    if (max != null && !isNaN(max)) list = list.filter((c) => (c.ar || 0) <= max);

    const q = search.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, "");
    if (q) list = list.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.contacts?.[0]?.name && c.contacts[0].name.toLowerCase().includes(q)) ||
      (c.npwp && (c.npwp.toLowerCase().includes(q) || (qDigits && c.npwp.replace(/\D/g, "").includes(qDigits)))),
    );
    return list.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      contact: c.contacts?.[0]?.name || "—",
      email: c.contacts?.[0]?.email || "",
      type: c.type,
      status: c.status,
      health: c.health,
      relationship_tier: c.relationship_tier,
      npwp: c.npwp,
      top: c.top,
      creditLimit: c.creditLimit || 0,
      ar: c.ar || 0,
      arOverdue: c.arOverdue,
      lastInv: c.lastInv,
      raw: c,
    }));
  }, [corpus, filterValues, search]);

  // ── Sort ─────────────────────────────────────────────────────────────
  const effectiveSort = sortChoice || "name-asc";
  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    switch (effectiveSort) {
      case "name-asc":     arr.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc":    arr.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "code-asc":     arr.sort((a, b) => a.code.localeCompare(b.code)); break;
      case "ar-desc":      arr.sort((a, b) => b.ar - a.ar); break;
      case "ar-asc":       arr.sort((a, b) => a.ar - b.ar); break;
      case "limit-desc":   arr.sort((a, b) => b.creditLimit - a.creditLimit); break;
      case "lastinv-desc": arr.sort((a, b) => (b.lastInv || "").localeCompare(a.lastInv || "")); break;
      case "lastinv-asc":  arr.sort((a, b) => (a.lastInv || "").localeCompare(b.lastInv || "")); break;
      default: break;
    }
    return arr;
  }, [filteredRows, effectiveSort]);

  // ── Handlers ───────────────────────────────────────────────────────────
  function selectTab(t) { setFilter({ kind: "tab", value: t }); }
  const isTabActive = (t) => filter.kind === "tab" && filter.value === t;

  function resetAll() {
    setSortChoice(null);
    setFilterValues(emptyFilters);
    setSearch("");
  }

  function exportCsv() {
    const headers = ["Code", "Name", "Type", "PIC", "Email", "NPWP", "Terms", "Credit Limit", "AR Balance", "Status", "Last Invoice"];
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of sortedRows) {
      lines.push([r.code, r.name, r.type, r.contact, r.email, r.npwp || "", r.top, r.creditLimit, r.ar, r.status, r.lastInv || ""].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = `${TODAY.getFullYear()}${String(TODAY.getMonth() + 1).padStart(2, "0")}${String(TODAY.getDate()).padStart(2, "0")}`;
    a.download = `klay-customers-${filter.value}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${sortedRows.length} customer exported to CSV`);
  }

  function onRowAction(action, c) {
    setMenuOpenFor(null);
    if (action === "edit") showToast(`Edit ${c.name} (demo)`);
    else if (action === "newInvoice") showToast(`New invoice for ${c.name} (demo)`);
    else if (action === "duplicate") showToast(`Duplicated ${c.name} (demo)`);
    else if (action === "approve") { setCustomerStatus(c.id, "active", { event: "Customer approved" }); showToast(`${c.name} approved — now active`); }
    else if (action === "activate") { setCustomerStatus(c.id, "active", { event: "Reactivated" }); showToast(`${c.name} reactivated`); }
    else if (action === "block") { setCustomerStatus(c.id, "blocked", { event: "Credit hold" }); showToast(`${c.name} placed on credit hold`); }
    else if (action === "unblock") { setCustomerStatus(c.id, "active", { event: "Credit hold released" }); showToast(`${c.name} released — now active`); }
    else if (action === "deactivate") { setCustomerStatus(c.id, "inactive", { event: "Deactivated" }); showToast(`${c.name} set to inactive`); }
    else if (action === "archive") showToast(`${c.name} archived (demo)`);
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        {/* ── Editorial header ──────────────────────────────────────── */}
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Customers</h1>
            </div>
            <div className="lg-head-actions">
              <button
                className="lg-btn-brand"
                disabled={!canCreateCustomer}
                title={canCreateCustomer ? undefined : "Requires the Create Customers capability (AR Staff)"}
                onClick={() => canCreateCustomer && navigate("/customers/new")}
              >
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Customer
              </button>
            </div>
          </div>
        </div>

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card lg-table-customer">
            <div className="bp-tabs-row">
              {tabs.map((t) => (
                <button key={t.k} className={`bp-tab${isTabActive(t.k) ? " active" : ""}`} onClick={() => selectTab(t.k)}>
                  {t.lbl}
                  <span className="bp-tab-count">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input placeholder="Search customer name, NPWP, code, or contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta">
                <div className="lg-meta-btn-wrap">
                  <button className={`lg-meta-btn${activeFilterCount > 0 ? " active" : ""}`} onClick={() => { setFilterPopOpen(!filterPopOpen); setSortPopOpen(false); }}>
                    <svg viewBox="0 0 12 12"><path d="M2 3h8M3 6h6M4 9h4" strokeLinecap="round"/></svg>
                    Filter
                    {activeFilterCount > 0 && <span className="lg-filter-badge">{activeFilterCount}</span>}
                  </button>
                  {filterPopOpen && <FilterPopover values={filterValues} onChange={setFilterValues} onClose={() => setFilterPopOpen(false)} />}
                </div>
                <div className="lg-meta-btn-wrap">
                  <button className="lg-meta-btn" onClick={() => { setSortPopOpen(!sortPopOpen); setFilterPopOpen(false); }}>
                    <span className="meta-lbl">Sort:</span>
                    <span className="meta-val">{SORT_LABELS[effectiveSort]}</span>
                  </button>
                  {sortPopOpen && <SortPopover value={effectiveSort} onPick={(v) => { setSortChoice(v); setSortPopOpen(false); }} onClose={() => setSortPopOpen(false)} />}
                </div>
                <button className="lg-filter-export" onClick={exportCsv}>
                  <svg viewBox="0 0 12 12"><path d="M6 2v6M3 6l3 3 3-3M2 10.5h8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Export CSV
                </button>
                {hasActiveFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            <div className="lg-col-header">
              <div>Code</div>
              <div>Customer</div>
              <div>Type</div>
              <div>NPWP</div>
              <div>Terms</div>
              <div style={{ textAlign: "right" }}>Credit Limit</div>
              <div style={{ textAlign: "right" }}>AR Balance</div>
              <div>Last Invoice</div>
              <div />
            </div>

            <div>
              {sortedRows.length === 0 && <div className="lg-empty">No customer matching</div>}
              {sortedRows.map((r, i) => (
                <div key={r.id} style={{ position: "relative" }}>
                  <CustomerRow
                    r={r}
                    onClick={() => navigate(`/customers/${r.id}`)}
                    onKebab={(id) => setMenuOpenFor(menuOpenFor === id ? null : id)}
                    isAlt={i % 2 === 1}
                    showKebab={canCreate}
                  />
                  {menuOpenFor === r.id && (
                    <div style={{ position: "absolute", right: 32, top: 32, zIndex: 5 }}>
                      <RowMenu customer={r.raw} onClose={() => setMenuOpenFor(null)} onAction={onRowAction} canTransact={canCreate} canApprove={canApprove} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>{/* /lg-scroll-container */}

      {/* ── Klay AI drawers ────────────────────────────────────────── */}
      <div
        className={`ai-backdrop${aiOpen || summaryOpen ? " open" : ""}`}
        onClick={() => { setAiOpen(false); setSummaryOpen(false); }}
        aria-hidden={!(aiOpen || summaryOpen)}
      />
      <SummaryDrawer open={summaryOpen} insights={insights} onClose={() => setSummaryOpen(false)} onAsk={askAi} />
      <AiChatDrawer
        open={aiOpen}
        onClose={() => { setAiOpen(false); setAiSeedQuestion(null); }}
        initialQuestion={aiSeedQuestion}
        onConsumedInitialQuestion={() => setAiSeedQuestion(null)}
        context={aiContext}
        contextLabel="Customers"
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
