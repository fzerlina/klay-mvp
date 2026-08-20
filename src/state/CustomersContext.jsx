import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { CUSTOMERS as SEED_CUSTOMERS } from "../data/seed/customers";
import { seedTierFor, seedTierNoteFor } from "../data/seed/customerTiers";
import { seedStatusFor, seedApprovalFor, seedHoldFor } from "../data/seed/customerHealth";
import { TODAY } from "../lib/clock";

const CustomersContext = createContext(null);

// Our house RECEIVING account — the account customers pay INTO. Single company
// account for the prototype; stored per-customer so it can diverge. There is no
// customer-owned payee account on the AR side (mirror of vendor company_bank).
export const DEFAULT_COMPANY_BANK = {
  name: "BCA", branch: "KCU Sudirman", acc: "008-2233-4455", holder: "PT Klay Indonesia",
};

// AR control-account shortlist (mirrors the AP account list in labels.js).
export const AR_ACCT_LABELS = {
  "1-1200": "1-1200 · Accounts Receivable (default)",
  "1-1210": "1-1210 · AR — Trade",
  "1-1220": "1-1220 · AR — Retail",
};

// Ship-to resolution. An empty shippingAddress means "ships to the billing
// address" — the fallback lives here so no surface re-implements it.
export function shipsToBilling(c) { return !(c?.shippingAddress || "").trim(); }
export function shipToAddress(c) {
  return (c?.shippingAddress || "").trim() || (c?.address || "").trim();
}

// Freshly-onboarded Draft customers (no transaction history). Lifecycle = Draft:
// not usable on invoices until submitted → Active. Kept as their own seed so the
// Draft tab is populated without faking history on transacted customers.
const SEED_DRAFTS = [
  { id: "C081", code: "C-081", type: "perusahaan", name: "PT Sinar Niaga Sejahtera", legalName: "PT Sinar Niaga Sejahtera", npwp: "92.345.678.9-021.000", pph: "none", top: "NET 30", creditLimit: 75000000, currency: "IDR", contacts: [{ name: "Dwi Lestari", title: "Finance", phone: "+62-21-5550-7788", email: "finance@sinarniaga.id", emailFin: "", primary: true }], address: "Jl. Gatot Subroto No. 45, Jakarta 12930", invMode: "manual", invCh: ["Email"], invSch: "", reminder: "", notes: "New onboarding — awaiting submit for approval.", ar: 0, arOverdue: false, lastInv: null, totalInv: 0, status: "draft", approval: "pending_approval", current_version: 0, on_hold: false, hold_reason: "", acct: "1-1200", source: "MANUAL", relationship_tier: "standard" },
  { id: "C082", code: "C-082", type: "individu", name: "Bella Anjani", legalName: "", npwp: "", pph: "pph21", top: "COD", creditLimit: 0, currency: "IDR", contacts: [{ name: "Bella Anjani", title: "—", phone: "+62-812-5550-2211", email: "bella.anjani@gmail.com", emailFin: "", primary: true }], address: "Jl. Kemang Raya No. 21, Jakarta Selatan 12730", invMode: "manual", invCh: [], invSch: "", reminder: "", notes: "", ar: 0, arOverdue: false, lastInv: null, totalInv: 0, status: "draft", approval: "pending_approval", current_version: 0, on_hold: false, hold_reason: "", acct: "1-1200", source: "MANUAL", relationship_tier: "standard" },
];

// Layer customer-master attributes that live outside the auto-generated seed
// (lifecycle + approval status, credit hold, receiving account, relationship
// tier) onto each record so the customer stays the single source of truth.
// Mirrors VendorsContext.withDerived. The seed carries a boolean `active`; we
// derive the lifecycle from it (+ overrides) and keep `active` in sync.
function withDerived(c) {
  // Entity type collapses to two kinds: perusahaan (company) | individu.
  const type = c.type === "individu" ? "individu" : "perusahaan";
  const status = seedStatusFor(c.id, c.status || (c.active ? "active" : "inactive"));
  const approval = c.approval || seedApprovalFor(c.id);
  const holdSeed = seedHoldFor(c.id);
  return {
    ...c,
    type,
    // Withholding: Individual is always PPh 21 at a rate set per customer;
    // Company picks PPh 23 or PPh 4(2), whose rate resolves from NPWP presence.
    pph: c.pph || (type === "individu" ? "pph21" : "none"),
    pph21Rate: c.pph21Rate ?? (type === "individu" ? 5 : null),
    status,                                         // lifecycle: draft | active | inactive
    active: status === "active",
    approval,                                       // approved | pending_approval
    // An approved customer already has one frozen version (seeded below); a
    // pending one has never completed an approval cycle.
    current_version: c.current_version ?? (approval === "approved" ? 1 : 0),
    // Credit hold is an independent flag layered from the seed override.
    on_hold: c.on_hold ?? !!holdSeed,
    hold_reason: c.hold_reason || holdSeed || "",
    // AR accounts: a permitted set plus the default an invoice starts on.
    // Legacy records carry a single `acct` — migrate it into the set.
    accts: c.accts || [c.acct || "1-1200"],
    defaultAcct: c.defaultAcct || c.acct || "1-1200",
    company_bank: c.company_bank || DEFAULT_COMPANY_BANK,
    relationship_tier: c.relationship_tier || seedTierFor(c.id),
    relationship_tier_note: c.relationship_tier_note || seedTierNoteFor(c.id),
    relationship_tier_set_by: c.relationship_tier_set_by || null,
    relationship_tier_set_at: c.relationship_tier_set_at || null,
  };
}

