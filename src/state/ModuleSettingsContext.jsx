import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  PAYMENT_TERMS, DEFAULT_TERM, VENDOR_CATEGORIES, PAYMENT_METHOD_SETTINGS, INVOICE_SETTINGS,
  UNITS, SITES, ASSET_CATEGORY_DEFAULTS, FEE_TOLERANCE,
} from "../data/seed/moduleSettings";
import { ITEM_CAT_LABELS, ITEM_CATEGORY_ACCOUNTS, UNIT_DEFAULTS, PRIMARY_UNITS, ITEM_UOM_LABELS } from "../data/seed/items";
import { ASSET_CATEGORIES } from "../data/seed/fixedAssets";

// Module settings (Settings → Payables, Receivables, Inventory, Fixed Assets,
// Reconciliation), shared so the forms that use them — vendor and customer
// terms, item and asset categories — read the same lists the settings pages
// edit.
//
// Item and asset categories write through to the registries in items.js and
// fixedAssets.js (ITEM_CAT_LABELS, ITEM_CATEGORY_ACCOUNTS, ASSET_CATEGORIES),
// which every screen already reads at call time, so a new or changed category
// resolves its GL accounts everywhere at once. `rev` bumps on each such write.

const ModuleSettingsContext = createContext(null);

const itemCategoriesNow = () => Object.entries(ITEM_CAT_LABELS).map(([key, label]) => ({
  key, label, accounts: { ...(ITEM_CATEGORY_ACCOUNTS[key] || {}) },
}));
const assetCategoriesNow = (defaults) => Object.entries(ASSET_CATEGORIES).map(([key, c]) => ({
  key, label: c.label, type: c.type, accounts: { ...c.accounts }, ...(defaults[key] || { method: "straight_line", lifeMonths: null, taxGroup: null }),
}));

export const slugKey = (label) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "item";

// Replace the row whose `keyField` matches `orig` (or the row's own key), or
// append it when it's new.
const upsert = (list, row, keyField, orig) => {
  const k = orig ?? row[keyField];
  return list.some((x) => x[keyField] === k) ? list.map((x) => (x[keyField] === k ? row : x)) : [...list, row];
};

export function ModuleSettingsProvider({ children }) {
  const [paymentTerms, setPaymentTerms] = useState(PAYMENT_TERMS);
  const [defaultTerm, setDefaultTerm] = useState(DEFAULT_TERM);
  const [vendorCategories, setVendorCategories] = useState(VENDOR_CATEGORIES);
  const [paymentMethods, setPaymentMethods] = useState(PAYMENT_METHOD_SETTINGS);
  const [invoiceSettings, setInvoiceSettings] = useState(INVOICE_SETTINGS);
  const [units, setUnits] = useState(UNITS);
  const [sites, setSites] = useState(SITES);
  const [assetDefaults, setAssetDefaults] = useState(ASSET_CATEGORY_DEFAULTS);
  const [feeTolerance, setFeeTolerance] = useState(FEE_TOLERANCE);
  const [rev, setRev] = useState(0);
  const bump = () => setRev((n) => n + 1);

  const saveTerm = useCallback((row, orig) => setPaymentTerms((l) => upsert(l, row, "code", orig)), []);
  const removeTerm = useCallback((code) => setPaymentTerms((l) => l.filter((t) => t.code !== code)), []);
  const saveVendorCategory = useCallback((row, orig) => setVendorCategories((l) => upsert(l, row, "key", orig)), []);
  const removeVendorCategory = useCallback((key) => setVendorCategories((l) => l.filter((c) => c.key !== key)), []);
  const savePaymentMethod = useCallback((row, orig) => setPaymentMethods((l) => upsert(l, row, "key", orig)), []);
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
  const saveSite = useCallback((row, orig) => setSites((l) => upsert(l, row, "id", orig)), []);
  const removeSite = useCallback((id) => setSites((l) => l.filter((s) => s.id !== id)), []);

  // Write-through to the item registry.
  const saveItemCategory = useCallback((row) => {
    ITEM_CAT_LABELS[row.key] = row.label;
    ITEM_CATEGORY_ACCOUNTS[row.key] = { ...row.accounts };
    bump();
  }, []);
  const removeItemCategory = useCallback((key) => {
    delete ITEM_CAT_LABELS[key];
    delete ITEM_CATEGORY_ACCOUNTS[key];
    bump();
  }, []);

  // Write-through to the asset registry; defaults live here.
  const saveAssetCategory = useCallback((row) => {
    ASSET_CATEGORIES[row.key] = { label: row.label, type: row.type, accounts: { ...row.accounts } };
    setAssetDefaults((d) => ({ ...d, [row.key]: { method: row.method, lifeMonths: row.lifeMonths, taxGroup: row.taxGroup } }));
    bump();
  }, []);
  const removeAssetCategory = useCallback((key) => {
    delete ASSET_CATEGORIES[key];
    setAssetDefaults((d) => { const { [key]: _, ...rest } = d; return rest; });
    bump();
  }, []);

  const value = useMemo(() => ({
    rev,
    paymentTerms, defaultTerm, setDefaultTerm, saveTerm, removeTerm,
    vendorCategories, saveVendorCategory, removeVendorCategory,
    paymentMethods, savePaymentMethod,
    invoiceSettings, setInvoiceSettings,
    itemCategories: itemCategoriesNow(), saveItemCategory, removeItemCategory,
    units, saveUnit, removeUnit,
    sites, saveSite, removeSite,
    assetCategories: assetCategoriesNow(assetDefaults), assetDefaults, saveAssetCategory, removeAssetCategory,
    feeTolerance, setFeeTolerance,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rev, paymentTerms, defaultTerm, vendorCategories, paymentMethods, invoiceSettings, units, sites, assetDefaults, feeTolerance]);

  return <ModuleSettingsContext.Provider value={value}>{children}</ModuleSettingsContext.Provider>;
}

export function useModuleSettings() {
  const ctx = useContext(ModuleSettingsContext);
  if (!ctx) throw new Error("useModuleSettings must be used within ModuleSettingsProvider");
  return ctx;
}
