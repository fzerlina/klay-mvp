// The stock ledger — where quantity and value actually come from.
//
// Before this, an item carried a typeable `unit_cost` and every figure on screen
// was computed as quantity × that field. Editing the cost in April therefore
// re-valued January: the calculation ran fresh on every render using today's
// number, so a closed month silently changed and no record of the change
// existed. That is the bug the Item Master PRD opens with (§A3), and it is not
// a formula problem — average or actual, any cost READ at reporting time from a
// field a person can edit rewrites history.
//
// So the fix is not a better formula, it is a different source. Every movement
// carries the cost it happened at, frozen at entry and never revisited. On-hand,
// stock value and cost/unit are replayed FROM those movements, which makes them
// derived figures nobody can type. The costing method finally means something
// too: it decides how a movement OUT is valued, and nothing else.
//
// Item Master displays these read-only. It never stores or recomputes them —
// that is the Inventory Sub-Ledger's job, and this module stands in for it until
// that module exists.

import { INV_UOM_SECONDARY } from "../data/seed/inventory";
import { TODAY } from "./clock";

export const isServiceItem = (it) => it?.category === "service";

// Numeric part of an id ("INV007" → 7) — the seed for the deterministic PRNG.
function idNum(it) {
  const n = parseInt(String(it?.id || "").replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? 1 : n;
}

// Small deterministic PRNG (Lehmer) seeded from the item id.
function seededRandom(seed) {
  let s = (seed * 2654435761) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
}

const roundTo = (n, step) => Math.round(n / step) * step;

const HIST_DATES = [
  "2025-01-09", "2025-01-23", "2025-02-06", "2025-02-20",
  "2025-03-06", "2025-03-20", "2025-04-03", "2025-04-17", "2025-04-22",
];

function jeRef(seed, i) {
  const n = ((seed * 7 + i * 13) % 300) + 1;
  return `JE-2025-${String(n).padStart(4, "0")}`;
}

// Posting status of a movement's journal entry. The newest is left awaiting
// review (pending), the next not-yet-posted (draft), older ones posted, with the
// odd reversal (void) — so History shows the full lifecycle, and any non-Posted
// row is stock the books haven't caught up to.
function movementStatus(seed, i, n) {
  if (i === n - 1) return "pending";
  if (i === n - 2) return "draft";
  if ((seed + i) % 6 === 0) return "void";
  return "posted";
}

// ── Opening movements ───────────────────────────────────────────────────────
// The seed still carries `qty`, `unit_cost` and `locations` per item. They are
// GENERATOR INPUTS only — the same treatment `status` got when it became two
// axes. This builds a movement history per location whose net quantity lands
// exactly on the seeded figure, at costs that straddle the seeded cost, so the
// replayed average comes out near it and the demo numbers stay recognisable.
// Nothing reads item.qty / item.unit_cost / item.value at runtime after this.
export function openingMovements(it) {
  const seed = idNum(it);
  const rnd = seededRandom(seed + 101);
  const base = it.unit_cost || 0;

  if (isServiceItem(it)) {
    // A service isn't stocked, so it has no ledger. Its history is the times it
    // was billed — kept for the History tab, contributing no quantity or value.
    const rows = [];
    const count = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      rows.push({ action: "sell", loc: null, unit: 1 + Math.floor(rnd() * 3), unit_cost: roundTo(base * (0.98 + rnd() * 0.06), 1000) });
    }
    return stamp(rows, seed);
  }

  // A record with no legacy quantity is a genuinely new item: it has no history
  // to generate, and its figures must read "No stock recorded" until an opening
  // balance is posted. That is a real state, not a zero.
  if (it.qty == null) return [];

  const locs = Array.isArray(it.locations) && it.locations.length
    ? it.locations
    : [{ loc: "Main Warehouse", qty: it.qty || 0 }];

  const rows = [];
  for (const l of locs) {
    const target = Math.max(0, Math.round(l.qty || 0));
    // Costs straddle the seeded cost so the replayed weighted average lands on
    // it, and so the two costing methods give visibly different answers.
    const c1 = roundTo(base * 0.92, 100) || base;
    const c2 = roundTo(base * 1.06, 100) || base;
    const c3 = roundTo(base, 100) || base;

    if (target === 0) {
      // Out of stock is a real history that netted to nothing, not an absence.
      const b = Math.max(1, Math.round((it.qty || 10) * 0.25));
      rows.push({ action: "buy", loc: l.loc, unit: b, unit_cost: c1 });
      rows.push({ action: "sell", loc: l.loc, unit: -b, unit_cost: c1 });
      continue;
    }

    // Buys first so the running balance never goes negative, then a sell, then a
    // balancing movement that lands the net exactly on the seeded quantity.
    const b1 = Math.max(1, Math.round(target * 0.7));
    const b2 = Math.max(1, Math.round(target * 0.45));
    const s1 = Math.max(1, Math.round(target * 0.3));
    rows.push({ action: "buy",  loc: l.loc, unit: b1,  unit_cost: c1 });
    rows.push({ action: "buy",  loc: l.loc, unit: b2,  unit_cost: c2 });
    rows.push({ action: "sell", loc: l.loc, unit: -s1, unit_cost: c2 });
    const balance = target - (b1 + b2 - s1);
    if (balance !== 0) {
      rows.push({
        action: balance > 0 ? "buy" : "sell",
        loc: l.loc,
        unit: balance,
        unit_cost: c3,
      });
    }
  }
  return stamp(rows, seed);
}

