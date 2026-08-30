// Item Master derivations — everything the catalogue can work out for itself.
//
// The test that keeps this file honest: NO FIELD A PERSON CAN TYPE IS READ HERE
// TO COMPUTE A FINANCIAL NUMBER. There is no cost, no quantity and no stock
// value anywhere below. Those come from the Inventory Sub-Ledger
// (lib/inventorySubledger.js) and are only ever displayed.
//
// Everything here is a pure function of the item — no Date.now()/Math.random(),
// so the same item always renders the same detail.

import {
  ITEM_UOM_LABELS, ITEM_CATEGORY_ACCOUNTS, ITEM_ACCOUNT_ROWS, isStocked, isServiceItem,
} from "../data/seed/items";
import { COA_BY_CODE } from "../data/seed/coa";
import { stockGuard, inProvisioningWindow } from "./inventorySubledger";

export { isStocked, isServiceItem };

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

// ── Units of measure ─────────────────────────────────────────────────────────
// Two kinds of conversion, and the difference decides whether a quantity may
// carry decimals:
//
//   Count   — a whole-number packaging relationship. 1 box = 24 pieces. An entry
//             in the secondary unit must resolve to a whole number of primary
//             units, or it is refused rather than silently rounded.
//   Measure — a continuous relationship. 1 kg = 1000 g. Decimals are allowed to
//             the declared precision.
//
// Conversion applies at DOCUMENT ENTRY, never at reporting. A document stores
// the primary quantity and its own copy of the ratio, so re-reading the item
// later can never restate a posted line.
export function itemUnits(it) {
  const lbl = (u) => (u ? (ITEM_UOM_LABELS[u] || u) : null);
  const primary = it?.primary_unit || null;
  const secondary = it?.secondary_unit || null;
  return {
    primary,
    primaryLabel: lbl(primary) || "—",
    secondary,
    secondaryLabel: lbl(secondary) || "—",
    kind: it?.unit_kind || null,
    conversionType: it?.conversion_type || null,
    ratio: it?.conversion_ratio ?? null,
    precision: it?.precision ?? 0,
    // "1 box = 24 pcs", or nothing when the item has no secondary unit.
    conversionText: (primary && secondary && it?.conversion_ratio)
      ? `1 ${lbl(primary)} = ${it.conversion_ratio.toLocaleString("id-ID")} ${lbl(secondary)}`
      : null,
  };
}

// ── The unit lock ────────────────────────────────────────────────────────────
// Unit fields are frozen while the sub-ledger reports stock, because changing
// them reinterprets quantities that already exist. Redefining "1 box = 24
// pieces" to "= 12" does not restate anything — it silently changes what every
// recorded box MEANT, and no entry in any log says so.
//
// The lock FAILS CLOSED. Unknown is treated as "there might be stock", never as
// "there is none", because the destructive outcome is on the permissive side.
//
// The single exemption is the provisioning window: during migration, before an
// entity's opening balances have posted, no financial figure yet depends on the
// unit definition, and that is exactly when legacy units most need correcting.
export function unitLock(item, read) {
  if (!isStocked(item)) return { locked: false, reason: null };
  if (inProvisioningWindow(item, read)) {
    return { locked: false, reason: null, provisioning: true };
  }
  const guard = stockGuard(read);
  if (!guard.blocked) return { locked: false, reason: null };
  return {
    locked: true,
    reason: `Units are locked. ${guard.reason} Changing a unit or conversion would reinterpret every quantity already recorded against this item.`,
  };
}

// ── GL accounts (read-only here; configured per category in settings) ────────
// Displayed, never chosen per item. A category change moves the Inventory
// account, which is why the change is governed and guarded — stock already
// posted to the old account has to be reclassified, and that reclassification is
// a journal entry owned by the Inventory Sub-Ledger, not by this module.
export function itemAccounts(it) {
  const map = ITEM_CATEGORY_ACCOUNTS[it?.category] || {};
  return ITEM_ACCOUNT_ROWS.map(([key, label]) => {
    const code = map[key] || null;
    const acct = code ? COA_BY_CODE[code] : null;
    return { key, label, code, name: acct ? acct.name : null };
  });
}

// ── Audit trail ──────────────────────────────────────────────────────────────
// The master-data change log: who created the record, edited it, and moved it
// along the two status axes. Distinct from stock movements, which are the
// sub-ledger's ledger and are not shown on this page at all. Deterministic per
// item so the prototype renders consistently.
const AUDIT_ACTORS = ["Rina Kusuma", "Budi Santoso", "Sarah Wijaya", "Andi Prasetyo"];
const AUDIT_DATES = ["2025-01-15", "2025-02-03", "2025-02-20", "2025-03-10", "2025-03-28", "2025-04-12"];

export function itemAudit(item) {
  const rnd = seededRandom(idNum(item) + 202);
  const actor = () => AUDIT_ACTORS[Math.floor(rnd() * AUDIT_ACTORS.length)];
  const lifecycle = item.lifecycle || "active";
  const approval = item.approval || "approved";
  const everApproved = (item.current_version || 0) > 0;

  const events = [{ action: "Created", detail: "Added as Draft", actor: actor() }];
  if (isStocked(item)) events.push({ action: "Updated", detail: "Set unit of measure and sales price", actor: actor() });
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
