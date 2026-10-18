import { useLocation } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles-users.css";
import SettingsHeader, { PAYABLES_TABS, RECEIVABLES_TABS } from "../components/SettingsHeader";
import RecordList, { AccountCell } from "../components/RecordList";
import { useModuleSettings, slugKey } from "../state/ModuleSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useVendors } from "../state/VendorsContext";
import { useCustomers } from "../state/CustomersContext";

// Settings → Payables (payment terms, vendor categories, payment methods) and
// Settings → Receivables (payment terms, invoices). Payment terms are one list
// for both sides; each term says whether vendors, customers or both can use it.
// Editing needs coa.manage (the Finance Manager), like the other accounting
// configuration.

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function PaymentTermsList({ side }) {
  const { paymentTerms, defaultTerm, setDefaultTerm, saveTerm, removeTerm } = useModuleSettings();
  const { hasCapability } = useCurrentUser();
  const { vendors } = useVendors();
  const { customers } = useCustomers();
  const canEdit = hasCapability("coa.manage");
  const used = (code) =>
    vendors.filter((v) => v.payment_terms === code).length + customers.filter((c) => c.top === code).length;

  return (
    <RecordList
      title="Payment terms"
      intro={`When a ${side === "vendors" ? "bill" : "invoice"} falls due. One list for vendors and customers; untick a side to hide a term from its form. New ${side} start on the default term.`}
      rows={paymentTerms}
      rowKey="code"
      noun="payment term"
      canEdit={canEdit}
      newRow={{ code: "", days: null, description: "", vendors: true, customers: true }}
      columns={[
        { key: "code", label: "Term", width: "minmax(110px,0.8fr)", render: (t) => <><b>{t.code}</b>{t.code === defaultTerm && <span className="mr-pill on" style={{ marginLeft: 6 }}>Default</span>}</> },
        { key: "days", label: "Days", width: "70px", render: (t) => t.days },
        { key: "description", label: "Description", width: "minmax(180px,2fr)" },
        { key: "used", label: "Used by", width: "minmax(150px,1fr)", render: (t) => (
          <>
            {t.vendors && <span className="mr-pill">Vendors</span>}
            {t.customers && <span className="mr-pill">Customers</span>}
            <span className="mr-sub">{plural(used(t.code), "record")}</span>
          </>
        ) },
      ]}
      fields={[
        { key: "code", label: "Term", type: "text", required: true, placeholder: "e.g. NET 90", lockOnEdit: true },
        { key: "days", label: "Days until due", type: "number", required: true, placeholder: "0 = on delivery" },
        { key: "description", label: "Description", type: "text", span2: true },
        { key: "vendors", label: "Vendors", type: "checkbox", checkLabel: "Offer on vendors" },
        { key: "customers", label: "Customers", type: "checkbox", checkLabel: "Offer on customers" },
      ]}
      validate={(d, isNew) => (isNew && paymentTerms.some((t) => t.code.toLowerCase() === String(d.code || "").trim().toLowerCase()) ? "A term with this name already exists." : null)}
      onSave={(row, orig) => saveTerm(row, orig)}
      onDelete={(t) => removeTerm(t.code)}
      deleteBlocked={(t) => (t.code === defaultTerm ? "This is the default term." : used(t.code) ? `Used by ${plural(used(t.code), "record")}.` : null)}
      footer={canEdit && (
        <div className="mr-default">
          <span>Default term for new records</span>
          <select value={defaultTerm} onChange={(e) => setDefaultTerm(e.target.value)}>
            {paymentTerms.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
          </select>
        </div>
      )}
    />
  );
}

function VendorCategoriesList() {
  const { vendorCategories, saveVendorCategory, removeVendorCategory } = useModuleSettings();
  const { hasCapability } = useCurrentUser();
  const { vendors } = useVendors();
  const canEdit = hasCapability("coa.manage");
  const used = (key) => vendors.filter((v) => v.category === key).length;
  return (
    <RecordList
      title="Vendor categories"
      intro="The Category on every vendor. The default account is where bills from vendors in the category usually post."
      rows={vendorCategories}
      rowKey="key"
      noun="vendor category"
      canEdit={canEdit}
      newRow={{ key: "", label: "", description: "", defaultAccount: null }}
      columns={[
        { key: "label", label: "Category", width: "minmax(140px,1fr)", render: (c) => <b>{c.label}</b> },
        { key: "description", label: "Description", width: "minmax(180px,1.6fr)" },
        { key: "defaultAccount", label: "Usual account", width: "minmax(180px,1.4fr)", render: (c) => <AccountCell code={c.defaultAccount} /> },
        { key: "used", label: "Vendors", width: "80px", render: (c) => used(c.key) },
      ]}
      fields={[
        { key: "label", label: "Name", type: "text", required: true },
        { key: "defaultAccount", label: "Default account", type: "account" },
        { key: "description", label: "Description", type: "text", span2: true },
      ]}
      onSave={(row, orig) => saveVendorCategory({ ...row, key: orig || row.key || slugKey(row.label) }, orig)}
      onDelete={(c) => removeVendorCategory(c.key)}
      deleteBlocked={(c) => (used(c.key) ? `${plural(used(c.key), "vendor")} use it.` : null)}
    />
  );
}

function PaymentMethodsList() {
  const { paymentMethods, savePaymentMethod } = useModuleSettings();
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("coa.manage");
  return (
    <RecordList
      title="Payment methods"
      intro="How a payment leaves the company, chosen when recording a payment. Switch off a method your team doesn't use to hide it from the payment form."
      rows={paymentMethods}
      rowKey="key"
      noun="payment method"
      canEdit={canEdit}
      newRow={{ key: "", label: "", hint: "", active: true }}
      columns={[
        { key: "label", label: "Method", width: "minmax(140px,1fr)", render: (m) => <b>{m.label}</b> },
        { key: "hint", label: "How it behaves", width: "minmax(220px,2.4fr)" },
        { key: "active", label: "Status", width: "90px", render: (m) => <span className={`mr-pill${m.active ? " on" : ""}`}>{m.active ? "On" : "Off"}</span> },
      ]}
      fields={[
        { key: "label", label: "Name", type: "text", required: true },
        { key: "active", label: "Active", type: "checkbox", checkLabel: "Offer this method" },
        { key: "hint", label: "How it behaves", type: "textarea" },
      ]}
      onSave={(row, orig) => savePaymentMethod({ ...row, key: orig || slugKey(row.label) }, orig)}
    />
  );
}

export default function PayablesSettingsPage() {
  const { pathname } = useLocation();
  const { hasCapability } = useCurrentUser();
  const tab = pathname.endsWith("/vendor-categories") ? "categories" : pathname.endsWith("/payment-methods") ? "methods" : "terms";
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Payables"
          tabs={PAYABLES_TABS}
          intro="The lists the Payables screens offer: when bills fall due, how vendors are grouped, and how payments go out."
        />
        {tab === "terms" && <PaymentTermsList side="vendors" />}
        {tab === "categories" && <VendorCategoriesList />}
        {tab === "methods" && <PaymentMethodsList />}
        {!hasCapability("coa.manage") && <p className="mr-ro">Read only — changing these needs the <em>Manage Chart of Accounts</em> capability.</p>}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}

function InvoiceSettingsForm() {
  const { invoiceSettings: s, setInvoiceSettings, paymentTerms } = useModuleSettings();
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("coa.manage");
  const set = (f) => (e) => setInvoiceSettings({ ...s, [f]: f === "nextNumber" ? Number(e.target.value.replace(/\D/g, "")) || 1 : e.target.value });
  const year = new Date().getFullYear();
  const preview = s.numberFormat
    .replace("{YYYY}", String(year))
    .replace(/\{(#+)\}/, (_, h) => String(s.nextNumber).padStart(h.length, "0"));
  return (
    <div className="mr-form">
      <div className="mr-title">Invoices</div>
      <p className="mr-intro">Numbering and defaults for invoices created in Klay (invoice creation ships December 2026).</p>
      <div className="cp-card" style={{ marginTop: 10 }}>
        <div className="cp-grid">
          <label className="cp-field">
            <span>Number format</span>
            <input value={s.numberFormat} disabled={!canEdit} onChange={set("numberFormat")} />
            <em>{"{YYYY}"} is the year, {"{####}"} the running number. Next invoice: <b>{preview}</b></em>
          </label>
          <label className="cp-field">
            <span>Next number</span>
            <input inputMode="numeric" value={s.nextNumber} disabled={!canEdit} onChange={set("nextNumber")} />
            <em>Restarts at 1 each year when the format includes {"{YYYY}"}.</em>
          </label>
          <label className="cp-field">
            <span>Default payment term</span>
            <select value={s.defaultTerm} disabled={!canEdit} onChange={set("defaultTerm")}>
              {paymentTerms.filter((t) => t.customers).map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
            </select>
            <em>Used when the customer has none of its own.</em>
          </label>
          <label className="cp-field span2">
            <span>Footer note</span>
            <textarea rows={2} value={s.footerNote} disabled={!canEdit} onChange={set("footerNote")} />
            <em>Printed at the bottom of every invoice PDF.</em>
          </label>
        </div>
      </div>
    </div>
  );
}

export function ReceivablesSettingsPage() {
  const { pathname } = useLocation();
  const { hasCapability } = useCurrentUser();
  const tab = pathname.endsWith("/invoices") ? "invoices" : "terms";
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="Receivables"
          tabs={RECEIVABLES_TABS}
          intro="When customers have to pay, and how Klay numbers the invoices it creates."
        />
        {tab === "terms" && <PaymentTermsList side="customers" />}
        {tab === "invoices" && <InvoiceSettingsForm />}
        {!hasCapability("coa.manage") && <p className="mr-ro">Read only — changing these needs the <em>Manage Chart of Accounts</em> capability.</p>}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
