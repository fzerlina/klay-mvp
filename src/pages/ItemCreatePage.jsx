import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useItems } from "../state/ItemsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useInventorySubledger } from "../state/InventorySubledgerContext";
import { useStockJournal } from "../components/RecordMovementModal";
import { formatRupiahExact } from "../lib/format";
import {
  ITEM_CAT_LABELS, ITEM_TYPES, ITEM_TYPE_ORDER, ITEM_UOM_LABELS,
  PRIMARY_UNITS, UNIT_DEFAULTS, UNIT_KIND_LABELS,
} from "../data/seed/items";
import { DEFTAX_LABELS } from "../data/labels";
import { itemAccounts } from "../lib/itemMaster";
import "./invoice-create.css";
import "./items.css";

// ── Add New Item ─────────────────────────────────────────────────────────────
// Master-data create form on the shared create-page shell. It captures identity,
// units, commercial terms and nothing else.
//
// OPENING STOCK IS NOT A FIELD ON THE ITEM. The locations and opening
// quantities entered at the bottom are handed to the Inventory Sub-Ledger as
// opening-balance MOVEMENTS, each at the cost given, frozen on the movement —
// and one draft journal entry (Dr Inventory / Cr Retained Earnings) follows for
// the books. After that, the only way the number changes is another movement.
// Locations are free text; one with no quantity is still registered, so it can
// be picked when the first movement is recorded.

const SKU_TYPE_PREFIX = { service: "SVC", non_stocked: "NST" };
const SKU_CAT_PREFIX = { raw_material: "RAW", finished_goods: "FIN", supplies: "SUP", packaging: "PKG", service: "SVC" };

