import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAssets } from "../state/AssetsContext";
import { TYPE_LABELS, METHOD_LABELS, STATUS_META, STATUS_ORDER, categoryLabel } from "../lib/fixedAssets";
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

const TABS = [
  { key: "all", label: "All" },
  ...STATUS_ORDER.map((key) => ({ key, label: STATUS_META[key].label })),
];

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.running;
  return <span className={`vd-status ${meta.tone}`}>{meta.label}</span>;
}

function BookValueCell({ read }) {
  if (!read || read.book_value == null) return <span className="fa-none">Not computable</span>;
  return <span className="fa-value">{formatRupiahExact(read.book_value)}</span>;
}

function AssetRow({ asset, read, onOpen }) {
  return (
    <div className="fa-row" onClick={onOpen}>
      <div className="fa-tag">{asset.asset_tag}</div>
      <div className="fa-name">{asset.name}</div>
      <div className="fa-class">{TYPE_LABELS[asset.type] || asset.type}</div>
      <div className="fa-class">{categoryLabel(asset.category)}</div>
      <div className="fa-class">{asset.acquisition_date ? formatDateEn(asset.acquisition_date) : "—"}</div>
      <div className="fa-num">{formatRupiahExact(asset.first_value)}</div>
      <div className="fa-class">{METHOD_LABELS[asset.method] || asset.method}</div>
      <div className="fa-num"><BookValueCell read={read} /></div>
      <div><StatusPill status={asset.status} /></div>
    </div>
  );
}

export default function AssetsPage() {
  const navigate = useNavigate();
  const { assets, read } = useAssets();
  const [tab, setTab] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const reads = useMemo(() => {
    const map = {};
    for (const a of assets) map[a.id] = read(a);
    return map;
  }, [assets, read]);

  const counts = useMemo(() => {
    const c = { all: assets.length };
    for (const t of STATUS_ORDER) c[t] = 0;
    for (const a of assets) if (c[a.status] != null) c[a.status]++;
    return c;
  }, [assets]);

  const q = search.toLowerCase().trim();
  const matches = (a) =>
    (!q || a.name.toLowerCase().includes(q) || a.asset_tag.toLowerCase().includes(q)) &&
    (typeFilter === "all" || a.type === typeFilter);

  const rows = useMemo(
    () => assets.filter((a) => (tab === "all" || a.status === tab) && matches(a)).sort((a, b) => a.asset_tag.localeCompare(b.asset_tag)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, tab, q, typeFilter],
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
                released over a term. Book value is derived from each asset's own schedule.
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
              <select className="fa-type-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">All types</option>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <div className="lg-filter-meta">
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
                  <div>Acquisition Date</div>
                  <div className="fa-num">Original Value</div>
                  <div>Method</div>
                  <div className="fa-num">Book Value</div>
                  <div>Status</div>
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
