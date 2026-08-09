import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { VENDORS as SEED_VENDORS } from "../data/seed/vendors";
import { seedTierFor, seedTierNoteFor } from "../data/seed/vendorTiers";
import { seedStatusFor, seedApprovalFor } from "../data/seed/vendorHealth";
import { TODAY } from "../lib/clock";

const VendorsContext = createContext(null);

// Our own (paying) bank account — the default company account bills to this
// vendor are settled FROM. Distinct from the vendor's own account (paid TO).
// Single house account for the prototype; stored per-vendor so it can diverge.
export const DEFAULT_COMPANY_BANK = {
  name: "BCA", branch: "KCU Sudirman", acc: "008-2233-4455", holder: "PT Klay Indonesia",
};

// Layer vendor-master attributes that live outside the auto-generated seed
// (relationship tier, lifecycle + approval status, paying account) onto each
// record so the vendor stays the single source of truth.
function withDerived(v) {
  const approval = v.approval || seedApprovalFor(v.id);
  return {
    ...v,
    // Entity type collapses to two kinds for MVP: company | individual.
    // (Cooperative / government are treated as companies — PKP, need faktur.)
    type: v.type === "individual" ? "individual" : "company",
    // Two independent status axes (see vendorHealth.js).
    status: seedStatusFor(v.id, v.status),        // lifecycle: active | inactive
    approval,                                      // approved | pending_approval
    // An approved vendor already has one frozen version (seeded below); a
    // pending one has never completed an approval cycle.
    current_version: v.current_version ?? (approval === "approved" ? 1 : 0),
    company_bank: v.company_bank || DEFAULT_COMPANY_BANK,
    relationship_tier: v.relationship_tier || seedTierFor(v.id),
    relationship_tier_note: v.relationship_tier_note || seedTierNoteFor(v.id),
    relationship_tier_set_by: v.relationship_tier_set_by || null,
    relationship_tier_set_at: v.relationship_tier_set_at || null,
  };
}

// Master-data fields whose creation or change requires a fresh approval cycle
// (SoD-sensitive: payee, tax identity, legal identity, and posting account).
// Any OTHER field (address, contact, notes, terms, currency, tier, company
// paying account…) is logged but does not gate.
export const APPROVAL_TRIGGER_FIELDS = ["legal_name", "tax_id", "pkp", "pph", "acct", "banks"];
export const APPROVAL_TRIGGER_LABEL = {
  legal_name: "Legal name", tax_id: "NPWP/NIK", pkp: "PKP status",
  pph: "Withholding", acct: "AP account", banks: "Vendor bank account",
};

// Fields captured in an approved-version snapshot — the vendor's complete
// business record at the moment an approval cycle completes.
const VERSIONED_FIELDS = [
  "code", "name", "legal_name", "type", "address",
  "tax_id", "pkp", "pph",
  "payment_terms", "currency", "acct",
  "banks", "company_bank",
  "contact", "contact_role", "email", "phone",
  "notes", "relationship_tier", "relationship_tier_note",
  "status", "approval",
];

// Deep, immutable copy of the versioned fields (banks/company_bank are cloned).
function snapshotData(vendor) {
  const out = {};
  for (const k of VERSIONED_FIELDS) {
    const val = vendor[k];
    out[k] = val && typeof val === "object" ? JSON.parse(JSON.stringify(val)) : val;
  }
  return out;
}

