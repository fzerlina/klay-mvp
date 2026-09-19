import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAssets } from "../state/AssetsContext";
import {
  TYPE_LABELS, TYPE_ORDER, BOOK_STATUS_ORDER, BOOK_STATUS_SHORT, BOOK_STATUS_TONE,
  bookStatusLabel, bookStatusShort,
  LIFECYCLE_META, LIFECYCLE_ORDER, OPERATIONAL_ORDER, OPERATIONAL_META, OPERATIONAL_TONE,
  operationalLabel, statusConflicts, categoryLabel,
} from "../lib/fixedAssets";
import { ASSET_CATEGORIES } from "../data/seed/fixedAssets";
import { formatRupiahExact, formatDateEn } from "../lib/format";
import "./modules.css";
import "./invoices-ledger.css";
import "./vendor-detail.css";
import "./assets.css";

// ── Fixed Assets — the register ─────────────────────────────────────────────
// One row per fixed asset, prepaid or intangible — one register, one schedule
// engine (lib/fixedAssets.js) behind all three. Book value is the only figure
// this screen computes; it comes straight from the schedule, never from a
// formula over the row.
//
// THREE STATUS AXES, ONE SCREEN. Three status columns would be unreadable, so
// they are laid out by what each one is for:
// ONE entry point for filtering — a Filter button opening a popover, the same
// control Bills and Invoices use, rather than a row of loose selects. The four
// axes worth filtering on live inside it: Type, Category, Operational status,
// Book status.
//
//   lifecycle     → the tabs. It is the coarsest cut and the one that decides
//                   whether a row is a real record at all — a Void duplicate
//                   and a live asset should not sit in the same list by
//                   default, and a tab makes that separation visible rather
//                   than leaving it to a filter nobody set.
//   book status   → the pill on each row. It is the axis with money attached,
//                   so it stays legible per-row rather than being hidden
//                   behind a control.
//   operational   → its own column, muted. Never a tab: filtering the register
//                   by "under repair" is a maintenance question, not a
//                   financial one.
//
// Contradictions between the axes (§7.5) are marked on the row they belong to
// and stated in full on the asset. There is no summary band above the table:
// this register blocks no close, so a count at the top would be reading as a
// queue something that is only ever advisory.
// Same shape as the two-axis treatment on Bills (payment vs request status).

const TABS = [
  { key: "all", label: "All" },
  ...LIFECYCLE_ORDER.map((key) => ({ key, label: LIFECYCLE_META[key].label })),
];

const EMPTY_FILTERS = { type: "all", category: "all", operational: "all", book: "all" };

function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

