import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ACCOUNTING_SETTINGS } from "../data/seed/accountingSettings";

// Company-wide accounting policy that pages read at runtime. Seeded from
// data/seed/accountingSettings.js; the Inventory and Bank reconciliation
// settings pages write it. Kept in its own context so a change reflects
// everywhere at once.
const AccountingSettingsContext = createContext(null);

export function AccountingSettingsProvider({ children }) {
  const [inventoryCostingMethod, setInventoryCostingMethod] = useState(
    ACCOUNTING_SETTINGS.inventory_costing_method,
  );
  // Account codes Reconcile manually may book a difference to.
  const [reconDifferenceAccounts, setReconDifferenceAccounts] = useState(
    ACCOUNTING_SETTINGS.recon_difference_accounts,
  );
  // Account codes whose journal lines are payables to settle through Payment.
  const [reconcilableAccounts, setReconcilableAccounts] = useState(
    ACCOUNTING_SETTINGS.reconcilable_accounts,
  );
  const toggleReconcilable = useCallback((code) => setReconcilableAccounts((prev) => (
    prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
  )), []);
  const value = useMemo(
    () => ({
      inventoryCostingMethod, setInventoryCostingMethod,
      reconDifferenceAccounts, setReconDifferenceAccounts,
      reconcilableAccounts, toggleReconcilable,
    }),
    [inventoryCostingMethod, reconDifferenceAccounts, reconcilableAccounts, toggleReconcilable],
  );
  return (
    <AccountingSettingsContext.Provider value={value}>
      {children}
    </AccountingSettingsContext.Provider>
  );
}

export function useAccountingSettings() {
  const ctx = useContext(AccountingSettingsContext);
  if (!ctx) throw new Error("useAccountingSettings must be used inside <AccountingSettingsProvider>");
  return ctx;
}
