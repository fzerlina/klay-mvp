// Reconcile manually — pair a bank line with the Klay records it stands for.
//
// Lists what the books hold on the same account that no bank line has been
// reconciled to yet, in the same direction as the line (money out against
// money out), plus open invoices for money in. More than one can be ticked,
// because one transfer often settles several bills — the case the engine
// deliberately does not guess at.
//
// Payments and recorded receipts have to add up to the bank line exactly: the
// payment module records the cash that left. Invoices may land within 3% of
// their subtotals either way, the same range the engine suggests on — customers
// withhold 2% PPh 23 and round.
//
// Anything else can still be reconciled if the gap is booked to one of the
// difference accounts in Settings → Bank reconciliation — the picker offers
// those and nothing else. Klay posts the journal for it.
//
// Ranking is a reading aid, not a decision: records for the party named in the
// bank text come first, then exact amounts, then the nearest dates.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { COA } from "../data/seed/coa";
import { formatRupiahExact } from "../lib/format";
import { dayDiff } from "../lib/clock";
import { nameAgrees, AR_TOLERANCE } from "../lib/bankMatching";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]}`;
const signed = (n) => `${n < 0 ? "−" : ""}Rp ${formatRupiahExact(Math.abs(n)).replace(/^Rp\s?/, "")}`;

const accountName = (code) => COA.find((a) => a.code === code)?.name || code;

export default function ManualMatchModal({ line, candidates, diffAccounts = [], onConfirm, onClose }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  // Where the difference goes, or "" to not book one.
  const [diffAcct, setDiffAcct] = useState("");
  useEffect(() => { setQ(""); setPicked(new Set()); setDiffAcct(""); }, [line?.id]);

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
  const allInvoices = selected.length > 0 && selected.every((r) => r.kind === "invoice");
  const inRange = allInvoices && left !== 0 && Math.abs(left) <= Math.round(Math.abs(total) * AR_TOLERANCE);
  // A gap the records don't explain on their own — the only case the
  // difference picker appears for.
  const gap = selected.length > 0 && left !== 0 && !inRange;
  const booking = gap && !!diffAcct;
  const balanced = selected.length > 0 && (left === 0 || inRange || booking);

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="bank-upload-backdrop" onClick={onClose}>
      <div className="bank-upload-modal mm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reconcile manually">
        <div className="bank-upload-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">Reconcile manually</div>
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
                : `Nothing left to reconcile this ${line.amount < 0 ? "payment" : "receipt"} to on this account.`}{" "}
              {line.amount < 0 ? "If the payment was never recorded in Klay, record it from its bill first." : ""}
            </div>
          ) : (
            ranked.map(({ r, named, exact, gap }) => (
              <label key={r.id} className={`mm-row${picked.has(r.id) ? " on" : ""}`}>
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                <span className="mm-row-date">{shortDate(r.date)}</span>
                <span className="mm-row-main">
                  <span className="mm-row-ref">{r.ref}{r.billId && r.billId !== r.ref ? ` · ${r.billId}` : ""}{r.kind === "invoice" ? " · open invoice" : ""}</span>
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

        {gap && (
          <div className="mm-diff">
            {diffAccounts.length === 0 ? (
              <span className="mm-diff-none">
                To book the {signed(Math.abs(left))} difference, add an account in{" "}
                <Link to="/bank-recon-settings">Settings → Bank reconciliation</Link>.
              </span>
            ) : (
              <>
                <label className="mm-diff-lbl" htmlFor="mm-diff-acct">Book the {signed(Math.abs(left))} difference to</label>
                <select id="mm-diff-acct" className="mm-diff-select" value={diffAcct} onChange={(e) => setDiffAcct(e.target.value)}>
                  <option value="">Don't book it</option>
                  {diffAccounts.map((code) => (
                    <option key={code} value={code}>{code} · {accountName(code)}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}

        <div className="mm-foot">
          <div className="mm-foot-sum">
            {selected.length === 0
              ? `Tick the records this bank line ${line.amount < 0 ? "pays" : "settles"}.`
              : booking
                ? <><strong>{signed(Math.abs(left))} difference</strong> to {diffAcct} {accountName(diffAcct)} — Klay posts the journal.</>
              : balanced && inRange
                ? <><strong>{signed(Math.abs(left))} {left < 0 ? "under" : "over"}</strong> the {selected.length === 1 ? "invoice subtotal" : "invoice subtotals"} — within {Math.round(AR_TOLERANCE * 100)}%.</>
              : balanced
                ? <><strong>{selected.length} {selected.length === 1 ? "record" : "records"}</strong> add up to the bank line exactly.</>
                : <>Selected {signed(total)} · <strong className="mm-foot-left">{signed(Math.abs(left))} {Math.abs(total) > Math.abs(line.amount) ? "over" : "still unaccounted for"}</strong></>}
          </div>
          <button type="button" className="recon-ex-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="recon-ex-btn primary" disabled={!balanced} onClick={() => onConfirm(selected, booking ? { accountCode: diffAcct, amount: left } : null)}>
            Reconcile{selected.length > 1 ? ` ${selected.length} records` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
