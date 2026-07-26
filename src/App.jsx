import { Navigate, Route, Routes } from "react-router-dom";
import Layout, { NoAccess } from "./layout/Layout";
import { CurrentUserProvider, useCurrentUser } from "./state/CurrentUserContext";
import HomePage from "./pages/HomePage";
import InsightsPage from "./pages/InsightsPage";
import JournalEntryPage from "./pages/JournalEntryPage";
import ChartOfAccountsPage from "./pages/ChartOfAccountsPage";
import DimensionsPage from "./pages/DimensionsPage";
import BillsPage from "./pages/BillsPage";
import BillCreatePage from "./pages/BillCreatePage";
import BillDetailPage from "./pages/BillDetailPage";
import ApAgingPage from "./pages/ApAgingPage";
import InvoicesPage from "./pages/InvoicesPage";
import InvoiceCreatePage from "./pages/InvoiceCreatePage";
import VendorsPage from "./pages/VendorsPage";
import VendorCreatePage from "./pages/VendorCreatePage";
import VendorDetailPage from "./pages/VendorDetailPage";
import CustomersPage from "./pages/CustomersPage";
import CustomerCreatePage from "./pages/CustomerCreatePage";
import CustomerDetailPage from "./pages/CustomerDetailPage";
import InventoryPage from "./pages/InventoryPage";
import InventoryCreatePage from "./pages/InventoryCreatePage";
import InventoryDetailPage from "./pages/InventoryDetailPage";
import GeneralLedgerPage from "./pages/GeneralLedgerPage";
import TrialBalancePage from "./pages/TrialBalancePage";
import ApCloseCommandCenterPage from "./pages/ApCloseCommandCenterPage";
import BankReconciliationPage from "./pages/BankReconciliationPage";
import BankAccountsSettingsPage from "./pages/BankAccountsSettingsPage";
import UsersPage from "./pages/UsersPage";
import AccessPolicyPage from "./pages/AccessPolicyPage";
import PostingPeriodsSettingsPage from "./pages/PostingPeriodsSettingsPage";
import { InvoicesProvider } from "./state/InvoicesContext";
import { BillsProvider } from "./state/BillsContext";
import { PaymentsProvider } from "./state/PaymentsContext";
import { VendorsProvider } from "./state/VendorsContext";
import { CustomersProvider } from "./state/CustomersContext";
import { InventoryProvider } from "./state/InventoryContext";
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
    <CurrentUserProvider>
    <InvoicesProvider>
      <BillsProvider>
        <VendorsProvider>
          <CustomersProvider>
          <InventoryProvider>
            <JournalEntriesProvider>
            <ClosePeriodProvider>
            <PaymentsProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<RoleLanding />} />
                <Route path="/dashboard" element={<HomePage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/general-ledger" element={<GeneralLedgerPage />} />
                <Route path="/journal-entry" element={<JournalEntryPage />} />
                <Route path="/chart-of-accounts" element={<ChartOfAccountsPage />} />
                <Route path="/dimensions" element={<DimensionsPage />} />
                <Route path="/bills" element={<BillsPage />} />
                <Route path="/bills/new" element={<RequireLevel module="ap" level="transact" action="create bills"><BillCreatePage /></RequireLevel>} />
                <Route path="/bills/:id" element={<BillDetailPage />} />
                <Route path="/ap-aging" element={<ApAgingPage />} />
                <Route path="/ap/close" element={<Navigate to="/close" replace />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/invoices/new" element={<InvoiceCreatePage />} />
                <Route path="/vendors" element={<VendorsPage />} />
                <Route path="/vendors/new" element={<RequireLevel module="ap" level="transact" action="add vendors"><VendorCreatePage /></RequireLevel>} />
                <Route path="/vendors/:id" element={<VendorDetailPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/new" element={<RequireLevel module="ar" level="transact" action="add customers"><CustomerCreatePage /></RequireLevel>} />
                <Route path="/customers/:id" element={<CustomerDetailPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/inventory/new" element={<InventoryCreatePage />} />
                <Route path="/inventory/:id" element={<InventoryDetailPage />} />
                <Route path="/trial-balance" element={<TrialBalancePage />} />
                <Route path="/close" element={<ApCloseCommandCenterPage />} />
                <Route path="/bank-reconciliation" element={<BankReconciliationPage />} />
                <Route path="/bank-accounts" element={<BankAccountsSettingsPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/access-policy" element={<AccessPolicyPage />} />
                <Route path="/posting-periods" element={<PostingPeriodsSettingsPage />} />
                <Route path="*" element={<RoleLanding />} />
              </Route>
            </Routes>
            </PaymentsProvider>
            </ClosePeriodProvider>
            </JournalEntriesProvider>
          </InventoryProvider>
          </CustomersProvider>
        </VendorsProvider>
      </BillsProvider>
    </InvoicesProvider>
    </CurrentUserProvider>
  );
}
