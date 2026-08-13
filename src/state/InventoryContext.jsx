import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { INVENTORY as SEED_INVENTORY } from "../data/seed/inventory";
import { TODAY } from "../lib/clock";

const InventoryContext = createContext(null);

// SKU prefix per category — keeps auto-generated codes readable (RAW-0001…).
const SKU_PREFIX = {
  raw_material:   "RAW",
  finished_goods: "FIN",
  supplies:       "SUP",
  packaging:      "PKG",
  service:        "SVC",
};

function nextId(list) {
  const nums = list
    .map((it) => parseInt(String(it.id).replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "INV" + String(max + 1).padStart(3, "0");
}

// Next SKU within a category — continues that prefix's numbering.
function nextSku(list, category) {
  const prefix = SKU_PREFIX[category] || "ITM";
  const nums = list
    .filter((it) => String(it.sku || "").startsWith(prefix + "-"))
    .map((it) => parseInt(String(it.sku).replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export function InventoryProvider({ children }) {
  const [items, setItems] = useState(() => SEED_INVENTORY);

  const addItem = useCallback((draft) => {
    const id = nextId(items);
    const category = draft.category || "supplies";
    const sku = draft.sku?.trim() || nextSku(items, category);
    const isService = category === "service";
    const unit_cost = Number(draft.unit_cost) || 0;

    // Services carry no stock or location; everything else rolls up its
    // per-location quantities (falling back to a single Main Warehouse entry).
    const locations = Array.isArray(draft.locations)
      ? draft.locations
          .filter((l) => (l.loc || "").trim())
          .map((l) => ({ loc: l.loc.trim(), qty: Number(l.qty) || 0 }))
      : [];
    const qty = isService
      ? null
      : (locations.length ? locations.reduce((s, l) => s + l.qty, 0) : Number(draft.qty) || 0);

    const record = {
      id,
      sku,
      name: draft.name?.trim() || "Untitled item",
      category,
      uom: isService ? null : (draft.uom || "pcs"),
      qty,
      unit_cost,
      value: isService ? null : (qty || 0) * unit_cost,
      status: draft.status || "active",
      tax_code: draft.tax_code || "ppn_masukan",
      updated: TODAY.toISOString().slice(0, 10),
      locations: isService ? [] : (locations.length ? locations : [{ loc: "Main Warehouse", qty: qty || 0 }]),
      notes: draft.notes?.trim() || "",
      // Optional cost/pricing overrides — only stored when provided, otherwise
      // Product Detail derives them (see lib/productDetail.js).
      ...(draft.costing_method ? { costing_method: draft.costing_method } : {}),
      ...(draft.cost_price != null ? { cost_price: Number(draft.cost_price) } : {}),
      ...(draft.purchase_price != null ? { purchase_price: Number(draft.purchase_price) } : {}),
      ...(draft.sales_price != null ? { sales_price: Number(draft.sales_price) } : {}),
    };
    setItems((prev) => [record, ...prev]);
    return record;
  }, [items]);

  const itemById = useCallback((id) => items.find((it) => it.id === id) || null, [items]);

  const value = useMemo(() => ({ items, addItem, itemById }), [items, addItem, itemById]);
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error("useInventory must be used inside <InventoryProvider>");
  return ctx;
}
