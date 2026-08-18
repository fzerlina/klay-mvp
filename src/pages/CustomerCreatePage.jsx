import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomers } from "../state/CustomersContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { initials, termLabel } from "../lib/format";
import "./invoice-create.css";
import "./vendor-create.css";
import "./customer-create.css";

// ── New Customer — manual creation (Customer Master PRD, mirror of New Vendor) ─
// Capability-gated per the Role & Permission engine: creating a customer requires
// the `customer.create` capability (AR Staff). SoD: the creator can't approve the
// draft — an approver (Finance Manager / Accounting Manager) confirms/activates
// it on the Detail page. Manual creation always lands as DRAFT_PENDING.

const TERM_OPTIONS = ["COD", "NET 7", "NET 14", "NET 15", "NET 21", "NET 30", "NET 45", "NET 60"];
const CURRENCY_OPTIONS = [
  { v: "IDR", label: "IDR — Rupiah" },
  { v: "USD", label: "USD — US Dollar" },
  { v: "SGD", label: "SGD — Singapore Dollar" },
];

// Withholding CHOICES for a Company — the user picks the type; the rate is
// resolved automatically from whether the customer has an NPWP (see rateFor).
// Individuals are always PPh 21, with the rate chosen per invoice.
const WHT_COMPANY = [
  { v: "none", label: "No withholding" },
  { v: "pph23", label: "PPh 23" },
  { v: "pph05_final", label: "PPh 0.5% Final" },
  { v: "pph42", label: "PPh 4(2)" },
];

// NPWP-resolved rate preview for the two graduated types.
function rateFor(pph, hasNpwp) {
  if (pph === "pph23") return hasNpwp ? "2%" : "4%";
  if (pph === "pph42") return hasNpwp ? "10%" : "20%";
  return null;
}

// AR control-account shortlist (mirrors the AP reconciliation-account picker).
const AR_ACCT_OPTIONS = [
  { v: "1-1200", label: "1-1200 · Accounts Receivable (default)" },
  { v: "1-1210", label: "1-1210 · AR — Trade" },
  { v: "1-1220", label: "1-1220 · AR — Retail" },
];
const ENTITY_FORMS = [
  { v: "PT", label: "PT (Limited company)" },
  { v: "CV", label: "CV" },
  { v: "UD", label: "UD / PD" },
  { v: "Firma", label: "Firma" },
  { v: "Cooperative", label: "Cooperative (Koperasi)" },
  { v: "BUMN", label: "BUMN / Government entity" },
];
function blankContact(primary = false) {
  return { name: "", title: "", phone: "", waSame: false, email: "", emailFin: "", primary };
}
function digitsOnly(s) { return (s || "").replace(/\D/g, ""); }
function fmtCurrency(v) {
  if (!v) return "";
  const n = String(v).replace(/[^\d]/g, "");
  return n ? Number(n).toLocaleString("id-ID") : "";
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.5l1.1 2.7L9.8 5l-2.7 0.8L6 8.5l-1.1-2.7L2.2 5l2.7-0.8L6 1.5z" />
    </svg>
  );
}

