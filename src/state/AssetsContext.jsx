import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { ASSETS as SEED_ASSETS } from "../data/seed/fixedAssets";
import { TODAY } from "../lib/clock";
import { useClosePeriod } from "./ClosePeriodContext";
import {
  buildSchedule, summarizeSchedule, firstOpenPeriod, disposalGuard, scheduleLocked, categoryChangeGuard,
} from "../lib/fixedAssets";

// ── Fixed Assets — one register, one context ────────────────────────────────
//
// A single provider, not the old two-module (Master + Sub-Ledger) split — the
// schedule engine (lib/fixedAssets.js) is a pure function of the asset record
// itself, so there's no second boundary left to enforce with a second
// Context. NOTHING HERE IS APPROVAL-GATED: creating or editing an asset needs
// no sign-off. What protects the books is `scheduleLocked` — once a period has
// posted, the schedule-defining fields freeze, and no capability can sign
// that away. Versions and the audit trail (changeLog) record the rest.

const AssetsContext = createContext(null);

const VERSIONED_FIELDS = [
  "name", "description", "category", "serial_no", "subsidiary", "type",
  "method", "rate", "duration_value", "duration_unit", "computation", "acquisition_date",
  "asset_account", "depreciation_account", "expense_account", "loss_account", "status",
];
export const VER_FIELD_LABEL = {
  name: "Name", description: "Description", category: "Category", serial_no: "Serial Number",
  subsidiary: "Subsidiary", type: "Type", method: "Method", rate: "Rate",
  duration_value: "Duration", duration_unit: "Duration Unit", computation: "Computation",
  acquisition_date: "Acquisition Date", asset_account: "Asset Account",
  depreciation_account: "Accumulated Depreciation Account", expense_account: "Expense Account",
  loss_account: "Loss on Disposal Account", status: "Status",
};

function snapshotData(asset) {
  const out = {};
  for (const k of VERSIONED_FIELDS) out[k] = asset[k];
  return out;
}
function seedVersions(assets) {
  const map = {};
  for (const a of assets) {
    map[a.id] = [{ versionId: `${a.asset_tag}·v1`, version: 1, origin: "created", at: a.updated || "2025-01-01", by: "Imported record", reason: "", changedFields: [], data: snapshotData(a) }];
  }
  return map;
}

function nextId(list) {
  const nums = list.map((a) => parseInt(String(a.id).replace(/[^0-9]/g, ""), 10)).filter((n) => !isNaN(n));
  return "AST" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0");
}
function nextTag(list) {
  const nums = list.map((a) => parseInt(String(a.asset_tag).replace(/[^0-9]/g, ""), 10)).filter((n) => !isNaN(n));
  return "FA-" + String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0");
}
const today = () => TODAY.toISOString().slice(0, 10);

