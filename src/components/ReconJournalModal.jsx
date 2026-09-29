// Edit a drafted bank-fee or interest journal before posting it.
//
// Klay drafts the entry from the account mapping (lib/reconJournal.js). A
// person can change the other side — a different expense account, a split
// across two, a better description — but not the bank line: it is what the
// bank printed, and changing it would leave the statement line unreconciled.

import { useMemo, useState } from "react";
import { COA } from "../data/seed/coa";
import { draftProblem } from "../lib/reconJournal";
import { formatRupiahExact } from "../lib/format";

const LEAVES = COA.filter((a) => a.type !== "group" && a.is_active !== false);
const nameOf = (code) => LEAVES.find((a) => a.code === code)?.name || "";
const rp = (n) => formatRupiahExact(n || 0);

export default function ReconJournalModal({ exception, draft, onSave, onPost, onClose }) {
  const [memo, setMemo] = useState(draft.memo);
  const [date, setDate] = useState(draft.je_date);
  const [lines, setLines] = useState(() => draft.lines.map((l) => ({ ...l })));

  const next = { ...draft, memo, je_date: date, lines };
  const problem = draftProblem(next, exception);
  const totals = useMemo(
    () => lines.reduce((t, l) => ({ dr: t.dr + (l.debit || 0), cr: t.cr + (l.credit || 0) }), { dr: 0, cr: 0 }),
    [lines],
  );

  const setLine = (i, patch) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const amountIn = (v) => Math.max(0, parseInt(String(v).replace(/[^0-9]/g, ""), 10) || 0);

  return (
    <div className="bank-upload-backdrop" onClick={onClose}>
      <div className="bank-upload-modal rj-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit journal">
        <div className="bank-upload-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">Edit journal</div>
            <div className="bank-upload-sub">{exception.description}</div>
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>

        <div className="rj-body">
          <div className="rj-fields">
            <label className="rj-field">
              <span>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="rj-field rj-field-grow">
              <span>Memo</span>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </label>
          </div>

          <div className="rj-lines">
            <div className="rj-line rj-line-head">
              <span>Account</span><span>Description</span><span className="num">Debit</span><span className="num">Credit</span><span />
            </div>
            {lines.map((l, i) =>
              i === 0 ? (
                <div className="rj-line rj-line-locked" key={i} title="The bank line is what the bank printed, so it can't be changed here.">
                  <span className="rj-acct"><strong>{l.account_code}</strong> {l.account_name}</span>
                  <span className="rj-desc">{l.description}</span>
                  <span className="num">{l.debit ? rp(l.debit) : "—"}</span>
                  <span className="num">{l.credit ? rp(l.credit) : "—"}</span>
                  <span className="rj-lock">Bank</span>
                </div>
              ) : (
                <div className="rj-line" key={i}>
                  <select
                    value={l.account_code}
                    onChange={(e) => setLine(i, { account_code: e.target.value, account_name: nameOf(e.target.value) })}
                  >
                    <option value="">Choose an account</option>
                    {LEAVES.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                  </select>
                  <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                  <input className="num" inputMode="numeric" value={l.debit || ""} placeholder="0" onChange={(e) => setLine(i, { debit: amountIn(e.target.value), credit: 0 })} />
                  <input className="num" inputMode="numeric" value={l.credit || ""} placeholder="0" onChange={(e) => setLine(i, { credit: amountIn(e.target.value), debit: 0 })} />
                  {lines.length > 2 ? (
                    <button type="button" className="rj-remove" aria-label="Remove line" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>×</button>
                  ) : <span />}
                </div>
              ),
            )}
            <div className="rj-line rj-line-total">
              <button
                type="button"
                className="recon-crow-later"
                onClick={() => setLines((prev) => [...prev, { account_code: "", account_name: "", debit: 0, credit: 0, description: "" }])}
              >
                + Add line
              </button>
              <span />
              <span className="num">{rp(totals.dr)}</span>
              <span className="num">{rp(totals.cr)}</span>
              <span />
            </div>
          </div>
        </div>

        <div className="mm-foot">
          <div className={`mm-foot-sum${problem ? " rj-problem" : ""}`}>{problem || "Balanced. The bank line equals the statement line."}</div>
          <button type="button" className="recon-ex-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="recon-ex-btn" disabled={!!problem} onClick={() => onSave(next)}>Save draft</button>
          <button type="button" className="recon-ex-btn primary" disabled={!!problem} onClick={() => onPost(next)}>Post</button>
        </div>
      </div>
    </div>
  );
}
