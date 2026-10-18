import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  ROLES,
  ROLE_CAPS,
  USERS,
  cloneCaps,
  writeRole,
  removeRole,
} from "../data/seed/roles";

// Roles. A role is a named collection of capabilities. Klay seeds each company
// with its own copy of the standard roles (roles.js) when the company is created.
//
// v1: roles are READ-ONLY. The backend only seeds roles and capabilities — there
// is no endpoint to create, edit or delete them (Slack, 15 Oct 2026). Changing a
// company's roles is a provisioning job for Klay, and a one-off change for one
// person is a time-limited override on that user (Users → Temporary access).
//
// v2 (custom roles): flip ROLE_EDITING on. Every role can then be renamed,
// edited, copied, or deleted (when nobody holds it), and new ones created from
// scratch. Writes go through the live registry in roles.js so authorize()/SoD
// everywhere see them at once; `rev` changes on every write so consumers
// re-render.
//
// Each role carries a version and a history entry per save, mirroring the
// approval workflow's versioning, so "who changed what this role can do" is
// always answerable.

export const ROLE_EDITING = false;

const RolesContext = createContext(null);

const SEEDED_AT = "2025-01-12T09:00:00";

function seedHistory() {
  return Object.fromEntries(
    ROLES.map((r) => [r.key, [{ v: 1, at: SEEDED_AT, by: "System (provisioning)", note: "Set up with the company" }]]),
  );
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "role";
}

export function RolesProvider({ children }) {
  const [rev, setRev] = useState(0);
  const [history, setHistory] = useState(seedHistory);
  // Accepted segregation-of-duties risks (the backend's authorization risk
  // register): one entry per rule accepted, for a role or a user assignment.
  const [risks, setRisks] = useState([]);
  // `roleKey` / `userId` say which role or user assignment the risk sits on.
  const acceptRisks = useCallback(({ rules, subject, roleKey = null, userId = null, justification, owner, by, mode }) => {
    const at = new Date().toISOString();
    setRisks((cur) => [
      ...rules.map((r, i) => ({
        id: `${at}-${subject}-${r.id}-${i}`, ruleId: r.id, ruleLabel: r.label, type: r.type,
        subject, roleKey, userId, justification, owner, by, mode, at,
      })),
      ...cur,
    ]);
  }, []);

  const bump = () => setRev((n) => n + 1);

  const log = useCallback((key, entry) => {
    setHistory((h) => {
      const list = h[key] || [];
      const v = (list[list.length - 1]?.v || 0) + 1;
      return { ...h, [key]: [...list, { v, at: new Date().toISOString(), ...entry }] };
    });
  }, []);

  // Save edits to an existing role. `meta` is the role record (name, limit, …).
  const saveRole = useCallback((meta, caps, { by, note }) => {
    writeRole(meta, caps);
    log(meta.key, { by, note });
    bump();
  }, [log]);

  // New role, optionally starting from another role's capabilities.
  const createRole = useCallback(({ name, fromKey, by }) => {
    const base = fromKey ? ROLES.find((r) => r.key === fromKey) : null;
    let key = `role_${slugify(name)}`;
    for (let n = 2; ROLES.some((r) => r.key === key); n++) key = `role_${slugify(name)}_${n}`;
    const role = {
      key,
      name: name.trim(),
      description: base ? `Based on ${base.name}. ${base.description}` : "",
      is_internal: false,
      approval_limit: base ? base.approval_limit : null,
      based_on: base ? base.key : null,
    };
    writeRole(role, base ? ROLE_CAPS[base.key] : {});
    setHistory((h) => ({
      ...h,
      [key]: [{ v: 1, at: new Date().toISOString(), by, note: base ? `Created from ${base.name}` : "Created from scratch" }],
    }));
    bump();
    return key;
  }, []);

  const deleteRole = useCallback((key) => {
    const role = ROLES.find((r) => r.key === key);
    if (!role || holdersOf(key).length) return false;
    removeRole(key);
    bump();
    return true;
  }, []);

  const value = useMemo(() => ({
    rev,
    roles: [...ROLES],
    capsOf: (key) => cloneCaps(ROLE_CAPS[key]),
    holdersOf,
    history,
    saveRole,
    createRole,
    deleteRole,
    risks,
    acceptRisks,
  }), [rev, history, saveRole, createRole, deleteRole, risks, acceptRisks]);

  return <RolesContext.Provider value={value}>{children}</RolesContext.Provider>;
}

// Users currently holding a role — active and invited; inactive accounts have
// no access to change.
export function holdersOf(key) {
  return USERS.filter((u) => u.status !== "Inactive" && u.roleKeys.includes(key));
}

export function useRoles() {
  const ctx = useContext(RolesContext);
  if (!ctx) throw new Error("useRoles must be used within RolesProvider");
  return ctx;
}
