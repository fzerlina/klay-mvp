import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import {
  ROLES,
  effectiveCapabilities,
  evaluateSod,
  sodDecision,
  approvalLimitFor as limitFor,
  USERS as SEED_USERS,
} from "../data/seed/roles";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useRoles } from "../state/RolesContext";
import SodRiskAcceptance, { riskAccepted } from "../components/SodRiskAcceptance";
import SettingsHeader, { USERS_TABS } from "../components/SettingsHeader";
import { CAP_SECTIONS, canonicalId, capLabel } from "../lib/roleCapabilities";
import SodInfo from "../components/SodInfo";
import { usePeople } from "../state/PeopleContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";

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

// ── Temporary access ─────────────────────────────────────────────────────
// Roles are read-only in v1, so a one-off change for one person is a
// time-limited override: one extra capability until a set date, with a reason.
// It rides on the user (tempAccess, mirrored into extraCaps so authorize()/SoD
// see it) and never changes the role.
const TEMP_MAX_DAYS = 90;
// "Today" for the Users seed (its lastActive / invitedOn dates).
const USERS_TODAY = "2026-06-07";

// Every capability a grant can add, grouped by module, as canonical ids.
const CAP_OPTIONS = CAP_SECTIONS.map((s) => ({
  key: s.key,
  label: s.label,
  options: [
    ...s.verbs.filter((v) => v !== "full").map((v) => ({ id: canonicalId(s.key, v), label: capLabel(s.key, v) })),
    ...s.named.map((n) => ({ id: n.id, label: n.label })),
  ],
})).filter((g) => g.options.length);

function capName(id) {
  for (const g of CAP_OPTIONS) {
    const o = g.options.find((x) => x.id === id);
    if (o) return o.label;
  }
  return id;
}

