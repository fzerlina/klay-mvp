// Item status axes — layered onto the inventory seed the same way vendor
// lifecycle/approval is (see vendorHealth.js), so the two masters behave alike.
//
// Two INDEPENDENT axes (Item Master PRD, §7):
//   1. LIFECYCLE — is the item usable for new transactions?
//        draft    → being written; never had an approved version, so there is
//                   nothing for a bill line to copy. Not selectable.
//        active   → usable on documents, always at its last approved version
//        inactive → retired, replaced, or merged away. Posted history stays
//                   intact and drillable; not selectable on new documents.
//   2. APPROVAL — has the current version of the record been signed off?
//        unapproved       → drafted but not yet submitted
//        pending_approval → waiting on an approver, either for a brand-new item
//                           or for a governed change to a live one
//        approved         → signed off; a frozen version exists
//
// The combination that matters is ACTIVE + PENDING_APPROVAL: a live item with a
// governed change waiting. Its lifecycle never moves, so it stays fully usable
// on new bills at its last approved values while the change sits in review. The
// old single-status model flipped the whole item to "Pending Review", which
// pulled it out of the bill picker and took it offline for as long as review
// took — an approval queue should never stop people raising documents.
//
// Where items differ from vendors: a vendor Draft becomes Active on Submit and
// is usable while approval is still pending, because a vendor supplies no values
// to a bill LINE. An item does (unit, price, tax treatment, GL account), so it
// stays Draft until an approver has signed a version off. Approval only stops
// blocking bill creation once there is something approved to copy.

// Lifecycle pill labels; `tone` maps to the pill styles in inventory.css.
export const ITEM_LIFECYCLE_META = {
  draft:    { label: "Draft",    tone: "draft" },
  active:   { label: "Active",   tone: "active" },
  inactive: { label: "Inactive", tone: "inactive" },
};
// Tab / display order for the list.
export const ITEM_LIFECYCLE_ORDER = ["active", "draft", "inactive"];

// Approval chip labels. Shown beside the lifecycle pill, never instead of it.
export const ITEM_APPROVAL_META = {
  unapproved:       { label: "Not submitted",   tone: "draft" },
  pending_approval: { label: "Pending approval", tone: "pending" },
  approved:         { label: "Approved",         tone: "active" },
};

// The seed predates the split and carries one four-value `status`. Map it onto
// the two axes so the existing records keep their meaning:
//   draft          → drafted, not yet submitted
//   pending_review → drafted and submitted, awaiting its first approval
//   active         → live and signed off
//   inactive       → retired and signed off
const LEGACY = {
  draft:          { lifecycle: "draft",    approval: "unapproved" },
  pending_review: { lifecycle: "draft",    approval: "pending_approval" },
  active:         { lifecycle: "active",   approval: "approved" },
  inactive:       { lifecycle: "inactive", approval: "approved" },
};

export function axesFromLegacy(status) {
  return LEGACY[status] || LEGACY.active;
}

// Approval overrides — live, already-approved items currently sitting in Pending
// approval because a governed change is in review. These are the demo proof that
// the two axes move independently: both stay Active and both stay usable on new
// bills while their change request waits.
export const ITEM_APPROVAL_SEED = {
  INV003: "pending_approval", // Cotton Yarn 30s — sales price rise, submitted by AP
  INV006: "pending_approval", // Folding Table — name fix, submitted by the FM herself
};

// The change requests behind those overrides. A request holds the PROPOSED
// values; the item itself keeps serving its approved ones until an approver
// applies them. `submittedBy` is what makes approver ≠ submitter enforceable.
export const ITEM_CHANGE_REQUEST_SEED = {
  INV003: {
    patch: { sales_price: 58000 },
    submittedBy: "Budi Santoso",
    submittedAt: "2025-04-21",
    reason: "Supplier raised yarn pricing in April.",
  },
  INV006: {
    patch: { name: "Multifunction Folding Table 120cm" },
    // Submitted by the default persona on purpose: opening this item shows the
    // approver ≠ submitter refusal, which is otherwise invisible in a demo.
    submittedBy: "Sari Dewanti",
    submittedAt: "2025-04-22",
    reason: "Name never carried the size; two variants are being confused.",
  },
};

export function seedApprovalFor(itemId, fallback) {
  return ITEM_APPROVAL_SEED[itemId] || fallback;
}
export function seedChangeRequestFor(itemId) {
  return ITEM_CHANGE_REQUEST_SEED[itemId] || null;
}
