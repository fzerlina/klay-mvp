// Fixed Assets register — one row per fixed asset, prepaid or intangible.
//
// Method, duration and computation basis are ENTERED per asset (PRD §3).
// ACCOUNTS ARE NOT: they resolve from Category, exactly as Item Master resolves
// an item's eight-account set from its category (seed/items.js
// ITEM_CATEGORY_ACCOUNTS). Category is therefore load-bearing here, not a label —
// which is also why changing it once a period has posted is governed: it moves
// the account posted depreciation has been landing in, and moving posted value
// is a reclassification journal, not a field edit.
//
// THERE IS NO SEPARATE COST/SUB-LEDGER FILE. The PRD's whole point (§A3) is
// that a schedule stores its OWN COPY of the values it was built from —
// lib/fixedAssets.js's `buildSchedule` reads `first_value`/`value_revisions`
// straight off the asset record and never re-derives them from anywhere else,
// so a second module to enforce that boundary (the old Asset Sub-Ledger) isn't
// needed once the register and the schedule engine are the same module.
//
// Scenarios this seed deliberately covers:
// AST001–005  fixed_asset, one of each method/computation combination.
// AST006–007  prepaid — straight line, 2-account posting (§1/OQ6).
// AST008–009  intangible — a monthly and a yearly-cadence license.
// AST010      paused, open-ended (`to_period: null`) — exercises the horizon
//             guard in buildSchedule rather than projecting years of rows.
// AST011      cancelled mid-life — posted charges stand, remaining book value
//             is stranded (§7.5), not folded into a disposal.
// AST012      disposed (sold, with proceeds) — gain/loss vs. book value.
// AST013      a value revision — both figures kept (§6.4): what it was first
//             recognised at, and what it carries now.
// AST014      multiple bills against one asset (§7.6/OQ7 — built toward "many").

// ── Category ────────────────────────────────────────────────────────────────
// Resolves the asset's GL account set (`accounts` below), configured once in
// settings and shown read-only on the asset — the Item Master convention.
// `type` scopes which categories a given register row may pick: a Prepaid can
// only be an Insurance or a Rent Advance, never Machinery.
//
// `null` means the account does not apply to this category. A prepaid has no
// accumulated-contra account (it releases straight out of its own account) and
// no loss-on-disposal account, because a prepaid is never disposed of — it runs
// out.
export const ASSET_CATEGORIES = {
  building:             { label: "Building",             type: "fixed_asset", accounts: { asset: "1-6200", accumulated: "1-6210", expense: "6-3400", loss: "7-1300" } },
  building_services:    { label: "Building Services",    type: "fixed_asset", accounts: { asset: "1-6200", accumulated: "1-6210", expense: "6-3400", loss: "7-1300" } },
  machinery:            { label: "Machinery",            type: "fixed_asset", accounts: { asset: "1-6500", accumulated: "1-6510", expense: "6-3400", loss: "7-1300" } },
  vehicle:              { label: "Vehicle",              type: "fixed_asset", accounts: { asset: "1-6400", accumulated: "1-6410", expense: "6-3400", loss: "7-1300" } },
  office_equipment:     { label: "Office Equipment",     type: "fixed_asset", accounts: { asset: "1-6300", accumulated: "1-6310", expense: "6-3400", loss: "7-1300" } },
  furniture:            { label: "Furniture",            type: "fixed_asset", accounts: { asset: "1-6300", accumulated: "1-6310", expense: "6-3400", loss: "7-1300" } },
  software_license:     { label: "Software Licence",     type: "intangible",  accounts: { asset: "1-7100", accumulated: "1-7110", expense: "6-3400", loss: "7-1300" } },
  trademark:            { label: "Trademark",            type: "intangible",  accounts: { asset: "1-7100", accumulated: "1-7110", expense: "6-3900", loss: "7-1300" } },
  insurance:            { label: "Insurance",            type: "prepaid",     accounts: { asset: "1-4200", accumulated: null,     expense: "6-2800", loss: null } },
  software_subscription:{ label: "Software Subscription", type: "prepaid",    accounts: { asset: "1-4300", accumulated: null,     expense: "6-2600", loss: null } },
  rent_advance:         { label: "Rent Advance",         type: "prepaid",     accounts: { asset: "1-4100", accumulated: null,     expense: "6-2300", loss: null } },
};

