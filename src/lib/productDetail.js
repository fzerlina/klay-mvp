// Product Detail derivations.
//
// The inventory seed carries item identity (see data/seed/inventory.js).
// Product Detail needs a few more views on top of that — a
// cost/pricing breakdown, the GL account mapping, and the record audit trail.
// Where the seed does not carry an explicit value these are derived
// deterministically from the item so the prototype shows consistent, believable
// numbers. Stock quantity, value and cost/unit are NOT here — they come from
// the movement ledger in lib/stockLedger.js.
//
// Everything here is a pure function of the item — no Date.now()/Math.random(),
// so the same item always renders the same detail.

import { INV_CATEGORY_ACCOUNTS, INV_ACCOUNT_ROWS } from "../data/seed/inventory";
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

// ── Cost & pricing ───────────────────────────────────────────────────────────
// Only two money fields live on an item now, and neither values inventory:
//
//   sales_price    — ENTERED and governed. What we sell it for, copied onto an
//                    invoice at entry. Never estimated: a blank sales price is
//                    blank, and an item without one can't go on a sales document.
//   purchase_price — COPIED reference. It pre-fills a bill line so a buyer
//                    doesn't retype a number, and in production it refreshes
//                    from the last price a supplier actually invoiced. It values
//                    nothing, which is why it needs no approval.
//
// What used to live here — cost_price and cost/unit — is gone. Both were names
// for the valuation cost, which no item may carry: it is replayed from the
// movement ledger (lib/stockLedger.js). The costing method moved there too,
// because it decides how a movement OUT is valued and nothing else.
//
// The reference purchase price is still derived from the seed's legacy cost, but
// only through the id-seeded PRNG — a stable stand-in for "last invoiced price"
// on records that have no purchase history. It is generation, not a live read:
// no editable field feeds it.
export function productCost(it) {
  const rnd = seededRandom(idNum(it));
  const drift = 0.95 + rnd() * 0.08;            // 0.95–1.03 of the legacy cost
  return {
    purchase_price: it.purchase_price ?? roundTo((it.unit_cost || 0) * drift, 100),
    // No fallback. Blank means not sold.
    sales_price: it.sales_price ?? null,
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

// ── Audit trail ──────────────────────────────────────────────────────────────
// The master-data change log for the item — who created it, edited it, and moved
// it along the two status axes (lifecycle Draft → Active → Inactive, and each
// approval cycle). Distinct from Movement History (which tracks stock), this
// tracks changes to the record itself. Deterministic per item for the prototype.
const AUDIT_ACTORS = ["Rina Kusuma", "Budi Santoso", "Sarah Wijaya", "Andi Prasetyo"];
const AUDIT_DATES = ["2025-01-15", "2025-02-03", "2025-02-20", "2025-03-10", "2025-03-28", "2025-04-12"];

export function productAudit(item) {
  const rnd = seededRandom(idNum(item) + 202);
  const actor = () => AUDIT_ACTORS[Math.floor(rnd() * AUDIT_ACTORS.length)];
  const lifecycle = item.lifecycle || "active";
  const approval = item.approval || "approved";
  const everApproved = (item.current_version || 0) > 0;

  const events = [{ action: "Created", detail: "Added as Draft", actor: actor() }];
  if (!isServiceItem(item)) events.push({ action: "Updated", detail: "Set unit of measure and sales price", actor: actor() });
  if (everApproved || approval !== "unapproved") events.push({ action: "Submitted for approval", detail: "Sent to a manager for sign-off", actor: actor() });
  if (everApproved) events.push({ action: "Approved", detail: "Lifecycle set to Active", actor: actor() });
  if (lifecycle === "inactive") events.push({ action: "Deactivated", detail: "Lifecycle set to Inactive", actor: actor() });
  // A live item with a change in review — the open request is the newest event.
  if (everApproved && approval === "pending_approval") events.push({ action: "Change requested", detail: "Governed field edited — awaiting approval", actor: actor() });

  // Oldest → newest; the final event is stamped with the item's last-updated date.
  const dates = AUDIT_DATES.slice(-events.length);
  return events.map((e, i) => ({
    ...e,
    date: (i === events.length - 1 && item.updated) ? item.updated : (dates[i] || AUDIT_DATES[AUDIT_DATES.length - 1]),
  }));
}
