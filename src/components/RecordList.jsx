import { useState } from "react";
import { COA } from "../data/seed/coa";
import "../pages/roles.css";

// A settings list: a table of records with an add / edit modal, shared by the
// module settings pages (payment terms, categories, units, sites…). Columns
// say what the table shows; fields say what the modal edits. Field keys may be
// dotted ("accounts.cogs") to edit nested values.
//
//   columns: [{ key, label, width, render?(row) }]
//   fields:  [{ key, label, type: text|number|select|account|checkbox|textarea|list,
//               options?, required?, hint?, placeholder?, span2?, lockOnEdit? }]

export const LEAF_ACCOUNTS = COA.filter((a) => a.code && a.is_active).sort((a, b) => a.code.localeCompare(b.code));
export const accountName = (code) => COA.find((a) => a.code === code)?.name;

export function AccountCell({ code }) {
  if (!code) return <span className="mr-muted">—</span>;
  return <span><span className="mr-code">{code}</span> {accountName(code) || ""}</span>;
}

const getAt = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
function setAt(obj, path, value) {
  const [head, ...rest] = path.split(".");
  if (!rest.length) return { ...obj, [head]: value };
  return { ...obj, [head]: setAt(obj[head] || {}, rest.join("."), value) };
}

function FieldInput({ f, value, onChange, locked }) {
  if (f.type === "select") {
    return (
      <select value={value ?? ""} disabled={locked} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
        {!f.required && <option value="">{f.placeholder || "—"}</option>}
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.type === "account") {
    return (
      <select value={value ?? ""} disabled={locked} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{f.required ? "Choose an account…" : "Not used"}</option>
        {LEAF_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
      </select>
    );
  }
  if (f.type === "checkbox") {
    return (
      <label className="mr-check">
        <input type="checkbox" checked={!!value} disabled={locked} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.checkLabel || f.label}</span>
      </label>
    );
  }
  if (f.type === "textarea") {
    return <textarea rows={2} value={value ?? ""} disabled={locked} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === "list") {
    // One entry per line.
    return (
      <textarea rows={3} value={(value || []).join("\n")} disabled={locked} placeholder={f.placeholder}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trimStart()))} />
    );
  }
  return (
    <input
      type={f.type === "number" ? "text" : "text"}
      inputMode={f.type === "number" ? "decimal" : undefined}
      value={value ?? ""}
      disabled={locked}
      placeholder={f.placeholder}
      onChange={(e) => onChange(f.type === "number" ? (e.target.value === "" ? null : e.target.value.replace(/[^\d.]/g, "")) : e.target.value)}
    />
  );
}

function EditModal({ title, fields, row, isNew, onSave, onClose, validate }) {
  const [d, setD] = useState(row);
  const missing = fields.filter((f) => f.required && f.type !== "checkbox" && (getAt(d, f.key) == null || String(getAt(d, f.key)).trim() === ""));
  const error = validate ? validate(d, isNew) : null;
  const ok = missing.length === 0 && !error;
  const clean = (x) => {
    let out = x;
    for (const f of fields) {
      const v = getAt(out, f.key);
      if (f.type === "number") out = setAt(out, f.key, v == null || v === "" ? null : Number(v));
      if (f.type === "list") out = setAt(out, f.key, (v || []).map((s) => s.trim()).filter(Boolean));
      if (f.type === "text" && typeof v === "string") out = setAt(out, f.key, v.trim());
    }
    return out;
  };
  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">{title}</div>
        <div className="rl-form-grid">
          {fields.map((f) => (
            <label key={f.key} className={`rl-field${f.span2 || f.type === "textarea" || f.type === "list" ? " span2" : ""}`}>
              {f.type !== "checkbox" && <span>{f.label}{f.required && " *"}</span>}
              <FieldInput f={f} value={getAt(d, f.key)} locked={f.lockOnEdit && !isNew} onChange={(v) => setD((x) => setAt(x, f.key, v))} />
              {f.hint && <em className="rl-field-hint" style={{ marginLeft: 0 }}>{f.hint}</em>}
            </label>
          ))}
        </div>
        {error && <em className="rl-field-err">{error}</em>}
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="drawer-btn primary" disabled={!ok} onClick={() => onSave(clean(d))}>
            {isNew ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RecordList({
  title, intro, rows, rowKey, columns, fields, newRow = {}, noun = "item",
  canEdit, onSave, onDelete, deleteBlocked, validate, footer,
}) {
  const [editing, setEditing] = useState(null); // null | { row, isNew }
  const grid = columns.map((c) => c.width || "minmax(0,1fr)").join(" ") + (canEdit && onDelete ? " 70px" : "");
  return (
    <section className="mr-section">
      <div className="mr-head">
        <div>
          <div className="mr-title">{title} <span className="ru-section-cnt">{rows.length}</span></div>
          {intro && <p className="mr-intro">{intro}</p>}
        </div>
        {canEdit && (
          <button type="button" className="rl-btn" onClick={() => setEditing({ row: { ...newRow }, isNew: true })}>+ Add {noun}</button>
        )}
      </div>
      <div className="mr-table">
        <div className="mr-tr mr-th" style={{ gridTemplateColumns: grid }}>
          {columns.map((c) => <div key={c.key}>{c.label}</div>)}
          {canEdit && onDelete && <div />}
        </div>
        {rows.length === 0 && <div className="mr-empty">None yet.</div>}
        {rows.map((r) => {
          const blocked = deleteBlocked ? deleteBlocked(r) : null;
          return (
            <div
              key={r[rowKey]}
              className={`mr-tr${canEdit ? " editable" : ""}`}
              style={{ gridTemplateColumns: grid }}
              onClick={() => canEdit && setEditing({ row: r, isNew: false })}
            >
              {columns.map((c) => <div key={c.key} className="mr-td">{c.render ? c.render(r) : (getAt(r, c.key) ?? "—")}</div>)}
              {canEdit && onDelete && (
                <div className="mr-td mr-del">
                  <button
                    type="button"
                    className="ru-temp-end"
                    disabled={!!blocked}
                    title={blocked || ""}
                    onClick={(e) => { e.stopPropagation(); onDelete(r); }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {footer}
      {editing && (
        <EditModal
          title={editing.isNew ? `Add ${noun}` : `Edit ${noun}`}
          fields={fields}
          row={editing.row}
          isNew={editing.isNew}
          validate={validate}
          onClose={() => setEditing(null)}
          onSave={(row) => { onSave(row, editing.isNew ? null : editing.row[rowKey]); setEditing(null); }}
        />
      )}
    </section>
  );
}
