// Transactions panel — what makes up a number on a report, without leaving it
// (CEO / CFO feedback, 16 Nov 2026: "see the list of journals contributing to
// that number without moving to another screen"). Opens on the right; the
// statement stays in view beside it.
//
// Two views:
//   • lines      One account's posted journal lines over a date range, from the
//                balance before it to the balance at its end, with a running
//                balance. The total must equal the number clicked, and the
//                panel says so (✓ / ✕), as the reports prove their totals.
//   • breakdown  A group's accounts with their amounts; picking one opens its
//                lines (Back returns to the group).
// Shared by the reports; the Balance Sheet is the first to use it.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./transactions-panel.css";

const num = (v) => {
  if (v == null) return "";
  if (Math.abs(v) < 0.005) return "—";
  const t = Math.abs(v).toLocaleString("id-ID");
  return v < 0 ? `(${t})` : t;
};
const SOURCE_LABEL = { bills: "Bill", invoices: "Invoice", payments: "Payment", fixedassets: "Depreciation", inventory: "Inventory", manual: "Manual journal", roll: "Year-end roll" };
const shortDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};
const ARROW = <svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>;

// view (lines): { kind: "lines", code, name, rangeLabel, opening: { label, amount },
//   closing: { label, amount }, lines: [{ key, date, je_number, source, docTo,
//   party, desc, amount (on the statement's side: + grows the balance), synthetic }],
//   glTo, note }
// view (breakdown): { kind: "breakdown", name, rangeLabel, rows: [{ code, name,
//   amount, computed, onOpen }], total: { label, amount } }
export default function TransactionsPanel({ view, onClose, onBack, backLabel }) {
  const ref = useRef(null);
  const [q, setQ] = useState("");
  useEffect(() => { setQ(""); }, [view]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { ref.current?.focus(); }, [view]);

  return (
    <aside className="txp no-print" ref={ref} tabIndex={-1} role="dialog" aria-label={`Transactions: ${view.name}`}>
      <div className="txp-head">
        {onBack && (
          <button type="button" className="txp-back" onClick={onBack}>
            <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>{backLabel || "Back"}
          </button>
        )}
        <div className="txp-title-row">
          <div className="txp-title">
            {view.code && <span className="txp-code">{view.code}</span>}
            <span className="txp-name">{view.name}</span>
          </div>
          <button type="button" className="txp-x" onClick={onClose} aria-label="Close transactions">×</button>
        </div>
        <div className="txp-sub">{view.rangeLabel}</div>
      </div>
      {view.kind === "lines" ? <Lines view={view} q={q} setQ={setQ} /> : <Breakdown view={view} />}
    </aside>
  );
}

