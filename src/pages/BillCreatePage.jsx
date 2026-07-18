import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { useVendors } from "../state/VendorsContext";
import { formatDate, initials } from "../lib/format";
import { previewJournalLines } from "../lib/billJournalPreview";
import { computeBillFlags } from "../lib/reviewWorkflow";
import { TODAY } from "../lib/clock";
import "./modules.css";
import "./invoice-create.css";
import "./bill-detail.css";

// Demo CoA used by the line-item account picker. In production this would
// come from the entity's chart of accounts API. The accounts here match what
// the bills seed actually uses, so the Tier 1/2 suggestion engine never
// surfaces an account that isn't in the dropdown.
const EXPENSE_ACCOUNTS = [
  { code: "1-3100", name: "Raw Materials" },
  { code: "1-3300", name: "Finished Goods" },
  { code: "1-6300", name: "Office Equipment" },
  { code: "6-1000", name: "Expenses Pembelian" },
  { code: "6-1200", name: "Marketing & Advertising" },
  { code: "6-2300", name: "Office Rent" },
  { code: "6-2400", name: "Office Utilities" },
  { code: "6-2500", name: "Office Supplies" },
  { code: "6-2600", name: "Software Subscriptions" },
  { code: "6-2700", name: "Professional Services" },
  { code: "6-3100", name: "Postage & Courier" },
  { code: "6-3200", name: "Repairs & Maintenance" },
];
const ACCOUNT_NAME_BY_CODE = Object.fromEntries(EXPENSE_ACCOUNTS.map((a) => [a.code, a.name]));

// ─── Three-tier account suggestion (PRD Zone 3) ─────────────────────────────
// Tier 1 — vendor history: most-used account for this vendor (with a 5×
//          boost when current row's description overlaps a prior item's
//          description). Blue chip, one-tap apply.
// Tier 2 — description inference: keyword → account map. Yellow chip,
//          one-tap apply, softer language.
// Tier 3 — category guidance: vendor.category → account range. Grey chip,
//          informational only, not directly applicable.

const DESCRIPTION_RULES = [
  { match: ["konsultasi", "konsultan", "audit", "jasa hukum", "legal", "strategis"],                acct: "6-2700" },
  { match: ["sewa", "rent", "ruang kantor", "biaya sewa"],                                          acct: "6-2300" },
  { match: ["panel", "lcd", "monitor 27", "komponen elektronik", "bahan baku", "kayu", "tekstil"],  acct: "1-3100" },
  { match: ["meja", "kursi", "furnitur", "furniture", "printer", "scanner", "komputer", "peripheral", "ac ", "pendingin", "telepon"], acct: "1-6300" },
  { match: ["logistik", "kirim", "ekspedisi", "pengiriman", "courier", "postage", "paket"],         acct: "6-3100" },
  { match: ["iklan", "marketing", "endorsement", "brosur", "banner", "event"],                       acct: "6-1200" },
  { match: ["internet", "listrik", "air", "utility", "tagihan air", "wifi"],                         acct: "6-2400" },
  { match: ["atk", "alat tulis", "kertas", "office supplies", "stationery", "peralatan tulis"],     acct: "6-2500" },
  { match: ["software", "saas", "subscription", "cloud", "hosting", "lisensi", "tools developer"],   acct: "6-2600" },
  { match: ["renovasi", "maintenance", "perbaikan", "repair", "cat ", "plamir"],                     acct: "6-3200" },
];

const CATEGORY_RANGES = {
  inventory: { codes: ["1-3100", "1-3300", "1-6300"],            label: "1-3xxx to 1-6xxx (inventory & assets)" },
  service:   { codes: ["6-2700", "6-3100", "6-1200"],            label: "6-1xxx to 6-3xxx (service expenses)" },
  expense:   { codes: ["6-2300", "6-2400", "6-2500", "6-2600", "6-3200"], label: "6-2xxx to 6-3xxx (operating expenses)" },
};

