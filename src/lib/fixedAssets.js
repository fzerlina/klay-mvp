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

// The SME's three (Depreciation & Amortization Calculation, Sept 2026). The
// old "declining, then straight line" hybrid is dropped: it appears nowhere in
// their spec and was inherited from the fiscal-book design that §10 deleted.
export const METHOD_LABELS = {
  straight_line: "Straight line",
  declining_balance: "Declining balance",
  none: "None — not depreciated",
};
export const METHOD_ORDER = ["straight_line", "declining_balance", "none"];
// A declining method needs an explicit per-period rate: the old per-class
// statutory rates (Kelompok Harta) went with the fiscal book, and §A4 says
// never show a guessed figure.
export const RATE_METHODS = ["declining_balance"];
// `none` is for an indefinite-life intangible — goodwill. It is not a way of
// pausing a schedule; it means the asset has no useful life to spread a cost
// over, so it sits at cost until an impairment test moves it. No duration is
// required and no schedule is ever built.
export const NO_SCHEDULE_METHODS = ["none"];
export const methodBuildsSchedule = (method) => !NO_SCHEDULE_METHODS.includes(method);

// Years are an INPUT CONVENIENCE, not a cadence. The SME works exclusively in
// months — an 8-year life is 96 months charged monthly — so a duration typed
// in years is multiplied out and every schedule in the module is monthly.
export const DURATION_UNIT_LABELS = { months: "Months", years: "Years" };
export const durationInMonths = (asset) =>
  asset?.duration_unit === "years" ? Number(asset.duration_value || 0) * 12 : Number(asset?.duration_value || 0);

export const COMPUTATION_LABELS = {
  constant_period: "Constant period",
  no_prorata: "No prorata",
  days_in_period: "Based on days in period",
};
export const COMPUTATION_HINTS = {
  constant_period: "The in-service month alone is prorated by the days left in it; every later month is equal.",
  no_prorata: "The in-service month is charged in full, even if the asset arrived on the last day of it.",
  days_in_period: "Every month is weighted by its actual days, so a 31-day month charges more than February.",
};
export const COMPUTATION_ORDER = ["constant_period", "no_prorata", "days_in_period"];

// ── The three status axes (§7) ───────────────────────────────────────────────
//
// One pill used to do three jobs and did none of them honestly. Split:
//
//   lifecycle           does this record exist at all?      draft / active / void
//   book_status         what the ledger is doing            6 states, one journal each
//   operational_status  what is happening on the ground     6 states, ZERO ledger effect
//
// The split closes a real bug. The old pause reasons included "Under repair"
// and "Idle", and pausing stopped the charge and extended the duration —
// which PSAK 16 forbids, and which §7.3 of the PRD had already flagged. Idle
// and under-repair are now operational facts that touch nothing. The only
// thing short of disposal that stops a charge is a held-for-sale reclass, and
// that is a book event with its own journal.
//
// Book status is DERIVED from dated events (AssetsContext), never picked from
// a dropdown — a dropdown would let someone start depreciation in a closed
// period, which is the exact failure §0.2 exists to prevent.

export const LIFECYCLE_META = {
  draft: { label: "Draft", tone: "draft", hint: "Being defined. Nothing posts and no schedule exists." },
  active: { label: "Active", tone: "active", hint: "A live register row, whatever its book status." },
  inactive: {
    label: "Inactive", tone: "closed",
    hint: "Out of play — either settled and archived, or entered in error. Reversible, and never reachable while the asset is still depreciating.",
  },
};
export const LIFECYCLE_ORDER = ["draft", "active", "inactive"];

// Michael's five, exactly. There is deliberately no "schedule stopped" state:
// under PSAK 16 / IAS 16 an asset depreciates until it is derecognised or
// reclassified as held for sale, so "on the books, never charging again" is
// not a position the standard recognises. A discontinued asset that has not
// been sold or scrapped keeps depreciating and is IDLE on the operational
// axis — which is the whole reason that axis exists.
export const BOOK_STATUS_ORDER = [
  "under_construction",
  "capitalized_not_in_service",
  "in_service",
  "held_for_sale",
  "disposed",
];

