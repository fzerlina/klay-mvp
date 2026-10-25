import { useEffect, useMemo, useRef, useState } from "react";
import { accountPath } from "../data/seed/coa";
import "./account-combobox.css";

// Account picker for manual journal lines (Core Ledger PRD §3, US-CL02).
// Search by code, name or group; each result shows where it sits in the chart
// ("Current Assets › Trade Receivables") so a 100-account chart is found by
// group, not memorised. Recent accounts lead when nothing is typed.
//
// Groups and inactive accounts never appear (the caller passes active leaf
// accounts). A control account stays visible but locked, with the reason as
// its tooltip — hiding it would read as a missing account. `blockOf(code)`
// returns that reason, or null.
export default function AccountCombobox({ value, onChange, accounts, recent = [], blockOf = () => null, placeholder = "Select account…", hint, invalid }) {
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

  const withPath = useMemo(() => accounts.map((a) => ({ ...a, path: accountPath(a) })), [accounts]);
  const selected = withPath.find((a) => a.code === value);

  // Options in display order, each tagged with its section heading.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const rec = recent.map((c) => withPath.find((a) => a.code === c)).filter(Boolean);
      const recSet = new Set(rec.map((a) => a.code));
      return [
        ...rec.map((a) => ({ ...a, section: "Recent" })),
        ...withPath.filter((a) => !recSet.has(a.code)).map((a) => ({ ...a, section: "All accounts" })),
      ];
    }
    const score = (a) => {
      if (a.code.toLowerCase().startsWith(q)) return 0;
      if (a.name.toLowerCase().startsWith(q)) return 1;
      if (a.name.toLowerCase().includes(q)) return 2;
      if (a.code.toLowerCase().includes(q)) return 3;
      if (a.path.some((p) => p.toLowerCase().includes(q))) return 4;
      return -1;
    };
    return withPath
      .map((a) => ({ a, s: score(a) }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => x.s - y.s || x.a.code.localeCompare(y.a.code))
      .map(({ a }) => ({ ...a, section: null }));
  }, [query, withPath, recent]);

  // Keys can arrive faster than React re-renders (ArrowDown then Enter), so
  // the handlers read the latest options and highlight from refs, not from a
  // closure that may be a render behind.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const activeRef = useRef(active);
  const moveTo = (i) => { activeRef.current = i; setActive(i); };
  const step = (from, dir) => {
    const opts = optionsRef.current;
    for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!blockOf(opts[i].code)) return i;
    return from;
  };

  function openList() {
    setOpen(true);
    setQuery("");
    const at = options.findIndex((o) => o.code === value);
    moveTo(at >= 0 ? at : step(-1, 1));
  }

  function pick(o) {
    if (!o || blockOf(o.code)) return;
    onChange(o.code);
    setOpen(false);
    setQuery("");
  }

  // Typing moves the highlight to the first account that can be picked — never
  // a locked one.
  useEffect(() => {
    if (query) moveTo(step(-1, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveTo(step(activeRef.current, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(step(activeRef.current, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(optionsRef.current[activeRef.current]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "Tab") setOpen(false);
  }

  const selectedBlock = selected && blockOf(selected.code);

  return (
    <div className={`acx${open ? " open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`acx-btn${invalid || selectedBlock ? " invalid" : ""}${!selected ? " empty" : ""}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); openList(); } }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Account ${selected.code} ${selected.name}${selectedBlock ? ` — locked: ${selectedBlock}` : ""}` : `Account: ${hint || placeholder}`}
        title={selectedBlock || undefined}
      >
        {selected ? (
          <span className="acx-val">
            <span className="acx-val-main">
              {selectedBlock && <LockIcon />}
              <span className="acx-code">{selected.code}</span>
              <span className="acx-name">{selected.name}</span>
            </span>
            <span className="acx-path">{selected.path.join(" › ")}</span>
          </span>
        ) : (
          <span className="acx-placeholder">{hint || placeholder}</span>
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
              placeholder="Search code, name or group…"
              aria-label="Search accounts"
            />
          </div>
          <div className="acx-list" role="listbox" ref={listRef}>
            {options.length === 0 && <div className="acx-empty">No account matches “{query}”.</div>}
            {options.map((o, i) => {
              const block = blockOf(o.code);
              const head = o.section && (i === 0 || options[i - 1].section !== o.section);
              return (
                <div key={o.code}>
                  {head && <div className="acx-section">{o.section}</div>}
                  <div
                    data-idx={i}
                    role="option"
                    aria-selected={o.code === value}
                    aria-disabled={!!block}
                    title={block || undefined}
                    className={`acx-opt${i === active ? " active" : ""}${o.code === value ? " selected" : ""}${block ? " locked" : ""}`}
                    onMouseEnter={() => !block && moveTo(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                  >
                    <div className="acx-opt-main">
                      <span className="acx-code">{o.code}</span>
                      <span className="acx-name">{o.name}</span>
                      {block && <span className="acx-lock"><LockIcon /> Locked</span>}
                    </div>
                    <div className="acx-path">{block || o.path.join(" › ")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg className="acx-lock-ic" viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
