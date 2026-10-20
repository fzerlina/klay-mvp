// Small dialogs for the journal lifecycle, kept out of JournalEntryPage so the
// page reads as the list it is:
//   • ReturnDialog     — send a pending entry back to its preparer, with why
//   • ReverseDialog    — reverse a posted entry on a chosen date
//   • RecurringDialog  — turn an entry's lines into a monthly template
//   • TemplatesDrawer  — the templates that feed the Scheduled tab

import { useState } from "react";
import { firstOfNextMonth, reversalDateCheck } from "../lib/journalLifecycle";
import { formatDate } from "../lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => (ym ? `${MONTHS[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}` : "");
const fmtRp = (n) => (n ? Math.round(n).toLocaleString("id-ID") : "0");

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

export function RecurringDialog({ je, firstOpen, onClose, onConfirm }) {
  const nextOf = (ym) => { const [y, m] = ym.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
  const [name, setName] = useState(je.memo.replace(/ — \w{3} \d{4}$/, ""));
  const [day, setDay] = useState("last");
  const [start, setStart] = useState(() => {
    const after = nextOf(je.je_date.slice(0, 7));
    return firstOpen && after < firstOpen ? firstOpen : after;
  });
  const [end, setEnd] = useState("");
  const [autoReverse, setAutoReverse] = useState(!!je.auto_reverse);
  const bad = !name.trim() || !start || (end && end < start);
  return (
    <Shell
      title="Make recurring"
      sub={`From ${je.je_number} · ${je.lines.length} lines`}
      onClose={onClose}
      onConfirm={() => onConfirm({ name: name.trim(), day, start, end: end || null, auto_reverse: autoReverse })}
      confirmLabel="Create template"
      disabled={bad}
    >
      <label className="dje-field">
        <span className="dje-field-lbl">Template name</span>
        <input className="dje-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="jad-row">
        <label className="dje-field">
          <span className="dje-field-lbl">Posts on</span>
          <select className="dje-input" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="last">Last day of the month</option>
            {[1, 5, 10, 15, 20, 25].map((d) => <option key={d} value={String(d)}>Day {d}</option>)}
          </select>
        </label>
        <label className="dje-field">
          <span className="dje-field-lbl">First month</span>
          <input type="month" className="dje-input" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="dje-field">
          <span className="dje-field-lbl">Last month (optional)</span>
          <input type="month" className="dje-input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="dje-check">
        <input type="checkbox" checked={autoReverse} onChange={(e) => setAutoReverse(e.target.checked)} />
        <span><strong>Reverse each one on the 1st of the next month</strong><span className="dje-hint">The usual shape of an accrual.</span></span>
      </label>
      <p className="jad-note">
        Each month from {monthLabel(start) || "—"} gets a Scheduled entry with these lines. It posts without a second
        approval — this template is the approval.
      </p>
    </Shell>
  );
}

export function TemplatesDrawer({ templates, onClose, onToggle, onRemove }) {
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title">Recurring templates</div>
            <div className="drawer-sub">{templates.length} template{templates.length === 1 ? "" : "s"} · each drafts a Scheduled entry every month</div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="drawer-body">
          {templates.length === 0 && <div className="jad-note">No templates yet. Use “Make recurring” on an entry to create one.</div>}
          {templates.map((t) => {
            const amount = t.lines.reduce((s, l) => s + (l.debit || 0), 0);
            return (
              <div key={t.id} className={`jad-tpl${t.active ? "" : " paused"}`}>
                <div className="jad-tpl-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="jad-tpl-name">{t.name}</div>
                    <div className="jad-tpl-meta">
                      {t.day === "last" ? "Last day" : `Day ${t.day}`} · {monthLabel(t.start)} → {t.end ? monthLabel(t.end) : "no end"}
                      {t.auto_reverse ? " · auto-reverses" : ""} · Rp {fmtRp(amount)}
                    </div>
                  </div>
                  <span className={`badge ${t.active ? "badge-scheduled" : "badge-draft"}`}>{t.active ? "Active" : "Paused"}</span>
                </div>
                <div className="jad-tpl-lines">
                  {t.lines.map((l, i) => (
                    <div key={i}><span className="jad-code">{l.account_code}</span> {l.account_name} <span className="jad-amt">{l.debit ? `Dr ${fmtRp(l.debit)}` : `Cr ${fmtRp(l.credit)}`}</span></div>
                  ))}
                </div>
                <div className="jad-tpl-actions">
                  <button className="drawer-btn ghost" onClick={() => onToggle(t)}>{t.active ? "Pause" : "Resume"}</button>
                  <button className="drawer-btn ghost" onClick={() => onRemove(t)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
