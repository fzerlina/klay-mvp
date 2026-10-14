import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRoles } from "../state/RolesContext";
import { useCurrentUser } from "../state/CurrentUserContext";

// New role, either from scratch (no capabilities — the admin grants
// exactly what the job needs) or as a copy of an existing role. Called with
// `fromKey` it is the Duplicate flow and skips the choice.
export default function CreateRoleModal({ fromKey = "", onClose }) {
  const { roles, createRole } = useRoles();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const base = roles.find((r) => r.key === fromKey);
  const [name, setName] = useState(base ? `${base.name} (copy)` : "");
  const [start, setStart] = useState(base ? "copy" : "scratch"); // scratch | copy
  const [from, setFrom] = useState(fromKey || roles[0]?.key || "");
  const taken = roles.some((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
  const valid = name.trim().length >= 2 && !taken;

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    const key = createRole({ name, fromKey: start === "copy" ? from : null, by: user.name });
    onClose();
    navigate(`/roles/${key}`);
  }

  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <form className="rl-modal wide" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="rl-modal-title">{base ? `Duplicate ${base.name}` : "Create role"}</div>
        <p className="rl-modal-body">
          A role is a named set of capabilities. You choose its capabilities on the next screen, and can change
          them at any time.
        </p>
        <label className="rl-field">
          <span>Role name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tax Staff" />
          {taken && <em className="rl-field-err">A role with this name already exists.</em>}
        </label>
        {!base && (
          <div className="rl-field">
            <span>Start</span>
            <div className="rl-type-opts">
              <button type="button" className={`rl-type${start === "scratch" ? " on" : ""}`} onClick={() => setStart("scratch")}>
                <span className={`rl-radio${start === "scratch" ? " on" : ""}`} />
                <span><b>From scratch</b><span>No capabilities. Grant exactly what the job needs.</span></span>
              </button>
              <button type="button" className={`rl-type${start === "copy" ? " on" : ""}`} onClick={() => setStart("copy")}>
                <span className={`rl-radio${start === "copy" ? " on" : ""}`} />
                <span><b>Copy an existing role</b><span>Start with its capabilities and approval limit, then adjust.</span></span>
              </button>
            </div>
            {start === "copy" && (
              <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Role to copy">
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>{r.name}</option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="drawer-btn primary" disabled={!valid}>
            {base ? "Duplicate role" : "Create role"}
          </button>
        </div>
      </form>
    </div>
  );
}
