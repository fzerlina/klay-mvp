import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useInventory } from "../state/InventoryContext";
import {
  INV_CAT_LABELS, INV_UOM_LABELS, INV_UOM_SECONDARY,
} from "../data/seed/inventory";
import { productAccounts } from "../lib/productDetail";
import { formatRupiah } from "../lib/format";
import "./invoice-create.css";
import "./inventory.css";

// ── Add New Product ──────────────────────────────────────────────────────────
// Master-data create form built on the shared create-page shell (addpage / ap-*
// / form-sec). Mirrors the Product Detail model: Information, Stock & Location,
// Cost, and a read-only Accounts preview (the GL mapping comes from the chosen
// category). Writes through InventoryContext so the new product shows up on the
// list and its detail page immediately.
//
// Services are non-stock: choosing the Service category hides the Stock &
// Location block and the costing method, matching how Detail renders them.

const CATEGORY_OPTIONS = Object.entries(INV_CAT_LABELS).map(([v, label]) => ({ v, label }));
// Only primary (stocking) units are pickable; secondary units derive from these.
const PRIMARY_UOM_OPTIONS = Object.keys(INV_UOM_LABELS).filter((u) => !["sheet", "g", "ml"].includes(u));

const SKU_PREFIX = { raw_material: "RAW", finished_goods: "FIN", supplies: "SUP", packaging: "PKG", service: "SVC" };

