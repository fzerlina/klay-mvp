import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { CUSTOMERS as SEED_CUSTOMERS } from "../data/seed/customers";
import { seedTierFor, seedTierNoteFor } from "../data/seed/customerTiers";
import { seedStatusFor, seedHealthFor } from "../data/seed/customerHealth";
import { TODAY } from "../lib/clock";

const CustomersContext = createContext(null);

// Layer customer-master attributes that live outside the auto-generated seed
// (relationship tier, lifecycle status, health signal) onto each record so the
// customer stays the single source of truth. Mirrors VendorsContext.withDerived.
// The seed carries a boolean `active`; we derive the 4-state lifecycle from it
// (+ overrides) and keep `active` in sync so any legacy reader still works.
function withDerived(c) {
  const status = seedStatusFor(c.id, c.active ? "active" : "inactive");
  return {
    ...c,
    status,
    active: status === "active",
    health: c.health || seedHealthFor(c.id),
    relationship_tier: c.relationship_tier || seedTierFor(c.id),
    relationship_tier_note: c.relationship_tier_note || seedTierNoteFor(c.id),
    relationship_tier_set_by: c.relationship_tier_set_by || null,
    relationship_tier_set_at: c.relationship_tier_set_at || null,
  };
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
  const [customers, setCustomers] = useState(() => SEED_CUSTOMERS.map(withDerived));

  const addCustomer = useCallback((draft) => {
    const id = nextId(customers);
    const code = draft.code?.trim() || nextCode(customers);
    const record = {
      id,
      code,
      type: draft.type,
      name: draft.name,
      legalName: draft.legalName || "",
      npwp: draft.npwp || "",
      pkp: draft.pkp || "UNKNOWN",
      top: draft.top || "NET 30",
      creditLimit: draft.creditLimit || 0,
      currency: draft.currency || "IDR",
      contacts: draft.contacts || [],
      address: draft.address || "",
      invMode: draft.invMode || "manual",
      invCh: draft.invCh || [],
      invSch: draft.invSch || "",
      reminder: draft.reminder || "",
      notes: draft.notes || "",
      ar: 0,
      arOverdue: false,
      lastInv: null,
      totalInv: 0,
      // Manual creation lands as a pending draft — an approver (Finance Manager /
      // Accounting Manager) confirms and activates it (SoD: creator ≠ activator).
      status: "pending",
      active: false,
      health: "healthy",
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

  // Move a customer through its lifecycle: pending → active (approve), active →
  // inactive (deactivate) or blocked (credit hold), blocked/inactive → active.
  const setCustomerStatus = useCallback((id, status, meta = {}) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, status, active: status === "active" } : c)));
    logEvent(id, meta.event || "Status change", `→ ${status}${meta.reason ? ` · ${meta.reason}` : ""}`, meta.actor);
  }, [logEvent]);

  // Manually set/override a customer's health signal (healthy | review | flagged).
  const setCustomerHealth = useCallback((id, health, meta = {}) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, health } : c)));
    logEvent(id, "Health set", `→ ${health}${meta.reason ? ` · ${meta.reason}` : ""}`, meta.actor);
  }, [logEvent]);

  const customerById = useCallback((id) => customers.find((c) => c.id === id) || null, [customers]);
  const tierOf = useCallback((id) => customers.find((c) => c.id === id)?.relationship_tier || "standard", [customers]);

  const value = useMemo(
    () => ({ customers, addCustomer, setCustomerTier, setCustomerStatus, setCustomerHealth, changeLog, customerById, tierOf }),
    [customers, addCustomer, setCustomerTier, setCustomerStatus, setCustomerHealth, changeLog, customerById, tierOf],
  );
  return <CustomersContext.Provider value={value}>{children}</CustomersContext.Provider>;
}

export function useCustomers() {
  const ctx = useContext(CustomersContext);
  if (!ctx) throw new Error("useCustomers must be used inside <CustomersProvider>");
  return ctx;
}
