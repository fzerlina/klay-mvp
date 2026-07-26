// Faktur pajak (input-VAT) crediting window — Indonesia-specific.
//
// Per expert interviews (Pak Hadi, Accounting Manager — 25 Jun / 29 Jun / 09 Jul
// 2026): input VAT (PPN Masukan) on a faktur pajak can only be credited within
// ~3 months of the invoice date. Past that, the PPN can no longer be credited
// and becomes a real cost. Hadi checks this FIRST in every AP review ("yang
// paling saya takutin itu faktur pajak yang udah mau 90 hari"). Validated: the
// clock runs from the invoice date (assumed = faktur pajak date).
//
// This is a NON-GATING deadline flag — it urges a bill to be processed/paid in
// time; it NEVER blocks posting. Kept deliberately separate from the review /
// exception engine (whose flags mean "something is wrong, resolve before post").

import { daysSince } from "./clock";

export const PPN_CREDIT_DAYS = 90;

// Days until the crediting window closes: positive = days left, 0 = today,
// negative = already expired. null when there is no invoice date.
export function ppnDaysLeft(invoiceDate) {
  const age = daysSince(invoiceDate);
  if (age === Infinity) return null;
  return PPN_CREDIT_DAYS - age;
}

// Flag state for rendering + filtering. Quiet (> 14 days left) returns tone
// "ok" and the UI renders no chip; the chip appears from 14 days left onwards —
// amber at 8–14, red at ≤ 7 / today, grey once expired.
export function ppnWindowState(invoiceDate) {
  const d = ppnDaysLeft(invoiceDate);
  if (d == null) return null;
  if (d < 0)   return { tone: "expired", days: d, text: "PPN credit lost" };
  if (d <= 7)  return { tone: "danger",  days: d, text: d === 0 ? "PPN expires today" : `PPN ${d}d left` };
  if (d <= 14) return { tone: "warn",    days: d, text: `PPN ${d}d left` };
  return { tone: "ok", days: d, text: `PPN ${d}d` };
}

// Filter-bucket key for a line's PPN state: "d7" | "d14" | "expired" | null
// (null = quiet, > 14 days). Buckets are non-overlapping.
export function ppnFilterKey(invoiceDate) {
  const d = ppnDaysLeft(invoiceDate);
  if (d == null) return null;
  if (d < 0)   return "expired";
  if (d <= 7)  return "d7";
  if (d <= 14) return "d14";
  return null;
}

// Urgency tier: 0 = ≤ 7 days left (red), 1 = 8–14 days (amber), 2 = quiet or
// already expired. Expired is NOT urgent — the credit is already lost, so there
// is nothing left to race; it falls back to the normal (overdue) ordering.
export function ppnSortTier(invoiceDate) {
  const d = ppnDaysLeft(invoiceDate);
  if (d == null || d < 0) return 2;
  if (d <= 7)  return 0;
  if (d <= 14) return 1;
  return 2;
}

// Roll-up state for a set of invoice dates (e.g. all of a vendor's bills, for
// the Aging Table's collapsed vendor row): the most-urgent STILL-OPEN window
// (smallest days_left ≤ 14). Expired is NOT surfaced on tables, so an all-
// expired (or quiet) vendor returns null. Mirrors ppnWindowState's tones.
export function ppnRollupState(invoiceDates) {
  let minOpen = null;
  for (const d of invoiceDates) {
    const dl = ppnDaysLeft(d);
    if (dl == null || dl < 0) continue; // expired not shown on tables
    if (dl <= 14 && (minOpen == null || dl < minOpen)) minOpen = dl;
  }
  if (minOpen == null) return null;
  if (minOpen <= 7) return { tone: "danger", days: minOpen, text: minOpen === 0 ? "PPN expires today" : `PPN ${minOpen}d left` };
  return { tone: "warn", days: minOpen, text: `PPN ${minOpen}d left` };
}

// Bill Detail label — the full PPN crediting-window status, INCLUDING the
// expired "credit lost" state that the list/table chips deliberately omit.
export function ppnCreditLabel(invoiceDate) {
  const d = ppnDaysLeft(invoiceDate);
  if (d == null) return "—";
  if (d < 0) return "Credit lost — faktur pajak past the 90-day window";
  if (d === 0) return "Creditable — window closes today";
  return `Creditable — ${d} day${d === 1 ? "" : "s"} left in the 90-day window`;
}
