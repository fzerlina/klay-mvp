import { RECURRENCE_DAYS, REPEAT_UNITS, describeRecurrence, dayIn, firstAfter } from "../lib/recurringJournals";
import "./recurrence-fields.css";

// The repeat schedule's fields (lib/recurringJournals.js): every N days, weeks
// or months, the first copy's date, and when it ends. Used on the journal
// form's "Repeat this entry" and in the detail page's "Repeat" dialog, so both
// read the same. `jeDate` is the entry's own date; the first copy comes after it.
// Picking a unit prefills its step (30 days, 1 week, 1 month) and moves the
// first date one step past the entry, as long as nobody has set it by hand.
export default function RecurrenceFields({ value, onChange, jeDate }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const setEnd = (patch) => onChange({ ...value, end: { ...value.end, ...patch } });
  const monthly = value.frequency === "monthly";
  const startIsDefault = jeDate && value.start === firstAfter(jeDate, value);

  // A new step or unit carries a defaulted first date along with it.
  const reschedule = (patch) => {
    const next = { ...value, ...patch };
    set(jeDate && startIsDefault && parseInt(next.every, 10) >= 1 ? { ...patch, start: firstAfter(jeDate, next) } : patch);
  };
  const pickUnit = (frequency) => reschedule({ frequency, every: REPEAT_UNITS.find((u) => u.value === frequency).every });
  const unit = REPEAT_UNITS.find((u) => u.value === value.frequency) || REPEAT_UNITS[2];
  const plural = parseInt(value.every, 10) !== 1;
  const minDate = jeDate ? dayAfter(jeDate) : undefined;

  return (
    <div className="rcf">
      <div className="rcf-grid">
        <div className="rcf-field rcf-every">
          <span className="rcf-lbl">Repeat every</span>
          <div className="rcf-pair">
            <input
              type="number" min={1} className="rcf-input rcf-num" aria-label="How many"
              value={value.every}
              onChange={(e) => reschedule({ every: e.target.value === "" ? "" : parseInt(e.target.value, 10) })}
            />
            <select className="rcf-input" aria-label="Unit" value={value.frequency} onChange={(e) => pickUnit(e.target.value)}>
              {REPEAT_UNITS.map((u) => <option key={u.value} value={u.value}>{plural ? u.many : u.one}</option>)}
            </select>
          </div>
        </div>
        {monthly && (
          <label className="rcf-field">
            <span className="rcf-lbl">Posts on</span>
            <select className="rcf-input" value={value.day} onChange={(e) => set({ day: e.target.value, start: dayIn(value.start.slice(0, 7), e.target.value) })}>
              {RECURRENCE_DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </label>
        )}
        {monthly ? (
          <label className="rcf-field">
            <span className="rcf-lbl">First month</span>
            <input
              type="month" className="rcf-input" value={value.start.slice(0, 7)} min={minDate?.slice(0, 7)}
              onChange={(e) => e.target.value && set({ start: dayIn(e.target.value, value.day) })}
            />
          </label>
        ) : (
          <label className="rcf-field">
            <span className="rcf-lbl">First copy on</span>
            <input type="date" className="rcf-input" value={value.start} min={minDate} onChange={(e) => set({ start: e.target.value })} />
          </label>
        )}
        <label className="rcf-field">
          <span className="rcf-lbl">Ends</span>
          <select className="rcf-input" value={value.end.kind} onChange={(e) => setEnd({ kind: e.target.value })}>
            <option value="never">Never</option>
            <option value="count">After a number of times</option>
            <option value="until">On a date</option>
          </select>
        </label>
        {value.end.kind === "count" && (
          <label className="rcf-field rcf-narrow">
            <span className="rcf-lbl">Times</span>
            <input type="number" min={1} className="rcf-input" value={value.end.count} onChange={(e) => setEnd({ count: e.target.value === "" ? "" : parseInt(e.target.value, 10) })} />
          </label>
        )}
        {value.end.kind === "until" && (
          <label className="rcf-field">
            <span className="rcf-lbl">Last copy on or before</span>
            <input type="date" className="rcf-input" value={value.end.until} min={value.start} onChange={(e) => setEnd({ until: e.target.value })} />
          </label>
        )}
      </div>
      <div className="rcf-summary">
        {parseInt(value.every, 10) >= 1 && value.start
          ? describeRecurrence(value)
          : `Repeat every 1 ${unit.one} or more.`}
      </div>
    </div>
  );
}

const dayAfter = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
