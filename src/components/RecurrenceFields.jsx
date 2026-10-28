import { RECURRENCE_DAYS, describeRecurrence, nextMonth } from "../lib/recurringJournals";
import "./recurrence-fields.css";

// The repeat schedule's fields (lib/recurringJournals.js): which day, the first
// month, and when it ends. Used on the journal form's "Repeat this entry" and
// in the detail page's "Repeat monthly" dialog, so both read the same.
// `jeDate` is the entry's own date; the first repeat comes after its month.
export default function RecurrenceFields({ value, onChange, jeDate }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setEnd = (patch) => onChange({ ...value, end: { ...value.end, ...patch } });
  const minStart = jeDate ? nextMonth(jeDate.slice(0, 7)) : undefined;
  return (
    <div className="rcf">
      <div className="rcf-grid">
        <label className="rcf-field">
          <span className="rcf-lbl">Posts on</span>
          <select className="rcf-input" value={value.day} onChange={(e) => set({ day: e.target.value })}>
            {RECURRENCE_DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="rcf-field">
          <span className="rcf-lbl">First month</span>
          <input type="month" className="rcf-input" value={value.start} min={minStart} onChange={(e) => set({ start: e.target.value })} />
        </label>
        <label className="rcf-field">
          <span className="rcf-lbl">Ends</span>
          <select className="rcf-input" value={value.end.kind} onChange={(e) => setEnd({ kind: e.target.value })}>
            <option value="never">Never</option>
            <option value="count">After a number of months</option>
            <option value="until">After a month</option>
          </select>
        </label>
        {value.end.kind === "count" && (
          <label className="rcf-field rcf-narrow">
            <span className="rcf-lbl">Months</span>
            <input type="number" min={1} className="rcf-input" value={value.end.count} onChange={(e) => setEnd({ count: e.target.value === "" ? "" : parseInt(e.target.value, 10) })} />
          </label>
        )}
        {value.end.kind === "until" && (
          <label className="rcf-field">
            <span className="rcf-lbl">Last month</span>
            <input type="month" className="rcf-input" value={value.end.until} min={value.start} onChange={(e) => setEnd({ until: e.target.value })} />
          </label>
        )}
      </div>
      <div className="rcf-summary">{describeRecurrence({ ...value, end: { ...value.end, count: parseInt(value.end.count, 10) || 0 } })}</div>
    </div>
  );
}
