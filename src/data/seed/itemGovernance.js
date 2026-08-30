// Item lifecycle — layered onto the item catalogue (seed/items.js).
//
// NOTHING IN ITEM MASTER IS APPROVAL-GATED. Creating an item needs no sign-off,
// and neither does changing one. There is one axis here, not two.
//
// The earlier model had a second APPROVAL axis: governed fields (name, category,
// units, sales price, tax treatment) opened a change request that a second
// person had to sign off, on the reasoning that a bill line copies those values
// and the books then depend on the copy. The reasoning was right about where the
// risk sits and wrong about the remedy. Master-data approval taxes every small
// edit, and the workarounds it breeds — creating a near-duplicate item, or
// picking an existing one that is close enough — are worse than the thing it
// guards against and leave no record to detect.
//
// What replaces it is not nothing. Two mechanisms carry the weight instead:
//
//   1. VERSIONS. Every change freezes a snapshot, and a document copies from a
//      version rather than reading the item at reporting time. An edit made in
//      April therefore cannot restate a bill raised in January — which was
//      always the actual exposure, and which approval only ever addressed
//      indirectly. See ItemsContext.snapshotData / the governing rule in §0.2.
//   2. THE AUDIT TRAIL. Who changed what, when, from what to what. Detection
//      after the fact rather than permission before it.
//
// Guards that remain are NOT approvals — they are physical constraints, and they
// still refuse:
//   • unit fields lock while the Inventory Sub-Ledger reports stock
//   • deactivation is blocked while stock exists
//   • both fail closed when the sub-ledger cannot be reached
//
// LIFECYCLE — is the item usable for new transactions?
//   draft    → an incomplete record: a migration/import batch nobody has
//              finished off. NOT produced by the create form, which lands items
//              Active. Kept because the provisioning window (§7.5) is defined on
//              Draft — during migration, before opening balances post, unit
//              fields must stay editable. Goes live via Activate, which is a
//              completion step and not a sign-off.
//   active   → usable on documents, at its current version
//   inactive → retired, replaced, or merged away. Posted history stays intact
//              and drillable; not selectable on new documents.

// Lifecycle pill labels; `tone` maps to the pill styles in items.css.
export const ITEM_LIFECYCLE_META = {
  draft:    { label: "Draft",    tone: "draft" },
  active:   { label: "Active",   tone: "active" },
  inactive: { label: "Inactive", tone: "inactive" },
};
// Tab / display order for the list.
export const ITEM_LIFECYCLE_ORDER = ["active", "draft", "inactive"];

// The seed carries a legacy `status` string. Map it onto the lifecycle.
const LEGACY = {
  draft:    "draft",
  active:   "active",
  inactive: "inactive",
};

export function lifecycleFromLegacy(status) {
  return LEGACY[status] || "active";
}