// Master-data fields whose creation or change requires a fresh approval cycle
// (SoD-sensitive: legal identity, tax identity, credit exposure, where the
// goods go, posting accounts, terms). Mirrors the Vendor trigger set on the AR
// side. Any OTHER field (contacts, notes, currency, tier, receiving account…)
// is logged but does not gate.
export const CUSTOMER_APPROVAL_TRIGGER_FIELDS = [
  "legalName", "npwp", "pph", "pph21Rate", "creditLimit", "top",
  "address", "shippingAddress", "accts", "defaultAcct",
];
export const CUSTOMER_APPROVAL_TRIGGER_LABEL = {
  legalName: "Legal name", npwp: "NPWP/NIK", pph: "Withholding", pph21Rate: "PPh 21 rate",
  creditLimit: "Credit limit", top: "Payment terms",
  address: "Billing address", shippingAddress: "Shipping address",
  accts: "AR accounts", defaultAcct: "Default AR account",
};

// Fields captured in an approved-version snapshot — the customer's complete
// business record at the moment an approval cycle completes.
const VERSIONED_FIELDS = [
  "code", "name", "legalName", "type", "address", "shippingAddress",
  "npwp", "pph", "pph21Rate",
  "top", "currency", "creditLimit", "accts", "defaultAcct",
  "company_bank", "contacts",
  "notes", "relationship_tier", "relationship_tier_note",
  "status", "approval",
];

// Deep, immutable copy of the versioned fields (objects/arrays are cloned).
function snapshotData(customer) {
  const out = {};
  for (const k of VERSIONED_FIELDS) {
    const val = customer[k];
    out[k] = val && typeof val === "object" ? JSON.parse(JSON.stringify(val)) : val;
  }
  return out;
}

