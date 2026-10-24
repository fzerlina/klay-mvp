import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";
import LocationCards from "../components/LocationCards";
import { useCurrentUser } from "../state/CurrentUserContext";
import { CAPABILITIES } from "../data/seed/roles";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";

// Settings → Accounting → General Ledger → Locations. Where items and assets
// are kept, as locations with sub-locations (components/LocationCards.jsx).
// Editing needs the warehouse capability; deleting its own.

export default function LocationsPage() {
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("masterdata.warehouse.manage");
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="General Ledger"
          tabs={ACCOUNTING_TABS}
          intro="Where the company's items and assets are kept — each location with the sub-locations inside it."
        />
        <LocationCards canEdit={canEdit} canDelete={hasCapability("masterdata.warehouse.delete")} />
        {!canEdit && (
          <p className="mr-ro">Read only — changing these needs the <em>{CAPABILITIES["masterdata.warehouse.manage"].label}</em> capability.</p>
        )}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
