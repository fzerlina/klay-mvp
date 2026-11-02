// Small dialogs for the journal lifecycle, kept out of JournalEntryPage so the
// page reads as the list it is:
//   • ReturnDialog     — send a pending entry back to its preparer, with why
//   • RepeatDialog     — set a posted manual entry to repeat every N days, weeks or months
// Reversing opens the journal form as a preview (JournalEntryFormPage).

import { useState } from "react";
import { defaultRecurrence, recurrenceProblem } from "../lib/recurringJournals";
import { formatDate } from "../lib/format";
import RecurrenceFields from "../components/RecurrenceFields";


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

export function RepeatDialog({ je, onClose, onConfirm }) {
  const [r, setR] = useState(() => defaultRecurrence(je.je_date));
  const value = { ...r, every: parseInt(r.every, 10) || 0, end: { ...r.end, count: parseInt(r.end.count, 10) || 0 } };
  const problem = recurrenceProblem(value, je.je_date);
  return (
    <Shell
      title="Repeat this entry"
      sub={`${je.je_number} · ${je.memo}`}
      onClose={onClose}
      onConfirm={() => onConfirm(value)}
      confirmLabel="Repeat"
      disabled={!!problem}
    >
      <RecurrenceFields value={r} jeDate={je.je_date} onChange={setR} />
      {problem && <div className="dje-warn">{problem}</div>}
      <p className="jad-note">
        From {formatDate(value.start)}, a copy of these lines posts itself on each date — no further approval,
        recorded as posted by the system. Each copy shows on the Scheduled tab first, and the repeat can be paused or ended any time.
      </p>
    </Shell>
  );
}
