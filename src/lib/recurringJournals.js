// Recurring journals — a manual entry that repeats on a schedule (added 28 Oct
// 2026; not in the Core Ledger PRD v2.2, proposed as an addition to it).
//
// The schedule lives on the entry it was set up from, as `recurrence`:
//   { frequency: "daily" | "weekly" | "monthly", every: N (every N days,
//     weeks or months), day: "last" | "1".."28" (monthly only — the day of the
//     month), start: "YYYY-MM-DD" (the first copy's date),
//     end: { kind: "never" | "count" | "until", count, until: "YYYY-MM-DD" },
//     status: "active" | "paused" | "ended", set_by, set_date }
// Days and weeks were added 2 Nov 2026; before that it was monthly only. A
// weekly schedule posts on the start date's weekday.
// It runs only once that entry is posted, so an abandoned draft never repeats.
//
// Each copy posts itself on its date (changed 2 Nov 2026 — it used to arrive
// as a draft for review). The approval happens once, up front: a repeat set on
// the form is approved with the entry, and one added to a posted entry needs
// posting rights (canRepeat). This goes beyond PRD v2.2 gate 8, which lets the
// system post only subledger postings — to be added to the PRD. Until its date
// a copy shows on the Scheduled tab; on its date it posts
// (state/ScheduledAutoPost.jsx), or earlier by hand ("Post early").
//
// Like the asset register's schedule, upcoming copies are derived, not stored:
// the ones dated in an open month up to the month after today. A copy in a
// closed month is skipped, never back-filled. Every posted copy carries
// `recurring_of` and a schedule_key, which is how it drops off the Scheduled tab.

