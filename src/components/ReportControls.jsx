// Toolbar popovers shared by the financial reports (Trial Balance, Profit &
// Loss): pick-one menus, the period picker, the dimension filter, saved views
// and the export menu. Styles live in pages/trial-balance.css (tb-* popover
// classes) and the shared lg-* classes.

import { useEffect, useRef, useState } from "react";
import { DIM_BY_KEY } from "../data/seed/dimensions";
import { rangeLabel } from "../lib/reportPeriods";
import { FILTER_DIMS } from "../pages/GlPanels";

export function useClickOutside(ref, onClose) {
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ref, onClose]);
}

export const Check = () => <svg className="lg-popover-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg>;

// A plain pick-one menu. An item can be `disabled`, with `title` saying why.
export function ChoicePopover({ items, value, onPick, onClose, className = "" }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className={`lg-popover ${className}`} ref={ref}>
      <div className="lg-popover-list">
        {items.map((it) => (
          <button key={it.k} className={`lg-popover-item${value === it.k ? " selected" : ""}`} disabled={it.disabled} title={it.title}
            onClick={() => onPick(it.k)}>
            <span>{it.lbl}</span>
            <span className="tb-period-range">{it.hint}{value === it.k && <Check />}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Period picker — the shared report presets, plus a custom from/to range. A
// preset can be `disabled` (with `title`) and carry its own `hint`.
export function PeriodPopover({ presets, period, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const invalid = !from || !to || from > to;
  return (
    <div className="lg-popover lg-filter-pop tb-period-pop" ref={ref}>
      <div className="lg-popover-list">
        {presets.map((p) => (
          <button key={p.key} className={`lg-popover-item${period.key === p.key ? " selected" : ""}`} disabled={p.disabled} title={p.title}
            onClick={() => onPick({ key: p.key })}>
            <span>{p.label}</span>
            <span className="tb-period-range">{p.hint ?? (p.from && p.to ? rangeLabel(p.from, p.to) : "")}{period.key === p.key && <Check />}</span>
          </button>
        ))}
      </div>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Custom range</div>
          <div className="lg-filter-row2">
            <input type="date" className="lg-filter-input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}>—</span>
            <input type="date" className="lg-filter-input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
          {from && to && from > to && <div className="tb-period-err">The start date is after the end date.</div>}
        </div>
      </div>
      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={onClose}>Cancel</button>
        <button className="lg-filter-apply" disabled={invalid} onClick={() => onPick({ key: "custom", from, to })}>Apply range</button>
      </div>
    </div>
  );
}

// Dimension filter — one dimension, one value. `keys` limits the dimensions
// offered; `note` explains what filtering does to this report.
export function DimensionPopover({ value, valuesOf, onApply, onClose, keys = FILTER_DIMS, note, applyLabel = "Apply", clearLabel }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [key, setKey] = useState(value?.key && keys.includes(value.key) ? value.key : keys[0]);
  const opts = valuesOf(key);
  const [val, setVal] = useState(value?.value && opts.includes(value.value) ? value.value : opts[0] || "");
  return (
    <div className="lg-popover lg-filter-pop tb-dim-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Dimension</div>
          <select className="lg-filter-input" value={key} onChange={(e) => { setKey(e.target.value); setVal(valuesOf(e.target.value)[0] || ""); }} aria-label="Dimension">
            {keys.map((k) => <option key={k} value={k}>{DIM_BY_KEY[k]?.label || k}</option>)}
          </select>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Value</div>
          <select className="lg-filter-input" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Dimension value">
            {opts.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        {note && <div className="tb-pop-note">{note}</div>}
      </div>
      <div className="lg-filter-foot">
        <button className="lg-filter-reset" onClick={() => onApply(null)}>{clearLabel || (value ? "Clear filter" : "Cancel")}</button>
        <button className="lg-filter-apply" disabled={!val} onClick={() => onApply({ key, value: val })}>{applyLabel}</button>
      </div>
    </div>
  );
}

// Saved views — a report's settings under a name.
export function ViewsPopover({ views, activeId, onApply, onDelete, onSave, onClose, emptyText = "No saved views yet. Set the report up the way you like, then save it here." }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const [name, setName] = useState("");
  const save = () => { if (name.trim()) { onSave(name.trim()); setName(""); } };
  return (
    <div className="lg-popover tb-views-pop" ref={ref}>
      <div className="lg-popover-section-lbl">Saved views</div>
      <div className="lg-popover-list">
        {views.length === 0 && (
          <div className="tb-pop-note" style={{ padding: "4px 10px 8px" }}>{emptyText}</div>
        )}
        {views.map((v) => (
          <div key={v.id} className="tb-view-item">
            <button className={`lg-popover-item${activeId === v.id ? " selected" : ""}`} onClick={() => onApply(v)}>
              <span>{v.name}</span>
              {activeId === v.id && <Check />}
            </button>
            <button className="tb-view-del" title="Delete view" aria-label={`Delete view ${v.name}`} onClick={() => onDelete(v.id)}>×</button>
          </div>
        ))}
      </div>
      <div className="lg-filter-foot tb-views-foot">
        <input className="lg-filter-input" placeholder="Name this view…" value={name} maxLength={40}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} aria-label="View name" />
        <button className="lg-filter-apply" disabled={!name.trim()} onClick={save}>Save</button>
      </div>
    </div>
  );
}

export function ExportPopover({ onXlsx, onCsv, onPrint, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  return (
    <div className="lg-popover" ref={ref}>
      <div className="lg-popover-list">
        <button className="lg-popover-item" onClick={onXlsx}>
          <span>Excel (.xlsx)</span>
          <span className="tb-period-range">with formulas</span>
        </button>
        <button className="lg-popover-item" onClick={onCsv}>CSV</button>
        <button className="lg-popover-item" onClick={onPrint}>Print / PDF</button>
      </div>
    </div>
  );
}

// Saved views kept per user in this browser — a per-viewer convenience.
export function loadLocal(key, fallback) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveLocal(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-viewer nicety only */ }
}