// Draft-then-apply, like the Invoices popover: changing four things one at a
// time should not re-filter the table four times under the reader.
function FilterPopover({ values, onChange, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [draft, setDraft] = useState(values);
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const Toggles = ({ label, field, options }) => (
    <div className="lg-filter-fld">
      <div className="lg-filter-fld-lbl">{label}</div>
      <div className="lg-toggle-row">
        {options.map(([k, lbl]) => (
          <button
            key={k}
            className={`lg-toggle${draft[field] === k ? " on" : ""}`}
            onClick={() => update({ [field]: k })}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="lg-popover lg-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <Toggles
          label="Type"
          field="type"
          options={[["all", "All"], ...TYPE_ORDER.map((t) => [t, TYPE_LABELS[t]])]}
        />

        {/* Eleven categories is too many for pills, and the list is scoped by
            type the moment a type is chosen — the same scoping the create form
            and the edit dialog use. */}
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Category</div>
          <select
            className="lg-filter-input"
            value={draft.category}
            onChange={(e) => update({ category: e.target.value })}
          >
            <option value="all">All categories</option>
            {Object.entries(ASSET_CATEGORIES)
              .filter(([, c]) => draft.type === "all" || c.type === draft.type)
              .map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </div>

        <Toggles
          label="Operational status"
          field="operational"
          options={[["all", "All"], ...OPERATIONAL_ORDER.map((k) => [k, OPERATIONAL_META[k].label]), ["none", "Not set"]]}
        />

        <Toggles
          label="Book status"
          field="book"
          options={[["all", "All"], ...BOOK_STATUS_ORDER.map((k) => [k, BOOK_STATUS_SHORT[k]])]}
        />
      </div>

      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={() => setDraft(EMPTY_FILTERS)}>Reset</button>
        <button className="lg-filter-apply" onClick={() => { onChange(draft); onClose(); }}>Apply filter</button>
      </div>
    </div>
  );
}

function BookStatusPill({ asset }) {
  const tone = BOOK_STATUS_TONE[asset.book_status] || "active";
  return <span className={`vd-status ${tone}`} title={bookStatusLabel(asset)}>{bookStatusShort(asset)}</span>;
}

function OperationalPill({ asset }) {
  const label = operationalLabel(asset.operational_status);
  if (!label) return <span className="fa-dash">—</span>;
  return <span className={`vd-status ${OPERATIONAL_TONE[asset.operational_status] || "inactive"}`}>{label}</span>;
}

function BookValueCell({ read }) {
  if (read?.never_ran) return <span className="fa-dash">—</span>;
  if (!read || read.book_value == null) return <span className="fa-none">Not computable</span>;
  return <span className="fa-value">{formatRupiahExact(read.book_value)}</span>;
}

function AssetRow({ asset, read, onOpen }) {
  const life = LIFECYCLE_META[asset.lifecycle] || LIFECYCLE_META.active;
  const conflicts = statusConflicts(asset);
  return (
    <div className="fa-row" onClick={onOpen}>
      <div className="fa-tag">{asset.asset_tag}</div>
      <div className="fa-name">
        {asset.name}
        {asset.lifecycle !== "active" && <span className={`fa-life ${life.tone}`}>{life.label}</span>}
        {conflicts.length > 0 && (
          <span className="fa-conflict" title={conflicts[0].title + " — " + conflicts[0].detail}>
            <svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z" /><line x1="12" y1="9" x2="12" y2="13" /><circle cx="12" cy="16" r=".6" /></svg>
          </span>
        )}
      </div>
      <div className="fa-class">{TYPE_LABELS[asset.type] || asset.type}</div>
      <div className="fa-class">{categoryLabel(asset.category)}</div>
      <div className="fa-class">
        {asset.service_date ? formatDateEn(asset.service_date) : <span className="fa-none">Not in service</span>}
      </div>
      <div className="fa-num">{formatRupiahExact(asset.first_value)}</div>
      <div className="fa-num"><BookValueCell read={read} /></div>
      <div><OperationalPill asset={asset} /></div>
      <div><BookStatusPill asset={asset} /></div>
    </div>
  );
}

export default function AssetsPage() {
  const navigate = useNavigate();
  const { assets, read } = useAssets();
  const [tab, setTab] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");

  const reads = useMemo(() => {
    const map = {};
    for (const a of assets) map[a.id] = read(a);
    return map;
  }, [assets, read]);

  const counts = useMemo(() => {
    const c = { all: assets.length };
    for (const t of LIFECYCLE_ORDER) c[t] = 0;
    for (const a of assets) if (c[a.lifecycle] != null) c[a.lifecycle]++;
    return c;
  }, [assets]);

  const activeFilterCount = Object.entries(filters).filter(([, v]) => v !== "all").length;

  const q = search.toLowerCase().trim();
  const matches = (a) =>
    (!q || a.name.toLowerCase().includes(q) || a.asset_tag.toLowerCase().includes(q)) &&
    (filters.type === "all" || a.type === filters.type) &&
    (filters.category === "all" || a.category === filters.category) &&
    (filters.book === "all" || a.book_status === filters.book) &&
    (filters.operational === "all"
      || (filters.operational === "none" ? !a.operational_status : a.operational_status === filters.operational));

  const rows = useMemo(
    () => assets.filter((a) => (tab === "all" || a.lifecycle === tab) && matches(a)).sort((a, b) => a.asset_tag.localeCompare(b.asset_tag)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, tab, q, filters],
  );

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Fixed Assets</h1>
              <p className="fa-lede">
                One register for fixed assets, prepaids and intangibles — a cost recognised at once,
                released over a term. The status pill is the <strong>book</strong> status: what the ledger
                is doing. Only <em>In service</em> posts a charge.
              </p>
            </div>
            <div className="lg-head-actions">
              <button className="lg-btn-brand" onClick={() => navigate("/assets/new")}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add New Asset
              </button>
            </div>
          </div>
        </div>

        <div className="lg-table-wrap">
          <div className="lg-card">
            <div className="bp-tabs-row">
              {TABS.map((t) => (
                <button key={t.key} className={`bp-tab${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
                  {t.label}
                  <span className="bp-tab-count">{counts[t.key]}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5" /><path d="M9 9l3 3" strokeLinecap="round" /></svg>
                <input placeholder="Search asset name or tag…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta">
                <div className="lg-meta-btn-wrap">
                  <button
                    className={`lg-meta-btn${activeFilterCount > 0 ? " active" : ""}`}
                    onClick={() => setFilterOpen(!filterOpen)}
                  >
                    <svg viewBox="0 0 12 12"><path d="M2 3h8M3 6h6M4 9h4" strokeLinecap="round" /></svg>
                    Filter
                    {activeFilterCount > 0 && <span className="lg-filter-badge">{activeFilterCount}</span>}
                  </button>
                  {filterOpen && (
                    <FilterPopover
                      values={filters}
                      onChange={setFilters}
                      onClose={() => setFilterOpen(false)}
                    />
                  )}
                </div>
                <div className="lg-meta-static">{rows.length} {rows.length === 1 ? "asset" : "assets"}</div>
              </div>
            </div>

            <div className="fa-scroll">
              <div className="fa-inner">
                <div className="fa-col-header">
                  <div>Asset ID</div>
                  <div>Asset Name</div>
                  <div>Type</div>
                  <div>Category</div>
                  <div>In Service</div>
                  <div className="fa-num">Original Value</div>
                  <div className="fa-num">Book Value</div>
                  <div>Operational</div>
                  <div>Book Status</div>
                </div>
                {rows.length === 0 && <div className="lg-empty">No assets match this tab</div>}
                {rows.map((asset) => (
                  <AssetRow key={asset.id} asset={asset} read={reads[asset.id]} onOpen={() => navigate(`/assets/${asset.id}`)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
