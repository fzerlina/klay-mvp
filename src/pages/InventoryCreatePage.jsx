import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useInventory } from "../state/InventoryContext";
import { INV_CAT_LABELS, INV_UOM_LABELS } from "../data/seed/inventory";
import { formatRupiah } from "../lib/format";
import "./invoice-create.css";

// ── Add New Inventory ────────────────────────────────────────────────────────
// Simple master-data create form, built on the shared create-page shell
// (addpage / ap-* / form-sec). Reads/writes through InventoryContext so the new
// item shows up immediately on the list. Stock Value is derived (qty × unit cost)
// and previewed live.

const CATEGORY_OPTIONS = Object.entries(INV_CAT_LABELS).map(([v, label]) => ({ v, label }));
const UOM_OPTIONS = Object.keys(INV_UOM_LABELS);

export default function InventoryCreatePage() {
  const navigate = useNavigate();
  const { addItem } = useInventory();

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [uom, setUom] = useState("pcs");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }

  const previewValue = useMemo(() => (Number(qty) || 0) * (Number(unitCost) || 0), [qty, unitCost]);
  const canSubmit = name.trim() && category && uom;

  function onSave() {
    if (!name.trim()) { showToast("Item name is required"); return; }
    if (!category) { showToast("Pick a category"); return; }
    const item = addItem({
      sku: sku.trim(),
      name: name.trim(),
      category,
      uom,
      qty: Number(qty) || 0,
      unit_cost: Number(unitCost) || 0,
      notes: notes.trim(),
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
        <div className="ap-title">Add New Inventory</div>
        <div className="ap-hint" style={{ flex: 1, marginLeft: 8 }}>
          Fields marked <span style={{ color: "var(--color-danger-text)" }}>*</span> are required
        </div>
      </div>

      {/* Body */}
      <div className="ap-s1" style={{ alignItems: "stretch", padding: "28px 24px 96px" }}>
        <div style={{ width: "100%", maxWidth: 680, margin: "0 auto" }}>

          {/* 1 — Item */}
          <div className="form-sec card">
            <div className="form-sec-title">Item</div>
            <div className="fg2">
              <div className="form-fld">
                <label>SKU</label>
                <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Auto (RAW-0001)" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }} />
                <span className="vc-hint">Leave blank to auto-generate from the category</span>
              </div>
              <div className="form-fld">
                <label>Category <span className="vc-req">*</span></label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Pick a category…</option>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <label>Item Name <span className="vc-req">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Steel Sheet 1.2mm" />
            </div>
          </div>

          {/* 2 — Stock & Cost */}
          <div className="form-sec card">
            <div className="form-sec-title">Stock &amp; Cost</div>
            <div className="fg2">
              <div className="form-fld">
                <label>Quantity on Hand</label>
                <input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld">
                <label>Unit of Measure <span className="vc-req">*</span></label>
                <select value={uom} onChange={(e) => setUom(e.target.value)}>
                  {UOM_OPTIONS.map((u) => <option key={u} value={u}>{INV_UOM_LABELS[u]}</option>)}
                </select>
              </div>
            </div>
            <div className="fg2" style={{ marginBottom: 0 }}>
              <div className="form-fld">
                <label>Unit Cost (Rp)</label>
                <input type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="0" style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld">
                <label>Stock Value</label>
                <input type="text" value={formatRupiah(previewValue)} readOnly tabIndex={-1} style={{ fontFamily: "var(--font-mono)", fontWeight: 600, background: "var(--color-surface-sunken)", color: "var(--color-text-secondary)" }} />
                <span className="vc-hint">Quantity × unit cost</span>
              </div>
            </div>
          </div>

          {/* 3 — Notes */}
          <div className="form-sec card">
            <div className="form-sec-title">Notes</div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Storage location, supplier, reorder point, or any handling notes…" rows={3} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="ap-foot">
        <span className="ap-hint">New items appear on the Inventory list immediately.</span>
        <button className="ap-btn" onClick={() => navigate("/inventory")}>Cancel</button>
        <button className="ap-btn-send" onClick={onSave} disabled={!canSubmit}>
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
          Add Item
        </button>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
