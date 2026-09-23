// ── Inventory Sub-Ledger ─────────────────────────────────────────────────────
//
// A separate module from Item Master, with a boundary between them that this
// file is one side of. It owns every stock figure in the application:
// quantities, unit cost, stock value, movements, costing. Item Master owns
// identity, units, prices, tax defaults and lifecycle, and displays what this
// module publishes — read-only, badged with its source, never recomputed.
//
// WHY THE SPLIT EXISTS. Two facts about a bag of cement look alike and behave
// nothing alike:
//
//   "A bag is 50kg and is a Material."   True today, last year, and regardless
//                                        of what happens in the warehouse.
//   "We hold 340 bags worth Rp 17.85m."  True only at this instant.
//
// Store the second one as a field on the first and you get a quiet catastrophe:
// a cost edited in April re-values January, because the stock value was being
// CALCULATED as quantity × a field a person can type, and that calculation runs
// fresh on every render. A closed month changes. Nobody did anything wrong. No
// record of the change exists.
//
// The fix is not a better formula — average or actual, any cost READ at
// reporting time from an editable field rewrites history. The fix is a different
// SOURCE. Every movement carries the cost it happened at, frozen at entry and
// never revisited; on-hand, stock value and cost/unit are replayed from those
// movements. They become figures nobody can type. The costing method finally
// means something too: it decides how a movement OUT is valued, and nothing else.
//
// Its screens are the Inventory page (/inventory — every movement, across every
// item) and the Stock tab on Item Detail (one item's movements as a timeline).
// Both write through the same door: RECORD A MOVEMENT. There is no "edit the
// stock number" anywhere, because the stock number is not stored — a location's
// on-hand is whatever its movements add up to, so every change leaves a row, a
// date, a reason, a person and a journal behind it. Its published read (§8.2 of
// the PRD) is the only way anything else may learn what stock exists:
//
//     on_hand_qty        by item and location
//     current_unit_cost  by item
//     stock_value        by item and location
//     has_stock          by item          ← drives Item Master's locks
//     as_of              timestamp
//
// No consumer may write, cache as authoritative, or recompute any of it.

import { INVENTORY_OPENING, OPENING_POSTED } from "../data/seed/inventoryOpening";
import { isStocked, ITEM_CATEGORY_ACCOUNTS } from "../data/seed/items";
import { COA_BY_CODE } from "../data/seed/coa";

// ── Reachability ─────────────────────────────────────────────────────────────
// The sub-ledger is a separate module, so "it did not answer" is a state Item
// Master has to render and act on — not a hypothetical. There are no screens to
// take it offline from, so the demo switch is a query flag: append
// ?subledger=down to any Item Master URL. It exists so the fail-closed rules
// below are testable rather than merely written down.
export function subledgerOnline() {
  if (typeof window === "undefined") return true;
  return new URLSearchParams(window.location.search).get("subledger") !== "down";
}

// Numeric part of an id ("ITM007" → 7) — the seed for the deterministic PRNG.
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
// odd reversal (void) — so the ledger shows the full lifecycle, and any
// non-Posted row is stock the books haven't caught up to.
function movementStatus(seed, i, n) {
  if (i === n - 1) return "pending";
  if (i === n - 2) return "draft";
  if ((seed + i) % 6 === 0) return "void";
  return "posted";
}

// ── Opening movements ───────────────────────────────────────────────────────
// Built once per item from seed/inventoryOpening.js. The generated history nets
// exactly to the seeded quantity, at costs that straddle the seeded cost, so the
// replayed average lands near it and the demo figures stay recognisable.
//
// An item with no opening entry gets no movements at all. That is the honest
// "no stock recorded" state, and it must never collapse into a zero.
export function openingMovements(it) {
  if (!isStocked(it)) return [];
  const opening = INVENTORY_OPENING[it.id];
  if (!opening) return [];

  const seed = idNum(it);
  const base = opening.unit_cost || 0;
  const locs = Array.isArray(opening.locations) && opening.locations.length
    ? opening.locations
    : [{ loc: "Main Warehouse", qty: opening.qty || 0 }];

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
      const b = Math.max(1, Math.round((opening.qty || 10) * 0.25));
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
      rows.push({ action: balance > 0 ? "buy" : "sell", loc: l.loc, unit: balance, unit_cost: c3 });
    }
  }
  return stamp(rows, seed);
}

// Seeded history reads like the purchases and sales it stands in for.
const SEED_REASON = { buy: "Goods received", sell: "Goods issued" };
const SEED_ACTORS = ["Rina Kusuma", "Budi Santoso", "Sarah Wijaya"];