// The tone drives the pill colour.
export const BOOK_STATUS_TONE = {
  under_construction: "draft",
  capitalized_not_in_service: "draft",
  in_service: "active",
  held_for_sale: "paused",
  disposed: "closed",
};

// Generic labels — used for the register's tabs, which span all three types.
export const BOOK_STATUS_LABELS = {
  under_construction: "Under construction",
  capitalized_not_in_service: "Capitalized, not in service",
  in_service: "In service",
  held_for_sale: "Held for sale",
  disposed: "Disposed",
};

// A prepaid is never built and never marketed; an intangible is developed
// rather than constructed and is derecognised rather than disposed of. Same
// six states underneath — the vocabulary is what changes, so the dropdown
// never offers a row an option that makes no sense for it.
export const BOOK_STATUS_BY_TYPE = {
  fixed_asset: BOOK_STATUS_LABELS,
  prepaid: {
    capitalized_not_in_service: "Not yet releasing",
    in_service: "Releasing",
    disposed: "Written off",
  },
  intangible: {
    under_construction: "In development",
    capitalized_not_in_service: "Not yet in use",
    in_service: "In use",
    disposed: "Derecognised",
  },
};

// The display form. Only one state is long enough to matter — Michael's
// "Capitalized, not in service" — and it was setting the width of every
// control that shows a book status. The full wording is what the tooltip, the
// Status card and the PRD use; this is what the pill and the dropdown show.
// Nothing is renamed: one label has a short form.
export const BOOK_STATUS_SHORT = { ...BOOK_STATUS_LABELS, capitalized_not_in_service: "Capitalized" };

export function bookStatusShort(asset) {
  // The prepaid and intangible wordings are already short, so only the
  // fixed-asset vocabulary needs the override.
  if (!asset?.type || asset.type === "fixed_asset") {
    return BOOK_STATUS_SHORT[asset?.book_status] || bookStatusLabel(asset);
  }
  return bookStatusLabel(asset);
}

export const bookStatusesForType = (type) =>
  BOOK_STATUS_ORDER.filter((k) => BOOK_STATUS_BY_TYPE[type || "fixed_asset"]?.[k]);

export function bookStatusLabel(asset) {
  const map = BOOK_STATUS_BY_TYPE[asset?.type] || BOOK_STATUS_LABELS;
  return map[asset?.book_status] || BOOK_STATUS_LABELS[asset?.book_status] || asset?.book_status || "—";
}

// What each book state actually does to the ledger. Shown on the detail page,
// because "changing book status changes the ledger" is only a useful rule if
// the screen says which ledger movement it means.
export const BOOK_STATUS_LEDGER = {
  under_construction: "Cost accumulates in Construction in Progress. No depreciation.",
  capitalized_not_in_service: "Cost sits in the asset account. Still no depreciation — the asset is not yet available for use.",
  in_service: "Depreciating. This is the only state that posts a periodic charge.",
  held_for_sale: "Reclassified out of PPE to a current-asset line. Depreciation stops; the duration extends by the length of the hold.",
  disposed: "Derecognised. Off the balance sheet, with a gain or loss against book value.",
};

// Manually selected. Nothing here reaches a journal — that is the whole point
// of the axis, and the reason "Under repair" no longer stops a charge.
export const OPERATIONAL_META = {
  in_use: { label: "In use", hint: "Being used for operations — deployed, running, on the packaging." },
  idle: { label: "Idle", hint: "Owned and functional, not currently used — seasonal shutdown, spare capacity, replaced but retained, licence seats nobody has deployed." },
  under_repair: { label: "Under repair", hint: "Out of service for maintenance or overhaul. Still depreciating." },
  in_transit: { label: "In transit", hint: "Moving between sites. A move between entities is a disposal in one book and an acquisition in the other — not a transit." },
  awaiting_disposal: { label: "Awaiting disposal", hint: "Permanently withdrawn from use, not yet sold, scrapped or derecognised. Still on the books and still charging unless it has been reclassified." },
  missing: { label: "Missing", hint: "Cannot be located. Failed a count." },
};
export const OPERATIONAL_ORDER = ["in_use", "idle", "under_repair", "in_transit", "awaiting_disposal", "missing"];

