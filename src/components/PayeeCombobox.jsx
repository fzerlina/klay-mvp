import { useEffect, useMemo, useRef, useState } from "react";
import "./account-combobox.css";

// Payee picker for a journal line: the vendor master, searchable by name,
// vendor code, contact or email — a plain dropdown of every vendor got long.
// Employees are set up as vendors, so they're found here too. Built on the
// account picker's styles (AccountCombobox), in its compact size.
//
// `value` is "vendor:<id>" or "" (no payee), the form's line shape.
const TYPE_LABEL = { company: "Company", individual: "Individual" };

export default function PayeeCombobox({ value, onChange, vendors, ariaLabel = "Payee" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = vendors.find((v) => `vendor:${v.id}` === value) || null;

  // "No payee" leads once one is set, so it can be cleared from the list.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const score = (v) => {
      if (!q) return 0;
      const name = v.name.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
      if (name.includes(q)) return 2;
      if (String(v.code || "").toLowerCase().includes(q)) return 3;
      if (`${v.contact || ""} ${v.email || ""}`.toLowerCase().includes(q)) return 4;
      return -1;
    };
    const found = vendors
      .map((v) => ({ v, s: score(v) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.v.name.localeCompare(b.v.name))
      .map(({ v }) => ({ key: `vendor:${v.id}`, vendor: v }));
    return [...(value && !q ? [{ key: "", vendor: null }] : []), ...found];
  }, [query, vendors, value]);

  // Keys can outrun re-renders (ArrowDown then Enter): read the latest options
  // and highlight from refs, as the account picker does.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const activeRef = useRef(active);
  const moveTo = (i) => { activeRef.current = i; setActive(i); };

  function openList() {
    setOpen(true);
    setQuery("");
    const at = options.findIndex((o) => o.key === value);
    moveTo(at >= 0 ? at : 0);
  }
  function pick(o) {
    if (!o) return;
    onChange(o.key);
    setOpen(false);
    setQuery("");
  }
  useEffect(() => { if (query) moveTo(0); }, [query]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKey(e) {
    const n = optionsRef.current.length;
    if (e.key === "ArrowDown") { e.preventDefault(); moveTo(Math.min(activeRef.current + 1, n - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(Math.max(activeRef.current - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(optionsRef.current[activeRef.current]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className={`acx acx-sm${open ? " open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`acx-btn${!selected ? " empty" : ""}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); openList(); } }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `${ariaLabel}: ${selected.name}` : `${ariaLabel}: none`}
      >
        {selected ? (
          <span className="acx-val-main">
            <span className="acx-code">{selected.code}</span>
            <span className="acx-name">{selected.name}</span>
          </span>
        ) : (
          <span className="acx-placeholder">None</span>
        )}
        <svg className="acx-chev" viewBox="0 0 24 24" aria-hidden><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="acx-pop">
          <div className="acx-search">
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search name, vendor code or contact…"
              aria-label="Search payees"
            />
          </div>
          <div className="acx-list" role="listbox" ref={listRef}>
            {options.length === 0 && <div className="acx-empty">No vendor matches “{query}”.</div>}
            {options.map((o, i) => (
              <div
                key={o.key || "none"}
                data-idx={i}
                role="option"
                aria-selected={o.key === value}
                className={`acx-opt${i === active ? " active" : ""}${o.key === value ? " selected" : ""}`}
                onMouseEnter={() => moveTo(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                {o.vendor ? (
                  <>
                    <div className="acx-opt-main">
                      <span className="acx-code">{o.vendor.code}</span>
                      <span className="acx-name">{o.vendor.name}</span>
                    </div>
                    <div className="acx-path">
                      {[TYPE_LABEL[o.vendor.type], o.vendor.contact && o.vendor.contact !== o.vendor.name ? o.vendor.contact : null, o.vendor.email].filter(Boolean).join(" · ")}
                    </div>
                  </>
                ) : (
                  <div className="acx-opt-main"><span className="acx-name acx-none">No payee</span></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
