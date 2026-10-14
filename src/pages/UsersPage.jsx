import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import {
  ROLES,
  evaluateSod,
  sodDecision,
  approvalLimitFor as limitFor,
  USERS as SEED_USERS,
} from "../data/seed/roles";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useRoles } from "../state/RolesContext";
import SodRiskAcceptance, { riskAccepted } from "../components/SodRiskAcceptance";
import { DIM_BY_KEY } from "../data/seed/dimensions";

// A user's department is a value of the Department dimension (Settings →
// Dimensions), so org structure and transaction tagging share one list.
const DEPARTMENTS = (DIM_BY_KEY.dept?.values || []).filter((v) => v !== "—");

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}

function roleName(key) {
  return ROLES.find((r) => r.key === key)?.name || key;
}

function fmtLimit(n) {
  if (n == null) return "—";
  return "Rp " + n.toLocaleString("id-ID");
}

const STATUS_LABELS = { Active: "Active", Invited: "Invited", Inactive: "Inactive" };

function StatusBadge({ status }) {
  const cls = status === "Active" ? "active" : status === "Invited" ? "invited" : "inactive";
  return <span className={`ru-status ${cls}`}>{STATUS_LABELS[status]}</span>;
}

// ── Invite / Change-role drawer with live SoD + account actions ──────────
function UserDrawer({ open, mode, user, onClose, onSave, onAction }) {
  const isInvite = mode === "invite";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [roleKeys, setRoleKeys] = useState([]);
  const [justification, setJustification] = useState("");
  const [riskOwner, setRiskOwner] = useState("");
  const { sodMode } = useAccountingSettings();
  const { user: me } = useCurrentUser();

  const lastKeyRef = useRef(null);
  if (open) {
    const key = isInvite ? "invite" : user?.id || "edit";
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      setName(isInvite ? "" : user?.name || "");
      setEmail(isInvite ? "" : user?.email || "");
      setDepartment(isInvite ? "" : user?.department || "");
      setRoleKeys(isInvite ? [] : [...(user?.roleKeys || [])]);
      setJustification("");
      setRiskOwner("");
    }
  } else if (lastKeyRef.current !== null) {
    lastKeyRef.current = null;
  }

  // Segregation of duties follows the entity mode (Access policy), as the
  // backend does on role assignment: only conflicts this change INTRODUCES are
  // decided — ENFORCED blocks HARD ones, RELAXED lets relaxable HARD ones
  // through with an accepted risk, SOFT ones always need an accepted risk.
  // Conflicts the user already had stay as they were accepted.
  const sod = useMemo(() => {
    const extraCaps = isInvite ? [] : user?.extraCaps || [];
    const now = evaluateSod(roleKeys, { extraCaps }).all;
    const before = isInvite ? [] : evaluateSod(user?.roleKeys || [], { extraCaps }).all;
    const had = new Set(before.map((r) => r.id));
    const fresh = now.filter((r) => !had.has(r.id));
    return { existing: now.filter((r) => had.has(r.id)), decision: sodDecision(fresh, sodMode) };
  }, [roleKeys, user, isInvite, sodMode]);

  if (!open) return null;

  const toggleRole = (key) => {
    setRoleKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
    setJustification("");
    setRiskOwner("");
  };

  // The approval limit is set on roles, never per person: a user gets the
  // highest limit among the roles they hold.
  const limit = limitFor(roleKeys);
  const limitSource = limit == null ? null : ROLES.find((r) => roleKeys.includes(r.key) && r.approval_limit === limit);
  const baseValid = roleKeys.length > 0 && (!isInvite || (name.trim() && /\S+@\S+\.\S+/.test(email)));
  const blocked = sod.decision.level === "blocked";
  const needsRisk = sod.decision.level === "risk";
  const canSave = baseValid && !blocked && (!needsRisk || riskAccepted(justification, riskOwner));

  function handleSave() {
    if (!canSave) return;
    onSave({
      mode,
      id: user?.id,
      name: name.trim(),
      email: email.trim(),
      department: department || null,
      roleKeys,
      approval_limit: limit,
      risk: needsRisk ? { rules: sod.decision.risk, justification: justification.trim(), ownerId: riskOwner } : null,
    });
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div className="drawer-av" style={{ background: "var(--color-action)" }}>
            {isInvite ? "+" : initials(name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title">{isInvite ? "Invite user" : name || "(no name)"}</div>
            <div className="drawer-sub">{isInvite ? "Send an invitation & assign roles" : "Change user roles"}</div>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          {isInvite && (
            <div className="ba-section">
              <div className="ba-section-title">User details</div>
              <div className="ba-field">
                <label>Full name <span className="ba-req">*</span></label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Andi Wijaya" />
              </div>
              <div className="ba-field">
                <label>Email <span className="ba-req">*</span></label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@klay.id" />
              </div>
            </div>
          )}

          <div className="ba-section">
            <div className="ba-section-title">Department</div>
            <div className="ba-field" style={{ marginBottom: 0 }}>
              <select className="ru-dept-select" value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
                <option value="">Not set</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <span className="ba-help">Where this person sits in the organisation. It doesn't grant any access — roles do.</span>
            </div>
          </div>

          <div className="ba-section">
            <div className="ba-section-title">Roles <span className="ba-req">*</span></div>
            <p className="ba-help" style={{ marginBottom: 10 }}>
              Select one or more roles. Segregation of duties is checked live.
            </p>
            <div className="ru-role-checks">
              {ROLES.map((r) => {
                const on = roleKeys.includes(r.key);
                return (
                  <label key={r.key} className={`ru-role-check${on ? " on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleRole(r.key)} />
                    <span className="ru-role-check-box">
                      <svg viewBox="0 0 12 12"><polyline points="2 6.5 5 9 10 3" /></svg>
                    </span>
                    <span className="ru-role-check-body">
                      <span className="ru-role-check-name">
                        {r.name}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Live SoD feedback */}
          {blocked && (
            <div className="ru-sod-banner hard">
              <div className="ru-sod-banner-hdr">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
                Segregation of duties conflict — blocked
              </div>
              <p>{sod.decision.blocked.map((r) => r.label).join("; ")} can't be held by one person.</p>
              <p className="ru-sod-banner-note">
                {sod.decision.blocked.some((r) => r.forbidden)
                  ? "This capability is never allowed. Remove the role that grants it."
                  : sodMode === "RELAXED"
                    ? "This combination can't be accepted even in Relaxed mode. Remove one of the conflicting roles."
                    : "This entity is in Enforced mode, so hard conflicts can't be saved. Remove one of the conflicting roles, or switch the entity to Relaxed in Access policy."}
              </p>
            </div>
          )}
          {!blocked && needsRisk && (
            <SodRiskAcceptance
              rules={sod.decision.risk}
              justification={justification}
              setJustification={setJustification}
              ownerId={riskOwner}
              setOwnerId={setRiskOwner}
              excludeIds={[me.id, user?.id].filter(Boolean)}
            />
          )}
          {sod.existing.length > 0 && (
            <p className="ba-help" style={{ marginTop: 10 }}>
              Already accepted for this user: {sod.existing.map((r) => r.label).join("; ")}
              {user?.justification ? ` — “${user.justification}”` : ""}
              {user?.riskOwner ? ` (owner: ${user.riskOwner})` : ""}.
            </p>
          )}

          {roleKeys.length > 0 && (
            <div className="ba-section">
              <div className="ba-section-title">Summary</div>
              <div className="drawer-row">
                <span className="drawer-label">Roles</span>
                <span className="drawer-value">{roleKeys.map(roleName).join(", ")}</span>
              </div>
              <div className="drawer-row">
                <span className="drawer-label">Approval limit</span>
                <span className="drawer-value">
                  {fmtLimit(limit)}
                  {limitSource && (
                    <span className="ru-limit-src">
                      set on <Link to={`/roles/${limitSource.key}`} className="ru-inline-link">{limitSource.name}</Link>
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {!isInvite && user && (
            <div className="ba-section">
              <div className="ba-section-title">Account</div>
              <div className="drawer-row">
                <span className="drawer-label">Status</span>
                <span className="drawer-value"><StatusBadge status={user.status} /></span>
              </div>
              <div className="ru-acct-actions">
                {user.status === "Invited" && (
                  <button type="button" className="ru-acct-btn" onClick={() => onAction("resend", user)}>
                    <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Resend invitation
                  </button>
                )}
                {user.status !== "Inactive" ? (
                  <button type="button" className="ru-acct-btn danger" onClick={() => { onAction("deactivate", user); onClose(); }}>
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                    Deactivate user
                  </button>
                ) : (
                  <button type="button" className="ru-acct-btn" onClick={() => { onAction("reactivate", user); onClose(); }}>
                    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    Reactivate user
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button className="drawer-btn primary" disabled={!canSave} onClick={handleSave}>
            {isInvite ? "Send invitation" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState(() => SEED_USERS.map((u) => ({ ...u, roleKeys: [...u.roleKeys] })));
  const { acceptRisks } = useRoles();
  const { sodMode } = useAccountingSettings();
  const { user: me } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState("all");
  // A role page's "Manage in Users" link lands here pre-filtered (?role=key).
  const [searchParams] = useSearchParams();
  const [roleFilter, setRoleFilter] = useState(() => {
    const k = searchParams.get("role");
    return k && ROLES.some((r) => r.key === k) ? k : "all";
  });
  const navigate = useNavigate();
  const [deptFilter, setDeptFilter] = useState("all"); // all | none | <department>
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null); // { mode, user }
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }

  // Status tabs (All + one per account status).
  const statusTabs = useMemo(() => [
    { k: "all", lbl: "All", count: users.length },
    ...["Active", "Invited", "Inactive"].map((st) => ({
      k: st, lbl: STATUS_LABELS[st], count: users.filter((u) => u.status === st).length,
    })),
  ], [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (roleFilter !== "all" && !u.roleKeys.includes(roleFilter)) return false;
      if (deptFilter === "none" && u.department) return false;
      if (deptFilter !== "all" && deptFilter !== "none" && u.department !== deptFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.department || "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.roleKeys.some((k) => roleName(k).toLowerCase().includes(q))
      );
    });
  }, [users, statusFilter, roleFilter, deptFilter, search]);

  function handleRowAction(action, user) {
    if (action === "deactivate") {
      setUsers((cur) => cur.map((u) => (u.id === user.id ? { ...u, status: "Inactive" } : u)));
      showToast(`${user.name} deactivated.`);
      return;
    }
    if (action === "reactivate") {
      setUsers((cur) => cur.map((u) => (u.id === user.id ? { ...u, status: "Active" } : u)));
      showToast(`${user.name} reactivated.`);
      return;
    }
    if (action === "resend") { showToast(`Invitation resent to ${user.email}.`); return; }
  }

  function handleSave(data) {
    const id = data.mode === "invite" ? `U${String(Date.now()).slice(-6)}` : data.id;
    // An accepted SoD risk goes to the risk register and stays on the user.
    const owner = data.risk ? SEED_USERS.find((u) => u.id === data.risk.ownerId) : null;
    const riskFields = owner ? { justification: data.risk.justification, riskOwner: owner.name } : {};
    if (owner) {
      acceptRisks({
        rules: data.risk.rules, subject: `User · ${data.name}`, userId: id,
        justification: data.risk.justification, owner: owner.name, by: me.name, mode: sodMode,
      });
    }
    if (data.mode === "invite") {
      setUsers((cur) => [
        { id, name: data.name, email: data.email, department: data.department, roleKeys: data.roleKeys, status: "Invited", approval_limit: data.approval_limit, lastActive: null, invitedOn: "2026-06-07", ...riskFields },
        ...cur,
      ]);
      showToast(`Invitation sent to ${data.email}.`);
    } else {
      setUsers((cur) => cur.map((u) => (u.id === id ? { ...u, department: data.department, roleKeys: data.roleKeys, approval_limit: data.approval_limit, ...riskFields } : u)));
      showToast(owner ? `User updated — risk accepted by ${owner.name}.` : "User updated.");
    }
    setDrawer(null);
  }

  return (
    <div className="lg-page users-page">
      <div className="lg-scroll-container">
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Users</h1>
              <p className="settings-sub">
                Manage who has access and which roles they hold. Role assignments are checked against the
                segregation-of-duties rules — click any role chip to open that role's capabilities in{" "}
                <Link to="/roles" className="ru-inline-link">Roles</Link>.
              </p>
            </div>
            <div className="lg-head-actions">
              <button type="button" className="lg-btn-brand" onClick={() => setDrawer({ mode: "invite" })}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Invite user
              </button>
            </div>
          </div>
        </div>

        <div className="lg-table-wrap">
          <div className="lg-card lg-table-users">
            <div className="bp-tabs-row">
              {statusTabs.map((t) => (
                <button
                  key={t.k}
                  type="button"
                  className={`bp-tab${statusFilter === t.k ? " active" : ""}`}
                  onClick={() => setStatusFilter(t.k)}
                >
                  {t.lbl}
                  <span className="bp-tab-count">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input
                  type="text"
                  placeholder="Search name, email, department, or role…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="ru-filter-select"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                aria-label="Filter by role"
              >
                <option value="all">Any role</option>
                {ROLES.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
              <select
                className="ru-filter-select"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                aria-label="Filter by department"
              >
                <option value="all">Any department</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                <option value="none">No department</option>
              </select>
              {(roleFilter !== "all" || deptFilter !== "all") && (
                <button
                  type="button"
                  className="ru-filter-clear"
                  onClick={() => { setRoleFilter("all"); setDeptFilter("all"); }}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="lg-col-header ru-users-cols">
              <div>User</div>
              <div>Department</div>
              <div>Roles</div>
              <div>Status</div>
            </div>

            {filtered.length === 0 && <div className="lg-empty">No users in this view.</div>}

            {filtered.map((u, i) => {
              const sod = u.status !== "Inactive" ? evaluateSod(u.roleKeys) : { level: "none" };
              return (
                <div
                  key={u.id}
                  className={`lg-row ru-users-cols${i % 2 === 1 ? " alt" : ""}`}
                  onClick={() => setDrawer({ mode: "edit", user: u })}
                >
                  <div className="ru-user-cell">
                    <span className="ru-user-av">{initials(u.name)}</span>
                    <span className="ru-user-id">
                      <span className="ru-user-name">{u.name}</span>
                      <span className="ru-user-email">{u.email}</span>
                    </span>
                  </div>
                  <div className={u.department ? "ru-user-dept" : "lg-cell-em-dash"}>{u.department || "—"}</div>
                  <div className="ru-user-roles">
                    {u.roleKeys.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="ru-role-chip ru-role-chip-btn"
                        title={`Open the ${roleName(k)} role`}
                        onClick={(e) => { e.stopPropagation(); navigate(`/roles/${k}`); }}
                      >
                        {roleName(k)}
                      </button>
                    ))}
                    {sod.level !== "none" && (
                      <span
                        className={`ru-sod-ico ${sod.level}`}
                        title={u.justification ? `${sod.message}\nJustification: ${u.justification}${u.riskOwner ? `\nRisk owner: ${u.riskOwner}` : ""}` : sod.message}
                        aria-label="Segregation of duties warning"
                      >
                        <svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      </span>
                    )}
                  </div>
                  <div><StatusBadge status={u.status} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <UserDrawer
        open={!!drawer}
        mode={drawer?.mode || "invite"}
        user={drawer?.user || null}
        onClose={() => setDrawer(null)}
        onSave={handleSave}
        onAction={handleRowAction}
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