export default function CustomerCreatePage() {
  const navigate = useNavigate();
  const { customers, addCustomer } = useCustomers();
  const { user, hasCapability } = useCurrentUser();

  // Capabilities (source of truth = roles.js). customer.create → AR Staff.
  const canCreateCustomer = hasCapability("customer.create");
  // Relationship tier is a customer-master classification (customer.classify) —
  // AR Staff (the creator) holds it, so it can be set at onboarding.
  const canClassify = hasCapability("customer.classify");

  const [entityType, setEntityType] = useState(null); // null | 'perusahaan' | 'individu'

  // Information
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [entityForm, setEntityForm] = useState("PT");
  const [npwp, setNpwp] = useState("");
  const [address, setAddress] = useState("");
  // Shipping address defaults to "same as billing" — the common case. Only a
  // deliberate opt-out captures a second address on the record.
  const [shipSame, setShipSame] = useState(true);
  const [shippingAddress, setShippingAddress] = useState("");
  const [dedupDismissed, setDedupDismissed] = useState(false);

  // Tax — entity-type driven (mirror of New Vendor). Company picks a withholding
  // type; the rate is resolved from NPWP presence. Individual is always PPh 21.
  const [pph, setPph] = useState("none");

  // Terms & credit
  const [top, setTop] = useState("NET 30");
  const [creditLimit, setCreditLimit] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [recon, setRecon] = useState("1-1200");

  // Contacts
  const [contacts, setContacts] = useState([blankContact(true)]);

  const [notes, setNotes] = useState("");
  const [tier, setTier] = useState("standard");
  const [tierNote, setTierNote] = useState("");

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }

  // ── NPWP deduplication — runs as the NPWP is typed ────────────────────────
  const npwpMatch = useMemo(() => {
    const d = digitsOnly(npwp);
    if (d.length < 6) return null;
    return customers.find((c) => c.npwp && digitsOnly(c.npwp) === d) || null;
  }, [npwp, customers]);
  // Name-similarity fallback when no NPWP is entered (lower-confidence).
  const nameMatch = useMemo(() => {
    const n = name.trim().toLowerCase();
    if (digitsOnly(npwp).length >= 6 || n.length < 6) return null;
    return customers.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())) || null;
  }, [name, npwp, customers]);
  const showDedup = !dedupDismissed && (npwpMatch || nameMatch);

  function updateContact(i, patch) {
    setContacts((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addContact() { setContacts((prev) => [...prev, blankContact(false)]); }
  function delContact(i) { setContacts((prev) => prev.filter((_, idx) => idx !== i)); }

  function resetForm() {
    setCode(""); setName(""); setLegalName(""); setEntityForm("PT"); setNpwp(""); setAddress(""); setDedupDismissed(false);
    setShipSame(true); setShippingAddress("");
    setPph("none");
    setTop("NET 30"); setCreditLimit(""); setCurrency("IDR"); setRecon("1-1200");
    setContacts([blankContact(true)]);
    setNotes(""); setTier("standard"); setTierNote("");
  }
  function backToStep0() { setEntityType(null); resetForm(); }

  const isCompany = entityType === "perusahaan";

  // PKP is derived from entity type: Company is PKP (needs Faktur Pajak),
  // Individual is Non-PKP. Not a user choice.
  const pkp = isCompany ? "PKP" : "NON_PKP";
  // Individual withholding is always PPh 21; Company keeps the chosen type.
  const effectivePph = isCompany ? pph : "pph21";
  const hasNpwp = digitsOnly(npwp).length >= 6;
  const pphRate = rateFor(effectivePph, hasNpwp);

  const primary = contacts[0];
  const canSubmit =
    name.trim() && address.trim() &&
    (shipSame || shippingAddress.trim()) &&
    primary?.name.trim() && primary?.phone.trim() && primary?.email.trim() &&
    !(tier !== "standard" && !tierNote.trim()) &&
    !npwpMatch;

  function onSave() {
    if (!canCreateCustomer) return;
    if (!name.trim()) { showToast(isCompany ? "Company name is required" : "Full name is required"); return; }
    if (!address.trim()) { showToast("Billing address is required"); return; }
    if (!shipSame && !shippingAddress.trim()) { showToast("Add a shipping address, or tick “Same as billing address”"); return; }
    if (!primary.name.trim() || !primary.phone.trim() || !primary.email.trim()) {
      showToast("Primary contact name, phone, and email are required"); return;
    }
    if (npwpMatch) { showToast("This NPWP already exists — resolve the duplicate first"); return; }
    if (tier !== "standard" && !tierNote.trim()) { showToast("Add a reason for the relationship tier"); return; }

    addCustomer({
      type: entityType,
      code: code.trim(),
      name: name.trim(),
      legalName: isCompany ? (legalName.trim() || name.trim()) : "",
      entityForm: isCompany ? entityForm : "",
      npwp: npwp.trim(),
      pkp,
      pph: effectivePph,
      address: address.trim(),
      shippingAddress: shipSame ? "" : shippingAddress.trim(),
      top,
      creditLimit: parseInt(String(creditLimit).replace(/[^\d]/g, ""), 10) || 0,
      currency,
      acct: recon,
      contacts: contacts.filter((c) => c.name.trim()),
      notes: notes.trim(),
      relationship_tier: tier,
      relationship_tier_note: tier !== "standard" ? tierNote.trim() : "",
      initials: initials(name.trim()),
      source: "MANUAL",
    });
    showToast("Draft created — pending approval ✓");
    setTimeout(() => navigate("/customers"), 800);
  }

  // ── No capability: block the flow (reflects the role model) ───────────────
  if (!canCreateCustomer) {
    return (
      <div className="addpage">
        <div className="ap-head">
          <button className="ap-close" onClick={() => navigate("/customers")} aria-label="Back">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div className="ap-title">New Customer</div>
        </div>
        <div className="vc-noaccess">
          <h2>You don't have permission to create customers</h2>
          <p>
            Creating a customer requires the <strong>Create Customers</strong> permission, which your account
            ({user.name}) doesn't have. Customer drafts are confirmed and activated separately from where
            they're created, so this permission is deliberately kept apart from approving.
          </p>
          <button className="ap-btn-send" onClick={() => navigate("/customers")}>Back to Customers</button>
        </div>
        {toast && <div className="toast show">{toast}</div>}
      </div>
    );
  }

  // ── STEP 0: Entity picker ─────────────────────────────────────────────────
  if (!entityType) {
    return (
      <div className="addpage">
        <div className="ap-head">
          <button className="ap-close" onClick={() => navigate("/customers")} aria-label="Close">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <div className="ap-title">New Customer</div>
          <div className="ap-hint" style={{ flex: 1, marginLeft: 4 }}>— Pick the entity type first</div>
          <button className="ap-close" onClick={() => navigate("/customers")} aria-label="Cancel">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="entity-step0">
          <h2>Register this customer as what?</h2>
          <p>This choice determines which fields you'll fill in.</p>
          <div className="entity-cards">
            <div className="ec" onClick={() => setEntityType("perusahaan")}>
              <div className="ec-icon">
                <svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>
              </div>
              <div className="ec-title">Company</div>
              <div className="ec-desc">Has a legal entity or registered business</div>
              <div className="ec-eg">PT, CV, UD, Firma, Cooperative, BUMN</div>
            </div>
            <div className="ec" onClick={() => setEntityType("individu")}>
              <div className="ec-icon">
                <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div className="ec-title">Individual</div>
              <div className="ec-desc">A person, not under a legal entity</div>
              <div className="ec-eg">Freelancer, individual reseller, direct consumer</div>
            </div>
          </div>
        </div>
        {toast && <div className="toast show">{toast}</div>}
      </div>
    );
  }

  // ── STEP 1: Form ──────────────────────────────────────────────────────────
  return (
    <div className="addpage">
      <div className="ap-head">
        <button className="ap-close" onClick={backToStep0} aria-label="Change type">
          <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </button>
        <div className="ap-title">New Customer</div>
        <span className="vc-status">Draft · Pending approval</span>
        <span className={`entity-pill ${entityType}`} onClick={backToStep0}>
          {isCompany ? "🏢 Company" : "👤 Individual"}
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </span>
        <div className="ap-hint" style={{ flex: 1, marginLeft: 8 }}>Fields marked <span style={{ color: "var(--color-danger-text)", fontWeight: 700 }}>*</span> are required</div>
      </div>

      <div className="ap-s1" style={{ alignItems: "stretch", padding: "28px 24px 96px" }}>
        <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>

          <div className="vc-approval-note">
            <strong>Approval-gated:</strong> legal name, NPWP/NIK, credit limit, AR account, and payment terms. A manager signs these off before the customer can post; later changes to any of them start a new approval cycle.
          </div>

          {/* Information */}
          <div className="form-sec card">
            <div className="form-sec-title">{isCompany ? "Company Information" : "Customer Information"}</div>
            <div className="fg2">
              <div className="form-fld">
                <label>Customer Code</label>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto (C-0xx)" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }} />
                <span className="vc-hint">Leave blank to auto-generate</span>
              </div>
              <div className="form-fld">
                <label>{isCompany ? "Company Name" : "Full Name"} <span className="vc-req">*</span></label>
                <input type="text" value={name} onChange={(e) => { setName(e.target.value); setDedupDismissed(false); }} placeholder={isCompany ? "PT Maju Bersama" : "Budi Santoso"} />
              </div>
            </div>
            {isCompany ? (
              <>
                <div className="form-fld" style={{ marginBottom: 10 }}>
                  <label>Legal Name (per deed / NPWP)</label>
                  <input type="text" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="PT Maju Bersama Sejahtera" />
                  <span className="vc-hint">Leave blank if the same as the display name</span>
                </div>
                <div className="fg2">
                  <div className="form-fld">
                    <label>Entity Type</label>
                    <select value={entityForm} onChange={(e) => setEntityForm(e.target.value)}>
                      {ENTITY_FORMS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="form-fld">
                    <label>Company NPWP</label>
                    <input type="text" value={npwp} onChange={(e) => { setNpwp(e.target.value); setDedupDismissed(false); }} placeholder="01.234.567.8-001.000" style={{ fontFamily: "var(--font-mono)" }} />
                    <span className="vc-hint">Checked against your customer master as you type</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="form-fld" style={{ marginBottom: 10 }}>
                <label>Personal NPWP</label>
                <input type="text" value={npwp} onChange={(e) => { setNpwp(e.target.value); setDedupDismissed(false); }} placeholder="12.345.678.9-012.000" style={{ fontFamily: "var(--font-mono)" }} />
                <span className="vc-hint">Optional — checked for duplicates as you type</span>
              </div>
            )}

            {showDedup && (
              <div className="vc-dedup">
                <div className="vc-dedup-title"><SparkIcon /> {npwpMatch ? "Possible duplicate — NPWP match" : "Possible duplicate — name match"}</div>
                <div className="vc-dedup-body">
                  {npwpMatch ? (
                    <>
                      <strong>{npwpMatch.name}</strong> (NPWP {npwpMatch.npwp}) already exists as{" "}
                      <strong>{npwpMatch.code}</strong>
                      {npwpMatch.lastInv ? <> — last invoiced {npwpMatch.lastInv}</> : null}. Is this the same customer?
                    </>
                  ) : (
                    <>
                      No NPWP entered to verify. The name is similar to <strong>{nameMatch.name}</strong>{" "}
                      (<strong>{nameMatch.code}</strong>) — same legal entity, or a variant name? This is a name match, so
                      treat it with less certainty.
                    </>
                  )}
                </div>
                <div className="vc-dedup-actions">
                  <button className="vc-dedup-btn primary" onClick={() => { showToast(`Opening ${(npwpMatch || nameMatch).code}`); setTimeout(() => navigate(`/customers/${(npwpMatch || nameMatch).id}`), 500); }}>
                    Use existing customer
                  </button>
                  <button className="vc-dedup-btn" onClick={() => setDedupDismissed(true)}>Different entity — proceed</button>
                </div>
              </div>
            )}

            <div className="form-fld" style={{ marginBottom: 12, marginTop: showDedup ? 4 : 0 }}>
              <label>Billing Address <span className="vc-req">*</span></label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder={isCompany ? "Jl. Sudirman No. 1, Jakarta Selatan 12930" : "Jl. Kemang Raya No. 8, Jakarta Selatan 12730"} />
            </div>

            <div className="form-fld" style={{ marginBottom: 0 }}>
              <label>Shipping Address</label>
              <label className="vc-check">
                <input type="checkbox" checked={shipSame} onChange={(e) => setShipSame(e.target.checked)} />
                <span>Same as billing address</span>
              </label>
              {!shipSame && (
                <textarea
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  rows={2}
                  style={{ marginTop: 8 }}
                  placeholder="Warehouse / delivery address — where goods are shipped"
                />
              )}
            </div>
          </div>

          {/* Tax & Compliance — PKP + Faktur derived from entity type */}
          <div className="form-sec card">
            <div className="form-sec-title">Tax &amp; Compliance</div>
            <div className="form-fld" style={{ marginBottom: 14 }}>
              <label style={{ marginBottom: 8, display: "block" }}>PKP Status</label>
              <div className="vc-derived">
                <div className="vc-derived-row">
                  <span className="vc-derived-lbl">VAT status</span>
                  <span className="vc-derived-val">{isCompany ? "PKP — VAT-registered" : "Non-PKP"}</span>
                </div>
                <div className="vc-derived-row">
                  <span className="vc-derived-lbl">Tax Invoice (Faktur Pajak)</span>
                  <span className="vc-derived-val">{isCompany ? "Required" : "Not required"}</span>
                </div>
                <div className="vc-derived-note">Set automatically from the entity type.</div>
              </div>
            </div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <label>Withholding (PPh)</label>
              {isCompany ? (
                <>
                  <select value={pph} onChange={(e) => setPph(e.target.value)}>
                    {WHT_COMPANY.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                  <span className="vc-hint">
                    {pphRate
                      ? `Rate ${pphRate} — resolved from ${hasNpwp ? "the NPWP on file" : "no NPWP (higher rate applies)"}.`
                      : "Rate is fixed for this type."}
                  </span>
                </>
              ) : (
                <>
                  <select value="pph21" disabled>
                    <option value="pph21">PPh 21</option>
                  </select>
                  <span className="vc-hint">Individuals are always PPh 21 — the rate is chosen per invoice.</span>
                </>
              )}
            </div>
          </div>

          {/* Payment Terms & Credit */}
          <div className="form-sec card">
            <div className="form-sec-title">Payment Terms &amp; Credit</div>
            <div className="fg3">
              <div className="form-fld">
                <label>Payment Terms <span className="vc-req">*</span></label>
                <select value={top} onChange={(e) => setTop(e.target.value)}>
                  {TERM_OPTIONS.map((t) => <option key={t} value={t}>{termLabel(t)}</option>)}
                </select>
              </div>
              <div className="form-fld">
                <label>Credit Limit (IDR)</label>
                <input type="text" value={fmtCurrency(creditLimit)} onChange={(e) => setCreditLimit(e.target.value)} placeholder="50.000.000" style={{ fontFamily: "var(--font-mono)" }} />
                <span className="vc-hint">Leave blank for no limit</span>
              </div>
              <div className="form-fld">
                <label>Currency</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <label>AR Account <span className="vc-req">*</span></label>
              <select value={recon} onChange={(e) => setRecon(e.target.value)}>
                {AR_ACCT_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              <span className="vc-hint">AR control account this customer posts to</span>
            </div>
          </div>

          {/* Contact */}
          <div className="form-sec card">
            <div className="form-sec-title">Contact</div>
            <div className="ct-list">
              {contacts.map((c, i) => (
                <div className="ctcard" key={i}>
                  <div className="ctcard-head">
                    <div className="ctcard-lbl">
                      <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {c.primary ? "Primary Contact" : `Contact ${i + 1}`}
                    </div>
                    {c.primary ? (
                      <span className="primary-badge">Primary</span>
                    ) : (
                      <button className="btn-del-bank" onClick={() => delContact(i)} aria-label="Delete contact">
                        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    )}
                  </div>
                  <div className="fg2">
                    <div className="form-fld">
                      <label>Name <span className="vc-req">*</span></label>
                      <input type="text" value={c.name} onChange={(e) => updateContact(i, { name: e.target.value })} placeholder={c.primary ? "Primary contact name" : "Contact name"} />
                    </div>
                    {isCompany ? (
                      <div className="form-fld">
                        <label>Title</label>
                        <input type="text" value={c.title} onChange={(e) => updateContact(i, { title: e.target.value })} placeholder="Finance Manager" />
                      </div>
                    ) : <div />}
                  </div>
                  <div className="form-fld" style={{ marginTop: 8 }}>
                    <label>Phone <span className="vc-req">*</span></label>
                    <div className="phone-row">
                      <input type="tel" value={c.phone} onChange={(e) => updateContact(i, { phone: e.target.value })} placeholder="+62 812-3456-7890" style={{ fontFamily: "var(--font-mono)" }} />
                      <label className="wa-chk">
                        <input type="checkbox" checked={c.waSame} onChange={(e) => updateContact(i, { waSame: e.target.checked })} />
                        This number is also WhatsApp
                      </label>
                    </div>
                  </div>
                  <div className="fg2" style={{ marginTop: 8, marginBottom: 0 }}>
                    <div className="form-fld">
                      <label>Email <span className="vc-req">*</span></label>
                      <input type="email" value={c.email} onChange={(e) => updateContact(i, { email: e.target.value })} placeholder="name@company.co.id" />
                    </div>
                    {isCompany ? (
                      <div className="form-fld">
                        <label>Finance / AR Email</label>
                        <input type="email" value={c.emailFin} onChange={(e) => updateContact(i, { emailFin: e.target.value })} placeholder="finance@company.co.id" />
                        <span className="vc-hint">Dedicated inbox for invoices</span>
                      </div>
                    ) : <div />}
                  </div>
                </div>
              ))}
            </div>
            {isCompany && (
              <button className="btn-add-bank" onClick={addContact}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Contact
              </button>
            )}
          </div>

          {/* Internal Notes */}
          <div className="form-sec card">
            <div className="form-sec-title">Internal Notes</div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes about this customer (not visible to the customer)…" />
            </div>
          </div>

          {/* Relationship tier (customer.classify) */}
          {canClassify && (
            <div className="form-sec card">
              <div className="form-sec-title">Relationship tier</div>
              <div className="form-fld" style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: tier !== "standard" ? 10 : 0 }}>
                  {[
                    { k: "strategic", lbl: "Strategic", desc: "Relationship-sensitive — a key account to protect." },
                    { k: "standard",  lbl: "Standard",  desc: "Default. No special handling." },
                    { k: "at_risk",   lbl: "In Dispute", desc: "In active dispute — weigh carefully." },
                  ].map((t) => (
                    <button
                      type="button"
                      key={t.k}
                      onClick={() => setTier(t.k)}
                      title={t.desc}
                      style={{
                        padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
                        border: tier === t.k ? "1px solid var(--color-action)" : "1px solid var(--color-border-default)",
                        background: tier === t.k ? "var(--color-action-wash)" : "transparent",
                        color: tier === t.k ? "var(--color-action)" : "var(--color-text-secondary)",
                      }}
                    >
                      {t.lbl}
                    </button>
                  ))}
                </div>
                {tier !== "standard" && (
                  <textarea
                    value={tierNote}
                    onChange={(e) => setTierNote(e.target.value)}
                    maxLength={200}
                    rows={2}
                    placeholder="Reason for this tier (required) — e.g. anchor account, repeated late payment"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ap-foot">
        <span className="ap-hint">
          Saved as a <strong style={{ color: "var(--color-text-secondary)" }}>Draft</strong> — an approver confirms and activates it.
        </span>
        <button className="ap-btn" onClick={backToStep0}>Change Type</button>
        <button className="ap-btn-send" onClick={onSave} disabled={!canSubmit} title={npwpMatch ? "Resolve the duplicate NPWP first" : undefined}>
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          Create Draft
        </button>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