export default function InventoryCreatePage() {
  const navigate = useNavigate();
  const { addItem } = useInventory();

  // Information
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("active");
  const [sku, setSku] = useState("");

  // Stock & Location
  const [uom, setUom] = useState("pcs");
  const [unitCost, setUnitCost] = useState("");
  const [locations, setLocations] = useState([{ loc: "", qty: "" }]);

  // Cost
  const [salesPrice, setSalesPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }

  const isService = category === "service";
  const sec = INV_UOM_SECONDARY[uom];
  const primaryLabel = INV_UOM_LABELS[uom] || uom;

  const totalQty = useMemo(
    () => locations.reduce((s, l) => s + (Number(l.qty) || 0), 0),
    [locations],
  );
  const previewValue = useMemo(
    () => (isService ? 0 : totalQty * (Number(unitCost) || 0)),
    [isService, totalQty, unitCost],
  );

  // SKU preview — next code for the chosen category (illustrative).
  const skuPreview = useMemo(() => {
    if (sku.trim()) return sku.trim();
    if (!category) return "Auto";
    return `${SKU_PREFIX[category]}-####`;
  }, [sku, category]);

  // Read-only account mapping preview for the chosen category.
  const accountPreview = useMemo(
    () => (category ? productAccounts({ category }) : []),
    [category],
  );

  const canSubmit = name.trim() && category && (isService || uom);

  function setLoc(i, key, val) {
    setLocations((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  }
  function addLoc() { setLocations((prev) => [...prev, { loc: "", qty: "" }]); }
  function removeLoc(i) { setLocations((prev) => prev.filter((_, idx) => idx !== i)); }

  function onSave() {
    if (!name.trim()) { showToast("Product name is required"); return; }
    if (!category) { showToast("Pick a category"); return; }
    const item = addItem({
      sku: sku.trim(),
      name: name.trim(),
      category,
      status,
      uom: isService ? null : uom,
      unit_cost: Number(unitCost) || 0,
      locations: isService ? [] : locations,
      cost_price: costPrice !== "" ? costPrice : undefined,
      purchase_price: purchasePrice !== "" ? purchasePrice : undefined,
      sales_price: salesPrice !== "" ? salesPrice : undefined,
    });
    showToast(`${item.name} added ✓`);
    setTimeout(() => navigate(`/inventory/${item.id}`), 700);
  }

  return (
    <div className="addpage">
      {/* Header */}
      <div className="ap-head">
        <button className="ap-close" onClick={() => navigate("/inventory")} aria-label="Close">
          <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <div className="ap-title">Add New Product</div>
        <div className="ap-hint" style={{ flex: 1, marginLeft: 8 }}>
          Fields marked <span style={{ color: "var(--color-danger-text)" }}>*</span> are required
        </div>
      </div>

      {/* Body */}
      <div className="ap-s1" style={{ alignItems: "stretch", padding: "28px 24px 96px" }}>
        <div style={{ width: "100%", maxWidth: 680, margin: "0 auto" }}>

          {/* 1 — Information */}
          <div className="form-sec card">
            <div className="form-sec-title">Information</div>
            <div className="form-fld">
              <label>Product Name <span className="vc-req">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Steel Sheet 1.2mm" />
            </div>
            <div className="fg2">
              <div className="form-fld">
                <label>Category <span className="vc-req">*</span></label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Pick a category…</option>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
              <div className="form-fld">
                <label>Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <label>Product ID (SKU)</label>
              <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={skuPreview} style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }} />
              <span className="vc-hint">Leave blank to auto-generate from the category ({skuPreview})</span>
            </div>
          </div>

          {/* 2 — Stock & Location (not for services) */}
          {!isService && (
            <div className="form-sec card">
              <div className="form-sec-title">Stock &amp; Location</div>

              <div className="fg3">
                <div className="form-fld">
                  <label>Primary Unit <span className="vc-req">*</span></label>
                  <select value={uom} onChange={(e) => setUom(e.target.value)}>
                    {PRIMARY_UOM_OPTIONS.map((u) => <option key={u} value={u}>{INV_UOM_LABELS[u]}</option>)}
                  </select>
                </div>
                <div className="form-fld">
                  <label>Secondary Unit</label>
                  <input type="text" value={sec ? INV_UOM_LABELS[sec.unit] : "—"} readOnly tabIndex={-1} className="ivc-ro" />
                </div>
                <div className="form-fld">
                  <label>Conversion Ratio</label>
                  <input type="text" value={sec ? `1 ${primaryLabel} = ${sec.ratio} ${INV_UOM_LABELS[sec.unit]}` : "—"} readOnly tabIndex={-1} className="ivc-ro" />
                </div>
              </div>

              {/* Per-location opening stock */}
              <label className="ivc-sub">Opening stock by location</label>
              {locations.map((l, i) => (
                <div className="ivc-locrow" key={i}>
                  <input type="text" value={l.loc} onChange={(e) => setLoc(i, "loc", e.target.value)} placeholder="Warehouse (e.g. Jakarta Warehouse)" />
                  <input type="number" min="0" value={l.qty} onChange={(e) => setLoc(i, "qty", e.target.value)} placeholder="0" style={{ fontFamily: "var(--font-mono)" }} />
                  <button type="button" className="ivc-locdel" onClick={() => removeLoc(i)} disabled={locations.length === 1} aria-label="Remove location">
                    <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                </div>
              ))}
              <button type="button" className="ivc-addloc" onClick={addLoc}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add location
              </button>

              <div className="fg3" style={{ marginTop: 16, marginBottom: 0 }}>
                <div className="form-fld">
                  <label>Cost / Unit (Rp)</label>
                  <input type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
                <div className="form-fld">
                  <label>Total Stock Count</label>
                  <input type="text" value={`${totalQty.toLocaleString("id-ID")} ${primaryLabel}`} readOnly tabIndex={-1} className="ivc-ro" />
                </div>
                <div className="form-fld">
                  <label>Stock Value</label>
                  <input type="text" value={formatRupiah(previewValue)} readOnly tabIndex={-1} className="ivc-ro" style={{ fontWeight: 600 }} />
                </div>
              </div>
            </div>
          )}

          {/* 3 — Cost */}
          <div className="form-sec card">
            <div className="form-sec-title">Cost</div>
            {isService ? (
              <div className="fg3">
                <div className="form-fld">
                  <label>Cost / Unit (Rp)</label>
                  <input type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
                <div className="form-fld">
                  <label>Sales Price (Rp)</label>
                  <input type="number" min="0" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} placeholder="Auto from cost" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
                <div className="form-fld">
                  <label>Purchase Price (Rp)</label>
                  <input type="number" min="0" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="Auto from cost" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
              </div>
            ) : (
              <div className="fg3" style={{ marginBottom: 0 }}>
                <div className="form-fld">
                  <label>Sales Price (Rp)</label>
                  <input type="number" min="0" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} placeholder="Auto from cost" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
                <div className="form-fld">
                  <label>Cost Price (Rp)</label>
                  <input type="number" min="0" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="Defaults to Cost / Unit" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
                <div className="form-fld">
                  <label>Purchase Price (Rp)</label>
                  <input type="number" min="0" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="Auto from cost" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
              </div>
            )}
            <span className="vc-hint" style={{ marginTop: 10, display: "block" }}>Costing method is set company-wide in Accounting Settings. Prices left blank are estimated from the cost when the product is created.</span>
          </div>

          {/* 4 — Accounts (read-only preview) */}
          <div className="form-sec card">
            <div className="form-sec-title">Accounts <span className="ivc-rotag">Read-only</span></div>
            {!category ? (
              <div className="ivc-acct-empty">Pick a category to see its GL account mapping.</div>
            ) : (
              <div className="ivc-acct-list">
                {accountPreview.map((a) => (
                  <div className="ivc-acct-row" key={a.key}>
                    <span className="ivc-acct-lbl">{a.label}</span>
                    <span className="ivc-acct-val">
                      {a.name ? <>{a.name} <span className="ivc-acct-code">{a.code}</span></> : <span className="ivc-acct-na">Not applicable</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <span className="vc-hint" style={{ marginTop: 10, display: "block" }}>Account mapping is set per category in Product Category Settings.</span>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div className="ap-foot">
        <span className="ap-hint">New products appear on the Inventory list immediately.</span>
        <button className="ap-btn" onClick={() => navigate("/inventory")}>Cancel</button>
        <button className="ap-btn-send" onClick={onSave} disabled={!canSubmit}>
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
          Add Product
        </button>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
