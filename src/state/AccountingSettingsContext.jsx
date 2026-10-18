import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { COMPANY } from "../data/seed/company";
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
  // Account codes To match may book a difference to.
  const [reconDifferenceAccounts, setReconDifferenceAccounts] = useState(
    ACCOUNTING_SETTINGS.recon_difference_accounts,
  );
  // Account codes whose journal lines are payables to settle through Payment.
  const [reconcilableAccounts, setReconcilableAccounts] = useState(
    ACCOUNTING_SETTINGS.reconcilable_accounts,
  );
  // Entity-wide segregation of duties, shown on Settings → Users → Roles.
  // Set by Klay at company setup — the app only reads it. ENFORCED:
  // whoever prepared a transaction cannot post it, and hard conflicts can't be
  // granted. RELAXED: they can, with an accepted risk / an audit flag.
  const [sodMode, setSodMode] = useState(COMPANY.sodMode);
  // Soft-delete of posted manual journals (Accounting → Preferences →
  // Journals). Off by default — reversing is the standard correction; a company
  // turns this on only on request (GKB, Oct 2026). Deletion always needs an
  // approver other than the requester, and the audit trail stays.
  const [journalDeletion, setJournalDeletion] = useState(false);
  // Accounting basics (Accounting → Preferences), set at company creation.
  const [fiscalYearStart, setFiscalYearStart] = useState(COMPANY.fiscalYearStart);
  const [timezone, setTimezone] = useState(COMPANY.timezone);
  const toggleReconcilable = useCallback((code) => setReconcilableAccounts((prev) => (
    prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
  )), []);
  const value = useMemo(
    () => ({
      inventoryCostingMethod, setInventoryCostingMethod,
      reconDifferenceAccounts, setReconDifferenceAccounts,
      reconcilableAccounts, toggleReconcilable,
      sodMode, setSodMode,
      journalDeletion, setJournalDeletion,
      baseCurrency: COMPANY.baseCurrency, fiscalYearStart, setFiscalYearStart, timezone, setTimezone,
    }),
    [inventoryCostingMethod, reconDifferenceAccounts, reconcilableAccounts, toggleReconcilable, sodMode,
      journalDeletion, fiscalYearStart, timezone],
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
