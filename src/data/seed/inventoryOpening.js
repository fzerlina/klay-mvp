// Inventory Sub-Ledger — opening balances.
//
// OWNED BY THE SUB-LEDGER, NOT BY ITEM MASTER. It lives in its own file, keyed
// by item id, for exactly one reason: quantity and cost must not be fields on an
// item. The moment they are, someone edits a cost in April, the stock value is
// recomputed as quantity × that cost, and January — a closed month — silently
// changes. That is the bug the Item Master PRD opens with (§A3), and no formula
// fixes it. Only a different source does.
//
// So these figures are GENERATOR INPUTS, not data. lib/inventorySubledger.js
// reads them once to build each item's movement history, and every stock figure
// in the app is replayed from those movements afterwards. Nothing — not the
// item, not the list, not the detail page — ever reads a number from this file
// at render time.
//
// An item absent from this map has no opening balance. That is a real and
// distinct state: the sub-ledger is reachable and reports "no stock recorded",
// which is NOT the same as zero. Zero is a checked figure someone can act on;
// no record means nobody has counted yet. The UI must keep them apart.
//
// Non-stocked and Service items are absent by definition — stock is not a
// concept for them, so they read "—" rather than either of the above.

export const INVENTORY_OPENING = {
  ITM001: { qty:340,  unit_cost:18500,  locations:[{ loc:"Jakarta Warehouse", qty:200 }, { loc:"Surabaya Warehouse", qty:140 }] },
  ITM002: { qty:85,   unit_cost:96000,  locations:[{ loc:"Jakarta Warehouse", qty:85 }] },
  ITM003: { qty:1200, unit_cost:42000,  locations:[{ loc:"Jakarta Warehouse", qty:700 }, { loc:"Surabaya Warehouse", qty:500 }] },
  ITM004: { qty:60,   unit_cost:135000, locations:[{ loc:"Jakarta Warehouse", qty:60 }] },
  ITM005: { qty:48,   unit_cost:720000, locations:[{ loc:"Jakarta Warehouse", qty:48 }] },
  ITM006: { qty:120,  unit_cost:385000, locations:[{ loc:"Jakarta Warehouse", qty:50 }, { loc:"Surabaya Warehouse", qty:40 }, { loc:"Bandung Warehouse", qty:30 }] },
  ITM007: { qty:15,   unit_cost:540000, locations:[{ loc:"Jakarta Warehouse", qty:15 }] },
  ITM008: { qty:2400, unit_cost:8500,   locations:[{ loc:"Jakarta Warehouse", qty:1500 }, { loc:"Surabaya Warehouse", qty:900 }] },
  ITM009: { qty:180,  unit_cost:48000,  locations:[{ loc:"Jakarta Warehouse", qty:180 }] },
  ITM010: { qty:64,   unit_cost:210000, locations:[{ loc:"Jakarta Warehouse", qty:64 }] },
  // A genuine, counted zero — a history that netted to nothing. Prints "0",
  // never "No stock recorded".
  ITM011: { qty:0,    unit_cost:85000,  locations:[{ loc:"Jakarta Warehouse", qty:0 }] },
  ITM012: { qty:36,   unit_cost:38000,  locations:[{ loc:"Jakarta Warehouse", qty:36 }] },
  ITM013: { qty:3200, unit_cost:3200,   locations:[{ loc:"Jakarta Warehouse", qty:2000 }, { loc:"Surabaya Warehouse", qty:1200 }] },
  ITM014: { qty:140,  unit_cost:62000,  locations:[{ loc:"Jakarta Warehouse", qty:140 }] },
  ITM015: { qty:52,   unit_cost:145000, locations:[{ loc:"Jakarta Warehouse", qty:52 }] },
  ITM016: { qty:8,    unit_cost:96000,  locations:[{ loc:"Jakarta Warehouse", qty:8 }] },
  // ITM017/018 are Non-stocked and ITM019–021 are Services: no entry, on purpose.
};

// Whether an entity's opening balances have posted. The provisioning window
// (PRD §7.5) — the one exemption from unit locking — closes at this posting, not
// at a date, because before it no financial figure depends on the unit
// definition. Unknown is treated as closed (fail closed).
export const OPENING_POSTED = true;
