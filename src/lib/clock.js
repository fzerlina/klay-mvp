// Demo clock — frozen so "today" stays consistent with the 2025 seed data.
// In a real app this would be `new Date()`. For the prototype, override here
// to bump the demo forward when seed data shifts.
export const TODAY = new Date("2025-04-23T00:00:00");

// All seed dates are ISO (YYYY-MM-DD). Accepts ISO strings or Date objects.
export function parseDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return new Date(input + "T00:00:00");
  return null;
}

const MS_PER_DAY = 86400000;

export function daysSince(input) {
  const date = parseDate(input);
  if (!date) return Infinity;
  return Math.floor((TODAY - date) / MS_PER_DAY);
}

// ── ISO date arithmetic ──────────────────────────────────────────────────────
//
// String in, string out, computed in UTC — and the UTC part is not a detail.
//
// `parseDate` above reads "2025-04-02" as LOCAL midnight, which is right for
// comparing against the demo clock. But `toISOString()` serialises in UTC, and
// in WIB (UTC+7) local midnight is 17:00 the previous day. Round-tripping
// through both — parse local, add a day, serialise UTC, slice — gives back the
// date you started from. A "walk forward to the next weekday" loop written that
// way never advances, and hangs.
//
// So anything that does arithmetic ON an ISO string and returns one stays in
// UTC from end to end. Nothing here converts to or from local time.

const utc = (iso) => new Date(`${iso}T00:00:00Z`);

export const addDays = (iso, n) => new Date(utc(iso).getTime() + n * MS_PER_DAY).toISOString().slice(0, 10);

export const dayDiff = (a, b) => Math.round((utc(a) - utc(b)) / MS_PER_DAY);

export const isWeekend = (iso) => [0, 6].includes(utc(iso).getUTCDay());

export function addBusinessDays(iso, n) {
  let d = iso;
  for (let i = 0; i < n; i++) {
    d = addDays(d, 1);
    while (isWeekend(d)) d = addDays(d, 1);
  }
  return d;
}

export function nextBusinessDay(iso) {
  let d = addDays(iso, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