// Rendered as a pill, in the same tone vocabulary as the book status, so the
// two axes are read the same way. The useful side effect: on a row where they
// agree the two pills agree in colour, and on a contradiction they clash —
// which is the thing worth noticing before you have read either word.
export const OPERATIONAL_TONE = {
  in_use: "active",
  idle: "inactive",
  under_repair: "pending",
  in_transit: "draft",
  awaiting_disposal: "pending",
  missing: "blocked",
};

// Scoped per type, the same way book status is — and for the same reason: an
// option a row can never legitimately hold should not be in its dropdown.
//
// A prepaid has none. The only state that would parse is "in use", and that is
// just a restatement of the book status; an axis that always agrees with
// another axis is not a second axis.
//
// An intangible has three. Under repair, in transit and missing are physical
// facts a licence cannot have. The three that survive are the ones that carry
// real information — above all IDLE, which is shelfware: two hundred seats
// owned, forty deployed, and the books amortising all two hundred. That is the
// same signal as an idle machine, and scoping the axis to physical assets was
// hiding it for a whole type.
export const OPERATIONAL_BY_TYPE = {
  fixed_asset: OPERATIONAL_ORDER,
  intangible: ["in_use", "idle", "awaiting_disposal"],
  prepaid: [],
};
export const operationalStatesForType = (type) => OPERATIONAL_BY_TYPE[type] || [];
export const operationalApplies = (type) => operationalStatesForType(type).length > 0;
export const operationalLabel = (key) => OPERATIONAL_META[key]?.label || null;

export const HOLD_REASONS = ["Listed for sale", "Sale agreed", "Withdrawn from use pending sale", "Other"];
export const DEACTIVATION_REASONS = [
  "Entered in error",
  "Duplicate record",
  "Never acquired",
  "Settled — archived from the working register",
  "Other",
];
export const DISPOSAL_REASONS = ["Sold", "Scrapped", "Traded in", "Written off — discontinued", "Lost / stolen", "Other"];

export const BOOK_EVENT_LABELS = {
  created: "Created",
  capitalized: "Capitalized",
  placed_in_service: "Placed in service",
  held_for_sale: "Reclassified — held for sale",
  returned_to_service: "Returned to service",
  disposed: "Disposed",
  deactivated: "Made inactive",
  reactivated: "Reactivated",
};

