import { useParams, useNavigate } from "react-router-dom";
import { useInventory } from "../state/InventoryContext";
import { INV_CAT_LABELS, INV_UOM_LABELS } from "../data/seed/inventory";
import { DEFTAX_LABELS } from "../data/labels";
import { formatRupiah, formatNumber, formatDate } from "../lib/format";
import "./vendor-detail.css";

// ── Inventory Detail ─────────────────────────────────────────────────────────
// Full page at /inventory/:id, built on the shared vd-* detail layout. Read-only
// master-data view for a single stock item: identity, stock level, and valuation.
// Stock state (out of stock / in stock) drives the header chip and an alert.

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

  const out = item.qty <= 0;
  const catLabel = INV_CAT_LABELS[item.category] || item.category;
  const uomLabel = INV_UOM_LABELS[item.uom] || item.uom;
  const taxLabel = DEFTAX_LABELS[item.tax_code] || "Not set";

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
            {/* Item */}
            <div className="vd-card">
              <div className="vd-card-title">Item</div>
              <Row l="Item name" v={item.name} />
              <Row l="SKU" v={item.sku} mono />
              <Row l="Category" v={catLabel} />
              <Row l="Unit of measure" v={uomLabel} />
            </div>

            {/* Stock & Valuation */}
            <div className="vd-card">
              <div className="vd-card-title">Stock &amp; Valuation</div>
              <Row l="Quantity on hand" v={`${formatNumber(item.qty)} ${uomLabel}`} />
              <Row l="Unit cost" v={formatRupiah(item.unit_cost)} mono />
              <Row l="Stock value" v={formatRupiah(item.value)} mono />
              <Row l="Last updated" v={item.updated ? formatDate(item.updated) : "—"} />
            </div>

            {/* Tax mapping — read-only; editing the map happens elsewhere */}
            <div className="vd-card">
              <div className="vd-card-title">Tax Mapping</div>
              <Row l="Default tax treatment" v={taxLabel} />
              <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6, marginTop: 8 }}>
                Pre-fills the tax on <strong>Create New Bill</strong> lines for this item (final PPN still depends on the vendor's PKP status). Read-only here — the mapping is edited in item tax settings.
              </div>
            </div>

            {/* Notes */}
            <div className="vd-card span2">
              <div className="vd-card-title">Notes</div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                {item.notes || <span className="vd-row-val dim">No notes.</span>}
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
