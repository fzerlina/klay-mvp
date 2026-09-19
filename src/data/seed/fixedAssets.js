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
// THREE STATUS AXES (PRD §7, Sept 2026). Every row carries all three:
//   lifecycle          draft | active | inactive   — is this record in play?
//   book_status        5 states                    — what the ledger is doing
//   operational_status 6 / 3 / 0 states by type     — what is happening on the ground
// `service_date` is the one that starts the schedule. An asset with no service
// date has no schedule at all — not a schedule of zeroes.
//
// Scenarios this seed deliberately covers:
// AST001-005  fixed_asset, one of each method/computation combination.
// AST003      in service but UNDER REPAIR — keeps depreciating (PSAK 16).
//             Also the salvage-value case: releases down to Rp 24,000,000, not nil.
// AST005      in service but MISSING — an advisory flag, not a stop.
// AST006-007  prepaid — straight line, 2-account posting (§1/OQ6). NO
//             operational axis: a policy is not on a floor.
// AST008-009  intangible — a monthly and a yearly-cadence license. FA-0009 is
//             IDLE: shelfware, still amortising with nothing using it.
// AST010      held for sale, open-ended — exercises the horizon guard in
//             buildSchedule rather than projecting years of rows.
// AST011      discontinued but still in service — the case the dropped
//             "schedule stopped" state used to hold. Keeps depreciating, IDLE.
// AST012      disposed (sold, with proceeds) — gain/loss vs. book value.
// AST013      a value revision — both figures kept (§6.4).
// AST014      multiple bills against one asset (§7.6/OQ7).
// AST017      under construction — cost in CIP, NO schedule exists yet.
// AST018      capitalized, not in service, but operationally IN USE — the
//             contradiction the three-axis split is there to surface.
// AST019      inactive — entered in error before anything posted.
// AST021      goodwill — method "none", indefinite life, NO schedule at all.
// AST020      intangible IN DEVELOPMENT but operationally IN USE — the same
//             contradiction as AST018, on the type that could not raise it
//             until the operational axis was scoped per type.

// ── Category ────────────────────────────────────────────────────────────────
// Resolves the asset's GL account set (`accounts` below), configured once in
// settings and shown read-only on the asset — the Item Master convention.
// `type` scopes which categories a given register row may pick: a Prepaid can
// only be an Insurance or a Rent Advance, never Machinery.
//
// `null` means the account does not apply to this category. A prepaid has no
// accumulated-contra account (it releases straight out of its own account) and
// no loss-on-disposal account, because a prepaid is never disposed of — it runs
// out. `cip` and `held_for_sale` are the two accounts the book-status axis
// moves cost between; neither applies to a prepaid, which is never built and
// never marketed.
export const ASSET_CATEGORIES = {
  building:             { label: "Building",             type: "fixed_asset", accounts: { asset: "1-6200", accumulated: "1-6210", expense: "6-3400", loss: "7-1300", cip: "1-6600", held_for_sale: "1-5400" } },
  building_services:    { label: "Building Services",    type: "fixed_asset", accounts: { asset: "1-6200", accumulated: "1-6210", expense: "6-3400", loss: "7-1300", cip: "1-6600", held_for_sale: "1-5400" } },
  machinery:            { label: "Machinery",            type: "fixed_asset", accounts: { asset: "1-6500", accumulated: "1-6510", expense: "6-3400", loss: "7-1300", cip: "1-6600", held_for_sale: "1-5400" } },
  vehicle:              { label: "Vehicle",              type: "fixed_asset", accounts: { asset: "1-6400", accumulated: "1-6410", expense: "6-3400", loss: "7-1300", cip: "1-6600", held_for_sale: "1-5400" } },
  office_equipment:     { label: "Office Equipment",     type: "fixed_asset", accounts: { asset: "1-6300", accumulated: "1-6310", expense: "6-3400", loss: "7-1300", cip: "1-6600", held_for_sale: "1-5400" } },
  furniture:            { label: "Furniture",            type: "fixed_asset", accounts: { asset: "1-6300", accumulated: "1-6310", expense: "6-3400", loss: "7-1300", cip: "1-6600", held_for_sale: "1-5400" } },
  software_license:     { label: "Software Licence",     type: "intangible",  accounts: { asset: "1-7100", accumulated: "1-7110", expense: "6-3400", loss: "7-1300", cip: "1-7190", held_for_sale: null } },
  trademark:            { label: "Trademark",            type: "intangible",  accounts: { asset: "1-7100", accumulated: "1-7110", expense: "6-3900", loss: "7-1300", cip: "1-7190", held_for_sale: null } },
  goodwill:             { label: "Goodwill",             type: "intangible",  accounts: { asset: "1-7300", accumulated: null,     expense: null,     loss: "7-1300", cip: null,     held_for_sale: null } },
  insurance:            { label: "Insurance",            type: "prepaid",     accounts: { asset: "1-4200", accumulated: null,     expense: "6-2800", loss: null,     cip: null,     held_for_sale: null } },
  software_subscription:{ label: "Software Subscription", type: "prepaid",    accounts: { asset: "1-4300", accumulated: null,     expense: "6-2600", loss: null,     cip: null,     held_for_sale: null } },
  rent_advance:         { label: "Rent Advance",         type: "prepaid",     accounts: { asset: "1-4100", accumulated: null,     expense: "6-2300", loss: null,     cip: null,     held_for_sale: null } },
};

