// Vendor status axes — layered onto the auto-generated seed the same way
// relationship tier is (vendors.js is generated, so extra attributes live here
// to survive regeneration).
//
// Two INDEPENDENT axes (Vendor Master MVP):
//   1. LIFECYCLE status — is the vendor usable for new transactions?
//        active   → usable
//        inactive → retired / replaced, not available for new transactions
//      ("Blocked" was dropped for MVP — "in dispute / risky" is now carried by
//       the In Dispute relationship tier, and "stop using entirely" is Inactive.)
//   2. APPROVAL status — has the current version of the record been signed off?
//        approved          → reviewed and signed off
//        pending_approval  → a new vendor, or a sensitive (bank/payee) change,
//                            awaiting an approver. The vendor stays usable to
//                            CREATE bills; approval only becomes blocking at
//                            posting & payment (see reviewWorkflow.js).
//
// A new vendor lands Active + Pending approval. Lifecycle and approval move
// independently — an active vendor can sit in pending approval after a change.
// Only overrides are listed; any vendor absent keeps its seed lifecycle status
// and defaults to "approved".

// Lifecycle overrides (active/inactive only). Empty by default — the generated
// seed already carries a handful of inactive vendors, and nothing is forced
// otherwise. Kept as a hook for hand-seeding demo lifecycle states.
export const VENDOR_STATUS_OVERRIDE = {};

// Approval overrides — vendors currently sitting in Pending approval. The first
// five are freshly onboarded drafts; V008 demonstrates an established, active
// (Strategic) vendor bounced back to Pending after a bank/payee change — proof
// that approval is independent of lifecycle and relationship tier.
export const VENDOR_APPROVAL_SEED = {
  V011: "pending_approval",
  V030: "pending_approval",
  V057: "pending_approval",
  V067: "pending_approval",
  V069: "pending_approval",
  V008: "pending_approval",
};

export function seedStatusFor(vendorId, fallback) {
  return VENDOR_STATUS_OVERRIDE[vendorId] || fallback;
}
export function seedApprovalFor(vendorId) {
  return VENDOR_APPROVAL_SEED[vendorId] || "approved";
}
