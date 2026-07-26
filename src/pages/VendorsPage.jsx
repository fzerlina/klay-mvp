import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { BILLS as bills } from "../data/seed/bills";
import { useVendors } from "../state/VendorsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { CAT_LABELS, PPH_SHORT_LABELS } from "../data/labels";
import { TODAY, daysSince } from "../lib/clock";
import { formatDate } from "../lib/format";
import AiChatDrawer from "./AiChatDrawer";
import SummaryDrawer from "./SummaryDrawer";
import { computeVendorsInsights, makeVendorsAiContext } from "./ai-vendors-context";
import { TierPill } from "../components/RelationshipTier";
import "./modules.css";
import "./invoices-ledger.css";

const HEALTH_CHIP = {
  review:  { cls: "review",  lbl: "Review" },
  flagged: { cls: "flagged", lbl: "Flagged" },
};

// NPWP display — mask the prefix, reveal the last 6 digits (PRD Vendor List spec).
function maskNpwp(taxId) {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, "");
  if (digits.length < 6) return taxId;
  const last6 = digits.slice(-6);
  return `••• ${last6.slice(0, 3)}.${last6.slice(3)}`;
}

// Default bank account, shown as bank name + last 4 digits only.
function bankDisplay(banks) {
  if (!banks || !banks.length) return null;
  const b = banks.find((x) => x.isDefault) || banks[0];
  const digits = (b.acc || "").replace(/\D/g, "");
  return { name: b.name, last4: digits.slice(-4) };
}

