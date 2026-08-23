import { useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { VENDORS } from "../data/seed/vendors";
import { useBills } from "../state/BillsContext";
import { useVendors } from "../state/VendorsContext";
import { usePayments, PAYMENT_STATUS_META } from "../state/PaymentsContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useInventory } from "../state/InventoryContext";
import { formatRupiah, formatDateEn, initials } from "../lib/format";
import {
  workflowStatus,
  statusCause,
  STATUS_LABEL,
  DEMO_OVERRIDES,
  isApPeriodLocked,
  billPeriod,
} from "../lib/billStatus";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { LEVELS } from "../data/seed/roles";
import {
  computeFieldConfidence,
  computeReviewBrief,
  anomalyIndexesForField,
  FIELD_LABELS,
} from "../lib/billConfidence";
import { previewJournalLines, buildJournalEntry } from "../lib/billJournalPreview";
import { billFlags, canPost, SEVERITY } from "../lib/reviewWorkflow";
import "./modules.css";
import "./invoice-create.css";
import "./bill-detail.css";

// ─── Labels ─────────────────────────────────────────────────────────────────

const GRN_LABEL      = { matched: "Matched", pending: "Pending", mismatch: "Mismatch" };
const PAY_LABEL      = { paid: "Paid", unpaid: "Unpaid", overdue: "Overdue" };

// Payment request status — the workflow axis (posted bills only). Distinct from
// Payment status (settlement: Unpaid / Partial / Paid).
const REQ_LABEL = { notyet: "Not yet requested", requested: "Requested", approved: "Approved", returned: "Returned", settled: "Settled" };
const REQ_TONE  = { notyet: "muted", requested: "review", approved: "action", returned: "danger", settled: "success" };

// Settlement of a bill from its ledger balance + payment stage.
function settlementOf(bill, stage) {
  if (bill.pay === "paid") return "paid";
  if (stage === "partial" || (bill.sisa != null && bill.sisa > 0 && bill.sisa < bill.total)) return "partial";
  return "unpaid";
}
// Request stage (posted only): unpaid→notyet, else the lifecycle stage.
function requestKeyOf(bill, stage) {
  if (bill.pay === "paid") return "settled";
  if (stage === "requested") return "requested";
  if (stage === "approved") return "approved";
  if (stage === "returned") return "returned";
  return "notyet"; // unpaid or partial-remainder
}

// ─── Payment tab — payment history ──────────────────────────────────────────
// The payment lifecycle for a posted bill: request → approve → (return) → pay,
// each event a row (partial payments included), with how much each covers.
// Useful for reading how a partially-paid bill got where it is.
function PaymentTab({ bill, detail }) {
  const isPosted = !!bill.je_number || workflowStatus(bill) === "POSTED" || workflowStatus(bill) === "PAID";
  // Amount a request/approval/return covers = the outstanding balance at the
  // time (the whole remaining is requested). Executed payments carry their own
  // amount in the audit action text (e.g. "Partial payment — Rp X").
  const reqAmount = bill.sisa != null ? bill.sisa : bill.total;
  const parseRp = (s) => { const m = /Rp\s*([\d.]+)/.exec(s || ""); return m ? Number(m[1].replace(/\./g, "")) : null; };

  const events = [];
  if (detail?.requestedAt) events.push({ at: detail.requestedAt, activity: "Payment requested", req: "requested", by: detail.requestedBy, amount: reqAmount });
  if (detail?.approvedAt)  events.push({ at: detail.approvedAt,  activity: "Payment approved",  req: "approved",  by: detail.approvedBy,  amount: reqAmount });
  if (detail?.returnedAt)  events.push({ at: detail.returnedAt,  activity: detail.returnReason ? `Returned — ${detail.returnReason}` : "Returned to AP", req: "returned", by: detail.returnedBy, amount: reqAmount });
  for (const a of bill.audit || []) {
    if (a.type === "paid") events.push({ at: a.date, time: a.time, activity: a.action, req: "settled", by: a.by, amount: parseRp(a.action) ?? reqAmount });
  }
  events.sort((x, y) => (x.at || "").localeCompare(y.at || ""));

  return (
    <div className="drawer-section">
      <div className="drawer-section-title">Payment history</div>
      <table className="bd-pay-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Activity</th>
            <th className="r">Amount</th>
            <th>Payment request status</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <tr><td colSpan={5} className="bd-pay-empty">No payment activity yet.{!isPosted && " Payment starts once the bill is posted to the GL."}</td></tr>
          ) : (
            events.map((e, i) => (
              <tr key={i}>
                <td className="bd-pay-date">{formatDateEn(e.at)}{e.time ? ` · ${e.time}` : ""}</td>
                <td>{e.activity}</td>
                <td className="r bd-pay-amt">{formatRupiah(e.amount)}</td>
                <td><span className={`bp-pay-badge ${REQ_TONE[e.req]}`}>{REQ_LABEL[e.req]}</span></td>
                <td className="bd-pay-by">{e.by || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Per-action permission tiers ─────────────────────────────────────────────
// AP gating is two-tier (matches the permission matrix): "transact" covers data
// prep the AP clerk owns (submit/edit/delete/cancel a bill), while "approve+post"
// covers the decision & money moves only the Finance Manager makes (approve,
// record payment, holds, reverts). Actions not listed are view-only (View GL,
// receipts, comments) and need just the module's view level. Used by ActionBar.
const AP_ACTION_LEVEL = {
  "Approve":           "approve+post",
  "Post":              "post",
  "Record payment":    "approve+post",
  "Put on hold":       "approve+post",
  "Return to AP":      "approve+post",
  "Release hold":      "approve+post",
  "Revert to review":  "approve+post",
  "Revert to unpaid":  "approve+post",
  "Submit for review": "transact",
  "Edit":              "transact",
  "Delete":            "transact",
  "Cancel bill":       "transact",
};

// ─── Review Brief ───────────────────────────────────────────────────────────
// PRD: a plain-language summary of what requires attention appears at the top
// of the page, above the status bar. Format: "[N] field(s) need your
// attention: [field name] ([reason]), …" Computed from the set of YELLOW/RED
// fields at page load; will update in real time as the FM resolves them
// (Phase J wires field editing).

function ReviewBrief({ brief }) {
  if (!brief) return null;
  if (brief.tone === "ok") {
    return (
      <div className="bd-brief bd-brief-ok">
        <div className="bd-brief-icon" aria-hidden>
          <svg viewBox="0 0 12 12"><polyline points="2.5 6 5 8.5 9.5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="bd-brief-msg">{brief.message}</div>
      </div>
    );
  }
  return (
    <div className={`bd-brief bd-brief-${brief.tone}`}>
      <div className="bd-brief-icon" aria-hidden>!</div>
      <div className="bd-brief-body">
        <div className="bd-brief-msg">{brief.message}</div>
        <ul className="bd-brief-list">
          {brief.fields.slice(0, 4).map((f, i) => (
            <li key={i} className={`bd-brief-item bd-brief-item-${f.visual_state.toLowerCase()}`}>
              <span className="bd-brief-item-lbl">{f.label}</span>
              <span className="bd-brief-item-sep">—</span>
              <span className="bd-brief-item-reason">{f.reason}</span>
            </li>
          ))}
          {brief.fields.length > 4 && (
            <li className="bd-brief-more">+ {brief.fields.length - 4} more</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ─── Field Row ──────────────────────────────────────────────────────────────
// A drawer-row for a bill field. When the field carries a YELLOW/RED confidence
// state the row gets a faint background tint and delegates the inline reason +
// "Review" edit affordance to <FlaggedNote>. GREEN/BLUE/manual fields render as
// a plain row. Editing is gated by canEdit (AP "transact"): non-editors still
// see the reason, just no Review button. MVP dropped the per-field confidence
// dot + hover tooltip — the tint + inline reason carry the signal.

function FieldRow({ label, value, confidence, mono, rawValue, inputType, parser, onSave, canEdit = true }) {
  return (
    <div className={`drawer-row${confidenceRowClass(confidence)}`}>
      <div className="drawer-label">{label}</div>
      <div className={`drawer-value${mono ? " mono" : ""}`}>
        {value}
        <FlaggedNote
          confidence={confidence}
          rawValue={rawValue}
          inputType={inputType}
          parser={parser}
          onSave={canEdit ? onSave : undefined}
        />
      </div>
    </div>
  );
}

// Row-class helper: tints a row YELLOW/RED when its field carries a flagged
// confidence state. GREEN/BLUE/manual add no class.
function confidenceRowClass(confidence) {
  const vs = confidence?.visual_state;
  return (vs === "YELLOW" || vs === "RED") ? ` bd-field-${vs.toLowerCase()}` : "";
}

// Visible exception note for a flagged (YELLOW/RED) field: states what's wrong
// AND — when an onSave is supplied — offers the "Review" CTA that opens an
// inline editor. Saving corrects the value and clears the field's anomalies,
// flipping it back to GREEN. This is the single inline-edit affordance shared
// by FieldRow and every other row (Total / RefRow / RateRow). Non-flagged
// fields render nothing.
function FlaggedNote({ confidence, rawValue, inputType, parser, onSave }) {
  const vs = confidence?.visual_state;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (vs !== "YELLOW" && vs !== "RED") return null;
  const startReview = () => { setDraft(rawValue == null ? "" : String(rawValue)); setEditing(true); };
  const commit = () => {
    if (!onSave) { setEditing(false); return; }
    const parsed = parser ? parser(draft) : draft;
    if (parsed === "" || parsed == null) { setEditing(false); return; }
    onSave(parsed);
    setEditing(false);
  };
  return (
    <div className="bd-field-flag">
      <div className="bd-rule-note">{confidence.explanation}</div>
      {onSave && (editing ? (
        <div className="bd-field-edit">
          <input
            type={inputType || "text"}
            className="bd-field-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          />
          <button type="button" className="bd-field-edit-btn save" onClick={commit}>Save</button>
          <button type="button" className="bd-field-edit-btn cancel" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="bd-field-actions">
          <button type="button" className="bd-field-action edit" onClick={startReview}>
            <svg viewBox="0 0 12 12" aria-hidden><path d="M2 10h2l5.5-5.5-2-2L2 8v2zM8.5 2L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Review
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── GL Journal Entry Preview ───────────────────────────────────────────────
// PRD: a collapsible section below the tax summary shows the full DR/CR
// entries the bill will write to the GL on posting. Read-only — the FM edits
// the bill fields above and the preview updates. Phase E surfaces the
// derivation rule per line ("Mapped from CoA: 6-3100 (rule: bill item
// category)" / "PPh 23 at 2% withheld: service invoice" / etc) so the FM can see
// not just what will post but why.

function JournalEntryPreview({ bill, vendor, onViewPostedJe }) {
  const { lines, totalDr, totalCr, balanced, anyFlag } = previewJournalLines(bill, vendor);
  const isPosted = !!bill.je_number;
  return (
    <div className="bd-je-tab">
      <div className="bd-je-tab-head">
        <div>
          <div className="bd-je-tab-title">
            {isPosted ? "Posted to General Ledger" : "GL Journal Entry Preview"}
          </div>
          <div className="bd-je-tab-sub">
            {isPosted ? (
              <>
                <span className="bd-mono">{bill.je_number}</span>
                {bill.je_posted_date && (
                  <>
                    <span className="bd-sub-sep"> · </span>
                    posted {formatDateEn(bill.je_posted_date)}
                  </>
                )}
              </>
            ) : (
              "What will write to the General Ledger when this bill is posted. Read-only — edit the bill fields to change."
            )}
          </div>
        </div>
        <div className="bd-je-tab-actions">
          {!isPosted && (
            <span className={`bd-je-status${balanced ? " ok" : " err"}`}>
              {balanced ? "Balanced" : "Out of balance"}
            </span>
          )}
          {anyFlag && !isPosted && (
            <span className="bd-je-flag" title="One or more lines were generated with low confidence" aria-hidden>
              ⚠
            </span>
          )}
          {isPosted && onViewPostedJe && (
            <button type="button" className="drawer-btn ghost" onClick={onViewPostedJe}>
              View in GL →
            </button>
          )}
        </div>
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
          {lines.map((line, i) => (
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
  );
}

// ─── Vendor Context Panel ───────────────────────────────────────────────────
// PRD: a collapsible panel that surfaces deterministic vendor data — PKP
// status, NPWP, payment terms, bank (last 4 digits + bank name), PPh default.
// Read-only in MVP. Surfaces what the FM would otherwise have to switch to
// the Vendor Master to look up.

function pphLabel(pph) {
  if (pph === "pph23_2")    return "PPh 23 · 2% (service / sewa)";
  if (pph === "pph23_15")   return "PPh 23 · 15% (dividen / bunga)";
  if (pph === "pph4_final") return "PPh 4(2) Final · 2% (konstruksi)";
  return "None";
}

function VendorContextPanel({ vendor }) {
  if (!vendor) return null;
  const bank = vendor.banks && vendor.banks[0];
  const lastFour = bank ? bank.acc.replace(/\D/g, "").slice(-4) : null;
  const npwpMissing = vendor.pkp === "PKP" && !vendor.tax_id;
  const termsMissing = !vendor.payment_terms;
  return (
    <div className="drawer-section bd-vendor-section">
      <div className="drawer-section-title">Vendor Context</div>
      <div className="drawer-row">
        <div className="drawer-label">PKP Status</div>
        <div className="drawer-value">
          <span className={`bd-vendor-pill bd-vendor-pill-${vendor.pkp === "PKP" ? "pkp" : "nonpkp"}`}>
            {vendor.pkp === "PKP" ? "PKP (Pengusaha Kena Pajak)" : "Non-PKP"}
          </span>
        </div>
      </div>
      {!npwpMissing && (
        <div className="drawer-row">
          <div className="drawer-label">NPWP</div>
          <div className="drawer-value mono">{vendor.tax_id || "—"}</div>
        </div>
      )}
      {npwpMissing && (
        <div className="drawer-row bd-field-red">
          <div className="drawer-label">NPWP</div>
          <div className="drawer-value">
            —
            <div className="bd-rule-note">Required for PKP vendor — set in Vendor Master before posting</div>
          </div>
        </div>
      )}
      <div className={`drawer-row${termsMissing ? " bd-field-yellow" : ""}`}>
        <div className="drawer-label">Payment Terms</div>
        <div className="drawer-value">
          {vendor.payment_terms || "not set"}
          {termsMissing && (
            <div className="bd-rule-note">No payment terms configured — set in Vendor Master to enable discount tracking</div>
          )}
        </div>
      </div>
      {bank && (
        <div className="drawer-row">
          <div className="drawer-label">Bank Account</div>
          <div className="drawer-value">
            <div>{bank.name} · ····<span className="mono">{lastFour}</span></div>
            <div className="bd-rule-note">a/n {bank.holder}</div>
          </div>
        </div>
      )}
      <div className="drawer-row">
        <div className="drawer-label">PPh Default</div>
        <div className="drawer-value">{pphLabel(vendor.pph)}</div>
      </div>
    </div>
  );
}

// ─── Status Stepper ─────────────────────────────────────────────────────────
// PRD: a stepped indicator showing where the bill is in the review/approval
// pipeline. Pre-posting (Draft → Pending Review → Approved → Posted) flips to
// the payment lifecycle after posting (Unpaid → Requested → Approved → Partial
// → Paid). ON_HOLD is a paused status "off the happy path" — the stepper
// highlights its underlying approval stage and the hold reason lives in the
// "What needs your attention" list. Returned (REVIEW) and Period-locked
// (BLOCKING) are exceptions in that list, not lifecycle steps.

function StatusStepper({ bill, paymentStage = "unpaid" }) {
  const ws = workflowStatus(bill);

  // ON_HOLD is the one non-lifecycle status the stepper handles: it maps to the
  // bill's underlying approval stage so the stepper still reads correctly.
  const isBranchState = ws === "ON_HOLD";

  // Two lifecycles. The pre-posting stepper (Draft → Pending Review → Approved
  // → Posted) stays in view through APPROVED ("ready to post") and only flips
  // to the payment stepper once the bill is actually posted to the GL.
  const isPostApproval = ws === "POSTED" || ws === "PAID";

  let steps;
  let activeKey;

  if (isPostApproval) {
    // Payment lifecycle: Unpaid → Requested → Approved → Partial → Paid. The
    // active node is driven by the payment stage (PaymentsContext) plus the
    // ledger balance. PARTIAL only fires when sisa is strictly between 0 and
    // total (partial payments aren't wired yet, so it renders idle for now).
    steps = [
      { key: "UNPAID",    label: "Unpaid" },
      { key: "REQUESTED", label: "Requested" },
      { key: "APPROVED",  label: "Approved" },
      { key: "PARTIAL",   label: "Partial" },
      { key: "PAID",      label: "Paid" },
    ];
    if (bill.pay === "paid" || paymentStage === "paid")   activeKey = "PAID";
    else if (bill.sisa > 0 && bill.sisa < bill.total)     activeKey = "PARTIAL";
    else if (paymentStage === "approved")                 activeKey = "APPROVED";
    else if (paymentStage === "requested")                activeKey = "REQUESTED";
    else                                                  activeKey = "UNPAID";
  } else {
    // Review lifecycle — the happy path only. Returned / Period-locked are
    // exceptions surfaced in the attention list, not steps here.
    steps = [
      { key: "DRAFT",          label: "Draft" },
      { key: "PENDING_REVIEW", label: "Pending Review" },
      { key: "APPROVED",       label: "Approved" },
      { key: "POSTED",         label: "Posted" },
    ];
    // ON_HOLD isn't a lifecycle step — highlight the underlying approval stage
    // instead so the stepper still reads correctly.
    const approvalToStep = { draft: "DRAFT", review: "PENDING_REVIEW", approved: bill.je_number ? "POSTED" : "APPROVED" };
    activeKey = isBranchState ? (approvalToStep[bill.approval] || "DRAFT") : ws;
  }

  const activeIdx = steps.findIndex((s) => s.key === activeKey);

  return (
    <div className="bd-stepper-wrap">
      <ol className="bd-stepper">
        {steps.map((s, i) => {
          const state =
            i < activeIdx ? "done" :
            i === activeIdx ? "active" :
            "pending";
          return (
            <li key={s.key} className={`bd-step bd-step-${state}`}>
              <div className="bd-step-dot">
                {state === "done" ? (
                  <svg viewBox="0 0 12 12" aria-hidden><polyline points="2 6 5 9 10 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <span className="bd-step-num">{i + 1}</span>
                )}
              </div>
              <div className="bd-step-lbl">{s.label}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Source Documents (left panel) ──────────────────────────────────────────
// The left panel shows the vendor invoice by default but is switchable: the
// reference rows on the right (PO / GRN / Contract) and a
// segmented control in the toolbar swap in the matching source document.
// Each is an HTML mock rendered from bill + vendor data — faithful enough that
// the FM can compare the form on the right against the "scanned" source.

const KLAY_NPWP = "01.234.567.8-901.000";
const KLAY_ADDRESS = "Jl. Sudirman Kav. 52, Jakarta 12190";

// MVP source documents: Invoice, PO. GRN and Contract mocks are deferred —
// their reference numbers still show as read-only rows, but the rendered
// document views aren't part of the MVP cut.
const DOC_DEFS = [
  { key: "invoice",  label: "Vendor Invoice" },
  { key: "po",       label: "Purchase Order" },
];

// Which source documents exist for this bill — drives both the switcher and
// whether a given reference row is clickable.
function availableDocs(bill) {
  const has = {
    invoice:  true,
    po:       bill.poNo && bill.poNo !== "—",
  };
  return DOC_DEFS.filter((d) => has[d.key]);
}

function SourcePanel({ bill, vendor, docView, setDocView, onDownload }) {
  const docs = availableDocs(bill);
  const active = docs.some((d) => d.key === docView) ? docView : "invoice";
  const activeLabel = (docs.find((d) => d.key === active) || docs[0])?.label || "Document";
  return (
    <div className="ap-doc-host">
      {/* Preview bar (mirrors Create Bill): switcher tabs left, Download right */}
      <div className="ap-prev-bar">
        {docs.length > 1 ? (
          <div className="bd-doc-switch" role="tablist">
            {docs.map((d) => (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={active === d.key}
                className={`bd-doc-switch-tab${active === d.key ? " active" : ""}`}
                onClick={() => setDocView(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="ap-prev-lbl">
            <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/></svg>
            {activeLabel} (A4)
          </div>
        )}
        <button className="a4-download-btn" onClick={onDownload}>
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download PDF
        </button>
      </div>
      {active === "invoice"  && <SourceInvoice  bill={bill} vendor={vendor} />}
      {active === "po"       && <SourcePO       bill={bill} vendor={vendor} />}
    </div>
  );
}

function SourceInvoice({ bill, vendor }) {
  return (
    <div className="a4-doc">
      <div className="a4-head2">
        <div className="a4-brand">
          <div className="a4-brand-name">{vendor?.name || bill.vendorName}</div>
          <div className="a4-brand-tag">Invoice from vendor</div>
        </div>
        <div className="a4-head-meta">
          <div className="a4-head-row"><span className="a4-head-lbl">Invoice</span><span className="a4-head-val">{bill.invNo && bill.invNo !== "—" ? bill.invNo : "—"}</span></div>
          <div className="a4-head-row"><span className="a4-head-lbl">Date</span><span className="a4-head-val">{formatDateEn(bill.date)}</span></div>
          <div className="a4-head-row"><span className="a4-head-lbl">Due</span><span className="a4-head-val">{formatDateEn(bill.due)}</span></div>
          {bill.poNo && bill.poNo !== "—" && <div className="a4-head-row"><span className="a4-head-lbl">PO</span><span className="a4-head-val">{bill.poNo}</span></div>}
        </div>
      </div>

      <div className="a4-addr-grid">
        <div className="a4-addr">
          <div className="a4-addr-lbl">FROM VENDOR</div>
          <div className="a4-addr-name">{vendor?.name || bill.vendorName}</div>
          {vendor?.address && <div className="a4-addr-line">{vendor.address}</div>}
          {vendor?.tax_id && <div className="a4-addr-line">NPWP {vendor.tax_id}</div>}
        </div>
        <div className="a4-addr">
          <div className="a4-addr-lbl">BILL TO</div>
          <div className="a4-addr-name">PT Klay Indonesia</div>
          <div className="a4-addr-line">{KLAY_ADDRESS}</div>
          <div className="a4-addr-line">NPWP {KLAY_NPWP}</div>
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
            {bill.items.map((item, i) => (
              <tr key={i}>
                <td className="a4-item-num">{String(i + 1).padStart(2, "0")}</td>
                <td><div className="a4-item-name">{item.desc}</div></td>
                <td className="r mono">{item.qty.toLocaleString("id-ID")}</td>
                <td className="r mono">{item.price.toLocaleString("id-ID")}</td>
                <td className="r mono">{item.subtotal.toLocaleString("id-ID")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="a4-total">
        <div className="a4-tb">
          <div className="a4-tr"><span className="lbl">DPP</span><span className="val">{bill.dpp.toLocaleString("id-ID")}</span></div>
          {bill.pph23 > 0 && <div className="a4-tr"><span className="lbl">PPh 23 (potongan)</span><span className="val">− {bill.pph23.toLocaleString("id-ID")}</span></div>}
          <div className="a4-tr grand"><span className="lbl">Total</span><span className="val">Rp {bill.total.toLocaleString("id-ID")}</span></div>
        </div>
      </div>

      <div className="a4-notes">
        <div className="a4-notes-lbl">NOTES</div>
        <div className="a4-notes-body">
          {bill.keterangan
            ? bill.keterangan
            : <span className="a4-notes-empty">Please pay before the due date. Include the invoice number in the bank transfer description.</span>}
        </div>
      </div>

      <div className="a4-footer">
        {vendor?.email || "—"}{vendor?.phone ? " · " + vendor.phone : ""}
      </div>
    </div>
  );
}

// ── Purchase Order ────────────────────────────────────────────────────────
function SourcePO({ bill, vendor }) {
  return (
    <div className="a4-doc">
      <div className="a4-head2">
        <div className="a4-brand">
          <div className="a4-brand-name">PT Klay Indonesia</div>
          <div className="a4-brand-tag">Purchase Order</div>
        </div>
        <div className="a4-head-meta">
          <div className="a4-head-row"><span className="a4-head-lbl">PO No.</span><span className="a4-head-val">{bill.poNo}</span></div>
          <div className="a4-head-row"><span className="a4-head-lbl">Date</span><span className="a4-head-val">{formatDateEn(bill.date)}</span></div>
          <div className="a4-head-row"><span className="a4-head-lbl">Status</span><span className="a4-head-val">Approved</span></div>
        </div>
      </div>

      <div className="a4-addr-grid">
        <div className="a4-addr">
          <div className="a4-addr-lbl">SUPPLIER</div>
          <div className="a4-addr-name">{vendor?.name || bill.vendorName}</div>
          {vendor?.address && <div className="a4-addr-line">{vendor.address}</div>}
          {vendor?.tax_id && <div className="a4-addr-line">NPWP {vendor.tax_id}</div>}
        </div>
        <div className="a4-addr">
          <div className="a4-addr-lbl">SHIP TO</div>
          <div className="a4-addr-name">PT Klay Indonesia</div>
          <div className="a4-addr-line">{KLAY_ADDRESS}</div>
          <div className="a4-addr-line">NPWP {KLAY_NPWP}</div>
        </div>
        <div className="a4-addr">
          <div className="a4-addr-lbl">TERMS</div>
          <div className="a4-addr-name">{vendor?.payment_terms || "—"}</div>
          <div className="a4-addr-line a4-addr-muted">Issued by Procurement</div>
        </div>
      </div>

      <div className="a4-items2">
        <table>
          <thead>
            <tr>
              <th className="a4-item-num">ITEM</th>
              <th>DESCRIPTION</th>
              <th className="r">QTY</th>
              <th className="r">UNIT PRICE</th>
              <th className="r">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((item, i) => (
              <tr key={i}>
                <td className="a4-item-num">{String(i + 1).padStart(2, "0")}</td>
                <td><div className="a4-item-name">{item.desc}</div></td>
                <td className="r mono">{item.qty.toLocaleString("id-ID")}</td>
                <td className="r mono">{item.price.toLocaleString("id-ID")}</td>
                <td className="r mono">{item.subtotal.toLocaleString("id-ID")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="a4-total">
        <div className="a4-tb">
          <div className="a4-tr"><span className="lbl">Subtotal (DPP)</span><span className="val">{bill.dpp.toLocaleString("id-ID")}</span></div>
          <div className="a4-tr grand"><span className="lbl">PO Total</span><span className="val">Rp {bill.dpp.toLocaleString("id-ID")}</span></div>
        </div>
      </div>

      <div className="a4-notes">
        <div className="a4-notes-lbl">AUTHORIZED BY</div>
        <div className="a4-notes-body">Procurement · PT Klay Indonesia</div>
      </div>

      <div className="a4-footer">This purchase order is issued subject to Klay standard procurement terms.</div>
    </div>
  );
}


// ─── Action bar ─────────────────────────────────────────────────────────────
// Same status-aware shape as the drawer footer it replaces. The action set
// adapts to workflow_status so the FM / AP Staff always see the relevant next
// step. Phase C will gate Post on flagged-field resolution; Phase G will gate
// it on period-lock status. SoD enforcement is deferred — see the
// "demo: SoD not enforced" note on the left of the bar.

function ActionBar({ bill, onAction, onSecondary, gateReason, periodLocked, lockedPeriodLabel, onReassign, perm, note, paymentPrimaryLabel }) {
  if (!bill) return null;
  const ws = workflowStatus(bill);
  // Gate the workflow-progressing primary action (Submit / Approve / Edit &
  // resubmit) when there are unresolved YELLOW/RED fields. Per PRD: "Post is
  // active when all RED filled and all YELLOW confirmed/corrected." Other
  // primaries (Record payment, Release hold, etc.) are not gated.
  // APPROVED is included because Post (the GL commit) lives there now — per
  // PRD "Post is active when all RED filled and all YELLOW confirmed/corrected."
  const gateableStates = ws === "DRAFT" || ws === "PENDING_REVIEW" || ws === "RETURNED" || ws === "APPROVED";
  const gated = !!gateReason && gateableStates;
  // Period-lock gate: when the bill's accounting period is closed, all client
  // users (FM included) are blocked from posting via normal flow. Per PRD,
  // the Post button is disabled with a Reassign affordance — the FM either
  // reassigns the bill to the current open period or reopens the closed
  // period via Settings → Period Locking (not surfaced here).
  //
  // The banner appears whenever the period is locked (any workflow state) so
  // the FM always sees the reason. The primary-action disable only kicks in
  // for workflow states where posting is the next step.
  const periodActionGated = !!periodLocked && gateableStates;
  const periodGateReason = periodActionGated
    ? `${lockedPeriodLabel || "Period"} is closed — reassign to current open period to post`
    : null;

  let primary = null;
  let secondaries = [];
  switch (ws) {
    case "DRAFT":          primary = "Submit for review"; secondaries = ["Edit", "Delete"]; break;
    case "PENDING_REVIEW": primary = "Approve";            secondaries = ["Put on hold", "Edit"]; break;
    case "ON_HOLD":        primary = "Release hold";       secondaries = ["Edit", "Cancel bill"]; break;
    case "APPROVED":       primary = "Post";               secondaries = ["Revert to review", "Edit"]; break;
    case "POSTED":         primary = paymentPrimaryLabel;   secondaries = ["View GL entry"]; break;
    case "PAID":           primary = null;                 secondaries = ["View receipt", "Revert to unpaid"]; break;
    default:               primary = "Edit";               secondaries = [];
  }

  // Role-based permission gate: the active persona's AP level may not allow
  // the primary action at all (e.g. AP Staff can't Approve). When blocked,
  // this wins the tooltip — it's a more fundamental "no" than the flag/period
  // gates, which only matter once you're allowed to act in the first place.
  const permCheck = (label) => (perm ? perm(label) : { allowed: true });
  // Permission-blocked actions are HIDDEN (a role that can never do this
  // shouldn't see a dead button). State blocks — unresolved flags or a closed
  // period — stay visible-but-disabled, since they're informative ("you could
  // do this, just not yet") and apply to everyone regardless of role.
  const visibleSecondaries = secondaries.filter((label) => permCheck(label).allowed);
  const primaryPerm = primary ? permCheck(primary) : { allowed: true };
  const showPrimary = !!primary && primaryPerm.allowed;
  const anyDisabled = gated || periodActionGated;

  return (
    <>
      {periodLocked && (
        <div className="bd-period-locked-banner">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="2.5" y="5.5" width="7" height="5" rx="0.8"/><path d="M4.2 5.5V3.8a1.8 1.8 0 0 1 3.6 0v1.7"/>
          </svg>
          <span>
            <strong>{lockedPeriodLabel} is closed.</strong> This bill's accounting period was locked by the AP close declaration. Reassign to the current open period to continue, or reopen the period from Settings → Period Locking.
          </span>
          {onReassign && (
            <button type="button" className="bd-period-locked-cta" onClick={onReassign}>
              Reassign to current period
            </button>
          )}
        </div>
      )}
      <div className="bd-actionbar">
        <div className="bd-actionbar-note">{note || "demo: SoD not enforced"}</div>
        <div className="bd-actionbar-buttons">
          {visibleSecondaries.map((label) => (
            <button
              key={label}
              type="button"
              className="drawer-btn ghost"
              onClick={() => onSecondary(label)}
            >
              {label}
            </button>
          ))}
          {showPrimary && (
            <button
              type="button"
              className={`drawer-btn primary${anyDisabled ? " disabled" : ""}`}
              disabled={anyDisabled}
              title={periodActionGated ? periodGateReason : (gated ? gateReason : undefined)}
              onClick={() => !anyDisabled && onAction(primary)}
            >
              {primary}
              {periodActionGated && <span className="bd-actionbar-gate"> · period closed</span>}
              {!periodActionGated && gated && <span className="bd-actionbar-gate"> · resolve flags first</span>}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Review checklist ────────────────────────────────────────────────────────
// The rules-engine flags for this bill (reviewWorkflow.js) with their exit-
// condition actions: "Yes, I have reviewed" acknowledges a REVIEW flag; the
// FM-only "Override" clears an overridable BLOCKING flag (e.g. Tax Omitted with
// an SKB on file). ADVISORY flags are context-only. A bill can't post until its
// blocking flags are fixed (data corrected) or overridden.
// The attention panel — same tiered, foldable fx-panel used on Create Bill, so
// the two surfaces read identically. Items are the merged rules-engine flags +
// field-confidence gaps + the ON_HOLD status item; each maps to a tier by
// severity. CTAs preserve Bill Detail's semantics: Override (FM, overridable
// blocking) / This is correct (acknowledge or confirm) / Fix (jump to the
// Detail tab) / Acknowledge (advisory).
const FX_TIERS = [
  { key: SEVERITY.BLOCKING, cls: "blocking", label: "Blocking" },
  { key: SEVERITY.REVIEW,   cls: "review",   label: "Need Review" },
  { key: SEVERITY.ADVISORY, cls: "advisory", label: "Advisory" },
];
function ReviewChecklist({ items, okMessage, canReview, canOverride, onReviewed, onOverride, onConfirmField, onFixField }) {
  const [folded, setFolded] = useState({ [SEVERITY.BLOCKING]: false, [SEVERITY.REVIEW]: false, [SEVERITY.ADVISORY]: true });
  const toggle = (k) => setFolded((f) => ({ ...f, [k]: !f[k] }));

  const all = items || [];
  const open = all.filter((f) => f.status === "open");
  const openActionable = open.filter((f) => f.severity !== SEVERITY.ADVISORY).length;
  const blockingCount = open.filter((f) => f.severity === SEVERITY.BLOCKING).length;

  if (all.length === 0) {
    if (!okMessage) return null;
    return (
      <div className="fx-panel fx-panel-ok">
        <span className="fx-ok-ico" aria-hidden>
          <svg viewBox="0 0 12 12"><polyline points="2.5 6 5 8.5 9.5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        {okMessage}
      </div>
    );
  }

  const actions = (f) => {
    if (f.status && f.status !== "open") {
      return <span className="fx-done">{f.status === "overridden" ? "Overridden" : "Reviewed ✓"}</span>;
    }
    // ON_HOLD (and any status-sourced item) is settled from the action bar.
    if (f.source === "status") return <span className="fx-info">Resolve below</span>;

    if (f.severity === SEVERITY.BLOCKING) {
      if (f.source === "field") {
        return <button type="button" className="fx-btn primary" onClick={() => onFixField(f)}>Fix</button>;
      }
      if (f.overridable && canOverride) {
        return <button type="button" className="fx-btn override" onClick={() => onOverride(f)}>Override</button>;
      }
      return <span className="fx-info">Fix to clear</span>;
    }
    if (f.severity === SEVERITY.REVIEW) {
      if (f.source === "field") {
        return (
          <>
            {canReview && <button type="button" className="fx-btn" onClick={() => onConfirmField(f.fields)}>This is correct</button>}
            <button type="button" className="fx-btn primary" onClick={() => onFixField(f)}>Fix</button>
          </>
        );
      }
      return canReview ? <button type="button" className="fx-btn" onClick={() => onReviewed(f)}>This is correct</button> : null;
    }
    // ADVISORY
    return canReview ? <button type="button" className="fx-btn" onClick={() => onReviewed(f)}>Acknowledge</button> : <span className="fx-info">FYI</span>;
  };

  return (
    <div className="fx-panel">
      <div className="fx-panel-head">
        <span className="fx-panel-count">
          {openActionable === 0 ? "All clear" : `${openActionable} exception${openActionable === 1 ? "" : "s"} to resolve`}
        </span>
        {blockingCount > 0 && <span className="fx-panel-blocking">{blockingCount} blocking</span>}
      </div>
      {FX_TIERS.map((tier) => {
        const rows = all.filter((f) => f.severity === tier.key);
        if (rows.length === 0) return null;
        const isFolded = folded[tier.key];
        return (
          <div className="fx-tier" key={tier.key}>
            <button type="button" className="fx-tier-head" onClick={() => toggle(tier.key)} aria-expanded={!isFolded}>
              <span className={`fx-dot ${tier.cls}`} aria-hidden />
              <span className="fx-tier-label">{tier.label}</span>
              <span className="fx-tier-count">{rows.length}</span>
              <svg className={`fx-tier-chev${isFolded ? " folded" : ""}`} viewBox="0 0 24 24" aria-hidden><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {!isFolded && rows.map((f) => {
              const resolved = f.status && f.status !== "open";
              return (
                <div key={f.id} className={`fx-row${resolved ? " resolved" : ""}`}>
                  <div className="fx-body">
                    <div className="fx-title">{f.label}</div>
                    <div className="fx-detail">{f.message}</div>
                  </div>
                  <div className="fx-actions">{actions(f)}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Detail-tab row helpers ─────────────────────────────────────────────────

// A plain read-only label/value row (no confidence indicator).
function PlainRow({ label, value, mono, confidence, rawValue, inputType, parser, onSave }) {
  return (
    <div className={`drawer-row${confidenceRowClass(confidence)}`}>
      <div className="drawer-label">{label}</div>
      <div className={`drawer-value${mono ? " mono" : ""}`}>
        {value}
        <FlaggedNote confidence={confidence} rawValue={rawValue} inputType={inputType} parser={parser} onSave={onSave} />
      </div>
    </div>
  );
}

// Indented sub-row, used for the items nested under Payment Status.
function SubRow({ label, value }) {
  return (
    <div className="drawer-row bd-subrow">
      <div className="drawer-label">{label}</div>
      <div className="drawer-value">{value}</div>
    </div>
  );
}

// A reference row whose value, when present, is a link that switches the
// source document shown on the left.
function RefRow({ label, value, onClick, confidence, rawValue, inputType, parser, onSave }) {
  const has = value && value !== "—";
  return (
    <div className={`drawer-row bd-ref-row${confidenceRowClass(confidence)}`}>
      <div className="drawer-label">{label}</div>
      <div className="drawer-value mono">
        {has ? (
          onClick
            ? <button type="button" className="bd-ref-link" onClick={onClick}>{value}</button>
            : <span>{value}</span>
        ) : (
          <span className="bd-ref-empty">—</span>
        )}
        <FlaggedNote confidence={confidence} rawValue={rawValue} inputType={inputType} parser={parser} onSave={onSave} />
      </div>
    </div>
  );
}

// A tax-rate row: the rate is an editable chip (click → inline % input); the
// computed amount sits beside it. Saving recomputes the downstream totals.
function RateRow({ label, rate, amount, onSaveRate, canEdit = true, confidence }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const pct = +((rate || 0) * 100).toFixed(2);
  function start() { setDraft(String(pct)); setEditing(true); }
  function commit() {
    const n = parseFloat(draft);
    if (!Number.isFinite(n) || n < 0) { setEditing(false); return; }
    onSaveRate(n / 100);
    setEditing(false);
  }
  return (
    <div className={`drawer-row bd-rate-row${confidenceRowClass(confidence)}`}>
      <div className="drawer-label">{label}</div>
      <div className="drawer-value bd-rate-value">
        {editing ? (
          <span className="bd-rate-edit">
            <input
              type="number"
              step="0.01"
              className="bd-rate-input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
            />
            <span className="bd-rate-pct">%</span>
            <button type="button" className="bd-field-edit-btn save" onClick={commit}>Save</button>
            <button type="button" className="bd-field-edit-btn cancel" onClick={() => setEditing(false)}>Cancel</button>
          </span>
        ) : (
          <>
            {canEdit ? (
              <button type="button" className="bd-rate-chip" onClick={start} title="Edit rate">{pct}%</button>
            ) : (
              <span className="bd-rate-chip bd-rate-chip-static">{pct}%</span>
            )}
            <span className="bd-rate-amt mono">{formatRupiah(amount)}</span>
          </>
        )}
        <FlaggedNote confidence={confidence} />
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

// Demo user identities — there's no current-user concept yet, so the audit
// trail uses fixed names that match the existing seed (Sarah Wijaya =
// AP staff, Budi Santoso = Finance Manager).
const AP_USER = "Sarah Wijaya";
const FM_USER = "Budi Santoso";

function nowAuditStamp() {
  const d = new Date();
  return { date: d.toISOString().slice(0, 10), time: d.toTimeString().slice(0, 5) };
}

const MONTH_LABEL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function periodLabel(yyyymm) {
  if (!yyyymm) return "";
  const [y, m] = yyyymm.split("-").map((n) => parseInt(n, 10));
  return `${MONTH_LABEL[m - 1] || ""} ${y}`;
}

export default function BillDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { bills, updateBill } = useBills();
  const { statusOf: paymentStatusOf, detailOf: paymentDetailOf, requestPayment, approvePayment, markPaid } = usePayments();
  const { addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { closedThrough, autoAssignLateBills, nextOpenPeriod } = useClosePeriod();
  const { hasLevel, hasCapability, level, user } = useCurrentUser();
  const { vendorById } = useVendors();
  const { items: inventoryItems } = useInventory();
  const [tab, setTab] = useState("detail");
  const [docView, setDocView] = useState("invoice");
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2400);
  }

  // Back = return to wherever the user came from (Bills, Payment, AP aging,
  // Command Center, …). React Router stamps a history index; when there's an
  // in-app entry behind us we pop it, otherwise fall back to the Bills list
  // (e.g. the detail page was opened via a direct link).
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.state && window.history.state.idx > 0) navigate(-1);
    else navigate("/bills");
  };

  const bill = bills.find((b) => b.id === id);

  if (!bill) {
    return (
      <div className="bd-page">
        <div className="bd-notfound">
          <div className="bd-notfound-title">Bill not found</div>
          <div className="bd-notfound-sub">
            No bill with ID <span className="bd-mono">{id}</span> exists in the current dataset.
          </div>
          <button className="bd-back" onClick={goBack}>← Back</button>
        </div>
      </div>
    );
  }

  // Prefer the context-derived vendor (carries the live lifecycle/approval axes
  // and normalized attributes); fall back to the raw seed if not yet loaded.
  const vendor = vendorById(bill.vendor) || VENDORS.find((v) => v.id === bill.vendor);
  const fields = computeFieldConfidence(bill, vendor);
  const brief = computeReviewBrief(bill, fields);

  // Role-based action gating (AP module). canEditAp covers inline field/rate
  // edits (transact). apActionPerm(label) resolves a workflow button against
  // its required tier and returns a tooltip reason when the persona is short.
  const canEditAp = hasLevel("ap", "transact");
  const apLevelLabel = LEVELS[level("ap")]?.label || "None";
  const apActionPerm = (label) => {
    const req = AP_ACTION_LEVEL[label] || "view";
    const allowed = hasLevel("ap", req);
    return {
      allowed,
      reason: allowed
        ? undefined
        : `Requires ${LEVELS[req].label} access on Accounts Payable — you have ${apLevelLabel}.`,
    };
  };

  const canReviewFlags = hasLevel("ap", "transact"); // AP Staff owns the fix/ack
  const canOverrideFlags = hasCapability("ap.approve"); // FM override authority

  // ── Payment CTA (posted bills) — mirrors AP Aging: role + payment-stage
  // aware. Only the actor whose stage is current sees an action.
  const paymentStage = paymentStatusOf(bill.id);
  let paymentPrimaryLabel = null;
  if (workflowStatus(bill) === "POSTED") {
    if (hasCapability("payment.request") && paymentStage === "unpaid") paymentPrimaryLabel = "Request payment";
    else if (hasCapability("payment.approve") && paymentStage === "requested") paymentPrimaryLabel = "Approve payment";
    else if (hasCapability("payment.execute") && paymentStage === "approved") paymentPrimaryLabel = "Mark as paid";
  }

  // ── Unified "what needs your attention" list ────────────────────────────
  // ONE to-do list, merging the review rules engine (reviewWorkflow.js) with the
  // field-confidence gaps. Rule flags are authoritative for anything they cover
  // (severity per the review flowchart); field-confidence items only fill fields
  // no rule flag already speaks to, so nothing is listed twice.
  const flags = billFlags(bill, vendor, { autoAssignLateBills, items: inventoryItems });
  const FLAG_FIELD_COVER = {
    price_anomaly: ["total", "poNo"],
    tax_omitted: ["pph23"],
    tax_mismatch_obligation: ["pph23"],
    vendor_data: ["vendor"],
  };
  const coveredFields = new Set(flags.flatMap((f) => FLAG_FIELD_COVER[f.key] || []));
  // Multiple fields flagged by the SAME underlying signal (e.g. one "OCR
  // readings unreliable" anomaly hits PO No. + DPP + Total) collapse into a
  // single item — "Check PO No., DPP & Total — <reason>" — instead of one row
  // per field. Group by the shared reason text.
  const joinLabels = (a) => (a.length <= 1 ? (a[0] || "") : `${a.slice(0, -1).join(", ")} & ${a[a.length - 1]}`);
  const fieldGroups = new Map();
  for (const f of ((brief && brief.fields) ? brief.fields : [])) {
    if (coveredFields.has(f.field)) continue;
    const key = f.reason || f.label;
    if (!fieldGroups.has(key)) fieldGroups.set(key, []);
    fieldGroups.get(key).push(f);
  }
  const fieldItems = [...fieldGroups.entries()].map(([reason, group]) => {
    const names = group.map((g) => g.field);
    const labels = group.map((g) => g.label);
    const anyRed = group.some((g) => g.visual_state === "RED");
    return {
      id: `fields:${names.join("+")}`,
      source: "field",
      fields: names,
      label: group.length > 1 ? `Check ${joinLabels(labels)}` : labels[0],
      message: reason,
      severity: anyRed ? SEVERITY.BLOCKING : SEVERITY.REVIEW,
      status: "open",
    };
  });
  // ON_HOLD is a real (paused) status, so its hold reason becomes a review-list
  // item here. Returned and Period-locked are NOT statuses — they're exceptions
  // emitted by the rules engine (REVIEW / BLOCKING), so they arrive via `flags`
  // and don't need a hand-rolled entry. "Exception" is no longer a status
  // either — those bills' problems surface as ordinary review flags.
  const wsState = workflowStatus(bill);
  const ovState = DEMO_OVERRIDES[bill.id] || {};
  const statusItems = [];
  if (wsState === "ON_HOLD") {
    statusItems.push({ id: "status:hold", source: "status", severity: SEVERITY.REVIEW, label: "On hold", message: ovState.onHold?.reason ? `On hold — ${ovState.onHold.reason}` : statusCause(bill), status: "open" });
  }
  const attentionItems = [...statusItems, ...flags.map((f) => ({ ...f, source: "rule" })), ...fieldItems];

  // Post gate: any OPEN blocking item (rule or field). Overridden rule flags drop
  // out; RED field items clear when their value is fixed in the Detail form.
  const openBlocking = attentionItems.filter((i) => i.severity === SEVERITY.BLOCKING && i.status !== "overridden");
  const gateReason = openBlocking.length > 0
    ? `${openBlocking.length} blocking item${openBlocking.length === 1 ? "" : "s"} to clear before posting`
    : null;
  const attentionOk = attentionItems.length === 0 && bill.approval !== "approved" && !bill.je_number
    ? "Everything looks good — nothing to review."
    : null;

  function onMarkReviewed(f) {
    const ack = [...(bill.review_ack || [])];
    if (!ack.includes(f.id)) ack.push(f.id);
    updateBill(bill.id, { review_ack: ack }, {
      type:   "reviewed",
      action: `Reviewed: ${f.label}`,
      by:     user?.name || "Reviewer",
      ...nowAuditStamp(),
    });
    showToast(`Marked "${f.label}" as reviewed`);
  }
  function onOverrideFlag(f) {
    const overrides = [...(bill.review_overrides || [])];
    if (!overrides.some((o) => o.id === f.id)) {
      overrides.push({ id: f.id, reason: f.label === "Tax Omitted" ? "SKB on file — FM override" : "FM override", by: user?.name || "Finance Manager", at: nowAuditStamp().date });
    }
    updateBill(bill.id, { review_overrides: overrides }, {
      type:   "override",
      action: `Overrode blocking flag: ${f.label}`,
      by:     user?.name || "Finance Manager",
      ...nowAuditStamp(),
    });
    showToast(`Overrode "${f.label}"`);
  }
  // Confirm a grouped field item — resolve every anomaly hitting any of its
  // fields in ONE update (so a batched "Confirm" doesn't clobber itself).
  function confirmFields(fieldNames) {
    const resolved = new Set(bill.anomalies_resolved || []);
    for (const fn of fieldNames) for (const idx of anomalyIndexesForField(bill, fn)) resolved.add(idx);
    updateBill(bill.id, { anomalies_resolved: [...resolved] }, {
      type:   "reviewed",
      action: `Confirmed: ${fieldNames.map((fn) => FIELD_LABELS[fn] || fn).join(", ")}`,
      by:     user?.name || "Reviewer",
      ...nowAuditStamp(),
    });
    showToast(`Confirmed ${fieldNames.length} field${fieldNames.length === 1 ? "" : "s"}`);
  }

  // Period-lock gate — read the dynamic closedThrough from ClosePeriodContext.
  // When the bill's accounting period is locked, the Post action is disabled
  // and a Reassign affordance lets the FM move the bill to the current open
  // period (the path of least resistance per the AP Close PRD).
  // With auto-assign ON (default), late bills roll to the open period on their
  // own — no manual reassign, so the lock never gates the FM here.
  const billPeriodLocked = !autoAssignLateBills && isApPeriodLocked(billPeriod(bill), closedThrough);
  const lockedPeriodLabel = billPeriodLocked ? periodLabel(billPeriod(bill)) : null;
  function onReassignToCurrentPeriod() {
    // Reassign moves only the accounting `period` to the first day of the next
    // open period (closedThrough + 1 month). The vendor's invoice_date (b.date)
    // is left untouched — it's a historical fact about the document, and
    // rewriting it to dodge a closed period is exactly what auditors object to.
    const [y, m] = closedThrough.split("-").map((n) => parseInt(n, 10));
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const newPeriod = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
    updateBill(bill.id, { period: newPeriod }, {
      type:   "reassigned",
      action: `Accounting period reassigned to ${periodLabel(`${nextY}-${String(nextM).padStart(2, "0")}`)} (was ${lockedPeriodLabel}) — invoice date unchanged`,
      by:     FM_USER,
      ...nowAuditStamp(),
    });
    showToast(`Reassigned to ${periodLabel(`${nextY}-${String(nextM).padStart(2, "0")}`)} — period unlocked for this bill`);
  }

  // ── Action handlers — actually mutate the bill (and post a JE on Approve)
  function onPrimary(label) {
    const stamp = nowAuditStamp();
    switch (label) {
      case "Submit for review":
        updateBill(bill.id, { approval: "review" }, {
          type:   "submitted",
          action: "Submitted for FM review",
          by:     AP_USER,
          ...stamp,
        });
        showToast(`${bill.id} submitted for review`);
        break;
      case "Approve":
        // FM approval clears review — the bill is now "ready to post" but is
        // NOT yet in the GL. Posting is a separate, explicit FM action.
        updateBill(bill.id, { approval: "approved" }, {
          type:   "approved",
          action: "Approved — ready to post",
          by:     FM_USER,
          ...stamp,
        });
        showToast(`${bill.id} approved — ready to post`);
        break;
      case "Post": {
        // Posting is the moment the bill writes to the GL. Build a full journal
        // entry from the bill + vendor (same shape as seed JEs), push it onto
        // JournalEntriesContext, and stamp the bill with its je_number so it
        // advances to POSTED. Switch to the Posting tab to show the new JE.
        const jeNumber = peekNextJeNumber();
        const je = buildJournalEntry(bill, vendor, jeNumber, FM_USER);
        addJournalEntry(je);
        updateBill(bill.id, {
          je_number:      jeNumber,
          je_posted_date: stamp.date,
        }, {
          type:   "posted",
          action: `Posted to GL · ${jeNumber}`,
          by:     FM_USER,
          ...stamp,
        });
        showToast(`Posted to GL · ${jeNumber}`);
        // Posting is the FM's terminal action on this bill for the review
        // lifecycle — return to the queue to clear the next one rather than
        // lingering on a now-posted detail. Payment is recorded later from the
        // list / AP Aging, not here.
        navigate("/bills");
        break;
      }
      // Payment flow (mirrors AP Aging) — role + stage aware.
      case "Request payment":
        requestPayment([bill.id], user?.name || AP_USER);
        showToast(`Payment requested for ${bill.id}`);
        break;
      case "Approve payment":
        approvePayment([bill.id], user?.name || FM_USER);
        showToast(`Payment approved for ${bill.id}`);
        break;
      case "Mark as paid":
        markPaid([bill.id], user?.name || "Finance Staff");
        updateBill(bill.id, { pay: "paid", sisa: 0 }, {
          type:   "paid",
          action: "Payment executed & marked paid",
          by:     user?.name || "Finance Staff",
          ...stamp,
        });
        showToast(`${bill.id} marked paid`);
        break;
      default:
        // DEMO_OVERRIDES-driven actions (Release hold, Edit & resubmit, etc.)
        // can't fully mutate state without making the override map reactive
        // — that's Phase J territory. Acknowledge with a toast.
        showToast(`${label} — ${bill.id} (demo)`);
    }
  }

  function onSecondary(label) {
    const stamp = nowAuditStamp();
    switch (label) {
      case "Return to AP":
        updateBill(bill.id, { approval: "draft" }, {
          type:   "returned",
          action: "Returned to AP for rework",
          by:     FM_USER,
          ...stamp,
        });
        showToast(`${bill.id} returned to AP`);
        break;
      default:
        showToast(`${label} — ${bill.id} (demo)`);
    }
  }

  // ── Field-level edit + confirm ────────────────────────────────────────
  // Phase J: FM corrects or confirms a flagged field. Edit overwrites the
  // value on the bill and marks every anomaly that hit the field as
  // resolved (so the indicator flips back to GREEN). Confirm leaves the
  // value alone and just marks the anomalies resolved — used when the FM
  // reviews a YELLOW warning and decides the value is fine as-is.
  function fieldAuditValue(fieldName, val) {
    if (val == null || val === "") return "—";
    if (fieldName === "dpp" || fieldName === "total")  return `Rp ${Number(val).toLocaleString("id-ID")}`;
    if (fieldName === "date" || fieldName === "due")   return formatDateEn(val);
    return String(val);
  }

  function editField(fieldName, newValue) {
    const before = bill[fieldName];
    const stamp = nowAuditStamp();
    const resolved = new Set(bill.anomalies_resolved || []);
    for (const idx of anomalyIndexesForField(bill, fieldName)) resolved.add(idx);
    const manual = new Set(bill.manual_fields || []);
    manual.add(fieldName);
    updateBill(bill.id, {
      [fieldName]:         newValue,
      anomalies_resolved:  [...resolved],
      manual_fields:       [...manual],
    }, {
      type:   "edited",
      action: `${FIELD_LABELS[fieldName] || fieldName} corrected: ${fieldAuditValue(fieldName, before)} → ${fieldAuditValue(fieldName, newValue)}`,
      by:     AP_USER,
      field:  fieldName,
      before,
      after:  newValue,
      ...stamp,
    });
    showToast(`Saved. This will be applied to future invoices from ${vendor?.name || bill.vendorName}.`);
  }

  // Parsers for inline edit inputs
  const parseInt0 = (v) => {
    const n = Number(String(v).replace(/[^\d-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const parseText = (v) => String(v).trim();

  // ── Tax-rate edits (Item Details) — changing a rate recomputes the
  // downstream amounts. PPh is a withholding that only affects Net Payable,
  // not Total.
  function setPphRate(r) {
    const pph23 = Math.round(bill.dpp * r);
    updateBill(bill.id, { pphRate: r, pph23 }, {
      type:   "edited",
      action: `PPh rate set to ${(r * 100).toFixed(2)}% — recalculated to ${formatRupiah(pph23)}`,
      by:     AP_USER,
      ...nowAuditStamp(),
    });
    showToast(`PPh recalculated at ${(r * 100).toFixed(2)}%`);
  }

  // Effective rates — prefer the stored rate, fall back to deriving from the
  // amount (covers bills created before the rate fields existed).
  const pphRate = bill.pphRate != null ? bill.pphRate : (bill.dpp > 0 && bill.pph23 ? bill.pph23 / bill.dpp : 0);
  const netPayable = bill.total - (bill.pph23 || 0);

  // Payment axes: settlement (Unpaid / Partial / Paid) + remaining balance, and
  // the request status (posted-only). Both surface on the header, Bill
  // Information, and the Payment tab.
  const payDetail = paymentDetailOf(bill.id);
  const remaining = bill.pay === "paid" ? 0 : (bill.sisa != null ? bill.sisa : bill.total);
  const settleKey = settlementOf(bill, paymentStage);
  const reqKey = requestKeyOf(bill, paymentStage);
  const billPosted = !!bill.je_number || workflowStatus(bill) === "POSTED" || workflowStatus(bill) === "PAID";

  // Compliance / status label maps for the new Detail rows.
  const RECON_LABEL = { reconciled: "Reconciled", unreconciled: "Unreconciled" };

  return (
    <div className="bd-page">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="bd-head">
        <button className="bd-back" onClick={goBack}>← Back</button>
        <div className="bd-head-main">
          <div className="drawer-av bill">{bill.initials || initials(bill.vendorName)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bd-title">{bill.vendorName}</div>
            <div className="bd-sub">
              <span className="bd-mono">{bill.id}</span>
              {bill.invNo && bill.invNo !== "—" && (
                <>
                  <span className="bd-sub-sep">·</span>
                  <span className="bd-mono">{bill.invNo}</span>
                </>
              )}
              <span className="bd-sub-sep">·</span>
              <span>Issued {formatDateEn(bill.date)}</span>
            </div>
          </div>
          <div className="bd-head-total">
            <div className="bd-head-total-lbl">Remaining balance</div>
            <div className="bd-head-total-val">{remaining > 0 ? formatRupiah(remaining) : "Rp 0"}</div>
            <div className="bd-head-total-sub">Total {formatRupiah(bill.total)}</div>
          </div>
        </div>
      </div>

      {/* ── Status progress bar — pre-posting only. Once the bill is posted,
           the payment lifecycle lives in the Payment tab, so the stepper is
           dropped here. ─────────────────────────────────────────────────── */}
      {!billPosted && (
        <div className="bd-status-band">
          <StatusStepper bill={bill} paymentStage={paymentStage} />
        </div>
      )}

      {/* ── Two-panel body: form leads on the left, source document on the
          right — consistent with Create New Bill. ─────────────────────── */}
      <div className="bd-main">
        {/* Left: tabbed form. Status lives in the band above; the "what needs
            your attention" panel lives inside the Detail tab (below). */}
        <div className="bd-form">
          <div className="drawer-tabs bd-tabs">
            {[
              ["detail",  "Detail"],
              ["posting", "Posting"],
              ["payment", "Payment"],
              ["vendor",  "Vendor"],
              ["audit",   "Audit"],
            ].map(([t, label]) => (
              <div key={t} className={`drawer-tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                {label}
                {t === "posting" && bill.je_number && (
                  <span className="bd-tab-badge" aria-label="posted">✓</span>
                )}
              </div>
            ))}
          </div>

          <div className="bd-form-body">
            {tab === "detail" && (
              <>
                <ReviewChecklist
                  items={attentionItems}
                  okMessage={attentionOk}
                  canReview={canReviewFlags}
                  canOverride={canOverrideFlags}
                  onReviewed={onMarkReviewed}
                  onOverride={onOverrideFlag}
                  onConfirmField={confirmFields}
                  onFixField={() => setTab("detail")}
                />
                <div className="drawer-section">
                  <div className="drawer-section-title">Bill Information</div>
                  <div className="drawer-row">
                    <div className="drawer-label">Bill ID</div>
                    <div className="drawer-value">{bill.id}</div>
                  </div>
                  <FieldRow
                    label="Vendor Invoice No."
                    value={
                      bill.invNo && bill.invNo !== "—" ? (
                        <button type="button" className="bd-ref-link" onClick={() => setDocView("invoice")}>
                          {bill.invNo}
                        </button>
                      ) : bill.invNo
                    }
                    confidence={fields.invNo}
                    rawValue={bill.invNo === "—" ? "" : bill.invNo}
                    inputType="text"
                    parser={parseText}
                    onSave={(v) => editField("invNo", v)}
                    canEdit={canEditAp}
                  />
                  <FieldRow
                    label="Invoice Date"
                    value={formatDateEn(bill.date)}
                    confidence={fields.date}
                    rawValue={bill.date}
                    inputType="date"
                    parser={parseText}
                    onSave={(v) => editField("date", v)}
                    canEdit={canEditAp}
                  />
                  <PlainRow
                    label="Accounting Period"
                    value={(() => {
                      const invMonth = (bill.date || "").slice(0, 7);
                      const stored = billPeriod(bill);
                      if (stored !== invMonth) {
                        // Manually reassigned to a different period.
                        return (
                          <>
                            {periodLabel(stored)}
                            <span className="bd-period-reassigned"> · reassigned from {periodLabel(invMonth)}</span>
                          </>
                        );
                      }
                      if (autoAssignLateBills && !bill.je_number && isApPeriodLocked(invMonth, closedThrough)) {
                        // Late bill — auto-posted to the current open period.
                        return (
                          <>
                            {periodLabel(nextOpenPeriod)}
                            <span className="bd-period-reassigned"> · auto-assigned from {periodLabel(invMonth)} (period closed)</span>
                          </>
                        );
                      }
                      return periodLabel(stored);
                    })()}
                  />
                  <FieldRow label="Due Date" value={formatDateEn(bill.due)} confidence={fields.due} />
                  <PlainRow label="Discount Due Date" value={bill.discountDueDate ? formatDateEn(bill.discountDueDate) : "—"} />
                  <PlainRow label="GRN Status" value={GRN_LABEL[bill.grn] || "—"} />
                  <PlainRow
                    label="Payment Status"
                    value={<span className={`bp-pay-badge ${PAYMENT_STATUS_META[settleKey].tone}`}>{PAYMENT_STATUS_META[settleKey].label}</span>}
                  />
                  {billPosted && (
                    <PlainRow
                      label="Payment Request Status"
                      value={<span className={`bp-pay-badge ${REQ_TONE[reqKey]}`}>{REQ_LABEL[reqKey]}</span>}
                    />
                  )}
                  <SubRow
                    label="Bank Reconciliation Status"
                    value={RECON_LABEL[bill.bankReconStatus] || "—"}
                  />
                  {bill.keterangan && (
                    <div className="drawer-row">
                      <div className="drawer-label">Description</div>
                      <div className="drawer-value">{bill.keterangan}</div>
                    </div>
                  )}
                </div>

                <div className="drawer-section">
                  <div className="drawer-section-title">References</div>
                  <RefRow label="PO #"           value={bill.poNo}       onClick={() => setDocView("po")} confidence={fields.poNo} rawValue={bill.poNo === "—" ? "" : bill.poNo} parser={parseText} onSave={(v) => editField("poNo", v)} />
                  <RefRow label="GRN #"          value={bill.grnNo} />
                  <RefRow label="Contract #"     value={bill.contractNo} />
                </div>

                <div className="drawer-section">
                  <div className="drawer-section-title">Item Details</div>
                  <table className="items-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="r">Qty</th>
                        <th className="r">Price</th>
                        <th className="r">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bill.items.map((item, i) => (
                        <tr key={i}>
                          <td>
                            <div>{item.desc}</div>
                            <div style={{ fontSize: 10, color: "var(--color-action)", fontFamily: "var(--font-mono)" }}>
                              {item.acct} · {item.acctName}
                            </div>
                          </td>
                          <td className="r">{item.qty.toLocaleString("id-ID")}</td>
                          <td className="r">{formatRupiah(item.price)}</td>
                          <td className="r">{formatRupiah(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bd-amounts">
                    <PlainRow label="DPP" value={formatRupiah(bill.dpp)} mono confidence={fields.dpp} rawValue={String(bill.dpp)} inputType="number" parser={parseInt0} onSave={(v) => editField("dpp", v)} />
                    <RateRow label="PPh" rate={pphRate} amount={bill.pph23} onSaveRate={setPphRate} canEdit={canEditAp} confidence={fields.pph23} />
                    <div className={`drawer-row bd-amt-strong${confidenceRowClass(fields.total)}`}>
                      <div className="drawer-label">Total</div>
                      <div className="drawer-value mono">
                        {formatRupiah(bill.total)}
                        <FlaggedNote confidence={fields.total} rawValue={String(bill.total)} inputType="number" parser={parseInt0} onSave={(v) => editField("total", v)} />
                      </div>
                    </div>
                    <PlainRow label="Net Payable" value={formatRupiah(netPayable)} mono />
                  </div>
                </div>
              </>
            )}

            {tab === "posting" && (
              <JournalEntryPreview
                bill={bill}
                vendor={vendor}
                onViewPostedJe={() => navigate("/journal-entry")}
              />
            )}

            {tab === "payment" && (
              <PaymentTab bill={bill} detail={payDetail} />
            )}

            {tab === "vendor" && (
              <VendorContextPanel vendor={vendor} />
            )}

            {tab === "audit" && (
              <div className="drawer-section">
                <div className="drawer-section-title">Audit History</div>
                <div className="audit-list">
                  {bill.audit.map((a, i) => (
                    <div key={i} className="audit-item">
                      <div className={`audit-dot ${a.type}`} />
                      <div>
                        <div className="audit-action">{a.action}</div>
                        <div className="audit-by">{a.by} · {formatDateEn(a.date)} {a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: source document (switchable A4 preview) */}
        <div className="bd-source">
          <SourcePanel bill={bill} vendor={vendor} docView={docView} setDocView={setDocView} onDownload={() => showToast("Preparing PDF…")} />
        </div>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────── */}
      <ActionBar
        bill={bill}
        gateReason={gateReason}
        periodLocked={billPeriodLocked}
        lockedPeriodLabel={lockedPeriodLabel}
        onReassign={onReassignToCurrentPeriod}
        onAction={onPrimary}
        onSecondary={onSecondary}
        perm={apActionPerm}
        paymentPrimaryLabel={paymentPrimaryLabel}
        note={`Viewing as ${user.name} · ${apLevelLabel} on AP`}
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
