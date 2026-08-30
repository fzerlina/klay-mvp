// Item Master — the catalogue. One row per distinct thing the business buys,
// sells, makes or provides.
//
// Every field here answers "WHAT IS THIS THING?" — its code, its name, what
// kind of thing it is, the unit it is counted in, what we sell it for, how it is
// taxed, and which accounts it books to. All of it is true regardless of what is
// happening in the warehouse today.
//
// NOTHING HERE ANSWERS "HOW MANY DO WE HAVE AND WHAT ARE THEY WORTH?" That is
// the Inventory Sub-Ledger's question, and its answer is derived from movements,
// not stored on the item. The opening figures that seed those movements live in
// seed/inventoryOpening.js — owned by the sub-ledger, deliberately not here, so
// that the module boundary is visible in the data and not only in the UI.
//
// The rule the whole module exists to enforce (Item Master PRD §0.2):
//
//   Master data may be COPIED into a transaction at entry time. It may never be
//   READ at reporting time to compute a financial figure.
//
// Copying is safe — the copy never changes. Looking up is not: a cost edited in
// April would re-value January, silently rewriting a month that was closed.
//
// Field classes:
//   ENTERED — a person types it and it is authoritative (name, category, price)
//   COPIED  — pre-fills a document, a convenience and not a controlled figure
//   DERIVED — nobody types it; it comes from elsewhere (every stock figure)
//
// `status` is the LEGACY seed input only, mapped onto the single lifecycle axis
// by lifecycleFromLegacy() in seed/itemGovernance.js. Nothing reads it at
// runtime. There is no approval axis: nothing in Item Master is approval-gated.

// ── Item Type ───────────────────────────────────────────────────────────────
// Separate from Category on purpose (PRD §0.3). Type decides whether stock is a
// concept for this row at all; Category decides which GL accounts it books to.
// Folding them together is what forces "service" to masquerade as a category and
// leaves nowhere to put a thing you buy but never hold.
export const ITEM_TYPES = {
  stocked:     { label: "Stocked",     desc: "Held in a warehouse. Carries on-hand quantity and stock value." },
  non_stocked: { label: "Non-stocked", desc: "Bought and expensed without being held. No quantity is tracked." },
  service:     { label: "Service",     desc: "Time or work, not a good. Never stocked." },
};
export const ITEM_TYPE_ORDER = ["stocked", "non_stocked", "service"];

// Only a Stocked item has stock. The other two render "—" rather than a zero,
// because they were never stocked — that is a different fact from "none left".
export const isStocked = (it) => (it?.item_type || "stocked") === "stocked";
export const isServiceItem = (it) => it?.item_type === "service";

// ── Category ────────────────────────────────────────────────────────────────
// Resolves the item's GL account set (ITEM_CATEGORY_ACCOUNTS below).
export const ITEM_CAT_LABELS = {
  raw_material:   "Raw Material",
  finished_goods: "Finished Goods",
  supplies:       "Supplies",
  packaging:      "Packaging",
  service:        "Services",
};

// ── Units of measure ────────────────────────────────────────────────────────
// Unit Kind matters because it decides whether a quantity may carry decimals.
//   Count   — whole things. 4.8 ton of rebar must resolve to a whole number of
//             batang or the entry is refused.
//   Measure — continuous. Decimals are allowed, to the declared precision.
export const ITEM_UOM_LABELS = {
  pcs: "pcs", kg: "kg", box: "box", ream: "ream", liter: "liter",
  sheet: "sheet", g: "g", ml: "ml",
};

// Default unit model per primary unit. Seeded onto each item as real fields
// (see below) so they can be edited — and locked — per item.
export const UNIT_DEFAULTS = {
  pcs:   { unit_kind: "count",   secondary_unit: null,    conversion_type: null,      conversion_ratio: null, precision: 0 },
  box:   { unit_kind: "count",   secondary_unit: "pcs",   conversion_type: "count",   conversion_ratio: 24,   precision: 0 },
  ream:  { unit_kind: "count",   secondary_unit: "sheet", conversion_type: "count",   conversion_ratio: 500,  precision: 0 },
  kg:    { unit_kind: "measure", secondary_unit: "g",     conversion_type: "measure", conversion_ratio: 1000, precision: 2 },
  liter: { unit_kind: "measure", secondary_unit: "ml",    conversion_type: "measure", conversion_ratio: 1000, precision: 2 },
};
// Units an item may be STOCKED in. Secondary units (sheet, g, ml) are what a
// primary converts down to and are never themselves a primary.
export const PRIMARY_UNITS = ["pcs", "box", "ream", "kg", "liter"];

export const UNIT_KIND_LABELS = { count: "Count", measure: "Measure" };
export const CONVERSION_TYPE_LABELS = {
  count:   "Count — a whole-number packaging relationship",
  measure: "Measure — a continuous quantity relationship",
};

// Expand a primary unit into the full six-field unit model.
const units = (primary) => (primary ? { primary_unit: primary, ...UNIT_DEFAULTS[primary] } : {
  primary_unit: null, unit_kind: null, secondary_unit: null,
  conversion_type: null, conversion_ratio: null, precision: 0,
});

