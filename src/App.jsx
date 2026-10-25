import { Navigate, Route, Routes } from "react-router-dom";
import Layout, { NoAccess } from "./layout/Layout";
import { CurrentUserProvider, useCurrentUser } from "./state/CurrentUserContext";
import { RolesProvider } from "./state/RolesContext";
import CommandCenterPage from "./pages/CommandCenterPage";
import PaymentsPage from "./pages/PaymentsPage";
import ReportsPage from "./pages/ReportsPage";
import JournalEntryPage from "./pages/JournalEntryPage";
import JournalEntryFormPage from "./pages/JournalEntryFormPage";
import JournalEntryDetailPage from "./pages/JournalEntryDetailPage";
import ScheduledAutoPost from "./state/ScheduledAutoPost";
import ChartOfAccountsPage from "./pages/ChartOfAccountsPage";
import DimensionsPage from "./pages/DimensionsPage";
import LocationsPage from "./pages/LocationsPage";
import BillsPage from "./pages/BillsPage";
import BillCreatePage from "./pages/BillCreatePage";
import BillDetailPage from "./pages/BillDetailPage";
import CashflowReportPage from "./pages/CashflowReportPage";
import ProfitLossPage from "./pages/ProfitLossPage";
import TaxRegisterPage from "./pages/TaxRegisterPage";
import InvoicesPage from "./pages/InvoicesPage";
import InvoiceCreatePage from "./pages/InvoiceCreatePage";
import VendorsPage from "./pages/VendorsPage";
import VendorCreatePage from "./pages/VendorCreatePage";
import VendorDetailPage from "./pages/VendorDetailPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerCreatePage from "./pages/CustomerCreatePage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import ItemsPage from "./pages/ItemsPage";
import ItemCreatePage from "./pages/ItemCreatePage";
import ItemDetailPage from "./pages/ItemDetailPage";
import InventoryPage from "./pages/InventoryPage";
import AssetsPage from "./pages/AssetsPage";
import AssetCreatePage from "./pages/AssetCreatePage";
import AssetDetailPage from "./pages/AssetDetailPage";
import GeneralLedgerPage from "./pages/GeneralLedgerPage";
import TrialBalancePage from "./pages/TrialBalancePage";
import ApCloseCommandCenterPage from "./pages/ApCloseCommandCenterPage";
import BankReconciliationPage from "./pages/BankReconciliationPage";
import BankAccountsSettingsPage from "./pages/BankAccountsSettingsPage";
import UsersPage from "./pages/UsersPage";
import RolesPage from "./pages/RolesPage";
import CompanyProfilePage from "./pages/CompanyProfilePage";
import RoleDetailPage from "./pages/RoleDetailPage";
import ApprovalSettingsPage from "./pages/ApprovalSettingsPage";
import AccountingPreferencesPage from "./pages/AccountingPreferencesPage";
import JournalTemplatesPage from "./pages/JournalTemplatesPage";
import { SettingsAuditProvider } from "./state/SettingsAuditContext";
import TaxSettingsPage from "./pages/TaxSettingsPage";
import { InvoicesProvider } from "./state/InvoicesContext";
import { BillsProvider } from "./state/BillsContext";
import { PaymentsProvider } from "./state/PaymentsContext";
import { BankReconProvider } from "./state/BankReconContext";
import { VendorsProvider } from "./state/VendorsContext";
import { CustomersProvider } from "./state/CustomersContext";
import { ItemsProvider } from "./state/ItemsContext";
import { InventorySubledgerProvider } from "./state/InventorySubledgerContext";
import { AssetsProvider } from "./state/AssetsContext";
import { AccountingSettingsProvider } from "./state/AccountingSettingsContext";
import { DimensionsProvider } from "./state/DimensionsContext";
import { PeopleProvider } from "./state/PeopleContext";
import { ModuleSettingsProvider } from "./state/ModuleSettingsContext";
import InventorySettingsPage, { FixedAssetsSettingsPage } from "./pages/InventorySettingsPage";
import ReconciliationSettingsPage from "./pages/ReconciliationSettingsPage";
import { JournalEntriesProvider } from "./state/JournalEntriesContext";
import { ClosePeriodProvider } from "./state/ClosePeriodContext";

