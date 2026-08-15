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

// Fields captured in a version snapshot — the product's business record at the
// moment an approval cycle completes. Price fields are the usual thing changed.
const VERSIONED_FIELDS = [
  "sku", "name", "category", "uom",
  "qty", "unit_cost", "value",
  "cost_price", "purchase_price", "sales_price",
  "status", "locations",
];
export const VER_FIELD_LABEL = {
  sku: "Product ID", name: "Name", category: "Category", uom: "Unit",
  qty: "Stock count", unit_cost: "Cost / unit", value: "Stock value",
  cost_price: "Cost price", purchase_price: "Purchase price", sales_price: "Sales price",
  status: "Status", locations: "Locations",
};

function snapshotData(item) {
  const out = {};
  for (const k of VERSIONED_FIELDS) {
    const v = item[k];
    out[k] = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}
function diffFields(prev, next) {
  if (!prev) return [];
  return VERSIONED_FIELDS.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

// Approved lifecycle states (active/inactive) already carry a frozen v1; never-
// approved states (draft/pending_review) have no completed cycle yet.
const isApprovedStatus = (s) => s === "active" || s === "inactive";
function withVersionMeta(it) {
  return { ...it, current_version: it.current_version ?? (isApprovedStatus(it.status) ? 1 : 0) };
}

// Seed v1 for every already-approved product so version history is populated.
function seedVersions(items) {
  const map = {};
  for (const it of items) {
    if (!isApprovedStatus(it.status)) continue;
    map[it.id] = [{
      versionId: `${it.sku}·v1`,
      version: 1,
      approvedAt: it.updated || "2025-01-01",
      approvedBy: "Imported record",
      reason: "",
      changedFields: [],
      data: snapshotData(it),
    }];
  }
  return map;
}

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

const today = () => TODAY.toISOString().slice(0, 10);

export function InventoryProvider({ children }) {
  const seeded = useMemo(() => SEED_INVENTORY.map(withVersionMeta), []);
  const [items, setItems] = useState(seeded);
  // Frozen snapshots per product, newest-first — one per completed approval.
  const [versions, setVersions] = useState(() => seedVersions(seeded));
  // In-session change log — itemId → [{date, actor, action, detail}], newest first.
  const [changeLog, setChangeLog] = useState({});
  // In-session stock movements — itemId → [{date, action, unit, unit_cost, value, je, note}].
  const [movementLog, setMovementLog] = useState({});

  const logEvent = useCallback((id, action, detail, actor) => {
    setChangeLog((prev) => ({
      ...prev,
      [id]: [{ date: today(), actor: actor || "—", action, detail: detail || "" }, ...(prev[id] || [])],
    }));
  }, []);

  const addItem = useCallback((draft) => {
    const id = nextId(items);
    const category = draft.category || "supplies";
    const sku = draft.sku?.trim() || nextSku(items, category);
    const isService = category === "service";
    const unit_cost = Number(draft.unit_cost) || 0;

    const locations = Array.isArray(draft.locations)
      ? draft.locations
          .filter((l) => (l.loc || "").trim())
          .map((l) => ({ loc: l.loc.trim(), qty: Number(l.qty) || 0 }))
      : [];
    const qty = isService
      ? null
      : (locations.length ? locations.reduce((s, l) => s + l.qty, 0) : Number(draft.qty) || 0);
    const status = draft.status || "active";

    const record = {
      id,
      sku,
      name: draft.name?.trim() || "Untitled item",
      category,
      uom: isService ? null : (draft.uom || "pcs"),
      qty,
      unit_cost,
      value: isService ? null : (qty || 0) * unit_cost,
      status,
      current_version: isApprovedStatus(status) ? 1 : 0,
      tax_code: draft.tax_code || "ppn_masukan",
      updated: today(),
      locations: isService ? [] : (locations.length ? locations : [{ loc: "Main Warehouse", qty: qty || 0 }]),
      notes: draft.notes?.trim() || "",
      ...(draft.cost_price != null ? { cost_price: Number(draft.cost_price) } : {}),
      ...(draft.purchase_price != null ? { purchase_price: Number(draft.purchase_price) } : {}),
      ...(draft.sales_price != null ? { sales_price: Number(draft.sales_price) } : {}),
    };
    setItems((prev) => [record, ...prev]);
    // A product created straight into an approved state gets its frozen v1.
    if (isApprovedStatus(status)) {
      setVersions((prev) => ({
        ...prev,
        [id]: [{ versionId: `${sku}·v1`, version: 1, approvedAt: today(), approvedBy: draft.actor || "—", reason: "", changedFields: [], data: snapshotData(record) }],
      }));
    }
    logEvent(id, "Created", `Added as ${status}`, draft.actor);
    return record;
  }, [items, logEvent]);

  // Generic product edit. Applies a patch, recomputes stock value, and — because
  // any change to an Active product needs re-approval — routes it back to Pending
  // Review. Editing a Draft leaves it Draft; an already-pending edit stays pending.
  const updateItem = useCallback((id, patch, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return { changed: [], routed: false };
    const changed = VERSIONED_FIELDS.filter((k) => k in patch && JSON.stringify(item[k]) !== JSON.stringify(patch[k]));
    if (!changed.length) return { changed: [], routed: false };

    const routed = item.status === "active"; // active → pending_review on any edit
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const merged = { ...it, ...patch };
      const isService = merged.category === "service";
      if (!isService) {
        if (Array.isArray(merged.locations)) merged.qty = merged.locations.reduce((s, l) => s + (Number(l.qty) || 0), 0);
        merged.value = (merged.qty || 0) * (Number(merged.unit_cost) || 0);
      }
      if (routed) merged.status = "pending_review";
      merged.updated = today();
      return merged;
    }));
    const detail = changed.map((k) => VER_FIELD_LABEL[k] || k).join(", ");
    logEvent(id, routed ? "Edited — sent for review" : "Product updated", detail, meta.actor);
    return { changed, routed };
  }, [items, logEvent]);

  // Submit a Draft (or resubmit) for approval — Draft → Pending Review.
  const submitItem = useCallback((id, meta = {}) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "pending_review" } : it)));
    logEvent(id, "Submitted for review", "Draft → Pending Review", meta.actor);
  }, [logEvent]);

  // Approve the pending record → Active, freezing a new version snapshot.
  const approveItem = useCallback((id, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const prevList = versions[id] || [];
    const n = prevList.length + 1;
    const data = snapshotData({ ...item, status: "active" });
    const snap = {
      versionId: `${item.sku}·v${n}`,
      version: n,
      approvedAt: today(),
      approvedBy: meta.actor || "—",
      reason: meta.reason || "",
      changedFields: diffFields(prevList[0]?.data, data),
      data,
    };
    setVersions((prev) => ({ ...prev, [id]: [snap, ...(prev[id] || [])] }));
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "active", current_version: n } : it)));
    logEvent(id, "Approved", `${snap.versionId}${snap.changedFields.length ? ` · ${snap.changedFields.length} field(s) changed` : ""}`, meta.actor);
  }, [items, versions, logEvent]);

  // Reject the pending record. Never-approved (v0) → back to Draft for revision;
  // a pending change on an approved product → restore the last approved version.
  const rejectItem = useCallback((id, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const list = versions[id] || [];
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      if ((it.current_version || 0) === 0) return { ...it, status: "draft" };
      return { ...it, ...list[0].data, status: "active" }; // discard change
    }));
    logEvent(id, (item.current_version || 0) === 0 ? "Rejected — returned to Draft" : "Change rejected — reverted", meta.reason || "", meta.actor);
  }, [items, versions, logEvent]);

  // Stock adjustment (stock-opname / damage / shrinkage / correction). Sets a
  // location's on-hand count to the physical figure, rolls up total qty + value,
  // and records a movement + audit event. The GL side is booked separately as a
  // manual journal (the detail page stages a pre-filled draft) — this is the
  // periodic model, so stock updates here and the books follow when that posts.
  const adjustStock = useCallback((id, { loc, newQty, reason, note, actor, je_number } = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item || item.category === "service") return null;
    const locs = Array.isArray(item.locations) && item.locations.length
      ? item.locations
      : [{ loc: "Main Warehouse", qty: item.qty || 0 }];
    const targetLoc = locs.find((l) => l.loc === loc) || locs[0];
    const oldQty = targetLoc ? (targetLoc.qty || 0) : 0;
    const nq = Number(newQty) || 0;
    const delta = nq - oldQty;
    const unitCost = item.unit_cost || 0;
    const valueDelta = delta * unitCost;

    const nextLocs = locs.map((l) => (l.loc === targetLoc.loc ? { ...l, qty: nq } : l));
    const totalQty = nextLocs.reduce((s, l) => s + (l.qty || 0), 0);
    setItems((prev) => prev.map((it) => (
      it.id === id ? { ...it, locations: nextLocs, qty: totalQty, value: totalQty * unitCost, updated: today() } : it
    )));

    const reasonLabel = reason ? `${reason}${note ? ` — ${note}` : ""}` : (note || "");
    setMovementLog((prev) => ({
      ...prev,
      [id]: [{ date: today(), action: "adjust", unit: delta, unit_cost: unitCost, value: valueDelta, je: je_number || null, note: reasonLabel }, ...(prev[id] || [])],
    }));
    logEvent(id, "Stock adjusted", `${targetLoc.loc}: ${oldQty.toLocaleString("id-ID")} → ${nq.toLocaleString("id-ID")} (${delta >= 0 ? "+" : ""}${delta.toLocaleString("id-ID")})${reason ? ` · ${reason}` : ""}`, actor);
    return { delta, valueDelta, oldQty, newQty: nq, loc: targetLoc.loc };
  }, [items, logEvent]);

  const itemById = useCallback((id) => items.find((it) => it.id === id) || null, [items]);
  const versionsOf = useCallback((id) => versions[id] || [], [versions]);

  const value = useMemo(
    () => ({ items, addItem, updateItem, submitItem, approveItem, rejectItem, adjustStock, itemById, versionsOf, changeLog, movementLog }),
    [items, addItem, updateItem, submitItem, approveItem, rejectItem, adjustStock, itemById, versionsOf, changeLog, movementLog],
  );
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

// A product is usable on a bill only once it's Active (approved). Draft / Pending
// Review / Inactive products are excluded from bill line selection.
export function isUsableInBills(item) {
  return (item?.status || "active") === "active";
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error("useInventory must be used inside <InventoryProvider>");
  return ctx;
}