function VendorRow({ r, onClick, onKebab, isSelected, isAlt, showKebab = true }) {
  const stale = daysSince(r.lastTx) > 60 && r.status === "active";
  const chip = HEALTH_CHIP[r.health];
  const npwp = maskNpwp(r.tax_id);
  const bank = bankDisplay(r.banks);
  return (
    <div className={`lg-row${isSelected ? " selected" : ""}${isAlt ? " alt" : ""}`} onClick={onClick}>
      <div className="lg-cell-no">{r.code}</div>
      <div className="lg-cell-customer">
        <div className="lg-cell-customer-body">
          <div className="lg-cell-customer-name">
            <span className="vh-name">{r.name}</span>
            {chip && <span className={`vh-chip ${chip.cls}`} title={`Health: ${chip.lbl}`}>{chip.lbl}</span>}
            <TierPill tier={r.relationship_tier} />
          </div>
          <div className="lg-cell-customer-addr">{r.contact} · {r.email}</div>
        </div>
      </div>
      <div className="lg-cell-date">{npwp || <span className="lg-cell-em-dash">—</span>}</div>
      <div className="lg-cell-date">{r.payment_terms}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{PPH_SHORT_LABELS[r.pph] || PPH_SHORT_LABELS.none}</div>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {bank ? (
          <>{bank.name} <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>••••{bank.last4}</span></>
        ) : (
          <span className="lg-cell-em-dash">—</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: stale ? "var(--color-warning-text)" : "var(--color-text-tertiary)", fontWeight: stale ? 600 : 400 }}>
        {r.lastTx ? (
          <>
            {formatDate(r.lastTx)}
            {stale && <div style={{ fontSize: 10, marginTop: 1 }}>{daysSince(r.lastTx)} days ago</div>}
          </>
        ) : (
          <span className="lg-cell-em-dash">—</span>
        )}
      </div>
      <div>
        <span className={`cat-badge ${r.category}`}>{CAT_LABELS[r.category] || r.category}</span>
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

function RowMenu({ vendor, onClose, onAction, canTransact = true, canApprove = false }) {
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
          <div className="row-menu-item" onClick={() => onAction("edit", vendor)}>
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </div>
          <div className="row-menu-item" onClick={() => onAction("newBill", vendor)}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            New Bill
          </div>
          <div className="row-menu-item" onClick={() => onAction("duplicate", vendor)}>
            <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            Duplicate
          </div>
          <div className="row-menu-sep" />
          {vendor.status === "active" && (
            <div className="row-menu-item" onClick={() => onAction("deactivate", vendor)}>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              Deactivate
            </div>
          )}
          {vendor.status === "pending" && canApprove && (
            <div className="row-menu-item" onClick={() => onAction("approve", vendor)}>
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Approve
            </div>
          )}
          {vendor.status === "inactive" && (
            <div className="row-menu-item" onClick={() => onAction("activate", vendor)}>
              <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              Reactivate
            </div>
          )}
          {vendor.status === "blocked" && canApprove && (
            <div className="row-menu-item" onClick={() => onAction("unblock", vendor)}>
              <svg viewBox="0 0 24 24"><path d="M7 11V7a5 5 0 0 1 9.9-1"/><rect x="4" y="11" width="16" height="10" rx="2"/></svg>
              Unblock
            </div>
          )}
          <div className="row-menu-item danger" onClick={() => onAction("archive", vendor)}>
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
  "lasttx-desc":  "Last transaction newest ↓",
  "lasttx-asc":   "Last transaction oldest ↑",
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

const HEALTH_FILTER_OPTIONS = [
  { k: "healthy", lbl: "Healthy" },
  { k: "review",  lbl: "Review" },
  { k: "flagged", lbl: "Flagged" },
];

const TIER_FILTER_OPTIONS = [
  { k: "strategic", lbl: "Strategic" },
  { k: "standard",  lbl: "Standard" },
  { k: "at_risk",   lbl: "At-Risk" },
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

  const reset = () => setDraft({ categories: new Set(), terms: new Set(), pph: new Set(), health: new Set(), tier: new Set() });
  const apply = () => { onChange(draft); onClose(); };

  const categories = ["inventory", "service", "expense", "cooperative", "individual"];
  const allTerms = ["NET 7", "NET 14", "NET 15", "NET 30", "NET 45", "NET 60"];
  const pphKeys = ["none", "pph23_2", "pph23_15", "pph4_final", "pph21"];

  const summary = (set) => (set.size > 0 ? `${set.size} selected` : "all");

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Category ({summary(draft.categories)})</div>
          <div className="lg-toggle-row">
            {categories.map((c) => (
              <button key={c} className={`lg-toggle${draft.categories.has(c) ? " on" : ""}`} onClick={() => toggleIn("categories", c)}>
                {CAT_LABELS[c] || c}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Payment Terms ({summary(draft.terms)})</div>
          <div className="lg-toggle-row">
            {allTerms.map((t) => (
              <button key={t} className={`lg-toggle${draft.terms.has(t) ? " on" : ""}`} onClick={() => toggleIn("terms", t)}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">PPh Status ({summary(draft.pph)})</div>
          <div className="lg-toggle-row">
            {pphKeys.map((p) => (
              <button key={p} className={`lg-toggle${draft.pph.has(p) ? " on" : ""}`} onClick={() => toggleIn("pph", p)}>
                {PPH_SHORT_LABELS[p]}
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
      </div>
      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={reset}>Reset</button>
        <button className="lg-filter-apply" onClick={apply}>Apply filter</button>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VendorsPage() {
  const navigate = useNavigate();
  const { hasLevel, hasCapability } = useCurrentUser();
  const canCreate = hasLevel("ap", "transact");
  // Onboarding a vendor is a discrete capability (roles.js): AP Staff holds it;
  // Finance Manager is excluded by SoD (create + pay = fake-vendor fraud).
  const canCreateVendor = hasCapability("vendor.create");
  // Approving a pending vendor (and unblocking a held one) is an approver
  // control action — SoD-separated from creating it. Prototype stand-in for the
  // future vendor.confirm / vendor.hold capabilities: gate on ap.post, which
  // both Finance Manager and Accounting Manager hold (AP Staff / Finance Staff
  // do not), matching "the managers can approve/unblock."
  const canApprove = hasCapability("ap.post");
  const { vendors, setVendorStatus } = useVendors();
  // AP balance as of vendor (derived from bills)
  const apBalance = useMemo(() => {
    const m = {};
    for (const b of bills) {
      if (b.pay === "paid") continue;
      m[b.vendor] = (m[b.vendor] || 0) + b.sisa;
    }
    return m;
  }, []);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState({ kind: "tab", value: "active" });
  const [sortChoice, setSortChoice] = useState(null);
  const emptyFilters = { categories: new Set(), terms: new Set(), pph: new Set(), health: new Set(), tier: new Set() };
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

  const insights = useMemo(() => computeVendorsInsights(vendors), [vendors]);
  const aiContext = useMemo(() => makeVendorsAiContext(vendors), [vendors]);

  function askAi(question) {
    setSummaryOpen(false);
    setAiSeedQuestion(question);
    setAiOpen(true);
  }

  // ── Tab counts (by lifecycle status) ─────────────────────────────────────
  const statusCounts = useMemo(() => {
    const c = { active: 0, pending: 0, inactive: 0, blocked: 0 };
    for (const v of vendors) if (c[v.status] != null) c[v.status]++;
    return c;
  }, [vendors]);
  const tabs = [
    { k: "active",   lbl: "Active",   count: statusCounts.active },
    { k: "pending",  lbl: "Pending",  count: statusCounts.pending },
    { k: "inactive", lbl: "Inactive", count: statusCounts.inactive },
    { k: "blocked",  lbl: "Blocked",  count: statusCounts.blocked },
  ];

  // ── Corpus — tabs map 1:1 to lifecycle status ───────────────────────────
  const corpus = useMemo(() => {
    if (filter.kind === "tab") return vendors.filter((v) => v.status === filter.value);
    return vendors;
  }, [filter, vendors]);

  const hasActiveFilters = useMemo(() => (
    filterValues.categories.size > 0 ||
    filterValues.terms.size > 0 ||
    filterValues.pph.size > 0 ||
    filterValues.health.size > 0 ||
    filterValues.tier.size > 0 ||
    sortChoice !== null
  ), [filterValues, sortChoice]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.categories.size > 0) n++;
    if (filterValues.terms.size > 0) n++;
    if (filterValues.pph.size > 0) n++;
    if (filterValues.health.size > 0) n++;
    if (filterValues.tier.size > 0) n++;
    return n;
  }, [filterValues]);

  // ── Apply filter values + search ───────────────────────────────────────
  const filteredRows = useMemo(() => {
    let list = corpus;
    if (filterValues.categories.size > 0) list = list.filter((v) => filterValues.categories.has(v.category));
    if (filterValues.terms.size > 0) list = list.filter((v) => filterValues.terms.has(v.payment_terms));
    if (filterValues.pph.size > 0) list = list.filter((v) => filterValues.pph.has(v.pph || "none"));
    if (filterValues.health.size > 0) list = list.filter((v) => filterValues.health.has(v.health || "healthy"));
    if (filterValues.tier.size > 0) list = list.filter((v) => filterValues.tier.has(v.relationship_tier || "standard"));

    const q = search.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, "");
    if (q) list = list.filter((v) =>
      v.name.toLowerCase().includes(q) ||
      v.code.toLowerCase().includes(q) ||
      (v.contact && v.contact.toLowerCase().includes(q)) ||
      (v.tax_id && (
        v.tax_id.toLowerCase().includes(q) ||
        (qDigits && v.tax_id.replace(/\D/g, "").includes(qDigits))
      )),
    );
    return list.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      contact: v.contact,
      email: v.email,
      address: v.address,
      category: v.category,
      type: v.type,
      status: v.status,
      health: v.health,
      relationship_tier: v.relationship_tier,
      pph: v.pph,
      tax_id: v.tax_id,
      banks: v.banks,
      payment_terms: v.payment_terms,
      lastTx: v.lastTx,
      apBalance: apBalance[v.id] || 0,
      raw: v,
    }));
  }, [corpus, filterValues, search, apBalance]);

  // ── Sort ─────────────────────────────────────────────────────────────
  const effectiveSort = sortChoice || "name-asc";

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    switch (effectiveSort) {
      case "name-asc":    arr.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc":   arr.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "lasttx-desc": arr.sort((a, b) => (b.lastTx || "").localeCompare(a.lastTx || "")); break;
      case "lasttx-asc":  arr.sort((a, b) => (a.lastTx || "").localeCompare(b.lastTx || "")); break;
      case "code-asc":    arr.sort((a, b) => a.code.localeCompare(b.code)); break;
      default: break;
    }
    return arr;
  }, [filteredRows, effectiveSort]);

  // ── Handlers ───────────────────────────────────────────────────────────
  function selectTab(t) { setFilter({ kind: "tab", value: t }); }
  const isTabActive  = (t) => filter.kind === "tab" && filter.value === t;

  function resetAll() {
    setSortChoice(null);
    setFilterValues(emptyFilters);
    setSearch("");
  }

  function exportCsv() {
    const headers = ["Code", "Name", "Category", "Type", "PIC", "Email", "Telepon", "Address", "NPWP", "Terms", "Status", "Last Transaction", "AP Balance"];
    const esc = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of sortedRows) {
      lines.push([r.code, r.name, CAT_LABELS[r.category] || r.category, r.type, r.contact, r.email, r.raw.phone, r.address, r.raw.tax_id || "", r.payment_terms, r.status, r.lastTx, r.apBalance].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = `${TODAY.getFullYear()}${String(TODAY.getMonth() + 1).padStart(2, "0")}${String(TODAY.getDate()).padStart(2, "0")}`;
    a.download = `klay-vendors-${filter.value}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${sortedRows.length} vendor exported to CSV`);
  }

  function onRowAction(action, v) {
    setMenuOpenFor(null);
    if (action === "edit") showToast(`Edit ${v.name} (demo)`);
    else if (action === "newBill") showToast(`New bill for ${v.name} (demo)`);
    else if (action === "duplicate") showToast(`Duplicated ${v.name} (demo)`);
    else if (action === "approve") { setVendorStatus(v.id, "active"); showToast(`${v.name} approved — now active`); }
    else if (action === "activate") { setVendorStatus(v.id, "active"); showToast(`${v.name} reactivated`); }
    else if (action === "unblock") { setVendorStatus(v.id, "active"); showToast(`${v.name} unblocked — now active`); }
    else if (action === "deactivate") { setVendorStatus(v.id, "inactive"); showToast(`${v.name} set to inactive`); }
    else if (action === "archive") showToast(`${v.name} archived (demo)`);
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        {/* ── Editorial header ──────────────────────────────────────── */}
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Vendors</h1>
            </div>
            <div className="lg-head-actions">
              <button
                className="lg-btn-brand"
                disabled={!canCreateVendor}
                title={canCreateVendor ? undefined : "Requires the Create Vendors capability (AP Staff)"}
                onClick={() => canCreateVendor && navigate("/vendors/new")}
              >
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Vendor
              </button>
            </div>
          </div>
        </div>

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card lg-table-vendor">
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
                <input placeholder="Search vendor name, NPWP, code, or contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
              <div>Name</div>
              <div>NPWP</div>
              <div>Terms</div>
              <div>PPh Status</div>
              <div>Bank Account</div>
              <div>Last Transaction</div>
              <div>Category</div>
              <div />
            </div>

            <div>
              {sortedRows.length === 0 && <div className="lg-empty">None vendor matching</div>}
              {sortedRows.map((r, i) => (
                <div key={r.id} style={{ position: "relative" }}>
                  <VendorRow
                    r={r}
                    onClick={() => navigate(`/vendors/${r.id}`)}
                    onKebab={(id) => setMenuOpenFor(menuOpenFor === id ? null : id)}
                    isAlt={i % 2 === 1}
                    showKebab={canCreate}
                  />
                  {menuOpenFor === r.id && (
                    <div style={{ position: "absolute", right: 32, top: 32, zIndex: 5 }}>
                      <RowMenu vendor={r.raw} onClose={() => setMenuOpenFor(null)} onAction={onRowAction} canTransact={canCreate} canApprove={canApprove} />
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
        contextLabel="Vendors"
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