// Field-level diff between two snapshots — the keys whose values changed.
function diffFields(prev, next) {
  if (!prev) return [];
  return VERSIONED_FIELDS.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

// Seed v1 for every customer that is already Approved, so the version history is
// populated on load. Pending customers have no completed version yet.
function seedVersions(customers) {
  const map = {};
  for (const c of customers) {
    if (c.approval !== "approved") continue;
    map[c.id] = [{
      versionId: `${c.code}·v1`,
      version: 1,
      approvedAt: c.lastInv || "2025-01-01",
      approvedBy: "Imported record",
      reason: "",
      changedFields: [],
      data: snapshotData(c),
    }];
  }
  return map;
}

function nextId(list) {
  const nums = list
    .map((c) => parseInt(String(c.id).replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "C" + String(max + 1).padStart(3, "0");
}

function nextCode(list) {
  const nums = list
    .map((c) => parseInt(String(c.code || "").replace(/[^0-9]/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return "C-" + String(max + 1).padStart(3, "0");
}

export function CustomersProvider({ children }) {
  const [customers, setCustomers] = useState(() => [...SEED_DRAFTS, ...SEED_CUSTOMERS].map(withDerived));
  // Frozen snapshots per customer, newest-first — one per completed approval.
  const [versions, setVersions] = useState(() => seedVersions([...SEED_DRAFTS, ...SEED_CUSTOMERS].map(withDerived)));

  const addCustomer = useCallback((draft) => {
    const id = nextId(customers);
    const code = draft.code?.trim() || nextCode(customers);
    const type = draft.type === "individu" ? "individu" : "perusahaan";
    const record = {
      id,
      code,
      type,
      name: draft.name,
      legalName: draft.legalName || "",
      npwp: draft.npwp || "",
      pph: draft.pph || (type === "individu" ? "pph21" : "none"),
      top: draft.top || "NET 30",
      creditLimit: draft.creditLimit || 0,
      currency: draft.currency || "IDR",
      contacts: draft.contacts || [],
      address: draft.address || "",
      // Empty shipping address = ships to the billing address (the common case).
      // Every surface renders the fallback rather than duplicating the string.
      shippingAddress: draft.shippingAddress || "",
      invMode: draft.invMode || "manual",
      invCh: draft.invCh || [],
      invSch: draft.invSch || "",
      reminder: draft.reminder || "",
      notes: draft.notes || "",
      ar: 0,
      arOverdue: false,
      lastInv: null,
      totalInv: 0,
      pph21Rate: draft.pph21Rate ?? null,
      accts: draft.accts?.length ? draft.accts : [draft.defaultAcct || "1-1200"],
      defaultAcct: draft.defaultAcct || draft.accts?.[0] || "1-1200",
      company_bank: draft.company_bank || DEFAULT_COMPANY_BANK,
      // A new customer is created as a Draft — not usable on invoices. The
      // onboarder Submits it (→ Active), then a manager approves it (SoD:
      // creator ≠ approver) before it can post.
      status: "draft",
      active: false,
      approval: "pending_approval",
      current_version: 0, // no completed approval cycle yet
      on_hold: false,
      hold_reason: "",
      source: draft.source || "MANUAL",
      relationship_tier: draft.relationship_tier || "standard",
      relationship_tier_note: draft.relationship_tier_note || "",
      relationship_tier_set_by: null,
      relationship_tier_set_at: null,
    };
    setCustomers((prev) => [record, ...prev]);
    return record;
  }, [customers]);

  // Set a customer's relationship tier — writes to the customer record so every
  // surface reflects it. Note is required (captured for the change log).
  const setCustomerTier = useCallback((id, tier, note, byName) => {
    setCustomers((prev) => prev.map((c) => (
      c.id === id
        ? { ...c, relationship_tier: tier, relationship_tier_note: (note || "").slice(0, 200), relationship_tier_set_by: byName || null, relationship_tier_set_at: new Date().toISOString() }
        : c
    )));
  }, []);

  // In-session change log — customerId → [{ts, actor, action, detail}], newest
  // first. Stands in for an append-only customer_change_log.
  const [changeLog, setChangeLog] = useState({});
  const logEvent = useCallback((id, action, detail, actor) => {
    setChangeLog((prev) => ({
      ...prev,
      [id]: [{ ts: TODAY.toISOString(), actor: actor || "—", action, detail: detail || "" }, ...(prev[id] || [])],
    }));
  }, []);

  // LIFECYCLE axis — active ⇄ inactive (Deactivate / Reactivate). Draft → active
  // is handled by submitCustomer.
  const setCustomerStatus = useCallback((id, status, meta = {}) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, status, active: status === "active" } : c)));
    logEvent(id, meta.event || "Status change", `→ ${status}${meta.reason ? ` · ${meta.reason}` : ""}`, meta.actor);
  }, [logEvent]);

  // Submit a Draft for approval — lifecycle Draft → Active. The customer becomes
  // usable to CREATE invoices; approval stays Pending until a manager signs off
  // (posting blocked until then). Maker action (creator, not approver).
  const submitCustomer = useCallback((id, meta = {}) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, status: "active", active: true } : c)));
    logEvent(id, "Submitted for approval", "Draft → Active", meta.actor);
  }, [logEvent]);

  // Reject a pending customer. A never-approved one (no version) returns to Draft
  // for the maker to revise; a pending change on an already-approved customer is
  // discarded (approval reverts to Approved, current version stands).
  const rejectCustomer = useCallback((id, meta = {}) => {
    setCustomers((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      return (c.current_version || 0) === 0
        ? { ...c, status: "draft", active: false }
        : { ...c, approval: "approved" };
    }));
    const customer = customers.find((c) => c.id === id);
    const backToDraft = (customer?.current_version || 0) === 0;
    logEvent(id, backToDraft ? "Rejected — returned to Draft" : "Change rejected", meta.reason || "", meta.actor);
  }, [customers, logEvent]);

  // APPROVAL axis — sign off (or bounce back) the current version of the record.
  // Independent of lifecycle. Completing an approval cycle (→ approved) FREEZES a
  // new version snapshot.
  const setCustomerApproval = useCallback((id, approval, meta = {}) => {
    if (approval === "approved") {
      const customer = customers.find((c) => c.id === id);
      if (customer) {
        const prevList = versions[id] || [];
        const n = prevList.length + 1;
        const data = snapshotData({ ...customer, approval: "approved" });
        const snap = {
          versionId: `${customer.code}·v${n}`,
          version: n,
          approvedAt: TODAY.toISOString().slice(0, 10),
          approvedBy: meta.actor || "—",
          reason: meta.reason || "",
          changedFields: diffFields(prevList[0]?.data, data),
          data,
        };
        setVersions((prev) => ({ ...prev, [id]: [snap, ...(prev[id] || [])] }));
        setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, approval, current_version: n } : c)));
        logEvent(id, meta.event || "Approved", `${snap.versionId}${snap.changedFields.length ? ` · ${snap.changedFields.length} field(s) changed` : ""}`, meta.actor);
        return;
      }
    }
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, approval } : c)));
    logEvent(id, meta.event || (approval === "approved" ? "Approved" : "Pending approval"), meta.reason || "", meta.actor);
  }, [customers, versions, logEvent]);

  // Credit hold — an independent flag on top of lifecycle. Approver-gated
  // (ar.post). Setting it doesn't change the lifecycle; releasing clears the
  // reason. Not approval-gated (it's a control action, not a master-data change).
  const setCustomerHold = useCallback((id, onHold, meta = {}) => {
    setCustomers((prev) => prev.map((c) => (
      c.id === id ? { ...c, on_hold: onHold, hold_reason: onHold ? (meta.reason || "") : "" } : c
    )));
    logEvent(id, onHold ? "Placed on credit hold" : "Credit hold released", meta.reason || "", meta.actor);
  }, [logEvent]);

  // Set the company (receiving) bank account — the account this customer pays
  // INTO. Single account. NOT approval-gated: it's our own account, so it's
  // logged but doesn't start an approval cycle. Manager action.
  const setCompanyBank = useCallback((id, bank, meta = {}) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, company_bank: { ...bank } } : c)));
    const last4 = (bank.acc || "").replace(/\D/g, "").slice(-4);
    logEvent(id, "Receiving account changed", `${bank.name}${last4 ? ` ••••${last4}` : ""}`, meta.actor);
  }, [logEvent]);

  // Generic customer edit. Applies a field patch and, if any
  // CUSTOMER_APPROVAL_TRIGGER_FIELD changed, bounces the customer back to Pending
  // approval (SoD re-review). Non-gated edits are logged but leave approval alone.
  const updateCustomer = useCallback((id, patch, meta = {}) => {
    const customer = customers.find((c) => c.id === id);
    if (!customer) return { changed: [], triggered: [] };
    const changed = Object.keys(patch).filter((k) => JSON.stringify(customer[k]) !== JSON.stringify(patch[k]));
    const triggered = changed.filter((k) => CUSTOMER_APPROVAL_TRIGGER_FIELDS.includes(k));
    if (!changed.length) return { changed, triggered };
    setCustomers((prev) => prev.map((c) => (
      c.id === id ? { ...c, ...patch, approval: triggered.length ? "pending_approval" : c.approval } : c
    )));
    if (triggered.length) {
      logEvent(id, "Sensitive change — pending approval", triggered.map((k) => CUSTOMER_APPROVAL_TRIGGER_LABEL[k] || k).join(", "), meta.actor);
    } else {
      logEvent(id, "Customer updated", changed.map((k) => CUSTOMER_APPROVAL_TRIGGER_LABEL[k] || k).join(", "), meta.actor);
    }
    return { changed, triggered };
  }, [customers, logEvent]);

  const customerById = useCallback((id) => customers.find((c) => c.id === id) || null, [customers]);
  const tierOf = useCallback((id) => customers.find((c) => c.id === id)?.relationship_tier || "standard", [customers]);
  const versionsOf = useCallback((id) => versions[id] || [], [versions]);

  const value = useMemo(
    () => ({ customers, addCustomer, setCustomerTier, setCustomerStatus, submitCustomer, rejectCustomer, setCustomerApproval, setCustomerHold, setCompanyBank, updateCustomer, changeLog, versions, versionsOf, customerById, tierOf }),
    [customers, addCustomer, setCustomerTier, setCustomerStatus, submitCustomer, rejectCustomer, setCustomerApproval, setCustomerHold, setCompanyBank, updateCustomer, changeLog, versions, versionsOf, customerById, tierOf],
  );
  return <CustomersContext.Provider value={value}>{children}</CustomersContext.Provider>;
}

export function useCustomers() {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used inside <CustomersProvider>");
  return ctx;
}
