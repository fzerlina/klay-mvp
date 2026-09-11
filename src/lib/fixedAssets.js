// Fixed Assets — one register, one schedule engine, for three kinds of thing
// that behave identically: a cost recognised at once, released over a term.
// `type` (fixed_asset / prepaid / intangible) only changes the account set and
// the vocabulary (depreciates vs amortises) — never the arithmetic below.
//
// THE RULE THAT SHAPES THIS FILE (Fixed Asset PRD §A3): a schedule is built
// once from the values as they stood, and an edit to the original value never
// changes an already-posted period — only the first OPEN period forward
// re-spreads. `buildSchedule` re-walks from period 1 on every call (matching
// this codebase's existing ledger-replay convention elsewhere), which stays
// safe for exactly one reason: every mutator in AssetsContext computes its
// effective period as strictly after `closedThrough` (via `firstOpenPeriod`),
// never typed or backdated. Each mutator asserts that invariant defensively —
// see the `console.assert` calls in AssetsContext.jsx — so a future bug trips
// instead of silently rewriting posted history.
//
// A figure this module cannot compute is never shown as zero (§A4) — see
// format.js's `formatRupiahExact` (real zero) vs the dash it falls back to for
// null.

import { COA_BY_CODE } from "../data/seed/coa";
import { ASSET_CATEGORIES, ASSET_ACCOUNT_ROWS } from "../data/seed/fixedAssets";

// ── Labels ───────────────────────────────────────────────────────────────────

// The module is Fixed Assets; the type inside it is just "Asset" — a register
// row is an Asset, a Prepaid or an Intangible.
export const TYPE_LABELS = { fixed_asset: "Asset", prepaid: "Prepaid", intangible: "Intangible" };
// §1: a fixed asset depreciates; prepaid and intangible both amortise.
export const TYPE_VERB = { fixed_asset: "Depreciates", prepaid: "Amortises", intangible: "Amortises" };
export const TYPE_ORDER = ["fixed_asset", "prepaid", "intangible"];

export const METHOD_LABELS = {
  straight_line: "Straight line",
  declining_balance: "Declining balance",
  declining_then_straight_line: "Declining, then straight line",
};
export const METHOD_ORDER = ["straight_line", "declining_balance", "declining_then_straight_line"];
// A rate isn't in the PRD's field list — the old per-class statutory rates
// (Kelompok Harta) are being deleted along with the fiscal book, and §A4 says
// never show a guessed figure. So a declining method requires an explicit
// per-period rate at creation rather than a silently-manufactured default.
export const RATE_METHODS = ["declining_balance", "declining_then_straight_line"];

export const DURATION_UNIT_LABELS = { months: "Months", years: "Years" };

export const COMPUTATION_LABELS = {
  constant_period: "Constant period",
  no_prorata: "No prorata",
  days_in_period: "Based on days in period",
};
export const COMPUTATION_HINTS = {
  constant_period: "The clock starts in the acquisition month; that period alone is prorated.",
  no_prorata: "The clock starts at the beginning of the acquisition year, as if held all along.",
  days_in_period: "Every period is weighted by its actual days, not treated as equal.",
};
export const COMPUTATION_ORDER = ["constant_period", "no_prorata", "days_in_period"];

export const STATUS_META = {
  draft: { label: "Draft", tone: "draft" },
  running: { label: "Running", tone: "active" },
  paused: { label: "Paused", tone: "paused" },
  disposed: { label: "Disposed", tone: "closed" },
  cancelled: { label: "Cancelled", tone: "closed" },
};
export const STATUS_ORDER = ["running", "paused", "draft", "disposed", "cancelled"];

export const PAUSE_REASONS = ["Held for sale", "Under repair", "Idle — awaiting redeployment", "Disputed", "Other"];
export const CANCELLATION_REASONS = ["Entered in error", "Duplicate record", "Never placed in service", "Discontinued", "Other"];
export const DISPOSAL_REASONS = ["Sold", "Scrapped", "Traded in", "Lost / stolen", "Other"];

// ── GL accounts — resolved from Category, never entered per asset ──────────
// The Item Master convention (seed/items.js ITEM_CATEGORY_ACCOUNTS): the
// account set is configured once per category in settings and displayed
// read-only on the record. Nothing here is typed on the asset, so no asset can
// quietly drift onto an account of its own.
export function assetAccounts(asset) {
  const map = ASSET_CATEGORIES[asset?.category]?.accounts || {};
  return ASSET_ACCOUNT_ROWS.map(([key, label]) => {
    const code = map[key] || null;
    const acct = code ? COA_BY_CODE[code] : null;
    return { key, label, code, name: acct ? acct.name : null };
  });
}

