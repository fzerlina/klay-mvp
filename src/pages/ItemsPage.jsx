import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useItems } from "../state/ItemsContext";
import { useInventorySubledger } from "../state/InventorySubledgerContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import {
  ITEM_CAT_LABELS, ITEM_TYPES, ITEM_TYPE_ORDER, ITEM_UOM_LABELS,
} from "../data/seed/items";
import { ITEM_LIFECYCLE_META, ITEM_LIFECYCLE_ORDER } from "../data/seed/itemGovernance";
import { formatRupiah, formatRupiahExact, formatNumber } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./items.css";

// ── Item Master ──────────────────────────────────────────────────────────────
// The catalogue. One row per item, flat — there is no expand-to-locations here,
// because a per-location split is a stock view and stock views belong to the
// Inventory Sub-Ledger.
//
// Seven of the nine columns are this module's own. The other two — On-hand and
// Stock Value — sit under a band naming the module that produced them, with the
// as-of beside it. That band is the point of the whole page: an unlabelled
// figure on an item list reads as the item's own, and these two can be stale, or
// absent, in ways the rest of the row never is.

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
  "sku-asc":      "Item ID A–Z",
  "price-desc":   "Sales price high → low",
  "price-asc":    "Sales price low → high",
  "qty-desc":     "On-hand high → low",
  "qty-asc":      "On-hand low → high",
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

