import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import { Link } from "react-router-dom";
import SettingsHeader, { RECONCILIATION_TABS } from "../components/SettingsHeader";
import { ReconciliationSection } from "./AccountingPreferencesPage";
import { useModuleSettings } from "../state/ModuleSettingsContext";
import { useFieldAudit } from "../state/SettingsAuditContext";
import { useCurrentUser } from "../state/CurrentUserContext";

// Settings → Reconciliation. How big a gap To match may treat as a bank fee,
// and the accounts a manual reconciliation may book a difference to. Where
// reconciliation books bank charges, interest and the tax on interest is set
// in Accounting → Default accounts, the one place for company-wide defaults.

const BANK_NAMES = { BCA: "BCA", MDR: "Mandiri", BNI: "BNI", CIMB: "CIMB Niaga", BRI: "BRI", PERMATA: "Permata" };
const fmtRp = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

export default function ReconciliationSettingsPage() {
  const { feeTolerance, setFeeTolerance } = useModuleSettings();
  const track = useFieldAudit("Reconciliation", "Reconciliation");
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("coa.manage");
  const setBank = (bank, v) => setFeeTolerance({ ...feeTolerance, byBank: { ...feeTolerance.byBank, [bank]: Number(v.replace(/\D/g, "")) || 0 } });

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Reconciliation"
          tabs={RECONCILIATION_TABS}
          intro={<>
            How much difference bank reconciliation tolerates, and where a manual match may book it. The accounts
            it drafts bank charges and interest to are in{" "}
            <Link to="/settings/default-accounts#reconciliation" className="ru-inline-link">Default accounts</Link>.
          </>}
        />

        <section className="ap-section">
          <h2 className="ap-section-title">Matching tolerance</h2>
          <div className="pp-setting-card">
            <div className="pp-setting-pad">
              <p className="pp-setting-desc" style={{ marginTop: 0 }}>
                The largest gap To match treats as a bank fee when a bank line is a little less than the payment it
                stands for. A bigger gap is a mismatch someone has to look at.
              </p>
              <div className="cp-grid ap-basics">
                <label className="cp-field">
                  <span>Default</span>
                  <input inputMode="numeric" value={feeTolerance.default.toLocaleString("id-ID")} disabled={!canEdit}
                    onChange={(e) => setFeeTolerance({ ...feeTolerance, default: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                    {...track("Fee tolerance — default", feeTolerance.default, fmtRp)} />
                  <em>For banks without their own amount. Now {fmtRp(feeTolerance.default)}.</em>
                </label>
                {Object.entries(feeTolerance.byBank).map(([bank, v]) => (
                  <label key={bank} className="cp-field">
                    <span>{BANK_NAMES[bank] || bank}</span>
                    <input inputMode="numeric" value={v.toLocaleString("id-ID")} disabled={!canEdit} onChange={(e) => setBank(bank, e.target.value)}
                      {...track(`Fee tolerance — ${BANK_NAMES[bank] || bank}`, v, fmtRp)} />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        <ReconciliationSection />
        {!canEdit && <p className="mr-ro">Read only — changing these needs the <em>Manage Chart of Accounts</em> capability.</p>}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
