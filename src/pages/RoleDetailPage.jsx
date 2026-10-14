import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import "./roles.css";
import { useRoles } from "../state/RolesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import CreateRoleModal from "../components/CreateRoleModal";
import SodRiskAcceptance, { riskAccepted } from "../components/SodRiskAcceptance";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { ROLES, USERS, capabilitySet, evaluateSod, evaluateSodSet, sodDecision } from "../data/seed/roles";
import { bandCeiling, defaultPolicy } from "../lib/approvalPolicy";
import {
  CAP_SECTIONS, VERB_COPY, approverScopes, canonicalId, capLabel, diffCaps, fmtRp, fmtRpShort,
  hasCap, sodInvolvement, toggleCap,
} from "../lib/roleCapabilities";

// Settings → Access → Roles → one role. Edits are a draft until saved; a save
// writes a new version of the role and applies to every holder at once, so the
// right-hand panel answers "what will this change do?" before it happens:
// conflicts inside the role, conflicts it would create for a holder in
// combination with their other roles, and how far the approval limit reaches
// against the payment approval bands.

const META_FIELDS = ["name", "description", "approval_limit"];

function initials(name) {
  return name.trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function Modal({ title, children, onClose }) {
  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function Check({ on, tone }) {
  return (
    <span className={`rl-check${on ? " on" : ""}${tone ? ` ${tone}` : ""}`} aria-hidden>
      <svg viewBox="0 0 12 12"><polyline points="2 6.5 5 9 10 3" /></svg>
    </span>
  );
}

export default function RoleDetailPage() {
  const { key } = useParams();
  const { roles, history } = useRoles();
  // Toast lives above the editor so it survives the remount that follows a save.
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2400);
  };
  const role = roles.find((r) => r.key === key);
  if (!role) {
    return (
      <div className="lg-page roles-page">
        <div className="rl-empty" style={{ marginTop: 60 }}>
          <b>This role doesn't exist.</b>
          <span>It may have been deleted.</span>
          <Link to="/roles" className="ru-inline-link">Back to roles</Link>
        </div>
      </div>
    );
  }
  // Remount the editor after every save/reset so the draft starts from the
  // newly saved version.
  const version = (history[key] || []).length;
  return (
    <>
      <RoleEditor key={`${key}:${version}`} role={role} showToast={showToast} />
      {toast && <div className="toast show">{toast}</div>}
    </>
  );
}