// ── The catalogue ───────────────────────────────────────────────────────────
// `purchase_price` is COPIED reference data, NOT a valuation. It pre-fills a
// bill line so a buyer doesn't retype a number, and in production it refreshes
// from the last price a supplier actually invoiced. It values no stock, which is
// why the price-variance check on the bill, not this field, is what catches
// drift.
export const ITEMS = [
  { id:"ITM001", sku:"RAW-0001", name:"Steel Sheet 1.2mm",           description:"Cold-rolled sheet, 1.2mm gauge, 1220×2440.",   item_type:"stocked",     category:"raw_material",   ...units("kg"),    purchase_price:18500,   sales_price:23000,   tax_code:"ppn_masukan", status:"active",         updated:"2025-04-18" },
  { id:"ITM002", sku:"RAW-0002", name:"Epoxy Resin Grade A",         description:"Two-part structural epoxy, industrial grade.",  item_type:"stocked",     category:"raw_material",   ...units("liter"), purchase_price:96000,   sales_price:null,    tax_code:"ppn_masukan", status:"active",         updated:"2025-03-30" },
  { id:"ITM003", sku:"RAW-0003", name:"Cotton Yarn 30s",             description:"Ring-spun combed cotton, 30s count.",           item_type:"stocked",     category:"raw_material",   ...units("kg"),    purchase_price:42000,   sales_price:52500,   tax_code:"ppn_masukan", status:"active",         updated:"2025-04-21" },
  { id:"ITM004", sku:"RAW-0004", name:"High-Protein Wheat Flour",    description:"13% protein bread flour, 25kg sacks per box.",  item_type:"stocked",     category:"raw_material",   ...units("box"),   purchase_price:135000,  sales_price:null,    tax_code:"bebas",       status:"inactive",       updated:"2025-02-15" },
  { id:"ITM005", sku:"FIN-0001", name:"Ergonomic Office Chair",      description:"Mesh back, adjustable lumbar, 5-star base.",    item_type:"stocked",     category:"finished_goods", ...units("pcs"),   purchase_price:720000,  sales_price:1116000, tax_code:"ppn_masukan", status:"active",         updated:"2025-04-10" },
  { id:"ITM006", sku:"FIN-0002", name:"Multifunction Folding Table", description:"Folding leg table, powder-coated frame.",       item_type:"stocked",     category:"finished_goods", ...units("pcs"),   purchase_price:385000,  sales_price:597000,  tax_code:"ppn_masukan", status:"active",         updated:"2025-04-22" },
  { id:"ITM007", sku:"FIN-0003", name:"5-Tier Steel Rack",           description:"Boltless shelving, 150kg per tier.",            item_type:"stocked",     category:"finished_goods", ...units("pcs"),   purchase_price:540000,  sales_price:837000,  tax_code:"ppn_masukan", status:"active",         updated:"2025-01-28" },
  { id:"ITM008", sku:"FIN-0004", name:"Snack Pack 250g",             description:"Retail snack pack, 250g, 12-month shelf life.", item_type:"stocked",     category:"finished_goods", ...units("pcs"),   purchase_price:8500,    sales_price:13000,   tax_code:"ppn_masukan", status:"active",         updated:"2025-04-19" },
  { id:"ITM009", sku:"SUP-0001", name:"A4 Paper 80gsm",              description:"White multipurpose paper, 80gsm.",              item_type:"stocked",     category:"supplies",       ...units("ream"),  purchase_price:48000,   sales_price:65000,   tax_code:"ppn_masukan", status:"draft",          updated:"2025-04-05" },
  { id:"ITM010", sku:"SUP-0002", name:"Original Printer Ink",        description:"OEM cartridge, black, high yield.",             item_type:"stocked",     category:"supplies",       ...units("pcs"),   purchase_price:210000,  sales_price:283500,  tax_code:"ppn_masukan", status:"active",         updated:"2025-03-12" },
  { id:"ITM011", sku:"SUP-0003", name:"Nitrile Gloves",              description:"Powder-free nitrile, size M, 100 per box.",     item_type:"stocked",     category:"supplies",       ...units("box"),   purchase_price:85000,   sales_price:115000,  tax_code:"ppn_masukan", status:"active",         updated:"2025-04-15" },
  { id:"ITM012", sku:"SUP-0004", name:"Industrial Cleaning Fluid",   description:"Alkaline degreaser concentrate.",               item_type:"stocked",     category:"supplies",       ...units("liter"), purchase_price:38000,   sales_price:51500,   tax_code:"ppn_masukan", status:"draft"          , updated:"2025-04-01" },
  { id:"ITM013", sku:"PKG-0001", name:"Medium Cardboard Box",        description:"Double-wall carton, 400×300×300mm.",            item_type:"stocked",     category:"packaging",      ...units("pcs"),   purchase_price:3200,    sales_price:4500,    tax_code:"ppn_masukan", status:"draft",          updated:"2025-04-20" },
  { id:"ITM014", sku:"PKG-0002", name:"Pallet Stretch Wrap",         description:"LLDPE stretch film, 500mm × 300m.",             item_type:"stocked",     category:"packaging",      ...units("ream"),  purchase_price:62000,   sales_price:87000,   tax_code:"ppn_masukan", status:"active",         updated:"2025-03-25" },
  { id:"ITM015", sku:"PKG-0003", name:"Thermal Barcode Label",       description:"Direct thermal label roll, 100×50mm.",          item_type:"stocked",     category:"packaging",      ...units("box"),   purchase_price:145000,  sales_price:203000,  tax_code:"ppn_masukan", status:"draft"          , updated:"2025-04-08" },
  { id:"ITM016", sku:"PKG-0004", name:"Clear Packing Tape 2 inch",   description:"OPP tape, 48mm × 100m, clear.",                 item_type:"stocked",     category:"packaging",      ...units("box"),   purchase_price:96000,   sales_price:134500,  tax_code:"ppn_masukan", status:"inactive",       updated:"2025-02-28" },

  // Non-stocked — bought and expensed, never held. The type exists so that a
  // thing the business genuinely buys has somewhere to live without pretending
  // to be a warehouse balance. Its stock figures read "—", not "0".
  { id:"ITM017", sku:"NST-0001", name:"Printed Sales Brochure",      description:"Printed on demand per campaign; expensed on receipt.", item_type:"non_stocked", category:"supplies",  ...units("pcs"),   purchase_price:12000,   sales_price:null,    tax_code:"ppn_masukan", status:"active",         updated:"2025-04-11" },
  { id:"ITM018", sku:"NST-0002", name:"Site Safety Signage",         description:"Made to order per project site; never warehoused.",     item_type:"non_stocked", category:"supplies",  ...units("pcs"),   purchase_price:185000,  sales_price:null,    tax_code:"ppn_masukan", status:"active",         updated:"2025-03-07" },

  // Services — no unit model at all, so every unit field is null and the whole
  // Stock tab is hidden rather than emptied.
  { id:"ITM019", sku:"SVC-0001", name:"Equipment Maintenance Visit", description:"Scheduled preventive maintenance, per visit.",  item_type:"service",     category:"service",        ...units(null),    purchase_price:1500000, sales_price:2550000, tax_code:"ppn_masukan", status:"active",         updated:"2025-04-16" },
  { id:"ITM020", sku:"SVC-0002", name:"Annual Software Support",     description:"12-month support and update entitlement.",      item_type:"service",     category:"service",        ...units(null),    purchase_price:4200000, sales_price:7140000, tax_code:"ppn_masukan", status:"active",         updated:"2025-03-18" },
  { id:"ITM021", sku:"SVC-0003", name:"Machine Installation Service",description:"Commissioning and handover, per machine.",      item_type:"service",     category:"service",        ...units(null),    purchase_price:2750000, sales_price:4675000, tax_code:"ppn_masukan", status:"inactive",       updated:"2025-02-05" },
];