// Three buckets, not two. "Not stocked" is a property of the ITEM — it was never
// stocked — and lumping it in with "No stock" would say a service ran out.
const STOCK_OPTIONS = [
  { k: "in",      lbl: "With Stock" },
  { k: "out",     lbl: "No Stock" },
  { k: "nonstock", lbl: "Not stocked" },
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

  const reset = () => setDraft({ categories: new Set(), types: new Set(), stock: new Set() });
  const apply = () => { onChange(draft); onClose(); };
  const summary = (set) => (set.size > 0 ? `${set.size} selected` : "all");

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Category ({summary(draft.categories)})</div>
          <div className="lg-toggle-row">
            {Object.keys(ITEM_CAT_LABELS).map((c) => (
              <button key={c} className={`lg-toggle${draft.categories.has(c) ? " on" : ""}`} onClick={() => toggleIn("categories", c)}>
                {ITEM_CAT_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Item type ({summary(draft.types)})</div>
          <div className="lg-toggle-row">
            {ITEM_TYPE_ORDER.map((t) => (
              <button key={t} className={`lg-toggle${draft.types.has(t) ? " on" : ""}`} onClick={() => toggleIn("types", t)} title={ITEM_TYPES[t].desc}>
                {ITEM_TYPES[t].label}
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

function StatusPill({ lifecycle }) {
  const meta = ITEM_LIFECYCLE_META[lifecycle] || ITEM_LIFECYCLE_META.active;
  return <span className={`im-status im-status-${meta.tone}`}>{meta.label}</span>;
}

// A quantity from the sub-ledger, or the right words when there is no number.
// Rp 0 / "0" is NEVER substituted for an unknown: a zero looks like a checked,
// verified figure and gets acted on, while "Unavailable" gets questioned.
function StockCell({ read, unitLabel }) {
  switch (read.state) {
    case "not_applicable": return <span className="im-dash">—</span>;
    case "unavailable":    return <span className="im-unavail">Unavailable</span>;
    case "no_record":      return <span className="im-none">No stock recorded</span>;
    default:
      return read.on_hand_qty <= 0
        ? <span className="im-stock-out-num">0</span>
        : <span className="im-stock-qty">{formatNumber(read.on_hand_qty)} <span className="im-stock-uom">{unitLabel}</span></span>;
  }
}

function ValueCell({ read }) {
  switch (read.state) {
    case "not_applicable": return <span className="im-dash">—</span>;
    case "unavailable":    return <span className="im-unavail">Unavailable</span>;
    case "no_record":      return <span className="im-none">No stock recorded</span>;
    // A replayed zero is a fact, so it prints as Rp 0.
    default:               return <span className="im-value">{formatRupiahExact(read.stock_value)}</span>;
  }
}

function ItemRow({ it, read, onOpen }) {
  const typeMeta = ITEM_TYPES[it.item_type] || ITEM_TYPES.stocked;
  const unitLabel = it.primary_unit ? (ITEM_UOM_LABELS[it.primary_unit] || it.primary_unit) : "—";
  return (
    <div className="im-row" onClick={onOpen}>
      <div className="im-sku">{it.sku}</div>
      <div className="im-name">{it.name}</div>
      <div><span className={`cat-badge inv-${it.category}`}>{ITEM_CAT_LABELS[it.category] || it.category}</span></div>
      <div><span className={`im-type im-type-${it.item_type}`} title={typeMeta.desc}>{typeMeta.label}</span></div>
      <div className="im-uom">{unitLabel}</div>
      <div className="im-num">{it.sales_price == null ? <span className="im-none">Not sold</span> : formatRupiah(it.sales_price)}</div>
      <div className="im-num"><StockCell read={read} unitLabel={unitLabel} /></div>
      <div className="im-num"><ValueCell read={read} /></div>
      <div className="im-status-cell">
        <StatusPill lifecycle={it.lifecycle || "active"} />
      </div>
    </div>
  );
}

export default function ItemsPage() {
  const navigate = useNavigate();
  const { items } = useItems();
  const { read, online } = useInventorySubledger();
  const { inventoryCostingMethod } = useAccountingSettings();

  // The published sub-ledger read, once per item. Memoised on the costing method
  // too, since switching Average ⇄ Actual genuinely changes what stock is worth.
  const stock = useMemo(() => {
    const map = {};
    for (const it of items) map[it.id] = read(it, inventoryCostingMethod);
    return map;
  }, [items, read, inventoryCostingMethod]);

  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [sortChoice, setSortChoice] = useState(null);
  const emptyFilters = { categories: new Set(), types: new Set(), stock: new Set() };
  const [filterValues, setFilterValues] = useState(emptyFilters);
  const [sortPopOpen, setSortPopOpen] = useState(false);
  const [filterPopOpen, setFilterPopOpen] = useState(false);

  const effectiveSort = sortChoice || "updated-desc";

  // Three tabs, one axis. There is no Pending Review queue any more: nothing in
  // Item Master waits on a signature, so no item is ever in a state of waiting.
  const counts = useMemo(() => {
    const c = { active: 0, draft: 0, inactive: 0 };
    for (const it of items) {
      const s = it.lifecycle || "active";
      if (c[s] != null) c[s]++;
    }
    return c;
  }, [items]);

  const TAB_HINTS = {
    active: "Usable on new documents. Everything created here lands Active — no approval step.",
    draft: "Incomplete records from a migration or import batch, not yet finished off. The create form never produces one.",
    inactive: "Retired or replaced. Posted history stays drillable; not selectable on new documents.",
  };

  const tabs = ITEM_LIFECYCLE_ORDER.map((k) => ({
    k, lbl: ITEM_LIFECYCLE_META[k].label, count: counts[k],
  }));

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filterValues.categories.size > 0) n++;
    if (filterValues.types.size > 0) n++;
    if (filterValues.stock.size > 0) n++;
    return n;
  }, [filterValues]);

  const hasActiveFilters = activeFilterCount > 0 || sortChoice !== null || search.trim() !== "";

  const filtered = useMemo(() => {
    let list = items.filter((it) => (it.lifecycle || "active") === tab);

    if (filterValues.categories.size > 0) list = list.filter((it) => filterValues.categories.has(it.category));
    if (filterValues.types.size > 0) list = list.filter((it) => filterValues.types.has(it.item_type));
    if (filterValues.stock.size > 0) {
      list = list.filter((it) => {
        const st = stock[it.id];
        if (st.state === "not_applicable") return filterValues.stock.has("nonstock");
        // Unknown is neither In nor Out — we do not know, and guessing here
        // would quietly drop rows a reader is looking for.
        if (st.state !== "known") return false;
        const isOut = st.on_hand_qty <= 0;
        return (filterValues.stock.has("out") && isOut) || (filterValues.stock.has("in") && !isOut);
      });
    }
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      it.sku.toLowerCase().includes(q) ||
      (it.description || "").toLowerCase().includes(q) ||
      (ITEM_CAT_LABELS[it.category] || "").toLowerCase().includes(q) ||
      (ITEM_TYPES[it.item_type]?.label || "").toLowerCase().includes(q),
    );
    return list;
  }, [items, tab, filterValues, search, stock]);

  const rows = useMemo(() => {
    const arr = [...filtered];
    const num = (it, key) => stock[it.id]?.[key] ?? 0;
    switch (effectiveSort) {
      case "updated-desc": arr.sort((a, b) => (b.updated || "").localeCompare(a.updated || "")); break;
      case "name-asc":   arr.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc":  arr.sort((a, b) => b.name.localeCompare(a.name)); break;
      case "sku-asc":    arr.sort((a, b) => a.sku.localeCompare(b.sku)); break;
      case "price-desc": arr.sort((a, b) => (b.sales_price ?? -1) - (a.sales_price ?? -1)); break;
      case "price-asc":  arr.sort((a, b) => (a.sales_price ?? Infinity) - (b.sales_price ?? Infinity)); break;
      // Stock sorts read the published figures, so they order what is on screen.
      case "qty-desc":   arr.sort((a, b) => num(b, "on_hand_qty") - num(a, "on_hand_qty")); break;
      case "qty-asc":    arr.sort((a, b) => num(a, "on_hand_qty") - num(b, "on_hand_qty")); break;
      case "value-desc": arr.sort((a, b) => num(b, "stock_value") - num(a, "stock_value")); break;
      case "value-asc":  arr.sort((a, b) => num(a, "stock_value") - num(b, "stock_value")); break;
      default: break;
    }
    return arr;
  }, [filtered, effectiveSort, stock]);

  // The total sums only figures the sub-ledger actually reported. If any row on
  // screen is Unavailable the total is incomplete, and it says so instead of
  // quietly under-reporting — a total that silently drops rows is worse than no
  // total, because it looks complete.
  const { totalValue, incomplete, anyKnown } = useMemo(() => {
    let total = 0;
    let missing = 0;
    let known = 0;
    for (const r of rows) {
      const st = stock[r.id];
      if (st?.state === "known") { total += st.stock_value || 0; known++; }
      else if (st?.state === "unavailable") missing++;
    }
    return { totalValue: total, incomplete: missing, anyKnown: known > 0 };
  }, [rows, stock]);

  // The as-of stamped on the column group: the newest one any row reported.
  const asOf = useMemo(() => {
    let latest = null;
    for (const r of rows) {
      const d = stock[r.id]?.state === "known" ? stock[r.id].as_of : null;
      if (d && (!latest || d > latest)) latest = d;
    }
    return latest;
  }, [rows, stock]);

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
              <h1 className="lg-title">Item Master</h1>
              <p className="im-lede">
                The catalogue — one row for every distinct thing the business buys, sells, makes or
                provides. What each thing <em>is</em>. How many you hold and what they are worth comes
                from the Inventory Sub-Ledger, read-only.
              </p>
            </div>
            <div className="lg-head-actions">
              <button className="lg-btn-brand" onClick={() => navigate("/items/new")}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add New Item
              </button>
            </div>
          </div>
        </div>

        {/* ── Sub-ledger outage ─────────────────────────────────────── */}
        {/* Named once, at the top, with what it disables spelled out — rather
            than leaving a reader to work it out from a column of warnings. */}
        {!online && (
          <div className="lg-table-wrap">
            <div className="im-outage">
              <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
              <div>
                <strong>Inventory Sub-Ledger unreachable.</strong> On-hand and stock value read
                “Unavailable” — never Rp 0, which would look like a figure someone checked. The
                catalogue itself works normally, but unit changes, deactivation and category changes
                are blocked until it answers, because we can’t confirm an item holds no stock.
              </div>
            </div>
          </div>
        )}

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card">
            <div className="bp-tabs-row">
              {tabs.map((t) => (
                <button key={t.k} className={`bp-tab${tab === t.k ? " active" : ""}`} onClick={() => setTab(t.k)} title={TAB_HINTS[t.k]}>
                  {t.lbl}
                  <span className="bp-tab-count">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input placeholder="Search item name, Item ID, description, category, or type…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta">
                {/* No total is printed when nothing was reported. A figure that
                    silently omits every unavailable row looks complete, which is
                    the same failure as printing Rp 0 for an unknown. */}
                <div className="lg-meta-static">
                  {rows.length} {rows.length === 1 ? "item" : "items"}
                  {anyKnown && <> · <span style={{ fontFamily: "var(--font-mono)" }}>{formatRupiah(totalValue)}</span></>}
                  {incomplete > 0 && (
                    <span className="im-unavail" style={{ marginLeft: 8 }}>
                      {anyKnown ? `partial — ${incomplete} unavailable` : `stock value unavailable`}
                    </span>
                  )}
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

            <div className="im-scroll">
              <div className="im-inner">
                {/* The two borrowed columns, named. */}
                <div className="im-group-header">
                  <div className="im-group-span">
                    <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                    From Inventory Sub-Ledger
                  </div>
                  <div className="im-group-asof">
                    {online ? (asOf ? `as of ${asOf}` : "no movements recorded") : "unreachable"}
                  </div>
                </div>

                <div className="im-col-header">
                  <div>Item ID</div>
                  <div>Item Name</div>
                  <div>Category</div>
                  <div>Item Type</div>
                  <div>Primary Unit</div>
                  <div className="im-num">Sales Price</div>
                  <div className="im-num">On-hand</div>
                  <div className="im-num">Stock Value</div>
                  <div>Status</div>
                </div>

                {rows.length === 0 && <div className="lg-empty">No items match your search</div>}
                {rows.map((it) => (
                  <ItemRow key={it.id} it={it} read={stock[it.id]} onOpen={() => navigate(`/items/${it.id}`)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
