import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useVendors } from "../state/VendorsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { initials, termLabel } from "../lib/format";
import "./invoice-create.css";
import "./vendor-create.css";

// ── New Vendor — manual creation (Vendor Master PRD, Flow B) ─────────────────
// Capability-gated per the Role & Permission engine: creating a vendor requires
// the `vendor.create` capability (AP Staff). Finance Manager is deliberately
// EXCLUDED (SoD rule #1 — onboarding a vendor AND paying it is the classic
// fake-vendor fraud), so the FM cannot create; they confirm/activate the draft
// on the Detail page. Manual creation always lands as DRAFT_PENDING.
//
// Field tiers (PRD Data Model, Decision 2):
//   T1 informational — anyone who can create (identity, category, contacts, notes)
//   T2 financial     — proposed here, Finance Manager confirms at activation
//   T3 bank account  — Finance-Manager-only; locked in the create flow

const CATEGORY_OPTIONS = [
  { v: "inventory", label: "Inventory — goods for resale" },
  { v: "expense", label: "Expense — operating costs" },
  { v: "service", label: "Service — professional services" },
];

// Two entity kinds only. Company (incl. PT / CV / UD / cooperative) is PKP and
// needs a Tax Invoice (Faktur Pajak); Individual is Non-PKP and doesn't.
const TYPE_OPTIONS = [
  { v: "company", label: "Company (PT / CV / UD)" },
  { v: "individual", label: "Individual" },
];

const TERM_OPTIONS = ["NET 7", "NET 14", "NET 15", "NET 30", "NET 45", "NET 60"];

// Withholding CHOICES for a Company — the user picks the type; the rate is
// resolved automatically from whether the vendor has an NPWP (see rateFor).
// Individual vendors are always PPh 21, with the rate chosen at Create Bill time.
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

const CURRENCY_OPTIONS = ["IDR", "USD", "SGD", "EUR"];

const RECON_OPTIONS = [
  { v: "2-1000", label: "2-1000 · Accounts Payable (default)" },
  { v: "2-1100", label: "2-1100 · AP — Trade" },
  { v: "2-1200", label: "2-1200 · AP — Accrued" },
];

function digitsOnly(s) {
  return (s || "").replace(/\D/g, "");
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.5l1.1 2.7L9.8 5l-2.7 0.8L6 8.5l-1.1-2.7L2.2 5l2.7-0.8L6 1.5z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  );
}

function blankBank() {
  return { name: "", branch: "", code: "", acc: "", holder: "", isDefault: true };
}