import { formatDate } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const monthLabel = (ym) => (ym ? `${MONTHS[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}` : "—");
const addMonths = (ym, n) => {
  const [y, m] = ym.split("-").map((v) => parseInt(v, 10));
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
export const nextMonth = (ym) => addMonths(ym, 1);
const daysIn = (ym) => { const [y, m] = ym.split("-").map((n) => parseInt(n, 10)); return new Date(y, m, 0).getDate(); };
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const addDays = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => WEEKDAYS[new Date(utc(iso)).getUTCDay()];

// The posting day in a month: the last day, or day N (clamped to the month).
export const dayIn = (ym, day) => `${ym}-${String(day === "last" ? daysIn(ym) : Math.min(parseInt(day, 10), daysIn(ym))).padStart(2, "0")}`;

export const RECURRENCE_DAYS = [
  { value: "last", label: "Last day of the month" },
  ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` })),
];

// Repeat every N days / weeks / months. `every` is what a unit starts with
// when picked: 30 days, 1 week, 1 month.
export const REPEAT_UNITS = [
  { value: "daily", one: "day", many: "days", adverb: "Daily", every: 30 },
  { value: "weekly", one: "week", many: "weeks", adverb: "Weekly", every: 1 },
  { value: "monthly", one: "month", many: "months", adverb: "Monthly", every: 1 },
];
const UNIT = Object.fromEntries(REPEAT_UNITS.map((u) => [u.value, u]));
const stepOf = (r) => Math.max(1, parseInt(r.every, 10) || 1);

// The day of the month a monthly repeat defaults to for an entry on `iso`:
// the same day, or the last day when the entry sits on a month-end.
const monthDayFor = (iso) => {
  const d = parseInt(iso.slice(8, 10), 10);
  return d === daysIn(iso.slice(0, 7)) || d > 28 ? "last" : String(d);
};

// The first copy after an entry dated `jeDate`: one step on.
export function firstAfter(jeDate, { frequency, every, day }) {
  const n = stepOf({ every });
  if (frequency === "monthly") return dayIn(addMonths(jeDate.slice(0, 7), n), day);
  return addDays(jeDate, frequency === "weekly" ? 7 * n : n);
}

// A new schedule for an entry dated `jeDate`, in a unit (monthly unless
// given) with that unit's starting step, first copy one step after the entry.
export function defaultRecurrence(jeDate, { frequency = "monthly", every } = {}) {
  const r = { frequency, every: every ?? UNIT[frequency].every, day: monthDayFor(jeDate) };
  return { ...r, start: firstAfter(jeDate, r), end: { kind: "never", count: 12, until: "" }, status: "active" };
}

// Why a schedule can't be saved, or null.
export function recurrenceProblem(r, jeDate) {
  if (!(parseInt(r.every, 10) >= 1)) return `Repeat every 1 ${UNIT[r.frequency]?.one || "month"} or more.`;
  if (!r.start) return "Pick the first date.";
  if (jeDate && r.start <= jeDate) return "The first copy has to come after this entry's own date.";
  if (r.end.kind === "count" && !(parseInt(r.end.count, 10) >= 1)) return "Repeat at least once.";
  if (r.end.kind === "until" && (!r.end.until || r.end.until < r.start)) return "The end date can't be before the first copy.";
  return null;
}

// "Repeats monthly", "Repeats every 2 weeks".
export function repeatLabel(r) {
  const u = UNIT[r.frequency] || UNIT.monthly;
  const n = stepOf(r);
  return n === 1 ? `Repeats ${u.adverb.toLowerCase()}` : `Repeats every ${n} ${u.many}`;
}

export function describeRecurrence(r) {
  const u = UNIT[r.frequency] || UNIT.monthly;
  const n = stepOf(r);
  const every = n === 1 ? u.adverb : `Every ${n} ${u.many}`;
  const on = r.frequency === "monthly" ? (r.day === "last" ? " on the last day" : ` on day ${r.day}`)
    : r.frequency === "weekly" && r.start ? ` on ${weekdayOf(r.start)}` : "";
  const count = parseInt(r.end.count, 10) || 0;
  const end = r.end.kind === "count" ? ` · ${count} time${count === 1 ? "" : "s"}`
    : r.end.kind === "until" ? ` · until ${formatDate(r.end.until)}`
    : " · no end date";
  return `${every}${on} · from ${formatDate(r.start)}${end}`;
}

export const RECURRENCE_STATUS = { active: "Active", paused: "Paused", ended: "Ended" };

// The entries a schedule has made so far (voided ones don't count).
export const recurringInstances = (entries, sourceNo) =>
  entries.filter((e) => e.recurring_of === sourceNo && e.status !== "void")
    .sort((a, b) => a.je_date.localeCompare(b.je_date));

// Each copy's date in turn, from the start.
function* copyDates(r) {
  const n = stepOf(r);
  for (let k = 0; ; k += 1) {
    yield r.frequency === "monthly" ? dayIn(addMonths(r.start.slice(0, 7), k * n), r.day)
      : addDays(r.start, k * n * (r.frequency === "weekly" ? 7 : 1));
  }
}

const memoFor = (memo, label) => `${String(memo).replace(/ — (\d{1,2} )?\w{3} \d{4}$/, "")} — ${label}`;

// The Scheduled rows every active schedule has coming up, dated between the
// first open month and the end of `horizon`. `taken` is every schedule_key
// already stored.
export function fromRecurring(entries, { taken, firstOpen, horizon, todayIso }) {
  const out = [];
  for (const src of entries) {
    const r = src.recurrence;
    if (!r || r.status !== "active" || src.status !== "posted") continue;
    const monthly = r.frequency === "monthly";
    let left = r.end.kind === "count" ? r.end.count - recurringInstances(entries, src.je_number).length : Infinity;
    for (const date of copyDates(r)) {
      const p = date.slice(0, 7);
      if (left <= 0 || p > horizon || (r.end.kind === "until" && date > r.end.until)) break;
      if (p < firstOpen) continue;
      // A monthly copy is keyed by its month (as before days and weeks came in).
      const key = `recurring|${src.je_number}|${monthly ? p : date}`;
      if (taken.has(key)) continue;
      left -= 1;
      out.push({
        // SCH-202505-R250229 (monthly) or SCH-20250507-R250229: the copy, then
        // the source entry (JE-2025-0229) compacted.
        je_number: `SCH-${(monthly ? p : date).replace(/-/g, "")}-R${src.je_number.replace(/^JE-\d{2}(\d{2})-/, "$1")}`,
        je_date: date,
        status: "scheduled",
        memo: memoFor(src.memo, monthly ? monthLabel(p) : formatDate(date)),
        reference_type: "recurring",
        reference_id: src.je_number,
        recurring_of: src.je_number,
        schedule_key: key,
        schedule: {
          kind: "recurring", source_je: src.je_number, period: p, periodLabel: monthly ? monthLabel(p) : formatDate(date), postsOn: date,
          due: date <= todayIso, source: `Recurring — ${src.je_number}`, sources: [], unmapped: [], note: null,
        },
        created_by: r.set_by || src.created_by, created_date: todayIso, posted_by: null, posted_date: null,
        lines: (src.lines || []).map(({ account_code, account_name, debit, credit, description, dimensions, payee }) => ({
          account_code, account_name, debit, credit, description,
          ...(dimensions ? { dimensions: { ...dimensions } } : {}),
          ...(payee ? { payee } : {}),
        })),
      });
    }
  }
  return out;
}

// Can this entry be set to repeat from its detail page? Each copy will post
// itself, so adding a repeat to an already-posted entry is a posting act.
export function canRepeat(je, { canPost } = {}) {
  if (!canPost) return { ok: false, reason: "Each copy posts itself, so only someone who can post journals can set this up. Ask an approver." };
  if (je.status !== "posted") return { ok: false, reason: "Only a posted entry can be repeated — set Repeat on the form for a draft." };
  if ((je.reference_type || "manual") !== "manual") return { ok: false, reason: "Only a manual journal can repeat." };
  if (je.reversal_of) return { ok: false, reason: "A reversal can't repeat." };
  if (je.recurrence && je.recurrence.status !== "ended") return { ok: false, reason: "This entry already repeats." };
  return { ok: true, reason: null };
}