function addDaysIso(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDay(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// A user's extra capabilities that are not temporary grants.
function permanentExtras(user) {
  const temp = new Set((user?.tempAccess || []).map((t) => t.cap));
  return (user?.extraCaps || []).filter((c) => !temp.has(c));
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
  const [roleKeys, setRoleKeys] = useState([]);
  const [justification, setJustification] = useState("");
  const [riskOwner, setRiskOwner] = useState("");
  const [temp, setTemp] = useState([]);
  const [adding, setAdding] = useState(false);
  const [tCap, setTCap] = useState("");
  const [tUntil, setTUntil] = useState("");
  const [tReason, setTReason] = useState("");
  const { sodMode } = useAccountingSettings();
  const { user: me } = useCurrentUser();

  const lastKeyRef = useRef(null);
  if (open) {
    const key = isInvite ? "invite" : user?.id || "edit";
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      setName(isInvite ? "" : user?.name || "");
      setEmail(isInvite ? "" : user?.email || "");
      setRoleKeys(isInvite ? [] : [...(user?.roleKeys || [])]);
      setJustification("");
      setRiskOwner("");
      setTemp(isInvite ? [] : [...(user?.tempAccess || [])]);
      setAdding(false);
    }
  } else if (lastKeyRef.current !== null) {
    lastKeyRef.current = null;
  }

  // Segregation of duties follows the company mode (set by Klay), as the
  // backend does on role assignment: only conflicts this change INTRODUCES are
  // decided — ENFORCED blocks HARD ones, RELAXED lets relaxable HARD ones
  // through with an accepted risk, SOFT ones always need an accepted risk.
  // Conflicts the user already had stay as they were accepted.
  // Temporary grants count as the person's access, so they are checked too.
  const sod = useMemo(() => {
    const extraNow = isInvite ? [] : [...permanentExtras(user), ...temp.map((t) => t.cap)];
    const now = evaluateSod(roleKeys, { extraCaps: extraNow }).all;
    const before = isInvite ? [] : evaluateSod(user?.roleKeys || [], { extraCaps: user?.extraCaps || [] }).all;
    const had = new Set(before.map((r) => r.id));
    const fresh = now.filter((r) => !had.has(r.id));
    return { existing: now.filter((r) => had.has(r.id)), decision: sodDecision(fresh, sodMode) };
  }, [roleKeys, user, isInvite, sodMode, temp]);

  if (!open) return null;

  const toggleRole = (key) => {
    setRoleKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
    setJustification("");
    setRiskOwner("");
  };

  // Capabilities a temporary grant could add: not already held through the
  // selected roles, and not already granted temporarily.
  const held = effectiveCapabilities(roleKeys);
  const grantable = CAP_OPTIONS
    .map((g) => ({ ...g, options: g.options.filter((o) => !held.has(o.id) && !temp.some((t) => t.cap === o.id)) }))
    .filter((g) => g.options.length);
  const minUntil = addDaysIso(USERS_TODAY, 1);
  const maxUntil = addDaysIso(USERS_TODAY, TEMP_MAX_DAYS);
  const tValid = tCap && tUntil >= minUntil && tUntil <= maxUntil && tReason.trim().length >= 5;

  function startAdding() {
    setTCap("");
    setTUntil(addDaysIso(USERS_TODAY, 30));
    setTReason("");
    setAdding(true);
  }
  function addTemp() {
    if (!tValid) return;
    setTemp((cur) => [...cur, { cap: tCap, until: tUntil, reason: tReason.trim(), grantedBy: me.name, grantedOn: USERS_TODAY }]);
    setAdding(false);
    setJustification("");
    setRiskOwner("");
  }
  function endTemp(cap) {
    setTemp((cur) => cur.filter((t) => t.cap !== cap));
    setJustification("");
    setRiskOwner("");
  }

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
      roleKeys,
      tempAccess: temp,
      extraCaps: isInvite ? [] : [...permanentExtras(user), ...temp.map((t) => t.cap)],
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

          {!isInvite && (
            <div className="ba-section">
              <div className="ba-section-title">Temporary access</div>
              <p className="ba-help" style={{ marginBottom: 10 }}>
                Give this person one extra capability until a set date — cover during leave, or a one-off task.
                It ends on its own and doesn't change any role. Up to {TEMP_MAX_DAYS} days.
              </p>
              {temp.length > 0 && (
                <ul className="ru-temp-list">
                  {temp.map((t) => (
                    <li key={t.cap} className="ru-temp-item">
                      <span className="ru-temp-main">
                        <b>{capName(t.cap)}</b>
                        <span>Until {fmtDay(t.until)} · {t.reason}</span>
                        {t.grantedBy && <span className="ru-temp-by">Granted by {t.grantedBy}{t.grantedOn ? ` on ${fmtDay(t.grantedOn)}` : ""}</span>}
                      </span>
                      <button type="button" className="ru-temp-end" onClick={() => endTemp(t.cap)}>End now</button>
                    </li>
                  ))}
                </ul>
              )}
              {adding ? (
                <div className="ru-temp-form">
                  <div className="ba-field">
                    <label>Capability</label>
                    <select value={tCap} onChange={(e) => setTCap(e.target.value)}>
                      <option value="">Choose a capability…</option>
                      {grantable.map((g) => (
                        <optgroup key={g.key} label={g.label}>
                          {g.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="ba-field">
                    <label>Until</label>
                    <input type="date" value={tUntil} min={minUntil} max={maxUntil} onChange={(e) => setTUntil(e.target.value)} />
                  </div>
                  <div className="ba-field">
                    <label>Reason</label>
                    <input value={tReason} onChange={(e) => setTReason(e.target.value)} placeholder="e.g. Covering AP while Budi is on leave" />
                  </div>
                  <div className="ru-temp-form-btns">
                    <button type="button" className="drawer-btn ghost" onClick={() => setAdding(false)}>Cancel</button>
                    <button type="button" className="drawer-btn primary" disabled={!tValid} onClick={addTemp}>Add</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="ru-acct-btn" onClick={startAdding}>
                  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add temporary access
                </button>
              )}
            </div>
          )}

          {/* Live SoD feedback */}
          {blocked && (
            <div className="ru-sod-banner hard">
              <div className="ru-sod-banner-hdr">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
                Segregation of duties conflict — blocked
                <SodInfo mode={sodMode} iconOnly align="right" />
              </div>
              <p>{sod.decision.blocked.map((r) => r.label).join("; ")} can't be held by one person.</p>
              <p className="ru-sod-banner-note">
                {sod.decision.blocked.some((r) => r.forbidden)
                  ? "This capability is never allowed. Remove the role or temporary grant that gives it."
                  : sodMode === "RELAXED"
                    ? "This combination can't be accepted even in Relaxed mode. Remove one of the conflicting roles or temporary grants."
                    : "Segregation of duties is Enforced for this company, so hard conflicts can't be given to one person. Remove one of the conflicting roles or temporary grants."}
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
              {temp.length > 0 && (
                <div className="drawer-row">
                  <span className="drawer-label">Temporary</span>
                  <span className="drawer-value">{temp.map((t) => `${capName(t.cap)} (until ${fmtDay(t.until)})`).join(", ")}</span>
                </div>
              )}
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
  // Users are shared (PeopleContext) with the Roles tab.
  const { users, setUsers } = usePeople();
  const { log } = useSettingsAudit();
  // Seeing the list is settings.users.view; inviting and changing roles is
  // settings.users.manage (Admin).
  const canManageUsers = useCurrentUser().hasCapability("settings.users.manage");
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
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.roleKeys.some((k) => roleName(k).toLowerCase().includes(q))
      );
    });
  }, [users, statusFilter, roleFilter, search]);

  function handleRowAction(action, user) {
    if (action === "deactivate") {
      setUsers((cur) => cur.map((u) => (u.id === user.id ? { ...u, status: "Inactive" } : u)));
      log("Users & Roles", "Users", `Deactivated ${user.name}`);
      showToast(`${user.name} deactivated.`);
      return;
    }
    if (action === "reactivate") {
      setUsers((cur) => cur.map((u) => (u.id === user.id ? { ...u, status: "Active" } : u)));
      log("Users & Roles", "Users", `Reactivated ${user.name}`);
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
        { id, name: data.name, email: data.email, roleKeys: data.roleKeys, status: "Invited", approval_limit: data.approval_limit, lastActive: null, invitedOn: "2026-06-07", ...riskFields },
        ...cur,
      ]);
      log("Users & Roles", "Users", `Invited ${data.name} as ${data.roleKeys.map(roleName).join(", ")}`);
      showToast(`Invitation sent to ${data.email}.`);
    } else {
      setUsers((cur) => cur.map((u) => (u.id === id ? { ...u, roleKeys: data.roleKeys, tempAccess: data.tempAccess, extraCaps: data.extraCaps, approval_limit: data.approval_limit, ...riskFields } : u)));
      const before = users.find((u) => u.id === id);
      const roles = (keys) => keys.map(roleName).join(", ") || "none";
      if (before && roles(before.roleKeys) !== roles(data.roleKeys)) log("Users & Roles", "Users", `${data.name}: roles ${roles(before.roleKeys)} → ${roles(data.roleKeys)}`);
      if (JSON.stringify(before?.tempAccess || []) !== JSON.stringify(data.tempAccess || [])) log("Users & Roles", "Users", `${data.name}: temporary access changed`);
      showToast(owner ? `User updated — risk accepted by ${owner.name}.` : "User updated.");
    }
    setDrawer(null);
  }

  return (
    <div className="lg-page users-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Users & Roles"
          tabs={USERS_TABS}
          intro={<>
            Who has access and which roles they hold. Role assignments are checked against the
            segregation-of-duties rules — click any role chip to see what it can do. To give one person
            extra access for a while, add <b>temporary access</b> on their user.
          </>}
          actions={canManageUsers && (
            <button type="button" className="lg-btn-brand" onClick={() => setDrawer({ mode: "invite" })}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Invite user
            </button>
          )}
        />

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
                  placeholder="Search name, email, or role…"
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
              {roleFilter !== "all" && (
                <button
                  type="button"
                  className="ru-filter-clear"
                  onClick={() => setRoleFilter("all")}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="lg-col-header ru-users-cols">
              <div>User</div>
              <div>Roles</div>
              <div>Status</div>
            </div>

            {filtered.length === 0 && <div className="lg-empty">No users in this view.</div>}

            {filtered.map((u, i) => {
              const sod = u.status !== "Inactive" ? evaluateSod(u.roleKeys, { extraCaps: u.extraCaps || [] }) : { level: "none" };
              return (
                <div
                  key={u.id}
                  className={`lg-row ru-users-cols${i % 2 === 1 ? " alt" : ""}`}
                  onClick={() => canManageUsers && setDrawer({ mode: "edit", user: u })}
                >
                  <div className="ru-user-cell">
                    <span className="ru-user-av">{initials(u.name)}</span>
                    <span className="ru-user-id">
                      <span className="ru-user-name">{u.name}</span>
                      <span className="ru-user-email">{u.email}</span>
                    </span>
                  </div>
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
                    {u.tempAccess?.length > 0 && (
                      <span
                        className="ru-temp-chip"
                        title={u.tempAccess.map((t) => `${capName(t.cap)} until ${fmtDay(t.until)} — ${t.reason}`).join("\n")}
                      >
                        +{u.tempAccess.length} temporary
                      </span>
                    )}
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
