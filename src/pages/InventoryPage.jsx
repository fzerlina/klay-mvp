import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useInventory } from "../state/InventoryContext";
import { INV_CAT_LABELS, INV_UOM_LABELS } from "../data/seed/inventory";
import { formatRupiah, formatNumber, formatDate } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";

// Inventory List — master-data list of stock items, built on the shared lg-*
// list layout (same skeleton as Vendors / Customers). Search + Filter (category,
// stock status) + Sort are live. Status tabs, CSV export, kebab actions and AI
// drawers remain deferred.

function InventoryRow({ r, onClick, isAlt }) {
  const out = r.qty <= 0;
  return (
    <div className={`lg-row${isAlt ? " alt" : ""}`} onClick={onClick}>
      <div className="lg-cell-no">{r.sku}</div>
      <div className="lg-cell-customer">
        <div className="lg-cell-customer-body">
          <div className="lg-cell-customer-name">
            <span className="vh-name">{r.name}</span>
          </div>
        </div>
      </div>
      <div>
        <span className={`cat-badge inv-${r.category}`}>{INV_CAT_LABELS[r.category] || r.category}</span>
      </div>
      <div style={{ fontSize: 11.5, color: out ? "var(--color-danger-text)" : "var(--color-text-secondary)", fontWeight: out ? 600 : 400 }}>
        {out ? "Out of stock" : <>{formatNumber(r.qty)} <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>{INV_UOM_LABELS[r.uom] || r.uom}</span></>}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--color-text-secondary)", textAlign: "right" }}>
        {formatRupiah(r.unit_cost)}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 600, color: "var(--color-text-primary)", textAlign: "right" }}>
        {formatRupiah(r.value)}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-tertiary)" }}>
        {r.updated ? formatDate(r.updated) : <span className="lg-cell-em-dash">—</span>}
      </div>
    </div>
  );
}

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

const SORT_LABELS = {
  "updated-desc": "Last updated",
  "updated-asc":  "Last updated (oldest)",
  "name-asc":     "Name A–Z",
  "name-desc":    "Name Z–A",
  "sku-asc":      "SKU A–Z",
  "qty-desc":     "Qty on hand high → low",
  "qty-asc":      "Qty on hand low → high",
  "value-desc":   "Stock value high → low",
  "value-asc":    "Stock value low → high",
};

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

const STOCK_OPTIONS = [
  { k: "in",  lbl: "In stock" },
  { k: "out", lbl: "Out of stock" },
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

  const reset = () => setDraft({ categories: new Set(), stock: new Set() });
  const apply = () => { onChange(draft); onClose(); };

  const categories = Object.keys(INV_CAT_LABELS);
  const summary = (set) => (set.size > 0 ? `${set.size} selected` : "all");

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Category ({summary(draft.categories)})</div>
          <div className="lg-toggle-row">
            {categories.map((c) => (
              <button key={c} className={`lg-toggle${draft.categories.has(c) ? " on" : ""}`} onClick={() => toggleIn("categories", c)}>
                {INV_CAT_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Stock status ({summary(draft.stock)})</div>
          <div className="lg-toggle-row">
            {STOCK_OPTIONS.map((s) => (
              <button key={s.k} className={`lg-toggle${draft.stock.has(s.k) ? " on" : ""}`} onClick={() => toggleIn("stock", s.k)}>
                {s.lbl}
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

export default function InventoryPage() {
  const navigate = useNavigate();
  const { items } = useInventory();

  const [search, setSearch] = useState("");
  const [sortChoice, setSortChoice] = useState(null);
  const emptyFilters = { categories: new Set(), stock: new Set() };
  const [filterValues, setFilterValues] = useState(emptyFilters);
  const [sortPopOpen, setSortPopOpen] = useState(false);
  const [filterPopOpen, setFilterPopOpen] = useState(false);

  const effectiveSort = sortChoice || "updated-desc";

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.categories.size > 0) n++;
    if (filterValues.stock.size > 0) n++;
    return n;
  }, [filterValues]);

  const hasActiveFilters = activeFilterCount > 0 || sortChoice !== null || search.trim() !== "";

  // ── Filter + search ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items;
    if (filterValues.categories.size > 0) list = list.filter((it) => filterValues.categories.has(it.category));
    if (filterValues.stock.size > 0) {
      list = list.filter((it) => {
        const isOut = (it.qty || 0) <= 0;
        return (filterValues.stock.has("out") && isOut) || (filterValues.stock.has("in") && !isOut);
      });
    }
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      it.sku.toLowerCase().includes(q) ||
      (INV_CAT_LABELS[it.category] || "").toLowerCase().includes(q),
    );
    return list;
  }, [items, filterValues, search]);

  // ── Sort ─────────────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const arr = [...filtered];
    switch (effectiveSort) {
      case "updated-desc": arr.sort((a, b) => (b.updated || "").localeCompare(a.updated || "")); break;
      case "updated-asc":  arr.sort((a, b) => (a.updated || "").localeCompare(b.updated || "")); break;
      case "name-asc":   arr.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc":  arr.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "sku-asc":    arr.sort((a, b) => a.sku.localeCompare(b.sku)); break;
      case "qty-desc":   arr.sort((a, b) => (b.qty || 0) - (a.qty || 0)); break;
      case "qty-asc":    arr.sort((a, b) => (a.qty || 0) - (b.qty || 0)); break;
      case "value-desc": arr.sort((a, b) => (b.value || 0) - (a.value || 0)); break;
      case "value-asc":  arr.sort((a, b) => (a.value || 0) - (b.value || 0)); break;
      default: break;
    }
    return arr;
  }, [filtered, effectiveSort]);

  // Header summary — total on-hand valuation across the (filtered) list.
  const totalValue = useMemo(() => rows.reduce((s, r) => s + (r.value || 0), 0), [rows]);

  function resetAll() {
    setSortChoice(null);
    setFilterValues(emptyFilters);
    setSearch("");
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        {/* ── Editorial header ──────────────────────────────────────── */}
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Inventory</h1>
            </div>
            <div className="lg-head-actions">
              <button className="lg-btn-brand" onClick={() => navigate("/inventory/new")}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add New Inventory
              </button>
            </div>
          </div>
        </div>

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card lg-table-inventory">
            {/* TODO(defer): status tabs (bp-tabs-row) go here — e.g. In stock / Low / Out */}

            <div className="lg-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input placeholder="Search item name, SKU, or category…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta">
                <div className="lg-meta-static">
                  {rows.length} {rows.length === 1 ? "item" : "items"} · <span style={{ fontFamily: "var(--font-mono)" }}>{formatRupiah(totalValue)}</span>
                </div>
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
                {hasActiveFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            <div className="lg-col-header">
              <div>SKU</div>
              <div>Item Name</div>
              <div>Category</div>
              <div>Stock</div>
              <div style={{ textAlign: "right" }}>Unit Cost</div>
              <div style={{ textAlign: "right" }}>Stock Value</div>
              <div>Last Updated</div>
            </div>

            <div>
              {rows.length === 0 && <div className="lg-empty">No items match your search</div>}
              {rows.map((r, i) => (
                <InventoryRow
                  key={r.id}
                  r={r}
                  onClick={() => navigate(`/inventory/${r.id}`)}
                  isAlt={i % 2 === 1}
                />
              ))}
            </div>
          </div>
        </div>
      </div>{/* /lg-scroll-container */}
    </div>
  );
}
