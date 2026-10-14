import { ROLES, USERS, effectiveCapabilities } from "../data/seed/roles";

// Accepting a segregation-of-duties risk (a SOFT conflict, or a relaxable HARD
// conflict while the entity is RELAXED) needs two things, mirroring the
// backend's risk register: a written reason, and an INDEPENDENT owner who
// accepts it. Independent = an active person with control authority — they can
// approve, post, authorize payments or administer access, read from their
// actual capabilities — who is neither the person making the change nor anyone
// whose access it changes.

const hasControlAuthority = (u) => {
  for (const c of effectiveCapabilities(u.roleKeys, u.extraCaps || [])) {
    if (/\.(approve|post)$/.test(c) || ["payment.approve", "users.manage", "roles.manage"].includes(c)) return true;
  }
  return false;
};

export function riskOwnerCandidates(excludeIds = []) {
  const skip = new Set(excludeIds);
  return USERS.filter((u) => u.status === "Active" && !skip.has(u.id) && hasControlAuthority(u));
}

export const riskAccepted = (justification, ownerId) => justification.trim().length >= 8 && !!ownerId;

export default function SodRiskAcceptance({ rules, justification, setJustification, ownerId, setOwnerId, excludeIds }) {
  const owners = riskOwnerCandidates(excludeIds);
  return (
    <div className="sod-risk">
      <div className="sod-risk-hdr">Accept the risk to continue</div>
      <ul className="sod-risk-rules">
        {rules.map((r) => <li key={r.id}><b>{r.label}</b> — {r.reason}</li>)}
      </ul>
      <label className="sod-risk-field">
        <span>Justification <em>required</em></span>
        <textarea
          rows={3}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Why this combination is acceptable (e.g. small team, every posting reviewed at month-end)…"
        />
      </label>
      <label className="sod-risk-field">
        <span>Risk owner <em>required · independent of this change</em></span>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">Choose who accepts this risk…</option>
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {u.roleKeys.map((k) => ROLES.find((r) => r.key === k)?.name || k).join(", ")}
            </option>
          ))}
        </select>
        {owners.length === 0 && (
          <em className="sod-risk-none">Nobody independent holds a control role, so this risk can't be accepted.</em>
        )}
      </label>
      <p className="sod-risk-note">Recorded in the risk register with the rule, your reason, and the owner.</p>
    </div>
  );
}
