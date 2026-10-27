import { useEffect, useMemo, useRef, useState } from "react";
import { getActiveAccounts } from "../data/seed/coa";
import "./journal-template-menu.css";

// Journal templates (Settings → General Ledger → Journal templates) as a menu:
// opened from the New Manual Journal split button on the list, and from the
// template chip on the form. Each template shows its lines, so people pick by
// what it books rather than by name alone. `id` "" is a blank journal.
const ACCOUNT_NAME = Object.fromEntries(getActiveAccounts().map((a) => [a.code, a.name]));

export default function JournalTemplateMenu({ templates, current = null, showBlank = false, align = "right", onPick, onClose }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const named = (t) => t.name.toLowerCase().includes(q)
      || t.lines.some((l) => (ACCOUNT_NAME[l.account] || "").toLowerCase().includes(q));
    return [
      ...(showBlank && !q ? [{ id: "", name: "Blank journal", blank: true }] : []),
      ...templates.filter((t) => !q || named(t)),
    ];
  }, [templates, query, showBlank]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  // Only arrow keys scroll the list; a hover never does, or the list would
  // slide under a resting pointer.
  const byKey = useRef(false);
  useEffect(() => {
    if (!byKey.current) return;
    byKey.current = false;
    ref.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); byKey.current = true; setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); byKey.current = true; setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); onPick(items[active].id); }
  }

  return (
    <div className={`jtm jtm-${align}`} ref={ref} role="dialog" aria-label="Journal templates" onKeyDown={onKeyDown}>
      <div className="jtm-search">
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates or accounts…" aria-label="Search templates" />
      </div>
      <div className="jtm-list" role="listbox">
        {items.length === 0 && <div className="jtm-empty">No template matches “{query}”.</div>}
        {items.map((t, i) => (
          <button
            key={t.id || "blank"}
            type="button"
            role="option"
            aria-selected={i === active}
            data-idx={i}
            className={`jtm-item${i === active ? " active" : ""}${t.blank ? " blank" : ""}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(t.id)}
          >
            <span className="jtm-name">
              {t.name}
              {current === t.id && <svg className="jtm-check" viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3" /></svg>}
            </span>
            {t.blank ? (
              <span className="jtm-desc">Pick every account yourself.</span>
            ) : (
              <span className="jtm-lines">
                {t.lines.map((l, k) => (
                  <span key={k} className="jtm-line">
                    <em className={l.side}>{l.side === "debit" ? "Dr" : "Cr"}</em>
                    {l.account ? ACCOUNT_NAME[l.account] || l.account : <i>You pick the account</i>}
                  </span>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="jtm-foot">A template fills in the accounts — you add the amounts.</div>
    </div>
  );
}