// ── Accounting reference (read-only in Item Master) ──────────────────────────
// The eight-account set per category, configured once in settings and shown
// read-only on the item. Values are Chart-of-Accounts codes (seed/coa.js); the
// detail page resolves each to its account name. `null` means the account does
// not apply to the category — a Service holds no inventory and none in transit.
//
// This is also why a category change is governed: it moves the item's Inventory
// GL account, and stock already posted to the old one has to be reclassified —
// a journal entry, which belongs to the Inventory Sub-Ledger, not here.
export const ITEM_CATEGORY_ACCOUNTS = {
  raw_material:   { inventory:"1-3100", sales:"4-1200", sales_return:"4-3100", sales_discount:"4-3200", goods_in_transit:"1-5200", cogs:"5-1100", purchase_return:"5-1500", grni:"2-1200" },
  finished_goods: { inventory:"1-3300", sales:"4-1100", sales_return:"4-3100", sales_discount:"4-3200", goods_in_transit:"1-5200", cogs:"5-1100", purchase_return:"5-1500", grni:"2-1200" },
  supplies:       { inventory:"1-3100", sales:"4-2300", sales_return:"4-3100", sales_discount:"4-3200", goods_in_transit:"1-5200", cogs:"5-1100", purchase_return:"5-1500", grni:"2-1200" },
  packaging:      { inventory:"1-3100", sales:"4-1300", sales_return:"4-3100", sales_discount:"4-3200", goods_in_transit:"1-5200", cogs:"5-1900", purchase_return:"5-1500", grni:"2-1200" },
  service:        { inventory:null,     sales:"4-1500", sales_return:"4-3100", sales_discount:"4-3200", goods_in_transit:null,     cogs:"5-1700", purchase_return:null,     grni:null     },
};

export const ITEM_ACCOUNT_ROWS = [
  ["inventory",        "Inventory"],
  ["sales",            "Sales"],
  ["sales_return",     "Sales Return"],
  ["sales_discount",   "Sales Discount"],
  ["goods_in_transit", "Goods In Transit"],
  ["cogs",             "COGS Account"],
  ["purchase_return",  "Purchase Return"],
  ["grni",             "Goods Received Not Invoiced"],
];