// Date/JE/posting-status stamps, oldest first.
function stamp(rows, seed) {
  const dates = HIST_DATES.slice(-Math.min(rows.length, HIST_DATES.length));
  return rows.map((r, i) => ({
    date: dates[i] || HIST_DATES[HIST_DATES.length - 1],
    action: r.action,
    loc: r.loc,
    unit: r.unit,
    unit_cost: r.unit_cost,
    // Value is stamped at entry from the movement's OWN cost. This is the whole
    // point: it is a record of what happened, not a calculation to redo later.
    value: r.unit * r.unit_cost,
    je: jeRef(seed, i),
    status: movementStatus(seed, i, rows.length),
  }));
}

// ── Replay ──────────────────────────────────────────────────────────────────
// Walk the movements oldest-first and carry the balance forward. A movement IN
// adds its own cost to the pool. A movement OUT is valued by the costing method:
//
//   average_cost — at the running weighted average of everything on hand
//   actual_cost  — against the oldest layers still on hand, each at the cost it
//                  was bought at (FIFO consumption; true specific-identification
//                  needs a unit-level tag the prototype has no field for, and
//                  FIFO is the honest approximation of it)
//
// Stock can never go negative here: an OUT larger than the balance is capped,
// because a negative-stock policy belongs to the sub-ledger, not to a display.
function replay(rows, method) {
  let qty = 0;
  let value = 0;
  let layers = []; // actual_cost only: [{qty, cost}], oldest first
  const out = [];

  for (const r of rows) {
    const row = { ...r };
    if (r.unit > 0) {
      qty += r.unit;
      value += r.unit * r.unit_cost;
      layers.push({ qty: r.unit, cost: r.unit_cost });
      row.applied_cost = r.unit_cost;
    } else if (r.unit < 0) {
      const want = Math.min(-r.unit, qty);
      // An ADJUSTMENT is not an ordinary consumption. It posted a specific
      // journal amount, so the ledger has to remove exactly that — otherwise the
      // books and the ledger drift apart by the rounding difference between the
      // posted figure and today's running average, with nothing recording why.
      // The whole point of this module is that the two never disagree.
      if (r.action === "adjust" && r.value != null) {
        qty -= want;
        value -= Math.abs(r.value);
        row.applied_cost = r.unit_cost;
        let left = want;
        while (left > 0 && layers.length) {
          const take = Math.min(left, layers[0].qty);
          layers[0].qty -= take;
          left -= take;
          if (layers[0].qty === 0) layers.shift();
        }
      } else if (method === "actual_cost") {
        let left = want;
        let consumed = 0;
        while (left > 0 && layers.length) {
          const take = Math.min(left, layers[0].qty);
          consumed += take * layers[0].cost;
          layers[0].qty -= take;
          left -= take;
          if (layers[0].qty === 0) layers.shift();
        }
        qty -= want;
        value -= consumed;
        row.applied_cost = want > 0 ? consumed / want : r.unit_cost;
      } else {
        const avg = qty > 0 ? value / qty : r.unit_cost;
        qty -= want;
        value -= want * avg;
        row.applied_cost = avg;
        // Keep the layer list honest even when unused, so a method switch
        // mid-session doesn't read a stale pool.
        let left = want;
        while (left > 0 && layers.length) {
          const take = Math.min(left, layers[0].qty);
          layers[0].qty -= take;
          left -= take;
          if (layers[0].qty === 0) layers.shift();
        }
      }
    }
    row.balance = qty;
    out.push(row);
  }

  // Floating-point noise from average-cost division would otherwise show up as
  // Rp 0,0000001 balances on a fully-consumed item.
  if (Math.abs(value) < 1) value = 0;
  return { qty, value, rows: out };
}

