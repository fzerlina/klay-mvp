import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { ITEMS as SEED_ITEMS } from "../data/seed/items";
import { lifecycleFromLegacy } from "../data/seed/itemGovernance";
import { TODAY } from "../lib/clock";

// ── Item Master state ────────────────────────────────────────────────────────
//
// The catalogue, and nothing else. There is no quantity, no cost, no stock value
// and no movement anywhere in this file — those belong to the Inventory
// Sub-Ledger (state/InventorySubledgerContext.jsx), which this module reads and
// never writes.
//
// NOTHING HERE IS APPROVAL-GATED. Creating an item needs no sign-off and neither
// does editing one; every change saves immediately. What used to be an approval
// workflow is now two lighter mechanisms that do the work approval was actually
// there for:
//
//   VERSIONS    — every change freezes a snapshot, and a document copies from a
//                 version rather than re-reading the item later. This is what
//                 stops an April edit restating a January bill, and it is the
//                 real protection; approval only ever addressed that indirectly.
//   AUDIT TRAIL — who changed what, when, and from what to what. Detection after
//                 the fact instead of permission before it.
//
// The guards that remain are not approvals — they are physical constraints, and
// they still refuse: unit fields lock while the sub-ledger reports stock, and
// deactivation is blocked while stock exists. Both fail closed. Neither can be
// signed away by a person, which is exactly why they survived and approval
// didn't.

const ItemsContext = createContext(null);

// SKU prefix — item type first (a service is never RAW-0001), then category.
const TYPE_PREFIX = { service: "SVC", non_stocked: "NST" };
const CATEGORY_PREFIX = {
  raw_material: "RAW", finished_goods: "FIN", supplies: "SUP", packaging: "PKG", service: "SVC",
};
const skuPrefixFor = (item_type, category) =>
  TYPE_PREFIX[item_type] || CATEGORY_PREFIX[category] || "ITM";

// Fields captured in a version snapshot — the item's master record as a document
// would copy it. Quantities, stock value and locations are deliberately absent:
// they are stock figures, and freezing them here would imply this module decides
// them. `notes` is absent too — it is a scratchpad, not a value anything copies.
const VERSIONED_FIELDS = [
  "sku", "name", "description", "item_type", "category",
  "primary_unit", "unit_kind", "secondary_unit", "conversion_type", "conversion_ratio", "precision",
  "purchase_price", "sales_price", "tax_code",
  "lifecycle",
];
export const VER_FIELD_LABEL = {
  sku: "Item ID", name: "Name", description: "Description",
  item_type: "Item type", category: "Category",
  primary_unit: "Primary unit", unit_kind: "Unit kind", secondary_unit: "Secondary unit",
  conversion_type: "Conversion type", conversion_ratio: "Conversion ratio", precision: "Precision",
  purchase_price: "Purchase price", sales_price: "Sales price", tax_code: "Tax treatment",
  lifecycle: "Lifecycle",
};