function ComingSoon({ title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#999", fontSize: 15 }}>
      {title} — coming soon
    </div>
  );
}

function UnderConstruction({ title }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 14, color: "var(--color-text-secondary)", textAlign: "center", padding: 32 }}>
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-text-tertiary)" }}>
        <path d="M2 20h20" />
        <path d="M4 20V10l8-5 8 5v10" />
        <path d="M9 20v-6h6v6" />
      </svg>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-text-primary)" }}>{title} is under construction</div>
      <div style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.6 }}>
        We're still building this page. In the meantime, use the sidebar to reach
        Bills, Invoices, the General Ledger, and the rest of your workspace.
      </div>
    </div>
  );
}

// Sends the current persona to the first page their role can reach.
function RoleLanding() {
  const { landingPath } = useCurrentUser();
  return <Navigate to={landingPath} replace />;
}

// Route guard for actions that need more than view access (e.g. creating a
// bill needs transact on AP). View-level personas can reach the list but get
// a permission panel if they deep-link into a create page.
function RequireLevel({ module, level, action, children }) {
  const { hasLevel, user } = useCurrentUser();
  if (hasLevel(module, level)) return children;
  return (
    <NoAccess
      moduleKey={module}
      title="No permission for this action"
      body={
        <>
          You're viewing as <strong>{user.name}</strong>, whose role can't {action}.
          Switch persona from the profile menu to continue.
        </>
      }
    />
  );
}

