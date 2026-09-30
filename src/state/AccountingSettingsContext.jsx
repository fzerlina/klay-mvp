import { createContext, useContext, useMemo, useState } from "react";
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
  const value = useMemo(
    () => ({ inventoryCostingMethod, setInventoryCostingMethod, reconDifferenceAccounts, setReconDifferenceAccounts }),
    [inventoryCostingMethod, reconDifferenceAccounts],
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
