// Match manually — pair a bank line with the Klay records it stands for.
//
// Opened from a statement line the engine could not settle. It lists what the
// books hold on the same account that no bank line has claimed yet, in the same
// direction as the line (money out against money out). More than one record can
// be ticked, because one transfer often settles several bills — the case the
// engine deliberately does not guess at. The match only goes through when the
// ticked records add up to the bank line exactly; anything else would leave a
// difference nobody explained.
//
// Ranking is a reading aid, not a decision: records for the party named in the
// bank text come first, then exact amounts, then the nearest dates.

import { useEffect, useMemo, useState } from "react";
import { formatRupiahExact } from "../lib/format";
import { dayDiff } from "../lib/clock";
import { nameAgrees } from "../lib/bankMatching";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]}`;
const signed = (n) => `${n < 0 ? "−" : ""}Rp ${formatRupiahExact(Math.abs(n)).replace(/^Rp\s?/, "")}`;

export default function ManualMatchModal({ line, candidates, onConfirm, onClose }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  useEffect(() => { setQ(""); setPicked(new Set()); }, [line?.id]);

  const ranked = useMemo(() => {
    if (!line) return [];
    const party = line.counterparty || "";
    const same = candidates.filter((r) => Math.sign(r.amount) === Math.sign(line.amount));
    const scored = same.map((r) => ({
      r,
      named: !!party && nameAgrees(party, r.counterparty),
      exact: r.amount === line.amount,
      gap: Math.abs(dayDiff(line.date, r.date)),
    }));
    scored.sort((a, b) => Number(b.named) - Number(a.named) || Number(b.exact) - Number(a.exact) || a.gap - b.gap);
    const needle = q.trim().toLowerCase();
    if (!needle) return scored;
    return scored.filter(({ r }) =>
      [r.ref, r.billId, r.counterparty, r.label, String(Math.abs(r.amount))].some((v) => (v || "").toLowerCase().includes(needle)),
    );
  }, [line, candidates, q]);

  if (!line) return null;

  const selected = candidates.filter((r) => picked.has(r.id));
  const total = selected.reduce((s, r) => s + r.amount, 0);
  const left = line.amount - total;
  const balanced = selected.length > 0 && left === 0;

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="bank-upload-backdrop" onClick={onClose}>
      <div className="bank-upload-modal mm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Match manually">
        <div className="bank-upload-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">Match manually</div>
            <div className="mm-line">
              <span className="mm-line-date">{shortDate(line.date)}</span>
              <span className="mm-line-desc">{line.description}</span>
              <span className="mm-line-amt">{signed(line.amount)}</span>
            </div>
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>

        <div className="mm-search">
          <input
            className="mm-search-input"
            placeholder="Search Klay records — a vendor, a reference, an amount"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>

        <div className="mm-list">
          {ranked.length === 0 ? (
            <div className="mm-empty">
              {q
                ? "No record matches that search."
                : `No unmatched ${line.amount < 0 ? "payments" : "receipts"} on this account.`}{" "}
              If the payment was never recorded in Klay, record it from its bill first.
            </div>
          ) : (
            ranked.map(({ r, named, exact, gap }) => (
              <label key={r.id} className={`mm-row${picked.has(r.id) ? " on" : ""}`}>
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                <span className="mm-row-date">{shortDate(r.date)}</span>
                <span className="mm-row-main">
                  <span className="mm-row-ref">{r.ref}{r.billId && r.billId !== r.ref ? ` · ${r.billId}` : ""}</span>
                  <span className="mm-row-label">{r.label}</span>
                  <span className="mm-row-hints">
                    {named && <span className="recon-tag">Same name as the bank line</span>}
                    {exact && <span className="recon-tag">Same amount</span>}
                    {gap > 0 && <span className="mm-row-gap">{gap} {gap === 1 ? "day" : "days"} from the bank line</span>}
                  </span>
                </span>
                <span className="mm-row-amt">{signed(r.amount)}</span>
              </label>
            ))
          )}
        </div>

        <div className="mm-foot">
          <div className="mm-foot-sum">
            {selected.length === 0
              ? "Tick the records this bank line pays."
              : balanced
                ? <><strong>{selected.length} {selected.length === 1 ? "record" : "records"}</strong> add up to the bank line exactly.</>
                : <>Selected {signed(total)} · <strong className="mm-foot-left">{signed(Math.abs(left))} {Math.abs(total) > Math.abs(line.amount) ? "over" : "still unaccounted for"}</strong></>}
          </div>
          <button type="button" className="recon-ex-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="recon-ex-btn primary" disabled={!balanced} onClick={() => onConfirm(selected)}>
            Match {selected.length > 1 ? `${selected.length} records` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
