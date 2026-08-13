// Product Detail derivations.
//
// The inventory seed carries identity + on-hand valuation (see data/seed/
// inventory.js). Product Detail needs a few more views on top of that — a
// secondary unit of measure, a cost/pricing breakdown, the GL account mapping,
// and a movement history. Where the seed doesn't carry an explicit value these
// are derived deterministically from the item so the prototype shows consistent,
// believable numbers without a live ledger. A real build would read these from
// the item record, the category settings, and the stock-ledger respectively.
//
// Everything here is a pure function of the item — no Date.now()/Math.random(),
// so the same item always renders the same detail.

import {
  INV_UOM_SECONDARY,
  INV_CATEGORY_ACCOUNTS,
  INV_ACCOUNT_ROWS,
  INV_COSTING_LABELS,
} from "../data/seed/inventory";
import { COA_BY_CODE } from "../data/seed/coa";

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

// ── Unit of measurement ──────────────────────────────────────────────────────
// Primary is the stocking unit; secondary is the base unit it breaks down to.
export function productUom(it) {
  const primary = isServiceItem(it) ? null : it.uom || null;
  const sec = primary ? INV_UOM_SECONDARY[primary] : null;
  return {
    primary,
    secondary: sec ? sec.unit : null,
    ratio: sec ? sec.ratio : null,
  };
}

// ── Cost & pricing ───────────────────────────────────────────────────────────
// cost_price   — moving-average valuation cost (what stock is carried at).
// purchase_price — most recent purchase (PO) price; drifts a little from cost.
// sales_price  — list selling price; a category markup over cost.
const SALES_MARKUP = {
  raw_material: 1.25, finished_goods: 1.55, supplies: 1.35, packaging: 1.4, service: 1.7,
};
const COSTING_BY_CATEGORY = {
  finished_goods: "fifo", service: "standard",
};

export function productCost(it) {
  const cost = it.unit_cost || 0;
  const rnd = seededRandom(idNum(it));
  const drift = 0.95 + rnd() * 0.08;            // 0.95–1.03 of cost
  const method = it.costing_method || COSTING_BY_CATEGORY[it.category] || "weighted_average";
  const markup = SALES_MARKUP[it.category] || 1.4;
  return {
    costing_method: method,
    costing_label: INV_COSTING_LABELS[method] || method,
    cost_price: it.cost_price ?? cost,
    purchase_price: it.purchase_price ?? roundTo(cost * drift, 100),
    sales_price: it.sales_price ?? roundTo(cost * markup, 500),
  };
}

// ── GL accounts (read-only; configured in Product Category Settings) ─────────
export function productAccounts(it) {
  const map = INV_CATEGORY_ACCOUNTS[it.category] || {};
  return INV_ACCOUNT_ROWS.map(([key, label]) => {
    const code = map[key] || null;
    const acct = code ? COA_BY_CODE[code] : null;
    return { key, label, code, name: acct ? acct.name : null };
  });
}

// ── Movement history ─────────────────────────────────────────────────────────
// A short, deterministic stock-ledger for the item. Buy adds units, Sell removes
// them, Adjust is a stock-take correction. `value` is unit × cost/unit (signed).
// `je` links to the journal entry the movement posted through.
const HIST_DATES = [
  "2025-01-09", "2025-01-23", "2025-02-06", "2025-02-20",
  "2025-03-06", "2025-03-20", "2025-04-03", "2025-04-17", "2025-04-22",
];

function jeRef(seed, i) {
  const n = ((seed * 7 + i * 13) % 300) + 1;
  return `JE-2025-${String(n).padStart(4, "0")}`;
}

export function productHistory(it) {
  const seed = idNum(it);
  const rnd = seededRandom(seed + 101);
  const cost = it.unit_cost || 0;
  const rows = [];

  if (isServiceItem(it)) {
    // Services aren't stocked — history is the times the service was billed.
    const count = 2 + Math.floor(rnd() * 3);              // 2–4 billings
    for (let i = 0; i < count; i++) {
      const units = 1 + Math.floor(rnd() * 3);
      const unitCost = roundTo(cost * (0.98 + rnd() * 0.06), 1000);
      rows.push({ action: "sell", unit: units, unit_cost: unitCost });
    }
  } else {
    // Opening stock-take, then a mix of buys and sells.
    rows.push({ action: "adjust", unit: Math.max(1, Math.round((it.qty || 0) * 0.6)), unit_cost: cost });
    const moves = 3 + Math.floor(rnd() * 3);              // 3–5 further moves
    for (let i = 0; i < moves; i++) {
      const isBuy = rnd() > 0.5;
      const base = Math.max(1, Math.round((it.qty || 10) * (0.1 + rnd() * 0.3)));
      const unitCost = roundTo(cost * (0.94 + rnd() * 0.12), 100);
      rows.push({ action: isBuy ? "buy" : "sell", unit: isBuy ? base : -base, unit_cost: unitCost });
    }
  }

  // Assign the most recent dates so the log ends near the item's last update.
  const dates = HIST_DATES.slice(-rows.length);
  return rows.map((r, i) => ({
    date: dates[i] || HIST_DATES[HIST_DATES.length - 1],
    action: r.action,
    unit: r.unit,
    unit_cost: r.unit_cost,
    value: r.unit * r.unit_cost,
    je: jeRef(seed, i),
  }));
}

export const ACTION_LABELS = { buy: "Buy", sell: "Sell", adjust: "Adjust" };
