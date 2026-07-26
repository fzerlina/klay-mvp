// Customer lifecycle status + health signal — layered onto the auto-generated
// seed the same way relationship tier is (customers.js is generated, so extra
// attributes live here to survive regeneration). Mirror of vendorHealth.js.
//
// STATUS extends the base active/inactive with the AR lifecycle states shown as
// the Customers list tabs:
//   pending | active | inactive | blocked
//   - pending: onboarded, awaiting approval (an approver activates it)
//   - inactive: not available for new invoices (dormant or churned)
//   - blocked: credit hold — over-limit / bad-debt / dispute; no new invoices
//     until released. The AR analog of a vendor "blocked".
// Only overrides are listed; any customer absent here keeps its seed status.
export const CUSTOMER_STATUS_OVERRIDE = {
  C013: "pending",
  C026: "pending",
  C044: "pending",
  C005: "blocked",
  C015: "blocked",
};

// HEALTH is the at-a-glance credit/payment-risk chip next to the customer name:
//   healthy → no chip · review → yellow chip · flagged → red chip
// Derived-in-spirit from payment behaviour / over-limit; hand-seeded here.
// Default is healthy.
export const CUSTOMER_HEALTH_SEED = {
  C003: "review",
  C009: "review",
  C035: "review",
  C042: "review",
  C005: "flagged",
  C015: "flagged",
  C046: "flagged",
};

export function seedStatusFor(customerId, fallback) {
  return CUSTOMER_STATUS_OVERRIDE[customerId] || fallback;
}
export function seedHealthFor(customerId) {
  return CUSTOMER_HEALTH_SEED[customerId] || "healthy";
}
