// The review of one flagged account, anchored to its pill — positioned like
// the Trial Balance's review popover (fixed, so sideways scroll can't clip
// it). What moved, the biggest lines behind it, and a note: Mark reviewed
// needs a reason. A review that no longer covers the amount says so.
// Shared by the Profit & Loss (a period's activity: "in March") and the
// Balance Sheet (a balance on a date: "at 31 Mar 2025").

import { Fragment, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import VarianceReason from "./VarianceReason";

const rp = (v) => {
  if (v == null) return "—";
  const s = "Rp " + Math.abs(v).toLocaleString("id-ID");
  return v < 0 ? `(${s})` : s;
};

export default function VariancePopover({
  anchor, account, v, prevLabel, curLabel, rule, drivers, glTo, onSave, onReopen, onClose,
  prep = "in", driversTitle = "Biggest lines this period",
}) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (e.target.closest?.(`[data-review-code="${account.code}"]`)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [account.code, onClose]);
  const W = 380;
  const left = Math.max(12, Math.min(anchor.left - 12, window.innerWidth - W - 12));
  const below = anchor.bottom < window.innerHeight * 0.5;
  const style = below
    ? { position: "fixed", left, width: W, top: anchor.bottom + 6 }
    : { position: "fixed", left, width: W, bottom: window.innerHeight - anchor.top + 6 };
  const dir = v.pct === null ? `New vs ${prevLabel}` : `${v.delta > 0 ? "Up" : "Down"} ${Math.round(Math.abs(v.pct) * 100)}% vs ${prevLabel}`;
  return (
    <div className="lg-popover tb-review-pop pl-var-pop" ref={ref} style={style} role="dialog" aria-label={`Variance review: ${account.name}`}>
      <div className="tb-review-head">
        <span className="tb-review-code">{account.code}</span>
        <span className="tb-review-name">{account.name}</span>
      </div>
      <div className="tb-review-item">
        <div className={`tb-review-title${v.status === "reviewed" ? " pl-var-done" : ""}`}>{v.status === "reviewed" ? `Reviewed · ${dir}` : dir}</div>
        <div className="tb-review-desc">
          {rp(v.was)} {prep} {prevLabel} → {rp(v.cur)} {prep} {curLabel}, {v.delta > 0 ? "+" : "−"}{rp(Math.abs(v.delta))}.
          <span className="pl-var-rule"> Flagged for moves of {rule} or more.</span>
        </div>
        {drivers.length > 0 && (
          <>
            <div className="pl-var-sub">{driversTitle}</div>
            <div className="pl-var-lines">
              {drivers.map((d) => (
                <Fragment key={`${d.je}-${d.i}`}>
                  <Link className="pl-var-je" to={`/journal-entry/${encodeURIComponent(d.je)}`} onClick={onClose}>{d.je}</Link>
                  <span className="pl-var-desc" title={d.desc}>{d.desc}</span>
                  <span className="pl-var-amt">{Math.abs(d.amount).toLocaleString("id-ID")} {d.amount >= 0 ? "Dr" : "Cr"}</span>
                </Fragment>
              ))}
            </div>
          </>
        )}
        <VarianceReason review={v.review} status={v.status} onSave={onSave} onReopen={onReopen} />
        <Link className="tb-review-link" to={glTo} onClick={onClose}>
          Open in General Ledger <svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>
        </Link>
      </div>
    </div>
  );
}