// ── Status contradictions ───────────────────────────────────────────────────
// The point of keeping the axes apart is that they can disagree, and a
// disagreement is information. None of these blocks anything: each is an
// advisory the register surfaces and a human resolves, because the fix is a
// dated event, not a field correction.
export function statusConflicts(asset) {
  const out = [];
  if (!asset || asset.lifecycle !== "active") return out;
  const op = asset.operational_status;
  const bs = asset.book_status;

  const physical = asset.type === "fixed_asset";
  const charging = physical ? "depreciating" : "amortising";

  if (op === "in_use" && (bs === "under_construction" || bs === "capitalized_not_in_service")) {
    out.push({
      key: "in_use_not_in_service",
      tier: "review",
      title: `In use, but not ${charging}`,
      detail: `${physical ? "On the floor this asset is in use" : "This is deployed and in use"}; in the books it is ${bookStatusLabel(asset).toLowerCase()}, so no charge is posting. If it is available for use, place it in service and name the date — that date is what starts the schedule.`,
    });
  }

  // Shelfware. Only worth raising once the thing is actually charging, which
  // is why it is scoped to in_service rather than fired on any idle row.
  if (op === "idle" && bs === "in_service" && asset.type === "intangible") {
    out.push({
      key: "idle_intangible",
      tier: "advisory",
      title: "Owned and amortising, but not deployed",
      detail: "This is charging to the P&L every period while nothing is using it. That is correct accounting — an unused intangible still amortises — but it is worth knowing before the next renewal, because the cheapest fix is usually not to renew.",
    });
  }
  if (op === "missing" && ["in_service", "held_for_sale"].includes(bs)) {
    out.push({
      key: "missing_still_carried",
      tier: "advisory",
      title: "Missing, still carried",
      detail: "This asset failed a count and is still on the balance sheet at book value. It keeps depreciating until someone decides otherwise — writing it off is a disposal, not a status change.",
    });
  }
  if (op === "awaiting_disposal" && bs === "in_service") {
    out.push({
      key: "withdrawn_still_in_service",
      tier: "advisory",
      title: "Withdrawn from use, still in service",
      detail: physical
        ? "Depreciation continues, which is correct under PSAK 16 for an asset that is merely withdrawn. If a sale is being pursued, reclassify it to held for sale — that is the reclass that stops the charge."
        : "Amortisation continues, which is correct while the asset is still recognised. There is no held-for-sale route for an intangible, so the only thing that stops the charge is derecognising it.",
    });
  }
  if (op && op !== "missing" && bs === "disposed") {
    out.push({
      key: "operational_after_disposal",
      tier: "advisory",
      title: "Operational status set on a disposed asset",
      detail: "This asset is off the balance sheet. Its operational status is stale and should be cleared.",
    });
  }
  return out;
}

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

// D in the SME's base formula: the amount actually spread over the life.
// Everything below depreciates DOWN TO the salvage value, not to zero, so an
// asset with a residual ends its life carrying that residual rather than nil.
export const depreciableValue = (currentValue, salvage) =>
  Math.max(0, (Number(currentValue) || 0) - (Number(salvage) || 0));

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
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); } // m is 1-indexed

// A hold is recorded in calendar months, and so is every schedule row, so the
// comparison is direct. (This used to need a year-level special case; years
// are now an input convenience only — see `durationInMonths`.)
function periodInHold(period, h) {
  return period >= h.from_period && (h.to_period == null || period <= h.to_period);
}

// ── The nominal period/weight sequence — pure calendar geometry ────────────
// Independent of value, revisions or holds. `weight` is a same-unit measure
// per period: a fraction of "one period" for constant_period/no_prorata (1.0
// normally, less for a prorated first period), or a raw day-count for
// days_in_period. Ratios between weights are what the walk actually uses, so
// the unit choice doesn't matter as long as it's consistent within one asset.
//
// The sequence starts at the IN-SERVICE date, not the acquisition date. Cost
// can sit in CIP or in PPE for months before an asset is available for use,
// and depreciating from the purchase date would charge periods in which the
// asset was not yet earning anything.
function buildIdealPeriods({ startDate, durationMonths, computation }) {
  const acqY = parseInt(startDate.slice(0, 4), 10);
  const acqM = parseInt(startDate.slice(5, 7), 10);
  const acqD = parseInt(startDate.slice(8, 10), 10);

  // Every schedule starts in the IN-SERVICE MONTH. An earlier build started
  // `no_prorata` in January of that year, which was wrong against the SME's
  // spec: their `full_period` starts in the activation month and charges it
  // whole, "even the last day of that period" — it does not reach backwards.
  let period = `${acqY}-${String(acqM).padStart(2, "0")}`;
  const totalDays = daysInMonth(acqY, acqM);
  const firstFraction = computation === "no_prorata" ? 1 : (totalDays - acqD + 1) / totalDays;

  const periods = [];
  for (let i = 0; i < durationMonths; i++) {
    let weight = 1;
    if (computation === "days_in_period") {
      const y = parseInt(period.slice(0, 4), 10);
      const m = parseInt(period.slice(5, 7), 10);
      const fullDays = daysInMonth(y, m);
      weight = i === 0 ? firstFraction * fullDays : fullDays;
    } else if (i === 0) {
      weight = firstFraction;
    }
    periods.push({ period, weight });
    period = nextPeriod(period);
  }
  return periods;
}

