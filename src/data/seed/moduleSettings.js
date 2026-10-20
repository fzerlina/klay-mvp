// Module settings — Settings → Payables / Receivables / Inventory / Fixed
// Assets / Reconciliation. The lists each module used to hard-code, gathered
// here as the starting state for ModuleSettingsContext.
//
// Item and asset categories are NOT copied: ITEM_CAT_LABELS /
// ITEM_CATEGORY_ACCOUNTS (items.js) and ASSET_CATEGORIES (fixedAssets.js) stay
// the live registries every screen reads, and the settings pages write into
// them, as the Roles registry works. What's added here is what those registries
// never had: each asset category's default method, life and tax group.
import { UNIT_DEFAULTS, PRIMARY_UNITS, ITEM_UOM_LABELS } from "./items";
import { PAYMENT_METHODS } from "../../lib/paymentBreakdown";
import { DEFAULT_FEE_CEILING, FEE_CEILING_BY_BANK } from "./bankFees";

// ── Payables & Receivables ──────────────────────────────────────────────
// One list, used by both vendors and customers. Codes match what vendor and
// customer records already store ("NET 30").
export const PAYMENT_TERMS = [
  { code: "COD", days: 0, description: "Cash on delivery — paid when the goods arrive", vendors: false, customers: true },
  { code: "NET 7", days: 7, description: "Due 7 days after the invoice date", vendors: true, customers: true },
  { code: "NET 14", days: 14, description: "Due 14 days after the invoice date", vendors: true, customers: true },
  { code: "NET 15", days: 15, description: "Due 15 days after the invoice date", vendors: true, customers: true },
  { code: "NET 21", days: 21, description: "Due 21 days after the invoice date", vendors: false, customers: true },
  { code: "NET 30", days: 30, description: "Due 30 days after the invoice date", vendors: true, customers: true },
  { code: "NET 45", days: 45, description: "Due 45 days after the invoice date", vendors: true, customers: true },
  { code: "NET 60", days: 60, description: "Due 60 days after the invoice date", vendors: true, customers: true },
];
export const DEFAULT_TERM = "NET 30";

// Vendor categories (the vendor form's Category). The default account pre-fills
// a new vendor's default expense account.
export const VENDOR_CATEGORIES = [
  { key: "inventory", label: "Inventory", description: "Goods for resale or production", defaultAccount: "1-3100" },
  { key: "expense", label: "Expense", description: "Operating costs: rent, utilities, supplies", defaultAccount: null },
  { key: "service", label: "Service", description: "Professional and outsourced services", defaultAccount: "6-2700" },
];

export const PAYMENT_METHOD_SETTINGS = PAYMENT_METHODS.map((m) => ({ ...m, active: true }));

// Invoice numbering and defaults (invoice creation ships Dec 2026).
export const INVOICE_SETTINGS = {
  numberFormat: "INV-{YYYY}-{####}",
  nextNumber: 1,
  defaultTerm: DEFAULT_TERM,
  footerNote: "Please transfer to the account above and quote the invoice number.",
};

// ── Inventory ───────────────────────────────────────────────────────────
// Units an item may be stocked in, with their default conversion.
export const UNITS = PRIMARY_UNITS.map((u) => ({
  code: u,
  label: ITEM_UOM_LABELS[u] || u,
  kind: UNIT_DEFAULTS[u].unit_kind,
  secondary: UNIT_DEFAULTS[u].secondary_unit,
  ratio: UNIT_DEFAULTS[u].conversion_ratio,
  precision: UNIT_DEFAULTS[u].precision,
}));

// Sites and locations, with the naming promised to GKB (15 Oct 2026):
// Site = the broader place (city, area, project); Location = a specific spot
// within it (was "Warehouse"). Location names match the stock seed.
export const SITES = [
  { id: "S01", name: "Jakarta — Head Office", address: "Jl. Jend. Sudirman, Jakarta Selatan", locations: ["Jakarta Warehouse", "Head Office"] },
  { id: "S02", name: "Surabaya", address: "Rungkut Industri, Surabaya", locations: ["Surabaya Warehouse"] },
  { id: "S03", name: "Bandung", address: "Soekarno-Hatta, Bandung", locations: ["Bandung Warehouse"] },
];

// ── Fixed assets ────────────────────────────────────────────────────────
// Defaults a new asset of each category starts from. Useful lives follow the
// Indonesian tax asset groups (Kelompok 1–4, permanent / non-permanent
// buildings), since GKB depreciates on the tax basis; a company can change
// them. Prepaid categories release over their contract term.
export const ASSET_CATEGORY_DEFAULTS = {
  building:              { method: "straight_line", lifeMonths: 240, taxGroup: "Bangunan permanen" },
  building_services:     { method: "straight_line", lifeMonths: 120, taxGroup: "Bangunan tidak permanen" },
  machinery:             { method: "straight_line", lifeMonths: 96,  taxGroup: "Kelompok 2" },
  vehicle:               { method: "straight_line", lifeMonths: 96,  taxGroup: "Kelompok 2" },
  office_equipment:      { method: "straight_line", lifeMonths: 48,  taxGroup: "Kelompok 1" },
  furniture:             { method: "straight_line", lifeMonths: 48,  taxGroup: "Kelompok 1" },
  software_license:      { method: "straight_line", lifeMonths: 48,  taxGroup: "Kelompok 1" },
  trademark:             { method: "straight_line", lifeMonths: 120, taxGroup: null },
  goodwill:              { method: "none",          lifeMonths: null, taxGroup: null },
  insurance:             { method: "straight_line", lifeMonths: 12,  taxGroup: null },
  software_subscription: { method: "straight_line", lifeMonths: 12,  taxGroup: null },
  rent_advance:          { method: "straight_line", lifeMonths: 12,  taxGroup: null },
};
export const TAX_GROUPS = ["Kelompok 1", "Kelompok 2", "Kelompok 3", "Kelompok 4", "Bangunan permanen", "Bangunan tidak permanen"];

// ── Reconciliation ──────────────────────────────────────────────────────
// Largest gap To match treats as a bank fee rather than a mismatch.
export const FEE_TOLERANCE = { default: DEFAULT_FEE_CEILING, byBank: { ...FEE_CEILING_BY_BANK } };
