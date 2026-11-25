// Drill-down panel for the Director's Summary (user, 25 Nov 2026: directors
// drill down without leaving the report). The same right-hand panel shell as
// the statements' Transactions panel, plus a back button and a breadcrumb so
// a director can go several levels down — box → customer → invoice — and
// back up without the panel closing. Read only: no actions anywhere.
//
// It renders whatever lib/directorsDrill.js resolves for the top of the
// stack: blocks of rows (a row with `open` steps down a level), facts, a
// short history, and a footer total that is the number that was clicked.

import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import "./transactions-panel.css";
import "./summary-drill.css";

const money = (v) => {
  if (v == null) return "—";
  const n = Math.round(v);
  if (n === 0) return "—";
  const s = `Rp ${Math.abs(n).toLocaleString("id-ID")}`;
  return n < 0 ? `(${s})` : s;
};
const CHEV = <svg viewBox="0 0 12 12" aria-hidden="true"><polyline points="4 2 8 6 4 10" /></svg>;

export default function SummaryDrill({ spec, crumbs, onOpen, onBack, onJump, onChip, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (crumbs.length > 1) onBack(); else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [crumbs.length, onBack, onClose]);
  useEffect(() => { ref.current?.focus(); ref.current?.querySelector(".txp-body")?.scrollTo(0, 0); }, [spec.title, spec.crumb]);

  return (
    <aside className="txp sd no-print" ref={ref} tabIndex={-1} role="dialog" aria-label={`Details: ${spec.title}`}>
      <div className="txp-head">
        {crumbs.length > 1 && (
          <nav className="sd-crumbs" aria-label="Where you are">
            <button type="button" className="sd-back" onClick={onBack} aria-label="Back">
              <svg viewBox="0 0 12 12" aria-hidden="true"><polyline points="8 2 4 6 8 10" /></svg> Back
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="sd-crumb">
                {i > 0 && <span className="sd-sep">›</span>}
                {i < crumbs.length - 1
                  ? <button type="button" onClick={() => onJump(i)}>{c}</button>
                  : <b>{c}</b>}
              </span>
            ))}
          </nav>
        )}
        <div className="txp-title-row">
          <div className="txp-title">
            {spec.code && <span className="txp-code">{spec.code}</span>}
            <span className="txp-name">{spec.title}</span>
          </div>
          <button type="button" className="txp-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {spec.sub && <div className="txp-sub">{spec.sub}</div>}
        {spec.chips && spec.chips.length > 2 && (
          <div className="txp-chips sd-chips">
            {spec.chips.map((c) => (
              <button key={c.key || "all"} type="button" className={`txp-chip${c.on ? " on" : ""}`} onClick={() => onChip(c.key)}>{c.label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="txp-body sd-body">
        {spec.blocks.map((b, bi) => (
          <section key={bi} className="sd-block">
            {(b.head || b.cols) && (
              <div className="sd-head">
                <span>{b.head || ""}</span>
                {(b.cols || []).map((c) => <span key={c} className="num">{c}</span>)}
              </div>
            )}
            {b.facts && (
              <dl className="sd-facts">
                {b.facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd className={f.tone || undefined}>{f.v}</dd></div>)}
              </dl>
            )}
            {b.history && (
              <ul className="sd-history">
                {b.history.map((h, i) => <li key={i}><span>{h.date}</span>{h.text}</li>)}
              </ul>
            )}
            {b.rows && b.rows.length === 0 && <div className="txp-empty">Nothing here.</div>}
            {b.rows && b.rows.map((r) => {
              const body = (
                <>
                  <span className="sd-label">
                    <span className="sd-label-txt">{r.label}</span>
                    {r.meta && <span className={`sd-meta${r.tone ? ` ${r.tone}` : ""}`}>{r.meta}</span>}
                  </span>
                  {r.values.map((v, i) => <span key={i} className={`num${r.tone && i === 0 && r.values.length > 1 ? ` ${r.tone}` : ""}`}>{money(v)}</span>)}
                  <span className="sd-chev">{r.open ? CHEV : null}</span>
                </>
              );
              const cls = `sd-row${r.strong ? " strong" : ""}${r.open ? " open" : ""}`;
              return r.open
                ? <button key={r.key} type="button" className={cls} onClick={() => onOpen(r.open)}>{body}</button>
                : <div key={r.key} className={cls}>{body}</div>;
            })}
            {b.total && (
              <div className="sd-row sd-subtotal">
                <span className="sd-label"><span className="sd-label-txt">{b.total.label}</span></span>
                {b.total.values.map((v, i) => <span key={i} className="num">{money(v)}</span>)}
                <span className="sd-chev" />
              </div>
            )}
          </section>
        ))}
      </div>

      {(spec.foot || spec.report) && (
        <div className="txp-foot sd-foot">
          {spec.foot && (
            <div className="sd-total">
              <span>{spec.foot.label}</span>
              <b className={spec.foot.amount < -0.5 ? "neg" : undefined}>{money(spec.foot.amount)}</b>
            </div>
          )}
          {spec.report && (
            <Link className="txp-gl" to={spec.report.to} state={spec.report.state}>
              Open {spec.report.label} <svg viewBox="0 0 24 24"><path d="M7 17L17 7" /><path d="M8 7h9v9" /></svg>
            </Link>
          )}
        </div>
      )}
    </aside>
  );
}