// ── The public read ─────────────────────────────────────────────────────────
// Everything the UI is allowed to know about an item's stock. `movements` are
// the in-session ones (newest first, as the context stores them); they are
// merged with the opening set and replayed as one ledger.
//
// on_hand / stock_value / unit_cost are DERIVED. Where there is no ledger at all
// they are null, and the UI must print "No stock recorded" rather than Rp 0 — a
// zero reads as a checked figure and gets believed, while "unavailable" gets
// questioned.
export function stockFor(it, sessionMovements = [], method = "average_cost") {
  const service = isServiceItem(it);
  const opening = openingMovements(it);
  // Session movements arrive newest-first; the ledger runs oldest-first.
  const all = [...opening, ...[...sessionMovements].reverse()];

  if (service || !all.length) {
    return {
      service,
      on_hand: null,
      stock_value: null,
      unit_cost: null,
      as_of: all.length ? all[all.length - 1].date : null,
      byLocation: [],
      rows: all.slice().reverse(),
      method,
    };
  }

  const total = replay(all, method);
  const locNames = [...new Set(all.map((r) => r.loc).filter(Boolean))];
  const byLocation = locNames.map((loc) => {
    const l = replay(all.filter((r) => r.loc === loc), method);
    return { loc, qty: l.qty, value: Math.round(l.value) };
  });

  return {
    service: false,
    on_hand: total.qty,
    // Rupiah has no sub-unit worth showing, and average-cost division would
    // otherwise put fractions on screen. Rounded here, once, so every caller
    // prints the same figure.
    stock_value: Math.round(total.value),
    // Cost per unit of nothing is not a number. Value CAN be a known zero —
    // we replayed the ledger and it netted out — but there is no cost to carry.
    unit_cost: total.qty > 0 ? total.value / total.qty : null,
    as_of: all[all.length - 1].date,
    byLocation,
    rows: total.rows.slice().reverse(), // newest first for display
    method,
  };
}

// Secondary unit + conversion, unchanged — identity data, not stock.
export function productUom(it) {
  const primary = isServiceItem(it) ? null : it.uom || null;
  const sec = primary ? INV_UOM_SECONDARY[primary] : null;
  return { primary, secondary: sec ? sec.unit : null, ratio: sec ? sec.ratio : null };
}

// The badge every derived figure carries, so a reader always knows whose number
// this is and how old it is.
export function sourceBadge(as_of) {
  if (!as_of) return "From stock ledger — no movements recorded";
  return `From stock ledger, as of ${as_of}`;
}

export const LEDGER_TODAY = TODAY.toISOString().slice(0, 10);
export const ACTION_LABELS = { buy: "Buy", sell: "Sell", adjust: "Adjust" };