function Lines({ view, q, setQ }) {
  const { opening, closing, lines } = view;
  // Running balance on every line, from the opening balance.
  const withBal = useMemo(() => {
    let bal = opening.amount;
    return lines.map((l) => { bal = Math.round((bal + l.amount) * 100) / 100; return { ...l, balance: bal }; });
  }, [lines, opening.amount]);
  const sum = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const ends = Math.round((opening.amount + sum) * 100) / 100;
  const ties = Math.abs(ends - closing.amount) < 0.5;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? withBal.filter((l) => [l.je_number, l.party, l.desc, SOURCE_LABEL[l.source]].some((s) => (s || "").toLowerCase().includes(needle)))
    : withBal;
  const dr = (l) => (l.amount > 0 ? l.amount : 0);
  const cr = (l) => (l.amount < 0 ? -l.amount : 0);

  // No export here (user, 16 Nov): the panel is for reading; the General
  // Ledger link below has the full ledger and its exports.
  return (
    <>
      <div className="txp-tools">
        <div className="lg-search txp-search">
          <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
          <input placeholder="Search journal, party or description…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="txp-count">{needle ? `${shown.length} of ${lines.length}` : lines.length} {lines.length === 1 ? "line" : "lines"}</span>
      </div>
      <div className="txp-body">
        <div className="txp-grid">
          <div className="txp-row txp-th">
            <span>Date</span><span>Journal · party · description</span>
            <span className="num">Increase</span><span className="num">Decrease</span><span className="num">Balance</span>
          </div>
          <div className="txp-row txp-open">
            <span className="txp-span2">{opening.label}</span>
            <span /><span /><span className="num">{num(opening.amount)}</span>
          </div>
          {shown.map((l) => (
            <div key={l.key} className={`txp-row${l.synthetic ? " txp-synth" : ""}`}>
              <span className="txp-date">{shortDay(l.date)}</span>
              {/* One column: journal and source on top, party and description under it. */}
              <span className="txp-detail">
                <span className="txp-je">
                  {l.je_number
                    ? <Link to={`/journal-entry/${encodeURIComponent(l.je_number)}`} target="_blank" rel="noopener" title="Open the journal in a new tab">{l.je_number}</Link>
                    : <em>—</em>}
                  <span className="txp-src">
                    {l.docTo ? <Link to={l.docTo} target="_blank" rel="noopener">{SOURCE_LABEL[l.source] || l.source}</Link> : (SOURCE_LABEL[l.source] || l.source)}
                  </span>
                </span>
                <span className="txp-desc" title={[l.party, l.desc].filter(Boolean).join(" — ")}>
                  {l.party && <span className="txp-party">{l.party}</span>}
                  <span className="txp-desc-txt">{l.desc}</span>
                </span>
              </span>
              <span className="num">{dr(l) ? num(dr(l)) : ""}</span>
              <span className="num">{cr(l) ? num(cr(l)) : ""}</span>
              <span className="num txp-bal">{num(l.balance)}</span>
            </div>
          ))}
          {needle && shown.length === 0 && <div className="txp-empty">No lines match “{q.trim()}”.</div>}
          {!lines.length && <div className="txp-empty">No postings in this range — the balance carried over unchanged.</div>}
        </div>
      </div>
      <div className="txp-foot">
        <div className="txp-sum">
          <span>{opening.label}</span><span className="num">{num(opening.amount)}</span>
          <span>{lines.length === 1 ? "1 line" : `${lines.length} lines`}, net</span><span className="num">{num(sum)}</span>
          <span className="txp-sum-total">{closing.label}</span><span className="num txp-sum-total">{num(ends)}</span>
        </div>
        <div className={`txp-tie ${ties ? "ok" : "off"}`}>
          {ties ? "✓ Matches the amount on the report" : `✕ Off the report by ${num(Math.round((closing.amount - ends) * 100) / 100)}`}
        </div>
        {view.note && <div className="txp-note">{view.note}</div>}
        {view.glTo && <Link className="txp-gl" to={view.glTo}>Open in General Ledger {ARROW}</Link>}
      </div>
    </>
  );
}

function Breakdown({ view }) {
  const sum = Math.round(view.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const ties = Math.abs(sum - view.total.amount) < 0.5;
  return (
    <>
      <div className="txp-body">
        <div className="txp-bd">
          {view.rows.map((r) => (
            <button type="button" key={r.code} className="txp-bd-row" onClick={r.onOpen} disabled={!r.onOpen} title={r.onOpen ? "Show this account's journal lines" : r.title}>
              <span className="txp-code">{r.computed ? "" : r.code}</span>
              <span className="txp-bd-name">{r.name}</span>
              <span className="num">{num(r.amount)}</span>
              <span className="txp-bd-go" aria-hidden="true">{r.onOpen ? "›" : ""}</span>
            </button>
          ))}
          {!view.rows.length && <div className="txp-empty">No accounts with a balance.</div>}
        </div>
      </div>
      <div className="txp-foot">
        <div className="txp-sum">
          <span className="txp-sum-total">{view.total.label}</span><span className="num txp-sum-total">{num(sum)}</span>
        </div>
        <div className={`txp-tie ${ties ? "ok" : "off"}`}>
          {ties ? "✓ Matches the amount on the report" : `✕ Off the report by ${num(Math.round((view.total.amount - sum) * 100) / 100)}`}
        </div>
      </div>
    </>
  );
}
