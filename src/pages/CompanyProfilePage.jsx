import { useState } from "react";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import SettingsHeader, { COMPANY_TABS } from "../components/SettingsHeader";
import { useCurrentUser } from "../state/CurrentUserContext";
import { Link } from "react-router-dom";
import { COMPANY } from "../data/seed/company";

// Settings → Company (the company profile). Who the company is: the legal
// identity used on invoices, POs and tax documents. The accounting basics
// (base currency, fiscal year, time zone) live in Accounting → Preferences.
// Company administration sits with the Admin role (users.manage).


export default function CompanyProfilePage() {
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("users.manage");
  const [saved, setSaved] = useState(COMPANY);
  const [draft, setDraft] = useState(COMPANY);
  const [toast, setToast] = useState("");

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const set = (f) => (e) => setDraft((d) => ({ ...d, [f]: e.target.value }));

  function save() {
    setSaved(draft);
    setToast("Company profile saved.");
    setTimeout(() => setToast(""), 2200);
  }

  const field = (label, f, { span2, type = "text", hint, placeholder } = {}) => (
    <label className={`cp-field${span2 ? " span2" : ""}`}>
      <span>{label}</span>
      {type === "textarea"
        ? <textarea rows={2} value={draft[f]} disabled={!canEdit} onChange={set(f)} placeholder={placeholder} />
        : <input type={type} value={draft[f]} disabled={!canEdit} onChange={set(f)} placeholder={placeholder} />}
      {hint && <em>{hint}</em>}
    </label>
  );

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Company"
          tabs={COMPANY_TABS}
          intro={<>Your company's legal details. Klay prints them on invoices, purchase orders and tax documents. Base currency, fiscal year and time zone are in <Link to="/accounting-preferences" className="ru-inline-link">General Ledger › Preferences</Link>.</>}
        />

        {!canEdit && <p className="cp-ro">Read only — only the Admin role can change the company profile.</p>}

        <div className="cp-body">
          <section className="cp-card">
            <div className="cp-card-head">
              <div>
                <div className="cp-card-title">Company details</div>
                <div className="cp-card-desc">The legal entity as registered with the tax office.</div>
              </div>
              <div className="cp-logo">
                <span className="cp-logo-mark" aria-hidden>SM</span>
              </div>
            </div>
            <div className="cp-grid">
              {field("Legal name", "legalName")}
              {field("Trading name", "tradingName", { hint: "Shown in the app and on emails." })}
              {field("NPWP", "npwp", { hint: "Tax ID, printed on tax invoices." })}
              {field("Industry", "industry")}
              {field("Finance email", "email", { type: "email" })}
              {field("Phone", "phone")}
              {field("Address", "address", { span2: true, type: "textarea" })}
              {field("City", "city")}
              {field("Province", "province")}
              {field("Postal code", "postalCode")}
            </div>
          </section>

          {canEdit && dirty && (
            <div className="cp-card">
              <div className="cp-foot">
                <button type="button" className="drawer-btn ghost" onClick={() => setDraft(saved)}>Discard</button>
                <button type="button" className="drawer-btn primary" onClick={save}>Save changes</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