const GUARD = 2400;

// ── The walk ─────────────────────────────────────────────────────────────────
// One pass produces every row — revisions, holds and a disposal/stop are
// handled inline, exactly the discipline that keeps a schedule summing to its
// own value (PRD §4, §A4.3): the final period always takes the exact
// remainder, whichever method produced it.
//
// NO SERVICE DATE, NO SCHEDULE. An asset that is under construction or
// capitalized-but-not-in-service has no rows at all, and the caller is told so
// explicitly (`not_in_service`) rather than being handed a column of zeroes —
// §A4's "never a guess, never a bare zero" applied to a whole table.
export function buildSchedule(asset, { closedThrough } = {}) {
  const {
    service_date, method, rate, computation,
    first_value, salvage_value,
    value_revisions = [], holds = [], disposal, lifecycle,
  } = asset;

  const salvage = Number(salvage_value) || 0;
  const durationMonths = durationInMonths(asset);

  const rows = [];
  rows.carryingValue = first_value ?? null;
  rows.salvage = salvage;
  rows.depreciable = depreciableValue(first_value, salvage);

  // An inactive record that never entered service has nothing to report — it
  // never ran. Not zero, and not "not computable" either: there is simply
  // nothing there. An inactive record that DID run keeps its whole schedule,
  // because archiving a sold truck must not erase what it charged.
  if (lifecycle === "inactive" && !service_date) {
    rows.carryingValue = null;
    rows.periodsRemaining = null;
    rows.finalPeriod = null;
    rows.neverRan = true;
    return rows;
  }
  // An indefinite-life intangible has no useful life to spread a cost over.
  // It is not "not yet in service" and not an error: it sits at cost until an
  // impairment test moves it, and saying so is different from showing nothing.
  if (!methodBuildsSchedule(method)) {
    rows.periodsRemaining = null;
    rows.finalPeriod = null;
    rows.notDepreciated = true;
    return rows;
  }
  if (!service_date || !durationMonths) {
    rows.periodsRemaining = durationMonths || null;
    rows.finalPeriod = null;
    rows.notInService = true;
    return rows;
  }

  const ideal = buildIdealPeriods({ startDate: service_date, durationMonths, computation });
  const totalWeight = ideal.reduce((s, p) => s + p.weight, 0);
  const avgWeight = ideal.length ? totalWeight / ideal.length : 1;

  const stopAt = disposal?.date ? disposal.date.slice(0, 7) : null;
  // An open-ended hold has no end to project to — cap the walk at the horizon
  // (closedThrough + 1) instead of generating a century of empty rows.
  const openEnded = holds.some((h) => h.to_period == null);
  const horizon = openEnded && closedThrough ? nextPeriod(closedThrough) : null;

  let period = ideal[0]?.period;
  let idx = 0;
  let currentValue = first_value;
  let accumulated = 0;

  for (let guard = 0; guard < GUARD && idx < ideal.length && period; guard++) {
    if (stopAt && period >= stopAt) break;

    // A revision normally matches a row exactly. It can fail to when the
    // revision was recorded before the schedule existed — the effective period
    // is computed off the close, and the schedule starts at the in-service
    // date, which may be later. Anything stamped at or before the first row is
    // pulled onto the first row rather than skipped, because a revision that
    // matches nothing disappears in silence, and a wrong value nobody is told
    // about is the worst outcome this module has.
    const isFirstRow = rows.length === 0;
    const rev = value_revisions.find(
      (r) => r.effective_period === period || (isFirstRow && r.effective_period <= period),
    );
    const valueAdjustment = rev ? rev.new_value - currentValue : 0;
    if (rev) currentValue = rev.new_value;

    const hold = holds.find((h) => periodInHold(period, h));
    if (hold) {
      if (horizon && period > horizon) break;
      rows.push({
        period, charge: 0, valueAdjustment, accumulated, value: currentValue,
        bookValue: currentValue - accumulated, held: true, revised: Boolean(rev),
      });
      period = nextPeriod(period);
      continue; // idx not advanced — duration extends by exactly the held span
    }

    // D = value less salvage. Everything below releases down to the salvage
    // value, never past it, so an asset with a residual ends its life carrying
    // that residual rather than nil.
    const base = Math.max(0, depreciableValue(currentValue, salvage) - accumulated);
    const { weight } = ideal[idx];
    const remainingWeight = ideal.slice(idx).reduce((s, p) => s + p.weight, 0);
    const isLast = idx === ideal.length - 1;
    const periodFactor = avgWeight > 0 ? weight / avgWeight : 1;
    const slCharge = isLast || remainingWeight <= 0 ? base : Math.round((base * weight) / remainingWeight);

    // The last period is the balancing entry either way — the SME's spec and
    // §A5.3 agree: it absorbs the remainder so the total lands exactly on D.
    let charge;
    if (method === "declining_balance") {
      const dbCharge = Math.round(base * (rate || 0) * periodFactor);
      charge = isLast ? base : Math.min(dbCharge, base);
    } else {
      charge = slCharge;
    }

    accumulated += charge;
    rows.push({
      period, charge, valueAdjustment, accumulated, value: currentValue,
      bookValue: currentValue - accumulated, held: false, revised: Boolean(rev),
    });

    idx += 1;
    period = nextPeriod(period);
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
  // A not-yet-in-service asset has a real carrying value — its cost, sitting
  // in CIP or in PPE with nothing released against it. That is a known figure,
  // not an uncomputable one, so it is not rendered as "Not computable".
  const currentValue = lastPosted ? lastPosted.value : rows.length ? rows[0].value : (rows.carryingValue ?? null);
  return {
    schedule: rows,
    not_in_service: Boolean(rows.notInService),
    not_depreciated: Boolean(rows.notDepreciated),
    never_ran: Boolean(rows.neverRan),
    salvage_value: rows.salvage ?? 0,
    depreciable_value: rows.depreciable ?? null,
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
    held_periods: posted.filter((r) => r.held).length,
    fully_depreciated:
      accumulated > 0 && currentValue != null
      && accumulated >= depreciableValue(currentValue, rows.salvage ?? 0),
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

// Every dated book event lands in an open period, for the same reason a
// disposal does: the event posts a journal, and a journal cannot land in a
// month the close has already signed off.
function openPeriodReason(targetPeriod, closedThrough, subject) {
  if (!targetPeriod || !closedThrough) return null;
  if (targetPeriod <= closedThrough) {
    return `${targetPeriod} is closed. ${subject} can only post into an open period.`;
  }
  const latestAllowed = nextPeriod(nextPeriod(closedThrough));
  if (targetPeriod > latestAllowed) {
    return `${targetPeriod} is more than one period ahead of the last close (${closedThrough}). Close the periods in between first.`;
  }
  return null;
}

const terminal = (asset) => asset.lifecycle === "inactive" || asset.book_status === "disposed";

// Method/rate/duration/computation/service date/type/accounts freeze once any
// period has posted — only reviseValue's bounded flow may still touch the
// value afterward.
export function scheduleLocked(asset, summary) {
  if (!asset) return { locked: true, reason: "Asset not found." };
  if (terminal(asset)) {
    return { locked: true, reason: "This asset's lifecycle has ended. Its record is read-only." };
  }
  if (summary && summary.posted_periods > 0) {
    return {
      locked: true,
      reason: `Postings exist through ${summary.last_posted_period}. Changing method, duration, computation, rate, in-service date or type now would silently rewrite a posted schedule.`,
    };
  }
  return { locked: false, reason: null };
}

// under_construction → capitalized_not_in_service. Cost moves out of CIP into
// the category's own asset account. Still no depreciation.
export function capitaliseGuard(asset) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (asset.lifecycle !== "active") return { blocked: true, reason: "Only an active record can be capitalized." };
  if (asset.book_status !== "under_construction") {
    return { blocked: true, reason: "Only an asset under construction can be capitalized — this one already carries its cost in the asset account." };
  }
  return { blocked: false, reason: null };
}

// → in_service. THE event: it sets the service date, and the service date is
// what builds the schedule. Nothing depreciates before it.
export function placeInServiceGuard(asset, { targetPeriod, closedThrough } = {}) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (asset.lifecycle !== "active") return { blocked: true, reason: "Only an active record can be placed in service." };
  if (!["under_construction", "capitalized_not_in_service"].includes(asset.book_status)) {
    return { blocked: true, reason: "This asset is already in service, or its life has ended." };
  }
  const reason = openPeriodReason(targetPeriod, closedThrough, "An in-service date");
  if (reason) return { blocked: true, reason };
  return { blocked: false, reason: null };
}

// in_service → held_for_sale. The reclass out of PPE, and the only thing
// short of disposal that stops a charge.
export function holdForSaleGuard(asset) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (asset.lifecycle !== "active") return { blocked: true, reason: "Only an active record can be reclassified." };
  if (asset.book_status !== "in_service") {
    return { blocked: true, reason: "Only an in-service asset can be reclassified to held for sale — nothing else has a charge to stop." };
  }
  if (!ASSET_CATEGORIES[asset.category]?.accounts?.held_for_sale) {
    return { blocked: true, reason: "This category has no held-for-sale account, so there is nowhere to reclassify the cost to." };
  }
  return { blocked: false, reason: null };
}