export const ASSET_ACCOUNT_ROWS = [
  ["asset",       "Asset Account"],
  ["accumulated", "Accumulated Depreciation / Amortisation"],
  ["expense",     "Depreciation / Amortisation Expense"],
  ["loss",        "Loss on Disposal"],
];

export const categoriesForType = (type) =>
  Object.entries(ASSET_CATEGORIES).filter(([, c]) => c.type === type).map(([key, c]) => ({ key, ...c }));

export const ASSETS = [
  {
    id: "AST001", asset_tag: "FA-0001", name: "Head Office Building",
    description: "6-storey office building, Jl. Industri Raya, Jakarta.",
    category: "building", serial_no: "",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 18_000_000_000,
    acquisition_date: "2016-06-01",
    method: "straight_line", rate: null,
    duration_value: 240, duration_unit: "months", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL002", line_no: 1, desc: "Head office building — purchase", date: "2016-06-01", amount: 18_000_000_000 }],
    updated: "2025-01-01",
  },
  {
    id: "AST002", asset_tag: "FA-0002", name: "CNC Machine 1",
    description: "3-axis CNC milling machine, main production floor.",
    category: "machinery", serial_no: "CNC-2023-041",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 960_000_000,
    acquisition_date: "2023-03-10",
    method: "declining_then_straight_line", rate: 0.03,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL020", line_no: 2, desc: "CNC milling machine", date: "2023-03-10", amount: 960_000_000 }],
    updated: "2023-03-10",
  },
  {
    id: "AST003", asset_tag: "FA-0003", name: "Delivery Van B1234XY",
    description: "Box van, main distribution route.",
    category: "vehicle", serial_no: "VIN-MHK1J1EY0K0123456",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 384_000_000,
    acquisition_date: "2022-09-01",
    method: "declining_balance", rate: 0.02,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL045", line_no: 1, desc: "Delivery van, box body", date: "2022-09-01", amount: 384_000_000 }],
    updated: "2022-09-01",
  },
  {
    id: "AST004", asset_tag: "FA-0004", name: "Server Rack A",
    description: "Rack-mounted server and network infrastructure, HQ data closet.",
    category: "office_equipment", serial_no: "RACK-2024-004",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 96_000_000,
    acquisition_date: "2024-05-15",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "no_prorata",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL091", line_no: 1, desc: "Server rack and switches", date: "2024-05-15", amount: 96_000_000 }],
    updated: "2024-05-15",
  },
  {
    id: "AST005", asset_tag: "FA-0005", name: "Executive Meeting Room Set",
    description: "Conference table and 12 chairs, HQ 4th floor.",
    category: "furniture", serial_no: "",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 72_000_000,
    acquisition_date: "2024-02-09",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "days_in_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL078", line_no: 1, desc: "Conference table and chairs", date: "2024-02-09", amount: 72_000_000 }],
    updated: "2024-02-09",
  },

  // ── Prepaid ──────────────────────────────────────────────────────────────
  {
    id: "AST006", asset_tag: "FA-0006", name: "Annual Property Insurance",
    description: "12-month property and liability insurance policy.",
    category: "insurance", serial_no: "",
    type: "prepaid", subsidiary: "PT Induk",
    first_value: 144_000_000,
    acquisition_date: "2024-11-01",
    method: "straight_line", rate: null,
    duration_value: 12, duration_unit: "months", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL140", line_no: 1, desc: "Property & liability insurance, 12 months", date: "2024-11-01", amount: 144_000_000 }],
    updated: "2024-11-01",
  },
  {
    id: "AST007", asset_tag: "FA-0007", name: "ERP Hosting Subscription",
    description: "24-month prepaid cloud hosting for the core ERP.",
    category: "software_subscription", serial_no: "",
    type: "prepaid", subsidiary: "PT Induk",
    first_value: 96_000_000,
    acquisition_date: "2024-07-01",
    method: "straight_line", rate: null,
    duration_value: 24, duration_unit: "months", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL118", line_no: 1, desc: "ERP hosting, 24-month prepay", date: "2024-07-01", amount: 96_000_000 }],
    updated: "2024-07-01",
  },

  // ── Intangible ───────────────────────────────────────────────────────────
  {
    id: "AST008", asset_tag: "FA-0008", name: "ERP Core Module License",
    description: "Perpetual license, core financials and inventory modules.",
    category: "software_license", serial_no: "LIC-ERP-CORE-2023",
    type: "intangible", subsidiary: "PT Induk",
    first_value: 192_000_000,
    acquisition_date: "2023-09-01",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL091", line_no: 1, desc: "ERP core financials and inventory — perpetual license", date: "2023-09-01", amount: 192_000_000 }],
    updated: "2023-09-01",
  },
  {
    id: "AST009", asset_tag: "FA-0009", name: "Product Trademark Registration",
    description: "5-year registered trademark, flagship product line.",
    category: "trademark", serial_no: "TM-2022-014",
    type: "intangible", subsidiary: "PT Induk",
    first_value: 60_000_000,
    acquisition_date: "2022-03-15",
    method: "straight_line", rate: null,
    duration_value: 5, duration_unit: "years", computation: "no_prorata",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL061", line_no: 1, desc: "Trademark registration, 5-year term", date: "2022-03-15", amount: 60_000_000 }],
    updated: "2022-03-15",
  },

  // ── Paused ───────────────────────────────────────────────────────────────
  {
    id: "AST010", asset_tag: "FA-0010", name: "Spare Extrusion Machine",
    description: "Held idle as a redundant spare, pending redeployment or sale.",
    category: "machinery", serial_no: "EXT-2021-005",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 576_000_000,
    acquisition_date: "2021-02-01",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    status: "paused", value_revisions: [], cancellation: null, disposal: null,
    suspensions: [{ from_period: "2024-09", to_period: null, reason: "Held for sale", note: "", by: "Rudi Hartono" }],
    bills: [{ bill_id: "BILL030", line_no: 1, desc: "Extrusion machine, spare unit", date: "2021-02-01", amount: 576_000_000 }],
    updated: "2024-09-01",
  },

  // ── Cancelled mid-life ───────────────────────────────────────────────────
  {
    id: "AST011", asset_tag: "FA-0011", name: "Failed Prototype Line",
    description: "Pilot production line for a discontinued product, stopped mid-life.",
    category: "machinery", serial_no: "PROTO-2022-002",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 480_000_000,
    acquisition_date: "2022-05-01",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    status: "cancelled", value_revisions: [], suspensions: [], disposal: null,
    cancellation: { period: "2024-11", reason: "Discontinued", note: "Product line discontinued. No buyer identified; not scrapped.", by: "Sarah Wijaya", at: "2024-10-31T09:00:00" },
    bills: [{ bill_id: "BILL058", line_no: 1, desc: "Pilot production line", date: "2022-05-01", amount: 480_000_000 }],
    updated: "2024-10-31",
  },

  // ── Disposed / sold ──────────────────────────────────────────────────────
  {
    id: "AST012", asset_tag: "FA-0012", name: "Old Delivery Truck",
    description: "Box truck, sold at end of useful economic life.",
    category: "vehicle", serial_no: "VIN-MHK9T9ZZ9Z0999999",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 336_000_000,
    acquisition_date: "2018-03-01",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    status: "disposed", value_revisions: [], suspensions: [], cancellation: null,
    disposal: { date: "2024-12-15", reason: "Sold", proceeds: 28_000_000, customer: "CV Armada Bekas Sejahtera", loss_account: "7-1300", document_ref: "INV-DISP-0041" },
    bills: [{ bill_id: "BILL003", line_no: 1, desc: "Box truck", date: "2018-03-01", amount: 336_000_000 }],
    updated: "2024-12-15",
  },

  // ── Value revised ────────────────────────────────────────────────────────
  {
    id: "AST013", asset_tag: "FA-0013", name: "Warehouse Racking — Bandung",
    description: "Heavy-duty pallet racking, cost corrected after a supplier credit note.",
    category: "office_equipment", serial_no: "",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 40_000_000,
    acquisition_date: "2023-06-01",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "constant_period",
    status: "running", suspensions: [], cancellation: null, disposal: null,
    value_revisions: [
      { effective_period: "2025-03", new_value: 42_500_000, reason: "Freight cost added after original invoice", note: "Supplier billed freight separately; capitalised as part of cost.", by: "Sarah Wijaya", at: "2025-02-20" },
    ],
    bills: [{ bill_id: "BILL178", line_no: 2, desc: "Pallet racking system, 6 bays", date: "2023-06-01", amount: 40_000_000 }],
    updated: "2025-02-20",
  },

  // ── Multiple bills (capital additions) ──────────────────────────────────
  {
    id: "AST014", asset_tag: "FA-0014", name: "Packaging Line Conveyor",
    description: "Automated conveyor and case sealer, packaging line 3 — expanded twice since purchase.",
    category: "machinery", serial_no: "CONV-2024-009",
    type: "fixed_asset", subsidiary: "PT Anak A",
    first_value: 480_000_000,
    acquisition_date: "2024-02-15",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [
      { bill_id: "BILL099", line_no: 1, desc: "Conveyor and case sealer — base line", date: "2024-02-15", amount: 480_000_000 },
      { bill_id: "BILL121", line_no: 3, desc: "Additional sensor module — line 3 upgrade", date: "2024-08-10", amount: 18_000_000 },
      { bill_id: "BILL155", line_no: 1, desc: "Conveyor belt replacement — capital repair", date: "2025-01-22", amount: 9_500_000 },
    ],
    updated: "2024-02-15",
  },

  // ── Yearly cadence ───────────────────────────────────────────────────────
  {
    id: "AST015", asset_tag: "FA-0015", name: "HVAC System — HQ",
    description: "Central chiller plant and air handling, Head Office Building.",
    category: "building_services", serial_no: "HVAC-HO-2020-01",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 1_080_000_000,
    acquisition_date: "2020-08-01",
    method: "declining_then_straight_line", rate: 0.15,
    duration_value: 15, duration_unit: "years", computation: "constant_period",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL140", line_no: 1, desc: "Chiller plant and AHU installation", date: "2020-08-01", amount: 1_080_000_000 }],
    updated: "2020-08-01",
  },

  // ── Prepaid rent ─────────────────────────────────────────────────────────
  {
    id: "AST016", asset_tag: "FA-0016", name: "Bandung Warehouse Rent — Advance",
    description: "18-month advance rent, Bandung warehouse lease.",
    category: "rent_advance", serial_no: "",
    type: "prepaid", subsidiary: "PT Induk",
    first_value: 270_000_000,
    acquisition_date: "2024-10-01",
    method: "straight_line", rate: null,
    duration_value: 18, duration_unit: "months", computation: "no_prorata",
    status: "running", value_revisions: [], suspensions: [], cancellation: null, disposal: null,
    bills: [{ bill_id: "BILL135", line_no: 1, desc: "Warehouse lease, 18 months advance", date: "2024-10-01", amount: 270_000_000 }],
    updated: "2024-10-01",
  },
];

export function assetById(id) {
  return ASSETS.find((a) => a.id === id) || null;
}
