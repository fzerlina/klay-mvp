// Inventory master records — the stock items an SME holds on hand.
// Hand-seeded for the Inventory List MVP (no generator yet). `value` is the
// on-hand valuation: qty × unit_cost (kept denormalized so the list can sort by
// it without recomputing). `updated` is the last-updated date (the default sort
// key). `tax_code` is the item's default VAT treatment — the mapping that
// pre-fills the tax on a Create New Bill line (values match DEFTAX_LABELS in
// labels.js). Categories and units of measure are inventory-local enums — see
// INV_CAT_LABELS / INV_UOM_LABELS below.
//
// Two fields carry the combined product-master + inventory view (2026 MVP —
// see the team Slack thread):
//   • `status`    — LEGACY single status, kept as the seed input only. It is
//                   mapped onto the two independent axes (lifecycle + approval)
//                   by axesFromLegacy() in seed/itemGovernance.js; nothing reads
//                   `status` at runtime. New records set lifecycle/approval.
//   • `locations` — where the stock physically sits. A product's stock can be
//                   spread across warehouses; `qty` is the roll-up of all
//                   location quantities. Single-location items still carry one
//                   entry so the row model is uniform. In the list these
//                   collapse to one row that expands to the per-location split.
//
// The "service" category is non-stock: a service has a cost/unit (its rate) but
// no on-hand quantity, location, or stock value. Its qty/value/locations are
// left null so the list renders "—" and the stock/location filters skip it —
// this keeps services out of the "No Stock" bucket (they were never stocked).
export const INVENTORY = [
  {id:"INV001",sku:"RAW-0001",name:"Steel Sheet 1.2mm",category:"raw_material",qty:340,uom:"kg",unit_cost:18500,value:6290000,tax_code:"ppn_masukan",status:"active",updated:"2025-04-18",locations:[{loc:"Jakarta Warehouse",qty:200},{loc:"Surabaya Warehouse",qty:140}]},
  {id:"INV002",sku:"RAW-0002",name:"Epoxy Resin Grade A",category:"raw_material",qty:85,uom:"liter",unit_cost:96000,value:8160000,tax_code:"ppn_masukan",status:"active",updated:"2025-03-30",locations:[{loc:"Jakarta Warehouse",qty:85}]},
  {id:"INV003",sku:"RAW-0003",name:"Cotton Yarn 30s",category:"raw_material",qty:1200,uom:"kg",unit_cost:42000,value:50400000,tax_code:"ppn_masukan",status:"active",updated:"2025-04-21",locations:[{loc:"Jakarta Warehouse",qty:700},{loc:"Surabaya Warehouse",qty:500}]},
  {id:"INV004",sku:"RAW-0004",name:"High-Protein Wheat Flour",category:"raw_material",qty:60,uom:"box",unit_cost:135000,value:8100000,tax_code:"bebas",status:"inactive",updated:"2025-02-15",locations:[{loc:"Jakarta Warehouse",qty:60}]},
  {id:"INV005",sku:"FIN-0001",name:"Ergonomic Office Chair",category:"finished_goods",qty:48,uom:"pcs",unit_cost:720000,value:34560000,tax_code:"ppn_masukan",status:"active",updated:"2025-04-10",locations:[{loc:"Jakarta Warehouse",qty:48}]},
  {id:"INV006",sku:"FIN-0002",name:"Multifunction Folding Table",category:"finished_goods",qty:120,uom:"pcs",unit_cost:385000,value:46200000,tax_code:"ppn_masukan",status:"active",updated:"2025-04-22",locations:[{loc:"Jakarta Warehouse",qty:50},{loc:"Surabaya Warehouse",qty:40},{loc:"Bandung Warehouse",qty:30}]},
  {id:"INV007",sku:"FIN-0003",name:"5-Tier Steel Rack",category:"finished_goods",qty:15,uom:"pcs",unit_cost:540000,value:8100000,tax_code:"ppn_masukan",status:"active",updated:"2025-01-28",locations:[{loc:"Jakarta Warehouse",qty:15}]},
  {id:"INV008",sku:"FIN-0004",name:"Snack Pack 250g",category:"finished_goods",qty:2400,uom:"pcs",unit_cost:8500,value:20400000,tax_code:"ppn_masukan",status:"active",updated:"2025-04-19",locations:[{loc:"Jakarta Warehouse",qty:1500},{loc:"Surabaya Warehouse",qty:900}]},
  {id:"INV009",sku:"SUP-0001",name:"A4 Paper 80gsm",category:"supplies",qty:180,uom:"ream",unit_cost:48000,value:8640000,tax_code:"ppn_masukan",status:"draft",updated:"2025-04-05",locations:[{loc:"Jakarta Warehouse",qty:180}]},
  {id:"INV010",sku:"SUP-0002",name:"Original Printer Ink",category:"supplies",qty:64,uom:"pcs",unit_cost:210000,value:13440000,tax_code:"ppn_masukan",status:"active",updated:"2025-03-12",locations:[{loc:"Jakarta Warehouse",qty:64}]},
  {id:"INV011",sku:"SUP-0003",name:"Nitrile Gloves",category:"supplies",qty:0,uom:"box",unit_cost:85000,value:0,tax_code:"ppn_masukan",status:"active",updated:"2025-04-15",locations:[{loc:"Jakarta Warehouse",qty:0}]},
  {id:"INV012",sku:"SUP-0004",name:"Industrial Cleaning Fluid",category:"supplies",qty:36,uom:"liter",unit_cost:38000,value:1368000,tax_code:"ppn_masukan",status:"pending_review",updated:"2025-04-01",locations:[{loc:"Jakarta Warehouse",qty:36}]},
  {id:"INV013",sku:"PKG-0001",name:"Medium Cardboard Box",category:"packaging",qty:3200,uom:"pcs",unit_cost:3200,value:10240000,tax_code:"ppn_masukan",status:"draft",updated:"2025-04-20",locations:[{loc:"Jakarta Warehouse",qty:2000},{loc:"Surabaya Warehouse",qty:1200}]},
  {id:"INV014",sku:"PKG-0002",name:"Pallet Stretch Wrap",category:"packaging",qty:140,uom:"ream",unit_cost:62000,value:8680000,tax_code:"ppn_masukan",status:"active",updated:"2025-03-25",locations:[{loc:"Jakarta Warehouse",qty:140}]},
  {id:"INV015",sku:"PKG-0003",name:"Thermal Barcode Label",category:"packaging",qty:52,uom:"box",unit_cost:145000,value:7540000,tax_code:"ppn_masukan",status:"pending_review",updated:"2025-04-08",locations:[{loc:"Jakarta Warehouse",qty:52}]},
  {id:"INV016",sku:"PKG-0004",name:"Clear Packing Tape 2 inch",category:"packaging",qty:8,uom:"box",unit_cost:96000,value:768000,tax_code:"ppn_masukan",status:"inactive",updated:"2025-02-28",locations:[{loc:"Jakarta Warehouse",qty:8}]},
  {id:"INV017",sku:"SVC-0001",name:"Equipment Maintenance Visit",category:"service",qty:null,uom:null,unit_cost:1500000,value:null,tax_code:"ppn_masukan",status:"active",updated:"2025-04-16",locations:[]},
  {id:"INV018",sku:"SVC-0002",name:"Annual Software Support",category:"service",qty:null,uom:null,unit_cost:4200000,value:null,tax_code:"ppn_masukan",status:"active",updated:"2025-03-18",locations:[]},
  {id:"INV019",sku:"SVC-0003",name:"Machine Installation Service",category:"service",qty:null,uom:null,unit_cost:2750000,value:null,tax_code:"ppn_masukan",status:"inactive",updated:"2025-02-05",locations:[]},
];