export default function App() {
  return (
    <RolesProvider>
    <CurrentUserProvider>
    <SettingsAuditProvider>
    <InvoicesProvider>
      <BillsProvider>
        <VendorsProvider>
          <CustomersProvider>
          {/* The sub-ledger wraps Item Master, not the other way round: the
              catalogue reads stock, and stock never reads the catalogue. */}
          <InventorySubledgerProvider>
          <ItemsProvider>
            <AccountingSettingsProvider>
            <DimensionsProvider>
            <PeopleProvider>
            <ModuleSettingsProvider>
            <JournalEntriesProvider>
            <ClosePeriodProvider>
            {/* Fixed Assets is one module — the register and its schedule
                engine (lib/fixedAssets.js) live in a single AssetsContext,
                unlike Item Master / Inventory Sub-Ledger above. */}
            <AssetsProvider>
            <PaymentsProvider>
            <BankReconProvider>
            {/* Scheduled journal entries post themselves on their date. */}
            <ScheduledAutoPost />
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<RoleLanding />} />
                <Route path="/command-center" element={<CommandCenterPage />} />
                {/* Retired routes — Your Tasks + Insights merged into Command Center. */}
                <Route path="/dashboard" element={<Navigate to="/command-center" replace />} />
                <Route path="/insights" element={<Navigate to="/command-center?tab=insights" replace />} />
                <Route path="/general-ledger" element={<GeneralLedgerPage />} />
                <Route path="/journal-entry" element={<JournalEntryPage />} />
                <Route path="/journal-entry/new" element={<RequireLevel module="gl" level="transact" action="prepare journal entries"><JournalEntryFormPage /></RequireLevel>} />
                <Route path="/journal-entry/:jeNumber" element={<JournalEntryDetailPage />} />
                <Route path="/journal-entry/:jeNumber/edit" element={<RequireLevel module="gl" level="transact" action="prepare journal entries"><JournalEntryFormPage /></RequireLevel>} />
                <Route path="/chart-of-accounts" element={<ChartOfAccountsPage />} />
                <Route path="/dimensions" element={<DimensionsPage />} />
                <Route path="/locations" element={<LocationsPage />} />
                <Route path="/bills" element={<BillsPage />} />
                <Route path="/bills/new" element={<RequireLevel module="ap" level="transact" action="create bills"><BillCreatePage /></RequireLevel>} />
                <Route path="/bills/:id" element={<BillDetailPage />} />
                <Route path="/payments" element={<PaymentsPage />} />
                {/* AP Aging table folded into the Cashflow Report (Reports hub). */}
                <Route path="/ap-aging" element={<Navigate to="/reports/cashflow?tab=ap" replace />} />
                <Route path="/ap/close" element={<Navigate to="/close" replace />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/invoices/new" element={<InvoiceCreatePage />} />
                <Route path="/vendors" element={<VendorsPage />} />
                <Route path="/vendors/new" element={<RequireLevel module="ap" level="transact" action="add vendors"><VendorCreatePage /></RequireLevel>} />
                <Route path="/vendors/:id" element={<VendorDetailPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/new" element={<RequireLevel module="ar" level="transact" action="add customers"><CustomerCreatePage /></RequireLevel>} />
                <Route path="/customers/:id" element={<CustomerDetailPage />} />
                <Route path="/items" element={<ItemsPage />} />
                <Route path="/items/new" element={<ItemCreatePage />} />
                <Route path="/items/:id" element={<ItemDetailPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/assets/new" element={<AssetCreatePage />} />
                <Route path="/assets/:id" element={<AssetDetailPage />} />
                {/* The Inventory Sub-Ledger: every stock movement. The old combined
                    Inventory module's deep links still resolve — /inventory/new to
                    the catalogue's create form, a record id to the list (ids
                    changed with the split, so a wrong item is worse than none). */}
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/inventory/new" element={<Navigate to="/items/new" replace />} />
                <Route path="/inventory/:id" element={<Navigate to="/items" replace />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/reports/cashflow" element={<CashflowReportPage />} />
                <Route path="/reports/profit-loss" element={<ProfitLossPage />} />
                <Route path="/reports/tax-register" element={<TaxRegisterPage />} />
                <Route path="/trial-balance" element={<TrialBalancePage />} />
                <Route path="/close" element={<ApCloseCommandCenterPage />} />
                <Route path="/bank-reconciliation" element={<BankReconciliationPage />} />
                <Route path="/bank-accounts" element={<Navigate to="/settings/reconciliation/bank-accounts" replace />} />
                <Route path="/settings/reconciliation/bank-accounts" element={<BankAccountsSettingsPage />} />
                <Route path="/company-settings" element={<CompanyProfilePage />} />
                <Route path="/departments" element={<Navigate to="/company-settings" replace />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/roles" element={<RolesPage />} />
                <Route path="/roles/:key" element={<RoleDetailPage />} />
                <Route path="/access-policy" element={<Navigate to="/roles" replace />} />
                <Route path="/approval" element={<ApprovalSettingsPage />} />
                <Route path="/tax" element={<TaxSettingsPage />} />
                <Route path="/journal-templates" element={<JournalTemplatesPage />} />
                <Route path="/accounting-preferences" element={<AccountingPreferencesPage />} />
                {/* Old one-setting pages now live as sections of Preferences. */}
                <Route path="/posting-periods" element={<Navigate to="/accounting-preferences#posting" replace />} />
                <Route path="/inventory-settings" element={<Navigate to="/settings/items" replace />} />
                <Route path="/bank-recon-settings" element={<Navigate to="/settings/reconciliation" replace />} />
                {/* Module settings — one page per module, a route per tab. */}
                <Route path="/settings/items" element={<InventorySettingsPage />} />
                <Route path="/settings/items/:tab" element={<InventorySettingsPage />} />
                <Route path="/settings/inventory" element={<Navigate to="/settings/items" replace />} />
                <Route path="/settings/inventory/stock-movement" element={<Navigate to="/settings/items/stock-movement" replace />} />
                <Route path="/settings/inventory/locations" element={<Navigate to="/locations" replace />} />
                <Route path="/settings/fixed-assets" element={<FixedAssetsSettingsPage />} />
                <Route path="/settings/fixed-assets/:tab" element={<FixedAssetsSettingsPage />} />
                <Route path="/settings/reconciliation" element={<ReconciliationSettingsPage />} />
                <Route path="*" element={<RoleLanding />} />
              </Route>
            </Routes>
            </BankReconProvider>
            </PaymentsProvider>
            </AssetsProvider>
            </ClosePeriodProvider>
            </JournalEntriesProvider>
            </ModuleSettingsProvider>
            </PeopleProvider>
            </DimensionsProvider>
            </AccountingSettingsProvider>
          </ItemsProvider>
          </InventorySubledgerProvider>
          </CustomersProvider>
        </VendorsProvider>
      </BillsProvider>
    </InvoicesProvider>
    </SettingsAuditProvider>
    </CurrentUserProvider>
    </RolesProvider>
  );
}
