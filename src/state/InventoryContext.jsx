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
    const qty = Number(draft.qty) || 0;
    const unit_cost = Number(draft.unit_cost) || 0;
    const record = {
      id,
      sku,
      name: draft.name?.trim() || "Untitled item",
      category,
      uom: draft.uom || "pcs",
      qty,
      unit_cost,
      value: qty * unit_cost,
      tax_code: draft.tax_code || "ppn_masukan",
      updated: TODAY.toISOString().slice(0, 10),
      notes: draft.notes?.trim() || "",
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