export function returnToServiceGuard(asset) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (asset.book_status !== "held_for_sale") {
    return { blocked: true, reason: "Only an asset held for sale can be returned to service." };
  }
  return { blocked: false, reason: null };
}

// Deactivation is the lifecycle axis, not the book axis. Inactive means "out
// of play", and it is reached for two quite different reasons:
//
//   entered in error — nothing ever posted, so there is no journal to undo
//   settled          — disposed or stopped, and archived out of the working list
//
// Both are legitimate; what is not is using it on an asset that is still
// depreciating, which would take a live schedule out of the register without
// settling it. That guard is the whole reason this state stays honest, and it
// is why the refusal names the exits rather than saying "not allowed".
export function deactivateGuard(asset, summary) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (asset.lifecycle !== "active") return { blocked: true, reason: "This record is not active." };
  const settled = asset.book_status === "disposed";
  const nothingPosted = !summary || summary.posted_periods === 0;
  if (!settled && !nothingPosted) {
    return {
      blocked: true,
      reason: `This asset is still live — ${summary.posted_periods} period${summary.posted_periods === 1 ? " has" : "s have"} posted, through ${summary.last_posted_period}. Dispose of it first; making the record inactive now would take a running schedule out of the register without settling it.`,
    };
  }
  return { blocked: false, reason: null };
}

