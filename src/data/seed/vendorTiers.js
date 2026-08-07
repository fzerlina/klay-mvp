// Vendor relationship tier — the vendor-master source of truth (PRD TP-02).
// `relationship_tier` is an attribute of the VENDOR, not of AP Aging: the same
// tier shows wherever the vendor appears (AP Aging, Vendor master, Bill Detail
// vendor panel) and is editable from any of them, writing back here.
//
// Kept in its own file because vendors.js is auto-generated (the generator
// would clobber inline edits). Default tier is "standard" (no pill). Tiers:
//   strategic | standard | at_risk
// Each entry carries the required note (PRD: 1–200 chars, captured on set).
export const VENDOR_TIER_SEED = {
  V001: { tier: "strategic", note: "Recurring high-value electronics supplier — core to production." },
  V003: { tier: "strategic", note: "Monthly logistics service contract." },
  V005: { tier: "at_risk",   note: "Slow-paying; documented history of disputes." },
  V008: { tier: "strategic", note: "Software maintenance partner — renewal leverage." },
  V010: { tier: "strategic", note: "Annual insurance cover." },
  V012: { tier: "at_risk",   note: "Inactive; unresolved disputes." },
  V020: { tier: "at_risk",   note: "Large overdue concentration — watch sequencing." },
  // Formerly "Blocked" — that lifecycle state was dropped for MVP; the
  // in-dispute / risky signal is carried by the At-Risk tier instead.
  V035: { tier: "at_risk",   note: "Bank-detail fraud alert — verifying payee before releasing payment." },
  V043: { tier: "at_risk",   note: "Active dispute on last delivery — hold on new commitments." },
};

export function seedTierFor(vendorId) {
  return VENDOR_TIER_SEED[vendorId]?.tier || "standard";
}
export function seedTierNoteFor(vendorId) {
  return VENDOR_TIER_SEED[vendorId]?.note || "";
}
