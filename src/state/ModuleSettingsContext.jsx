import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  PAYMENT_TERMS, DEFAULT_TERM, VENDOR_CATEGORIES, PAYMENT_METHOD_SETTINGS,
  UNITS, LOCATIONS, FEE_TOLERANCE,
} from "../data/seed/moduleSettings";
import { ITEM_CAT_LABELS, ITEM_CATEGORY_ACCOUNTS, ITEM_CATEGORY_TAXES, UNIT_DEFAULTS, PRIMARY_UNITS, ITEM_UOM_LABELS } from "../data/seed/items";
import { ASSET_CATEGORIES } from "../data/seed/fixedAssets";

// Module settings (Settings → Items, Fixed Assets, Reconciliation), shared so
// the forms that use them — item and asset categories — read the same lists
// the settings pages edit. Vendor and customer lists (payment terms, vendor
// categories, payment methods) are read here too, with no settings page.
//
// Item and asset categories write through to the registries in items.js and
// fixedAssets.js (ITEM_CAT_LABELS, ITEM_CATEGORY_ACCOUNTS, ITEM_CATEGORY_TAXES,
// ASSET_CATEGORIES),
// which every screen already reads at call time, so a new or changed category
// resolves its GL accounts everywhere at once. `rev` bumps on each such write.

const ModuleSettingsContext = createContext(null);

const itemCategoriesNow = () => Object.entries(ITEM_CAT_LABELS).map(([key, label]) => ({
  key, label, accounts: { ...(ITEM_CATEGORY_ACCOUNTS[key] || {}) }, taxes: { ...(ITEM_CATEGORY_TAXES[key] || {}) },
}));
const assetCategoriesNow = () => Object.entries(ASSET_CATEGORIES).map(([key, c]) => ({
  key, label: c.label, type: c.type, accounts: { ...c.accounts },
}));

export const slugKey = (label) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "item";

// Replace the row whose `keyField` matches `orig` (or the row's own key), or
// append it when it's new.
const upsert = (list, row, keyField, orig) => {
  const k = orig ?? row[keyField];
  return list.some((x) => x[keyField] === k) ? list.map((x) => (x[keyField] === k ? row : x)) : [...list, row];
};

const hasNode = (tree, id) => tree.some((n) => n.id === id || hasNode(n.children || [], id));
function saveNode(tree, node, parentId) {
  if (hasNode(tree, node.id)) {
    return tree.map((n) => (n.id === node.id ? { ...n, ...node }
      : hasNode(n.children || [], node.id) ? { ...n, children: saveNode(n.children, node, parentId) } : n));
  }
  if (!parentId) return [...tree, { children: [], ...node }];
  return tree.map((n) => (n.id === parentId
    ? { ...n, children: [...(n.children || []), { children: [], ...node }] }
    : { ...n, children: saveNode(n.children || [], node, parentId) }));
}
const dropNode = (tree, id) => tree.filter((n) => n.id !== id).map((n) => ({ ...n, children: dropNode(n.children || [], id) }));

export function ModuleSettingsProvider({ children }) {
  // Read by the vendor and customer forms; there is no Payables or Receivables
  // settings page to edit them.
  const [paymentTerms] = useState(PAYMENT_TERMS);
  const [defaultTerm] = useState(DEFAULT_TERM);
  // Read by vendors, bills and payments; there is no Payables settings page to edit them.
  const [vendorCategories] = useState(VENDOR_CATEGORIES);
  const [paymentMethods] = useState(PAYMENT_METHOD_SETTINGS);
  const [units, setUnits] = useState(UNITS);
  const [locations, setLocations] = useState(LOCATIONS);
  const [feeTolerance, setFeeTolerance] = useState(FEE_TOLERANCE);
  const [rev, setRev] = useState(0);
  const bump = () => setRev((n) => n + 1);

  // Units write through to the item registry too, so the item forms offer them.
  const saveUnit = useCallback((row, orig) => {
    UNIT_DEFAULTS[row.code] = {
      unit_kind: row.kind, secondary_unit: row.secondary || null,
      conversion_type: row.secondary ? row.kind : null, conversion_ratio: row.secondary ? row.ratio : null,
      precision: row.precision ?? 0,
    };
    if (!PRIMARY_UNITS.includes(row.code)) PRIMARY_UNITS.push(row.code);
    ITEM_UOM_LABELS[row.code] = row.code;
    if (row.secondary && !ITEM_UOM_LABELS[row.secondary]) ITEM_UOM_LABELS[row.secondary] = row.secondary;
    setUnits((l) => upsert(l, row, "code", orig));
  }, []);
  const removeUnit = useCallback((code) => {
    const i = PRIMARY_UNITS.indexOf(code);
    if (i >= 0) PRIMARY_UNITS.splice(i, 1);
    delete UNIT_DEFAULTS[code];
    setUnits((l) => l.filter((u) => u.code !== code));
  }, []);
  // Locations are a tree: save a node under `parentId` (null for top level) —
  // replacing it in place when it exists — or remove one with its subtree.
  const saveLocation = useCallback((node, parentId = null) => setLocations((tree) => saveNode(tree, node, parentId)), []);
  const removeLocation = useCallback((id) => setLocations((tree) => dropNode(tree, id)), []);

  // Write-through to the item registry.
  const saveItemCategory = useCallback((row) => {
    ITEM_CAT_LABELS[row.key] = row.label;
    ITEM_CATEGORY_ACCOUNTS[row.key] = { ...row.accounts };
    // A new category starts on standard PPN both ways and no withholding.
    ITEM_CATEGORY_TAXES[row.key] = { purchase_vat: "ppn_masukan", sales_vat: "ppn_keluaran", withholding: null, ...(ITEM_CATEGORY_TAXES[row.key] || {}), ...(row.taxes || {}) };
    bump();
  }, []);
  const setItemCategoryTax = useCallback((key, kind, code) => {
    ITEM_CATEGORY_TAXES[key] = { ...(ITEM_CATEGORY_TAXES[key] || {}), [kind]: code || null };
    bump();
  }, []);
  const removeItemCategory = useCallback((key) => {
    delete ITEM_CAT_LABELS[key];
    delete ITEM_CATEGORY_ACCOUNTS[key];
    delete ITEM_CATEGORY_TAXES[key];
    bump();
  }, []);

  // Write-through to the asset registry.
  const saveAssetCategory = useCallback((row) => {
    ASSET_CATEGORIES[row.key] = { label: row.label, type: row.type, accounts: { ...row.accounts } };
    bump();
  }, []);
  const removeAssetCategory = useCallback((key) => {
    delete ASSET_CATEGORIES[key];
    bump();
  }, []);

  const value = useMemo(() => ({
    rev,
    paymentTerms, defaultTerm,
    vendorCategories,
    paymentMethods,
    itemCategories: itemCategoriesNow(), saveItemCategory, setItemCategoryTax, removeItemCategory,
    units, saveUnit, removeUnit,
    locations, saveLocation, removeLocation,
    assetCategories: assetCategoriesNow(), saveAssetCategory, removeAssetCategory,
    feeTolerance, setFeeTolerance,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rev, paymentTerms, defaultTerm, vendorCategories, paymentMethods, units, locations, feeTolerance]);

  return <ModuleSettingsContext.Provider value={value}>{children}</ModuleSettingsContext.Provider>;
}

export function useModuleSettings() {
  const ctx = useContext(ModuleSettingsContext);
  if (!ctx) throw new Error("useModuleSettings must be used within ModuleSettingsProvider");
  return ctx;
}
