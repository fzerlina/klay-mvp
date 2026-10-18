import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import SettingsHeader, { RECONCILIATION_TABS } from "../components/SettingsHeader";
import { LEAF_ACCOUNTS } from "../components/RecordList";
import { ReconciliationSection } from "./AccountingPreferencesPage";
import { useModuleSettings } from "../state/ModuleSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";

// Settings → Reconciliation. Where bank reconciliation books what a
// statement line implies (bank charges, interest, the tax withheld on
// interest), how big a gap To match may treat as a bank fee, and the accounts
// a manual reconciliation may book a difference to.

const ACCOUNT_ROWS = [
  ["bankFee", "Bank charges", "Admin fees and transfer charges the bank debits."],
  ["interestIncome", "Interest income", "Interest the bank credits on giro and deposit balances."],
  ["interestTax", "Tax on interest", "The final tax (PPh Final) the bank withholds from that interest."],
];

const BANK_NAMES = { BCA: "BCA", MDR: "Mandiri", BNI: "BNI", CIMB: "CIMB Niaga", BRI: "BRI", PERMATA: "Permata" };
const fmtRp = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

export default function ReconciliationSettingsPage() {
  const { reconAccounts, setReconAccounts, feeTolerance, setFeeTolerance } = useModuleSettings();
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("coa.manage");
  const setBank = (bank, v) => setFeeTolerance({ ...feeTolerance, byBank: { ...feeTolerance.byBank, [bank]: Number(v.replace(/\D/g, "")) || 0 } });

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Reconciliation"
          tabs={RECONCILIATION_TABS}
          intro="How bank reconciliation books what it finds on a statement, and how much difference it tolerates."
        />

        <section className="ap-section">
          <h2 className="ap-section-title">Default accounts</h2>
          <div className="pp-setting-card">
            <div className="pp-setting-pad">
              <p className="pp-setting-desc" style={{ marginTop: 0 }}>
                When a statement line has no journal yet, Klay drafts one to these accounts.
              </p>
              <div className="cp-grid ap-basics">
                {ACCOUNT_ROWS.map(([k, label, hint]) => (
                  <label key={k} className="cp-field">
                    <span>{label}</span>
                    <select value={reconAccounts[k] || ""} disabled={!canEdit} onChange={(e) => setReconAccounts({ ...reconAccounts, [k]: e.target.value })}>
                      {LEAF_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                    </select>
                    <em>{hint}</em>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

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
                    onChange={(e) => setFeeTolerance({ ...feeTolerance, default: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
                  <em>For banks without their own amount. Now {fmtRp(feeTolerance.default)}.</em>
                </label>
                {Object.entries(feeTolerance.byBank).map(([bank, v]) => (
                  <label key={bank} className="cp-field">
                    <span>{BANK_NAMES[bank] || bank}</span>
                    <input inputMode="numeric" value={v.toLocaleString("id-ID")} disabled={!canEdit} onChange={(e) => setBank(bank, e.target.value)} />
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
