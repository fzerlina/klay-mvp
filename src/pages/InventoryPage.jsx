import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useInventory } from "../state/InventoryContext";
import { INV_CAT_LABELS, INV_UOM_LABELS } from "../data/seed/inventory";
import { formatRupiah, formatNumber, formatDate } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./inventory.css";

// Inventory — the combined product-master + on-hand-stock list (2026 MVP). One
// row per product with its inventory status and total stock available. A product
// whose stock is split across warehouses collapses to a single row that expands
// to the per-location breakdown (a product can have many inventory locations).

// Locations for a product — fall back to a single synthetic location for items
// created before the field existed, so the row model stays uniform.
function locationsOf(it) {
  if (Array.isArray(it.locations) && it.locations.length) return it.locations;
  return [{ loc: "Main Warehouse", qty: it.qty || 0 }];
}

const STATUS_META = {
  active:   { label: "Active",   tone: "active" },
  inactive: { label: "Inactive", tone: "inactive" },
};

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.active;
  return <span className={`iv-status iv-status-${meta.tone}`}>{meta.label}</span>;
}

function StockCell({ it, locs }) {
  const out = (it.qty || 0) <= 0;
  if (out) return <span className="iv-stock-out">Out of stock</span>;
  return (
    <span className="iv-stock">
      <span className="iv-stock-qty">{formatNumber(it.qty)}</span>
      <span className="iv-stock-uom">{INV_UOM_LABELS[it.uom] || it.uom}</span>
      {locs.length > 1 && <span className="iv-stock-locs">· {locs.length} locations</span>}
    </span>
  );
}

function InventoryRow({ it, expanded, onToggle, onOpen }) {
  const locs = locationsOf(it);
  const multi = locs.length > 1;
  return (
    <>
      <div className="iv-row" onClick={onOpen}>
        <div className="iv-chevron-cell" onClick={(e) => { e.stopPropagation(); if (multi) onToggle(); }}>
          {multi && (
            <svg className={`iv-chevron${expanded ? " open" : ""}`} viewBox="0 0 24 24" aria-hidden>
              <polyline points="9 18 15 12 9 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <div className="iv-sku">{it.sku}</div>
        <div className="iv-name">{it.name}</div>
        <div><span className={`cat-badge inv-${it.category}`}>{INV_CAT_LABELS[it.category] || it.category}</span></div>
        <div><StatusPill status={it.status || "active"} /></div>
        <div className="iv-stock-cell"><StockCell it={it} locs={locs} /></div>
        <div className="iv-num">{formatRupiah(it.unit_cost)}</div>
        <div className="iv-num iv-value">{formatRupiah(it.value)}</div>
      </div>
      {multi && expanded && (
        <div className="iv-loc-wrap">
          {locs.map((l, i) => (
            <div key={i} className="iv-loc-row">
              <div className="iv-loc-name">
                <svg viewBox="0 0 24 24" aria-hidden><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" fill="none" stroke="currentColor" strokeWidth="1.6"/><circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg>
                {l.loc}
              </div>
              <div className="iv-loc-qty">
                {formatNumber(l.qty)} <span className="iv-stock-uom">{INV_UOM_LABELS[it.uom] || it.uom}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
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
  "name-asc":     "Name A–Z",
  "name-desc":    "Name Z–A",
  "sku-asc":      "SKU A–Z",
  "qty-desc":     "Stock high → low",
  "qty-asc":      "Stock low → high",
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
const STATUS_OPTIONS = [
  { k: "active",   lbl: "Active" },
  { k: "inactive", lbl: "Inactive" },
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

  const reset = () => setDraft({ categories: new Set(), stock: new Set(), status: new Set() });
  const apply = () => { onChange(draft); onClose(); };

  const categories = Object.keys(INV_CAT_LABELS);
  const summary = (set) => (set.size > 0 ? `${set.size} selected` : "all");

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Inventory status ({summary(draft.status)})</div>
          <div className="lg-toggle-row">
            {STATUS_OPTIONS.map((s) => (
              <button key={s.k} className={`lg-toggle${draft.status.has(s.k) ? " on" : ""}`} onClick={() => toggleIn("status", s.k)}>
                {s.lbl}
              </button>
            ))}
          </div>
        </div>
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
          <div className="lg-filter-fld-lbl">Stock ({summary(draft.stock)})</div>
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
  const emptyFilters = { categories: new Set(), stock: new Set(), status: new Set() };
  const [filterValues, setFilterValues] = useState(emptyFilters);
  const [sortPopOpen, setSortPopOpen] = useState(false);
  const [filterPopOpen, setFilterPopOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  const effectiveSort = sortChoice || "updated-desc";

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.categories.size > 0) n++;
    if (filterValues.stock.size > 0) n++;
    if (filterValues.status.size > 0) n++;
    return n;
  }, [filterValues]);

  const hasActiveFilters = activeFilterCount > 0 || sortChoice !== null || search.trim() !== "";

  const filtered = useMemo(() => {
    let list = items;
    if (filterValues.status.size > 0) list = list.filter((it) => filterValues.status.has(it.status || "active"));
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
      (INV_CAT_LABELS[it.category] || "").toLowerCase().includes(q) ||
      locationsOf(it).some((l) => (l.loc || "").toLowerCase().includes(q)),
    );
    return list;
  }, [items, filterValues, search]);

  const rows = useMemo(() => {
    const arr = [...filtered];
    switch (effectiveSort) {
      case "updated-desc": arr.sort((a, b) => (b.updated || "").localeCompare(a.updated || "")); break;
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

  const totalValue = useMemo(() => rows.reduce((s, r) => s + (r.value || 0), 0), [rows]);
  const activeCount = useMemo(() => rows.filter((r) => (r.status || "active") === "active").length, [rows]);

  const toggleExpand = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

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
              <p className="iv-lede">Products and their on-hand stock. Items stocked in more than one warehouse expand to the per-location split.</p>
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
          <div className="lg-card">
            <div className="lg-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input placeholder="Search item, SKU, category, or location…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta">
                <div className="lg-meta-static">
                  {rows.length} {rows.length === 1 ? "product" : "products"} · {activeCount} active · <span style={{ fontFamily: "var(--font-mono)" }}>{formatRupiah(totalValue)}</span>
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

            <div className="iv-scroll">
              <div className="iv-inner">
                <div className="iv-col-header">
                  <div />
                  <div>SKU</div>
                  <div>Item Name</div>
                  <div>Category</div>
                  <div>Inventory Status</div>
                  <div>Stock Available</div>
                  <div className="iv-num">Unit Cost</div>
                  <div className="iv-num">Stock Value</div>
                </div>

                {rows.length === 0 && <div className="lg-empty">No products match your search</div>}
                {rows.map((it) => (
                  <InventoryRow
                    key={it.id}
                    it={it}
                    expanded={expanded.has(it.id)}
                    onToggle={() => toggleExpand(it.id)}
                    onOpen={() => navigate(`/inventory/${it.id}`)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>{/* /lg-scroll-container */}
    </div>
  );
}