// Status lives on two axes now — lifecycle and approval. Labels, ordering and
// the legacy mapping are in seed/itemGovernance.js.

// Display labels for the inventory category badge.
export const INV_CAT_LABELS = {
  raw_material:   "Raw Material",
  finished_goods: "Finished Goods",
  supplies:       "Supplies",
  packaging:      "Packaging",
  service:        "Service",
};

// Unit-of-measure labels (shown beside the quantity on hand). The lower block
// are secondary/base units a primary unit converts down to (1 box = 24 pcs).
export const INV_UOM_LABELS = {
  pcs:   "pcs",
  kg:    "kg",
  box:   "box",
  ream:  "ream",
  liter: "liter",
  sheet: "sheet",
  g:     "g",
  ml:    "ml",
};

// Default secondary unit + conversion ratio per primary unit — "1 <primary> =
// <ratio> <secondary>". Drives the Unit of Measurement block on Product Detail.
// A primary with no entry (e.g. pcs) has no secondary unit.
export const INV_UOM_SECONDARY = {
  box:   { unit: "pcs",   ratio: 24 },
  ream:  { unit: "sheet", ratio: 500 },
  kg:    { unit: "g",     ratio: 1000 },
  liter: { unit: "ml",    ratio: 1000 },
};

// Costing method labels (Product Detail → Cost).
export const INV_COSTING_LABELS = {
  weighted_average: "Weighted Average",
  fifo:             "FIFO",
  standard:         "Standard Cost",
};

// GL account mapping per product category. These are configured once in Product
// Category Settings and shown read-only on Product Detail → Accounts. Values are
// Chart-of-Accounts codes (see data/seed/coa.js); the detail page resolves each
// code to its account name. `null` means the account does not apply to the
// category (e.g. a Service has no inventory or goods-in-transit account).
export const INV_CATEGORY_ACCOUNTS = {
  raw_material:   { inventory: "1-3100", sales: "4-1200", sales_return: "4-3100", sales_discount: "4-3200", goods_in_transit: "1-5200", cogs: "5-1100", purchase_return: "5-1500", grni: "2-1200" },
  finished_goods: { inventory: "1-3300", sales: "4-1100", sales_return: "4-3100", sales_discount: "4-3200", goods_in_transit: "1-5200", cogs: "5-1100", purchase_return: "5-1500", grni: "2-1200" },
  supplies:       { inventory: "1-3100", sales: "4-2300", sales_return: "4-3100", sales_discount: "4-3200", goods_in_transit: "1-5200", cogs: "5-1100", purchase_return: "5-1500", grni: "2-1200" },
  packaging:      { inventory: "1-3100", sales: "4-1300", sales_return: "4-3100", sales_discount: "4-3200", goods_in_transit: "1-5200", cogs: "5-1900", purchase_return: "5-1500", grni: "2-1200" },
  service:        { inventory: null,     sales: "4-1500", sales_return: "4-3100", sales_discount: "4-3200", goods_in_transit: null,     cogs: "5-1700", purchase_return: null,     grni: null     },
};

// Ordered rows for the Accounts section: [key, label]. Order matches the PRD.
export const INV_ACCOUNT_ROWS = [
  ["inventory",        "Inventory"],
  ["sales",            "Sales"],
  ["sales_return",     "Sales Return"],
  ["sales_discount",   "Sales Discount"],
  ["goods_in_transit", "Goods In Transit"],
  ["cogs",             "COGS Account"],
  ["purchase_return",  "Purchase Return"],
  ["grni",             "Goods Received Not Invoiced"],
];
