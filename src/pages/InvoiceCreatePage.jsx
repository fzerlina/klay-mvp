import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CUSTOMERS } from "../data/seed/customers";
import { useInvoices } from "../state/InvoicesContext";
import { shipToAddress, shipsToBilling } from "../state/CustomersContext";
import { formatDateEn, formatRupiah, initials } from "../lib/format";
import "./invoice-create.css";

function CustomerCombobox({ value, onChange, customers }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = customers.find((c) => c.id === value);
  const q = search.toLowerCase();
  const list = customers.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || (c.address || "").toLowerCase().includes(q),
  );

  return (
    <div className="cust-combo" ref={ref}>
      <button
        type="button"
        className={`cust-combo-btn${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        {selected ? (
          <>
            <span className="cust-combo-name">{selected.name}</span>
            <span className="cust-combo-addr">{selected.address}</span>
          </>
        ) : (
          <span className="cust-combo-placeholder">Pick Customer…</span>
        )}
        <svg className="cust-combo-chev" viewBox="0 0 24 24">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="cust-combo-pop">
          <div className="cust-combo-search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or address…"
              autoFocus
            />
          </div>
          <div className="cust-combo-list">
            {list.length === 0 && <div className="cust-combo-empty">No matching customer</div>}
            {list.map((c) => (
              <div
                key={c.id}
                className={`cust-combo-item${value === c.id ? " selected" : ""}`}
                onClick={() => {
                  onChange(c.id);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <div className="cust-combo-item-av">{initials(c.name)}</div>
                <div className="cust-combo-item-body">
                  <div className="cust-combo-item-name">{c.name}</div>
                  <div className="cust-combo-item-addr">{c.address}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PRODS = [
  { id: "P1", name: "Division A — Premium Retail Pack", unit: "pack", price: 2500000, sku: "DIV-A-PREM" },
  { id: "P2", name: "Division A — Standard Retail Pack", unit: "pack", price: 2200000, sku: "DIV-A-STD" },
  { id: "P3", name: "Division B — Premium Packaging", unit: "unit", price: 225000, sku: "DIV-B-PREM" },
  { id: "P4", name: "Division B — Standard Packaging", unit: "unit", price: 175000, sku: "DIV-B-STD" },
  { id: "P5", name: "Division B — Wholesale Pack", unit: "unit", price: 150000, sku: "DIV-B-GRO" },
  { id: "P6", name: "Setup & Training Service", unit: "service", price: 2000000, sku: "SVC-SETUP" },
  { id: "P7", name: "Monthly Consulting Service", unit: "service", price: 5000000, sku: "SVC-CONS" },
];

const UNITS = ["unit", "pack", "kg", "service", "buah", "set"];

const AISvg = () => (
  <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
);

function fmtNum(n) {
  if (!n) return "0";
  return Number(n).toLocaleString("id-ID");
}

function CheckSvg() {
  return <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>;
}

export default function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mode = params.get("mode") === "upload" ? "upload" : "manual";
  const { addInvoice, sendInvoice } = useInvoices();

  // step: 'upload' | 'scanning' | 'review'. manual mode starts at 'review'.
  const [step, setStep] = useState(mode === "upload" ? "upload" : "review");
  const [scanPhase, setScanPhase] = useState(0); // 0=safety active, 1=extract active, 2=both done
  const [aiFilled, setAiFilled] = useState(false);
  const [showProdDrawer, setShowProdDrawer] = useState(false);
  const [editRowIdx, setEditRowIdx] = useState(null);
  const [prodSearch, setProdSearch] = useState("");
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  // Form state
  const [custId, setCustId] = useState("");
  const [custPO, setCustPO] = useState("");
  const [date, setDate] = useState("2025-04-23");
  const [due, setDue] = useState("2025-05-23");
  const [memo, setMemo] = useState("");
  const [items, setItems] = useState([]); // {desc,qty,unit,price}
  const [attachments, setAttachments] = useState([]); // {name,size,fromPO}

  // Send modal
  const [sendOpen, setSendOpen] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendCC, setSendCC] = useState("");
  const [sendMsg, setSendMsg] = useState("Our invoice is attached — please arrange payment.");
  const [sendSuccess, setSendSuccess] = useState(false);

  const customer = useMemo(() => CUSTOMERS.find((c) => c.id === custId), [custId]);

  // Auto-generated invoice number from customer + date
  const invNo = useMemo(() => {
    if (!customer) return "";
    const code = (customer.code || "").replace(/-/g, "");
    const ymd = (date || "").replace(/-/g, "");
    return code && ymd ? `INV-${code}-${ymd}` : "";
  }, [customer, date]);

  useEffect(() => {
    if (customer) {
      setSendEmail(customer.contacts?.[0]?.email || "");
    }
  }, [customer]);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2000);
  }

  // Upload → scanning animation → Review with prefilled AI data.
  function simulateScan() {
    setStep("scanning");
    setScanPhase(0);
    setTimeout(() => setScanPhase(1), 1500);
    setTimeout(() => setScanPhase(2), 3000);
    setTimeout(() => goToReview(), 3700);
  }
  function goToReview() {
    // Prefill from a fato AI result — same anchor as the HTML reference.
    setCustId("C004");
    setCustPO("PO-HMS-2025-007");
    setDate("2025-04-20");
    setDue("2025-06-14");
    setMemo("Regular Q2 order — thank you for your business.");
    setItems([
      { desc: "Division A — Standard Retail Pack", qty: 20, unit: "pack", price: 2200000 },
    ]);
    setAttachments([{ name: "PO-HMS-2025-007.pdf", size: "PDF · 2.4 MB", fromPO: true }]);
    setAiFilled(true);
    setStep("review");
  }

  // Totals
  // No output VAT in the MVP — an invoice carries DPP only.
  const dpp = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const total = dpp;

  // Items handlers
  function addRow() {
    setItems((p) => [...p, { desc: "", qty: 1, unit: "unit", price: 0 }]);
  }
  function updateRow(i, patch) {
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function delRow(i) {
    setItems((p) => p.filter((_, idx) => idx !== i));
  }
  function openProd(i) {
    setEditRowIdx(i);
    setProdSearch("");
    setShowProdDrawer(true);
  }
  function selectProd(p) {
    setItems((prev) =>
      prev.map((it, idx) =>
        idx === editRowIdx ? { desc: p.name, qty: it.qty || 1, unit: p.unit, price: p.price, sku: p.sku } : it,
      ),
    );
    setShowProdDrawer(false);
  }
  function addAttach() {
    const names = ["dokumen_po.pdf", "lampiran_contract.pdf", "evidence_order.jpg"];
    setAttachments((p) => [...p, { name: names[Math.floor(Math.random() * names.length)], size: "PDF · 1.2 MB", fromPO: false }]);
  }
  function delAttach(i) {
    setAttachments((p) => p.filter((_, idx) => idx !== i));
  }

  // Save
  function buildDraft() {
    if (!customer) return null;
    return {
      customer: customer.id,
      customerName: customer.name,
      custCode: customer.code,
      custEmail: customer.contacts?.[0]?.email || "",
      custPO: custPO || "—",
      invNo,
      date,
      due,
      dpp,
      total,
      items: items.map((it) => ({
        ...it,
        subtotal: (Number(it.qty) || 0) * (Number(it.price) || 0),
      })),
      fromAI: mode === "upload",
    };
  }

  function onSaveDraft() {
    const draft = buildDraft();
    if (!draft) {
      showToast("Pick a customer first");
      return;
    }
    if (!items.length) {
      showToast("Add at least 1 item");
      return;
    }
    addInvoice(draft);
    showToast("Draft tersimpan ✓");
    setTimeout(() => navigate("/invoices"), 600);
  }

  function onOpenSend() {
    const draft = buildDraft();
    if (!draft) {
      showToast("Pick a customer first");
      return;
    }
    if (!items.length) {
      showToast("Add at least 1 item");
      return;
    }
    setSendOpen(true);
    setSendSuccess(false);
  }

  function onConfirmSend() {
    const draft = buildDraft();
    if (!draft) return;
    const record = addInvoice(draft);
    sendInvoice(record.id, { channel: "email" });
    setSendSuccess(true);
    setTimeout(() => {
      setSendOpen(false);
      navigate("/invoices");
    }, 1400);
  }

  const canSubmit = customer && items.length > 0 && total > 0;
  const dueWarn = mode === "upload" && aiFilled && due === "2025-06-14";

  // Product list filter
  const filteredProds = PRODS.filter((p) => {
    const q = prodSearch.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
  });

  return (
    <div className="addpage">
      {/* Header */}
      <div className="ap-head">
        <div className="ap-title">
          {mode === "upload" ? "Add Invoice from PO" : "Create Invoice Manual"}
        </div>
        {mode === "upload" && (
          <div className="ap-stepper">
            {[
              { n: 1, label: "Upload Document", done: step !== "upload", active: step === "upload" },
              { n: 2, label: "Review & Save", done: false, active: step === "review" || step === "scanning" },
            ].map((s, i) => (
              <span key={s.n} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <div className={`ap-step${s.active ? " active" : ""}${s.done ? " done" : ""}`}>
                  <div className="ap-step-num">{s.done ? <CheckSvg /> : s.n}</div>
                  {s.label}
                </div>
                {i < 1 && <div className={`ap-step-line${s.done ? " done" : ""}`} />}
              </span>
            ))}
          </div>
        )}
        <button className="ap-close" onClick={() => navigate("/invoices")}>
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* STEP 1 — Upload (stays rendered behind the scanning overlay) */}
      {(step === "upload" || step === "scanning") && (
        <div className="ap-s1">
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 5 }}>Upload Customer PO</div>
            <div style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
              Upload foto screenshot, foto invoice fisik, atau file PDF.
            </div>
          </div>
          <div className="upload-zone" onClick={simulateScan}>
            <div className="upload-zone-icon">
              <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Drag & drop a file here</div>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginBottom: 14 }}>
              or click to choose one from your device
            </div>
            <button className="upload-zone-cta" onClick={(e) => { e.stopPropagation(); simulateScan(); }}>Choose File</button>
          </div>
          <div className="ftgrid">
            <div className="ftcard">
              <div className="ftcard-icon" style={{ background: "var(--ai-surface)" }}>
                <svg viewBox="0 0 24 24" style={{ stroke: "var(--color-action)" }}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/></svg>
              </div>
              <div className="ftcard-title">Screenshot</div>
              <div className="ftcard-sub">WA, email, atau showingan invoice digital</div>
              <div className="ftcard-ext">JPG · PNG · WEBP</div>
            </div>
            <div className="ftcard">
              <div className="ftcard-icon" style={{ background: "var(--success-surface)" }}>
                <svg viewBox="0 0 24 24" style={{ stroke: "var(--success-text)" }}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </div>
              <div className="ftcard-title">Photo Invoice Fisik</div>
              <div className="ftcard-sub">Photo kamera HP pastikan teks terbaca jelas</div>
              <div className="ftcard-ext">JPG · PNG · HEIC</div>
            </div>
            <div className="ftcard">
              <div className="ftcard-icon" style={{ background: "var(--danger-surface)" }}>
                <svg viewBox="0 0 24 24" style={{ stroke: "var(--danger-text)" }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div className="ftcard-title">PDF Invoice</div>
              <div className="ftcard-sub">File PDF from system vendor atau e-faktur</div>
              <div className="ftcard-ext">PDF, maks. 10 MB</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center" }}>
            Klay extracts every field automatically — you can correct anything before saving
          </div>
        </div>
      )}

      {/* Subtle scanning overlay — keeps upload visible behind */}
      {step === "scanning" && (
        <div className="scan-overlay">
          <div className="scan-loading-card">
            <div className="scan-spinner" />
            <div className="scan-loading-title">Processing Document</div>
            <div className="scan-loading-status">
              {scanPhase === 0 && "Verifying the file is safe…"}
              {scanPhase === 1 && "Extracting invoice data…"}
              {scanPhase >= 2 && "Almost done…"}
            </div>
            <div className="scan-progress">
              <div
                className="scan-progress-fill"
                style={{ width: scanPhase === 0 ? "33%" : scanPhase === 1 ? "70%" : "100%" }}
              />
            </div>
            <div className="scan-loading-file">PO-HMS-2025-007.pdf · 2.4 MB</div>
          </div>
        </div>
      )}

      {/* STEP 2 — Split review */}
      {step === "review" && (
        <div className="ap-split">
          {/* Form side */}
          <div className="ap-form-side">
            {aiFilled && (
              <div className="ai-fill-banner">
                <div className="ai-fill-banner-title"><AISvg />AI mengisi automatic from PO customer</div>
                <div className="ai-fill-banner-sub">Check each field. One field has low confidence — highlighted in yellow.</div>
              </div>
            )}

            <div className="form-sec card">
              <div className="form-sec-title">General Information</div>
              <div className="fg2">
                <div className="form-fld">
                  <label>Customer</label>
                  <CustomerCombobox value={custId} onChange={setCustId} customers={CUSTOMERS} />
                </div>
                <div className="form-fld">
                  <label>Customer PO</label>
                  <input type="text" value={custPO} onChange={(e) => setCustPO(e.target.value)} placeholder="PO No. from customer" />
                </div>
              </div>
              <div className="fg3">
                <div className="form-fld">
                  <label>Invoice Number</label>
                  <input
                    type="text"
                    value={invNo}
                    readOnly
                    placeholder="Pick a customer first"
                    style={{ fontFamily: "var(--font-mono)", color: invNo ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}
                  />
                </div>
                <div className="form-fld">
                  <label>Date Invoice</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="form-fld">
                  <label>Overdue</label>
                  <input
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className={dueWarn ? "fld-warn-fill" : ""}
                  />
                  {dueWarn && <div className="fld-warn-hint">⚠ Check kembali date due</div>}
                </div>
              </div>
            </div>

            <div className="form-sec card">
              <div className="form-sec-title">Invoice Items</div>
              <div className="items-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "35%" }}>Description</th>
                      <th style={{ width: "9%" }}>Qty</th>
                      <th style={{ width: "13%" }}>Unit</th>
                      <th className="r" style={{ width: "17%" }}>Price (Rp)</th>
                      <th className="r" style={{ width: "17%" }}>Subtotal (Rp)</th>
                      <th style={{ width: "5%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-tertiary)", padding: 12, fontSize: 11 }}>No items yet</td></tr>
                    )}
                    {items.map((it, i) => {
                      const sub = (Number(it.qty) || 0) * (Number(it.price) || 0);
                      return (
                        <tr key={i}>
                          <td>
                            <input
                              type="text"
                              value={it.desc}
                              readOnly
                              placeholder="Click to pick a product…"
                              onClick={() => openProd(i)}
                              style={{ cursor: "pointer", background: it.desc ? "var(--color-surface-sunken)" : "transparent" }}
                            />
                          </td>
                          <td><input type="text" value={it.qty} style={{ textAlign: "right" }} onChange={(e) => updateRow(i, { qty: parseInt(e.target.value) || 0 })} /></td>
                          <td>
                            <select value={it.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} style={{ fontSize: 11 }}>
                              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </td>
                          <td><input type="text" value={fmtNum(it.price)} style={{ textAlign: "right", fontFamily: "var(--font-mono)" }} onChange={(e) => updateRow(i, { price: parseInt(e.target.value.replace(/\./g, "")) || 0 })} /></td>
                          <td><input type="text" value={fmtNum(sub)} readOnly style={{ textAlign: "right", fontWeight: 700, fontFamily: "var(--font-mono)" }} /></td>
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
                Add Row
              </button>
              {items.length > 0 && (
                <div className="total-block">
                  <div className="t-row">
                    <span className="t-row-lbl">Subtotal</span>
                    <span className="t-row-val">{fmtNum(dpp)}</span>
                  </div>
                  <div className="t-row grand">
                    <span className="t-row-lbl">Invoice Total</span>
                    <span className="t-row-val">{fmtNum(total)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="form-sec card">
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
                        <div className="attach-size">{a.size}{a.fromPO ? " · from PO upload" : ""}</div>
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
                Add Attachment
              </button>
            </div>

            <div className="form-sec card">
              <div className="form-sec-title">Description</div>
              <div className="form-fld">
                <label>Notes / Memo</label>
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} placeholder="Add notes or special instructions for this invoice…" />
              </div>
            </div>

            {total > 0 && (
              <div className="journals-section">
                <div className="journals-lbl">Journal Entry</div>
                <table className="journals-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Name</th>
                      <th className="r">Debit</th>
                      <th className="r">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="mono">1-1200</td>
                      <td>Pipayables Usaha</td>
                      <td className="r">{fmtNum(total)}</td>
                      <td className="dim r">—</td>
                    </tr>
                    <tr>
                      <td className="mono">4-1010</td>
                      <td>Product Sales</td>
                      <td className="dim r">—</td>
                      <td className="r">{fmtNum(dpp)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ height: 20 }} />
          </div>

          {/* A4 preview side */}
          <div className="ap-preview-side">
            <div className="ap-prev-bar">
              <div className="ap-prev-lbl">
                <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/></svg>
                Preview Invoice (A4)
              </div>
              <button className="a4-download-btn" onClick={() => showToast("Download PDF…")}>
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download PDF
              </button>
            </div>
            <div className="a4-doc">
              {/* Header: brand + invoice meta */}
              <div className="a4-head2">
                <div className="a4-brand">
                  <div className="a4-brand-name">PT Sejahtera Makmur</div>
                  <div className="a4-brand-tag">Official invoice</div>
                </div>
                <div className="a4-head-meta">
                  <div className="a4-head-row"><span className="a4-head-lbl">Invoice</span><span className="a4-head-val">{invNo || "—"}</span></div>
                  <div className="a4-head-row"><span className="a4-head-lbl">Date</span><span className="a4-head-val">{formatDateEn(date)}</span></div>
                  <div className="a4-head-row"><span className="a4-head-lbl">Overdue</span><span className="a4-head-val">{formatDateEn(due)}</span></div>
                  {custPO && custPO !== "—" && (
                    <div className="a4-head-row"><span className="a4-head-lbl">Customer PO</span><span className="a4-head-val">{custPO}</span></div>
                  )}
                </div>
              </div>

              {/* FROM / BILL TO / SHIP TO */}
              <div className="a4-addr-grid">
                <div className="a4-addr">
                  <div className="a4-addr-lbl">FROM</div>
                  <div className="a4-addr-name">PT Sejahtera Makmur</div>
                  <div className="a4-addr-line">Jl. Sudirman No. 99</div>
                  <div className="a4-addr-line">Jakarta 10220, Indonesia</div>
                  <div className="a4-addr-line">NPWP 12.345.678.9-000.000</div>
                </div>
                <div className="a4-addr">
                  <div className="a4-addr-lbl">BILL TO</div>
                  <div className="a4-addr-name">{customer?.name || "—"}</div>
                  <div className="a4-addr-line">{customer?.address || ""}</div>
                  {customer?.npwp && <div className="a4-addr-line">NPWP {customer.npwp}</div>}
                  {customer?.contacts?.[0] && (
                    <div className="a4-addr-line a4-addr-attn">Attn: {customer.contacts[0].name}{customer.contacts[0].title ? `, ${customer.contacts[0].title}` : ""}</div>
                  )}
                </div>
                <div className="a4-addr">
                  <div className="a4-addr-lbl">SHIP TO</div>
                  <div className="a4-addr-name">{customer?.name || "—"}</div>
                  <div className="a4-addr-line">{customer ? shipToAddress(customer) : ""}</div>
                  {customer && shipsToBilling(customer) && (
                    <div className="a4-addr-line a4-addr-muted">Same as billing address</div>
                  )}
                </div>
              </div>

              {/* Item table */}
              <div className="a4-items2">
                <table>
                  <thead>
                    <tr>
                      <th className="a4-item-num">ITEM</th>
                      <th>DESCRIPTION</th>
                      <th className="r">QTY</th>
                      <th className="r">PRICE</th>
                      <th className="r">AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.filter((it) => it.desc).length === 0 && (
                      <tr><td colSpan={5} className="empty">Add an item in the form on the left</td></tr>
                    )}
                    {items.filter((it) => it.desc).map((it, i) => (
                      <tr key={i}>
                        <td className="a4-item-num">{String(i + 1).padStart(2, "0")}</td>
                        <td>
                          <div className="a4-item-name">{it.desc}</div>
                          {it.sku && <div className="a4-item-code">{it.sku}</div>}
                        </td>
                        <td className="r mono">{it.qty} {it.unit}</td>
                        <td className="r mono">{fmtNum(it.price)}</td>
                        <td className="r mono">{fmtNum((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="a4-total">
                <div className="a4-tb">
                  <div className="a4-tr"><span className="lbl">Subtotal</span><span className="val">{fmtNum(dpp)}</span></div>
                  <div className="a4-tr grand"><span className="lbl">Total</span><span className="val">Rp {fmtNum(total)}</span></div>
                </div>
              </div>

              {/* Notes */}
              <div className="a4-notes">
                <div className="a4-notes-lbl">NOTES</div>
                <div className="a4-notes-body">
                  {memo
                    ? memo
                    : <span className="a4-notes-empty">Please pay by the due date via transfer to BCA 8888-123-456 a/n PT Sejahtera Makmur. Quote the invoice number as the transfer reference.</span>}
                </div>
              </div>

              {/* Signatures */}
              <div className="a4-sig-grid">
                <div className="a4-sig">
                  <div className="a4-sig-lbl">Sincerely,</div>
                  <div className="a4-sig-box" />
                  <div className="a4-sig-name">PT Sejahtera Makmur</div>
                  <div className="a4-sig-role">Authorized Signature</div>
                </div>
                <div className="a4-sig">
                  <div className="a4-sig-lbl">Received by,</div>
                  <div className="a4-sig-box" />
                  <div className="a4-sig-name">{customer?.name || "—"}</div>
                  <div className="a4-sig-role">Date & Signature</div>
                </div>
              </div>

              {/* Footer */}
              <div className="a4-footer">
                Thank you for your business. · invoice@sejahteramakmur.co.id · +62 21 5550 1234
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="ap-foot">
        <button className="ap-btn" onClick={() => navigate("/invoices")}>Cancel</button>
        <span className="ap-hint">{step === "review" ? "All perubahan tersimpan automatic" : ""}</span>
        {step === "review" && (
          <>
            <button className="ap-btn" onClick={onSaveDraft} disabled={!canSubmit}>
              <svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14a2 2 0 01-2 2z"/></svg>
              Save Draft
            </button>
            <button className="ap-btn-send" onClick={onOpenSend} disabled={!canSubmit}>
              <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              Send Invoice
            </button>
          </>
        )}
      </div>

      {/* Product drawer */}
      {showProdDrawer && (
        <>
          <div className="drawer-overlay" onClick={() => setShowProdDrawer(false)} />
          <div className="drawer" style={{ width: 340 }}>
            <div className="drawer-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title">Pick Produk</div>
              </div>
              <button className="drawer-close" onClick={() => setShowProdDrawer(false)}>
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border-default)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--color-surface-sunken)", border: "1px solid var(--color-border-default)", borderRadius: "var(--radius-sm)", padding: "6px 10px" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" style={{ stroke: "var(--color-text-tertiary)", fill: "none", strokeWidth: 1.5 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  type="text"
                  value={prodSearch}
                  onChange={(e) => setProdSearch(e.target.value)}
                  placeholder="Search product name…"
                  style={{ border: "none", outline: "none", fontFamily: "var(--font-sans)", fontSize: 12, background: "transparent", width: "100%" }}
                  autoFocus
                />
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
              {filteredProds.map((p) => (
                <div
                  key={p.id}
                  onClick={() => selectProd(p)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", cursor: "pointer" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--color-surface-sunken)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--color-surface-sunken)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" style={{ stroke: "var(--color-text-tertiary)", fill: "none", strokeWidth: 1.5 }}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}>{p.sku} · {p.unit}</div>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600 }}>{fmtNum(p.price)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Send modal */}
      {sendOpen && (
        <div className="modal-overlay open" onClick={() => !sendSuccess && setSendOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            {sendSuccess ? (
              <div className="send-success">
                <div className="send-success-icon">
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div className="send-success-title">Invoice sent ✓</div>
                <div className="send-success-sub">Mengsidekan to daftar invoice…</div>
              </div>
            ) : (
              <>
                <div className="modal-title">Send Invoice</div>
                <div className="modal-sub">The invoice will be emailed to the customer with the PDF attached.</div>
                <div className="fld">
                  <label>Send to</label>
                  <input type="email" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} placeholder="email@customer.id" />
                </div>
                <div className="fld">
                  <label>CC (opsional)</label>
                  <input type="email" value={sendCC} onChange={(e) => setSendCC(e.target.value)} placeholder="cc@yourcompany.id" />
                </div>
                <div className="fld">
                  <label>Message</label>
                  <textarea value={sendMsg} onChange={(e) => setSendMsg(e.target.value)} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", background: "var(--color-surface-sunken)", borderRadius: "var(--radius-sm)", marginTop: 2, fontSize: 11, color: "var(--color-text-tertiary)" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" style={{ stroke: "var(--color-action)", fill: "none", strokeWidth: 1.5 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>
                  The invoice PDF is attached automatically
                </div>
                <div className="modal-footer">
                  <button className="modal-cancel" onClick={() => setSendOpen(false)}>Cancel</button>
                  <button className="modal-confirm" onClick={onConfirmSend}>
                    <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Send Sekarang
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
