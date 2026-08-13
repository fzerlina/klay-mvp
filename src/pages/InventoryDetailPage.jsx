import { useParams, useNavigate, Link } from "react-router-dom";
import { useInventory } from "../state/InventoryContext";
import { INV_CAT_LABELS, INV_UOM_LABELS } from "../data/seed/inventory";
import {
  productUom, productCost, productAccounts, productHistory,
  isServiceItem, ACTION_LABELS,
} from "../lib/productDetail";
import { formatRupiah, formatNumber, formatDate } from "../lib/format";
import "./vendor-detail.css";
import "./inventory.css";
import "./product-detail.css";

// ── Inventory / Product Detail ───────────────────────────────────────────────
// Full page at /inventory/:id, built on the shared vd-* detail layout. Read-only
// master-data view for a single product across four sections:
//   1. Information  — identity, location, stock, unit of measure, valuation
//   2. Cost         — costing method + sales / cost / purchase pricing
//   3. Accounts     — GL account mapping (read-only; set in Category Settings)
//   4. History      — the item's stock-movement ledger with journal links

export default function InventoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { itemById } = useInventory();
  const item = itemById(id);

  if (!item) {
    return (
      <div className="vd-page">
        <div className="vd-empty" style={{ marginTop: 80 }}>
          Item not found.{" "}
          <button className="vd-btn" style={{ marginTop: 14 }} onClick={() => navigate("/inventory")}>Back to Inventory</button>
        </div>
      </div>
    );
  }

  const service = isServiceItem(item);
  const out = !service && (item.qty || 0) <= 0;
  const inactive = (item.status || "active") === "inactive";
  const catLabel = INV_CAT_LABELS[item.category] || item.category;

  const uom = productUom(item);
  const cost = productCost(item);
  const accounts = productAccounts(item);
  const history = productHistory(item);

  const primaryLabel = uom.primary ? (INV_UOM_LABELS[uom.primary] || uom.primary) : "—";
  const secondaryLabel = uom.secondary ? (INV_UOM_LABELS[uom.secondary] || uom.secondary) : "—";

  const locs = service
    ? []
    : (Array.isArray(item.locations) && item.locations.length ? item.locations : [{ loc: "Main Warehouse", qty: item.qty || 0 }]);

  return (
    <div className="vd-page">
      <div className="vd-scroll">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <div className="vd-top">
          <button className="vd-back" onClick={() => navigate("/inventory")} aria-label="Back to Inventory">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div className="vd-headinfo">
            <div className="vd-title-row">
              <span className="vd-title">{item.name}</span>
              <span className={`iv-status iv-status-${inactive ? "inactive" : "active"}`}>{inactive ? "Inactive" : "Active"}</span>
              {out && <span className="vd-status blocked">Out of stock</span>}
            </div>
            <div className="vd-sub">
              <span style={{ fontFamily: "var(--font-mono)" }}>{item.sku}</span>
              <span>·</span>
              <span>{catLabel}</span>
            </div>
          </div>
          <div className="vd-actions">
            <button className="vd-btn" onClick={() => navigate("/inventory")}>Back to list</button>
          </div>
        </div>

        {/* ── Out-of-stock alert ──────────────────────────────────── */}
        {out && (
          <div className="vd-alert flagged">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div><strong>Out of stock.</strong> This item has zero quantity on hand. Restock before committing it to new orders.</div>
          </div>
        )}

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="vd-body">
          <div className="vd-grid">

            {/* ── Section 1: Information ─────────────────────────── */}
            <div className="vd-card span2">
              <div className="vd-card-title">Information</div>
              <div className="pd-fields2">
                <Row l="Product ID" v={item.sku} mono />
                <Row l="Product Name" v={item.name} />
                <Row l="Category" v={<span className={`cat-badge inv-${item.category}`}>{catLabel}</span>} />
                <LocationRow service={service} locs={locs} uomLabel={primaryLabel} />
                <Row l="Stock Count" v={service ? "—" : `${(item.qty || 0).toLocaleString("id-ID")} ${primaryLabel}`} />
                <Row l="Unit of Measurement — Primary" v={primaryLabel} />
                <Row l="Secondary Unit" v={secondaryLabel} />
                <Row l="Conversion Ratio" v={uom.ratio ? `1 ${primaryLabel} = ${uom.ratio} ${secondaryLabel}` : "—"} />
                <Row l="Cost / Unit" v={formatRupiah(item.unit_cost)} mono />
                <Row l="Stock Value" v={service ? "—" : formatRupiah(item.value)} mono />
                <Row l="Status" v={inactive ? "Inactive" : "Active"} />
              </div>
            </div>

            {/* ── Section 2: Cost ───────────────────────────────── */}
            <div className="vd-card">
              <div className="vd-card-title">Cost</div>
              <Row l="Costing Method" v={service ? "—" : cost.costing_label} />
              <Row l="Sales Price" v={formatRupiah(cost.sales_price)} mono />
              <Row l="Cost Price" v={formatRupiah(cost.cost_price)} mono />
              <Row l="Purchase Price" v={formatRupiah(cost.purchase_price)} mono />
            </div>

            {/* ── Section 3: Accounts ───────────────────────────── */}
            <div className="vd-card">
              <div className="vd-card-title">
                Accounts
                <span className="pd-ro-tag">Read-only</span>
              </div>
              {accounts.map((a) => (
                <div className="vd-row" key={a.key}>
                  <span className="vd-row-lbl">{a.label}</span>
                  <span className="vd-row-val pd-acct">
                    {a.name
                      ? <>{a.name} <span className="pd-acct-code">{a.code}</span></>
                      : <span className="dim">Not applicable</span>}
                  </span>
                </div>
              ))}
              <div className="pd-ro-note">Editable in Product Category Settings.</div>
            </div>

            {/* ── Section 4: History ────────────────────────────── */}
            <div className="vd-card span2">
              <div className="vd-tx-head">
                <div className="vd-card-title" style={{ marginBottom: 0 }}>History</div>
                <div className="pd-hist-sub">Stock movements for this item</div>
              </div>
              <div className="vd-tx-tablewrap">
                <table className="vd-tx-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th className="num">Unit</th>
                      <th className="num">Cost / Unit</th>
                      <th className="num">Adjusted Value</th>
                      <th>Journal Entry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.length === 0 && (
                      <tr><td colSpan={6} className="dim" style={{ textAlign: "center", padding: 20 }}>No movements recorded.</td></tr>
                    )}
                    {history.map((h, i) => (
                      <tr className="vd-tx-row" key={i}>
                        <td>{formatDate(h.date)}</td>
                        <td><span className={`pd-act pd-act-${h.action}`}>{ACTION_LABELS[h.action] || h.action}</span></td>
                        <td className="num">{h.unit > 0 ? "+" : ""}{h.unit.toLocaleString("id-ID")}</td>
                        <td className="num">{formatRupiah(h.unit_cost)}</td>
                        <td className="num">{h.value < 0 ? "−" : ""}{formatRupiah(Math.abs(h.value))}</td>
                        <td><Link className="pd-je" to="/journal-entry">{h.je}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ l, v, mono }) {
  return (
    <div className="vd-row">
      <span className="vd-row-lbl">{l}</span>
      <span className={`vd-row-val${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}

// Location row — a single warehouse names it; multiple warehouses stack with
// their per-location quantity.
function LocationRow({ service, locs, uomLabel }) {
  let value;
  if (service) value = <span className="dim">—</span>;
  else if (locs.length === 1) value = locs[0].loc;
  else value = (
    <div className="pd-loclist">
      {locs.map((l, i) => (
        <div className="pd-loc" key={i}>
          <span>{l.loc}</span>
          <span className="pd-loc-qty">{formatNumber(l.qty)} {uomLabel}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="vd-row">
      <span className="vd-row-lbl">Location</span>
      <span className="vd-row-val">{value}</span>
    </div>
  );
}
