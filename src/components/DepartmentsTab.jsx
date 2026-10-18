import { useState } from "react";
import { Link } from "react-router-dom";
import { useDimensions } from "../state/DimensionsContext";
import "../pages/roles.css";

// Settings → Company → Departments, modelled on Ramp (Company → People →
// Departments). A department is org structure — where a person sits — and is
// managed here by whoever manages users. It is mapped to a value of the
// Department dimension (Settings → Accounting → Dimensions), the way Ramp maps a
// department to an ERP value, so org structure and transaction tagging line up
// without making the dimension list itself the department list.

function DepartmentModal({ dept, departments, onSave, onClose }) {
  const { valuesOf } = useDimensions();
  const dimValues = valuesOf("dept");
  const isNew = !dept;
  const [name, setName] = useState(dept?.name || "");
  // A new department defaults to the dimension value of the same name, if any.
  const [dimValue, setDimValue] = useState(dept ? dept.dimValue || "" : "");
  const trimmed = name.trim();
  const clash = departments.some((d) => d.id !== dept?.id && d.name.toLowerCase() === trimmed.toLowerCase());
  const ok = trimmed.length >= 2 && !clash;

  function onName(v) {
    setName(v);
    if (isNew) {
      const match = dimValues.find((x) => x.toLowerCase() === v.trim().toLowerCase());
      if (match) setDimValue(match);
    }
  }

  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">{isNew ? "Create department" : `Edit ${dept.name}`}</div>
        <label className="rl-field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => onName(e.target.value)} placeholder="e.g. Finance" />
          {clash && <em className="rl-field-err">A department with this name already exists.</em>}
        </label>
        <label className="rl-field">
          <span>Department value in accounting</span>
          <select value={dimValue} onChange={(e) => setDimValue(e.target.value)}>
            <option value="">Not mapped</option>
            {dimValues.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <em className="rl-field-hint" style={{ marginLeft: 0 }}>
            The Department dimension value this department stands for. Missing one? Add it in{" "}
            <Link to="/dimensions" className="ru-inline-link">General Ledger › Dimensions</Link>.
          </em>
        </label>
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="drawer-btn primary"
            disabled={!ok}
            onClick={() => onSave({ id: dept?.id, name: trimmed, dimValue: dimValue || null })}
          >
            {isNew ? "Create department" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DepartmentsTab({ departments, users, canManage, editing, setEditing, onSave, onDelete, onShowPeople }) {
  const countOf = (name) => users.filter((u) => u.status !== "Inactive" && u.department === name).length;
  const unassigned = users.filter((u) => u.status !== "Inactive" && !u.department).length;

  return (
    <div className="lg-table-wrap">
      <div className="lg-card ru-dept-card">
        <div className="lg-col-header ru-dept-cols">
          <div>Department</div>
          <div>Department value</div>
          <div>People</div>
          <div />
        </div>
        {departments.length === 0 && <div className="lg-empty">No departments yet.</div>}
        {departments.map((d, i) => {
          const n = countOf(d.name);
          return (
            <div key={d.id} className={`lg-row ru-dept-cols${i % 2 === 1 ? " alt" : ""}`} onClick={() => canManage && setEditing(d)}>
              <div className="ru-dept-name">{d.name}</div>
              <div>{d.dimValue ? <span className="ru-role-chip">{d.dimValue}</span> : <span className="ru-dept-unmapped">Not mapped</span>}</div>
              <div>
                <button type="button" className="ru-inline-link ru-dept-count" onClick={(e) => { e.stopPropagation(); onShowPeople(d.name); }}>
                  {n} {n === 1 ? "person" : "people"}
                </button>
              </div>
              <div className="ru-dept-actions">
                {canManage && (
                  <button
                    type="button"
                    className="ru-temp-end"
                    disabled={n > 0}
                    title={n > 0 ? "Move everyone out of this department first" : ""}
                    onClick={(e) => { e.stopPropagation(); onDelete(d); }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div className="ru-dept-foot">
          {unassigned > 0 && (
            <button type="button" className="ru-inline-link ru-dept-count" onClick={() => onShowPeople("none")}>
              {unassigned} {unassigned === 1 ? "person has" : "people have"} no department
            </button>
          )}
          {!canManage && <span>Read only — managing departments needs the <em>Manage users</em> capability.</span>}
        </div>
      </div>

      {editing && (
        <DepartmentModal
          dept={editing === "new" ? null : editing}
          departments={departments}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
