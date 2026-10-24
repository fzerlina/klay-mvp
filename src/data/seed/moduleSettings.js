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
  { key: "inventory", label: "Inventory", description: "Goods for resale or production", defaultAccount: "1-1300" },
  { key: "expense", label: "Expense", description: "Operating costs: rent, utilities, supplies", defaultAccount: null },
  { key: "service", label: "Service", description: "Professional and outsourced services", defaultAccount: "6-2700" },
];

export const PAYMENT_METHOD_SETTINGS = PAYMENT_METHODS.map((m) => ({ ...m, active: true }));

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

// Locations, as a tree: a top-level place (city, area, project) and the spots
// inside it, each node holding its own `children`. Two levels today
// (LOCATION_LEVELS, components/LocationCards.jsx); deeper levels need no new
// shape. The levels are Location (the broader place) and Sub-location (a
// specific spot within it, was "Warehouse"). That replaces the Site / Location
// naming promised to GKB on 15 Oct 2026, by decision on 21 Oct 2026.
// Sub-location names match the stock seed.
export const LOCATIONS = [
  { id: "L01", name: "Jakarta", address: "Jl. Jend. Sudirman, Jakarta Selatan", children: [
    { id: "L01-1", name: "Benhil", children: [] },
    { id: "L01-2", name: "Jakarta Warehouse", children: [] },
    { id: "L01-3", name: "Head Office", children: [] },
  ] },
  { id: "L02", name: "Surabaya", address: "Rungkut Industri, Surabaya", children: [
    { id: "L02-1", name: "Surabaya Warehouse", children: [] },
  ] },
  { id: "L03", name: "Bandung", address: "Soekarno-Hatta, Bandung", children: [
    { id: "L03-1", name: "Bandung Warehouse", children: [] },
  ] },
];

// ── Reconciliation ──────────────────────────────────────────────────────
// Largest gap To match treats as a bank fee rather than a mismatch.
export const FEE_TOLERANCE = { default: DEFAULT_FEE_CEILING, byBank: { ...FEE_CEILING_BY_BANK } };