export function AssetsProvider({ children }) {
  const [assets, setAssets] = useState(SEED_ASSETS);
  const [versions, setVersions] = useState(() => seedVersions(SEED_ASSETS));
  const [changeLog, setChangeLog] = useState({});
  const { closedThrough } = useClosePeriod();

  const logEvent = useCallback((id, action, detail, actor) => {
    setChangeLog((prev) => ({
      ...prev,
      [id]: [{ date: today(), actor: actor || "—", action, detail: detail || "" }, ...(prev[id] || [])],
    }));
  }, []);

  const pushVersion = useCallback((record, { origin, by, reason, changedFields }) => {
    setVersions((prev) => {
      const list = prev[record.id] || [];
      const n = list.length + 1;
      return {
        ...prev,
        [record.id]: [{ versionId: `${record.asset_tag}·v${n}`, version: n, origin, at: today(), by: by || "—", reason: reason || "", changedFields: changedFields || [], data: snapshotData(record) }, ...list],
      };
    });
  }, []);

  // The published read — every screen goes through this rather than calling
  // buildSchedule directly, so "posted through closedThrough" means the same
  // thing everywhere.
  const read = useCallback((asset) => {
    if (!asset) return null;
    const rows = buildSchedule(asset, { closedThrough });
    return summarizeSchedule(rows, { closedThrough });
  }, [closedThrough]);

  // Creation is ungated — lands directly in Running, mirroring Item Master's
  // create-lands-Active convention. There's no draft/clearing holding state
  // left to land in (that workflow doesn't exist in this design).
  const addAsset = useCallback((draft) => {
    const id = nextId(assets);
    const asset_tag = nextTag(assets);
    const record = {
      id, asset_tag,
      name: draft.name?.trim() || "Untitled asset",
      description: draft.description?.trim() || "",
      category: draft.category?.trim() || "",
      serial_no: draft.serial_no?.trim() || "",
      type: draft.type || "fixed_asset",
      subsidiary: draft.subsidiary || "PT Induk",
      first_value: Number(draft.first_value) || 0,
      acquisition_date: draft.acquisition_date || today(),
      method: draft.method || "straight_line",
      rate: draft.rate != null && draft.rate !== "" ? Number(draft.rate) : null,
      duration_value: Number(draft.duration_value) || 1,
      duration_unit: draft.duration_unit || "months",
      computation: draft.computation || "constant_period",
      status: "running",
      value_revisions: [], suspensions: [], cancellation: null, disposal: null,
      bills: draft.bills || [],
      notes: "", updated: today(),
    };
    setAssets((prev) => [record, ...prev]);
    pushVersion(record, { origin: "created", by: draft.actor, reason: "Asset created" });
    logEvent(id, "Created", "Running from creation", draft.actor);
    return record;
  }, [assets, logEvent, pushVersion]);

  // Identity edit. Every schedule-defining field goes through the bounded
  // flows below instead — a generic "edit" here on a locked field would make
  // §6's guarantees decorative.
  //
  // Category is in this list but is NOT a free edit: it resolves the GL
  // account set, so once a period has posted, categoryChangeGuard refuses it
  // (the posted value would have to be reclassified). The caller disables the
  // field; this is the backstop.
  const IDENTITY_FIELDS = ["name", "description", "category", "serial_no", "subsidiary", "notes"];
  const updateAsset = useCallback((id, patch, meta = {}) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return { changed: [] };
    if (patch.category && patch.category !== asset.category) {
      const guard = categoryChangeGuard(asset, summarizeSchedule(buildSchedule(asset, { closedThrough }), { closedThrough }));
      if (guard.blocked) return { changed: [], error: guard.reason };
    }
    const allowed = Object.keys(patch).filter((k) => IDENTITY_FIELDS.includes(k));
    const changed = allowed.filter((k) => (asset[k] || "") !== (patch[k] || ""));
    if (!changed.length) return { changed: [] };
    const versioned = changed.filter((k) => VERSIONED_FIELDS.includes(k));
    const next = { ...asset, ...Object.fromEntries(changed.map((k) => [k, patch[k]])), updated: today() };
    setAssets((prev) => prev.map((a) => (a.id === id ? next : a)));
    if (versioned.length) pushVersion(next, { origin: "changed", by: meta.actor, reason: meta.reason || "", changedFields: versioned });
    logEvent(id, "Updated", changed.map((k) => VER_FIELD_LABEL[k] || k).join(", "), meta.actor);
    return { changed };
  }, [assets, logEvent, pushVersion]);

  // Original-value revision (§6). The effective period is COMPUTED — the
  // first row the close hasn't reached — never typed. Refused below what's
  // already been released, because that would leave the asset over-released
  // and no re-spread fixes it (it's a reversal, not an edit).
  const previewValueRevision = useCallback((asset, newValue) => {
    const value = Number(newValue);
    if (!asset || !(value > 0)) return null;
    const rows = buildSchedule(asset, { closedThrough });
    const effective_period = firstOpenPeriod(rows, closedThrough);
    const tentative = { ...asset, value_revisions: [...asset.value_revisions, { effective_period, new_value: value }] };
    const previewRows = buildSchedule(tentative, { closedThrough });
    return summarizeSchedule(previewRows, { closedThrough });
  }, [closedThrough]);

  const reviseValue = useCallback((id, { newValue, reason, note, actor } = {}) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return { ok: false, error: "Asset not found." };
    if (!["running", "paused"].includes(asset.status)) {
      return { ok: false, error: "Only a running or paused asset's value can be revised." };
    }
    const value = Number(newValue);
    if (!(value > 0)) return { ok: false, error: "Enter a value greater than zero." };
    const current = read(asset);
    if (value < (current.accumulated || 0)) {
      return {
        ok: false,
        error: `Rp ${value.toLocaleString("id-ID")} is less than the Rp ${current.accumulated.toLocaleString("id-ID")} already released. That would leave the asset over-released — this needs a reversal, not a revision.`,
      };
    }
    const rows = buildSchedule(asset, { closedThrough });
    const effective_period = firstOpenPeriod(rows, closedThrough);
    console.assert(effective_period > closedThrough, "reviseValue: effective period must be strictly after closedThrough");
    const revision = { effective_period, new_value: value, reason: reason || "", note: note || "", by: actor || "—", at: today() };
    const next = { ...asset, value_revisions: [...asset.value_revisions, revision], updated: today() };
    setAssets((prev) => prev.map((a) => (a.id === id ? next : a)));
    logEvent(id, "Value revised", `${reason || "Revision"} — effective ${effective_period}`, actor);
    return { ok: true, revision };
  }, [assets, closedThrough, read, logEvent]);

  // running → paused. No charge accrues; duration extends by exactly the
  // paused span (buildSchedule). from_period is computed, never typed.
  const pauseAsset = useCallback((id, { reason, note, actor } = {}) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return { ok: false, error: "Asset not found." };
    if (asset.status !== "running") return { ok: false, error: "Only a running asset can be paused." };
    const rows = buildSchedule(asset, { closedThrough });
    const from_period = firstOpenPeriod(rows, closedThrough);
    console.assert(from_period > closedThrough, "pauseAsset: from_period must be strictly after closedThrough");
    const suspensions = [...asset.suspensions, { from_period, to_period: null, reason: reason || "Other", note: note || "", by: actor || "—" }];
    const next = { ...asset, status: "paused", suspensions, updated: today() };
    setAssets((prev) => prev.map((a) => (a.id === id ? next : a)));
    pushVersion(next, { origin: "changed", by: actor, reason: reason || "Paused", changedFields: ["status"] });
    logEvent(id, "Paused", `${reason || "Other"} — from ${from_period}`, actor);
    return { ok: true };
  }, [assets, closedThrough, logEvent, pushVersion]);

  // paused → running. Closes the open suspension at the current close, so
  // charges resume from the next open period — never mid-closed.
  const resumeAsset = useCallback((id, { actor } = {}) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return { ok: false, error: "Asset not found." };
    if (asset.status !== "paused") return { ok: false, error: "Only a paused asset can be resumed." };
    const suspensions = asset.suspensions.map((s, i, arr) => (i === arr.length - 1 && s.to_period == null ? { ...s, to_period: closedThrough } : s));
    const next = { ...asset, status: "running", suspensions, updated: today() };
    setAssets((prev) => prev.map((a) => (a.id === id ? next : a)));
    pushVersion(next, { origin: "changed", by: actor, reason: "Resumed", changedFields: ["status"] });
    logEvent(id, "Resumed", `Resumed from ${nextOpenLabel(asset, closedThrough)}`, actor);
    return { ok: true };
  }, [assets, closedThrough, logEvent, pushVersion]);

  // Mid-life stop (§7.5). NOT a disposal: posted journals stand, every
  // unposted future charge never happens, and whatever book value is left is
  // stranded and must be shown as such — never folded silently into a
  // disposal gain/loss it was never part of.
  const cancelAsset = useCallback((id, { reason, note, actor } = {}) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return { ok: false, error: "Asset not found." };
    if (!["running", "paused"].includes(asset.status)) {
      return { ok: false, error: "Only a running or paused asset can be cancelled." };
    }
    const rows = buildSchedule(asset, { closedThrough });
    const period = firstOpenPeriod(rows, closedThrough);
    console.assert(period > closedThrough, "cancelAsset: period must be strictly after closedThrough");
    const next = {
      ...asset, status: "cancelled",
      cancellation: { period, reason: reason || "Other", note: note || "", by: actor || "—", at: new Date().toISOString() },
      updated: today(),
    };
    setAssets((prev) => prev.map((a) => (a.id === id ? next : a)));
    pushVersion(next, { origin: "changed", by: actor, reason: reason || "Cancelled", changedFields: ["status"] });
    logEvent(id, "Cancelled", `${reason || "Other"} — ${period}`, actor);
    return { ok: true };
  }, [assets, closedThrough, logEvent, pushVersion]);

  // Disposal or sale (§7.4). Guarded: blocked into a closed period or more
  // than one period ahead of the last close. No charge posts in the disposal
  // period; gain/loss realises against book value as of the period before it.
  const disposeAsset = useCallback((id, { date, reason, proceeds, customer, document_ref, actor } = {}) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const targetPeriod = (date || today()).slice(0, 7);
    const guard = disposalGuard(asset, { targetPeriod, closedThrough });
    if (guard.blocked) return { ok: false, error: guard.reason };
    const disposalDate = date || today();
    const next = {
      ...asset, status: "disposed",
      disposal: { date: disposalDate, reason: reason || "Sold", proceeds: proceeds || 0, customer: customer || null, loss_account: asset.loss_account, document_ref: document_ref || null },
      updated: today(),
    };
    setAssets((prev) => prev.map((a) => (a.id === id ? next : a)));
    pushVersion(next, { origin: "changed", by: actor, reason: reason || "", changedFields: ["status"] });
    logEvent(id, "Disposed", `${next.disposal.reason} — ${disposalDate}`, actor);
    return { ok: true };
  }, [assets, closedThrough, logEvent, pushVersion]);

  // Bills history — every AP bill that fed this asset's cost, the original
  // purchase and any later capital additions/improvements (§7.6, PRD's OQ7
  // built toward "many": one asset may carry more than one bill).
  const addBill = useCallback((id, bill) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const next = { ...asset, bills: [...asset.bills, bill] };
    setAssets((prev) => prev.map((a) => (a.id === id ? next : a)));
    return { ok: true };
  }, [assets]);

  const assetById = useCallback((id) => assets.find((a) => a.id === id) || null, [assets]);
  const versionsOf = useCallback((id) => versions[id] || [], [versions]);

  const value = useMemo(() => ({
    assets, read, addAsset, updateAsset, reviseValue, previewValueRevision,
    pauseAsset, resumeAsset, cancelAsset, disposeAsset, addBill,
    assetById, versionsOf, changeLog, closedThrough,
    scheduleLocked: (asset) => scheduleLocked(asset, read(asset)),
    categoryChangeGuard: (asset) => categoryChangeGuard(asset, read(asset)),
    disposalGuard: (asset, opts) => disposalGuard(asset, { ...opts, closedThrough }),
  }), [assets, read, addAsset, updateAsset, reviseValue, previewValueRevision,
      pauseAsset, resumeAsset, cancelAsset, disposeAsset, addBill,
      assetById, versionsOf, changeLog, closedThrough]);
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

function nextOpenLabel(asset, closedThrough) {
  const rows = buildSchedule(asset, { closedThrough });
  return firstOpenPeriod(rows, closedThrough);
}

export function useAssets() {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error("useAssets must be used inside <AssetsProvider>");
  return ctx;
}