function suggestAccount(description, vendor, allBills) {
  const desc = (description || "").toLowerCase().trim();
  const descWords = desc.split(/\s+/).filter((w) => w.length >= 4);

  // Tier 1 — vendor history. When the description is non-empty, only fire
  // if the description matches a prior item's description (so "Jasa
  // Konsultasi" on an electronics vendor doesn't get nudged toward Raw
  // Materials just because that's what the vendor mostly bills). When the
  // description is empty (new blank row), fall back to the vendor's
  // overall most-used account.
  if (vendor) {
    const vendorBills = allBills.filter((b) => b.vendor === vendor.id);
    if (vendorBills.length > 0) {
      if (desc) {
        // Description-matched history only
        const counts = {};
        for (const b of vendorBills) {
          for (const it of b.items || []) {
            if (!it.acct) continue;
            const itDesc = (it.desc || "").toLowerCase();
            if (descWords.some((w) => itDesc.includes(w))) {
              counts[it.acct] = (counts[it.acct] || 0) + 1;
            }
          }
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (sorted.length) {
          const acct = sorted[0][0];
          const matchCount = sorted[0][1];
          return {
            tier: 1,
            acct,
            name: ACCOUNT_NAME_BY_CODE[acct] || "",
            sentence: `Matches ${matchCount} prior item${matchCount === 1 ? "" : "s"} from this vendor`,
          };
        }
        // No description match → fall through to Tier 2
      } else {
        // Empty description — overall most-used for this vendor
        const counts = {};
        for (const b of vendorBills) {
          for (const it of b.items || []) {
            if (!it.acct) continue;
            counts[it.acct] = (counts[it.acct] || 0) + 1;
          }
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (sorted.length) {
          const acct = sorted[0][0];
          const usedBills = vendorBills.filter((b) => (b.items || []).some((it) => it.acct === acct));
          return {
            tier: 1,
            acct,
            name: ACCOUNT_NAME_BY_CODE[acct] || "",
            sentence: `Used on ${usedBills.length} previous invoice${usedBills.length === 1 ? "" : "s"} from this vendor`,
          };
        }
      }
    }
  }

  // Tier 2 — description inference (only when description has content)
  if (desc) {
    for (const rule of DESCRIPTION_RULES) {
      if (rule.match.some((kw) => desc.includes(kw))) {
        return {
          tier: 2,
          acct: rule.acct,
          name: ACCOUNT_NAME_BY_CODE[rule.acct] || "",
          sentence: `'${description}' commonly posts to ${ACCOUNT_NAME_BY_CODE[rule.acct] || rule.acct}`,
        };
      }
    }
  }

  // Tier 3 — category guidance
  if (vendor?.category && CATEGORY_RANGES[vendor.category]) {
    const cat = CATEGORY_RANGES[vendor.category];
    return {
      tier: 3,
      sentence: `${vendor.name} is categorised as ${vendor.category} — typically ${cat.label}`,
    };
  }

  return null;
}

const PPH_OPTIONS = [
  { v: "none",       label: "No withholding",                 rate: 0    },
  { v: "pph23_2",    label: "PPh 23 — 2% (service / sewa)",   rate: 0.02 },
  { v: "pph23_15",   label: "PPh 23 — 15% (dividen / bunga)", rate: 0.15 },
  { v: "pph4_final", label: "PPh 4(2) Final — konstruksi",    rate: 0.02 },
];

function fmtNum(n) {
  if (!n) return "0";
  return Number(n).toLocaleString("id-ID");
}

// ── Date helpers ─────────────────────────────────────────────────────────────
// Defaults derive from the demo clock (TODAY) instead of hardcoded 2025 dates.
// Uses local getters (TODAY is local midnight) to avoid a UTC off-by-one.
function toISODate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function addDays(iso, n) {
  const x = new Date(iso + "T00:00:00");
  x.setDate(x.getDate() + n);
  return toISODate(x);
}
function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoA + "T00:00:00") - new Date(isoB + "T00:00:00")) / 86400000);
}
// Parse "NET 30" → 30 days; falls back to 30 when unparseable.
function termDays(terms) {
  const m = String(terms || "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 30;
}
const TODAY_ISO = toISODate(TODAY);

function CheckSvg() {
  return <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>;
}

// ─── Vendor combobox ────────────────────────────────────────────────────────
// Search-by-name picker with avatar + payment-terms hint. Includes a
// "Create new vendor: <query>" option at the bottom when the search has
// content and no exact match — per PRD Zone 4, that's the entry point into
// the inline-create overlay.

function VendorCombobox({ value, onChange, vendors, onRequestCreate }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = vendors.find((v) => v.id === value);
  const q = search.toLowerCase().trim();
  // Vendor field accepts name (fuzzy), NPWP, and vendor code — PRD Zone 2.
  const list = vendors.filter(
    (v) =>
      !q ||
      v.name.toLowerCase().includes(q) ||
      (v.contact || "").toLowerCase().includes(q) ||
      (v.tax_id || "").toLowerCase().includes(q) ||
      (v.code || "").toLowerCase().includes(q),
  );
  // Show the "Create new vendor" affordance when the user has typed a query
  // and no vendor exactly matches that name (case-insensitive).
  const exactMatch = q && vendors.some((v) => v.name.toLowerCase() === q);
  const offerCreate = q.length >= 2 && !exactMatch;

  return (
    <div className="cust-combo" ref={ref}>
      <button type="button" className={`cust-combo-btn${open ? " open" : ""}`} onClick={() => setOpen(!open)}>
        {selected ? (
          <>
            <span className="cust-combo-name">{selected.name}</span>
            <span className="cust-combo-addr">{selected.address}</span>
          </>
        ) : (
          <span className="cust-combo-placeholder">Pick vendor…</span>
        )}
        <svg className="cust-combo-chev" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="cust-combo-pop">
          <div className="cust-combo-search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, NPWP, or vendor code…" autoFocus />
          </div>
          <div className="cust-combo-list">
            {list.length === 0 && <div className="cust-combo-empty">No vendor matches</div>}
            {list.map((v) => (
              <div
                key={v.id}
                className={`cust-combo-item${value === v.id ? " selected" : ""}`}
                onClick={() => { onChange(v.id); setOpen(false); setSearch(""); }}
              >
                <div className="cust-combo-item-av">{initials(v.name)}</div>
                <div className="cust-combo-item-body">
                  <div className="cust-combo-item-name">{v.name}</div>
                  <div className="cust-combo-item-addr">{v.contact} · {v.payment_terms}</div>
                </div>
              </div>
            ))}
            {offerCreate && onRequestCreate && (
              <button
                type="button"
                className="cust-combo-create"
                onClick={() => { onRequestCreate(search.trim()); setOpen(false); setSearch(""); }}
              >
                <svg viewBox="0 0 24 24" aria-hidden><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Create new vendor: <strong>"{search.trim()}"</strong></span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline Vendor Creation Panel (PRD Zone 4) ──────────────────────────────
// Side-panel overlay invoked from the vendor dropdown when the FM searches
// for a vendor that doesn't exist yet. Per PRD: name + NPWP + PPh category
// are required before confirming. NPWP deduplication runs as the FM types.
// On confirm, the new vendor is added via VendorsContext.addVendor, focus
// returns to the bill form, and the new vendor is pre-selected so the
// classification cascade fires immediately.

const VENDOR_TYPE_OPTIONS = [
  { v: "company",     label: "PT / Limited Company" },
  { v: "cv",          label: "CV" },
  { v: "cooperative", label: "Koperasi" },
  { v: "individual",  label: "Individual / Sole Proprietor" },
];

const PKP_OPTIONS = [
  { v: "PKP",     label: "PKP (Pengusaha Kena Pajak)" },
  { v: "NON_PKP", label: "Non-PKP" },
];

const PPH_CATEGORY_OPTIONS = [
  { v: "none",       label: "None — no withholding" },
  { v: "pph23_2",    label: "PPh 23 · 2% (service / sewa)" },
  { v: "pph23_15",   label: "PPh 23 · 15% (dividen / bunga)" },
  { v: "pph4_final", label: "PPh 4(2) Final · 2% (konstruksi)" },
];

function InlineVendorCreatePanel({ initialName, vendors, onCancel, onConfirm }) {
  const [name,   setName]   = useState(initialName || "");
  const [npwp,   setNpwp]   = useState("");
  const [type,   setType]   = useState("company");
  const [pkp,    setPkp]    = useState("PKP");
  const [pph,    setPph]    = useState("none");
  const [pphTouched, setPphTouched] = useState(false);

  // Run NPWP dedup against existing vendors as the user types. We don't
  // normalize beyond trim because Indonesian NPWPs have a canonical
  // 15-digit dotted format that's distinctive enough.
  const npwpDupe = npwp.trim().length > 0 && vendors.some((v) => v.tax_id && v.tax_id === npwp.trim());

  const canConfirm = name.trim().length >= 2 && npwp.trim().length > 0 && !npwpDupe && pphTouched;

  function confirm() {
    if (!canConfirm) return;
    onConfirm({
      name:   name.trim(),
      tax_id: npwp.trim(),
      type,
      pkp,
      pph,
      category: type === "service" ? "service" : (pkp === "PKP" ? "expense" : "inventory"),
    });
  }

  return (
    <>
      <div className="bd-overlay" onClick={onCancel} />
      <div className="bd-modal vendor-create-modal">
        <div className="bd-modal-head">
          <div>
            <div className="bd-modal-title">Create new vendor</div>
            <div className="bd-modal-sub">Required fields only. The vendor is saved as a <strong>pending draft</strong> — a manager approves it and adds the bank account in Vendor Master before this bill can be posted or paid.</div>
          </div>
          <button className="bd-modal-close" onClick={onCancel} aria-label="Close">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="bd-modal-body">
          <div className="form-fld">
            <label>Vendor name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PT Sumber Alam" autoFocus />
          </div>

          <div className="form-fld">
            <label>NPWP *</label>
            <input
              type="text"
              value={npwp}
              onChange={(e) => setNpwp(e.target.value)}
              placeholder="12.345.678.9-001.000"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            {npwpDupe && (
              <div className="bd-rule-note" style={{ color: "var(--color-danger-text)" }}>
                This NPWP is already used by another vendor — pick the existing record instead.
              </div>
            )}
            {!npwp && (
              <div className="bd-rule-note">Required so we can classify and post bills correctly.</div>
            )}
          </div>

          <div className="fg2">
            <div className="form-fld">
              <label>Vendor type</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {VENDOR_TYPE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-fld">
              <label>PKP status</label>
              <select value={pkp} onChange={(e) => setPkp(e.target.value)}>
                {PKP_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-fld">
            <label>PPh withholding category *</label>
            <select
              value={pph}
              onChange={(e) => { setPph(e.target.value); setPphTouched(true); }}
            >
              {!pphTouched && <option value="" disabled>Choose one…</option>}
              {PPH_CATEGORY_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            <div className="bd-rule-note">
              Required so bills posted to this vendor never carry an unknown PPh category. You can change this later in Vendor Master.
            </div>
          </div>
        </div>
        <div className="bd-modal-foot">
          <button className="bd-modal-btn ghost" onClick={onCancel}>Cancel</button>
          <button className="bd-modal-btn primary" onClick={confirm} disabled={!canConfirm}>
            Create &amp; select vendor
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Plain-language tax sentences (PRD Zone 5) ──────────────────────────────
// Triggered by vendor selection. No raw scores, no codes — sentence form
// only, exactly as the FM would read them aloud.

function ppnSentence(vendor) {
  if (!vendor) return "Pick a vendor above to see PPN treatment.";
  if (vendor.pkp === "PKP")     return `PPN 11% applied — ${vendor.name} is PKP (confirmed in vendor master).`;
  if (vendor.pkp === "NON_PKP") return `PPN not applicable — ${vendor.name} is Non-PKP, no VAT collectable.`;
  return `PKP status unknown for ${vendor.name} — PPN applicability cannot be determined. Set PKP status before posting.`;
}

function pphSentence(vendor) {
  if (!vendor) return "Pick a vendor above to see PPh withholding rules.";
  const entity = vendor.type === "company" ? "corporate entity"
              : vendor.type === "cooperative" ? "cooperative"
              : vendor.type === "individual" ? "individual"
              : "domestic vendor";
  if (vendor.pph === "pph23_2")    return `PPh 23 at 2% will be withheld — service / sewa vendor, domestic, ${entity}.`;
  if (vendor.pph === "pph23_15")   return `PPh 23 at 15% will be withheld — dividen / bunga vendor, ${entity}.`;
  if (vendor.pph === "pph4_final") return `PPh 4(2) Final at 2% will be withheld — konstruksi vendor.`;
  return `No PPh withholding — ${vendor.name} doesn't fall in any withholding category.`;
}

export default function BillCreatePage() {
  const navigate = useNavigate();
  const { addBill, bills } = useBills();
  const { vendors, addVendor } = useVendors();

  // Inline vendor creation state — opened from the vendor combobox when the
  // FM searches for a vendor that doesn't exist yet.
  const [createVendorOpen, setCreateVendorOpen] = useState(false);
  const [createVendorSeedName, setCreateVendorSeedName] = useState("");

  // Single-page form. Scanning is a transient overlay state, not a wizard
  // step — manual entry fields stay visible underneath while the OCR sim
  // runs. Per the Create New Bill PRD: "Upload zone is the visual primary
  // action … manual entry fields are visible below but visually secondary."
  const [scanning, setScanning] = useState(false);
  const [scanPhase, setScanPhase] = useState(0);
  const [aiFilled, setAiFilled] = useState(false);
  // Entry gate: on a fresh Create Bill, uploading is the primary action shown
  // in a focused popup. The escape link drops into manual entry (attach a
  // document later). Per PRD Zone 1 / Entry State 1.
  const [uploadGateOpen, setUploadGateOpen] = useState(true);
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  // Form state
  const [vendorId, setVendorId] = useState("");
  const [poNo, setPoNo] = useState("");
  const [invNo, setInvNo] = useState("");
  const [date, setDate] = useState(TODAY_ISO);
  const [due, setDue] = useState(addDays(TODAY_ISO, 30));
  const [keterangan, setDescription] = useState("");
  const [items, setItems] = useState([]); // {desc,qty,price,acct}
  const [ppnRate, setPpnRate] = useState(0.11);
  const [pphChoice, setPphChoice] = useState("none");
  const [fakturPajak, setFakturPajak] = useState("");
  const [attachments, setAttachments] = useState([]);

  // Exception engine state: per-field OCR confidence (from the scan), the set
  // of review/advisory exceptions the user has resolved, and the no-document
  // justification modal.
  const [ocrConfidence, setOcrConfidence] = useState({}); // { invNo:'red', date:'yellow' }
  const [resolvedFx, setResolvedFx] = useState({});        // { [exceptionId]: true }
  const [noDocOpen, setNoDocOpen] = useState(false);
  const [noDocJustification, setNoDocJustification] = useState("");
  // Exceptions panel is grouped by tier; advisory folds away by default to keep
  // a long list scannable.
  const [foldedTiers, setFoldedTiers] = useState({ blocking: false, review: false, advisory: true });
  // Entry mode (PRD): Simple = single total + one account (default); Detailed =
  // line-item table. Both write to the same `items` array so totals/GL/save are
  // one code path.
  const [entryMode, setEntryMode] = useState("simple");

  const vendor = useMemo(() => vendors.find((v) => v.id === vendorId), [vendors, vendorId]);

  function handleRequestCreateVendor(name) {
    setCreateVendorSeedName(name || "");
    setCreateVendorOpen(true);
  }
  function handleCreateVendor(draft) {
    const record = addVendor(draft);
    setCreateVendorOpen(false);
    setCreateVendorSeedName("");
    setVendorId(record.id);
    showToast(`${record.name} created as a pending draft · a manager approves it & adds the bank before this bill can post.`);
  }
  function handleCancelCreateVendor() {
    setCreateVendorOpen(false);
    setCreateVendorSeedName("");
  }

  // Vendor cascade — PRD Zone 2. When the FM picks a vendor (or the OCR
  // assigns one), pre-fill PPh / PPN from the vendor master. Faktur Pajak
  // clears for Non-PKP vendors. User can still override the dropdowns
  // afterward; this just makes the default match the vendor master.
  const prevVendorIdRef = useRef(null);
  useEffect(() => {
    if (prevVendorIdRef.current === vendorId) return;
    prevVendorIdRef.current = vendorId;
    // Re-evaluate exceptions against the newly selected vendor.
    setResolvedFx({});
    if (!vendor) return;
    setPpnRate(vendor.pkp === "PKP" ? 0.11 : 0);
    setPphChoice(vendor.pph || "none");
    if (vendor.pkp !== "PKP") setFakturPajak("");
    // Due date from vendor payment terms — PRD "Due Date (from terms)".
    setDue(addDays(date, termDays(vendor.payment_terms)));
  }, [vendor, vendorId]);

  // Per-row account suggestions — Tier 1/2/3 from suggestAccount(). Computed
  // at the component level (not inside the items map) so React hook rules
  // are happy. Recomputes whenever items, vendor, or bills change.
  const itemSuggestions = useMemo(
    () => items.map((it) => suggestAccount(it.desc, vendor, bills)),
    [items, vendor, bills],
  );

  // Default account for new rows: Tier 1 if vendor has history, otherwise
  // a generic expense bucket. Description-driven Tier 2 fires once the user
  // types into the new row.
  const defaultNewRowAcct = useMemo(() => {
    const s = suggestAccount("", vendor, bills);
    return s?.acct || "6-1000";
  }, [vendor, bills]);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2000);
  }

  // Simulated OCR — drops the user into Sub-flow A by pre-filling fields
  // from a known vendor anchor (V001). Phase 2 will swap this for a real
  // vendor cascade triggered by vendor selection; Phase F will replace the
  // A4 reconstruction on the right with the actual source PDF.
  function chooseUploadFromGate() { setUploadGateOpen(false); simulateScan(); }
  function skipToManualEntry()    { setUploadGateOpen(false); }

  function simulateScan() {
    setScanning(true);
    setScanPhase(0);
    setTimeout(() => setScanPhase(1), 1500);
    setTimeout(() => setScanPhase(2), 3000);
    setTimeout(() => prefillFromOcr(), 3700);
  }

  function prefillFromOcr() {
    setVendorId("V001");
    setPoNo("PO-2025-0006");
    setInvNo("");                       // OCR couldn't read the invoice number (red)
    setDate("2025-04-15");
    setDue("2025-05-15");
    setDescription("Pengadaan komponen elektronik Q2 — sesuai PO.");
    setItems([
      { desc: "Komponen Elektronik - Panel LCD 24 inch", qty: 50, price: 20000000, acct: "1-3100" },
    ]);
    setEntryMode("detailed");           // OCR extracted a line item
    setPpnRate(0.11);
    setPphChoice("none");
    setAttachments([{ name: "invoice_supplier_elektronik.pdf", size: "PDF · 2.4 MB", fromOCR: true }]);
    // Simulated extraction confidence: invoice number unreadable (red → blocking),
    // invoice date read with low confidence (yellow → review).
    setOcrConfidence({ invNo: "red", date: "yellow" });
    setResolvedFx({});
    setAiFilled(true);
    setScanning(false);
  }

  // Totals (all IDR).
  //   subtotal = sum of line items
  //   dpp      = subtotal               (taxable base)
  //   ppn      = dpp × ppnRate           (output VAT charged by vendor)
  //   pph      = dpp × pphRate           (income tax we withhold)
  //   total    = dpp + ppn               (gross invoice — matches seed)
  //   netPayable = total − pph           (what we actually transfer)
  const subtotal = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const dpp = subtotal;
  const ppn = Math.round(dpp * ppnRate);
  const pphRate = PPH_OPTIONS.find((o) => o.v === pphChoice)?.rate || 0;
  const pph = Math.round(dpp * pphRate);
  const total = dpp + ppn;
  const netPayable = total - pph;

  // ── Duplicate detection (PRD Zone 8) ────────────────────────────────────
  // Cheap subset: same vendor + exact invoice number. Falls back to same
  // vendor + near-identical amount (±10%) within 60 days when the invoice
  // number doesn't match — the PRD's amount/date signal.
  const duplicateMatch = useMemo(() => {
    if (!vendor) return null;
    const inv = invNo.trim().toLowerCase();
    const vendorBills = bills.filter((b) => b.vendor === vendor.id);
    if (inv && inv !== "—") {
      const exact = vendorBills.find((b) => (b.invNo || "").trim().toLowerCase() === inv);
      if (exact) return { bill: exact, reason: "same invoice number" };
    }
    if (total > 0) {
      const near = vendorBills.find(
        (b) => b.total && Math.abs(b.total - total) / b.total <= 0.1 && Math.abs(daysBetween(b.date, date)) <= 60,
      );
      if (near) return { bill: near, reason: "near-identical amount within 60 days" };
    }
    return null;
  }, [vendor, invNo, total, date, bills]);

  // ── Amount variance detection (PRD Zone 7) ──────────────────────────────
  // Flag when this bill's total deviates >15% from the vendor's rolling
  // 6-month average. Skipped when the vendor has <3 prior invoices in the
  // window (insufficient baseline).
  const variance = useMemo(() => {
    if (!vendor || total <= 0) return null;
    const anchor = date || TODAY_ISO;
    const windowStart = addDays(anchor, -183);
    const priors = bills.filter(
      (b) => b.vendor === vendor.id && b.total > 0 && b.date >= windowStart && b.date <= anchor,
    );
    if (priors.length < 3) return null;
    const avg = priors.reduce((s, b) => s + b.total, 0) / priors.length;
    const deviation = (total - avg) / avg;
    if (Math.abs(deviation) <= 0.15) return null;
    return { avg, deviation, multiple: total / avg, count: priors.length };
  }, [vendor, total, date, bills]);

  // Items handlers — new rows pick up the Tier 1 suggestion when vendor
  // history exists; otherwise fall back to a generic expense bucket.
  function addRow() {
    setItems((p) => [...p, { desc: "", qty: 1, price: 0, acct: defaultNewRowAcct }]);
  }
  function updateRow(i, patch)         { setItems((p) => p.map((it, idx) => (idx === i ? { ...it, ...patch } : it))); }
  function delRow(i)                   { setItems((p) => p.filter((_, idx) => idx !== i)); }
  function addAttach() {
    const names = ["po_vendor.pdf", "berita_acara.pdf", "faktur_pajak.pdf"];
    setAttachments((p) => [...p, { name: names[Math.floor(Math.random() * names.length)], size: "PDF · 1.1 MB", fromOCR: false }]);
  }
  function delAttach(i)                { setAttachments((p) => p.filter((_, idx) => idx !== i)); }

  // Simple-mode helpers — bind a single description + amount + account to
  // items[0]. The description feeds the same account-suggestion engine so
  // Tier-2 inference works even in Simple mode.
  function setSimpleDesc(d) {
    setItems((p) => [{ desc: d, qty: 1, price: p[0]?.price || 0, acct: p[0]?.acct || defaultNewRowAcct }]);
  }
  function setSimpleAmount(v) {
    setItems((p) => [{ desc: p[0]?.desc || "", qty: 1, price: v, acct: p[0]?.acct || defaultNewRowAcct }]);
  }
  function setSimpleAcct(a) {
    setItems((p) => [{ desc: p[0]?.desc || "", qty: 1, price: p[0]?.price || 0, acct: a }]);
  }
  function switchMode(mode) {
    if (mode === entryMode) return;
    if (mode === "simple" && items.length > 1) {
      if (!window.confirm("Switching to Simple mode will collapse your line items into a single amount. Continue?")) return;
      const sum = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
      setItems([{ desc: "Bill amount", qty: 1, price: sum, acct: items[0]?.acct || defaultNewRowAcct }]);
    }
    setEntryMode(mode);
  }

  // GL preview — same generator as Bill Detail so the two pages always
  // agree on what will post.
  const previewBill = useMemo(() => {
    return {
      total,
      dpp,
      ppn,
      pph23: pph,
      vendorName: vendor?.name || "",
      items: items.map((it) => {
        const acct = EXPENSE_ACCOUNTS.find((a) => a.code === it.acct);
        const sub  = (Number(it.qty) || 0) * (Number(it.price) || 0);
        return {
          desc:     it.desc,
          qty:      it.qty,
          price:    it.price,
          subtotal: sub,
          acct:     it.acct,
          acctName: acct?.name || "",
        };
      }),
    };
  }, [total, dpp, ppn, pph, vendor, items]);

  const { lines: jeLines, totalDr, totalCr, balanced, anyFlag } = useMemo(
    () => previewJournalLines(previewBill, vendor),
    [previewBill, vendor],
  );

  // ── Exception engine ────────────────────────────────────────────────────
  // Consolidates every check into one list shown at the top of the form, with
  // per-field highlighting. Severity → CTA: blocking = Fix; review = This is
  // correct / Fix; advisory = Acknowledge. Blocking clears when the condition
  // is fixed; review/advisory clear when acknowledged (or fixed).
  // Bill-record-shaped draft so the canonical review-flag engine
  // (reviewWorkflow.computeBillFlags) evaluates the in-progress bill the same
  // way it will on Bill Detail / Bills List after submit.
  const flagDraft = useMemo(() => ({
    id: "DRAFT",
    vendor: vendor?.id,
    vendorName: vendor?.name,
    poNo: poNo || "—",
    invNo: invNo || "—",
    date, due,
    dpp, ppn, pph23: pph, total,
    ppnRate,
    faktur_pajak: fakturPajak || undefined,
    grn: poNo ? "matched" : "pending",
    approval: "draft",
    anomalies: [],
    audit: [{ date }],
    items: items.map((it) => ({
      desc: it.desc,
      acct: it.acct,
      acctName: (EXPENSE_ACCOUNTS.find((a) => a.code === it.acct) || {}).name,
    })),
  }), [vendor, poNo, invNo, date, due, dpp, ppn, pph, total, ppnRate, fakturPajak, items]);

  const exceptions = useMemo(() => {
    const list = [];
    // Blocking — must be fixed before submit
    if (!vendor)
      list.push({ id: "no-vendor", severity: "blocking", field: "vendor", title: "Vendor not set", detail: "Select the vendor this invoice is from." });
    if (items.length === 0 || total <= 0)
      list.push({ id: "no-items", severity: "blocking", field: "items", title: "No line items", detail: "Add at least one line item with an amount." });
    if (ocrConfidence.invNo === "red" && !invNo.trim())
      list.push({ id: "ocr-invno", severity: "blocking", field: "invNo", title: "Invoice number couldn't be read", detail: "The scan was unreadable here — type the vendor's invoice number." });
    if (total > 0 && !balanced)
      list.push({ id: "gl-unbalanced", severity: "blocking", field: "gl", title: "GL preview is out of balance", detail: "Debits and credits don't match — check the line items and tax." });
    // Review — must be acknowledged or fixed
    if (duplicateMatch)
      list.push({ id: "duplicate", severity: "review", field: "invNo", title: "Possible duplicate", detail: `Invoice ${duplicateMatch.bill.invNo} from ${vendor?.name} for Rp ${fmtNum(duplicateMatch.bill.total)} already exists (${duplicateMatch.reason}).` });
    if (variance)
      list.push({ id: "variance", severity: "review", field: "items", title: "Amount looks unusual", detail: `Rp ${fmtNum(total)} is ${variance.deviation > 0 ? `${variance.multiple.toFixed(1)}× higher` : `${(1 / variance.multiple).toFixed(1)}× lower`} than this vendor's typical invoice (avg Rp ${fmtNum(Math.round(variance.avg))} across ${variance.count} bills).` });
    if (vendor && vendor.pkp !== "PKP" && vendor.pkp !== "NON_PKP")
      list.push({ id: "pkp-unknown", severity: "review", field: "vendor", title: "PKP status unknown", detail: "PPN applicability can't be determined until this vendor's PKP status is set." });
    if (attachments.length === 0)
      list.push({ id: "no-document", severity: "review", field: "attachments", title: "No source document", detail: "This bill has no attachment — attach one or record a justification." });
    if (ocrConfidence.date === "yellow")
      list.push({ id: "ocr-date", severity: "review", field: "date", title: "Invoice date read with low confidence", detail: "Confirm the invoice date matches the document." });
    // Advisory — informational, acknowledge to clear
    if (vendor && vendor.health && vendor.health !== "healthy")
      list.push({ id: "pph-health", severity: "advisory", field: "vendor", title: "PPh classification may be outdated", detail: `Verify ${vendor.name}'s withholding setup before posting.` });
    if (itemSuggestions.some((s) => s && (s.tier === 2 || s.tier === 3)))
      list.push({ id: "low-conf-acct", severity: "advisory", field: "items", title: "Account chosen from a weak signal", detail: "One or more account codes came from a description/category guess, not this vendor's history." });

    // ── Canonical review-flag engine (the flowchart) — run on the live draft so
    // the same Vendor / Transaction-risk / Tax checks that gate Bill Detail
    // surface here too. Time-based "side" monitors + post-submission flags are
    // excluded at create; duplicate / price-anomaly are handled live above.
    if (vendor) {
      const FIELD = { Vendor: "vendor", Tax: "tax", Documents: "attachments", "Transaction risk": "items", Workflow: "items" };
      const SKIP = new Set(["approval_stalled", "period_locked", "missing_document", "duplicate", "price_anomaly"]);
      for (const f of computeBillFlags(flagDraft, vendor, { autoAssignLateBills: true })) {
        if (f.side || SKIP.has(f.key)) continue;
        list.push({ id: `eng-${f.key}`, severity: f.severity.toLowerCase(), field: FIELD[f.category] || "items", title: f.label, detail: f.message });
      }
    }
    return list;
  }, [vendor, invNo, date, items, total, ppn, fakturPajak, attachments, balanced, duplicateMatch, variance, ocrConfidence, itemSuggestions, flagDraft]);

  const ackable = (sev) => sev === "review" || sev === "advisory";
  const activeExceptions = exceptions.filter((e) => !(ackable(e.severity) && resolvedFx[e.id]));

  const SEV_RANK = { blocking: 3, review: 2, advisory: 1 };
  const fieldFlags = useMemo(() => {
    const m = {};
    for (const e of activeExceptions) {
      if (!e.field) continue;
      if (!m[e.field] || SEV_RANK[e.severity] > SEV_RANK[m[e.field]]) m[e.field] = e.severity;
    }
    return m;
  }, [activeExceptions]);
  const flagClass = (field) => (fieldFlags[field] ? ` field-flag-${fieldFlags[field]}` : "");
  const blockingCount = activeExceptions.filter((e) => e.severity === "blocking").length;

  function resolveFx(id) { setResolvedFx((r) => ({ ...r, [id]: true })); }
  function toggleTier(t) { setFoldedTiers((f) => ({ ...f, [t]: !f[t] })); }
  function focusFx(field) {
    const el = document.querySelector(`[data-fx="${field}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const inp = el.querySelector("input, select, textarea, button");
    if (inp) setTimeout(() => inp.focus(), 320);
  }

  // Save. All amounts are IDR (the entity's functional currency).
  function buildDraft(approval) {
    if (!vendor) return null;
    return {
      vendor:            vendor.id,
      vendorName:        vendor.name,
      initials:          vendor.initials || initials(vendor.name),
      poNo,
      invNo,
      date,
      due,
      keterangan,
      dpp,
      ppn,
      pph23:             pph,
      total,                                   // IDR gross (DPP + PPN)
      sisa:              total,                // outstanding AP balance = gross
      netPayable,                              // display only — total − PPh withheld
      approval,
      grn:               poNo ? "matched" : "pending",
      faktur_pajak:      fakturPajak || undefined,
      no_document_flag:          attachments.length === 0,
      no_document_justification: attachments.length === 0 ? noDocJustification.trim() : "",
      items: items.map((it) => {
        const acct = EXPENSE_ACCOUNTS.find((a) => a.code === it.acct);
        const sub  = (Number(it.qty) || 0) * (Number(it.price) || 0);
        return {
          ...it,
          subtotal: sub,
          acctName: acct?.name || "",
        };
      }),
      fromAI: aiFilled,
    };
  }

  function onSaveDraft() {
    const draft = buildDraft("draft");
    if (!draft)             { showToast("Pick a vendor first"); return; }
    if (!items.length)      { showToast("Add at least 1 item"); return; }
    addBill(draft);
    showToast("Draft saved ✓");
    setTimeout(() => navigate("/bills"), 600);
  }

  function onSubmitForReview() {
    if (activeExceptions.length > 0) { showToast("Resolve the exceptions above first"); return; }
    finalizeSubmit("review");
  }

  function finalizeSubmit(approval) {
    const draft = buildDraft(approval);
    if (!draft) { showToast("Pick a vendor first"); return; }
    addBill(draft);
    setNoDocOpen(false);
    showToast(approval === "review" ? "Bill submitted for review ✓" : "Draft saved ✓");
    setTimeout(() => navigate("/bills"), 700);
  }

  // The no-document exception's "record a justification" path: capture the
  // reason, then mark that exception resolved.
  function confirmNoDoc() {
    if (noDocJustification.trim().length < 3) return;
    resolveFx("no-document");
    setNoDocOpen(false);
  }

  const canSaveDraft = vendor && items.length > 0 && total > 0;   // drafts allow open exceptions
  const canSubmit = canSaveDraft && activeExceptions.length === 0; // review requires all resolved

  // Simple-mode bindings (single row) + its account suggestion.
  const simpleItem = items[0] || { desc: "", qty: 1, price: 0, acct: defaultNewRowAcct };
  const simpleSuggestion = itemSuggestions[0];

  return (
    <div className={`bd-page bd-create${uploadGateOpen ? " gate-only" : ""}`}>
      {/* ── Header (mirrors Bill Detail) ──────────────────────────── */}
      <div className="bd-head">
        <button className="bd-back" onClick={() => navigate("/bills")}>← Bills</button>
        <div className="bd-head-main">
          <div className="drawer-av bill">{vendor ? (vendor.initials || initials(vendor.name)) : "+"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bd-title">{vendor?.name || "New Bill"}</div>
            <div className="bd-sub">
              <span>New bill</span>
              {invNo && (
                <>
                  <span className="bd-sub-sep">·</span>
                  <span className="bd-mono">{invNo}</span>
                </>
              )}
              <span className="bd-sub-sep">·</span>
              <span>Issued {formatDate(date)}</span>
            </div>
          </div>
          <div className="bd-head-total">
            <div className="bd-head-total-lbl">Total</div>
            <div className="bd-head-total-val">Rp {fmtNum(total)}</div>
          </div>
        </div>
      </div>

      {/* ── Two-panel body: document left, form right (mirrors Bill Detail) ── */}
      <div className="bd-main">
        {/* Form side (right) */}
        <div className="bd-form">
          <div className="bd-form-body">
          {/* Upload is a focused entry gate (modal below). After skipping, this
              slim affordance re-opens it to auto-fill from a document. */}
          {!aiFilled && (
            <button type="button" className="upload-reopen" onClick={() => setUploadGateOpen(true)}>
              <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Upload an invoice to auto-fill fields
            </button>
          )}

          {aiFilled && (
            <div className="ai-fill-banner">
              <div className="ai-fill-banner-title">
                <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "currentColor" }}><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
                Auto-filled from the uploaded invoice
              </div>
              <div className="ai-fill-banner-sub">Review each field below before submitting — flagged fields will surface on the Bill Detail page after submit.</div>
            </div>
          )}

          {/* ── Exceptions panel (top of page) — grouped & foldable by tier ───
              Blocking = Fix; Need Review = This is correct / Fix; Advisory =
              Acknowledge. Each row also highlights its field. */}
          {activeExceptions.length > 0 && (
            <div className="fx-panel">
              <div className="fx-panel-head">
                <span className="fx-panel-count">
                  {activeExceptions.length} exception{activeExceptions.length === 1 ? "" : "s"} to resolve
                </span>
                {blockingCount > 0 && <span className="fx-panel-blocking">{blockingCount} blocking</span>}
              </div>
              {[
                { key: "blocking", label: "Blocking" },
                { key: "review", label: "Need Review" },
                { key: "advisory", label: "Advisory" },
              ].map((tier) => {
                const rows = activeExceptions.filter((e) => e.severity === tier.key);
                if (rows.length === 0) return null;
                const folded = foldedTiers[tier.key];
                return (
                  <div className="fx-tier" key={tier.key}>
                    <button type="button" className="fx-tier-head" onClick={() => toggleTier(tier.key)} aria-expanded={!folded}>
                      <span className={`fx-dot ${tier.key}`} aria-hidden />
                      <span className="fx-tier-label">{tier.label}</span>
                      <span className="fx-tier-count">{rows.length}</span>
                      <svg className={`fx-tier-chev${folded ? " folded" : ""}`} viewBox="0 0 24 24" aria-hidden><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    {!folded && rows.map((e) => (
                      <div key={e.id} className="fx-row">
                        <div className="fx-body">
                          <div className="fx-title">{e.title}</div>
                          <div className="fx-detail">{e.detail}</div>
                        </div>
                        <div className="fx-actions">
                          {e.severity === "blocking" && (
                            <button type="button" className="fx-btn primary" onClick={() => focusFx(e.field)}>Fix</button>
                          )}
                          {e.severity === "review" && (
                            <>
                              <button type="button" className="fx-btn" onClick={() => (e.id === "no-document" ? setNoDocOpen(true) : resolveFx(e.id))}>This is correct</button>
                              <button type="button" className="fx-btn primary" onClick={() => focusFx(e.field)}>Fix</button>
                            </>
                          )}
                          {e.severity === "advisory" && (
                            <button type="button" className="fx-btn" onClick={() => resolveFx(e.id)}>Acknowledge</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Bill Information */}
          <div className="form-sec card">
            <div className="form-sec-title">Bill Information</div>
            <div className="fg2">
              <div className={`form-fld${flagClass("vendor")}`} data-fx="vendor">
                <label>Vendor</label>
                <VendorCombobox
                  value={vendorId}
                  onChange={setVendorId}
                  vendors={vendors}
                  onRequestCreate={handleRequestCreateVendor}
                />
                {vendor && vendor.status === "pending" && (
                  <div className="bd-rule-note" style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "flex-start", fontStyle: "normal", color: "#6B4F00" }}>
                    <span aria-hidden>⏳</span>
                    <span>Pending vendor — a manager must approve it and add the bank in Vendor Master before this bill can be posted or paid.</span>
                  </div>
                )}
              </div>
              <div className={`form-fld${flagClass("invNo")}`} data-fx="invNo">
                <label>Vendor Invoice No.</label>
                <input
                  type="text"
                  value={invNo}
                  onChange={(e) => { setInvNo(e.target.value); if (ocrConfidence.invNo) setOcrConfidence((c) => ({ ...c, invNo: undefined })); }}
                  placeholder="Vendor's invoice number"
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              </div>
            </div>
            <div className="fg3">
              <div className={`form-fld${flagClass("date")}`} data-fx="date">
                <label>Invoice Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => { setDate(e.target.value); if (ocrConfidence.date) setOcrConfidence((c) => ({ ...c, date: undefined })); }}
                />
              </div>
              <div className="form-fld">
                <label>Due Date</label>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
              <div className="form-fld">
                <label>PO No.</label>
                <input type="text" value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="PO-…" style={{ fontFamily: "var(--font-mono)" }} />
              </div>
            </div>
          </div>

          {/* Amount / Line Items — Simple (single total + one account, default)
              or Detailed (line-item table), per PRD Entry Modes. */}
          <div className={`form-sec card${flagClass("items")}`} data-fx="items">
            <div className="form-sec-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{entryMode === "simple" ? "Amount" : "Line Items"}</span>
              <div className="entry-mode-toggle" role="tablist" aria-label="Entry mode">
                <button type="button" className={entryMode === "simple" ? "active" : ""} onClick={() => switchMode("simple")}>Simple</button>
                <button type="button" className={entryMode === "detailed" ? "active" : ""} onClick={() => switchMode("detailed")}>Detailed</button>
              </div>
            </div>

            {entryMode === "simple" ? (
              <div className="simple-entry">
                <div className="form-fld">
                  <label>Description</label>
                  <input
                    type="text"
                    value={simpleItem.desc}
                    onChange={(e) => setSimpleDesc(e.target.value)}
                    placeholder="What is this bill for? e.g. Sewa kantor — April, or Jasa konsultasi IT"
                  />
                </div>
                <div className="fg2" style={{ marginTop: 12 }}>
                  <div className="form-fld">
                    <label>Amount (before tax)</label>
                    <input
                      type="text"
                      value={fmtNum(simpleItem.price)}
                      onChange={(e) => setSimpleAmount(parseInt(e.target.value.replace(/\./g, "")) || 0)}
                      placeholder="0"
                      style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}
                    />
                  </div>
                  <div className="form-fld">
                    <label>Expense Account</label>
                    <select value={simpleItem.acct} onChange={(e) => setSimpleAcct(e.target.value)}>
                      {EXPENSE_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                    </select>
                    {simpleSuggestion && simpleSuggestion.tier !== 3 && (
                      <button
                        type="button"
                        className={`bd-suggest-chip bd-suggest-tier-${simpleSuggestion.tier}`}
                        onClick={() => setSimpleAcct(simpleSuggestion.acct)}
                        disabled={simpleItem.acct === simpleSuggestion.acct}
                      >
                        <span className="bd-suggest-glyph" aria-hidden>{simpleItem.acct === simpleSuggestion.acct ? "✓" : "✦"}</span>
                        <span className="bd-suggest-body">
                          <span className="bd-suggest-acct">{simpleSuggestion.acct} {simpleSuggestion.name}</span>
                          <span className="bd-suggest-sentence">{simpleSuggestion.sentence}</span>
                        </span>
                      </button>
                    )}
                    {simpleSuggestion && simpleSuggestion.tier === 3 && (
                      <div className="bd-suggest-chip bd-suggest-tier-3">
                        <span className="bd-suggest-sentence">{simpleSuggestion.sentence}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
            <>
            <div className="items-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "32%" }}>Description</th>
                    <th className="r" style={{ width: "9%" }}>Qty</th>
                    <th className="r" style={{ width: "15%" }}>Price (Rp)</th>
                    <th className="r" style={{ width: "15%" }}>Subtotal (Rp)</th>
                    <th style={{ width: "24%" }}>Account</th>
                    <th style={{ width: "5%" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: 12, fontSize: 11 }}>No items yet — add one below.</td></tr>
                  )}
                  {items.map((it, i) => {
                    const sub = (Number(it.qty) || 0) * (Number(it.price) || 0);
                    const suggestion = itemSuggestions[i];
                    return (
                      <tr key={i}>
                        <td>
                          <input type="text" value={it.desc} onChange={(e) => updateRow(i, { desc: e.target.value })} placeholder="Item description…" />
                        </td>
                        <td><input type="text" value={it.qty} style={{ textAlign: "right" }} onChange={(e) => updateRow(i, { qty: parseInt(e.target.value) || 0 })} /></td>
                        <td><input type="text" value={fmtNum(it.price)} style={{ textAlign: "right", fontFamily: "var(--font-mono)" }} onChange={(e) => updateRow(i, { price: parseInt(e.target.value.replace(/\./g, "")) || 0 })} /></td>
                        <td><input type="text" value={fmtNum(sub)} readOnly style={{ textAlign: "right", fontWeight: 700, fontFamily: "var(--font-mono)" }} /></td>
                        <td>
                          <select value={it.acct} onChange={(e) => updateRow(i, { acct: e.target.value })} style={{ fontSize: 11 }}>
                            {EXPENSE_ACCOUNTS.map((a) => (
                              <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                            ))}
                          </select>
                          {suggestion && suggestion.tier !== 3 && (
                            <button
                              type="button"
                              className={`bd-suggest-chip bd-suggest-tier-${suggestion.tier}`}
                              onClick={() => updateRow(i, { acct: suggestion.acct })}
                              title={`Apply ${suggestion.acct} · ${suggestion.name}`}
                              disabled={it.acct === suggestion.acct}
                            >
                              <span className="bd-suggest-glyph" aria-hidden>
                                {it.acct === suggestion.acct ? "✓" : "✦"}
                              </span>
                              <span className="bd-suggest-body">
                                <span className="bd-suggest-acct">{suggestion.acct} {suggestion.name}</span>
                                <span className="bd-suggest-sentence">{suggestion.sentence}</span>
                              </span>
                            </button>
                          )}
                          {suggestion && suggestion.tier === 3 && (
                            <div className="bd-suggest-chip bd-suggest-tier-3">
                              <span className="bd-suggest-sentence">{suggestion.sentence}</span>
                            </div>
                          )}
                        </td>
                        <td>
                          <button className="btn-del-row" onClick={() => delRow(i)}>
                            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="btn-add-row" onClick={addRow}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add row
            </button>
            </>
            )}

            {/* Totals + tax summary (shared). The PPN / PPh explanation sits
                right next to the numbers (was a separate Tax card). */}
            {items.length > 0 && (
              <div className={`total-block${flagClass("tax")}`} data-fx="tax">
                {entryMode === "detailed" && (
                  <div className="t-row">
                    <span className="t-row-lbl">Subtotal</span>
                    <span className="t-row-val">{fmtNum(subtotal)}</span>
                  </div>
                )}
                <div className="t-row">
                  <span className="t-row-lbl">DPP</span>
                  <span className="t-row-val">{fmtNum(dpp)}</span>
                </div>
                <div className="t-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span className="t-row-lbl">PPN (input VAT)</span>
                    <select className="ppn-select" value={ppnRate} onChange={(e) => setPpnRate(parseFloat(e.target.value))}>
                      <option value="0.11">11%</option>
                      <option value="0.10">10%</option>
                      <option value="0">0%</option>
                    </select>
                  </div>
                  <span className="t-row-val" style={{ color: "var(--danger-text)" }}>+ {fmtNum(ppn)}</span>
                </div>
                {vendor && <div className="tax-explain">{ppnSentence(vendor)}</div>}
                {vendor && vendor.pkp === "PKP" && (
                  <div className="form-fld" style={{ margin: "2px 0 8px" }}>
                    <label>Faktur Pajak Number</label>
                    <input
                      type="text"
                      value={fakturPajak}
                      onChange={(e) => setFakturPajak(e.target.value)}
                      placeholder="010.000-25.12345678"
                      style={{ fontFamily: "var(--font-mono)" }}
                    />
                  </div>
                )}
                <div className="t-row grand">
                  <span className="t-row-lbl">Total</span>
                  <span className="t-row-val">{fmtNum(total)}</span>
                </div>
                {pph > 0 && (
                  <div className="t-row">
                    <span className="t-row-lbl">PPh (withheld)</span>
                    <span className="t-row-val">− {fmtNum(pph)}</span>
                  </div>
                )}
                {vendor && <div className="tax-explain">{pphSentence(vendor)}</div>}
                {pph > 0 && (
                  <div className="t-row grand">
                    <span className="t-row-lbl">Net Payable to vendor</span>
                    <span className="t-row-val">{fmtNum(netPayable)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tax explanation + Faktur Pajak + Net Payable now live inline in the
              totals block above, next to the PPN / PPh numbers. */}

          {/* ── Payment Info ─── Auto-populated from the selected vendor's
              master record. Read-only here — bank changes happen in
              Vendor Master. SME feedback: surface this so the FM doesn't
              re-key bank details every time. */}
          <div className="form-sec card">
            <div className="form-sec-title">Payment Info</div>
            {!vendor && (
              <div className="bd-rule-note" style={{ fontStyle: "normal", marginTop: 0 }}>
                Pick a vendor above to see the payment account.
              </div>
            )}
            {vendor && !vendor.banks?.[0] && (
              <div className="bd-rule-note" style={{ fontStyle: "normal", marginTop: 0, color: "var(--color-danger-text)" }}>
                No bank account configured for {vendor.name} — add one in Vendor Master before posting.
              </div>
            )}
            {vendor && vendor.banks?.[0] && (
              <>
                <div className="drawer-row">
                  <div className="drawer-label">Bank</div>
                  <div className="drawer-value">
                    {vendor.banks[0].name}
                    {vendor.banks[0].branch && (
                      <div className="bd-rule-note">{vendor.banks[0].branch}</div>
                    )}
                  </div>
                </div>
                <div className="drawer-row">
                  <div className="drawer-label">Account No.</div>
                  <div className="drawer-value mono">
                    ····{vendor.banks[0].acc.replace(/\D/g, "").slice(-4)}
                    <div className="bd-rule-note">{vendor.banks[0].acc}</div>
                  </div>
                </div>
                <div className="drawer-row">
                  <div className="drawer-label">Account Holder</div>
                  <div className="drawer-value">{vendor.banks[0].holder}</div>
                </div>
                <div className="bd-rule-note" style={{ marginTop: 8, fontStyle: "normal" }}>
                  Pulled from vendor master · update in Vendor Master if it's changed.
                </div>
              </>
            )}
          </div>

          {/* Attachments */}
          <div className={`form-sec card${flagClass("attachments")}`} data-fx="attachments">
            <div className="form-sec-title">Attachments</div>
            {attachments.length > 0 && (
              <div className="attach-list">
                {attachments.map((a, i) => (
                  <div key={i} className="attach-item">
                    <div className="attach-icon">
                      <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="attach-name">{a.name}</div>
                      <div className="attach-size">{a.size}{a.fromOCR ? " · from upload" : ""}</div>
                    </div>
                    <button className="attach-rm" onClick={() => delAttach(i)}>
                      <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-add-attach" onClick={addAttach}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add attachment
            </button>
          </div>

          {/* Notes */}
          <div className="form-sec card">
            <div className="form-sec-title">Notes</div>
            <div className="form-fld">
              <textarea value={keterangan} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Internal note or description for this bill…" />
            </div>
          </div>

          {/* GL Preview — driven by the same previewJournalLines() helper
              the Bill Detail page uses, so creation and review never
              disagree on what will post. Phase 5+ adds rule-annotation
              chips and yellow indicators on low-confidence lines. */}
          {total > 0 && (
            <div className={`form-sec card${flagClass("gl")}`} data-fx="gl">
              <div className="form-sec-title">
                GL Journal Entry Preview
                <span className={`bd-je-status${balanced ? " ok" : " err"}`} style={{ marginLeft: 8 }}>
                  {balanced ? "Balanced" : "Out of balance"}
                </span>
                {anyFlag && (
                  <span className="bd-je-flag" title="One or more lines were generated with low confidence" style={{ marginLeft: 4 }}>⚠</span>
                )}
              </div>
              <div className="bd-je-hint" style={{ marginBottom: 10 }}>
                What this bill will write to the General Ledger when it's approved. Read-only — edit the fields above to change.
              </div>
              <table className="bd-je-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="r">Debit</th>
                    <th className="r">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {jeLines.map((line, i) => (
                    <tr key={i} className={line.flag ? `bd-je-row-${line.flag.toLowerCase()}` : ""}>
                      <td>
                        <div className="bd-je-line-acct">
                          <span className="bd-mono bd-je-acct-code">{line.account_code}</span>
                          <span className="bd-je-acct-name">{line.account_name}</span>
                        </div>
                        <div className="bd-rule-note">{line.rule}</div>
                      </td>
                      <td className="r mono">{line.side === "DR" ? line.amount.toLocaleString("id-ID") : ""}</td>
                      <td className="r mono">{line.side === "CR" ? line.amount.toLocaleString("id-ID") : ""}</td>
                    </tr>
                  ))}
                  <tr className="bd-je-total-row">
                    <td>Total</td>
                    <td className="r mono">{totalDr.toLocaleString("id-ID")}</td>
                    <td className="r mono">{totalCr.toLocaleString("id-ID")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div style={{ height: 20 }} />
          </div>
        </div>

        {/* Document side (left) — A4 reconstruction from form data, mirrors
            the Bill Detail source panel. */}
        <div className="bd-source">
          <div className="ap-doc-host">
          <div className="ap-prev-bar">
            <div className="ap-prev-lbl">
              <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/></svg>
              Invoice preview (A4)
            </div>
            <button className="a4-download-btn" onClick={() => showToast("Download PDF…")}>
              <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download PDF
            </button>
          </div>
          <div className="a4-doc">
            <div className="a4-head2">
              <div className="a4-brand">
                <div className="a4-brand-name">{vendor?.name || "—"}</div>
                <div className="a4-brand-tag">Invoice from vendor</div>
              </div>
              <div className="a4-head-meta">
                <div className="a4-head-row"><span className="a4-head-lbl">Invoice</span><span className="a4-head-val">{invNo || "—"}</span></div>
                <div className="a4-head-row"><span className="a4-head-lbl">Date</span><span className="a4-head-val">{formatDate(date)}</span></div>
                <div className="a4-head-row"><span className="a4-head-lbl">Due</span><span className="a4-head-val">{formatDate(due)}</span></div>
                {poNo && <div className="a4-head-row"><span className="a4-head-lbl">PO</span><span className="a4-head-val">{poNo}</span></div>}
              </div>
            </div>

            <div className="a4-addr-grid">
              <div className="a4-addr">
                <div className="a4-addr-lbl">FROM VENDOR</div>
                <div className="a4-addr-name">{vendor?.name || "—"}</div>
                <div className="a4-addr-line">{vendor?.address || ""}</div>
                {vendor?.tax_id && <div className="a4-addr-line">NPWP {vendor.tax_id}</div>}
                {vendor?.contact && <div className="a4-addr-line a4-addr-attn">Attn: {vendor.contact}</div>}
              </div>
              <div className="a4-addr">
                <div className="a4-addr-lbl">BILL TO</div>
                <div className="a4-addr-name">PT Sejahtera Makmur</div>
                <div className="a4-addr-line">Jl. Sudirman No. 99</div>
                <div className="a4-addr-line">Jakarta 10220, Indonesia</div>
                <div className="a4-addr-line">NPWP 12.345.678.9-000.000</div>
              </div>
              <div className="a4-addr">
                <div className="a4-addr-lbl">TERMS</div>
                <div className="a4-addr-name">{vendor?.payment_terms || "—"}</div>
                <div className="a4-addr-line a4-addr-muted">Payment via bank transfer</div>
                {vendor?.banks?.[0] && (
                  <>
                    <div className="a4-addr-line" style={{ marginTop: 6 }}>{vendor.banks[0].name} {vendor.banks[0].acc}</div>
                    <div className="a4-addr-line">a/n {vendor.banks[0].holder}</div>
                  </>
                )}
              </div>
            </div>

            <div className="a4-items2">
              <table>
                <thead>
                  <tr>
                    <th className="a4-item-num">ITEM</th>
                    <th>DESCRIPTION</th>
                    <th className="r">QTY</th>
                    <th className="r">PRICE</th>
                    <th className="r">SUBTOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter((it) => it.desc).length === 0 && (
                    <tr><td colSpan={5} className="empty">Add items in the form on the left</td></tr>
                  )}
                  {items.filter((it) => it.desc).map((it, i) => (
                    <tr key={i}>
                      <td className="a4-item-num">{String(i + 1).padStart(2, "0")}</td>
                      <td><div className="a4-item-name">{it.desc}</div></td>
                      <td className="r mono">{it.qty}</td>
                      <td className="r mono">{fmtNum(it.price)}</td>
                      <td className="r mono">{fmtNum((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="a4-total">
              <div className="a4-tb">
                <div className="a4-tr"><span className="lbl">DPP</span><span className="val">{fmtNum(dpp)}</span></div>
                <div className="a4-tr"><span className="lbl">PPN ({Math.round(ppnRate * 100)}%)</span><span className="val">{fmtNum(ppn)}</span></div>
                {pph > 0 && <div className="a4-tr"><span className="lbl">PPh (withholding)</span><span className="val">− {fmtNum(pph)}</span></div>}
                <div className="a4-tr grand"><span className="lbl">Total</span><span className="val">Rp {fmtNum(total)}</span></div>
              </div>
            </div>

            <div className="a4-notes">
              <div className="a4-notes-lbl">NOTES</div>
              <div className="a4-notes-body">
                {keterangan
                  ? keterangan
                  : <span className="a4-notes-empty">Please pay before the due date. Include the invoice number in the bank transfer description.</span>}
              </div>
            </div>

            <div className="a4-footer">
              {vendor?.email || "—"} · {vendor?.phone || ""}
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* ── Scanning overlay ─────────────────────────────────────── */}
      {scanning && (
        <div className="scan-overlay">
          <div className="scan-loading-card">
            <div className="scan-spinner" />
            <div className="scan-loading-title">Reading the invoice</div>
            <div className="scan-loading-status">
              {scanPhase === 0 && "Checking file integrity…"}
              {scanPhase === 1 && "Extracting invoice data…"}
              {scanPhase >= 2 && "Matching vendor & PO…"}
            </div>
            <div className="scan-progress">
              <div className="scan-progress-fill" style={{ width: scanPhase === 0 ? "33%" : scanPhase === 1 ? "70%" : "100%" }} />
            </div>
            <div className="scan-loading-file">invoice_supplier_elektronik.pdf · 2.4 MB</div>
          </div>
        </div>
      )}

      {/* ── Action bar (mirrors Bill Detail) ──────────────────────── */}
      <div className="bd-actionbar">
        <div className="bd-actionbar-note">
          {!canSaveDraft
            ? "Pick a vendor and add at least one item to continue"
            : activeExceptions.length > 0
              ? `${activeExceptions.length} exception${activeExceptions.length === 1 ? "" : "s"} to resolve before submitting`
              : "All exceptions resolved — ready to submit"}
        </div>
        <div className="bd-actionbar-buttons">
          <button className="drawer-btn ghost" onClick={() => navigate("/bills")}>Cancel</button>
          <button className="drawer-btn ghost" onClick={onSaveDraft} disabled={!canSaveDraft}>
            <svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14a2 2 0 01-2 2z"/></svg>
            Save Draft
          </button>
          <button className="drawer-btn primary" onClick={onSubmitForReview} disabled={!canSubmit}>
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            Submit for Review
          </button>
        </div>
      </div>

      {/* Upload gate — Entry State 1 primary action (PRD Zone 1). Upload is the
          focused choice; the escape link drops into manual entry. */}
      {uploadGateOpen && (
        <>
          <div className="bd-overlay" onClick={skipToManualEntry} />
          <div className="bd-modal upload-gate-modal">
            <div className="bd-modal-head">
              <div>
                <div className="bd-modal-title">Upload the invoice</div>
                <div className="bd-modal-sub">We'll read the document and fill in the bill for you. You review every field before submitting.</div>
              </div>
              <button className="bd-modal-close" onClick={skipToManualEntry} aria-label="Close">
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="bd-modal-body">
              <div className="upload-gate-drop" onClick={chooseUploadFromGate}>
                <div className="upload-zone-icon">
                  <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div className="upload-zone-title">Drag &amp; drop or click to upload</div>
                <div className="upload-zone-sub">PDF, PNG, JPG, HEIC up to 20 MB</div>
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="upload-zone-cta" onClick={(e) => { e.stopPropagation(); chooseUploadFromGate(); }}>Choose file</button>
                </div>
              </div>
              <button type="button" className="upload-gate-skip" onClick={skipToManualEntry}>
                Fill in manually — attach a document later →
              </button>
            </div>
          </div>
        </>
      )}

      {createVendorOpen && (
        <InlineVendorCreatePanel
          initialName={createVendorSeedName}
          vendors={vendors}
          onCancel={handleCancelCreateVendor}
          onConfirm={handleCreateVendor}
        />
      )}

      {/* No-document confirmation (PRD): a bill with no source document may be
          submitted only with a written justification, which sets
          no_document_flag and surfaces in AP Close. */}
      {noDocOpen && (
        <>
          <div className="bd-overlay" onClick={() => setNoDocOpen(false)} />
          <div className="bd-modal">
            <div className="bd-modal-head">
              <div>
                <div className="bd-modal-title">Record a no-document justification</div>
                <div className="bd-modal-sub">This bill has no source document. Add a short justification for the audit trail — it will be flagged for review before close.</div>
              </div>
              <button className="bd-modal-close" onClick={() => setNoDocOpen(false)} aria-label="Close">
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="bd-modal-body">
              <div className="form-fld">
                <label>Justification *</label>
                <textarea
                  rows={3}
                  value={noDocJustification}
                  onChange={(e) => setNoDocJustification(e.target.value)}
                  placeholder="e.g. Paper receipt lost; vendor refused to issue invoice; emergency cash advance…"
                  autoFocus
                />
                <div className="bd-rule-note">Required. Stored on the bill and surfaced in AP Close as a no-document bill.</div>
              </div>
            </div>
            <div className="bd-modal-foot">
              <button className="bd-modal-btn ghost" onClick={() => setNoDocOpen(false)}>Cancel</button>
              <button className="bd-modal-btn primary" disabled={noDocJustification.trim().length < 3} onClick={confirmNoDoc}>
                Save justification
              </button>
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
