import { useRef, useState } from "react";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles.css";
import SettingsHeader from "../components/SettingsHeader";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import { Link } from "react-router-dom";
import { COMPANY } from "../data/seed/company";

// Settings → Company (the company profile). Who the company is: the legal
// identity used on invoices, POs and tax documents, and the logo printed on
// them. The accounting basics (base currency, fiscal year, time zone) live in
// Accounting → Preferences. Editing needs settings.entity.manage (Admin).

const FIELDS = [
  ["legalName", "Legal name"],
  ["aktaNo", "Akta No."],
  ["npwp", "NPWP"],
  ["industry", "Industry"],
  ["email", "Finance email"],
  ["phone", "Phone"],
  ["address", "Address"],
  ["city", "City"],
  ["province", "Province"],
  ["postalCode", "Postal code"],
];
const MAX_LOGO_BYTES = 1024 * 1024;

export default function CompanyProfilePage() {
  const { hasCapability } = useCurrentUser();
  const { log } = useSettingsAudit();
  const canEdit = hasCapability("settings.entity.manage");
  const [saved, setSaved] = useState(COMPANY);
  const [draft, setDraft] = useState(COMPANY);
  const [toast, setToast] = useState("");
  const fileRef = useRef(null);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const set = (f) => (e) => setDraft((d) => ({ ...d, [f]: e.target.value }));

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  function pickLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) { showToast("Use a PNG, JPG or SVG file."); return; }
    if (file.size > MAX_LOGO_BYTES) { showToast("The logo must be 1 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => setDraft((d) => ({ ...d, logo: reader.result }));
    reader.readAsDataURL(file);
  }

  function save() {
    for (const [f, label] of FIELDS) {
      if ((saved[f] || "") !== (draft[f] || "")) log("Company", "Company profile", `${label}: ${saved[f] || "—"} → ${draft[f] || "—"}`);
    }
    if (saved.logo !== draft.logo) log("Company", "Company profile", draft.logo ? "Uploaded a new company logo" : "Removed the company logo");
    Object.assign(COMPANY, draft);
    setSaved(draft);
    showToast("Company profile saved.");
  }

  const field = (label, f, { span2, type = "text", hint, placeholder } = {}) => (
    <label className={`cp-field${span2 ? " span2" : ""}`}>
      <span>{label}</span>
      {type === "textarea"
        ? <textarea rows={2} value={draft[f] || ""} disabled={!canEdit} onChange={set(f)} placeholder={placeholder} />
        : <input type={type} value={draft[f] || ""} disabled={!canEdit} onChange={set(f)} placeholder={placeholder} />}
      {hint && <em>{hint}</em>}
    </label>
  );

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Company"
          intro={<>Your company's legal details. Klay prints them on invoices, purchase orders and tax documents. Base currency, fiscal year and time zone are in <Link to="/accounting-preferences" className="ru-inline-link">General Ledger › Preferences</Link>.</>}
        />

        {!canEdit && <p className="cp-ro">Read only — only the Admin role can change the company profile.</p>}

        <div className="cp-body">
          <section className="cp-card">
            <div className="cp-card-head">
              <div>
                <div className="cp-card-title">Company details</div>
                <div className="cp-card-desc">The legal entity as registered with the tax office, and the logo printed on its documents.</div>
              </div>
            </div>
            <div className="cp-logo-row">
              {draft.logo
                ? <img className="cp-logo-img" src={draft.logo} alt="Company logo" />
                : <span className="cp-logo-mark" aria-hidden>{(draft.legalName || "").replace(/^(PT|CV)\s+/i, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>}
              {canEdit && (
                <div className="cp-logo-actions">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" hidden onChange={pickLogo} />
                  <button type="button" className="rl-btn" onClick={() => fileRef.current?.click()}>
                    {draft.logo ? "Replace logo" : "Upload logo"}
                  </button>
                  {draft.logo && (
                    <button type="button" className="ru-inline-link cp-logo-remove" onClick={() => setDraft((d) => ({ ...d, logo: null }))}>Remove</button>
                  )}
                </div>
              )}
              <span className="cp-logo-hint">Logo · PNG, JPG or SVG, up to 1 MB</span>
            </div>
            <div className="cp-grid">
              {field("Legal name", "legalName", { span2: true })}
              {field("Akta No.", "aktaNo", { hint: "Deed of establishment number." })}
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
