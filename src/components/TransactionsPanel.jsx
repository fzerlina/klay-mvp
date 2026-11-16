// Transactions panel — the journal lines behind a number on a report, without
// leaving the report (CEO / CFO feedback, 16 Nov 2026: a finance manager has to
// explain each number to the owner). Opens on the right; the statement stays
// in view.
//
// The statement already is the tree: groups expand to their accounts, and the
// Compare columns lay periods side by side. What it lacked is the level below
// an account (user, 16 Nov), so the panel shows one account's posted journal
// lines for one period — from the balance before it (balance-sheet accounts)
// or from nothing (P&L accounts), with a running total that must land on the
// number clicked — and steps from period to period over the report's columns
// (journal lines can't be compared side by side).
// Shared by the Balance Sheet and the Profit & Loss.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./transactions-panel.css";

const r2 = (v) => Math.round(v * 100) / 100;
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
const CHEV_L = <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>;
const CHEV_R = <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>;

// view (lines): { kind: "lines", code, name, rangeLabel,
//   periods: [{ id, label }], periodId, onPeriod(id),
//   opening: { label, amount } | null, closing: { label, amount },
//   lines: [{ key, date, je_number, source, docTo, party, desc,
//             amount (on the statement's side: + grows the number), synthetic }],
//   glTo, note }
export default function TransactionsPanel({ view, onClose }) {
  const ref = useRef(null);
  const [q, setQ] = useState("");
  useEffect(() => { setQ(""); }, [view.code, view.name]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { ref.current?.focus(); }, [view.code]);

  return (
    <aside className="txp no-print" ref={ref} tabIndex={-1} role="dialog" aria-label={`Journal lines: ${view.name}`}>
      <div className="txp-head">
        <div className="txp-title-row">
          <div className="txp-title">
            {view.code && <span className="txp-code">{view.code}</span>}
            <span className="txp-name">{view.name}</span>
          </div>
          <button type="button" className="txp-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="txp-sub">{view.rangeLabel}</div>
      </div>
      <Lines view={view} q={q} setQ={setQ} />
    </aside>
  );
}

// Step through the report's periods: one at a time, since journal lines don't
// line up across periods.
function PeriodSwitch({ periods, periodId, onPeriod }) {
  if (!periods || periods.length < 2) return null;
  const i = periods.findIndex((p) => p.id === periodId);
  return (
    <div className="txp-periods" role="group" aria-label="Period">
      <button type="button" className="txp-step" disabled={i <= 0} onClick={() => onPeriod(periods[i - 1].id)} aria-label="Previous column">{CHEV_L}</button>
      <div className="txp-chips">
        {periods.map((p) => (
          <button type="button" key={p.id} className={`txp-chip${p.id === periodId ? " on" : ""}`} aria-pressed={p.id === periodId} onClick={() => onPeriod(p.id)}>{p.label}</button>
        ))}
      </div>
      <button type="button" className="txp-step" disabled={i < 0 || i >= periods.length - 1} onClick={() => onPeriod(periods[i + 1].id)} aria-label="Next column">{CHEV_R}</button>
    </div>
  );
}

function Lines({ view, q, setQ }) {
  const { opening, closing, lines } = view;
  const start = opening ? opening.amount : 0;
  // Running balance (or running total) on every line.
  const withBal = useMemo(() => {
    let bal = start;
    return lines.map((l) => { bal = r2(bal + l.amount); return { ...l, balance: bal }; });
  }, [lines, start]);
  const sum = r2(lines.reduce((s, l) => s + l.amount, 0));
  const ends = r2(start + sum);
  const ties = Math.abs(ends - closing.amount) < 0.5;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? withBal.filter((l) => [l.je_number, l.party, l.desc, SOURCE_LABEL[l.source]].some((s) => (s || "").toLowerCase().includes(needle)))
    : withBal;
  const up = (l) => (l.amount > 0 ? l.amount : 0);
  const down = (l) => (l.amount < 0 ? -l.amount : 0);

  // No export here (user, 16 Nov): the panel is for reading; the General
  // Ledger link below has the full ledger and its exports.
  return (
    <>
      <PeriodSwitch periods={view.periods} periodId={view.periodId} onPeriod={view.onPeriod} />
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
            <span className="num">Increase</span><span className="num">Decrease</span><span className="num">{opening ? "Balance" : "Running total"}</span>
          </div>
          {opening && (
            <div className="txp-row txp-open">
              <span className="txp-span2">{opening.label}</span>
              <span /><span /><span className="num">{num(opening.amount)}</span>
            </div>
          )}
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
              <span className="num">{up(l) ? num(up(l)) : ""}</span>
              <span className="num">{down(l) ? num(down(l)) : ""}</span>
              <span className="num txp-bal">{num(l.balance)}</span>
            </div>
          ))}
          {needle && shown.length === 0 && <div className="txp-empty">No lines match “{q.trim()}”.</div>}
          {!lines.length && <div className="txp-empty">{opening ? "No postings in this period — the balance carried over unchanged." : "No postings in this period."}</div>}
        </div>
      </div>
      <div className="txp-foot">
        <div className="txp-sum">
          {opening && <><span>{opening.label}</span><span className="num">{num(opening.amount)}</span></>}
          {opening && <><span>{lines.length === 1 ? "1 line" : `${lines.length} lines`}, net</span><span className="num">{num(sum)}</span></>}
          <span className="txp-sum-total">{closing.label}</span><span className="num txp-sum-total">{num(ends)}</span>
        </div>
        <div className={`txp-tie ${ties ? "ok" : "off"}`}>
          {ties ? "✓ Matches the amount on the report" : `✕ Off the report by ${num(r2(closing.amount - ends))}`}
        </div>
        {view.note && <div className="txp-note">{view.note}</div>}
        {view.glTo && <Link className="txp-gl" to={view.glTo}>Open in General Ledger {ARROW}</Link>}
      </div>
    </>
  );
}
