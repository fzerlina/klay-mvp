// Inventory master records — the stock items an SME holds on hand.
// Hand-seeded for the Inventory List MVP (no generator yet). `value` is the
// on-hand valuation: qty × unit_cost (kept denormalized so the list can sort by
// it without recomputing). `updated` is the last-updated date (the default sort
// key). `tax_code` is the item's default VAT treatment — the mapping that
// pre-fills the tax on a Create New Bill line (values match DEFTAX_LABELS in
// labels.js). Categories and units of measure are inventory-local enums — see
// INV_CAT_LABELS / INV_UOM_LABELS below.
export const INVENTORY = [
  {id:"INV001",sku:"RAW-0001",name:"Steel Sheet 1.2mm",category:"raw_material",qty:340,uom:"kg",unit_cost:18500,value:6290000,tax_code:"ppn_masukan",updated:"2025-04-18"},
  {id:"INV002",sku:"RAW-0002",name:"Epoxy Resin Grade A",category:"raw_material",qty:85,uom:"liter",unit_cost:96000,value:8160000,tax_code:"ppn_masukan",updated:"2025-03-30"},
  {id:"INV003",sku:"RAW-0003",name:"Cotton Yarn 30s",category:"raw_material",qty:1200,uom:"kg",unit_cost:42000,value:50400000,tax_code:"ppn_masukan",updated:"2025-04-21"},
  {id:"INV004",sku:"RAW-0004",name:"High-Protein Wheat Flour",category:"raw_material",qty:60,uom:"box",unit_cost:135000,value:8100000,tax_code:"bebas",updated:"2025-02-15"},
  {id:"INV005",sku:"FIN-0001",name:"Ergonomic Office Chair",category:"finished_goods",qty:48,uom:"pcs",unit_cost:720000,value:34560000,tax_code:"ppn_masukan",updated:"2025-04-10"},
  {id:"INV006",sku:"FIN-0002",name:"Multifunction Folding Table",category:"finished_goods",qty:120,uom:"pcs",unit_cost:385000,value:46200000,tax_code:"ppn_masukan",updated:"2025-04-22"},
  {id:"INV007",sku:"FIN-0003",name:"5-Tier Steel Rack",category:"finished_goods",qty:15,uom:"pcs",unit_cost:540000,value:8100000,tax_code:"ppn_masukan",updated:"2025-01-28"},
  {id:"INV008",sku:"FIN-0004",name:"Snack Pack 250g",category:"finished_goods",qty:2400,uom:"pcs",unit_cost:8500,value:20400000,tax_code:"ppn_masukan",updated:"2025-04-19"},
  {id:"INV009",sku:"SUP-0001",name:"A4 Paper 80gsm",category:"supplies",qty:180,uom:"ream",unit_cost:48000,value:8640000,tax_code:"ppn_masukan",updated:"2025-04-05"},
  {id:"INV010",sku:"SUP-0002",name:"Original Printer Ink",category:"supplies",qty:64,uom:"pcs",unit_cost:210000,value:13440000,tax_code:"ppn_masukan",updated:"2025-03-12"},
  {id:"INV011",sku:"SUP-0003",name:"Nitrile Gloves",category:"supplies",qty:0,uom:"box",unit_cost:85000,value:0,tax_code:"ppn_masukan",updated:"2025-04-15"},
  {id:"INV012",sku:"SUP-0004",name:"Industrial Cleaning Fluid",category:"supplies",qty:36,uom:"liter",unit_cost:38000,value:1368000,tax_code:"ppn_masukan",updated:"2025-04-01"},
  {id:"INV013",sku:"PKG-0001",name:"Medium Cardboard Box",category:"packaging",qty:3200,uom:"pcs",unit_cost:3200,value:10240000,tax_code:"ppn_masukan",updated:"2025-04-20"},
  {id:"INV014",sku:"PKG-0002",name:"Pallet Stretch Wrap",category:"packaging",qty:140,uom:"ream",unit_cost:62000,value:8680000,tax_code:"ppn_masukan",updated:"2025-03-25"},
  {id:"INV015",sku:"PKG-0003",name:"Thermal Barcode Label",category:"packaging",qty:52,uom:"box",unit_cost:145000,value:7540000,tax_code:"ppn_masukan",updated:"2025-04-08"},
  {id:"INV016",sku:"PKG-0004",name:"Clear Packing Tape 2 inch",category:"packaging",qty:8,uom:"box",unit_cost:96000,value:768000,tax_code:"ppn_masukan",updated:"2025-02-28"},
];

// Display labels for the inventory category badge.
export const INV_CAT_LABELS = {
  raw_material:   "Raw Material",
  finished_goods: "Finished Goods",
  supplies:       "Supplies",
  packaging:      "Packaging",
};

// Unit-of-measure labels (shown beside the quantity on hand).
export const INV_UOM_LABELS = {
  pcs:   "pcs",
  kg:    "kg",
  box:   "box",
  ream:  "ream",
  liter: "liter",
};