export default function ItemCreatePage() {
  const navigate = useNavigate();
  const { addItem } = useItems();
  const { user } = useCurrentUser();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [itemType, setItemType] = useState("stocked");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");
  const [primaryUnit, setPrimaryUnit] = useState("pcs");
  const [salesPrice, setSalesPrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [taxCode, setTaxCode] = useState("ppn_masukan");
  const [openLines, setOpenLines] = useState([{ loc: "", qty: "", unit_cost: "" }]);
  const { recordOpening } = useInventorySubledger();
  const draftJournal = useStockJournal();
  const setLine = (i, k, v) => setOpenLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2400);
  }

  const isService = itemType === "service";
  const unitModel = UNIT_DEFAULTS[primaryUnit] || UNIT_DEFAULTS.pcs;
  const primaryLabel = ITEM_UOM_LABELS[primaryUnit] || primaryUnit;
  const secondaryLabel = unitModel.secondary_unit ? (ITEM_UOM_LABELS[unitModel.secondary_unit] || unitModel.secondary_unit) : null;

  const skuPreview = useMemo(() => {
    if (sku.trim()) return sku.trim();
    const prefix = SKU_TYPE_PREFIX[itemType] || SKU_CAT_PREFIX[category];
    return prefix ? `${prefix}-####` : "Auto";
  }, [sku, itemType, category]);

  const accountPreview = useMemo(() => (category ? itemAccounts({ category }) : []), [category]);

  const isStockedType = itemType === "stocked";
  // A quantity with nowhere to sit, or with no cost to carry it at, is refused
  // rather than guessed. Cost defaults to the purchase price when left blank.
  const lineCost = (l) => (l.unit_cost !== "" ? Number(l.unit_cost) : (purchasePrice !== "" ? Number(purchasePrice) : null));
  const openingIssue = isStockedType && openLines.some((l) => Number(l.qty) > 0 && (!l.loc.trim() || !lineCost(l)))
    ? "Each opening quantity needs a location and a unit cost (or a purchase price to default to)."
    : null;
  const openingTotal = openLines.reduce((s, l) => s + (Number(l.qty) > 0 ? Number(l.qty) * (lineCost(l) || 0) : 0), 0);

  const canSubmit = Boolean(name.trim() && category && (isService || primaryUnit) && !openingIssue);

  function onSave() {
    if (!name.trim()) { showToast("Item name is required"); return; }
    if (!category) { showToast("Pick a category"); return; }
    const item = addItem({
      sku: sku.trim(),
      name: name.trim(),
      description: description.trim(),
      item_type: itemType,
      category,
      primary_unit: isService ? null : primaryUnit,
      ...(isService ? {} : unitModel),
      tax_code: taxCode,
      purchase_price: purchasePrice !== "" ? purchasePrice : undefined,
      sales_price: salesPrice !== "" ? salesPrice : undefined,
      // Recorded on v1 as its creator — the audit trail should name who put the
      // item in the catalogue, precisely because nobody signed it off.
      actor: user.name,
    });
    let je = null;
    if (isStockedType) {
      const lines = openLines.map((l) => ({ loc: l.loc, qty: l.qty, unit_cost: lineCost(l) }));
      const rows = lines.filter((l) => l.loc.trim() && Number(l.qty) > 0)
        .map((l) => ({ unit: Number(l.qty), value: Number(l.qty) * Math.round(l.unit_cost), action: "opening", loc: l.loc.trim() }));
      if (rows.length) je = draftJournal(item, rows, `Opening stock — ${item.name}`);
      recordOpening(item, lines, { je_number: je, by: user.name });
    }
    showToast(`${item.name} added — Active and ready to use${je ? ` · opening stock drafted as ${je}` : ""} ✓`);
    setTimeout(() => navigate(`/items/${item.id}`), 700);
  }

  return (
    <div className="addpage">
      <div className="ap-head">
        <button className="ap-close" onClick={() => navigate("/items")} aria-label="Close">
          <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <div className="ap-title">Add New Item</div>
        <div className="ap-hint" style={{ flex: 1, marginLeft: 8 }}>
          Fields marked <span style={{ color: "var(--color-danger-text)" }}>*</span> are required
        </div>
      </div>

      <div className="ap-s1" style={{ alignItems: "stretch", padding: "28px 24px 96px" }}>
        <div style={{ width: "100%", maxWidth: 680, margin: "0 auto" }}>

          {/* 1 — Identity */}
          <div className="form-sec card">
            <div className="form-sec-title">Identity</div>
            <div className="form-fld">
              <label>Item Name <span className="vc-req">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Steel Sheet 1.2mm" />
            </div>
            <div className="form-fld">
              <label>Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this thing actually is" />
            </div>

            {/* Type and Category are separate questions. Type decides whether
                stock is a concept for this row at all; Category decides which GL
                accounts it books to. Folding them together forces a service to
                masquerade as a category. */}
            <div className="fg2">
              <div className="form-fld">
                <label>Item Type <span className="vc-req">*</span></label>
                <select value={itemType} onChange={(e) => setItemType(e.target.value)}>
                  {ITEM_TYPE_ORDER.map((t) => <option key={t} value={t}>{ITEM_TYPES[t].label}</option>)}
                </select>
                <span className="vc-hint">{ITEM_TYPES[itemType].desc}</span>
              </div>
              <div className="form-fld">
                <label>Category <span className="vc-req">*</span></label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Pick a category…</option>
                  {Object.entries(ITEM_CAT_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <span className="vc-hint">Resolves the GL account set below.</span>
              </div>
            </div>

            <div className="fg2" style={{ marginBottom: 0 }}>
              <div className="form-fld">
                <label>Item ID (SKU)</label>
                <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={skuPreview} style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }} />
                <span className="vc-hint">Leave blank to auto-generate ({skuPreview}). A code is never reused, and never changes once the item is live.</span>
              </div>
              {/* No status picker, and no approval step either: creating an item
                  is not a governed act, so it lands Active and usable. What
                  needs a second pair of eyes is CHANGING a governed field on an
                  item other documents have already copied from. */}
              <div className="form-fld">
                <label>Status</label>
                <div className="vc-readonly">Active — usable on documents immediately</div>
              </div>
            </div>
          </div>

          {/* 2 — Units (a service has no unit model at all) */}
          {!isService && (
            <div className="form-sec card">
              <div className="form-sec-title">Units of Measure</div>
              <div className="fg2">
                <div className="form-fld">
                  <label>Primary Unit <span className="vc-req">*</span></label>
                  <select value={primaryUnit} onChange={(e) => setPrimaryUnit(e.target.value)}>
                    {PRIMARY_UNITS.map((u) => <option key={u} value={u}>{ITEM_UOM_LABELS[u]}</option>)}
                  </select>
                </div>
                <div className="form-fld">
                  <label>Unit Kind</label>
                  <input type="text" value={UNIT_KIND_LABELS[unitModel.unit_kind]} readOnly tabIndex={-1} className="imc-ro" />
                  <span className="vc-hint">
                    {unitModel.unit_kind === "count"
                      ? "Whole things. An entry in the secondary unit must resolve to a whole number of primary units."
                      : `Continuous. Quantities may carry ${unitModel.precision} decimal places.`}
                  </span>
                </div>
              </div>
              <div className="fg2" style={{ marginBottom: 0 }}>
                <div className="form-fld">
                  <label>Secondary Unit</label>
                  <input type="text" value={secondaryLabel || "—"} readOnly tabIndex={-1} className="imc-ro" />
                </div>
                <div className="form-fld">
                  <label>Conversion Ratio</label>
                  <input
                    type="text"
                    value={secondaryLabel ? `1 ${primaryLabel} = ${unitModel.conversion_ratio.toLocaleString("id-ID")} ${secondaryLabel}` : "—"}
                    readOnly tabIndex={-1} className="imc-ro"
                  />
                </div>
              </div>
              <div className="imc-note" style={{ marginTop: 14 }}>
                <strong>These lock once the item holds stock.</strong> Redefining “1 box = 24 pieces” to
                “= 12” would not restate anything — it would silently change what every box already
                recorded <em>meant</em>. Set them correctly now; after the first movement they need the
                stock drawn to zero to change.
              </div>
            </div>
          )}

          {/* 3 — Commercial */}
          <div className="form-sec card">
            <div className="form-sec-title">Commercial</div>
            <div className="fg3" style={{ marginBottom: 0 }}>
              <div className="form-fld">
                <label>Sales Price (Rp) <span className="imd-fld-tag">governed</span></label>
                <input type="number" min="0" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} placeholder="Blank if not sold" style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld">
                <label>Purchase Price (Rp) <span className="imd-fld-tag">reference</span></label>
                <input type="number" min="0" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="Reference only" style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld">
                <label>Default Tax Treatment</label>
                <select value={taxCode} onChange={(e) => setTaxCode(e.target.value)}>
                  {Object.entries(DEFTAX_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
            </div>
            <span className="vc-hint" style={{ marginTop: 10, display: "block" }}>
              A blank sales price stays blank — it is never estimated from cost, and an item without one
              can’t go on a sales document. Purchase price and tax treatment are <strong>copied onto a
              document at entry</strong>, where the document keeps its own copy; neither values stock.
            </span>
          </div>

          {/* 4 — Accounting preview (read-only) */}
          <div className="form-sec card">
            <div className="form-sec-title">GL Account Set <span className="imc-rotag">Read-only</span></div>
            {!category ? (
              <div className="imc-acct-empty">Pick a category to see its GL account mapping.</div>
            ) : (
              <div className="imc-acct-list">
                {accountPreview.map((a) => (
                  <div className="imc-acct-row" key={a.key}>
                    <span className="imc-acct-lbl">{a.label}</span>
                    <span className="imc-acct-val">
                      {a.name ? <>{a.name} <span className="imc-acct-code">{a.code}</span></> : <span className="imc-acct-na">Not applicable</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <span className="vc-hint" style={{ marginTop: 10, display: "block" }}>Set per category in Item Category Settings, never per item.</span>
          </div>

          {/* 5 — Locations and opening stock (stocked items only) */}
          {isStockedType && (
            <div className="form-sec card">
              <div className="form-sec-title">Locations &amp; Opening Stock</div>
              <div className="imc-open-head">
                <span>Location / warehouse</span>
                <span className="num">Opening qty ({primaryLabel})</span>
                <span className="num">Unit cost (Rp)</span>
                <span />
              </div>
              {openLines.map((l, i) => (
                <div className="imc-open-row" key={i}>
                  <input type="text" value={l.loc} onChange={(e) => setLine(i, "loc", e.target.value)} placeholder="e.g. Jakarta Warehouse" />
                  <input type="number" min="0" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} placeholder="0" style={{ fontFamily: "var(--font-mono)", textAlign: "right" }} />
                  <input type="number" min="0" value={l.unit_cost} onChange={(e) => setLine(i, "unit_cost", e.target.value)} placeholder={purchasePrice || "Required"} style={{ fontFamily: "var(--font-mono)", textAlign: "right" }} />
                  <button type="button" className="imc-open-x" aria-label="Remove location" disabled={openLines.length === 1}
                    onClick={() => setOpenLines((ls) => ls.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button type="button" className="imc-open-add" onClick={() => setOpenLines((ls) => [...ls, { loc: "", qty: "", unit_cost: "" }])}>
                + Add location
              </button>
              {openingIssue && <div className="rm-error">{openingIssue}</div>}
              <div className="imc-note" style={{ marginTop: 12 }}>
                Each quantity is recorded as an <strong>opening-balance movement</strong> in the Inventory
                Sub-Ledger{openingTotal > 0 ? <> — <span style={{ fontFamily: "var(--font-mono)" }}>{formatRupiahExact(openingTotal)}</span>, drafted as one journal entry (Dr Inventory / Cr Retained Earnings)</> : ""}.
                After this, stock changes only through recorded movements on the item’s Stock tab — never
                by editing the number. Leave it blank and the item reads <em>“No stock recorded”</em>,
                which is deliberately not the same as zero.
              </div>
            </div>
          )}

        </div>
      </div>

      <div className="ap-foot">
        <span className="ap-hint">New items go live immediately — creation needs no approval.</span>
        <button className="ap-btn" onClick={() => navigate("/items")}>Cancel</button>
        <button className="ap-btn-send" onClick={onSave} disabled={!canSubmit}>
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
          Add Item
        </button>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