export const categoryLabel = (key) => ASSET_CATEGORIES[key]?.label || key || "—";

// Changing category moves the account that posted depreciation has been
// landing in. Once anything has posted, that value has to be reclassified —
// a journal entry, not a field edit — so the change is blocked here, exactly
// as Item Master blocks a category change while stock exists.
export function categoryChangeGuard(asset, summary) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (summary && summary.posted_periods > 0) {
    const accts = assetAccounts(asset);
    const assetAcct = accts.find((a) => a.key === "asset");
    return {
      blocked: true,
      reason: `Depreciation has posted through ${summary.last_posted_period} to ${assetAcct?.name || "this category's asset account"}. Changing category moves that posted value between accounts, which needs a reclassification journal rather than a field edit.`,
    };
  }
  return { blocked: false, reason: null };
}

// ── Period arithmetic ────────────────────────────────────────────────────────
// "YYYY-MM" strings compare correctly with plain </<=/>/>=, including a
// year-cadence asset's "YYYY-12" rows — same trick ClosePeriodContext relies on.
export function nextPeriod(yyyymm) {
  const [y, m] = yyyymm.split("-").map((n) => parseInt(n, 10));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function yearOf(period) { return parseInt(period.slice(0, 4), 10); }
function stepPeriod(period, unit) {
  return unit === "years" ? `${yearOf(period) + 1}-12` : nextPeriod(period);
}
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); } // m is 1-indexed
function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function daysInYear(y) { return isLeapYear(y) ? 366 : 365; }
function dayOfYear(y, m, d) {
  let days = d;
  for (let i = 1; i < m; i++) days += daysInMonth(y, i);
  return days;
}

// A suspension is recorded in calendar months (it's always computed off the
// monthly `closedThrough`). For a yearly-cadence asset, "is this row
// suspended" is a year-level question — any overlap with the row's calendar
// year suspends that row's whole charge, since there is no monthly row to
// skip individually (§7.3's granularity isn't resolved by the PRD; this is
// the build-time simplification).
function periodInSuspension(period, s, durationUnit) {
  if (durationUnit === "years") {
    const y = period.slice(0, 4);
    const fromY = s.from_period.slice(0, 4);
    const toY = s.to_period ? s.to_period.slice(0, 4) : null;
    return y >= fromY && (toY == null || y <= toY);
  }
  return period >= s.from_period && (s.to_period == null || period <= s.to_period);
}

// ── The nominal period/weight sequence — pure calendar geometry ────────────
// Independent of value, revisions or pauses. `weight` is a same-unit measure
// per period: a fraction of "one period" for constant_period/no_prorata (1.0
// normally, less for a prorated first period), or a raw day-count for
// days_in_period. Ratios between weights are what the walk actually uses, so
// the unit choice doesn't matter as long as it's consistent within one asset.
function buildIdealPeriods({ acquisitionDate, durationValue, durationUnit, computation }) {
  const acqY = parseInt(acquisitionDate.slice(0, 4), 10);
  const acqM = parseInt(acquisitionDate.slice(5, 7), 10);
  const acqD = parseInt(acquisitionDate.slice(8, 10), 10);

  let period;
  let firstFraction = 1;
  if (durationUnit === "years") {
    period = `${acqY}-12`;
    if (computation !== "no_prorata") {
      const total = daysInYear(acqY);
      const owned = total - dayOfYear(acqY, acqM, acqD) + 1;
      firstFraction = owned / total;
    }
  } else {
    const janStart = `${acqY}-01`;
    const naturalStart = `${acqY}-${String(acqM).padStart(2, "0")}`;
    period = computation === "no_prorata" ? janStart : naturalStart;
    if (computation !== "no_prorata") {
      const total = daysInMonth(acqY, acqM);
      const owned = total - acqD + 1;
      firstFraction = owned / total;
    }
  }

  const periods = [];
  for (let i = 0; i < durationValue; i++) {
    let weight = 1;
    if (computation === "days_in_period") {
      const y = parseInt(period.slice(0, 4), 10);
      const m = parseInt(period.slice(5, 7), 10);
      const fullDays = durationUnit === "years" ? daysInYear(y) : daysInMonth(y, m);
      weight = i === 0 ? firstFraction * fullDays : fullDays;
    } else if (i === 0) {
      weight = firstFraction;
    }
    periods.push({ period, weight });
    period = stepPeriod(period, durationUnit);
  }
  return periods;
}