// Inactive is reversible — that is the substantive difference from a disposal,
// which is not.
export function reactivateGuard(asset) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (asset.lifecycle !== "inactive") return { blocked: true, reason: "This record is already active." };
  return { blocked: false, reason: null };
}

export function disposalGuard(asset, { targetPeriod, closedThrough } = {}) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (asset.lifecycle !== "active") return { blocked: true, reason: "Only an active record can be disposed of." };
  if (asset.book_status === "disposed") return { blocked: true, reason: "This asset has already been disposed of." };
  const reason = openPeriodReason(targetPeriod, closedThrough, "Disposals");
  if (reason) return { blocked: true, reason };
  return { blocked: false, reason: null };
}

// Every legal move out of the current book status, with the event each one
// runs and the guard that may refuse it.
//
// THE DROPDOWN DOES NOT SET THE STATUS. It picks a destination, and the
// destination opens its own dated event — the in-service date, the hold
// reason, the disposal proceeds. The rule carried over from the
// derived-status design is the one that matters: no book status changes
// without an event, and no event lands in a closed period.
//
// Note what is absent. Nothing returns to `under_construction`, and nothing walks
// back from `in_service` to `capitalized_not_in_service`. Un-starting depreciation
// is not a status change, it is a reversal.
export function bookStatusTransitions(asset, { closedThrough } = {}) {
  if (!asset) return [];
  if (asset.lifecycle !== "active") return [];
  const labels = BOOK_STATUS_BY_TYPE[asset.type] || BOOK_STATUS_LABELS;
  const nextOpen = closedThrough ? nextPeriod(closedThrough) : null;
  const backToService = asset.book_status === "held_for_sale";

  const defs = [
    { to: "capitalized_not_in_service", action: "capitalise", guard: capitaliseGuard(asset) },
    {
      to: "in_service",
      action: backToService ? "return" : "service",
      guard: backToService
        ? returnToServiceGuard(asset)
        : placeInServiceGuard(asset, { targetPeriod: nextOpen, closedThrough }),
    },
    { to: "held_for_sale", action: "hold", guard: holdForSaleGuard(asset) },
    { to: "disposed", action: "dispose", guard: disposalGuard(asset, { targetPeriod: nextOpen, closedThrough }) },
  ];

  return defs
    .filter((d) => labels[d.to] && d.to !== asset.book_status)
    .map((d) => ({ to: d.to, action: d.action, label: labels[d.to], blocked: d.guard.blocked, reason: d.guard.reason }));
}