export const ASSET_ACCOUNT_ROWS = [
  ["asset",         "Asset Account"],
  ["accumulated",   "Accumulated Depreciation / Amortisation"],
  ["expense",       "Depreciation / Amortisation Expense"],
  ["loss",          "Loss on Disposal"],
  ["cip",           "Construction in Progress"],
  ["held_for_sale", "Assets Held for Sale"],
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
    acquisition_date: "2016-06-01", service_date: "2016-06-01",
    method: "straight_line", rate: null,
    duration_value: 240, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2016-06-01", period: "2016-06", event: "placed_in_service", note: "Handed over and occupied.", by: "Imported record" }],
    bills: [{ bill_id: "BILL002", line_no: 1, desc: "Head office building — purchase", date: "2016-06-01", amount: 18_000_000_000 }],
    updated: "2025-01-01",
  },
  {
    id: "AST002", asset_tag: "FA-0002", name: "CNC Machine 1",
    description: "3-axis CNC milling machine, main production floor.",
    category: "machinery", serial_no: "CNC-2023-041",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 960_000_000,
    acquisition_date: "2023-03-10", service_date: "2023-03-10",
    method: "declining_balance", rate: 0.03,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2023-03-10", period: "2023-03", event: "placed_in_service", note: "Commissioned on the production floor.", by: "Imported record" }],
    bills: [{ bill_id: "BILL020", line_no: 2, desc: "CNC milling machine", date: "2023-03-10", amount: 960_000_000 }],
    updated: "2023-03-10",
  },
  {
    id: "AST003", asset_tag: "FA-0003", name: "Delivery Van B1234XY",
    description: "Box van, main distribution route.",
    category: "vehicle", serial_no: "VIN-MHK1J1EY0K0123456",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 384_000_000,
    acquisition_date: "2022-09-01", service_date: "2022-09-01",
    // Expected to be worth something at the end of its life, so only the
    // difference is released and the van finishes carrying Rp 24,000,000.
    salvage_value: 24_000_000,
    method: "declining_balance", rate: 0.02,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    // Off the road for a gearbox rebuild. It keeps depreciating: PSAK 16 says a
    // charge does not cease while an asset is merely idle or under repair.
    lifecycle: "active", book_status: "in_service", operational_status: "under_repair",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2022-09-01", period: "2022-09", event: "placed_in_service", note: "", by: "Imported record" }],
    bills: [{ bill_id: "BILL045", line_no: 1, desc: "Delivery van, box body", date: "2022-09-01", amount: 384_000_000 }],
    updated: "2022-09-01",
  },
  {
    id: "AST004", asset_tag: "FA-0004", name: "Server Rack A",
    description: "Rack-mounted server and network infrastructure, HQ data closet.",
    category: "office_equipment", serial_no: "RACK-2024-004",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 96_000_000,
    acquisition_date: "2024-05-15", service_date: "2024-05-15",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "no_prorata",
    lifecycle: "active", book_status: "in_service", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2024-05-15", period: "2024-05", event: "placed_in_service", note: "", by: "Imported record" }],
    bills: [{ bill_id: "BILL091", line_no: 1, desc: "Server rack and switches", date: "2024-05-15", amount: 96_000_000 }],
    updated: "2024-05-15",
  },
  {
    id: "AST005", asset_tag: "FA-0005", name: "Executive Meeting Room Set",
    description: "Conference table and 12 chairs, HQ 4th floor.",
    category: "furniture", serial_no: "",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 72_000_000,
    acquisition_date: "2024-02-09", service_date: "2024-02-09",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "days_in_period",
    // Failed the last floor count. Still depreciating — missing is a fact about
    // the floor, not about the ledger, and writing it off is a decision someone
    // has to take deliberately.
    lifecycle: "active", book_status: "in_service", operational_status: "missing",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2024-02-09", period: "2024-02", event: "placed_in_service", note: "", by: "Imported record" }],
    bills: [{ bill_id: "BILL078", line_no: 1, desc: "Conference table and chairs", date: "2024-02-09", amount: 72_000_000 }],
    updated: "2024-02-09",
  },

  // ── Prepaid ──────────────────────────────────────────────────────────────
  // No operational status: a prepaid is not on a floor to be in use, idle or
  // missing. The axis is scoped to fixed assets.
  {
    id: "AST006", asset_tag: "FA-0006", name: "Annual Property Insurance",
    description: "12-month property and liability insurance policy.",
    category: "insurance", serial_no: "",
    type: "prepaid", subsidiary: "PT Induk",
    first_value: 144_000_000,
    acquisition_date: "2024-11-01", service_date: "2024-11-01",
    method: "straight_line", rate: null,
    duration_value: 12, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: null,
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2024-11-01", period: "2024-11", event: "placed_in_service", note: "Cover starts.", by: "Imported record" }],
    bills: [{ bill_id: "BILL140", line_no: 1, desc: "Property & liability insurance, 12 months", date: "2024-11-01", amount: 144_000_000 }],
    updated: "2024-11-01",
  },
  {
    id: "AST007", asset_tag: "FA-0007", name: "ERP Hosting Subscription",
    description: "24-month prepaid cloud hosting for the core ERP.",
    category: "software_subscription", serial_no: "",
    type: "prepaid", subsidiary: "PT Induk",
    first_value: 96_000_000,
    acquisition_date: "2024-07-01", service_date: "2024-07-01",
    method: "straight_line", rate: null,
    duration_value: 24, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: null,
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2024-07-01", period: "2024-07", event: "placed_in_service", note: "", by: "Imported record" }],
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
    acquisition_date: "2023-09-01", service_date: "2023-09-01",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2023-09-01", period: "2023-09", event: "placed_in_service", note: "Go-live.", by: "Imported record" }],
    bills: [{ bill_id: "BILL091", line_no: 1, desc: "ERP core financials and inventory — perpetual license", date: "2023-09-01", amount: 192_000_000 }],
    updated: "2023-09-01",
  },
  {
    id: "AST009", asset_tag: "FA-0009", name: "Product Trademark Registration",
    description: "5-year registered trademark. The product line it covers was discontinued in 2024; the registration is still being maintained.",
    category: "trademark", serial_no: "TM-2022-014",
    type: "intangible", subsidiary: "PT Induk",
    first_value: 60_000_000,
    acquisition_date: "2022-03-15", service_date: "2022-03-15",
    method: "straight_line", rate: null,
    duration_value: 5, duration_unit: "years", computation: "no_prorata",
    // Shelfware: still amortising, nothing using it. Correct accounting, and
    // exactly the thing worth seeing before the renewal comes round.
    lifecycle: "active", book_status: "in_service", operational_status: "idle",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2022-03-15", period: "2022-12", event: "placed_in_service", note: "Registration granted.", by: "Imported record" }],
    bills: [{ bill_id: "BILL061", line_no: 1, desc: "Trademark registration, 5-year term", date: "2022-03-15", amount: 60_000_000 }],
    updated: "2022-03-15",
  },

  // ── Held for sale ────────────────────────────────────────────────────────
  // The only thing that stops a charge short of disposal, and it is a BOOK
  // event, not an operational one: reclassified out of PPE, depreciation
  // stopped, duration extended by however long the hold runs.
  {
    id: "AST010", asset_tag: "FA-0010", name: "Spare Extrusion Machine",
    description: "Redundant spare unit, marketed for sale since September 2024.",
    category: "machinery", serial_no: "EXT-2021-005",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 576_000_000,
    acquisition_date: "2021-02-01", service_date: "2021-02-01",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "held_for_sale", operational_status: "awaiting_disposal",
    value_revisions: [], disposal: null,
    holds: [{ from_period: "2024-09", to_period: null, reason: "Listed for sale", note: "Broker engaged; no buyer agreed yet.", by: "Rudi Hartono" }],
    book_events: [
      { date: "2021-02-01", period: "2021-02", event: "placed_in_service", note: "", by: "Imported record" },
      { date: "2024-09-01", period: "2024-09", event: "held_for_sale", note: "Listed for sale — broker engaged.", by: "Rudi Hartono" },
    ],
    bills: [{ bill_id: "BILL030", line_no: 1, desc: "Extrusion machine, spare unit", date: "2021-02-01", amount: 576_000_000 }],
    updated: "2024-09-01",
  },

  // ── Discontinued, but still depreciating ─────────────────────────────────
  // There is no "stop the schedule and leave it on the books" state, because
  // PSAK 16 does not recognise one: an asset depreciates until it is
  // derecognised or reclassified as held for sale. So this line keeps charging
  // and carries IDLE on the operational axis. If the business wants the charge
  // to stop, the decision it has to take is a write-off, not a status change.
  {
    id: "AST011", asset_tag: "FA-0011", name: "Failed Prototype Line",
    description: "Pilot production line for a discontinued product. No buyer identified and not scrapped, so it keeps depreciating.",
    category: "machinery", serial_no: "PROTO-2022-002",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 480_000_000,
    acquisition_date: "2022-05-01", service_date: "2022-05-01",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: "idle",
    value_revisions: [], holds: [], disposal: null,
    book_events: [
      { date: "2022-05-01", period: "2022-05", event: "placed_in_service", note: "", by: "Imported record" },
    ],
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
    acquisition_date: "2018-03-01", service_date: "2018-03-01",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "disposed", operational_status: null,
    value_revisions: [], holds: [],
    disposal: { date: "2024-12-15", reason: "Sold", proceeds: 28_000_000, customer: "CV Armada Bekas Sejahtera", loss_account: "7-1300", document_ref: "INV-DISP-0041" },
    book_events: [
      { date: "2018-03-01", period: "2018-03", event: "placed_in_service", note: "", by: "Imported record" },
      { date: "2024-12-15", period: "2024-12", event: "disposed", note: "Sold to CV Armada Bekas Sejahtera.", by: "Sarah Wijaya" },
    ],
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
    acquisition_date: "2023-06-01", service_date: "2023-06-01",
    method: "straight_line", rate: null,
    duration_value: 48, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: "in_use",
    holds: [], disposal: null,
    value_revisions: [
      { effective_period: "2025-03", new_value: 42_500_000, reason: "Freight cost added after original invoice", note: "Supplier billed freight separately; capitalised as part of cost.", by: "Sarah Wijaya", at: "2025-02-20" },
    ],
    book_events: [{ date: "2023-06-01", period: "2023-06", event: "placed_in_service", note: "", by: "Imported record" }],
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
    acquisition_date: "2024-02-15", service_date: "2024-02-15",
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2024-02-15", period: "2024-02", event: "placed_in_service", note: "", by: "Imported record" }],
    bills: [
      { bill_id: "BILL099", line_no: 1, desc: "Conveyor and case sealer — base line", date: "2024-02-15", amount: 480_000_000 },
      { bill_id: "BILL121", line_no: 3, desc: "Additional sensor module — line 3 upgrade", date: "2024-08-10", amount: 18_000_000 },
      { bill_id: "BILL155", line_no: 1, desc: "Conveyor belt replacement — capital repair", date: "2025-01-22", amount: 9_500_000 },
    ],
    updated: "2024-02-15",
  },

  // ── Duration entered in years ────────────────────────────────────────────
  // 15 years is stored as entered and multiplied out to 180 monthly rows. Years
  // are an input convenience, never a cadence: every schedule charges monthly.
  {
    id: "AST015", asset_tag: "FA-0015", name: "HVAC System — HQ",
    description: "Central chiller plant and air handling, Head Office Building.",
    category: "building_services", serial_no: "HVAC-HO-2020-01",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 1_080_000_000,
    acquisition_date: "2020-08-01", service_date: "2020-08-01",
    method: "declining_balance", rate: 0.15,
    duration_value: 15, duration_unit: "years", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2020-08-01", period: "2020-12", event: "placed_in_service", note: "", by: "Imported record" }],
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
    acquisition_date: "2024-10-01", service_date: "2024-10-01",
    method: "straight_line", rate: null,
    duration_value: 18, duration_unit: "months", computation: "no_prorata",
    lifecycle: "active", book_status: "in_service", operational_status: null,
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2024-10-01", period: "2024-10", event: "placed_in_service", note: "Lease term starts.", by: "Imported record" }],
    bills: [{ bill_id: "BILL135", line_no: 1, desc: "Warehouse lease, 18 months advance", date: "2024-10-01", amount: 270_000_000 }],
    updated: "2024-10-01",
  },

  // ── Under construction ───────────────────────────────────────────────────
  // No service date, so NO SCHEDULE EXISTS. Cost accumulates in CIP. The
  // schedule tab says exactly that rather than showing a column of zeroes.
  {
    id: "AST017", asset_tag: "FA-0017", name: "Warehouse Extension — Cikarang",
    description: "1,200 sqm warehouse extension, under construction since January.",
    category: "building", serial_no: "",
    type: "fixed_asset", subsidiary: "PT Anak A",
    first_value: 2_400_000_000,
    acquisition_date: "2025-01-20", service_date: null,
    method: "straight_line", rate: null,
    duration_value: 240, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "under_construction", operational_status: null,
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2025-01-20", period: "2025-01", event: "created", note: "First progress billing capitalised to CIP.", by: "Sarah Wijaya" }],
    bills: [
      { bill_id: "BILL201", line_no: 1, desc: "Warehouse extension — progress billing 1", date: "2025-01-20", amount: 1_400_000_000 },
      { bill_id: "BILL224", line_no: 1, desc: "Warehouse extension — progress billing 2", date: "2025-03-14", amount: 1_000_000_000 },
    ],
    updated: "2025-03-14",
  },

  // ── Capitalized, not in service — and operationally IN USE ───────────────
  // The contradiction the split exists to surface: on the floor it is being
  // driven; in the books nothing is depreciating. One flag, one fix — place it
  // in service and name the date.
  {
    id: "AST018", asset_tag: "FA-0018", name: "Forklift Unit 3",
    description: "3.5-tonne electric forklift, Cikarang warehouse.",
    category: "machinery", serial_no: "FL-2025-003",
    type: "fixed_asset", subsidiary: "PT Anak A",
    first_value: 420_000_000,
    acquisition_date: "2025-03-05", service_date: null,
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "capitalized_not_in_service", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2025-03-05", period: "2025-03", event: "capitalized", note: "Delivered and paid; commissioning sign-off outstanding.", by: "Sarah Wijaya" }],
    bills: [{ bill_id: "BILL219", line_no: 1, desc: "Electric forklift, 3.5t", date: "2025-03-05", amount: 420_000_000 }],
    updated: "2025-03-05",
  },

  // ── Inactive ─────────────────────────────────────────────────────────────
  // Entered in error before anything posted. Not a disposal: there is no
  // journal to undo, because there never was one. Reversible.
  {
    id: "AST019", asset_tag: "FA-0019", name: "CNC Machine 1 (duplicate entry)",
    description: "Duplicate of FA-0002, raised twice from the same bill.",
    category: "machinery", serial_no: "CNC-2023-041",
    type: "fixed_asset", subsidiary: "PT Induk",
    first_value: 960_000_000,
    acquisition_date: "2023-03-10", service_date: null,
    method: "straight_line", rate: null,
    duration_value: 96, duration_unit: "months", computation: "constant_period",
    lifecycle: "inactive", book_status: "capitalized_not_in_service", operational_status: null,
    value_revisions: [], holds: [], disposal: null,
    inactivation: { reason: "Duplicate record", note: "Same bill line as FA-0002. Nothing had posted.", by: "Sarah Wijaya", at: "2025-02-03" },
    book_events: [{ date: "2025-02-03", period: "2025-02", event: "deactivated", note: "Duplicate of FA-0002.", by: "Sarah Wijaya" }],
    bills: [],
    updated: "2025-02-03",
  },

  // ── In development, and already in use ───────────────────────────────────
  // The intangible twin of FA-0018. Development cost is still accumulating in
  // 1-7190 and nothing is amortising, while the warehouse team has been
  // running the thing since March. Before the operational axis was scoped per
  // type this contradiction was invisible for every intangible in the
  // register — which is the whole reason it is scoped rather than dropped.
  {
    id: "AST020", asset_tag: "FA-0020", name: "Warehouse Management Module",
    description: "Internally developed WMS, built in-house. Capitalised development costs; go-live sign-off outstanding.",
    category: "software_license", serial_no: "",
    type: "intangible", subsidiary: "PT Anak A",
    first_value: 640_000_000,
    acquisition_date: "2024-11-01", service_date: null,
    method: "straight_line", rate: null,
    duration_value: 60, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "under_construction", operational_status: "in_use",
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2024-11-01", period: "2024-11", event: "created", note: "Development phase capitalisation begins.", by: "Sarah Wijaya" }],
    bills: [
      { bill_id: "BILL190", line_no: 1, desc: "WMS build — contractor, phase 1", date: "2024-11-01", amount: 380_000_000 },
      { bill_id: "BILL232", line_no: 1, desc: "WMS build — contractor, phase 2", date: "2025-02-18", amount: 260_000_000 },
    ],
    updated: "2025-02-18",
  },

  // ── Indefinite life — no method, no schedule ─────────────────────────────
  // Goodwill from an acquisition. There is no useful life to spread the cost
  // over, so it is not amortised at all: it carries at cost until an impairment
  // test moves it, and this module does not yet perform one (§10).
  {
    id: "AST021", asset_tag: "FA-0021", name: "Goodwill — CV Mitra Logistik acquisition",
    description: "Goodwill arising on the 2023 acquisition of CV Mitra Logistik.",
    category: "goodwill", serial_no: "",
    type: "intangible", subsidiary: "PT Induk",
    first_value: 500_000_000, salvage_value: 0,
    acquisition_date: "2023-07-01", service_date: "2023-07-01",
    method: "none", rate: null,
    duration_value: null, duration_unit: "months", computation: "constant_period",
    lifecycle: "active", book_status: "in_service", operational_status: null,
    value_revisions: [], holds: [], disposal: null,
    book_events: [{ date: "2023-07-01", period: "2023-07", event: "placed_in_service", note: "Recognised on acquisition.", by: "Imported record" }],
    bills: [],
    updated: "2023-07-01",
  },
];

export function assetById(id) {
  return ASSETS.find((a) => a.id === id) || null;
}