export default function VendorCreatePage() {
  const navigate = useNavigate();
  const { vendors, addVendor } = useVendors();
  const { user, hasCapability } = useCurrentUser();

  // Capabilities (source of truth = roles.js). vendor.create → AP Staff.
  const canCreateVendor = hasCapability("vendor.create");
  // Financial authority (Tier 2/3). FM holds ap.approve; AP Staff does not — so
  // on this AP-Staff create surface the bank section stays locked.
  const canFinancial = hasCapability("ap.approve");
  // Relationship tier is a vendor-master classification (vendor.classify) —
  // AP Staff (the creator) holds it, so it can be set at onboarding.
  const canClassify = hasCapability("vendor.classify");

  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [type, setType] = useState("company");
  const [address, setAddress] = useState("");

  const [npwp, setNpwp] = useState("");
  const [pph, setPph] = useState("none");
  const [dedupDismissed, setDedupDismissed] = useState(false);

  // PKP is derived from entity type: Company is PKP (needs Faktur Pajak),
  // Individual is Non-PKP. Not a user choice.
  const isCompany = type !== "individual";
  const pkp = isCompany ? "PKP" : "NON_PKP";
  // Individual withholding is always PPh 21 (rate set per bill); Company keeps
  // the chosen type. Switching to Individual pins PPh 21.
  const effectivePph = isCompany ? pph : "pph21";
  const hasNpwp = digitsOnly(npwp).length >= 6;
  const pphRate = rateFor(effectivePph, hasNpwp);
  function changeType(next) {
    setType(next);
    if (next === "individual") setPph("pph21");
    else if (pph === "pph21") setPph("none");
  }

  const [term, setTerm] = useState("NET 30");
  const [currency, setCurrency] = useState("IDR");
  const [recon, setRecon] = useState("2-1000");

  const [banks, setBanks] = useState([blankBank()]);

  const [contact, setContact] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
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

  // ── NPWP deduplication (PRD Zone 2) — runs as the NPWP is typed ───────────
  const npwpMatch = useMemo(() => {
    const d = digitsOnly(npwp);
    if (d.length < 6) return null;
    return vendors.find((v) => v.tax_id && digitsOnly(v.tax_id) === d) || null;
  }, [npwp, vendors]);

  // Name-similarity fallback when no NPWP is entered (lower-confidence).
  const nameMatch = useMemo(() => {
    const n = name.trim().toLowerCase();
    if (digitsOnly(npwp).length >= 6 || n.length < 6) return null;
    return vendors.find((v) => v.name.toLowerCase().includes(n) || n.includes(v.name.toLowerCase())) || null;
  }, [name, npwp, vendors]);

  const showDedup = !dedupDismissed && (npwpMatch || nameMatch);

  function updateBank(i, patch) {
    setBanks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function addBank() {
    setBanks((prev) => [...prev, { ...blankBank(), isDefault: prev.length === 0 }]);
  }
  function delBank(i) {
    setBanks((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setDefaultBank(i) {
    setBanks((prev) => prev.map((b, idx) => ({ ...b, isDefault: idx === i })));
  }

  const canSubmit =
    name.trim() && category &&
    npwp.trim() && (pkp === "PKP" || pkp === "NON_PKP") &&
    term && currency && recon &&
    contact.trim() && email.trim() && phone.trim() &&
    !npwpMatch;

  function onSave() {
    if (!canCreateVendor) return;
    if (!name.trim()) { showToast("Vendor name is required"); return; }
    if (!category) { showToast("Pick a category"); return; }
    if (!npwp.trim()) { showToast("NPWP is required"); return; }
    if (npwpMatch) { showToast("This NPWP already exists — resolve the duplicate first"); return; }
    if (pkp !== "PKP" && pkp !== "NON_PKP") { showToast("Set the PKP status"); return; }
    if (!term || !currency || !recon) { showToast("Complete the payment details"); return; }
    if (!contact.trim() || !email.trim() || !phone.trim()) { showToast("Primary contact name, email, and phone are required"); return; }
    if (tier !== "standard" && !tierNote.trim()) { showToast("Add a reason for the relationship tier"); return; }

    const validBanks = canFinancial ? banks.filter((b) => b.name && b.acc) : [];
    addVendor({
      code: code.trim(),
      name: name.trim(),
      legal_name: legalName.trim() || name.trim(),
      initials: initials(name.trim()),
      category,
      type,
      address: address.trim(),
      tax_id: npwp.trim(),
      pkp,
      pph: effectivePph,
      payment_terms: term,
      currency,
      acct: recon,
      banks: validBanks,
      contact: contact.trim(),
      contact_role: contactRole.trim(),
      phone: phone.trim(),
      email: email.trim(),
      notes: notes.trim(),
      relationship_tier: tier,
      relationship_tier_note: tier !== "standard" ? tierNote.trim() : "",
      source: "MANUAL",
    });
    showToast("Vendor created — active, pending approval ✓");
    setTimeout(() => navigate("/vendors"), 800);
  }

  // ── No capability: block the flow (reflects the role model) ───────────────
  if (!canCreateVendor) {
    return (
      <div className="addpage">
        <div className="ap-head">
          <button className="ap-close" onClick={() => navigate("/vendors")} aria-label="Back">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div className="ap-title">New Vendor</div>
        </div>
        <div className="vc-noaccess">
          <h2>You don't have permission to create vendors</h2>
          <p>
            Creating a vendor requires the <strong>Create Vendors</strong> permission, which your account
            ({user.name}) doesn't have. Vendor drafts are confirmed and activated separately from where
            they're created, so this permission is deliberately kept apart from approving and paying.
          </p>
          <button className="ap-btn-send" onClick={() => navigate("/vendors")}>Back to Vendors</button>
        </div>
        {toast && <div className="toast show">{toast}</div>}
      </div>
    );
  }

  const fmHint = (
    <span className="vc-fm-hint"><SparkIcon /> Proposed — confirmed before this vendor is activated</span>
  );

  return (
    <div className="addpage">
      {/* Header */}
      <div className="ap-head">
        <button className="ap-close" onClick={() => navigate("/vendors")} aria-label="Close">
          <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <div className="ap-title">New Vendor</div>
        <span className="vc-status">Active · Pending approval</span>
        <div className="ap-hint" style={{ flex: 1, marginLeft: 8 }}>
          Fields marked <span style={{ color: "var(--color-danger-text)" }}>*</span> are required
        </div>
      </div>

      {/* Body */}
      <div className="ap-s1" style={{ alignItems: "stretch", padding: "28px 24px 96px" }}>
        <div style={{ width: "100%", maxWidth: 680, margin: "0 auto" }}>

          <div className="vc-approval-note">
            <strong>Approval-gated:</strong> legal name, NPWP/NIK, PKP status, withholding, AP account, and the vendor bank account. A manager signs these off before the vendor can post or pay; later changes to any of them start a new approval cycle.
          </div>

          {/* 1 — Identity (Tier 1) */}
          <div className="form-sec card">
            <div className="form-sec-title">Identity</div>
            <div className="fg2">
              <div className="form-fld">
                <label>Vendor Code</label>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto (VND-0xx)" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }} />
                <span className="vc-hint">Leave blank to auto-generate</span>
              </div>
              <div className="form-fld">
                <label>Category <span className="vc-req">*</span></label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Pick a category…</option>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="form-fld" style={{ marginBottom: 10 }}>
              <label>Display Name <span className="vc-req">*</span></label>
              <input type="text" value={name} onChange={(e) => { setName(e.target.value); setDedupDismissed(false); }} placeholder="e.g. PT Maju Teknologi Indonesia" />
            </div>
            <div className="fg2">
              <div className="form-fld">
                <label>Legal Name</label>
                <input type="text" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Registered legal entity name" />
              </div>
              <div className="form-fld">
                <label>Entity Type</label>
                <select value={type} onChange={(e) => changeType(e.target.value)}>
                  {TYPE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                <span className="vc-hint">{isCompany ? "PKP · issues Tax Invoice (Faktur Pajak)" : "Non-PKP · no Faktur Pajak"}</span>
              </div>
            </div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <label>Address</label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Jl. Sudirman No. 123, Jakarta Selatan 12190" rows={2} />
            </div>
          </div>

          {/* 2 — Tax & Compliance (Tier 2, proposed) */}
          <div className="form-sec card">
            <div className="form-sec-title">Tax &amp; Compliance</div>
            <div className="form-fld" style={{ marginBottom: showDedup ? 6 : 12 }}>
              <label>{isCompany ? "NPWP (Tax ID)" : "NIK / NPWP"} <span className="vc-req">*</span></label>
              <input
                type="text"
                value={npwp}
                onChange={(e) => { setNpwp(e.target.value); setDedupDismissed(false); }}
                placeholder="12.345.678.9-001.000"
                style={{ fontFamily: "var(--font-mono)" }}
              />
              <span className="vc-hint">Checked against your vendor master as you type · sets the withholding rate</span>
            </div>

            {showDedup && (
              <div className="vc-dedup">
                <div className="vc-dedup-title"><SparkIcon /> {npwpMatch ? "Possible duplicate — NPWP match" : "Possible duplicate — name match"}</div>
                <div className="vc-dedup-body">
                  {npwpMatch ? (
                    <>
                      <strong>{npwpMatch.name}</strong> (NPWP {npwpMatch.tax_id}) already exists as{" "}
                      <strong>{npwpMatch.code}</strong>
                      {npwpMatch.lastTx ? <> — last transacted {npwpMatch.lastTx}</> : null}. Is this the same vendor?
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
                  <button className="vc-dedup-btn primary" onClick={() => { showToast(`Opening ${(npwpMatch || nameMatch).code}`); setTimeout(() => navigate("/vendors"), 500); }}>
                    Use existing vendor
                  </button>
                  <button className="vc-dedup-btn" onClick={() => setDedupDismissed(true)}>Different entity — proceed</button>
                  <button className="vc-dedup-btn" onClick={() => showToast("Merge flow is a Finance Manager action (demo)")}>Merge records</button>
                </div>
              </div>
            )}

            {/* PKP + Faktur Pajak are derived from entity type — not chosen here. */}
            <div className="form-fld" style={{ marginBottom: 14, marginTop: 4 }}>
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
                  <span className="vc-hint">Individuals are always PPh 21 — the rate is chosen per bill.</span>
                </>
              )}
              {fmHint}
            </div>
          </div>

          {/* 3 — Payment (Tier 2, proposed) */}
          <div className="form-sec card">
            <div className="form-sec-title">Payment</div>
            <div className="fg2">
              <div className="form-fld">
                <label>Payment Terms <span className="vc-req">*</span></label>
                <select value={term} onChange={(e) => setTerm(e.target.value)}>
                  {TERM_OPTIONS.map((t) => <option key={t} value={t}>{termLabel(t)}</option>)}
                </select>
              </div>
              <div className="form-fld">
                <label>Currency <span className="vc-req">*</span></label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <label>Reconciliation Account <span className="vc-req">*</span></label>
              <select value={recon} onChange={(e) => setRecon(e.target.value)}>
                {RECON_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
              {fmHint}
            </div>
          </div>

          {/* 4 — Bank Account (Tier 3 — Finance Manager only) */}
          <div className="form-sec card">
            <div className="form-sec-title">Bank Account</div>
            {canFinancial ? (
              <>
                <div className="bank-list">
                  {banks.map((b, i) => (
                    <div key={i} className="bank-entry">
                      <div className="bank-entry-head">
                        <span className="bank-entry-num">Account #{i + 1}</span>
                        <label className="bank-default-toggle">
                          <input type="radio" name="defaultBank" checked={b.isDefault} onChange={() => setDefaultBank(i)} />
                          <span>Default</span>
                        </label>
                        {banks.length > 1 && (
                          <button className="btn-del-bank" onClick={() => delBank(i)} aria-label="Remove account">
                            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                          </button>
                        )}
                      </div>
                      <div className="fg2">
                        <div className="form-fld">
                          <label>Bank</label>
                          <input type="text" value={b.name} onChange={(e) => updateBank(i, { name: e.target.value })} placeholder="BCA / Mandiri / BNI / BRI…" />
                        </div>
                        <div className="form-fld">
                          <label>Bank Code (BI)</label>
                          <input type="text" value={b.code} onChange={(e) => updateBank(i, { code: e.target.value })} placeholder="014" style={{ fontFamily: "var(--font-mono)" }} />
                        </div>
                      </div>
                      <div className="fg2" style={{ marginBottom: 0 }}>
                        <div className="form-fld">
                          <label>Account No.</label>
                          <input type="text" value={b.acc} onChange={(e) => updateBank(i, { acc: e.target.value })} placeholder="123-456-7890" style={{ fontFamily: "var(--font-mono)" }} />
                        </div>
                        <div className="form-fld">
                          <label>Account Holder</label>
                          <input type="text" value={b.holder} onChange={(e) => updateBank(i, { holder: e.target.value })} placeholder="Registered account name" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="btn-add-bank" onClick={addBank}>
                  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add Bank Account
                </button>
              </>
            ) : (
              <div className="vc-lock">
                <LockIcon />
                <div>
                  <strong>You don't have permission to add a bank account.</strong> Bank details are the most common
                  payment-fraud vector, so adding one is a separate permission from onboarding a vendor. This draft is
                  created without a bank account — it's added at confirmation by someone who holds that permission.
                </div>
              </div>
            )}
          </div>

          {/* 5 — Primary Contact (Tier 1) */}
          <div className="form-sec card">
            <div className="form-sec-title">Primary Contact</div>
            <div className="fg2">
              <div className="form-fld">
                <label>Contact Name <span className="vc-req">*</span></label>
                <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="PIC name" />
              </div>
              <div className="form-fld">
                <label>Role</label>
                <input type="text" value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="AP contact / Account manager" />
              </div>
            </div>
            <div className="fg2" style={{ marginBottom: 0 }}>
              <div className="form-fld">
                <label>Email <span className="vc-req">*</span></label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@vendor.com" />
              </div>
              <div className="form-fld">
                <label>Phone <span className="vc-req">*</span></label>
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62-21-1234-5678" />
              </div>
            </div>
          </div>

          {/* 6 — Internal Notes (Tier 1) */}
          <div className="form-sec card">
            <div className="form-sec-title">Internal Notes</div>
            <div className="form-fld" style={{ marginBottom: 0 }}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contract terms, special handling, context for whoever confirms this vendor…" rows={3} />
            </div>
          </div>

          {/* 7 — Relationship tier (vendor.classify) */}
          {canClassify && (
            <div className="form-sec card">
              <div className="form-sec-title">Relationship tier</div>
              <div className="form-fld" style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: tier !== "standard" ? 10 : 0 }}>
                  {[
                    { k: "strategic", lbl: "Strategic", desc: "Relationship-sensitive — prioritize on-time payment." },
                    { k: "standard",  lbl: "Standard",  desc: "Default. No special handling." },
                    { k: "at_risk",   lbl: "At-Risk",   desc: "Disputes or slow responses — weigh when sequencing payments." },
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
                    placeholder="Reason for this tier (required) — e.g. renewal leverage, repeated disputes"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="ap-foot">
        <span className="ap-hint">
          Created <strong style={{ color: "var(--color-text-secondary)" }}>Active</strong> and usable — a manager approves it before it can post or pay.
        </span>
        <button className="ap-btn" onClick={() => navigate("/vendors")}>Cancel</button>
        <button className="ap-btn-send" onClick={onSave} disabled={!canSubmit} title={npwpMatch ? "Resolve the duplicate NPWP first" : undefined}>
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
          Create Vendor
        </button>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
