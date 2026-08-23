import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { INVENTORY as SEED_INVENTORY } from "../data/seed/inventory";
import { axesFromLegacy, seedApprovalFor, seedChangeRequestFor } from "../data/seed/itemGovernance";
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

// GOVERNED fields — the master data whose change needs a second pair of eyes,
// because a document copies it and the books then depend on the copy: what the
// item is called, what it is, the unit its quantities are counted in, what we
// sell it for, and how it is taxed.
//
// Everything else saves immediately and is only logged: description, notes, and
// notably PURCHASE PRICE. Purchase price is reference data — it pre-fills a bill
// line so a buyer doesn't retype a number, and it can refresh itself from the
// last invoiced price. It values nothing, so gating it would mean an approval
// task for every bill posted. Its risk is drift, not misstatement, and drift is
// caught by the price-variance check on the bill, not by an approval here.
export const APPROVAL_TRIGGER_FIELDS = ["name", "category", "uom", "sales_price", "tax_code"];
export const APPROVAL_TRIGGER_LABEL = {
  name: "Item name", category: "Category", uom: "Unit",
  sales_price: "Sales price", tax_code: "Tax treatment",
};

// Fields captured in a version snapshot — the item's MASTER record at the moment
// an approval cycle completes. Quantities, stock value and locations are
// deliberately absent: they are stock figures, not master data, and freezing
// them here would imply this module owns them.
const VERSIONED_FIELDS = [
  "sku", "name", "category", "uom",
  "cost_price", "purchase_price", "sales_price", "tax_code",
  "lifecycle", "approval",
];
export const VER_FIELD_LABEL = {
  sku: "Product ID", name: "Name", category: "Category", uom: "Unit",
  cost_price: "Cost price", purchase_price: "Purchase price",
  sales_price: "Sales price", tax_code: "Tax treatment",
  lifecycle: "Lifecycle", approval: "Approval",
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

// Layer the two status axes onto the seed (which still carries one legacy
// `status`), then let itemGovernance.js override the approval axis so a few live
// items can sit in Active + Pending approval for the demo.
function withDerived(it) {
  const axes = axesFromLegacy(it.status);
  const lifecycle = it.lifecycle || axes.lifecycle;
  const approval = it.approval || seedApprovalFor(it.id, axes.approval);
  return {
    ...it,
    lifecycle,
    approval,
    // An approved item already has one frozen version (seeded below); anything
    // still awaiting its first sign-off has completed no cycle yet.
    current_version: it.current_version ?? (axes.approval === "approved" ? 1 : 0),
  };
}

// Seed v1 for every item that arrived already approved, so version history is
// populated on load. Items awaiting a first approval have no version yet.
function seedVersions(items) {
  const map = {};
  for (const it of items) {
    if ((it.current_version || 0) === 0) continue;
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

// Open change requests seeded alongside the Active + Pending items.
function seedChangeRequests(items) {
  const map = {};
  for (const it of items) {
    const req = seedChangeRequestFor(it.id);
    if (req && it.approval === "pending_approval") map[it.id] = { ...req };
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
  const seeded = useMemo(() => SEED_INVENTORY.map(withDerived), []);
  const [items, setItems] = useState(seeded);
  // Frozen snapshots per item, newest-first — one per completed approval.
  const [versions, setVersions] = useState(() => seedVersions(seeded));
  // Open change requests — itemId → {patch, fields, submittedBy, submittedAt,
  // reason}. The item keeps serving its approved values while one is open.
  const [changeRequests, setChangeRequests] = useState(() => seedChangeRequests(seeded));
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

    const record = {
      id,
      sku,
      name: draft.name?.trim() || "Untitled item",
      category,
      uom: isService ? null : (draft.uom || "pcs"),
      qty,
      unit_cost,
      value: isService ? null : (qty || 0) * unit_cost,
      // A new item is a Draft that has not been submitted. It is not selectable
      // on documents until an approver signs off a first version — there is no
      // approved unit, price or tax treatment for a bill line to copy yet.
      lifecycle: "draft",
      approval: "unapproved",
      current_version: 0,
      tax_code: draft.tax_code || "ppn_masukan",
      updated: today(),
      locations: isService ? [] : (locations.length ? locations : [{ loc: "Main Warehouse", qty: qty || 0 }]),
      notes: draft.notes?.trim() || "",
      ...(draft.cost_price != null ? { cost_price: Number(draft.cost_price) } : {}),
      ...(draft.purchase_price != null ? { purchase_price: Number(draft.purchase_price) } : {}),
      ...(draft.sales_price != null ? { sales_price: Number(draft.sales_price) } : {}),
    };
    setItems((prev) => [record, ...prev]);
    logEvent(id, "Created", "Added as Draft", draft.actor);
    return record;
  }, [items, logEvent]);

  // Edit an item. Non-governed fields save straight away. Governed fields do NOT
  // touch the record — they open a change request, so the item stays Active and
  // fully usable on new bills at its approved values while review happens. Only
  // one request may be open at a time; a second edit is refused rather than
  // silently merged, so an approver always reviews one coherent change.
  const updateItem = useCallback((id, patch, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return { applied: [], requested: [], blocked: null };

    const changed = Object.keys(patch).filter((k) => JSON.stringify(item[k]) !== JSON.stringify(patch[k]));
    const requested = changed.filter((k) => APPROVAL_TRIGGER_FIELDS.includes(k));
    const applied = changed.filter((k) => !APPROVAL_TRIGGER_FIELDS.includes(k));
    if (!changed.length) return { applied: [], requested: [], blocked: null };

    // A Draft has no approved version to protect, so governed edits there save
    // directly — nothing downstream has copied anything yet.
    const isDraft = item.lifecycle === "draft";
    if (isDraft || !requested.length) {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch, updated: today() } : it)));
      logEvent(id, "Item updated", changed.map((k) => APPROVAL_TRIGGER_LABEL[k] || VER_FIELD_LABEL[k] || k).join(", "), meta.actor);
      return { applied: changed, requested: [], blocked: null };
    }

    if (changeRequests[id]) {
      return { applied: [], requested: [], blocked: "A change request is already open on this item." };
    }

    const reqPatch = {};
    for (const k of requested) reqPatch[k] = patch[k];
    setChangeRequests((prev) => ({
      ...prev,
      [id]: { patch: reqPatch, submittedBy: meta.actor || "—", submittedAt: today(), reason: meta.reason || "" },
    }));
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      // Non-governed edits in the same save still apply immediately.
      const merged = applied.length ? { ...it, ...Object.fromEntries(applied.map((k) => [k, patch[k]])) } : { ...it };
      return { ...merged, approval: "pending_approval", updated: today() };
    }));
    logEvent(
      id,
      "Change requested — pending approval",
      requested.map((k) => APPROVAL_TRIGGER_LABEL[k] || k).join(", "),
      meta.actor,
    );
    return { applied, requested, blocked: null };
  }, [items, changeRequests, logEvent]);

  // Submit a never-approved Draft for its first sign-off. Lifecycle stays Draft
  // until an approver applies it — see itemGovernance.js on why items differ
  // from vendors here.
  const submitItem = useCallback((id, meta = {}) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, approval: "pending_approval" } : it)));
    logEvent(id, "Submitted for approval", "Awaiting an approver", meta.actor);
  }, [logEvent]);

  // Approve whatever is pending: a brand-new Draft (→ Active, v1) or an open
  // change request (patch applied, new version frozen). Either way the approver
  // may not be the person who submitted it — that check is the whole point of
  // the approval axis, so it is enforced here and not only in the UI.
  const approveItem = useCallback((id, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return { ok: false, error: "Item not found." };

    const req = changeRequests[id];
    const submitter = req ? req.submittedBy : null;
    if (submitter && meta.actor && submitter === meta.actor) {
      return { ok: false, error: `${submitter} submitted this change — it needs a different approver.` };
    }

    const prevList = versions[id] || [];
    const n = prevList.length + 1;
    const nextRecord = { ...item, ...(req ? req.patch : {}), lifecycle: "active", approval: "approved" };
    const data = snapshotData(nextRecord);
    const snap = {
      versionId: `${item.sku}·v${n}`,
      version: n,
      approvedAt: today(),
      approvedBy: meta.actor || "—",
      reason: meta.reason || (req ? req.reason : ""),
      changedFields: diffFields(prevList[0]?.data, data),
      data,
    };
    setVersions((prev) => ({ ...prev, [id]: [snap, ...(prev[id] || [])] }));
    setItems((prev) => prev.map((it) => (
      it.id === id ? { ...nextRecord, current_version: n, updated: today() } : it
    )));
    if (req) setChangeRequests((prev) => { const next = { ...prev }; delete next[id]; return next; });
    logEvent(id, "Approved", `${snap.versionId}${snap.changedFields.length ? ` · ${snap.changedFields.length} field(s) changed` : ""}`, meta.actor);
    return { ok: true };
  }, [items, versions, changeRequests, logEvent]);

  // Reject what is pending. A change request is simply discarded — the item is
  // untouched, no version is created, and it goes back to Approved because its
  // approved values were never disturbed. A never-approved Draft returns to
  // unsubmitted so the maker can revise it.
  const rejectItem = useCallback((id, meta = {}) => {
    const item = items.find((it) => it.id === id);
    if (!item) return;
    const hadRequest = Boolean(changeRequests[id]);
    setItems((prev) => prev.map((it) => (
      it.id === id
        ? { ...it, approval: (it.current_version || 0) === 0 ? "unapproved" : "approved" }
        : it
    )));
    if (hadRequest) setChangeRequests((prev) => { const next = { ...prev }; delete next[id]; return next; });
    logEvent(id, hadRequest ? "Change rejected — discarded" : "Returned to Draft", meta.reason || "", meta.actor);
  }, [items, changeRequests, logEvent]);

  // Withdraw your own open request — the maker's escape hatch. Without it the
  // person who made a typo has to ask someone else to reject it for them.
  const withdrawChange = useCallback((id, meta = {}) => {
    const req = changeRequests[id];
    if (!req) return { ok: false, error: "Nothing to withdraw." };
    setChangeRequests((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setItems((prev) => prev.map((it) => (
      it.id === id
        ? { ...it, approval: (it.current_version || 0) === 0 ? "unapproved" : "approved" }
        : it
    )));
    logEvent(id, "Change withdrawn", req.reason || "", meta.actor);
    return { ok: true };
  }, [changeRequests, logEvent]);

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
      [id]: [{ date: today(), action: "adjust", loc: targetLoc.loc, unit: delta, unit_cost: unitCost, value: valueDelta, je: je_number || null, note: reasonLabel }, ...(prev[id] || [])],
    }));
    logEvent(id, "Stock adjusted", `${targetLoc.loc}: ${oldQty.toLocaleString("id-ID")} → ${nq.toLocaleString("id-ID")} (${delta >= 0 ? "+" : ""}${delta.toLocaleString("id-ID")})${reason ? ` · ${reason}` : ""}`, actor);
    return { delta, valueDelta, oldQty, newQty: nq, loc: targetLoc.loc };
  }, [items, logEvent]);

  const itemById = useCallback((id) => items.find((it) => it.id === id) || null, [items]);
  const versionsOf = useCallback((id) => versions[id] || [], [versions]);
  const changeRequestFor = useCallback((id) => changeRequests[id] || null, [changeRequests]);

  const value = useMemo(
    () => ({ items, addItem, updateItem, submitItem, approveItem, rejectItem, withdrawChange, adjustStock, itemById, versionsOf, changeRequestFor, changeRequests, changeLog, movementLog }),
    [items, addItem, updateItem, submitItem, approveItem, rejectItem, withdrawChange, adjustStock, itemById, versionsOf, changeRequestFor, changeRequests, changeLog, movementLog],
  );
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

// Selectable on a new document? That is a LIFECYCLE question only. An item with
// a governed change in review stays usable — the bill copies its last approved
// values, and the pending approval surfaces as a flag on the bill at posting
// (see reviewWorkflow.js), which is where it belongs. Draft items are excluded
// because they have no approved version for a line to copy.
export function isUsableInBills(item) {
  return (item?.lifecycle || "active") === "active";
}

// Does this item carry an unapproved governed change? Drives the bill-side flag.
export function hasPendingApproval(item) {
  return (item?.approval || "approved") === "pending_approval";
}

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error("useInventory must be used inside <InventoryProvider>");
  return ctx;
}
