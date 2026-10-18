import { useEffect, useRef, useState } from "react";
import { SOD_RULES, sodDecision } from "../data/seed/roles";
import "./sod-info.css";

// The company's segregation-of-duties mode, shown as a value with an ⓘ that
// explains it. The mode is set by Klay when the company is created (ADR-003) and
// can't be changed in the app, so there is no settings page for it — just this
// value and, in the popover, what it means and which conflicts it blocks.

const MODE_COPY = {
  ENFORCED: {
    label: "Enforced",
    means: "Hard conflicts can't be given to one person, through a role or temporary access. Soft conflicts need an independent person to accept the risk. Whoever submits a transaction can't also post it.",
  },
  RELAXED: {
    label: "Relaxed",
    means: "Conflicts can be given once an independent person accepts the risk, with a reason. One person can record and post; every self-post is flagged in the audit log.",
  },
};

function outcome(rule, mode) {
  if (rule.forbidden) return { cls: "no", text: "Never allowed" };
  return sodDecision([rule], mode).level === "blocked"
    ? { cls: "no", text: "Blocked" }
    : { cls: "risk", text: "Needs accepted risk" };
}

// `iconOnly` renders just the ⓘ (for inline use next to a message);
// `align="right"` opens the popover leftwards, for use near the right edge.
export default function SodInfo({ mode = "ENFORCED", iconOnly = false, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const copy = MODE_COPY[mode] || MODE_COPY.ENFORCED;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="sod-info" ref={ref}>
      {!iconOnly && (
        <span className="sod-info-value">
          Segregation of duties: <b className={mode === "RELAXED" ? "relaxed" : "enforced"}>{copy.label}</b>
        </span>
      )}
      <button
        type="button"
        className={`sod-info-btn${open ? " open" : ""}`}
        aria-label="About segregation of duties"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" /><line x1="8" y1="7.2" x2="8" y2="11" /><circle cx="8" cy="5" r=".6" /></svg>
      </button>
      {open && (
        <span className={`sod-pop ${align}`} role="dialog" aria-label="Segregation of duties">
          <span className="sod-pop-title">Segregation of duties: {copy.label}</span>
          <span className="sod-pop-p">{copy.means}</span>
          <span className="sod-pop-list">
            {SOD_RULES.map((r) => {
              const o = outcome(r, mode);
              return (
                <span key={r.id} className="sod-pop-rule" title={r.reason}>
                  <span>{r.label}</span>
                  <span className={`sod-pop-out ${o.cls}`}>{o.text}</span>
                </span>
              );
            })}
          </span>
          <span className="sod-pop-note">Set by Klay when the company was created. To change it, contact Klay support.</span>
        </span>
      )}
    </span>
  );
}