function snapshotData(item) {
  const out = {};
  for (const k of VERSIONED_FIELDS) {
    const v = item[k];
    out[k] = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}

// Layer the lifecycle onto the seed, which carries one legacy `status` string.
function withDerived(it) {
  return {
    ...it,
    lifecycle: it.lifecycle || lifecycleFromLegacy(it.status),
    current_version: it.current_version ?? 1,
  };
}

// Seed v1 for every item, so version history is populated on load. These arrived
// through migration rather than being created here, and say so.
function seedVersions(items) {
  const map = {};
  for (const it of items) {
    map[it.id] = [{
      versionId: `${it.sku}·v1`,
      version: 1,
      origin: "imported",
      at: it.updated || "2025-01-01",
      by: "Imported record",
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
  return "ITM" + String(max + 1).padStart(3, "0");
}

// Next SKU within a prefix — continues that prefix's numbering. A code is never
// reused, and never changes once the item is live.
function nextSku(list, item_type, category) {
  const prefix = skuPrefixFor(item_type, category);
  const nums = list
    .filter((it) => String(it.sku || "").startsWith(prefix + "-"))
    .map((it) => parseInt(String(it.sku).replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

const today = () => TODAY.toISOString().slice(0, 10);

export function ItemsProvider({ children }) {
  const seeded = useMemo(() => SEED_ITEMS.map(withDerived), []);
  const [items, setItems] = useState(seeded);
  // Frozen snapshots per item, newest-first — one per change.
  const [versions, setVersions] = useState(() => seedVersions(seeded));
  // In-session change log — itemId → [{date, actor, action, detail}], newest first.
  const [changeLog, setChangeLog] = useState({});

  const logEvent = useCallback((id, action, detail, actor) => {
    setChangeLog((prev) => ({
      ...prev,
      [id]: [{ date: today(), actor: actor || "—", action, detail: detail || "" }, ...(prev[id] || [])],
    }));
  }, []);

  // Freeze a snapshot of `record` as its next version. Called on every change to
  // a versioned field. `origin` keeps the snapshot honest about how it came to
  // exist — nothing here was approved, and saying otherwise would put a sign-off
  // in the record that never happened.
  const pushVersion = useCallback((record, { origin, by, reason, changedFields }) => {
    setVersions((prev) => {
      const list = prev[record.id] || [];
      const n = list.length + 1;
      return {
        ...prev,
        [record.id]: [{
          versionId: `${record.sku}·v${n}`,
          version: n,
          origin,
          at: today(),
          by: by || "—",
          reason: reason || "",
          changedFields: changedFields || [],
          data: snapshotData(record),
        }, ...list],
      };
    });
  }, []);

  const addItem = useCallback((draft) => {
    const id = nextId(items);
    const item_type = draft.item_type || "stocked";
    const category = draft.category || "supplies";
    const sku = draft.sku?.trim() || nextSku(items, item_type, category);
    // NO OPENING STOCK AND NO COST ARE CAPTURED HERE. Putting stock into the
    // system is a financial event that needs a posted journal entry, so it is
    // recorded as a movement in the Inventory Sub-Ledger — never typed into a
    // "new item" form, where it would silently become quantity × a typed cost.
    const record = {
      id,
      sku,
      name: draft.name?.trim() || "Untitled item",
      description: draft.description?.trim() || "",
      item_type,
      category,
      primary_unit:     item_type === "service" ? null : (draft.primary_unit || "pcs"),
      unit_kind:        item_type === "service" ? null : (draft.unit_kind || "count"),
      secondary_unit:   item_type === "service" ? null : (draft.secondary_unit ?? null),
      conversion_type:  item_type === "service" ? null : (draft.conversion_type ?? null),
      conversion_ratio: item_type === "service" ? null : (draft.conversion_ratio ?? null),
      precision:        item_type === "service" ? 0    : (draft.precision ?? 0),
      // Active on save, usable on a bill immediately.
      lifecycle: "active",
      current_version: 1,
      tax_code: draft.tax_code || "ppn_masukan",
      updated: today(),
      notes: draft.notes?.trim() || "",
      ...(draft.purchase_price != null ? { purchase_price: Number(draft.purchase_price) } : {}),
      ...(draft.sales_price != null ? { sales_price: Number(draft.sales_price) } : {}),
    };
    setItems((prev) => [record, ...prev]);
    pushVersion(record, { origin: "created", by: draft.actor, reason: "Item created" });
    logEvent(id, "Created", "Active on creation", draft.actor);
    return record;
  }, [items, logEvent, pushVersion]);

  // Edit an item. Every change saves immediately. A change to any versioned field
  // freezes a new version, so documents raised before it keep copying the values
  // they were raised against — that, not a second signature, is what keeps a
  // closed month closed.
  const updateItem = useCallback((id, patch, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return { changed: [] };

    const changed = Object.keys(patch).filter((k) => JSON.stringify(item[k]) !== JSON.stringify(patch[k]));
    if (!changed.length) return { changed: [] };

    const versioned = changed.filter((k) => VERSIONED_FIELDS.includes(k));
    const next = { ...item, ...patch, updated: today() };
    if (versioned.length) next.current_version = (item.current_version || 0) + 1;

    setItems((prev) => prev.map((it) => (it.id === id ? next : it)));
    if (versioned.length) {
      pushVersion(next, {
        origin: "changed",
        by: meta.actor,
        reason: meta.reason || "",
        changedFields: versioned,
      });
    }
    logEvent(id, "Item updated", changed.map((k) => VER_FIELD_LABEL[k] || k).join(", "), meta.actor);
    return { changed, versioned };
  }, [items, logEvent, pushVersion]);

  // Bring an imported Draft live once someone has finished the record off. A
  // completion step, not a sign-off — the person doing it is usually the person
  // who tidied the import, and there is no rule against that.
  const activateItem = useCallback((id, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return { ok: false, error: "Item not found." };
    const next = { ...item, lifecycle: "active", current_version: (item.current_version || 0) + 1, updated: today() };
    setItems((prev) => prev.map((it) => (it.id === id ? next : it)));
    pushVersion(next, { origin: "changed", by: meta.actor, reason: "Imported record completed", changedFields: ["lifecycle"] });
    logEvent(id, "Activated", "Lifecycle set to Active", meta.actor);
    return { ok: true };
  }, [items, logEvent, pushVersion]);

  // Retire an item. The caller MUST pass the sub-ledger's guard verdict — this
  // module cannot answer "does it hold stock?" and must not guess. Deactivating
  // an item that still holds stock takes its quantity out of the stock reports
  // while its value stays in the books, and the two then disagree with nothing
  // recording why.
  const deactivateItem = useCallback((id, guard, meta = {}) => {
    if (guard?.blocked) return { ok: false, error: guard.reason };
    const item = items.find((it) => it.id === id);
    if (!item) return { ok: false, error: "Item not found." };
    const next = { ...item, lifecycle: "inactive", current_version: (item.current_version || 0) + 1, updated: today() };
    setItems((prev) => prev.map((it) => (it.id === id ? next : it)));
    pushVersion(next, { origin: "changed", by: meta.actor, reason: meta.reason || "Deactivated", changedFields: ["lifecycle"] });
    logEvent(id, "Deactivated", meta.reason || "Lifecycle set to Inactive", meta.actor);
    return { ok: true };
  }, [items, logEvent, pushVersion]);

  const reactivateItem = useCallback((id, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return { ok: false, error: "Item not found." };
    const next = { ...item, lifecycle: "active", current_version: (item.current_version || 0) + 1, updated: today() };
    setItems((prev) => prev.map((it) => (it.id === id ? next : it)));
    pushVersion(next, { origin: "changed", by: meta.actor, reason: "Reactivated", changedFields: ["lifecycle"] });
    logEvent(id, "Reactivated", "Lifecycle set to Active", meta.actor);
    return { ok: true };
  }, [items, logEvent, pushVersion]);

  const itemById = useCallback((id) => items.find((it) => it.id === id) || null, [items]);
  const versionsOf = useCallback((id) => versions[id] || [], [versions]);

  const value = useMemo(
    () => ({
      items, addItem, updateItem, activateItem, deactivateItem, reactivateItem,
      itemById, versionsOf, changeLog,
    }),
    [items, addItem, updateItem, activateItem, deactivateItem, reactivateItem,
     itemById, versionsOf, changeLog],
  );
  return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

// Selectable on a new document? A lifecycle question, and the only one. Draft
// items are excluded because the record is incomplete, not because nobody has
// signed it off.
export function isUsableInBills(item) {
  return (item?.lifecycle || "active") === "active";
}

export function useItems() {
  const ctx = useContext(ItemsContext);
  if (!ctx) throw new Error("useItems must be used inside <ItemsProvider>");
  return ctx;
}
