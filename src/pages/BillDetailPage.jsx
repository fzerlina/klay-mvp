import { Fragment, useMemo, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { VENDORS } from "../data/seed/vendors";
import { useBills } from "../state/BillsContext";
import { useVendors } from "../state/VendorsContext";
import { usePayments, PAYMENT_STATUS_META } from "../state/PaymentsContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { formatRupiah, formatRupiahExact, formatDateEn, initials } from "../lib/format";
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
import RecordPaymentModal from "../components/RecordPaymentModal";
import { buildAgingLines } from "../lib/apAging";
import { makeFlagger, releaseState, FLAG_TIERS } from "../lib/paymentFlags";
import { REQ_META, gatesRelease, payModeFor, paymentActionFor, paymentStatusOf } from "../lib/paymentStage";
import { PAYMENT_METHOD_BY_KEY, auditTextFor, breakdownTotal, describeBreakdown, withheldTax, WITHHOLDING_ACCOUNT } from "../lib/paymentBreakdown";
import { bankAccountById } from "../data/seed/bankAccounts";
import { paymentJournalLines } from "../lib/paymentJournal";
import { reconOf, billReconOf } from "../lib/bankRecon";
import { TODAY } from "../lib/clock";
import "./modules.css";
import "./invoice-create.css";
import "./bill-detail.css";

// ─── Labels ─────────────────────────────────────────────────────────────────

const GRN_LABEL      = { matched: "Matched", pending: "Pending", mismatch: "Mismatch" };
const PAY_LABEL      = { paid: "Paid", unpaid: "Unpaid", overdue: "Overdue" };

// Payment request status — the workflow axis (posted bills only). Distinct from
// Payment status: Unpaid / Partial / Paid.
// ─── Payment tab — recorded payments ────────────────────────────────────────
// Money that actually moved, and nothing else. Requests, approvals and returns
// used to share this table, which made a bill look like it had been paid four
// times when it had been paid once: three of those rows were somebody pressing
// a button, and they each carried the full outstanding balance as their
// "amount", so the column did not add up to anything. Those events are workflow
// state — the request axis shows where a bill sits, and the audit trail records
// who moved it — so this tab answers only "what has been paid off, and what is
// left".
//
// Each row carries the five things asked of a payment after the fact: when it
// was recorded, how it was paid, how much, who recorded it, and whether the
// bank has confirmed it. That last one is a THIRD axis (lib/bankRecon.js) and
// is kept visibly apart from the other two — "Paid" is a statement about our
// payable, "Reconciled" is a statement about the bank, and neither implies the
// other. It is also why neither axis is allowed to say "settled".
function PaymentTab({ bill, detail }) {
  const navigate = useNavigate();
  const isPosted = !!bill.je_number || workflowStatus(bill) === "POSTED" || workflowStatus(bill) === "PAID";
  const total = bill.total || 0;
  const remaining = bill.sisa != null ? bill.sisa : total;
  const paid = Math.max(0, total - remaining);

  // Recorded payments, newest work last so the running balance reads downward.
  // `detail.history` is the structured record and is preferred wherever it
  // exists; the audit trail is the fallback for bills that arrived already paid
  // in the seed. Never both — recording a payment writes to each, so merging
  // them would count every in-session payment twice.
  const payments = useMemo(() => {
    const history = detail?.history || [];
    if (history.length > 0) {
      return history.map((h, i) => ({
        key: `h${i}`,
        at: h.at,
        amount: h.cleared,
        by: h.by,
        detail: describeBreakdown(h.breakdown, { omit: [WITHHOLDING_ACCOUNT] }),
        method: PAYMENT_METHOD_BY_KEY[h.breakdown?.method]?.label || null,
        source: bankAccountById(h.breakdown?.sourceAccountId)?.name || null,
        ref: h.breakdown?.giroNumber || null,
        withheld: withheldTax(h.breakdown),
        jeNumber: h.je_number || null,
        recon: reconOf({ ...h, billId: bill.id }),
        journal: paymentJournalLines(h.breakdown, { vendorName: bill.vendorName }),
      }));
    }
    // Seeded payments carry prose, not a breakdown, so there is nothing to
    // derive an entry from — those rows do not expand rather than showing a
    // journal that was reverse-engineered from a sentence. They cannot be
    // reconciled either, for the same reason: there is no account to check a
    // statement against.
    return (bill.audit || [])
      .filter((a) => a.type === "paid")
      .map((a, i) => ({
        key: `a${i}`, at: a.date, time: a.time, amount: null, by: a.by, withheld: 0,
        detail: a.action, method: null, jeNumber: null, recon: reconOf({ at: a.date }), journal: null,
      }));
  }, [detail, bill.audit, bill.vendorName, bill.id]);

  const [openRow, setOpenRow] = useState(null);

  // The ledger balance is the authority on how much is paid off, not this
  // table. A bill can arrive part-paid with no rows behind it — the seed does
  // exactly that — so rather than let the rows quietly disagree with the
  // balance, the unexplained difference gets a line of its own.
  const rowsTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const opening = payments.every((p) => p.amount != null) ? Math.max(0, paid - rowsTotal) : 0;

  // Balance after each payment, worked backwards from the live remaining so the
  // last row always lands on the number in the header.
  const after = [];
  let running = remaining;
  for (let i = payments.length - 1; i >= 0; i -= 1) {
    after[i] = running;
    running += payments[i].amount || 0;
  }

  return (
    <div className="drawer-section">
      <div className="drawer-section-title">Payments</div>

      <div className="bd-pay-summary">
        <div className="bd-pay-stat">
          <span className="bd-pay-stat-lbl">Bill total</span>
          <strong className="bd-pay-stat-val">{formatRupiah(total)}</strong>
        </div>
        <div className="bd-pay-stat">
          <span className="bd-pay-stat-lbl">Paid</span>
          <strong className="bd-pay-stat-val paid">{formatRupiahExact(paid)}</strong>
        </div>
        <div className="bd-pay-stat">
          <span className="bd-pay-stat-lbl">Remaining</span>
          <strong className={`bd-pay-stat-val${remaining > 0 ? " open" : ""}`}>{formatRupiahExact(remaining)}</strong>
        </div>
      </div>

      <table className="bd-pay-table">
        <thead>
          <tr>
            <th>Recorded</th>
            <th>Method</th>
            <th className="r">Amount</th>
            <th>By</th>
            <th>Bank recon</th>
          </tr>
        </thead>
        <tbody>
          {opening > 0 && (
            <tr className="bd-pay-opening">
              <td className="bd-pay-date">—</td>
              <td>
                <div className="bd-pay-what">Opening position</div>
                <div className="bd-pay-sub">Already part-paid when this bill entered Klay — no payment record behind it.</div>
              </td>
              <td className="r bd-pay-amt">
                {formatRupiah(opening)}
                <div className="bd-pay-left">{formatRupiah(total - opening)} left</div>
              </td>
              <td className="bd-pay-by">—</td>
              <td className="bd-pay-recon">—</td>
            </tr>
          )}
          {payments.length === 0 && opening === 0 ? (
            <tr>
              <td colSpan={5} className="bd-pay-empty">
                No payments recorded yet.{!isPosted && " Payment starts once the bill is posted to the GL."}
              </td>
            </tr>
          ) : (
            payments.map((p, i) => {
              const expandable = !!p.journal?.lines.length;
              const open = openRow === p.key;
              return (
                <Fragment key={p.key}>
                  <tr
                    className={`${expandable ? "bd-pay-rowx" : ""}${open ? " open" : ""}`}
                    onClick={expandable ? () => setOpenRow(open ? null : p.key) : undefined}
                  >
                    <td className="bd-pay-date">{formatDateEn(p.at)}{p.time ? ` · ${p.time}` : ""}</td>
                    <td>
                      <div className="bd-pay-what">
                        {expandable && <span className={`bd-pay-caret${open ? " open" : ""}`} aria-hidden>▸</span>}
                        {p.method || "Payment recorded"}
                      </div>
                      {/* The account it came out of belongs with the method rather
                          than in a column of its own: it is read when you are
                          already asking how this one was paid. */}
                      {(p.source || p.ref) && (
                        <div className="bd-pay-sub">{[p.source, p.ref].filter(Boolean).join(" · ")}</div>
                      )}
                      {p.detail && <div className="bd-pay-sub">{p.detail}</div>}
                    </td>
                    <td className="r bd-pay-amt">
                      {p.amount != null ? formatRupiah(p.amount) : "—"}
                      {/* The amount is what this payment CLEARED, which is not
                          what left the bank: withholding relieves the payable
                          without reaching the vendor, and creates a bukti potong
                          to issue. Named here rather than left to the grey
                          deduction line, and worded as the Payment list words
                          it. */}
                      {p.withheld > 0 && (
                        <div className="bd-pay-split">{formatRupiahExact(p.withheld)} withheld</div>
                      )}
                      {/* What this payment left behind, under the amount rather
                          than in a column of its own: six columns do not fit the
                          drawer, and the balance is only ever read against the
                          payment that moved it. */}
                      {p.amount != null && <div className="bd-pay-left">{formatRupiahExact(after[i])} left</div>}
                    </td>
                    <td className="bd-pay-by">{p.by || "—"}</td>
                    <td className="bd-pay-recon">
                      {/* Why, not just what: a "not yet" that names the cut-off it
                          fell outside can be checked; a bare pill has to be trusted. */}
                      <span className={`bd-recon-pill ${p.recon.tone}`} title={p.recon.why}>{p.recon.label}</span>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bd-pay-je-row">
                      <td colSpan={5}>
                        <PaymentJournal
                          journal={p.journal}
                          jeNumber={p.jeNumber}
                          recon={p.recon}
                          onOpenLine={(idx) => navigate(`/journal-entry?je=${encodeURIComponent(p.jeNumber)}${idx == null ? "" : `&line=${idx}`}`)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// The GL entry behind one payment. Debits and credits in one column each, the
// way a journal is read, with the account code carried so it can be checked
// against the chart rather than taken on trust. A line the derivation is not
// sure about says why on the line itself — a warning in a summary somewhere
// else is a warning nobody connects to the number it is about.
//
// Every line is a shortcut into the Journal Entry page at that exact line.
// Recording a payment writes a real entry to the ledger rather than computing
// one for this table, so there is a numbered line to arrive at.
function PaymentJournal({ journal, jeNumber, recon, onOpenLine }) {
  const { lines, totalDr, totalCr, balanced } = journal;
  return (
    <div className="bd-je">
      <div className="bd-je-head">
        <span className="bd-je-title">Journal entry</span>
        {jeNumber && (
          <button type="button" className="bd-je-link" onClick={() => onOpenLine(null)}>
            {jeNumber} <span aria-hidden>→</span>
          </button>
        )}
        {recon?.why && <span className="bd-je-recon">{recon.why}</span>}
      </div>
      <table className="bd-je-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Description</th>
            <th className="r">Debit</th>
            <th className="r">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={l.flag ? "flagged" : ""}>
              <td>
                {jeNumber ? (
                  <button
                    type="button"
                    className="bd-je-code as-link"
                    title={`Open this line in ${jeNumber}`}
                    onClick={() => onOpenLine(i)}
                  >{l.account_code} <span aria-hidden>→</span></button>
                ) : (
                  <span className="bd-je-code">{l.account_code}</span>
                )}
                <span className="bd-je-name">{l.account_name}</span>
              </td>
              <td>
                <div className="bd-je-desc">{l.description}</div>
                {l.flag && <div className="bd-je-flag">{l.flag}</div>}
              </td>
              <td className="r bd-je-amt">{l.side === "DR" ? formatRupiahExact(l.amount) : ""}</td>
              <td className="r bd-je-amt">{l.side === "CR" ? formatRupiahExact(l.amount) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={balanced ? "" : "unbalanced"}>
            <td colSpan={2}>{balanced ? "Balanced" : "Does not balance — this entry would be rejected"}</td>
            <td className="r bd-je-amt">{formatRupiahExact(totalDr)}</td>
            <td className="r bd-je-amt">{formatRupiahExact(totalCr)}</td>
          </tr>
        </tfoot>
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

// Payment actions are governed by the payment.* capabilities, not by the AP
// read/transact/approve ladder — Finance Staff executes payments while holding
// only view on AP. paymentActionFor() has already checked the capability, so
// these must not be re-checked against an AP level that would hide them.
const PAYMENT_ACTION_LABELS = new Set(["Request payment", "Approve payment", "Record payment", "Return"]);

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

function StatusStepper({ bill, paymentStage = "unpaid", requestStage = "notyet" }) {
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
    // The REQUEST cycle, not a single march to Paid. Recording a payment ends
    // a cycle and returns the bill to "No request", so the first three nodes
    // repeat for as long as a balance is open — a partly paid bill sits back at
    // the start with a Partial badge beside the stepper. Paid is the only
    // terminal node, and it belongs to the other axis.
    //
    // The three request labels come from REQ_META rather than being spelled out
    // again here: this stepper and the Payment list name the same three stages,
    // and when each held its own copy they drifted.
    steps = [
      ...Object.entries(REQ_META).map(([key, m]) => ({ key, label: m.label })),
      { key: "paid", label: "Paid" },
    ];
    activeKey = paymentStage === "paid" ? "paid" : (requestStage || "notyet");
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

function ActionBar({ bill, onAction, onSecondary, gateReason, periodLocked, lockedPeriodLabel, onReassign, perm, note, paymentAction, paymentBlocked }) {
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
    // Posted bills hand over to the payment pipeline: the same primary and
    // secondary the Payment list offers this persona at this stage.
    case "POSTED":         primary = paymentAction?.label || null;
                           secondaries = [paymentAction?.secondary, "View GL entry"].filter(Boolean); break;
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
  const anyDisabled = gated || periodActionGated || !!paymentBlocked;

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
              title={paymentBlocked
                ? "A release check is blocking this payment — see Payment checks below"
                : periodActionGated ? periodGateReason : (gated ? gateReason : undefined)}
              onClick={() => !anyDisabled && onAction(primary)}
            >
              {primary}
              {paymentBlocked && <span className="bd-actionbar-gate"> · blocked by a release check</span>}
              {!paymentBlocked && periodActionGated && <span className="bd-actionbar-gate"> · period closed</span>}
              {!paymentBlocked && !periodActionGated && gated && <span className="bd-actionbar-gate"> · resolve flags first</span>}
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
  const { requestStatusOf, returnedOf, detailOf: paymentDetailOf, acksOf: paymentAcksOf, requestPayment, approvePayment, recordPayment, acknowledgeFlag, returnRequest } = usePayments();
  const { addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { closedThrough, autoAssignLateBills, nextOpenPeriod } = useClosePeriod();
  const { hasLevel, hasCapability, level, user } = useCurrentUser();
  const { vendorById, versionsOf } = useVendors();
  const [tab, setTab] = useState("detail");
  const [docView, setDocView] = useState("invoice");
  const [toast, setToast] = useState("");
  const [paying, setPaying] = useState(false);
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
    if (PAYMENT_ACTION_LABELS.has(label)) return { allowed: true };
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

  // ── Payment CTA (posted bills) ──────────────────────────────────────────
  // Same action set as the Payment list (paymentStage.js) so a bill offers the
  // same CTA wherever it is opened — an approved bill says "Record payment" in
  // both places, and means the same thing. The "full" variant is used because a
  // bare "Approve" on a bill page would read as approving the bill itself.
  const payMode = payModeFor(hasCapability);
  const paymentStage = paymentStatusOf(bill);
  const requestStage = requestStatusOf(bill.id);
  const paymentAction = workflowStatus(bill) === "POSTED"
    ? paymentActionFor(payMode, requestStage, "full")
    : null;

  // The release checks that gate the Payment list gate this page too — a
  // control the Bill Detail page could walk around would not be a control.
  const paymentFlags = useMemo(() => {
    if (!paymentAction) return [];
    const lines = buildAgingLines(TODAY, bills).filter((l) => !l.is_accrual && l.raw.je_number);
    const line = lines.find((l) => l.id === bill.id);
    return line ? makeFlagger({ lines, versionsOf, returnedOf })(line) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill.id, bills, paymentAction?.label, versionsOf]);
  const paymentRelease = releaseState(paymentFlags, paymentAcksOf(bill.id));
  const paymentBlocked = !!paymentAction && gatesRelease(payMode) && paymentRelease.blocked;
  const paymentOpenBalance = bill.sisa != null ? bill.sisa : bill.total;

  // Same write the Payment list performs, so a payment recorded from either
  // surface lands in the ledger and the trail identically.
  function confirmPayment(id, breakdown) {
    const by = user?.name || "Finance Staff";
    const total = breakdownTotal(breakdown);
    const full = total >= paymentOpenBalance;
    recordPayment([{ id, breakdown, paysInFull: full }], by);
    updateBill(
      id,
      full ? { pay: "paid", sisa: 0 } : { sisa: paymentOpenBalance - total },
      {
        type: "paid",
        by,
        action: auditTextFor(breakdown, full, { sourceName: bankAccountById(breakdown.sourceAccountId)?.name }),
        date: TODAY.toISOString().slice(0, 10),
        time: "",
      },
    );
    setPaying(false);
    showToast(full ? `${bill.id} paid in full` : `Partial payment recorded for ${bill.id}`);
  }

  // ── Unified "what needs your attention" list ────────────────────────────
  // ONE to-do list, merging the review rules engine (reviewWorkflow.js) with the
  // field-confidence gaps. Rule flags are authoritative for anything they cover
  // (severity per the review flowchart); field-confidence items only fill fields
  // no rule flag already speaks to, so nothing is listed twice.
  const flags = billFlags(bill, vendor, { autoAssignLateBills });
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
      // Recording a payment opens the same typed-breakdown modal the Payment
      // list uses — the CTA and the act behind it match in both places.
      case "Record payment":
        setPaying(true);
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
      // The approval stage's secondary on the Payment list — bounces the
      // payment request back to AP rather than silently clearing it.
      case "Return":
        returnRequest([bill.id], user?.name || FM_USER);
        showToast(`Payment request for ${bill.id} returned to AP`);
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

  // Payment axes: payment status (Unpaid / Partial / Paid) + remaining balance, and
  // the request status (posted-only). Both surface on the header, Bill
  // Information, and the Payment tab.
  const payDetail = paymentDetailOf(bill.id);
  const remaining = bill.pay === "paid" ? 0 : (bill.sisa != null ? bill.sisa : bill.total);
  const payKey = paymentStage;
  const reqKey = requestStage;
  const billPosted = !!bill.je_number || workflowStatus(bill) === "POSTED" || workflowStatus(bill) === "PAID";

  // The bank-confirmation answer is DERIVED from the matching run, not read
  // off the bill. `bill.bankReconStatus` used to be seeded on the record and
  // written by nothing, so it sat here contradicting the payment rows on the
  // tab next door. One axis, one source (lib/bankRecon.js).
  const billRecon = billReconOf(bill.id, payDetail?.history || []);

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
          <StatusStepper bill={bill} paymentStage={paymentStage} requestStage={requestStage} />
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
                    value={<span className={`bp-pay-badge ${PAYMENT_STATUS_META[payKey].tone}`}>{PAYMENT_STATUS_META[payKey].label}</span>}
                  />
                  {billPosted && (
                    <PlainRow
                      label="Payment Request Status"
                      value={<span className={`bp-pay-badge ${REQ_META[reqKey]?.tone || "muted"}`}>{REQ_META[reqKey]?.label || "—"}</span>}
                    />
                  )}
                  <SubRow
                    label="Bank Reconciliation Status"
                    value={<span title={billRecon.why}>{billRecon.label}</span>}
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

      {/* ── Payment release checks ─────────────────────────────────── */}
      {/* The same checks the Payment list runs. Without them on this page the
          disabled CTA would have no explanation next to it. */}
      {paymentAction && paymentFlags.length > 0 && (
        <div className="bd-payment-checks">
          <div className="bd-payment-checks-head">
            Payment checks
            {paymentRelease.blocked && <span className="bd-payment-checks-warn">release blocked</span>}
          </div>
          {paymentFlags.map((f) => {
            const acked = f.tier === "review" && !paymentRelease.unacked.some((r) => r.key === f.key);
            return (
              <div key={f.key} className={`pm-flag-item tier-${f.tier}`}>
                <span className={`pm-flag-tier tone-${FLAG_TIERS[f.tier].tone}`}>{FLAG_TIERS[f.tier].label}</span>
                <div className="pm-flag-body">
                  <div className="pm-flag-label">{f.label}</div>
                  <div className="pm-flag-detail">{f.detail}</div>
                </div>
                <div className="pm-flag-act">
                  {f.tier === "review" && (acked
                    ? <span className="pm-flag-acked">Acknowledged</span>
                    : payMode === "approve"
                      ? <button type="button" className="apa-row-action ghost" onClick={() => acknowledgeFlag(bill.id, f.key, user?.name || FM_USER)}>Acknowledge</button>
                      : null)}
                  {f.tier === "blocking" && <span className="pm-flag-fix">Fix the record before releasing</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
        paymentAction={paymentAction}
        paymentBlocked={paymentBlocked}
        note={`Viewing as ${user.name} · ${apLevelLabel} on AP`}
      />

      {paying && (
        <RecordPaymentModal
          bill={{
            id: bill.id,
            vendorId: bill.vendor,
            vendorName: bill.vendorName,
            invNo: bill.invNo,
            remaining: paymentOpenBalance,
            pph23: bill.pph23 || 0,
          }}
          onConfirm={confirmPayment}
          onClose={() => setPaying(false)}
        />
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