// Date/JE/posting-status stamps, oldest first.
function stamp(rows, seed) {
  const dates = HIST_DATES.slice(-Math.min(rows.length, HIST_DATES.length));
  return rows.map((r, i) => ({
    id: `MV-S${seed}-${i + 1}`,
    date: dates[i] || HIST_DATES[HIST_DATES.length - 1],
    reason: SEED_REASON[r.action] || null,
    note: "",
    by: SEED_ACTORS[(seed + i) % SEED_ACTORS.length],
    // Generated history: its JE reference is illustrative, so its status is its
    // own rather than read from whichever seeded entry shares the number.
    seeded: true,
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
// Walk the movements oldest-first, carrying the balance forward. A movement IN
// adds its own cost to the pool. A movement OUT is valued by the costing method:
//
//   average_cost — at the running weighted average of everything on hand
//   actual_cost  — against the oldest layers still on hand, each at the cost it
//                  was bought at (FIFO consumption; true specific-identification
//                  needs a unit-level tag there is no field for, and FIFO is the
//                  honest approximation of it)
//
// Stock can never go negative: an OUT larger than the balance is capped, because
// a negative-stock policy is a sub-ledger decision, not a display's.
function replay(rows, method) {
  let qty = 0;
  let value = 0;
  let layers = []; // actual_cost only: [{qty, cost}], oldest first
  const locQty = {}; // running on-hand per location, for the timeline
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
    // What actually moved, after the cap at zero — the location balance has to
    // follow the same figure the total does.
    const moved = r.unit > 0 ? r.unit : -Math.min(-r.unit, locQty[r.loc] || 0);
    locQty[r.loc] = (locQty[r.loc] || 0) + moved;
    row.balance = qty;
    row.loc_balance = locQty[r.loc];
    out.push(row);
  }

  // Floating-point noise from average-cost division would otherwise show up as
  // Rp 0,0000001 balances on a fully-consumed item.
  if (Math.abs(value) < 1) value = 0;
  return { qty, value, rows: out };
}

// ── The published read (PRD §8.2) ───────────────────────────────────────────
// The ONLY way any other module learns what stock exists. Everything it returns
// is DERIVED. `sessionMovements` are the in-session ones (newest first, as the
// context stores them); they merge with the opening set and replay as one
// ledger.
//
// Four distinct outcomes, and keeping them apart is the whole contract:
//
//   not_applicable — Non-stocked or Service. Stock was never a concept here.
//   unavailable    — the module did not answer. Last known as_of, no figures.
//   no_record      — it answered, and has nothing for this item. NOT zero.
//   known          — real figures, including a real, counted zero.
//
// `has_stock` is deliberately tri-state. `null` means unknown, and every caller
// must treat unknown as "there might be stock" — never as "there is none".
// Unit locks, deactivation, merge and category change all depend on it, and each
// of them is destructive if it guesses wrong.
// Oldest-first, by movement date. Stable, so same-day movements keep the order
// they were recorded in. A backdated movement lands where it happened, not at
// the end — the ledger is a history, not an append log.
function chronological(item, sessionMovements) {
  const all = [...openingMovements(item), ...[...sessionMovements].reverse()];
  return all
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i))
    .map((x) => x.r);
}

export function readStock(item, sessionMovements = [], method = "average_cost", opts = {}) {
  const stocked = isStocked(item);
  const online = opts.online ?? subledgerOnline();

  const base = {
    stocked,
    reachable: online,
    on_hand_qty: null,
    stock_value: null,
    current_unit_cost: null,
    has_stock: null,
    as_of: null,
    by_location: [],
    locations: [],
    movements: [],
    method,
    opening_posted: online ? OPENING_POSTED : null,
  };

  // Stock is not a concept for this item. This is a property of the ITEM, known
  // to Item Master, so it holds even while the sub-ledger is unreachable.
  if (!stocked) return { ...base, state: "not_applicable", has_stock: false, reachable: online };

  if (!online) {
    // Last known as_of is still worth showing — it tells the reader how stale
    // the figures they last saw were. No quantity or value is guessed.
    const opening = openingMovements(item);
    return { ...base, state: "unavailable", as_of: opening.length ? opening[opening.length - 1].date : null };
  }

  // Session movements arrive newest-first; the ledger runs oldest-first.
  const all = chronological(item, sessionMovements);
  // Locations entered on the item (free text, at creation or while recording a
  // movement) exist before anything has moved through them.
  const locNames = [...new Set([...all.map((r) => r.loc), ...(opts.locations || [])].filter(Boolean))];
  if (!all.length) return { ...base, state: "no_record", has_stock: false, locations: locNames };

  const total = replay(all, method);
  const by_location = locNames.map((loc) => {
    const l = replay(all.filter((r) => r.loc === loc), method);
    return { loc, qty: l.qty, value: Math.round(l.value) };
  });

  return {
    ...base,
    state: "known",
    on_hand_qty: total.qty,
    // Rupiah has no sub-unit worth showing, and average-cost division would
    // otherwise put fractions on screen. Rounded once here so every caller
    // prints the same figure.
    stock_value: Math.round(total.value),
    // Cost per unit of nothing is not a number. Value CAN be a known zero — the
    // ledger was replayed and netted out — but there is no cost to carry.
    current_unit_cost: total.qty > 0 ? total.value / total.qty : null,
    has_stock: total.qty > 0,
    as_of: all[all.length - 1].date,
    by_location,
    locations: locNames,
    movements: total.rows.slice().reverse(), // newest first for display
  };
}

// The badge every derived figure carries, so a reader always knows whose number
// this is and how old it is. Naming the module is the point — an unlabelled
// figure on an item page reads as the item's own.
export function sourceBadge(read) {
  if (!read || !read.stocked) return null;
  if (!read.reachable) {
    return read.as_of
      ? `Inventory Sub-Ledger unreachable — last seen ${read.as_of}`
      : "Inventory Sub-Ledger unreachable";
  }
  if (!read.as_of) return "From Inventory Sub-Ledger — no movements recorded";
  return `From Inventory Sub-Ledger, as of ${read.as_of}`;
}

// ── Guards Item Master must honour (fail closed) ────────────────────────────
// Unknown is never treated as "no stock". Each of these actions is destructive
// when it guesses wrong: redefining "1 box = 24 pieces" to "= 12" silently
// reinterprets every quantity already recorded, and deactivating an item that
// still holds stock drops its quantity out of the reports while its value stays
// in the books.
export function stockGuard(read) {
  if (!read || !read.stocked) return { blocked: false, reason: null };
  if (!read.reachable) {
    return { blocked: true, reason: "The Inventory Sub-Ledger can't be reached, so we can't confirm this item holds no stock. Blocked until it answers." };
  }
  if (read.has_stock === null) {
    return { blocked: true, reason: "Stock for this item is unknown. Blocked until the Inventory Sub-Ledger confirms it." };
  }
  if (read.has_stock) {
    const where = read.by_location.length > 1 ? ` across ${read.by_location.length} locations` : "";
    return {
      blocked: true,
      reason: `${read.on_hand_qty.toLocaleString("id-ID")} on hand${where}. Clear stock in the Inventory Sub-Ledger first.`,
    };
  }
  return { blocked: false, reason: null };
}

// The provisioning window (§7.5) — the ONE exemption from unit locking. Legacy
// stock often loads before master data is approved, which would otherwise lock
// the unit fields at exactly the moment they most need correcting. It closes at
// the opening-balance posting rather than on a date, because before that posting
// no financial figure depends on the unit definition. Unknown counts as closed.
export function inProvisioningWindow(item, read) {
  return (
    (item?.lifecycle || "active") === "draft" &&
    Boolean(item?.migration_batch_id) &&
    read?.opening_posted === false
  );
}

export const ACTION_LABELS = { buy: "Receipt", sell: "Issue", adjust: "Adjustment", opening: "Opening balance" };

// ── Recording a movement ─────────────────────────────────────────────────────
// The reasons a person gives for moving stock by hand. Receipts and issues from
// bills and invoices will write their own movements once those documents carry
// item lines; until then they are recorded here, with the reason saying so.
export const MOVEMENT_REASONS = {
  in: ["Goods received", "Stock count — found more", "Returned to stock", "Transfer in", "Other"],
  out: ["Goods issued", "Stock count — found less", "Damaged / expired", "Lost / shrinkage", "Internal use", "Transfer out", "Other"],
};

// Would this movement take its location below zero at any point in its
// history? Checked against the whole timeline, not just today's balance: a
// backdated issue of 50 can be fine today and still leave the location at −30
// on the day it claims to have happened.
export function balanceProblem(item, sessionMovements, candidate) {
  const rows = chronological(item, [candidate, ...sessionMovements]);
  let run = 0;
  for (const r of rows) {
    if (r.loc !== candidate.loc) continue;
    run += r.unit;
    if (run < 0) return { loc: r.loc, date: r.date, short: -run };
  }
  return null;
}

// Unit cost as the ledger stood on a date — what a backdated issue is valued at.
export function costAsOf(item, sessionMovements, date, method = "average_cost") {
  const rows = chronological(item, sessionMovements).filter((r) => r.date <= date);
  if (!rows.length) return null;
  const t = replay(rows, method);
  return t.qty > 0 ? t.value / t.qty : null;
}

// ── The journal a movement writes ────────────────────────────────────────────
// Stock moves here; the books follow as a DRAFT journal entry, reviewed and
// posted on the Journal Entry page like any other. The movement and the entry
// carry each other's reference, so either one leads to the other.
//
//   Increase   Dr Inventory              Cr Inventory Adjustments
//   Decrease   Dr Inventory Adjustments  Cr Inventory
//   Opening    Dr Inventory              Cr Retained Earnings
const ADJUSTMENT_ACCOUNT = "5-1500";
const OPENING_EQUITY_ACCOUNT = "3-1300";

export function inventoryAccount(item) {
  return (ITEM_CATEGORY_ACCOUNTS[item?.category] || {}).inventory || "1-3100";
}

export function movementJournalLines(item, { unit, value, action, loc }) {
  const amt = Math.abs(Math.round(value || 0));
  const inv = inventoryAccount(item);
  const other = action === "opening" ? OPENING_EQUITY_ACCOUNT : ADJUSTMENT_ACCOUNT;
  const [dr, cr] = unit > 0 ? [inv, other] : [other, inv];
  const name = (c) => COA_BY_CODE[c]?.name || c;
  const desc = `${item.name} — ${loc}`;
  return [
    { account_code: dr, account_name: name(dr), debit: amt, credit: 0, description: desc },
    { account_code: cr, account_name: name(cr), debit: 0, credit: amt, description: desc },
  ];
}
