import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import "./roles.css";
import { useRoles } from "../state/RolesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import CreateRoleModal from "../components/CreateRoleModal";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { CAP_SECTIONS, VERB_COPY, hasCap, holdsApproval, powerSummary, fmtRp } from "../lib/roleCapabilities";

// Settings → Access → Roles. A role is a named collection of capabilities.
// Klay seeds a starting set so nobody begins with no roles, but every role is an
// ordinary, editable role; new ones start from scratch or as a copy. Who signs off on
// a given record lives in the approval workflow — a role only makes its holders
// eligible to approve, up to the role's approval limit.

function initials(name) {
  return name.trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}

function RoleCard({ role, caps, holders }) {
  const navigate = useNavigate();
  const { lines, named } = powerSummary(caps);
  const approver = holdsApproval(caps);
  return (
    <button type="button" className="rl-card" onClick={() => navigate(`/roles/${role.key}`)}>
      <div className="rl-card-top">
        <span className="rl-card-name">{role.name}</span>
      </div>
      <p className="rl-card-desc">{role.description || "No description yet."}</p>
      <div className="rl-card-powers">
        {lines.slice(0, 3).map((l) => (
          <div key={l.verb} className="rl-power">
            <span className={`rl-verb-tag ${l.verb}`}>{l.label}</span>
            <span className="rl-power-mods">{l.modules.join(" · ")}</span>
          </div>
        ))}
        {named.length > 0 && (
          <div className="rl-power">
            <span className="rl-verb-tag named">+{named.length}</span>
            <span className="rl-power-mods">{named.slice(0, 2).map((n) => n.label).join(", ")}{named.length > 2 ? "…" : ""}</span>
          </div>
        )}
        {lines.length === 0 && named.length === 0 && <div className="rl-power-none">No capabilities yet</div>}
      </div>
      <div className="rl-card-foot">
        <span className="rl-avs">
          {holders.slice(0, 4).map((u) => <span key={u.id} className="rl-av" title={u.name}>{initials(u.name)}</span>)}
          <span className="rl-avs-n">{holders.length} {holders.length === 1 ? "person" : "people"}</span>
        </span>
        <span className="rl-card-limit">{approver ? <>Limit <strong>{fmtRp(role.approval_limit)}</strong></> : "No approval authority"}</span>
      </div>
    </button>
  );
}

// Every role side by side — the auditor's view. Rows are capabilities grouped
// by module; a filled dot means the role grants it.
function CompareMatrix({ roles, capsOf }) {
  return (
    <div className="rl-compare-wrap">
      <table className="rl-compare">
        <thead>
          <tr>
            <th className="rl-compare-corner">Capability</th>
            {roles.map((r) => (
              <th key={r.key}>
                <Link to={`/roles/${r.key}`} className="rl-compare-role">
                  {r.name}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAP_SECTIONS.map((s) => {
            const rows = [
              ...s.verbs.map((v) => ({ id: v, label: VERB_COPY[v].label, desc: VERB_COPY[v].desc })),
              ...s.named.map((n) => ({ id: n.id, label: n.label, desc: n.desc })),
            ];
            if (!rows.length) return null;
            return [
              <tr key={s.key} className="rl-compare-mod"><td colSpan={roles.length + 1}>{s.label}</td></tr>,
              ...rows.map((row) => (
                <tr key={`${s.key}-${row.id}`}>
                  <td className="rl-compare-cap" title={row.desc}>{row.label}</td>
                  {roles.map((r) => (
                    <td key={r.key} className="rl-compare-cell">
                      {hasCap(capsOf(r.key), s.key, row.id) ? <span className="rl-dot-on" aria-label="Granted" /> : <span className="rl-dot-off" aria-label="Not granted" />}
                    </td>
                  ))}
                </tr>
              )),
            ];
          })}
          <tr className="rl-compare-mod"><td colSpan={roles.length + 1}>Approval</td></tr>
          <tr>
            <td className="rl-compare-cap">Approval limit</td>
            {roles.map((r) => (
              <td key={r.key} className="rl-compare-cell rl-compare-limit">
                {holdsApproval(capsOf(r.key)) ? fmtRp(r.approval_limit).replace("Rp ", "") : "—"}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function RolesPage() {
  const { roles, capsOf, holdersOf, rev } = useRoles();
  const { hasCapability } = useCurrentUser();
  const { sodMode } = useAccountingSettings();
  const canManage = hasCapability("roles.manage");
  const [view, setView] = useState("roles");
  const [creating, setCreating] = useState(false);

  const data = useMemo(
    () => roles.map((r) => ({ role: r, caps: capsOf(r.key), holders: holdersOf(r.key) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roles, rev],
  );

  return (
    <div className="lg-page roles-page">
      <div className="lg-scroll-container">
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Roles</h1>
              <p className="settings-sub">
                A role is a set of capabilities — what its holders can see, create, approve and post. Edit any role,
                or create a new one from scratch or as a copy. Who approves a given record is set
                in the <Link to="/approval" className="ru-inline-link">approval workflow</Link>; a role makes its
                holders eligible to approve, up to its approval limit. Assign roles to people in{" "}
                <Link to="/users" className="ru-inline-link">Users</Link>.
              </p>
            </div>
            {canManage && (
              <div className="lg-head-actions">
                <button type="button" className="lg-btn-brand" onClick={() => setCreating(true)}>
                  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Create role
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="rl-viewbar">
          <div className="rl-seg" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === "roles"} className={view === "roles" ? "on" : ""} onClick={() => setView("roles")}>Roles</button>
            <button type="button" role="tab" aria-selected={view === "compare"} className={view === "compare" ? "on" : ""} onClick={() => setView("compare")}>Compare capabilities</button>
          </div>
          {!canManage && (
            <span className="rl-viewbar-note">Read only — editing roles needs the <em>Manage roles</em> capability.</span>
          )}
        </div>
        <p className="rl-sod-line">
          Segregation of duties is <b>{sodMode === "RELAXED" ? "Relaxed" : "Enforced"}</b> for this entity —{" "}
          {sodMode === "RELAXED"
            ? "conflicting capabilities can be combined only after an independent owner accepts the risk."
            : "hard conflicts can't be combined in one role or person; soft ones need an independent owner to accept the risk."}
        </p>

        {view === "roles" ? (
          <>
            <div className="ru-section-hdr">
              <span className="ru-section-title">All roles</span>
              <span className="ru-section-cnt">{data.length}</span>
            </div>
            {data.length ? (
              <div className="rl-grid">
                {data.map((d) => <RoleCard key={d.role.key} {...d} />)}
              </div>
            ) : (
              <div className="rl-empty">
                <b>No roles yet.</b>
                <span>Create a role from scratch and grant exactly what the job needs.</span>
                {canManage && <button type="button" className="drawer-btn ghost" onClick={() => setCreating(true)}>Create role</button>}
              </div>
            )}
          </>
        ) : (
          <CompareMatrix roles={roles} capsOf={capsOf} />
        )}
        <div style={{ height: 40 }} />
      </div>

      {creating && <CreateRoleModal onClose={() => setCreating(false)} />}
    </div>
  );
}
