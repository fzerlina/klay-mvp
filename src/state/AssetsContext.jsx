import { createContext, useContext, useMemo, useState, useRef, useCallback } from "react";
import { ASSETS as SEED_ASSETS, ASSET_CATEGORIES } from "../data/seed/fixedAssets";
import { TODAY } from "../lib/clock";
import { useClosePeriod } from "./ClosePeriodContext";
import {
  buildSchedule, summarizeSchedule, firstOpenPeriod, scheduleLocked, categoryChangeGuard,
  disposalGuard, capitaliseGuard, placeInServiceGuard, holdForSaleGuard, returnToServiceGuard,
  deactivateGuard, reactivateGuard, bookStatusLabel, operationalStatesForType,
  bookStatusTransitions, operationalEditable, depreciableValue,
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
//
// THE BOOK STATUS IS NEVER SET DIRECTLY. Every mutator below is a dated event
// that both moves the ledger and derives the new book status from what it did.
// There is deliberately no `setBookStatus`: a dropdown would let someone pick
// "In service" and silently start depreciation in a closed period, which is
// the exact failure §0.2 exists to prevent.
//
// `setOperationalStatus` is the opposite and says so: it writes one field,
// posts nothing, and is audited rather than versioned.

const AssetsContext = createContext(null);

// Versioned = governed, i.e. something a schedule could copy from. Note what
// is NOT here: `operational_status`. It cannot reach a financial figure, so
// freezing a snapshot for it would be ceremony — the audit trail is the right
// home for it.
const VERSIONED_FIELDS = [
  "name", "description", "category", "serial_no", "subsidiary", "type",
  "method", "rate", "duration_value", "duration_unit", "computation",
  "acquisition_date", "service_date", "salvage_value",
  "asset_account", "depreciation_account", "expense_account", "loss_account",
  "lifecycle", "book_status",
];
export const VER_FIELD_LABEL = {
  name: "Name", description: "Description", category: "Category", serial_no: "Serial Number",
  subsidiary: "Subsidiary", type: "Type", method: "Method", rate: "Rate",
  duration_value: "Duration", duration_unit: "Duration Unit", computation: "Computation",
  acquisition_date: "Acquisition Date", service_date: "In-Service Date",
  salvage_value: "Salvage Value",
  asset_account: "Asset Account",
  depreciation_account: "Accumulated Depreciation Account", expense_account: "Expense Account",
  loss_account: "Loss on Disposal Account",
  lifecycle: "Record Lifecycle", book_status: "Book Status",
  operational_status: "Operational Status",
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

  // Every mutator below reads and writes through this ref rather than the
  // `assets` closure. The Edit form applies up to four things in ONE save —
  // fields, operational status, a book event, a lifecycle change — and they
  // run in the same tick, before React has re-rendered. Reading the closure
  // meant each one derived its `next` from the state as it was when the
  // handler was created, so the last write silently clobbered the ones before
  // it: disposing an asset and archiving it together left it archived and NOT
  // disposed. The ref is updated synchronously on every write, so a chain sees
  // what the step before it did.
  const assetsRef = useRef(SEED_ASSETS);
  const findAsset = useCallback((id) => assetsRef.current.find((a) => a.id === id) || null, []);
  const writeAsset = useCallback((next) => {
    assetsRef.current = assetsRef.current.map((a) => (a.id === next.id ? next : a));
    setAssets(assetsRef.current);
  }, []);
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

  // Shared plumbing for every book event: append the dated record, version the
  // new book status, and log it.
  const applyBookEvent = useCallback((asset, { event, period, date, note, actor, patch, logAction, logDetail }) => {
    const next = {
      ...asset,
      ...patch,
      book_events: [...(asset.book_events || []), { date: date || today(), period, event, note: note || "", by: actor || "—" }],
      updated: today(),
    };
    writeAsset(next);
    pushVersion(next, { origin: "changed", by: actor, reason: note || "", changedFields: Object.keys(patch).filter((k) => VERSIONED_FIELDS.includes(k)) });
    logEvent(asset.id, logAction, logDetail, actor);
    return next;
  }, [writeAsset, logEvent, pushVersion]);

  // Creation is ungated. Where a new asset LANDS is now a choice rather than a
  // default: under construction, capitalized-not-in-service, or straight into
  // service with a date. Only the third builds a schedule.
  const addAsset = useCallback((draft) => {
    const id = nextId(assetsRef.current);
    const asset_tag = nextTag(assetsRef.current);
    const book_status = draft.book_status || "in_service";
    const service_date = book_status === "in_service" ? (draft.service_date || draft.acquisition_date || today()) : null;
    const record = {
      id, asset_tag,
      name: draft.name?.trim() || "Untitled asset",
      description: draft.description?.trim() || "",
      category: draft.category?.trim() || "",
      serial_no: draft.serial_no?.trim() || "",
      type: draft.type || "fixed_asset",
      subsidiary: draft.subsidiary || "PT Induk",
      first_value: Number(draft.first_value) || 0,
      salvage_value: Number(draft.salvage_value) || 0,
      acquisition_date: draft.acquisition_date || today(),
      service_date,
      method: draft.method || "straight_line",
      rate: draft.rate != null && draft.rate !== "" ? Number(draft.rate) : null,
      duration_value: Number(draft.duration_value) || 1,
      duration_unit: draft.duration_unit || "months",
      computation: draft.computation || "constant_period",
      lifecycle: "active",
      book_status,
      operational_status: draft.operational_status || null,
      value_revisions: [], holds: [], disposal: null,
      book_events: [{
        date: service_date || draft.acquisition_date || today(),
        period: (service_date || draft.acquisition_date || today()).slice(0, 7),
        event: book_status === "in_service" ? "placed_in_service" : "created",
        note: "Created", by: draft.actor || "—",
      }],
      bills: draft.bills || [],
      notes: "", updated: today(),
    };
    assetsRef.current = [record, ...assetsRef.current];
    setAssets(assetsRef.current);
    pushVersion(record, { origin: "created", by: draft.actor, reason: "Asset created" });
    logEvent(id, "Created", bookStatusLabel(record), draft.actor);
    return record;
  }, [findAsset, writeAsset, logEvent, pushVersion]);

  // Identity edit. Every schedule-defining field goes through the bounded
  // flows below instead — a generic "edit" here on a locked field would make
  // §6's guarantees decorative.
  //
  // Category is in this list but is NOT a free edit: it resolves the GL
  // account set, so once a period has posted, categoryChangeGuard refuses it
  // (the posted value would have to be reclassified). The caller disables the
  // field; this is the backstop.
  const IDENTITY_FIELDS = ["name", "description", "category", "serial_no", "subsidiary", "notes"];

  // PRD §0.10 always said these are editable until the first period posts and
  // frozen afterwards. Only the freeze was built; there was no field behind the
  // unlocked state, so a duration entered wrong on day one could never be
  // corrected — and with the pre-service book statuses an asset can now sit for
  // a year with nothing posted and no way to fix it.
  //
  // first_value is in this list, and that is what retires the pre-service value
  // revision: nothing has posted, so correcting the cost is an ordinary edit,
  // not a bounded revision against periods that do not exist.
  const SCHEDULE_FIELDS = [
    "first_value", "salvage_value", "acquisition_date", "service_date", "type",
    "method", "rate", "duration_value", "duration_unit", "computation",
  ];
  const updateAsset = useCallback((id, patch, meta = {}) => {
    const asset = findAsset(id);
    if (!asset) return { changed: [] };
    if (patch.category && patch.category !== asset.category) {
      const guard = categoryChangeGuard(asset, summarizeSchedule(buildSchedule(asset, { closedThrough }), { closedThrough }));
      if (guard.blocked) return { changed: [], error: guard.reason };
    }
    // The lock is the gate: once anything has posted, only identity fields get
    // through, and a caller that tries anyway is refused rather than ignored.
    const lock = scheduleLocked(asset, read(asset));
    const editable = lock.locked ? IDENTITY_FIELDS : [...IDENTITY_FIELDS, ...SCHEDULE_FIELDS];
    const attempted = Object.keys(patch).filter((k) => SCHEDULE_FIELDS.includes(k));
    if (lock.locked && attempted.length) return { changed: [], error: lock.reason };

    const allowed = Object.keys(patch).filter((k) => editable.includes(k));
    const changed = allowed.filter((k) => String(asset[k] ?? "") !== String(patch[k] ?? ""));
    if (!changed.length) return { changed: [] };
    const versioned = changed.filter((k) => VERSIONED_FIELDS.includes(k));
    const next = { ...asset, ...Object.fromEntries(changed.map((k) => [k, patch[k]])), updated: today() };

    // Type scopes both the category list and the operational states, so a type
    // change has to drop anything the new type cannot hold rather than leaving
    // an asset pointing at accounts and states that no longer apply.
    if (changed.includes("type")) {
      if (ASSET_CATEGORIES[next.category]?.type !== next.type) next.category = "";
      if (!operationalStatesForType(next.type).includes(next.operational_status)) next.operational_status = null;
    }
    writeAsset(next);
    if (versioned.length) pushVersion(next, { origin: "changed", by: meta.actor, reason: meta.reason || "", changedFields: versioned });
    logEvent(id, "Updated", changed.map((k) => VER_FIELD_LABEL[k] || k).join(", "), meta.actor);
    return { changed };
  }, [findAsset, writeAsset, closedThrough, read, logEvent, pushVersion]);

  // ── The operational axis ──────────────────────────────────────────────────
  // One field, no journal, no guard beyond "this record is active and this is
  // a fixed asset". It is allowed to contradict the book status; the
  // contradiction is surfaced (statusConflicts) rather than prevented, because
  // the fix for "in use but not in service" is a dated in-service event, not a
  // refusal to record what the warehouse can plainly see.
  const setOperationalStatus = useCallback((id, { status, note, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const allowed = operationalStatesForType(asset.type);
    if (!allowed.length) {
      return { ok: false, error: "This type has no operational axis — a prepaid is not on a floor." };
    }
    if (status && !allowed.includes(status)) {
      return { ok: false, error: `"${status}" is not a state this type can hold.` };
    }
    if (asset.operational_status === status) return { ok: true };
    const next = { ...asset, operational_status: status || null, updated: today() };
    writeAsset(next);
    logEvent(id, "Operational status", `${asset.operational_status || "—"} → ${status || "—"}${note ? ` · ${note}` : ""} (no ledger effect)`, actor);
    return { ok: true };
  }, [findAsset, writeAsset, logEvent]);

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
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    if (asset.lifecycle !== "active" || asset.book_status === "disposed") {
      return { ok: false, error: "Only an active, undisposed asset's value can be revised." };
    }
    // A revision is a correction bounded by what has already posted. With
    // nothing posted there is nothing to bound it against, and the effective
    // period it computes can land before the schedule even starts — where it
    // used to be dropped in silence. Below the first posting, the value is an
    // ordinary edit instead.
    if (!(read(asset)?.posted_periods > 0)) {
      return { ok: false, error: "Nothing has posted yet, so there is no history to protect. Edit the original value directly instead." };
    }
    const value = Number(newValue);
    if (!(value > 0)) return { ok: false, error: "Enter a value greater than zero." };
    const current = read(asset);
    if (depreciableValue(value, asset.salvage_value) < (current.accumulated || 0)) {
      const salvageNote = Number(asset.salvage_value) > 0
        ? ` (Rp ${Number(asset.salvage_value).toLocaleString("id-ID")} of that is salvage and is never released.)`
        : "";
      return {
        ok: false,
        error: `Rp ${value.toLocaleString("id-ID")} leaves less to release than the Rp ${current.accumulated.toLocaleString("id-ID")} already released.${salvageNote} That would leave the asset over-released — this needs a reversal, not a revision.`,
      };
    }
    const rows = buildSchedule(asset, { closedThrough });
    const effective_period = firstOpenPeriod(rows, closedThrough);
    console.assert(effective_period > closedThrough, "reviseValue: effective period must be strictly after closedThrough");
    const revision = { effective_period, new_value: value, reason: reason || "", note: note || "", by: actor || "—", at: today() };
    const next = { ...asset, value_revisions: [...asset.value_revisions, revision], updated: today() };
    writeAsset(next);
    logEvent(id, "Value revised", `${reason || "Revision"} — effective ${effective_period}`, actor);
    return { ok: true, revision };
  }, [findAsset, writeAsset, closedThrough, read, logEvent]);

  // ── Book events ───────────────────────────────────────────────────────────

  // under_construction → capitalized_not_in_service. Cost leaves CIP for the
  // category's asset account. Effective period computed, never typed.
  const capitaliseAsset = useCallback((id, { note, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const guard = capitaliseGuard(asset);
    if (guard.blocked) return { ok: false, error: guard.reason };
    const period = firstOpenPeriod(buildSchedule(asset, { closedThrough }), closedThrough);
    console.assert(period > closedThrough, "capitaliseAsset: period must be strictly after closedThrough");
    applyBookEvent(asset, {
      event: "capitalized", period, note, actor,
      patch: { book_status: "capitalized_not_in_service" },
      logAction: "Capitalized", logDetail: `Cost moved out of CIP — ${period}`,
    });
    return { ok: true };
  }, [findAsset, closedThrough, applyBookEvent]);

  // → in_service. The one event that takes a real date rather than a computed
  // period, because the date IS the schedule's start — and it is guarded into
  // an open period for exactly that reason.
  const placeInService = useCallback((id, { date, note, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const serviceDate = date || today();
    const targetPeriod = serviceDate.slice(0, 7);
    const guard = placeInServiceGuard(asset, { targetPeriod, closedThrough });
    if (guard.blocked) return { ok: false, error: guard.reason };
    applyBookEvent(asset, {
      event: "placed_in_service", period: targetPeriod, date: serviceDate, note, actor,
      patch: { book_status: "in_service", service_date: serviceDate },
      logAction: "Placed in service", logDetail: `Schedule starts ${targetPeriod}`,
    });
    return { ok: true };
  }, [findAsset, closedThrough, applyBookEvent]);

  // in_service → held_for_sale. Reclassified out of PPE; the charge stops and
  // the duration extends by the length of the hold (buildSchedule). This is
  // the ONLY non-terminal stop — "idle" and "under repair" are operational and
  // do nothing, which is what PSAK 16 requires.
  const holdForSale = useCallback((id, { reason, note, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const guard = holdForSaleGuard(asset);
    if (guard.blocked) return { ok: false, error: guard.reason };
    const from_period = firstOpenPeriod(buildSchedule(asset, { closedThrough }), closedThrough);
    console.assert(from_period > closedThrough, "holdForSale: from_period must be strictly after closedThrough");
    const holds = [...asset.holds, { from_period, to_period: null, reason: reason || "Other", note: note || "", by: actor || "—" }];
    applyBookEvent(asset, {
      event: "held_for_sale", period: from_period, note: note || reason, actor,
      patch: { book_status: "held_for_sale", holds },
      logAction: "Reclassified — held for sale", logDetail: `${reason || "Other"} — from ${from_period}`,
    });
    return { ok: true };
  }, [findAsset, closedThrough, applyBookEvent]);

  // held_for_sale → in_service. Closes the open hold at the current close, so
  // charges resume from the next open period — never mid-closed.
  const returnToService = useCallback((id, { note, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const guard = returnToServiceGuard(asset);
    if (guard.blocked) return { ok: false, error: guard.reason };
    const holds = asset.holds.map((h, i, arr) => (i === arr.length - 1 && h.to_period == null ? { ...h, to_period: closedThrough } : h));
    const resumesAt = firstOpenPeriod(buildSchedule(asset, { closedThrough }), closedThrough);
    applyBookEvent(asset, {
      event: "returned_to_service", period: resumesAt, note, actor,
      patch: { book_status: "in_service", holds },
      logAction: "Returned to service", logDetail: `Charges resume from ${resumesAt}`,
    });
    return { ok: true };
  }, [findAsset, closedThrough, applyBookEvent]);

  // The lifecycle axis. Inactive means "out of play" — reached either because
  // the record was entered in error (nothing ever posted) or because it is
  // settled and being archived out of the working register. Never reachable
  // while the asset is still depreciating; that guard is what keeps the state
  // from becoming a way to hide a live schedule.
  //
  // Unlike a disposal it moves no value and posts no journal, and unlike a
  // disposal it is reversible.
  const deactivateAsset = useCallback((id, { reason, note, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const guard = deactivateGuard(asset, read(asset));
    if (guard.blocked) return { ok: false, error: guard.reason };
    applyBookEvent(asset, {
      event: "deactivated", period: today().slice(0, 7), note: note || reason, actor,
      patch: {
        lifecycle: "inactive",
        operational_status: null,
        inactivation: { reason: reason || "Other", note: note || "", by: actor || "—", at: today() },
      },
      logAction: "Made inactive", logDetail: reason || "Other",
    });
    return { ok: true };
  }, [findAsset, read, applyBookEvent]);

  const reactivateAsset = useCallback((id, { note, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const guard = reactivateGuard(asset);
    if (guard.blocked) return { ok: false, error: guard.reason };
    applyBookEvent(asset, {
      event: "reactivated", period: today().slice(0, 7), note, actor,
      patch: { lifecycle: "active", inactivation: null },
      logAction: "Reactivated", logDetail: "Back in the working register",
    });
    return { ok: true };
  }, [findAsset, applyBookEvent]);

  // Disposal or sale (§7.4). Guarded: blocked into a closed period or more
  // than one period ahead of the last close. No charge posts in the disposal
  // period; gain/loss realises against book value as of the period before it.
  // The operational status is cleared: an asset that is off the balance sheet
  // is not idle or in transit, it is gone.
  const disposeAsset = useCallback((id, { date, reason, proceeds, customer, document_ref, actor } = {}) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const disposalDate = date || today();
    const targetPeriod = disposalDate.slice(0, 7);
    const guard = disposalGuard(asset, { targetPeriod, closedThrough });
    if (guard.blocked) return { ok: false, error: guard.reason };
    applyBookEvent(asset, {
      event: "disposed", period: targetPeriod, date: disposalDate, note: reason, actor,
      patch: {
        book_status: "disposed",
        operational_status: null,
        disposal: { date: disposalDate, reason: reason || "Sold", proceeds: proceeds || 0, customer: customer || null, loss_account: asset.loss_account, document_ref: document_ref || null },
      },
      logAction: "Disposed", logDetail: `${reason || "Sold"} — ${disposalDate}`,
    });
    return { ok: true };
  }, [findAsset, closedThrough, applyBookEvent]);

  // Bills history — every AP bill that fed this asset's cost, the original
  // purchase and any later capital additions/improvements (§7.6, PRD's OQ7
  // built toward "many": one asset may carry more than one bill).
  const addBill = useCallback((id, bill) => {
    const asset = findAsset(id);
    if (!asset) return { ok: false, error: "Asset not found." };
    const next = { ...asset, bills: [...asset.bills, bill] };
    writeAsset(next);
    return { ok: true };
  }, [findAsset, writeAsset]);

  const assetById = useCallback((id) => assets.find((a) => a.id === id) || null, [assets]);
  const versionsOf = useCallback((id) => versions[id] || [], [versions]);

  const value = useMemo(() => ({
    assets, read, addAsset, updateAsset, reviseValue, previewValueRevision,
    setOperationalStatus,
    capitaliseAsset, placeInService, holdForSale, returnToService,
    deactivateAsset, reactivateAsset, disposeAsset, addBill,
    assetById, versionsOf, changeLog, closedThrough,
    scheduleLocked: (asset) => scheduleLocked(asset, read(asset)),
    categoryChangeGuard: (asset) => categoryChangeGuard(asset, read(asset)),
    disposalGuard: (asset, opts) => disposalGuard(asset, { ...opts, closedThrough }),
    placeInServiceGuard: (asset, opts) => placeInServiceGuard(asset, { ...opts, closedThrough }),
    capitaliseGuard, holdForSaleGuard, returnToServiceGuard, reactivateGuard, operationalEditable,
    bookStatusTransitions: (asset) => bookStatusTransitions(asset, { closedThrough }),
    deactivateGuard: (asset) => deactivateGuard(asset, read(asset)),
  }), [assets, read, addAsset, updateAsset, reviseValue, previewValueRevision,
      setOperationalStatus, capitaliseAsset, placeInService, holdForSale, returnToService,
      deactivateAsset, reactivateAsset, disposeAsset, addBill,
      assetById, versionsOf, changeLog, closedThrough]);
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

export function useAssets() {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error("useAssets must be used inside <AssetsProvider>");
  return ctx;
}