const GUARD = 2400;

// ── The walk ─────────────────────────────────────────────────────────────────
// One pass produces every row — revisions, pauses and a disposal/cancellation
// stop are handled inline, exactly the discipline that keeps a schedule
// summing to its own value (PRD §4, §A4.3): the final period always takes the
// exact remainder, whichever method produced it.
export function buildSchedule(asset, { closedThrough } = {}) {
  const {
    acquisition_date, method, rate, duration_value, duration_unit, computation,
    first_value,
    value_revisions = [], suspensions = [], cancellation, disposal,
  } = asset;

  const rows = [];
  if (!acquisition_date || !duration_value || !duration_unit) {
    rows.periodsRemaining = duration_value ?? null;
    rows.finalPeriod = null;
    return rows;
  }

  const ideal = buildIdealPeriods({ acquisitionDate: acquisition_date, durationValue: duration_value, durationUnit: duration_unit, computation });
  const totalWeight = ideal.reduce((s, p) => s + p.weight, 0);
  const avgWeight = ideal.length ? totalWeight / ideal.length : 1;

  const stopAt = cancellation?.period || (disposal?.date ? disposal.date.slice(0, 7) : null);
  // An open-ended pause has no end to project to — cap the walk at the
  // horizon (closedThrough + 1) instead of generating a century of empty rows.
  const openEnded = suspensions.some((s) => s.to_period == null);
  const horizon = openEnded && closedThrough ? nextPeriod(closedThrough) : null;

  let period = ideal[0]?.period;
  let idx = 0;
  let currentValue = first_value;
  let accumulated = 0;
  let switchedToSL = false;

  for (let guard = 0; guard < GUARD && idx < ideal.length && period; guard++) {
    if (stopAt && period >= stopAt) break;

    const rev = value_revisions.find((r) => r.effective_period === period);
    const valueAdjustment = rev ? rev.new_value - currentValue : 0;
    if (rev) currentValue = rev.new_value;

    const susp = suspensions.find((s) => periodInSuspension(period, s, duration_unit));
    if (susp) {
      if (horizon && period > horizon) break;
      rows.push({
        period, charge: 0, valueAdjustment, accumulated, value: currentValue,
        bookValue: currentValue - accumulated, suspended: true, revised: Boolean(rev),
      });
      period = stepPeriod(period, duration_unit);
      continue; // idx not advanced — duration extends by exactly the paused span
    }

    const base = Math.max(0, currentValue - accumulated);
    const { weight } = ideal[idx];
    const remainingWeight = ideal.slice(idx).reduce((s, p) => s + p.weight, 0);
    const isLast = idx === ideal.length - 1;
    const periodFactor = avgWeight > 0 ? weight / avgWeight : 1;
    const slCharge = isLast || remainingWeight <= 0 ? base : Math.round((base * weight) / remainingWeight);

    let charge;
    if (method === "straight_line") {
      charge = slCharge;
    } else if (method === "declining_balance") {
      const dbCharge = Math.round(base * (rate || 0) * periodFactor);
      charge = isLast ? base : Math.min(dbCharge, base);
    } else {
      // declining_then_straight_line — switch once SL would be larger, stay switched.
      const dbCharge = Math.round(base * (rate || 0) * periodFactor);
      if (!switchedToSL && slCharge > dbCharge) switchedToSL = true;
      charge = isLast ? base : switchedToSL ? slCharge : Math.min(dbCharge, base);
    }

    accumulated += charge;
    rows.push({
      period, charge, valueAdjustment, accumulated, value: currentValue,
      bookValue: currentValue - accumulated, suspended: false, revised: Boolean(rev),
    });

    idx += 1;
    period = stepPeriod(period, duration_unit);
  }

  rows.periodsRemaining = ideal.length - idx;
  rows.finalPeriod = ideal.length ? ideal[ideal.length - 1].period : null;
  return rows;
}

