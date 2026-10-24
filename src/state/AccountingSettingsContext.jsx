import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { COMPANY } from "../data/seed/company";
import { ACCOUNTING_SETTINGS } from "../data/seed/accountingSettings";
import { DEFAULT_ACCOUNTS } from "../data/seed/defaultAccounts";
import { JOURNAL_TEMPLATES } from "../data/seed/journalTemplates";
import { MOVEMENT_ACCOUNTS } from "../lib/inventorySubledger";
import { BOOK_STATUS_JOURNALS, DEPRECIATION_JOURNALS } from "../lib/fixedAssets";

const cloneBookJournals = () => Object.fromEntries(
  Object.entries(BOOK_STATUS_JOURNALS).map(([type, byStatus]) => [type, Object.fromEntries(
    Object.entries(byStatus).map(([k, lines]) => [k, lines.map((l) => ({ ...l }))]),
  )]),
);
const cloneDepreciation = () => Object.fromEntries(
  Object.entries(DEPRECIATION_JOURNALS).map(([k, j]) => [k, { ...j }]),
);
const cloneMovements = () => ({
  in: MOVEMENT_ACCOUNTS.in.map((m) => ({ ...m })),
  out: MOVEMENT_ACCOUNTS.out.map((m) => ({ ...m })),
});

// Company-wide accounting policy that pages read at runtime. Seeded from
// data/seed/accountingSettings.js; the Inventory and Bank reconciliation
// settings pages write it. Kept in its own context so a change reflects
// everywhere at once. Default accounts also write through to the
// DEFAULT_ACCOUNTS registry, which lib/ reads at call time.
const AccountingSettingsContext = createContext(null);

export function AccountingSettingsProvider({ children }) {
  const [inventoryCostingMethod, setInventoryCostingMethod] = useState(
    ACCOUNTING_SETTINGS.inventory_costing_method,
  );
  // The method a new asset starts on (Settings → Fixed Assets → Preferences).
  const [assetDepreciationMethod, setAssetDepreciationMethod] = useState(
    ACCOUNTING_SETTINGS.asset_depreciation_method,
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
  // Deleting posted manual journals (Accounting → Preferences → Delete
  // journals). Not a setting anyone can flip: Klay turns it on in the backend
  // for a company that asks (GKB, Oct 2026) — reversing is the standard
  // correction. Read-only here.
  const journalDeletion = !!COMPANY.journalDeletionEnabled;
  // Day of the following month by which a month's books close (Accounting →
  // Preferences → Closing).
  const [closeCutoffDay, setCloseCutoffDay] = useState(COMPANY.closeCutoffDay);
  // Journal templates offered on a new manual journal (Accounting → Journal
  // templates).
  const [journalTemplates, setJournalTemplates] = useState(JOURNAL_TEMPLATES);
  const saveJournalTemplate = useCallback((t) => setJournalTemplates((cur) => (
    cur.some((x) => x.id === t.id) ? cur.map((x) => (x.id === t.id ? t : x)) : [...cur, t]
  )), []);
  const deleteJournalTemplate = useCallback((id) => setJournalTemplates((cur) => cur.filter((x) => x.id !== id)), []);
  // Accounting basics (Accounting → Preferences), set at company creation.
  const [fiscalYearStart, setFiscalYearStart] = useState(COMPANY.fiscalYearStart);
  const [timezone, setTimezone] = useState(COMPANY.timezone);
  // Each module's fallback / pre-fill account (seed/defaultAccounts.js). Only
  // Opening stock is edited in the app, on Settings → Items → Stock movement.
  const [defaultAccounts, setDefaultAccounts] = useState(() => ({ ...DEFAULT_ACCOUNTS }));
  const setDefaultAccount = useCallback((key, code) => {
    DEFAULT_ACCOUNTS[key] = code;
    setDefaultAccounts((d) => ({ ...d, [key]: code }));
  }, []);
  // Which of the item category's accounts each stock-movement reason posts
  // against (Settings → Inventory → Stock movement), written through to MOVEMENT_ACCOUNTS.
  const [movementAccounts, setMovementAccounts] = useState(() => cloneMovements());
  const setMovementAccount = useCallback((dir, reason, role) => {
    const row = MOVEMENT_ACCOUNTS[dir].find((m) => m.reason === reason);
    if (row) row.other = role;
    setMovementAccounts(cloneMovements());
  }, []);
  // Which asset-category account each book-status journal line uses, and the
  // periodic charge per asset type (Settings → Fixed Assets → Book status),
  // written through to BOOK_STATUS_JOURNALS / DEPRECIATION_JOURNALS.
  const [bookJournals, setBookJournals] = useState(() => cloneBookJournals());
  const setBookJournalRole = useCallback((type, status, lineId, role) => {
    const line = BOOK_STATUS_JOURNALS[type]?.[status]?.find((l) => l.id === lineId);
    if (line) line.role = role;
    setBookJournals(cloneBookJournals());
  }, []);
  const [depreciationJournals, setDepreciationJournals] = useState(() => cloneDepreciation());
  const setDepreciationRole = useCallback((type, side, role) => {
    if (DEPRECIATION_JOURNALS[type]) DEPRECIATION_JOURNALS[type][side] = role;
    setDepreciationJournals(cloneDepreciation());
  }, []);
  const toggleReconcilable = useCallback((code) => setReconcilableAccounts((prev) => (
    prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
  )), []);
  const value = useMemo(
    () => ({
      inventoryCostingMethod, setInventoryCostingMethod,
      assetDepreciationMethod, setAssetDepreciationMethod,
      reconDifferenceAccounts, setReconDifferenceAccounts,
      reconcilableAccounts, toggleReconcilable,
      defaultAccounts, setDefaultAccount,
      movementAccounts, setMovementAccount,
      bookJournals, setBookJournalRole, depreciationJournals, setDepreciationRole,
      sodMode, setSodMode,
      journalDeletion,
      closeCutoffDay, setCloseCutoffDay,
      journalTemplates, saveJournalTemplate, deleteJournalTemplate,
      baseCurrency: COMPANY.baseCurrency, fiscalYearStart, setFiscalYearStart, timezone, setTimezone,
    }),
    [inventoryCostingMethod, assetDepreciationMethod, reconDifferenceAccounts, reconcilableAccounts, toggleReconcilable, defaultAccounts,
      setDefaultAccount, movementAccounts, setMovementAccount,
      bookJournals, setBookJournalRole, depreciationJournals, setDepreciationRole, sodMode,
      journalDeletion, closeCutoffDay, journalTemplates, saveJournalTemplate, deleteJournalTemplate, fiscalYearStart, timezone],
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
