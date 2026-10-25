// Small dialogs for the journal lifecycle, kept out of JournalEntryPage so the
// page reads as the list it is:
//   • ReturnDialog     — send a pending entry back to its preparer, with why
//   • ReverseDialog    — reverse a posted entry on a chosen date

import { useState } from "react";
import { firstOfNextMonth, reversalDateCheck } from "../lib/journalLifecycle";
import { formatDate } from "../lib/format";


function Shell({ title, sub, children, onClose, onConfirm, confirmLabel, disabled, danger }) {
  return (
    <div className="dje-backdrop" onClick={onClose}>
      <div className="dje-modal jad-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dje-head">
          <div>
            <div className="dje-title">{title}</div>
            {sub && <div className="dje-sub">{sub}</div>}
          </div>
          <button className="dje-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>
        <div className="dje-body">{children}</div>
        <div className="dje-foot">
          <span />
          <div className="dje-foot-actions">
            <button className="dje-btn" onClick={onClose}>Cancel</button>
            <button className={`dje-btn primary${danger ? " danger" : ""}`} disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReturnDialog({ je, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <Shell
      title="Send back to preparer"
      sub={`${je.je_number} · ${je.memo}`}
      onClose={onClose}
      onConfirm={() => onConfirm(reason.trim())}
      confirmLabel="Send back"
      disabled={!reason.trim()}
    >
      <label className="dje-field">
        <span className="dje-field-lbl">What needs fixing</span>
        <textarea className="dje-input jad-text" rows={3} value={reason} autoFocus
          placeholder="e.g. Wrong cost centre on line 2" onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="jad-note">The entry goes back to Draft for {je.created_by}, with your note in its audit trail.</p>
    </Shell>
  );
}

export function ReverseDialog({ je, closedThrough, onClose, onConfirm }) {
  const [date, setDate] = useState(() => {
    const first = firstOfNextMonth(je.je_date);
    return closedThrough && first.slice(0, 7) <= closedThrough ? `${firstOfNextMonth(`${closedThrough}-01`)}` : first;
  });
  const check = reversalDateCheck(je, date, { closedThrough });
  return (
    <Shell
      title="Reverse entry"
      sub={`${je.je_number} · ${je.memo}`}
      onClose={onClose}
      onConfirm={() => onConfirm(date)}
      confirmLabel="Post reversal"
      disabled={!check.ok}
    >
      <label className="dje-field">
        <span className="dje-field-lbl">Reversal date</span>
        <input type="date" className="dje-input" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {!check.ok && <div className="dje-warn">{check.reason}</div>}
      <p className="jad-note">
        Posts a new entry with every debit and credit swapped, dated {date ? formatDate(date) : "—"}. The original stays in the
        ledger, marked as reversed — a posted entry is never edited or deleted.
      </p>
    </Shell>
  );
}