// Fold a raw walk into the summary shape every screen reads.
export function summarizeSchedule(rows, { closedThrough } = {}) {
  const posted = closedThrough ? rows.filter((r) => r.period <= closedThrough) : [];
  const lastPosted = posted.length ? posted[posted.length - 1] : null;
  const next = closedThrough ? rows.find((r) => r.period > closedThrough) : rows[0] || null;
  const accumulated = lastPosted ? lastPosted.accumulated : 0;
  const currentValue = lastPosted ? lastPosted.value : rows.length ? rows[0].value : null;
  return {
    schedule: rows,
    posted_periods: posted.length,
    accumulated,
    current_value: currentValue,
    book_value: currentValue == null ? null : currentValue - accumulated,
    period_charge: lastPosted ? lastPosted.charge : 0,
    next_charge: next ? next.charge : null,
    next_period: next ? next.period : null,
    periods_remaining: rows.periodsRemaining ?? null,
    first_period: rows.length ? rows[0].period : null,
    final_period: rows.finalPeriod ?? (rows.length ? rows[rows.length - 1].period : null),
    last_posted_period: lastPosted ? lastPosted.period : null,
    suspended_periods: posted.filter((r) => r.suspended).length,
    fully_depreciated: accumulated > 0 && currentValue != null && accumulated >= Math.max(0, currentValue),
  };
}

// The effective period for any bounded mutation (§6.1) — the first row the
// close hasn't reached, never typed. Schedule-aware rather than a naive
// calendar-month increment, since a yearly asset's next row may be many
// months away.
export function firstOpenPeriod(rows, closedThrough) {
  const row = rows.find((r) => r.period > closedThrough);
  return row ? row.period : nextPeriod(closedThrough);
}

// ── Guards — none is an approval, all fail closed ───────────────────────────

// Method/rate/duration/computation/acquisition date/type/accounts freeze once
// any period has posted — only reviseValue's bounded flow may still touch the
// value afterward.
export function scheduleLocked(asset, summary) {
  if (!asset) return { locked: true, reason: "Asset not found." };
  if (["disposed", "cancelled"].includes(asset.status)) {
    return { locked: true, reason: "This asset's lifecycle has ended. Its record is read-only." };
  }
  if (summary && summary.posted_periods > 0) {
    return {
      locked: true,
      reason: `Postings exist through ${summary.last_posted_period}. Changing method, duration, computation, rate, acquisition date or type now would silently rewrite a posted schedule.`,
    };
  }
  return { locked: false, reason: null };
}

export function disposalGuard(asset, { targetPeriod, closedThrough } = {}) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (!["running", "paused"].includes(asset.status)) {
    return { blocked: true, reason: "Only a running or paused asset can be disposed of." };
  }
  if (!targetPeriod || !closedThrough) return { blocked: false, reason: null };
  if (targetPeriod <= closedThrough) {
    return { blocked: true, reason: `${targetPeriod} is closed. Disposals can only post into an open period.` };
  }
  const latestAllowed = nextPeriod(nextPeriod(closedThrough));
  if (targetPeriod > latestAllowed) {
    return { blocked: true, reason: `${targetPeriod} is more than one period ahead of the last close (${closedThrough}). Close the periods in between first.` };
  }
  return { blocked: false, reason: null };
}

export function disposalGainLoss(summary, proceeds) {
  if (!summary || summary.book_value == null) return null;
  return (proceeds || 0) - summary.book_value;
}

// ── Journal detail (§7.2) — derived from the posted rows, never re-read from
// the live asset record at reporting time (same discipline as the schedule
// itself). Prepaid posts on a 2-account shape (§1/OQ6, no accumulated contra);
// fixed_asset and intangible post the normal 3-account shape.
export function journalLines(asset, row) {
  const accts = Object.fromEntries(assetAccounts(asset).map((a) => [a.key, a]));
  const lines = [];
  if (row.charge) {
    lines.push(
      asset.type === "prepaid"
        ? { debit: accts.expense, credit: accts.asset, amount: row.charge, note: "Periodic release" }
        : { debit: accts.expense, credit: accts.accumulated, amount: row.charge, note: "Periodic charge" },
    );
  }
  if (row.valueAdjustment) {
    // The correction is its own journal line, distinct from the periodic
    // charge (§6.5) — never blended into one number.
    lines.push({
      debit: row.valueAdjustment > 0 ? accts.asset : null,
      credit: row.valueAdjustment < 0 ? accts.asset : null,
      amount: Math.abs(row.valueAdjustment),
      note: "Value revision adjustment",
    });
  }
  return lines;
}
