// Customer status axes — layered onto the auto-generated seed the same way
// relationship tier is (customers.js is generated, so extra attributes live here
// to survive regeneration). Mirror of vendorHealth.js.
//
// Two INDEPENDENT axes (Customer Master MVP):
//   1. LIFECYCLE status — draft | active | inactive
//        draft    → freshly onboarded, not usable for invoices until submitted
//        active   → usable
//        inactive → dormant / churned, not available for new invoices
//      ("Blocked" is NOT a lifecycle state — see the credit-hold flag below.)
//   2. APPROVAL status — has the current version of the record been signed off?
//        approved          → reviewed and signed off
//        pending_approval  → a new customer, or a sensitive change, awaiting an
//                            approver. Stays usable to CREATE invoices; approval
//                            only becomes blocking at posting.
//
// CREDIT HOLD is an independent flag (on_hold), NOT a lifecycle state and NOT a
// tab: an Active customer can be placed on hold (over-limit / bad-debt / dispute)
// and released without changing its lifecycle. This replaces the old "blocked".
//
// A new customer lands Draft + Pending approval. Only overrides are listed; any
// customer absent keeps its seed lifecycle status and defaults to "approved".

// Lifecycle overrides (active/inactive only). Empty by default — the generated
// seed already carries a handful of inactive customers.
export const CUSTOMER_STATUS_OVERRIDE = {};

// Approval overrides — customers currently sitting in Pending approval. The
// first four are freshly onboarded (no completed approval cycle); C008
// demonstrates an established, active customer bounced back to Pending after a
// sensitive change — proof that approval is independent of lifecycle.
export const CUSTOMER_APPROVAL_SEED = {
  C013: "pending_approval",
  C026: "pending_approval",
  C044: "pending_approval",
  C019: "pending_approval",
  C008: "pending_approval",
};

// Credit-hold overrides — the customers formerly modelled as "blocked". A hold
// is an independent flag, not a lifecycle state: these stay Active but can't take
// new invoices until an approver releases the hold. Reason is captured.
export const CUSTOMER_HOLD_SEED = {
  C005: "AR far exceeds the credit limit — new orders paused until paid down.",
  C015: "Open dispute on recent deliveries — hold pending resolution.",
};

export function seedStatusFor(customerId, fallback) {
  return CUSTOMER_STATUS_OVERRIDE[customerId] || fallback;
}
export function seedApprovalFor(customerId) {
  return CUSTOMER_APPROVAL_SEED[customerId] || "approved";
}
export function seedHoldFor(customerId) {
  return CUSTOMER_HOLD_SEED[customerId] || null;
}