// Field-level diff between two snapshots — the keys whose values changed.
function diffFields(prev, next) {
  if (!prev) return [];
  return VERSIONED_FIELDS.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

// Seed v1 for every vendor that is already Approved, so the version history is
// populated on load. Pending vendors have no completed version yet.
function seedVersions(vendors) {
  const map = {};
  for (const v of vendors) {
    if (v.approval !== "approved") continue;
    map[v.id] = [{
      versionId: `${v.code}·v1`,
      version: 1,
      approvedAt: v.lastTx || "2025-01-01",
      approvedBy: "Imported record",
      reason: "",
      changedFields: [],
      data: snapshotData(v),
    }];
  }
  return map;
}

function nextId(list) {
  const nums = list
    .map((v) => parseInt(String(v.id).replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "V" + String(max + 1).padStart(3, "0");
}

function nextCode(list) {
  const nums = list
    .map((v) => parseInt(String(v.code || "").replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "V-" + String(max + 1).padStart(3, "0");
}

export function VendorsProvider({ children }) {
  const [vendors, setVendors] = useState(() => SEED_VENDORS.map(withDerived));
  // Frozen snapshots per vendor, newest-first — one per completed approval.
  const [versions, setVersions] = useState(() => seedVersions(SEED_VENDORS.map(withDerived)));

  const addVendor = useCallback((draft) => {
    const id = nextId(vendors);
    const code = draft.code?.trim() || nextCode(vendors);
    const record = {
      id,
      code,
      name: draft.name,
      legal_name: draft.legal_name || "",
      initials: draft.initials || "",
      contact: draft.contact || "",
      contact_role: draft.contact_role || "",
      phone: draft.phone || "",
      email: draft.email || "",
      address: draft.address || "",
      tax_id: draft.tax_id || "",
      payment_terms: draft.payment_terms || "NET 30",
      currency: draft.currency || "IDR",
      pkp: draft.pkp || "UNKNOWN",
      pph: draft.pph || "none",
      category: draft.category || "expense",
      type: draft.type || "company",
      // A new vendor is immediately Active (usable to create bills) but lands in
      // Pending approval — a manager signs it off (SoD: creator ≠ approver).
      status: "active",
      approval: "pending_approval",
      current_version: 0, // no completed approval cycle yet
      source: draft.source || "MANUAL",
      lastTx: null,
      notes: draft.notes || "",
      acct: draft.acct || "",
      defTax: draft.defTax || "",
      banks: draft.banks || [],
      company_bank: draft.company_bank || DEFAULT_COMPANY_BANK,
      relationship_tier: draft.relationship_tier || "standard",
      relationship_tier_note: draft.relationship_tier_note || "",
      relationship_tier_set_by: null,
      relationship_tier_set_at: null,
    };
    setVendors((prev) => [record, ...prev]);
    return record;
  }, [vendors]);

  // Set a vendor's relationship tier (PRD TP-02) — writes to the vendor record
  // so every surface that reads the vendor reflects it. Note is required.
  const setVendorTier = useCallback((id, tier, note, byName) => {
    setVendors((prev) => prev.map((v) => (
      v.id === id
        ? { ...v, relationship_tier: tier, relationship_tier_note: (note || "").slice(0, 200), relationship_tier_set_by: byName || null, relationship_tier_set_at: new Date().toISOString() }
        : v
    )));
  }, []);

  // In-session change log — vendorId → [{ts, actor, action, detail}], newest
  // first. Stands in for the PRD's append-only vendor_change_log.
  const [changeLog, setChangeLog] = useState({});
  const logEvent = useCallback((id, action, detail, actor) => {
    setChangeLog((prev) => ({
      ...prev,
      [id]: [{ ts: TODAY.toISOString(), actor: actor || "—", action, detail: detail || "" }, ...(prev[id] || [])],
    }));
  }, []);

  // LIFECYCLE axis — active ⇄ inactive only (Deactivate / Reactivate). Blocked
  // was dropped for MVP.
  const setVendorStatus = useCallback((id, status, meta = {}) => {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, status } : v)));
    logEvent(id, meta.event || "Status change", `→ ${status}${meta.reason ? ` · ${meta.reason}` : ""}`, meta.actor);
  }, [logEvent]);

  // APPROVAL axis — sign off (or bounce back) the current version of the record.
  // Independent of lifecycle: approving doesn't change active/inactive.
  // Completing an approval cycle (→ approved) FREEZES a new version snapshot.
  const setVendorApproval = useCallback((id, approval, meta = {}) => {
    if (approval === "approved") {
      const vendor = vendors.find((v) => v.id === id);
      if (vendor) {
        const prevList = versions[id] || [];
        const n = prevList.length + 1;
        const data = snapshotData({ ...vendor, approval: "approved" });
        const snap = {
          versionId: `${vendor.code}·v${n}`,
          version: n,
          approvedAt: TODAY.toISOString().slice(0, 10),
          approvedBy: meta.actor || "—",
          reason: meta.reason || "",
          changedFields: diffFields(prevList[0]?.data, data),
          data,
        };
        setVersions((prev) => ({ ...prev, [id]: [snap, ...(prev[id] || [])] }));
        setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, approval, current_version: n } : v)));
        logEvent(id, meta.event || "Approved", `${snap.versionId}${snap.changedFields.length ? ` · ${snap.changedFields.length} field(s) changed` : ""}`, meta.actor);
        return;
      }
    }
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, approval } : v)));
    logEvent(id, meta.event || (approval === "approved" ? "Approved" : "Pending approval"), meta.reason || "", meta.actor);
  }, [vendors, versions, logEvent]);

  // Set the vendor's payout bank account (single). A bank/payee change is a
  // sensitive change (banks ∈ APPROVAL_TRIGGER_FIELDS): it always bounces the
  // record back to Pending approval — an approver must confirm the new payee
  // before it can post/pay.
  const setVendorBank = useCallback((id, bank, meta = {}) => {
    setVendors((prev) => prev.map((v) => (
      v.id === id ? { ...v, banks: [{ ...bank, isDefault: true }], approval: "pending_approval" } : v
    )));
    const last4 = (bank.acc || "").replace(/\D/g, "").slice(-4);
    logEvent(id, "Bank / payee changed — pending approval", `${bank.name}${last4 ? ` ••••${last4}` : ""}`, meta.actor);
  }, [logEvent]);

  // Set the company (paying) bank account — the account we settle this vendor's
  // bills FROM. Single account. NOT approval-gated: it's our own account, not a
  // payee, so it's logged but doesn't start an approval cycle.
  const setCompanyBank = useCallback((id, bank, meta = {}) => {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, company_bank: { ...bank } } : v)));
    const last4 = (bank.acc || "").replace(/\D/g, "").slice(-4);
    logEvent(id, "Company bank account changed", `${bank.name}${last4 ? ` ••••${last4}` : ""}`, meta.actor);
  }, [logEvent]);

  // Generic vendor edit. Applies a field patch and, if any APPROVAL_TRIGGER_FIELD
  // changed, bounces the vendor back to Pending approval (SoD re-review of the
  // sensitive change). Non-gated edits are logged but leave approval untouched.
  const updateVendor = useCallback((id, patch, meta = {}) => {
    const vendor = vendors.find((v) => v.id === id);
    if (!vendor) return { changed: [], triggered: [] };
    const changed = Object.keys(patch).filter((k) => JSON.stringify(vendor[k]) !== JSON.stringify(patch[k]));
    const triggered = changed.filter((k) => APPROVAL_TRIGGER_FIELDS.includes(k));
    if (!changed.length) return { changed, triggered };
    setVendors((prev) => prev.map((v) => (
      v.id === id ? { ...v, ...patch, approval: triggered.length ? "pending_approval" : v.approval } : v
    )));
    if (triggered.length) {
      logEvent(id, "Sensitive change — pending approval", triggered.map((k) => APPROVAL_TRIGGER_LABEL[k] || k).join(", "), meta.actor);
    } else {
      logEvent(id, "Vendor updated", changed.map((k) => APPROVAL_TRIGGER_LABEL[k] || k).join(", "), meta.actor);
    }
    return { changed, triggered };
  }, [vendors, logEvent]);

  const vendorById = useCallback((id) => vendors.find((v) => v.id === id) || null, [vendors]);
  const tierOf = useCallback((id) => vendors.find((v) => v.id === id)?.relationship_tier || "standard", [vendors]);

  const versionsOf = useCallback((id) => versions[id] || [], [versions]);

  const value = useMemo(
    () => ({ vendors, addVendor, setVendorTier, setVendorStatus, setVendorApproval, setVendorBank, setCompanyBank, updateVendor, changeLog, versions, versionsOf, vendorById, tierOf }),
    [vendors, addVendor, setVendorTier, setVendorStatus, setVendorApproval, setVendorBank, setCompanyBank, updateVendor, changeLog, versions, versionsOf, vendorById, tierOf],
  );
  return <VendorsContext.Provider value={value}>{children}</VendorsContext.Provider>;
}

export function useVendors() {
  const ctx = useContext(VendorsContext);
  if (!ctx) throw new Error("useVendors must be used inside <VendorsProvider>");
  return ctx;
}
