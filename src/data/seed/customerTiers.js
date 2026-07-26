// Customer relationship tier — the customer-master source of truth (mirror of
// vendorTiers.js on the AR side). `relationship_tier` is an attribute of the
// CUSTOMER: the same tier shows wherever the customer appears (Customers list,
// Customer Detail, Invoices) and is editable from any of them, writing back here.
//
// Kept in its own file because customers.js is auto-generated (the generator
// would clobber inline edits). Default tier is "standard" (no pill). Tiers:
//   strategic | standard | at_risk
// Each entry carries the required note (1–200 chars, captured on set).
export const CUSTOMER_TIER_SEED = {
  C001: { tier: "strategic", note: "Anchor retail account — largest recurring revenue." },
  C004: { tier: "strategic", note: "Hypermarket chain — strategic distribution partner." },
  C018: { tier: "strategic", note: "High-volume account, large open AR — protect the relationship." },
  C005: { tier: "at_risk",   note: "Large overdue balance on COD terms — collection risk." },
  C009: { tier: "at_risk",   note: "Overdue since January; slow to pay." },
  C015: { tier: "at_risk",   note: "AR far above any limit — repeated late payment." },
  C035: { tier: "at_risk",   note: "Very large overdue concentration — watch exposure." },
  C046: { tier: "at_risk",   note: "Chronic late payer — tighten terms at review." },
};

export function seedTierFor(customerId) {
  return CUSTOMER_TIER_SEED[customerId]?.tier || "standard";
}
export function seedTierNoteFor(customerId) {
  return CUSTOMER_TIER_SEED[customerId]?.note || "";
}