// The operational axis has no transitions to compute — every state is
// reachable from every other, which is exactly the point. What it has is a
// question of whether the axis is live at all.
export function operationalEditable(asset) {
  if (!asset) return { blocked: true, reason: "Asset not found." };
  if (!operationalApplies(asset.type)) {
    return { blocked: true, reason: "A prepaid has no operational axis — it is not on a floor." };
  }
  if (asset.lifecycle !== "active") {
    return { blocked: true, reason: "This record is inactive. Reactivate it before recording what is happening to it." };
  }
  if (asset.book_status === "disposed") {
    return { blocked: true, reason: "This asset is off the balance sheet. It has no operational state to record." };
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

// ── Book-event journals ─────────────────────────────────────────────────────
// Michael's rule for the axes is that a book-status change moves the ledger
// and an operational one does not. That rule is only checkable if the screen
// shows which movement each event means, so every book event carries its own
// lines. Placing in service and stopping a schedule move nothing — they change
// what the NEXT period charges — and returning an empty list is the honest
// answer for them.
export function bookEventLines(asset, event, summary) {
  const accts = Object.fromEntries(assetAccounts(asset).map((a) => [a.key, a]));
  const value = summary?.current_value ?? asset.first_value ?? 0;
  const accumulated = summary?.accumulated || 0;

  switch (event?.event) {
    case "capitalized":
      if (!accts.cip?.code) return [];
      return [{ debit: accts.asset, credit: accts.cip, amount: value, note: "Cost moves out of construction in progress" }];
    case "held_for_sale":
      if (!accts.held_for_sale?.code) return [];
      return [
        { debit: accts.held_for_sale, credit: accts.asset, amount: value, note: "Reclassified out of PPE at cost" },
        accumulated
          ? { debit: accts.accumulated, credit: accts.held_for_sale, amount: accumulated, note: "Accumulated depreciation follows the reclass" }
          : null,
      ].filter(Boolean);
    case "returned_to_service":
      if (!accts.held_for_sale?.code) return [];
      return [{ debit: accts.asset, credit: accts.held_for_sale, amount: value, note: "Reclassified back into PPE" }];
    default:
      return [];
  }
}
