// Capability catalog as the Roles screens present it: each customer-facing
// module with the verbs it offers and the named capabilities that live on it,
// plus small pure helpers over a role's { moduleKey: [cap, …] } grant map.
import { MODULES, MODULE_VERBS, CAPABILITIES, VERBS, SOD_RULES, sodDecision } from "../data/seed/roles";

export const MODULE_SHORT = {
  gl: "GL", ap: "AP", ar: "AR", purchasing: "Purchasing", inventory: "Inventory",
  bank: "Bank", masterdata: "Master data", reports: "Reports", settings: "Settings", migration: "Migration",
  other: "Other",
};

// Plain-sentence copy for the verbs (the named capabilities carry their own).
export const VERB_COPY = {
  view: { label: "View", desc: "See records in this module. Read only." },
  transact: { label: "Transact", desc: "Create and edit their own drafts, and submit them." },
  approve: { label: "Approve", desc: "Can be picked as an approver in the approval workflow, up to the role's approval limit." },
  post: { label: "Post", desc: "Commit approved records to the ledger. Final — corrected only by a compensating entry." },
  full: { label: "Full", desc: "Everything in this module, including configuration." },
};

export const CAP_SECTIONS = MODULES.filter((m) => !m.internal).map((m) => ({
  ...m,
  short: MODULE_SHORT[m.key] || m.label,
  verbs: MODULE_VERBS[m.key] || [],
  named: Object.entries(CAPABILITIES)
    .filter(([, c]) => c.kind === "named" && c.home === m.key)
    .map(([id, c]) => ({ id, ...c })),
}));

// Canonical id used by the SoD rules: "<module>.<verb>" or the named cap.
export const canonicalId = (module, cap) => (VERBS.includes(cap) ? `${module}.${cap}` : cap);

export const hasCap = (caps, module, cap) => (caps[module] || []).includes(cap);

export function toggleCap(caps, module, cap) {
  const list = caps[module] || [];
  const next = list.includes(cap) ? list.filter((c) => c !== cap) : [...list, cap];
  const out = { ...caps };
  if (next.length) out[module] = next;
  else delete out[module];
  return out;
}

export const capCount = (caps) => Object.values(caps || {}).reduce((n, l) => n + l.length, 0);

export function capLabel(module, cap) {
  if (VERBS.includes(cap)) return `${VERB_COPY[cap].label} · ${MODULE_SHORT[module] || module}`;
  return CAPABILITIES[cap]?.label || cap;
}

// What changed between two grant maps, in catalog order.
export function diffCaps(before = {}, after = {}) {
  const out = [];
  for (const s of CAP_SECTIONS) {
    for (const cap of [...s.verbs, ...s.named.map((n) => n.id)]) {
      const was = hasCap(before, s.key, cap);
      const is = hasCap(after, s.key, cap);
      if (was !== is) out.push({ module: s.key, cap, change: is ? "added" : "removed" });
    }
  }
  return out;
}

// Modules on which holders can be picked as approvers. Payments are their own
// lifecycle (ap.payment.authorize), so they are listed separately.
export function approverScopes(caps = {}) {
  const out = [];
  for (const s of CAP_SECTIONS) {
    if (hasCap(caps, s.key, "approve") || (hasCap(caps, s.key, "full") && s.verbs.includes("approve"))) out.push(s);
  }
  if (hasCap(caps, "ap", "ap.payment.authorize")) out.push({ key: "payment", label: "Payments", short: "Payments", desc: "Payment requests" });
  return out;
}

export const holdsApproval = (caps) => approverScopes(caps).length > 0;

// Short "what can this role do" lines for a role card: strongest verbs first.
export function powerSummary(caps = {}) {
  const lines = [];
  for (const verb of ["post", "approve", "transact", "view", "full"]) {
    const mods = CAP_SECTIONS.filter((s) => hasCap(caps, s.key, verb)).map((s) => s.short);
    if (mods.length) lines.push({ verb, label: VERB_COPY[verb].label, modules: mods });
  }
  const named = CAP_SECTIONS.flatMap((s) => s.named.filter((n) => hasCap(caps, s.key, n.id)));
  return { lines, named };
}

// SoD rules that fire on a capability set, and the capability ids involved —
// "hard" when the entity's mode blocks the rule, "soft" when it only needs an
// accepted risk (see sodDecision).
export function sodInvolvement(set, mode = "ENFORCED") {
  const ids = new Map(); // canonical id → "hard" | "soft"
  for (const rule of SOD_RULES) {
    const a = rule.a.filter((c) => set.has(c));
    const b = rule.b ? rule.b.filter((c) => set.has(c)) : [];
    const fires = rule.b == null ? a.length > 0 : a.length > 0 && b.length > 0;
    if (!fires) continue;
    const tone = sodDecision([rule], mode).level === "blocked" ? "hard" : "soft";
    for (const c of [...a, ...b]) {
      if (ids.get(c) !== "hard") ids.set(c, tone);
    }
  }
  return ids;
}

export function fmtRp(n) {
  return n == null ? "No ceiling" : "Rp " + Number(n).toLocaleString("id-ID");
}

// Compact Rupiah for tight spots: "Rp 10 jt", "Rp 2 M".
export function fmtRpShort(n) {
  if (n == null) return "No ceiling";
  if (n >= 1e9) return `Rp ${+(n / 1e9).toFixed(2)} M`;
  if (n >= 1e6) return `Rp ${+(n / 1e6).toFixed(1)} jt`;
  return fmtRp(n);
}
