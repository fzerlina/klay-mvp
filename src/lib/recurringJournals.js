// Recurring journals — a manual entry that repeats every month (added 28 Oct
// 2026; not in the Core Ledger PRD v2.2, proposed as an addition to it).
//
// The schedule lives on the entry it was set up from, as `recurrence`:
//   { frequency: "monthly", day: "last" | "1".."28", start: "YYYY-MM",
//     end: { kind: "never" | "count" | "until", count, until: "YYYY-MM" },
//     status: "active" | "paused" | "ended", set_by, set_date }
// It runs only once that entry is posted, so an abandoned draft never repeats.
//
// Each month's entry is NOT posted by the system. The PRD lets the system post
// only subledger postings and auto-reversals (gate 8), so a recurring month
// arrives as a draft for its preparer to review and submit — the normal
// Draft → Pending → Posted path, segregation of duties included. Until its date
// it shows on the Scheduled tab; on its date it becomes that draft
// (state/ScheduledAutoPost.jsx), or earlier by hand ("Draft now").
//
// Like the asset register's schedule, upcoming months are derived, not stored:
// the open months from the start up to the month after today. A closed month is
// skipped, never back-filled. Every draft carries `recurring_of` and a
// schedule_key, which is how a month that has been drafted drops off.

import { withEvent } from "./journalLifecycle";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => (ym ? `${MONTHS[parseInt(ym.slice(5, 7), 10) - 1]} ${ym.slice(0, 4)}` : "—");
export const nextMonth = (ym) => {
  const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const daysIn = (ym) => { const [y, m] = ym.split("-").map((n) => parseInt(n, 10)); return new Date(y, m, 0).getDate(); };

// The posting day in a month: the last day, or day N (clamped to the month).
export const dayIn = (ym, day) => `${ym}-${String(day === "last" ? daysIn(ym) : Math.min(parseInt(day, 10), daysIn(ym))).padStart(2, "0")}`;

export const RECURRENCE_DAYS = [
  { value: "last", label: "Last day of the month" },
  ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` })),
];

// A new schedule for an entry dated `jeDate`: from the next month, on the same
// day (or the last day, when the entry sits on a month-end).
export function defaultRecurrence(jeDate) {
  const ym = jeDate.slice(0, 7);
  const d = parseInt(jeDate.slice(8, 10), 10);
  return {
    frequency: "monthly",
    day: d === daysIn(ym) || d > 28 ? "last" : String(d),
    start: nextMonth(ym),
    end: { kind: "never", count: 12, until: "" },
    status: "active",
  };
}

// Why a schedule can't be saved, or null.
export function recurrenceProblem(r, jeDate) {
  if (!r.start) return "Pick the first month.";
  if (jeDate && r.start <= jeDate.slice(0, 7)) return "The first repeat has to be after this entry's own month.";
  if (r.end.kind === "count" && !(parseInt(r.end.count, 10) >= 1)) return "Repeat at least once.";
  if (r.end.kind === "until" && (!r.end.until || r.end.until < r.start)) return "The last month can't be before the first.";
  return null;
}

export function describeRecurrence(r) {
  const day = r.day === "last" ? "on the last day" : `on day ${r.day}`;
  const end = r.end.kind === "count" ? ` · ${r.end.count} time${r.end.count === 1 ? "" : "s"}`
    : r.end.kind === "until" ? ` · until ${monthLabel(r.end.until)}`
    : " · no end date";
  return `Monthly ${day} · from ${monthLabel(r.start)}${end}`;
}

export const RECURRENCE_STATUS = { active: "Active", paused: "Paused", ended: "Ended" };

// The entries a schedule has drafted so far (voided ones don't count).
export const recurringInstances = (entries, sourceNo) =>
  entries.filter((e) => e.recurring_of === sourceNo && e.status !== "void")
    .sort((a, b) => a.je_date.localeCompare(b.je_date));

const memoFor = (memo, ym) => `${String(memo).replace(/ — \w{3} \d{4}$/, "")} — ${monthLabel(ym)}`;

// The Scheduled rows every active schedule has coming up, between the first
// open month and `horizon`. `taken` is every schedule_key already stored.
export function fromRecurring(entries, { taken, firstOpen, horizon, todayIso }) {
  const out = [];
  for (const src of entries) {
    const r = src.recurrence;
    if (!r || r.status !== "active" || src.status !== "posted") continue;
    const done = recurringInstances(entries, src.je_number);
    let left = r.end.kind === "count" ? r.end.count - done.length : Infinity;
    const last = r.end.kind === "until" && r.end.until < horizon ? r.end.until : horizon;
    for (let p = r.start > firstOpen ? r.start : firstOpen; p <= last && left > 0; p = nextMonth(p)) {
      const key = `recurring|${src.je_number}|${p}`;
      if (taken.has(key)) continue;
      left -= 1;
      const date = dayIn(p, r.day);
      out.push({
        // SCH-202505-R250229: the month, then the source entry (JE-2025-0229) compacted.
        je_number: `SCH-${p.replace("-", "")}-R${src.je_number.replace(/^JE-\d{2}(\d{2})-/, "$1")}`,
        je_date: date,
        status: "scheduled",
        memo: memoFor(src.memo, p),
        reference_type: "recurring",
        reference_id: src.je_number,
        recurring_of: src.je_number,
        schedule_key: key,
        ...(src.auto_reverse ? { auto_reverse: true } : {}),
        schedule: {
          kind: "recurring", source_je: src.je_number, period: p, periodLabel: monthLabel(p), postsOn: date,
          due: date <= todayIso, source: `Recurring — ${src.je_number}`, sources: [], unmapped: [],
          note: src.auto_reverse ? "Once posted, it reverses itself on the 1st of the next month." : null,
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

// The draft a scheduled month becomes — a real, numbered entry owned by
// whoever set the schedule up, waiting for them to review and submit it.
export function draftFromRecurring(row, { jeNumber, by, today }) {
  return withEvent({
    je_number: jeNumber,
    je_date: row.je_date,
    status: "draft",
    memo: row.memo,
    reference: null,
    reference_type: "recurring",
    reference_id: row.recurring_of,
    recurring_of: row.recurring_of,
    schedule_key: row.schedule_key,
    ...(row.auto_reverse ? { auto_reverse: true } : {}),
    created_by: row.created_by,
    created_date: today,
    posted_by: null,
    posted_date: null,
    attachments: [],
    lines: row.lines.map((l) => ({ ...l })),
  }, "drafted from recurring schedule", by, `${row.schedule.periodLabel} of ${row.recurring_of}`);
}

// Can this entry be set to repeat from its detail page?
export function canRepeat(je, { canTransact } = {}) {
  if (!canTransact) return { ok: false, reason: "Your role cannot prepare journal entries." };
  if (je.status !== "posted") return { ok: false, reason: "Only a posted entry can be repeated — set Repeat on the form for a draft." };
  if ((je.reference_type || "manual") !== "manual") return { ok: false, reason: "Only a manual journal can repeat." };
  if (je.reversal_of) return { ok: false, reason: "A reversal can't repeat." };
  if (je.recurrence && je.recurrence.status !== "ended") return { ok: false, reason: "This entry already repeats." };
  return { ok: true, reason: null };
}
