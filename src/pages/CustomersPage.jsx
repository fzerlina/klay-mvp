import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomers } from "../state/CustomersContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { TODAY } from "../lib/clock";
import { termLabel } from "../lib/format";
import AiChatDrawer from "./AiChatDrawer";
import SummaryDrawer from "./SummaryDrawer";
import { computeCustomersInsights, makeCustomersAiContext } from "./ai-customers-context";
import { TierPill } from "../components/RelationshipTier";
import "./modules.css";
import "./invoices-ledger.css";

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

// Lifecycle badge (draft | active | inactive) + approval badge (approved | pending).
const LIFECYCLE_BADGE = {
  draft:    { cls: "draft",    lbl: "Draft" },
  inactive: { cls: "inactive", lbl: "Inactive" },
  active:   { cls: "active",   lbl: "Active" },
};
function LifecycleBadge({ status }) {
  const s = LIFECYCLE_BADGE[status] || LIFECYCLE_BADGE.active;
  return <span className={`v-life ${s.cls}`}>{s.lbl}</span>;
}
function ApprovalBadge({ approval }) {
  if (approval === "pending_approval") return <span className="v-appr pending">Pending approval</span>;
  return <span className="v-appr approved">Approved</span>;
}

function CustomerRow({ r, onClick, onKebab, isAlt, showKebab = true }) {
  const npwp = maskNpwp(r.npwp);
  return (
    <div className={`lg-row${isAlt ? " alt" : ""}`} onClick={onClick}>
      <div className="lg-cell-no">{r.code}</div>
      <div className="lg-cell-customer">
        <div className="lg-cell-customer-body">
          <div className="lg-cell-customer-name">
            <span className="vh-name">{r.legalName || r.name}</span>
            {r.relationship_tier && r.relationship_tier !== "standard" && <TierPill tier={r.relationship_tier} />}
            {r.on_hold && <span className="v-hold" title={r.hold_reason ? `Credit hold: ${r.hold_reason}` : "On credit hold"}>Credit hold</span>}
            {r.overLimit && (
              <span className="v-over" title={`Credit used Rp ${fmtRp(r.ar)} exceeds the limit of Rp ${fmtRp(r.creditLimit)}`}>Over limit</span>
            )}
          </div>
        </div>
      </div>
      <div className="lg-cell-date">{npwp || <span className="lg-cell-em-dash">—</span>}</div>
      <div className="lg-cell-date">{termLabel(r.top)}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", textAlign: "right", paddingRight: 14 }}>
        {r.creditLimit > 0 ? (
          <>
            <span className={r.overLimit ? "lg-credit-used over" : "lg-credit-used"}>{fmtRp(r.ar)}</span>
            <span style={{ color: "var(--color-text-tertiary)" }}> / {fmtRp(r.creditLimit)}</span>
          </>
        ) : (
          <span className="lg-cell-em-dash">—</span>
        )}
      </div>
      <div><LifecycleBadge status={r.status} /></div>
      <div><ApprovalBadge approval={r.approval} /></div>
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
          {customer.status !== "draft" && (
            <div className="row-menu-item" onClick={() => onAction("newInvoice", customer)}>
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              New Invoice
            </div>
          )}
          <div className="row-menu-item" onClick={() => onAction("duplicate", customer)}>
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Duplicate
          </div>
          <div className="row-menu-sep" />
          {customer.status === "draft" && (
            <div className="row-menu-item" onClick={() => onAction("submit", customer)}>
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Submit for approval
            </div>
          )}
          {customer.status === "active" && customer.approval === "pending_approval" && canApprove && (
            <div className="row-menu-item" onClick={() => onAction("approve", customer)}>
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Approve
            </div>
          )}
          {customer.status === "active" && (
            <div className="row-menu-item" onClick={() => onAction("deactivate", customer)}>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              Deactivate
            </div>
          )}
          {customer.status === "inactive" && (
            <div className="row-menu-item" onClick={() => onAction("activate", customer)}>
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Reactivate
            </div>
          )}
          {customer.status === "active" && !customer.on_hold && canApprove && (
            <div className="row-menu-item" onClick={() => onAction("hold", customer)}>
              <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Credit hold
            </div>
          )}
          {customer.on_hold && canApprove && (
            <div className="row-menu-item" onClick={() => onAction("release", customer)}>
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
  "name-asc":  "Name A-Z",
  "name-desc": "Name Z-A",
  "code-asc":  "Code A-Z",
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

const TIER_FILTER_OPTIONS = [
  { k: "strategic", lbl: "Strategic" },
  { k: "standard",  lbl: "Standard" },
  { k: "at_risk",   lbl: "In Dispute" },
];

function FilterPopover({ values, onChange, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [draft, setDraft] = useState(values);

  const toggleIn = (key, v) => setDraft((d) => {
    const next = new Set(d[key]);
    next.has(v) ? next.delete(v) : next.add(v);
    return { ...d, [key]: next };
  });

  const reset = () => setDraft({ terms: new Set(), tier: new Set() });
  const apply = () => { onChange(draft); onClose(); };

  const allTerms = ["COD", "NET 7", "NET 14", "NET 15", "NET 21", "NET 30", "NET 45", "NET 60"];
  const summary = (set) => (set.size > 0 ? `${set.size} selected` : "all");

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Payment Terms ({summary(draft.terms)})</div>
          <div className="lg-toggle-row">
            {allTerms.map((t) => (
              <button key={t} className={`lg-toggle${draft.terms.has(t) ? " on" : ""}`} onClick={() => toggleIn("terms", t)}>
                {termLabel(t)}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Relationship tier ({summary(draft.tier)})</div>
          <div className="lg-toggle-row">
            {TIER_FILTER_OPTIONS.map((t) => (
              <button key={t.k} className={`lg-toggle${draft.tier.has(t.k) ? " on" : ""}`} onClick={() => toggleIn("tier", t.k)}>
                {t.lbl}
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
  const { customers, setCustomerStatus, setCustomerApproval, submitCustomer, setCustomerHold } = useCustomers();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState({ kind: "tab", value: "active" });
  const [sortChoice, setSortChoice] = useState(null);
  const emptyFilters = { terms: new Set(), tier: new Set() };
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
    const c = { draft: 0, active: 0, inactive: 0 };
    for (const cust of customers) if (c[cust.status] != null) c[cust.status]++;
    return c;
  }, [customers]);
  const tabs = [
    { k: "active",   lbl: "Active",   count: statusCounts.active },
    { k: "draft",    lbl: "Draft",    count: statusCounts.draft },
    { k: "inactive", lbl: "Inactive", count: statusCounts.inactive },
  ];

  // ── Corpus — tabs map 1:1 to lifecycle status ───────────────────────────
  const corpus = useMemo(() => {
    if (filter.kind === "tab") return customers.filter((c) => c.status === filter.value);
    return customers;
  }, [filter, customers]);

  const hasActiveFilters = useMemo(() => (
    filterValues.terms.size > 0 ||
    filterValues.tier.size > 0 ||
    sortChoice !== null
  ), [filterValues, sortChoice]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.terms.size > 0) n++;
    if (filterValues.tier.size > 0) n++;
    return n;
  }, [filterValues]);

  // ── Apply filter values + search ───────────────────────────────────────
  const filteredRows = useMemo(() => {
    let list = corpus;
    if (filterValues.terms.size > 0) list = list.filter((c) => filterValues.terms.has(c.top));
    if (filterValues.tier.size > 0) list = list.filter((c) => filterValues.tier.has(c.relationship_tier || "standard"));

    // Search: legal/display name, NPWP (full or partial), and customer code.
    const q = search.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, "");
    if (q) list = list.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.legalName && c.legalName.toLowerCase().includes(q)) ||
      c.code.toLowerCase().includes(q) ||
      (c.npwp && (c.npwp.toLowerCase().includes(q) || (qDigits && c.npwp.replace(/\D/g, "").includes(qDigits)))),
    );
    return list.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      legalName: c.legalName,
      type: c.type,
      status: c.status,
      approval: c.approval,
      on_hold: c.on_hold,
      hold_reason: c.hold_reason,
      relationship_tier: c.relationship_tier,
      npwp: c.npwp,
      top: c.top,
      creditLimit: c.creditLimit || 0,
      ar: c.ar || 0,
      // Credit used = open receivables (c.ar). Over limit is advisory here; the
      // blocking decision is the FM placing a credit hold.
      overLimit: (c.creditLimit || 0) > 0 && (c.ar || 0) > c.creditLimit,
      lastInv: c.lastInv,
      raw: c,
    }));
  }, [corpus, filterValues, search]);

  // ── Sort — customer name or code ───────────────────────────────────────
  const effectiveSort = sortChoice || "name-asc";
  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    const nameOf = (r) => (r.legalName || r.name || "");
    switch (effectiveSort) {
      case "name-asc":  arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b))); break;
      case "name-desc": arr.sort((a, b) => nameOf(b).localeCompare(nameOf(a))); break;
      case "code-asc":  arr.sort((a, b) => a.code.localeCompare(b.code)); break;
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
    const headers = ["Code", "Name", "Legal Name", "Type", "NPWP", "Terms", "Credit Limit", "Credit Used", "Over Limit", "Lifecycle", "Approval", "Credit Hold"];
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of sortedRows) {
      lines.push([r.code, r.name, r.legalName || "", r.type, r.npwp || "", r.top, r.creditLimit, r.ar, r.overLimit ? "yes" : "", r.status, r.approval, r.on_hold ? "yes" : ""].map(esc).join(","));
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
    else if (action === "submit") { submitCustomer(c.id, { actor: undefined }); showToast(`${c.name} submitted — now active, pending approval`); }
    else if (action === "approve") { setCustomerApproval(c.id, "approved", { event: "Approved" }); showToast(`${c.name} approved`); }
    else if (action === "activate") { setCustomerStatus(c.id, "active", { event: "Reactivated" }); showToast(`${c.name} reactivated`); }
    else if (action === "deactivate") { setCustomerStatus(c.id, "inactive", { event: "Deactivated" }); showToast(`${c.name} set to inactive`); }
    else if (action === "hold") { setCustomerHold(c.id, true, { event: "Credit hold" }); showToast(`${c.name} placed on credit hold`); }
    else if (action === "release") { setCustomerHold(c.id, false, { event: "Credit hold released" }); showToast(`${c.name} released from credit hold`); }
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
                <input placeholder="Search customer name, NPWP, or code…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
              <div>Legal Name</div>
              <div>NPWP</div>
              <div>Terms</div>
              <div style={{ textAlign: "right", paddingRight: 14 }}>Credit Used / Limit</div>
              <div>Lifecycle</div>
              <div>Approval</div>
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
