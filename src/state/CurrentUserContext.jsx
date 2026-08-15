import { createContext, useContext, useMemo, useState } from "react";
import {
  USERS,
  ROLE_CAPS,
  LEVELS,
  MODULES,
  VERBS,
  legacyLevel,
  effectiveCapabilities,
} from "../data/seed/roles";

// Who is "logged in" for the prototype. A visible persona switcher (sidebar)
// flips this so a demo can show how the app changes per role. Everything that
// gates UI reads from here.
//
// The permission model is CAPABILITIES (discrete verbs per module, PRD §4.1).
// The context exposes two shapes, matching the PRD's seam:
//   • authorize/hasCapability — the point check ("may this user do X?")
//   • hasLevel/level/can      — the legacy ordinal shim, DERIVED from the same
//                               capabilities so existing pages keep working.

const CurrentUserContext = createContext(null);

// Union of a user's capabilities per module → { moduleKey: Set(verbs) }. Absent
// module = empty set. `full` expands to every verb on that module.
export function capabilitiesByModule(roleKeys = [], extraCaps = []) {
  const acc = {};
  for (const m of MODULES) acc[m.key] = new Set();
  const addVerb = (module, cap) => {
    if (!acc[module]) acc[module] = new Set();
    if (cap === "full") for (const v of VERBS) acc[module].add(v);
    else acc[module].add(cap);
  };
  for (const rk of roleKeys) {
    const mods = ROLE_CAPS[rk] || {};
    for (const [m, caps] of Object.entries(mods)) {
      for (const c of caps) {
        if (VERBS.includes(c)) addVerb(m, c);
        else {
          // Named capability — record it on its module bucket too so the module
          // reads as reachable (e.g. AP Staff's vendor.create keeps `ap` non-none).
          if (!acc[m]) acc[m] = new Set();
          acc[m].add(c);
        }
      }
    }
  }
  // Per-user extra caps (e.g. an explicit per-entity bank.reconcile grant). Ids
  // are canonical: "<module>.<verb>" or a bare named cap → drop onto the module.
  for (const c of extraCaps) {
    const dot = c.indexOf(".");
    const maybeModule = dot > 0 ? c.slice(0, dot) : null;
    if (maybeModule && acc[maybeModule] && VERBS.includes(c.slice(dot + 1))) {
      addVerb(maybeModule, c.slice(dot + 1));
    } else {
      // Named cap whose home is its own module (bank.reconcile → bank).
      const home = c.slice(0, dot > 0 ? dot : c.length);
      if (acc[home]) acc[home].add(c);
    }
  }
  return acc;
}

// Highest legacy level per module across a user's caps → { moduleKey: levelKey }.
export function accessibleModules(roleKeys = [], extraCaps = []) {
  const caps = capabilitiesByModule(roleKeys, extraCaps);
  const acc = {};
  for (const m of MODULES) acc[m.key] = legacyLevel([...(caps[m.key] || [])]);
  return acc;
}

// Representative demo personas — one Active user per role. Order mirrors the PRD
// build order (Finance Manager is the anchor); the sidebar shows them in turn.
const PERSONA_IDS = ["U002", "U010", "U003", "U008", "U001", "U007", "U004", "U005", "U006"];
export const PERSONAS = PERSONA_IDS
  .map((id) => USERS.find((u) => u.id === id))
  .filter(Boolean);

// Finance Manager — the anchor role, full financial authority. Opening as the FM
// gives the richest first-load demo (Admin is now powerless over money per the
// PRD, so it's a poor default).
const DEFAULT_USER_ID = "U002";

// Route prefix → module it belongs to. A route not listed here is ungated
// (always reachable). Order matters: first matching prefix wins.
const ROUTE_MODULE = [
  ["/bills", "ap"],
  ["/payments", "ap"],
  ["/ap/close", "ap"],
  ["/ap-aging", "reports"],
  ["/vendors", "ap"],
  ["/invoices", "ar"],
  ["/customers", "ar"],
  ["/general-ledger", "gl"],
  ["/journal-entry", "gl"],
  ["/bank-reconciliation", "gl"],
  ["/tax-reconciliation", "gl"],
  ["/reports", "reports"],
  ["/trial-balance", "reports"],
  ["/chart-of-accounts", "settings"],
  ["/inventory-settings", "settings"],
  ["/bank-accounts", "settings"],
  ["/dimensions", "settings"],
  ["/users", "settings"],
  ["/access-policy", "settings"],
  ["/posting-periods", "settings"],
];

export function moduleForPath(pathname) {
  const hit = ROUTE_MODULE.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"));
  return hit ? hit[1] : null;
}

// Ordered landing candidates. The user is sent to the first page their role can
// reach. Settings is included last so Admin (no financial or report access) has
// a home; Reports is the near-universal fallback.
const LANDING_CANDIDATES = [
  // Home task hub is ungated (module null → always reachable), so it's the
  // universal landing for every persona (MoM 2026-07-10). Module-scoped pages
  // remain as fallbacks for the NoAccess "Go to my workspace" link.
  ["/command-center", null],
  ["/journal-entry", "gl"],
  ["/bills", "ap"],
  ["/invoices", "ar"],
  ["/trial-balance", "reports"],
  ["/users", "settings"],
];

export function CurrentUserProvider({ children }) {
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const user = useMemo(
    () => USERS.find((u) => u.id === userId) || PERSONAS[0],
    [userId],
  );
  const caps = useMemo(
    () => capabilitiesByModule(user.roleKeys, user.extraCaps || []),
    [user],
  );
  const modules = useMemo(
    () => {
      const acc = {};
      for (const m of MODULES) acc[m.key] = legacyLevel([...(caps[m.key] || [])]);
      return acc;
    },
    [caps],
  );

  const value = useMemo(() => {
    const can = (m) => !m || (modules[m] && modules[m] !== "none");
    const landingPath =
      (LANDING_CANDIDATES.find(([, m]) => can(m)) || ["/trial-balance"])[0];
    // Point check — the PRD's authorize(user, action, resource). `action` is a
    // capability id: "<module>.<verb>" (e.g. "ap.approve") or a named cap
    // ("vendor.create", "bank.reconcile", "coa.manage"). resource is accepted
    // for forward-compat (record scope) but not yet enforced in the prototype.
    const hasCapability = (action) => {
      if (!action) return true;
      const dot = action.indexOf(".");
      const module = dot > 0 ? action.slice(0, dot) : null;
      const verb = dot > 0 ? action.slice(dot + 1) : null;
      // Verb form: check the module bucket.
      if (module && caps[module] && VERBS.includes(verb)) {
        return caps[module].has(verb) || caps[module].has("full");
      }
      // Named capability: present on any module bucket.
      return Object.values(caps).some((s) => s.has(action));
    };
    return {
      user,
      setUserId,
      modules,
      capabilities: caps,
      can,
      level: (m) => modules[m] || "none",
      // Legacy ordinal shim, derived from capabilities. Drives per-action gating
      // like hasLevel("ap","approve+post"). Prefer hasCapability for new code.
      hasLevel: (m, req) =>
        (LEVELS[modules[m]]?.rank ?? 0) >= (LEVELS[req]?.rank ?? 0),
      hasCapability,
      authorize: (action /*, resource */) => hasCapability(action),
      moduleForPath,
      landingPath,
    };
  }, [user, caps, modules]);

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error("useCurrentUser must be used within CurrentUserProvider");
  return ctx;
}