function RoleEditor({ role, showToast }) {
  const { capsOf, holdersOf, history, saveRole, deleteRole, acceptRisks } = useRoles();
  const { user, hasCapability } = useCurrentUser();
  const { sodMode } = useAccountingSettings();
  const navigate = useNavigate();
  const canManage = hasCapability("roles.manage");

  const saved = useMemo(() => ({ meta: { ...role }, caps: capsOf(role.key) }), [role, capsOf]);
  const [meta, setMeta] = useState(saved.meta);
  const [caps, setCaps] = useState(saved.caps);
  const [modal, setModal] = useState(null); // "save" | "history" | "delete" | "duplicate"
  const [justification, setJustification] = useState("");
  const [riskOwner, setRiskOwner] = useState("");

  const versions = history[role.key] || [];
  const latest = versions[versions.length - 1];
  const holders = holdersOf(role.key);

  // ── Derived: changes, approval, SoD ───────────────────────────────────────
  const scopes = approverScopes(caps);
  const isApprover = scopes.length > 0;
  // A limit means nothing without an approve capability — drop it on save.
  const effectiveLimit = isApprover ? meta.approval_limit : null;

  const capChanges = diffCaps(saved.caps, caps);
  const metaChanges = META_FIELDS.filter((f) =>
    f === "approval_limit" ? effectiveLimit !== saved.meta.approval_limit : (meta[f] ?? "") !== (saved.meta[f] ?? ""),
  );
  const changeCount = capChanges.length + metaChanges.length;
  const dirty = changeCount > 0;

  // Segregation of duties follows the entity's mode (Settings → Access policy),
  // exactly as the backend does: ENFORCED blocks HARD conflicts; RELAXED lets a
  // relaxable HARD conflict through once a risk is accepted. SOFT conflicts
  // always need an accepted risk; the forbidden capability is always blocked.
  const capSet = useMemo(() => capabilitySet(caps), [caps]);
  const roleRules = useMemo(() => evaluateSodSet(capSet).all, [capSet]);
  const roleDecision = sodDecision(roleRules, sodMode);
  const involved = useMemo(() => sodInvolvement(capSet, sodMode), [capSet, sodMode]);

  // Conflicts this draft would CREATE for a holder in combination with their
  // other roles. Pre-existing ones (e.g. a flagged lean-team self-review) are
  // not re-litigated on every edit — only new ones count — and conflicts inside
  // the role itself are already reported once above, not per holder.
  const holderImpact = useMemo(() => {
    const out = [];
    const inRole = new Set(roleRules.map((c) => c.id));
    for (const u of holders) {
      const before = evaluateSod(u.roleKeys, { extraCaps: u.extraCaps || [] });
      const after = evaluateSod(u.roleKeys, { extraCaps: u.extraCaps || [], override: { key: role.key, caps } });
      const had = new Set([...before.all.map((c) => c.id), ...inRole]);
      const fresh = after.all.filter((c) => !had.has(c.id));
      if (fresh.length) out.push({ user: u, rules: fresh, decision: sodDecision(fresh, sodMode) });
    }
    return out;
  }, [holders, caps, role.key, roleRules, sodMode]);

  const blockedHolder = holderImpact.find((h) => h.decision.level === "blocked");
  const blocked = roleDecision.level === "blocked" || !!blockedHolder;
  // One line for the save bar: the first rule standing in the way.
  const blockReason = roleDecision.blocked.length
    ? `${roleDecision.blocked[0].label} can't be in one role`
    : blockedHolder ? `${blockedHolder.user.name} would hold ${blockedHolder.decision.blocked[0].label}` : "";
  // Every rule that will be let through only as an accepted risk.
  const riskRules = [
    ...roleDecision.risk.map((r) => ({ rule: r, subject: `Role · ${meta.name.trim()}` })),
    ...holderImpact.flatMap((h) => h.decision.risk.map((r) => ({ rule: r, subject: `User · ${h.user.name}`, userId: h.user.id }))),
  ];
  const needsRisk = riskRules.length > 0;
  // An independent owner can't be the person saving, nor anyone whose access
  // this change alters (every holder, when the risk sits inside the role).
  const riskExclude = [user.id, ...(roleDecision.risk.length ? holders : holderImpact.map((h) => h.user)).map((u) => u.id)];
  const nameOk = meta.name.trim().length >= 2 &&
    !ROLES.some((r) => r.key !== role.key && r.name.trim().toLowerCase() === meta.name.trim().toLowerCase());
  const limitOk = !isApprover || meta.approval_limit == null || meta.approval_limit > 0;
  const canSave = canManage && dirty && !blocked && nameOk && limitOk;

  // ── Actions ────────────────────────────────────────────────────────────────
  const setField = (f, v) => setMeta((m) => ({ ...m, [f]: v }));
  const flip = (module, cap) => canManage && setCaps((c) => toggleCap(c, module, cap));
  const discard = () => { setMeta(saved.meta); setCaps(saved.caps); };

  function changeNote() {
    const parts = [];
    const added = capChanges.filter((c) => c.change === "added").map((c) => capLabel(c.module, c.cap));
    const removed = capChanges.filter((c) => c.change === "removed").map((c) => capLabel(c.module, c.cap));
    if (added.length) parts.push(`Added ${added.join(", ")}`);
    if (removed.length) parts.push(`Removed ${removed.join(", ")}`);
    if (metaChanges.includes("approval_limit")) parts.push(`Approval limit ${fmtRp(saved.meta.approval_limit)} → ${fmtRp(effectiveLimit)}`);
    const other = metaChanges.filter((f) => f !== "approval_limit");
    if (other.length) parts.push(`Edited ${other.map((f) => ({ name: "name", description: "description" }[f])).join(", ")}`);
    return parts.join("; ") || "Updated";
  }

  function commit() {
    const owner = needsRisk ? USERS.find((u) => u.id === riskOwner) : null;
    const note = changeNote() + (owner ? ` — risk accepted by ${owner.name}: “${justification.trim()}”` : "");
    saveRole({ ...meta, name: meta.name.trim(), approval_limit: effectiveLimit }, caps, { by: user.name, note });
    if (owner) {
      for (const subject of new Set(riskRules.map((r) => r.subject))) {
        const entries = riskRules.filter((r) => r.subject === subject);
        acceptRisks({
          rules: entries.map((r) => r.rule), subject, roleKey: role.key, userId: entries[0].userId || null,
          justification: justification.trim(), owner: owner.name, by: user.name, mode: sodMode,
        });
      }
    }
    setModal(null);
    showToast(`Saved ${meta.name.trim()} as version ${versions.length + 1}`);
  }

  function doDelete() {
    if (deleteRole(role.key)) navigate("/roles");
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function capRow(section, id, label, desc) {
    const on = hasCap(caps, section.key, id);
    const sod = on ? involved.get(canonicalId(section.key, id)) : null;
    return (
      <label key={id} className={`rl-cap${on ? " on" : ""}${sod ? ` sod-${sod}` : ""}${canManage ? "" : " ro"}`}>
        <input type="checkbox" checked={on} disabled={!canManage} onChange={() => flip(section.key, id)} />
        <Check on={on} tone={sod} />
        <span className="rl-cap-body">
          <span className="rl-cap-label">
            {label}
            {sod && (
              <span
                className={`rl-sod-tag ${sod}`}
                title={sod === "hard" ? "Blocked by segregation of duties in this entity's mode" : "Allowed only once an independent owner accepts the risk"}
              >
                {sod === "hard" ? "Blocked" : "Risk"}
              </span>
            )}          </span>
          <span className="rl-cap-desc">{desc}</span>
        </span>
      </label>
    );
  }

  const policy = defaultPolicy();
  const paysOut = hasCap(caps, "ap", "payment.approve");

  return (
    <div className="lg-page roles-page rl-detail">
      <div className="lg-scroll-container">
        <div className="rl-head">
          <div className="rl-crumb">
            <Link to="/roles">Roles</Link>
            <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
            <span>{role.name}</span>
          </div>
          <div className="rl-head-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title rl-title">
                {role.name}
              </h1>
              <div className="rl-head-meta">
                <span className="rl-ver">v{latest?.v || 1}</span>
                <button type="button" className="rl-link" onClick={() => setModal("history")}>History</button>
                <span>·</span>
                <span>Last changed {latest ? `${fmtDate(latest.at)} by ${latest.by}` : "—"}</span>
                <span>·</span>
                <span>{holders.length} {holders.length === 1 ? "person holds" : "people hold"} this role</span>
              </div>
            </div>
            {canManage && (
              <div className="rl-head-actions">
                <button type="button" className="rl-btn" onClick={() => setModal("duplicate")}>Duplicate</button>
                <button
                  type="button"
                  className="rl-btn danger"
                  disabled={holders.length > 0}
                  title={holders.length ? "Remove this role from everyone who holds it first" : ""}
                  onClick={() => setModal("delete")}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {!canManage && (
          <div className="rl-ro-banner">
            You're viewing as <strong>{user.name}</strong>, who can't edit roles. Only people with the{" "}
            <em>Manage roles</em> capability (such as the Admin role) can change them — switch persona to edit.
          </div>
        )}

        <div className="rl-body">
          <div className="rl-main">
            {/* ── Details ─────────────────────────────────────────────── */}
            <section className="rl-card-sec">
              <h2 className="rl-sec-title">Details</h2>
              <div className="rl-form-grid">
                <label className="rl-field span2">
                  <span>Role name</span>
                  <input
                    value={meta.name}
                    disabled={!canManage}
                    onChange={(e) => setField("name", e.target.value)}
                  />
                  {!nameOk && <em className="rl-field-err">Use a unique name of at least 2 characters.</em>}
                </label>
                <label className="rl-field span2">
                  <span>Description</span>
                  <textarea rows={3} value={meta.description || ""} disabled={!canManage} onChange={(e) => setField("description", e.target.value)} placeholder="What this role is for, and what it deliberately can't do." />
                </label>
              </div>
            </section>

            {/* ── Capabilities ────────────────────────────────────────── */}
            <div className="rl-sec-head">
              <h2 className="rl-sec-title">Capabilities</h2>
              <p>
                Capabilities are independent — holding Approve doesn't grant Post, and Post doesn't grant Approve.
              </p>
            </div>
            {CAP_SECTIONS.map((s) => {
              const total = s.verbs.length + s.named.length;
              if (!total) return null;
              const granted = [...s.verbs, ...s.named.map((n) => n.id)].filter((c) => hasCap(caps, s.key, c)).length;
              return (
                <section key={s.key} className="rl-card-sec rl-mod">
                  <header className="rl-mod-head">
                    <div>
                      <b>{s.label}</b>
                      <span>{s.desc}</span>
                    </div>
                    <span className={`rl-mod-count${granted ? " some" : ""}`}>{granted ? `${granted} of ${total}` : "No access"}</span>
                  </header>
                  {s.verbs.length > 0 && (
                    <div className="rl-verbs">
                      {s.verbs.map((v) => capRow(s, v, VERB_COPY[v].label, VERB_COPY[v].desc))}
                    </div>
                  )}
                  {s.named.length > 0 && (
                    <div className="rl-named">
                      {s.named.map((n) => capRow(s, n.id, n.label, n.desc))}
                    </div>
                  )}
                </section>
              );
            })}

            {/* ── Approval limit ──────────────────────────────────────── */}
            <section className="rl-card-sec">
              <h2 className="rl-sec-title">Approval limit</h2>
              <p className="rl-sec-p">
                The <Link to="/approval" className="ru-inline-link">approval workflow</Link> decides who is asked to
                approve a record and at which amounts. The approval limit is a ceiling on top of that: a holder can't
                approve anything above it, even when the workflow routes it to them.
              </p>
              {isApprover ? (
                <div className="rl-limit">
                  <label className={`rl-limit-opt${meta.approval_limit != null ? " on" : ""}`}>
                    <input
                      type="radio"
                      name="limit"
                      disabled={!canManage}
                      checked={meta.approval_limit != null}
                      onChange={() => setField("approval_limit", saved.meta.approval_limit ?? 50000000)}
                    />
                    <span>Up to</span>
                    <span className="rl-rp">
                      Rp
                      <input
                        inputMode="numeric"
                        disabled={!canManage || meta.approval_limit == null}
                        value={meta.approval_limit != null ? meta.approval_limit.toLocaleString("id-ID") : ""}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, ""));
                          setField("approval_limit", Number.isFinite(n) ? n : 0);
                        }}
                      />
                    </span>
                    <span className="rl-limit-hint">per record</span>
                  </label>
                  <label className={`rl-limit-opt${meta.approval_limit == null ? " on" : ""}`}>
                    <input
                      type="radio"
                      name="limit"
                      disabled={!canManage}
                      checked={meta.approval_limit == null}
                      onChange={() => setField("approval_limit", null)}
                    />
                    <span>No ceiling</span>
                    <span className="rl-limit-hint">only the workflow's ranges apply</span>
                  </label>
                  {!limitOk && <em className="rl-field-err">Enter an amount above 0, or choose No ceiling.</em>}
                </div>
              ) : (
                <div className="rl-muted-box">
                  This role has no approve capability, so it has no approval limit. Grant <em>Approve</em> on a module
                  or <em>Approve payment</em> to set one.
                </div>
              )}
            </section>
          </div>

          {/* ── Side panel ─────────────────────────────────────────────── */}
          <aside className="rl-side">
            {dirty && (
              <div className="rl-panel rl-impact">
                <h3>Your changes</h3>
                <ul className="rl-diff">
                  {capChanges.map((c) => (
                    <li key={`${c.module}-${c.cap}`} className={c.change}>
                      <span>{c.change === "added" ? "+" : "−"}</span>{capLabel(c.module, c.cap)}
                    </li>
                  ))}
                  {metaChanges.includes("approval_limit") && (
                    <li className="edited"><span>~</span>Limit {fmtRp(saved.meta.approval_limit)} → {fmtRp(effectiveLimit)}</li>
                  )}
                  {metaChanges.filter((f) => f !== "approval_limit").map((f) => (
                    <li key={f} className="edited"><span>~</span>{{ name: "Name", description: "Description" }[f]}</li>
                  ))}
                </ul>
                <p className="rl-impact-who">
                  Applies to <strong>{holders.length} {holders.length === 1 ? "person" : "people"}</strong> as soon as you save.
                </p>
              </div>
            )}

            <div className="rl-panel">
              <h3>Approvals</h3>
              {isApprover ? (
                <>
                  <p className="rl-panel-p">Holders can be picked as approvers for:</p>
                  <div className="rl-scope-chips">
                    {scopes.map((s) => <span key={s.key} className="rl-scope">{s.label}</span>)}
                  </div>
                  <div className="rl-kv"><span>Approval limit</span><b>{fmtRp(effectiveLimit)}</b></div>
                  {paysOut && (
                    <div className="rl-bands">
                      <div className="rl-bands-h">Against the payment approval bands</div>
                      {policy.bands.map((b, i) => {
                        const ceil = bandCeiling(policy.bands, i);
                        const range = ceil == null
                          ? `≥ ${fmtRpShort(b.from)}`
                          : b.from === 0 ? `< ${fmtRpShort(ceil)}` : `${fmtRpShort(b.from)} – < ${fmtRpShort(ceil).replace("Rp ", "")}`;
                        let st, cls;
                        if (b.approvals === 0) { st = "No approval needed"; cls = "muted"; }
                        else if (effectiveLimit == null || (ceil != null && effectiveLimit >= ceil - 1)) { st = "Covered"; cls = "ok"; }
                        else if (effectiveLimit >= b.from) { st = `Up to ${fmtRpShort(effectiveLimit)}`; cls = "part"; }
                        else { st = "Above this limit"; cls = "no"; }
                        return (
                          <div key={b.id} className="rl-band">
                            <span className="rl-band-r">{range}<em>{b.approvals} approval{b.approvals === 1 ? "" : "s"}</em></span>
                            <span className={`rl-band-s ${cls}`}>{st}</span>
                          </div>
                        );
                      })}
                      <Link to="/approval" className="ru-inline-link rl-bands-link">Payment approval settings →</Link>
                    </div>
                  )}
                </>
              ) : (
                <p className="rl-panel-p">Holders can't approve anything — they won't appear in approver pickers.</p>
              )}
            </div>

            <div className="rl-panel">
              <h3>People with this role <span className="rl-count">{holders.length}</span></h3>
              {holders.length === 0 && <p className="rl-panel-p">Nobody holds this role yet.</p>}
              <ul className="rl-holders">
                {holders.slice(0, 8).map((u) => (
                  <li key={u.id}>
                    <span className="rl-av">{initials(u.name)}</span>
                    <span className="rl-holder">
                      <b>{u.name}</b>
                      <span>
                        {u.status === "Invited" ? "Invited · " : ""}
                        {u.department ? `${u.department} · ` : ""}
                        {u.roleKeys.length > 1
                          ? `Also ${u.roleKeys.filter((k) => k !== role.key).map((k) => ROLES.find((r) => r.key === k)?.name || k).join(", ")}`
                          : "Only this role"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <Link to={`/users?role=${role.key}`} className="ru-inline-link rl-holders-more">
                {holders.length > 8 ? `See all ${holders.length} in Users →` : "Manage in Users →"}
              </Link>
            </div>
          </aside>
        </div>
        <div style={{ height: 24 }} />
      </div>

      {dirty && canManage && (
        <div className="rl-savebar">
          <span>
            <strong>{changeCount} unsaved change{changeCount === 1 ? "" : "s"}</strong>
            {blocked
              ? ` · can't save: ${blockReason}`
              : needsRisk ? " · needs an accepted risk to save" : ` · saves as version ${versions.length + 1}`}
          </span>
          <div className="rl-savebar-btns">
            <button type="button" className="drawer-btn ghost" onClick={discard}>Discard</button>
            <button type="button" className="drawer-btn primary" disabled={!canSave} onClick={() => { setJustification(""); setRiskOwner(""); setModal("save"); }}>
              Save changes
            </button>
          </div>
        </div>
      )}

      {modal === "save" && (
        <Modal title={`Save ${changeCount} change${changeCount === 1 ? "" : "s"} to ${meta.name.trim()}?`} onClose={() => setModal(null)}>
          <p className="rl-modal-body">
            This becomes version {versions.length + 1}. It applies immediately to the{" "}
            {holders.length} {holders.length === 1 ? "person" : "people"} holding this role. The previous version stays
            in the role's history and the audit trail.
          </p>
          <ul className="rl-diff in-modal">
            {capChanges.map((c) => (
              <li key={`${c.module}-${c.cap}`} className={c.change}><span>{c.change === "added" ? "+" : "−"}</span>{capLabel(c.module, c.cap)}</li>
            ))}
            {metaChanges.includes("approval_limit") && (
              <li className="edited"><span>~</span>Limit {fmtRp(saved.meta.approval_limit)} → {fmtRp(effectiveLimit)}</li>
            )}
          </ul>
          {needsRisk && (
            <SodRiskAcceptance
              rules={[...new Map(riskRules.map((r) => [r.rule.id, r.rule])).values()]}
              justification={justification}
              setJustification={setJustification}
              ownerId={riskOwner}
              setOwnerId={setRiskOwner}
              excludeIds={riskExclude}
            />
          )}
          <div className="rl-modal-actions">
            <button type="button" className="drawer-btn ghost" onClick={() => setModal(null)}>Keep editing</button>
            <button type="button" className="drawer-btn primary" disabled={needsRisk && !riskAccepted(justification, riskOwner)} onClick={commit}>
              Save version {versions.length + 1}
            </button>
          </div>
        </Modal>
      )}

      {modal === "history" && (
        <Modal title="Version history" onClose={() => setModal(null)}>
          <p className="rl-modal-body">Every saved change to {role.name} creates a new version.</p>
          <ul className="rl-vlist">
            {versions.slice().reverse().map((v) => (
              <li key={v.v}>
                <span className="rl-ver">v{v.v}</span>
                <div>
                  <b>{v.note}</b>{v.v === latest?.v && <span className="rl-badge">Current</span>}
                  <span>{fmtDate(v.at)} · {v.by}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="rl-modal-actions">
            <button type="button" className="drawer-btn ghost" onClick={() => setModal(null)}>Close</button>
          </div>
        </Modal>
      )}

      {modal === "delete" && (
        <Modal title={`Delete ${role.name}?`} onClose={() => setModal(null)}>
          <p className="rl-modal-body">Nobody holds this role, so deleting it changes no one's access. This can't be undone.</p>
          <div className="rl-modal-actions">
            <button type="button" className="drawer-btn ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="drawer-btn rl-danger-btn" onClick={doDelete}>Delete role</button>
          </div>
        </Modal>
      )}

      {modal === "duplicate" && <CreateRoleModal fromKey={role.key} onClose={() => setModal(null)} />}
    </div>
  );
}
