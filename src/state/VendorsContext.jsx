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
  return {
    ...v,
    // Entity type collapses to two kinds for MVP: company | individual.
    // (Cooperative / government are treated as companies — PKP, need faktur.)
    type: v.type === "individual" ? "individual" : "company",
    // Two independent status axes (see vendorHealth.js).
    status: seedStatusFor(v.id, v.status),        // lifecycle: active | inactive
    approval: v.approval || seedApprovalFor(v.id), // approved | pending_approval
    company_bank: v.company_bank || DEFAULT_COMPANY_BANK,
    relationship_tier: v.relationship_tier || seedTierFor(v.id),
    relationship_tier_note: v.relationship_tier_note || seedTierNoteFor(v.id),
    relationship_tier_set_by: v.relationship_tier_set_by || null,
    relationship_tier_set_at: v.relationship_tier_set_at || null,
  };
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
  const setVendorApproval = useCallback((id, approval, meta = {}) => {
    setVendors((prev) => prev.map((v) => (v.id === id ? { ...v, approval } : v)));
    const label = approval === "approved" ? "Approved" : "Pending approval";
    logEvent(id, meta.event || label, meta.reason || "", meta.actor);
  }, [logEvent]);

  // Set the vendor's payout bank account (single). A bank/payee change is a
  // sensitive (Type-3) change: it always bounces the record back to Pending
  // approval — an approver must confirm the new payee before it can post/pay.
  const setVendorBank = useCallback((id, bank, meta = {}) => {
    setVendors((prev) => prev.map((v) => (
      v.id === id ? { ...v, banks: [{ ...bank, isDefault: true }], approval: "pending_approval" } : v
    )));
    const last4 = (bank.acc || "").replace(/\D/g, "").slice(-4);
    logEvent(id, "Bank / payee changed — pending approval", `${bank.name}${last4 ? ` ••••${last4}` : ""}`, meta.actor);
  }, [logEvent]);

  const vendorById = useCallback((id) => vendors.find((v) => v.id === id) || null, [vendors]);
  const tierOf = useCallback((id) => vendors.find((v) => v.id === id)?.relationship_tier || "standard", [vendors]);

  const value = useMemo(
    () => ({ vendors, addVendor, setVendorTier, setVendorStatus, setVendorApproval, setVendorBank, changeLog, vendorById, tierOf }),
    [vendors, addVendor, setVendorTier, setVendorStatus, setVendorApproval, setVendorBank, changeLog, vendorById, tierOf],
  );
  return <VendorsContext.Provider value={value}>{children}</VendorsContext.Provider>;
}

export function useVendors() {
  const ctx = useContext(VendorsContext);
  if (!ctx) throw new Error("useVendors must be used inside <VendorsProvider>");
  return ctx;
}
