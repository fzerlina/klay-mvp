// Report periods — the presets the financial reports share (Trial Balance,
// Profit & Loss): this month, last month, this quarter, year to date, last
// year, plus custom. Built from the demo clock and the company's fiscal year
// start (Settings → Accounting → General Ledger → Preferences), so nothing is
// hard-coded to a calendar year. Dates are ISO strings computed without time
// zones (see clock.js on why).

import { TODAY } from "./clock";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Today as an ISO date in local (WIB) terms — never toISOString(), which is UTC.
export const todayIso = (today = TODAY) => ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());

// Shift a (year, month) by n months.
function addMonths(y, m, n) {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

// The first month of the fiscal year containing (y, m).
function fiscalYearStartOf(y, m, fyStart) {
  return m >= fyStart ? [y, fyStart] : [y - 1, fyStart];
}

export function monthLabel(iso) {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// "1 Jan – 23 Apr 2025", or a single month as "Apr 2025" when it's whole.
export function rangeLabel(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy === ty && fm === tm && fd === 1 && td === lastDay(ty, tm)) return `${MONTHS[fm - 1]} ${fy}`;
  const left = fy === ty ? `${fd} ${MONTHS[fm - 1]}` : `${fd} ${MONTHS[fm - 1]} ${fy}`;
  return `${left} – ${td} ${MONTHS[tm - 1]} ${ty}`;
}

// Presets for a report period. `to` never runs past today: a month or quarter
// still in progress ends today ("to date").
export function periodPresets({ fiscalYearStart = 1, today = TODAY } = {}) {
  const t = todayIso(today);
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const cap = (iso) => (iso > t ? t : iso);

  const [ly, lm] = addMonths(y, m, -1);
  const [fyY, fyM] = fiscalYearStartOf(y, m, fiscalYearStart);
  // Fiscal quarter containing today.
  const monthsIn = (y * 12 + m) - (fyY * 12 + fyM);
  const [qy, qm] = addMonths(fyY, fyM, Math.floor(monthsIn / 3) * 3);
  const [qey, qem] = addMonths(qy, qm, 2);
  const [pfy, pfm] = addMonths(fyY, fyM, -12);
  const [pfey, pfem] = addMonths(fyY, fyM, -1);

  return [
    { key: "this_month", label: "This month", from: ymd(y, m, 1), to: t },
    { key: "last_month", label: "Last month", from: ymd(ly, lm, 1), to: ymd(ly, lm, lastDay(ly, lm)) },
    { key: "this_quarter", label: "This quarter", from: ymd(qy, qm, 1), to: cap(ymd(qey, qem, lastDay(qey, qem))) },
    { key: "ytd", label: "Year to date", from: ymd(fyY, fyM, 1), to: t },
    { key: "last_year", label: "Last fiscal year", from: ymd(pfy, pfm, 1), to: ymd(pfey, pfem, lastDay(pfey, pfem)) },
  ];
}

// The period of the same length immediately before [from, to], month-aligned
// when the range is whole months; otherwise the same day span shifted back.
export function previousPeriod(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const months = (ty * 12 + tm) - (fy * 12 + fm) + 1;
  if (fd === 1) {
    const [py, pm] = addMonths(fy, fm, -months);
    const [pey, pem] = addMonths(ty, tm, -months);
    // Keep "to date" ranges comparable: same day of month, capped at month end.
    const endDay = td === lastDay(ty, tm) ? lastDay(pey, pem) : Math.min(td, lastDay(pey, pem));
    return { from: ymd(py, pm, 1), to: ymd(pey, pem, endDay) };
  }
  const span = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
  const end = new Date(Date.UTC(fy, fm - 1, fd) - 86400000);
  const start = new Date(end.getTime() - (span - 1) * 86400000);
  const iso = (d) => d.toISOString().slice(0, 10); // UTC on both ends — no local conversion
  return { from: iso(start), to: iso(end) };
}

// Recent month-ends up to today, newest first — for as-of pickers.
export function recentMonthEnds(count = 6, today = TODAY) {
  const out = [];
  let [y, m] = [today.getFullYear(), today.getMonth() + 1];
  for (let i = 0; i < count; i++) {
    [y, m] = addMonths(y, m, -1);
    out.push(ymd(y, m, lastDay(y, m)));
  }
  return out;
}
