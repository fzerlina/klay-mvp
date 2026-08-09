import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BILLS } from "../data/seed/bills";
import { useVendors } from "../state/VendorsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePayments, PAYMENT_STATUS_META } from "../state/PaymentsContext";
import { workflowStatus, STATUS_LABEL } from "../lib/billStatus";
import { withholdingLabel, ACCT_LABELS } from "../data/labels";
import { formatRupiah, formatDate, termLabel } from "../lib/format";
import RelationshipTierControl, { TIER_LABEL } from "../components/RelationshipTier";
import "./vendor-detail.css";

// ── Vendor Detail (Vendor Master PRD — detail / confirmation screen) ─────────
// Full page at /vendors/:id. Status bar + health alerts, section grid, a real
// Transactions tab (bills for this vendor) and an Activity/change log.
// Lifecycle actions are capability-gated: Approve / Block / Unblock / Deactivate
// / Reactivate and manual health are the approver control (ap.post — Finance
// Manager + Accounting Manager, a prototype stand-in for vendor.confirm /
// vendor.hold). SoD: the AP Staff who onboards can't approve or hold.

// Two independent axes: lifecycle (draft/active/inactive) and approval.
const STATUS = {
  draft:    { cls: "draft",    lbl: "Draft" },
  active:   { cls: "active",   lbl: "Active" },
  inactive: { cls: "inactive", lbl: "Inactive" },
};
const APPROVAL = {
  approved:         { cls: "approved", lbl: "Approved" },
  pending_approval: { cls: "pending",  lbl: "Pending approval" },
};
const PKP_LABEL = { PKP: "PKP — VAT-registered", NON_PKP: "Non-PKP", UNKNOWN: "Unknown — not set" };
const TYPE_LABEL = { company: "Company", individual: "Individual", cooperative: "Cooperative", government: "Government" };

function digitsOnly(s) { return (s || "").replace(/\D/g, ""); }
function bankAcc(acc) {
  const d = digitsOnly(acc);
  return d.length > 4 ? `•••• ${d.slice(-4)}` : acc;
}
// Journal (GL posting) status tone from the shared bill workflow state.
function journalTone(ws) {
  if (ws === "PAID" || ws === "POSTED") return "success";
  if (ws === "APPROVED") return "action";
  if (ws === "DRAFT") return "muted";
  return "review"; // pending review / on hold
}
const BLANK_BANK = { name: "", code: "", acc: "", holder: "" };

export default function VendorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { vendorById, setVendorStatus, submitVendor, rejectVendor, setVendorApproval, setVendorBank, setCompanyBank, changeLog, versionsOf } = useVendors();
  const { user, hasCapability, hasLevel } = useCurrentUser();
  const { statusOf } = usePayments();

  const vendor = vendorById(id);

  // Approver control (ap.post = Finance Manager + Accounting Manager). Stand-in
  // for the future vendor.confirm / vendor.hold capabilities.
  const canApprove = hasCapability("ap.post");
  const canBill = hasLevel("ap", "transact");
  // Proposing a vendor bank/payee change is open to staff — the approval flow
  // provides the control (SoD: proposer ≠ approver). The company (paying)
  // account has no approval flow, so it stays manager-only.
  const canEditBank = hasCapability("vendor.edit_bank");

  const [tab, setTab] = useState("overview");
  const [openVer, setOpenVer] = useState(null); // expanded version snapshot id
  const [dialog, setDialog] = useState(null); // confirmation modal config
  const [reason, setReason] = useState("");
  const [bankTarget, setBankTarget] = useState(null); // null | "vendor" | "company"
  const [bankForm, setBankForm] = useState(BLANK_BANK);
  const [toast, setToast] = useState("");
  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2200); }
  function openDialog(cfg) { setReason(""); setDialog(cfg); }
  function closeDialog() { setDialog(null); setReason(""); }

  const txns = useMemo(() => {
    if (!vendor) return [];
    return BILLS.filter((b) => b.vendor === vendor.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [vendor]);
  const outstanding = useMemo(() => txns.filter((b) => b.pay !== "paid").reduce((s, b) => s + (b.sisa || 0), 0), [txns]);
  const log = (vendor && changeLog[vendor.id]) || [];
  const vlist = vendor ? versionsOf(vendor.id) : [];

  if (!vendor) {
    return (
      <div className="vd-page">
        <div className="vd-empty" style={{ marginTop: 80 }}>
          Vendor not found.{" "}
          <button className="vd-btn" style={{ marginTop: 14 }} onClick={() => navigate("/vendors")}>Back to Vendors</button>
        </div>
      </div>
    );
  }

  const st = STATUS[vendor.status] || STATUS.active;
  const appr = APPROVAL[vendor.approval] || APPROVAL.approved;
  const isDraft = vendor.status === "draft";
  // "Awaiting approval" = submitted (Active) but not yet approved. A Draft is
  // pre-submit, so its Approve/Reject don't show until it's submitted.
  const awaitingApproval = !isDraft && vendor.approval === "pending_approval";
  const meta = { actor: user.name };
  const doStatus = (status, extra) => { setVendorStatus(vendor.id, status, { ...meta, ...extra }); };
  const doApprove = () => { setVendorApproval(vendor.id, "approved", { ...meta, event: "Approved" }); };

  function confirmDialog() {
    if (!dialog) return;
    if (dialog.reasonRequired && reason.trim().length < 10) return;
    dialog.onConfirm(reason.trim());
    closeDialog();
  }

  // ── Confirmation-modal openers ────────────────────────────────────────────
  const askDeactivate = () => openDialog({
    title: `Deactivate ${vendor.name}?`,
    body: "This vendor won't be available for new transactions. You can reactivate it later.",
    reasonRequired: false, confirmLabel: "Deactivate", danger: false,
    onConfirm: (r) => { doStatus("inactive", { reason: r, event: "Deactivated" }); flash(`${vendor.name} set to inactive`); },
  });
  const askReject = () => openDialog({
    title: `Reject ${vendor.name}?`,
    body: (vendor.current_version || 0) === 0
      ? "This returns the vendor to Draft so whoever onboarded it can revise and resubmit. Record why."
      : "This discards the pending change; the vendor stays on its last approved version. Record why.",
    reasonRequired: true, reasonPlaceholder: "e.g. NPWP doesn't match the company name on the invoice",
    confirmLabel: "Reject", danger: true,
    onConfirm: (r) => { rejectVendor(vendor.id, { reason: r, actor: user.name }); flash(`${vendor.name} rejected`); },
  });

  // Add bank account (Tier 3 — vendor.manage_bank; here gated to managers). The
  // PRD flow: a manager adds the payout bank at confirmation, then activates.
  // Both bank accounts are single. "vendor" is the payee (approval-gated);
  // "company" is our paying account (logged, not gated).
  const openBank = (target) => {
    const existing = target === "company" ? vendor.company_bank : vendor.banks?.[0];
    setBankForm(existing ? { ...BLANK_BANK, ...existing } : BLANK_BANK);
    setBankTarget(target);
  };
  function saveBank() {
    if (!bankForm.name.trim() || digitsOnly(bankForm.acc).length < 4) return;
    if (bankTarget === "company") {
      setCompanyBank(vendor.id, { ...bankForm }, { actor: user.name });
      flash("Company bank account updated");
    } else {
      setVendorBank(vendor.id, { ...bankForm }, { actor: user.name });
      flash("Vendor bank / payee updated — pending approval");
    }
    setBankTarget(null);
  }

  return (
    <div className="vd-page">
      <div className="vd-scroll">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <div className="vd-top">
          <button className="vd-back" onClick={() => navigate("/vendors")} aria-label="Back to Vendors">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div className="vd-headinfo">
            <div className="vd-title-row">
              <span className="vd-title">{vendor.name}</span>
              {vendor.status !== "active" && <span className={`vd-status ${st.cls}`}>{st.lbl}</span>}
              {awaitingApproval && <span className={`vd-status ${appr.cls}`}>{appr.lbl}</span>}
              <RelationshipTierControl vendorId={vendor.id} />
            </div>
            <div className="vd-sub">
              <span>{vendor.code}</span>
              <span>·</span>
              <span>{TYPE_LABEL[vendor.type] || vendor.type}</span>
            </div>
          </div>
          <div className="vd-actions">
            {isDraft && canBill && (
              <button className="vd-btn primary" onClick={() => { submitVendor(vendor.id, { actor: user.name }); flash(`${vendor.name} submitted — now active, pending approval`); }}>
                <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Submit for approval
              </button>
            )}
            {awaitingApproval && canApprove && (
              <>
                <button className="vd-btn primary" onClick={() => { doApprove(); flash(`${vendor.name} approved`); }}>
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Approve
                </button>
                <button className="vd-btn danger" onClick={askReject}>
                  <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Reject
                </button>
              </>
            )}
            {vendor.status === "inactive" && canApprove && (
              <button className="vd-btn" onClick={() => { doStatus("active", { event: "Reactivated" }); flash(`${vendor.name} reactivated`); }}>
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Reactivate
              </button>
            )}
            {vendor.status === "active" && canApprove && (
              <button className="vd-btn" onClick={askDeactivate}>Deactivate</button>
            )}
            {canBill && !isDraft && <button className="vd-btn" onClick={() => flash("New bill (demo)")}>
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> New Bill
            </button>}
          </div>
        </div>

        {/* ── Draft / Approval alert ──────────────────────────────── */}
        {isDraft && (
          <div className="vd-alert info">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Draft.</strong> This vendor can't be used on bills yet. {canBill ? "Submit it for approval to make it Active — then a manager approves it before it can post or pay." : "Whoever onboarded it submits it for approval to make it Active."}</div>
          </div>
        )}
        {awaitingApproval && (
          <div className="vd-alert info">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Pending approval.</strong> This vendor is usable to create bills, but stays blocking at posting &amp; payment until approved. {canApprove ? "Review the details, then Approve — or Reject to send it back." : "An approver (Finance Manager or Accounting Manager) signs it off."}</div>
          </div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="vd-tabs">
          {[["overview", "Details"], ["transactions", "Bills & Payment History"], ["versions", "Versions"], ["activity", "Audit log"]].map(([k, lbl]) => (
            <button key={k} className={`vd-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
              {lbl}
              {k === "transactions" && txns.length > 0 && <span className="vd-tab-count">{txns.length}</span>}
              {k === "versions" && vlist.length > 0 && <span className="vd-tab-count">{vlist.length}</span>}
              {k === "activity" && log.length > 0 && <span className="vd-tab-count">{log.length}</span>}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ────────────────────────────────────────────── */}
        {tab === "overview" && (
          <div className="vd-body">
            <div className="vd-gate-legend">
              <span className="vd-gate">⚷</span> Changing a marked field starts a new approval cycle — the vendor stays usable to create bills but is blocked at posting &amp; payment until re-approved.
            </div>
            <div className="vd-grid">
              {/* Status — the two axes */}
              <div className="vd-card">
                <div className="vd-card-title">Status</div>
                <Row l="Lifecycle status" v={st.lbl} />
                <Row l="Approval status" v={appr.lbl} />
                <Row l="Current version" v={vlist[0]?.versionId || "— none yet"} />
              </div>

              {/* Identity */}
              <div className="vd-card">
                <div className="vd-card-title">Identity</div>
                <Row l="Vendor code" v={vendor.code} mono />
                <Row l="Legal name" v={vendor.legal_name || vendor.name} gated />
                <Row l="Entity type" v={TYPE_LABEL[vendor.type] || vendor.type} />
                <Row l="Address" v={vendor.address || "—"} />
                <Row l="Relationship tier" v={TIER_LABEL[vendor.relationship_tier] || "Standard"} />
              </div>

              {/* Tax & Compliance */}
              <div className="vd-card">
                <div className="vd-card-title">Tax &amp; Compliance</div>
                <Row l={vendor.type === "individual" ? "NIK" : "NPWP"} v={vendor.tax_id || "—"} mono gated />
                <Row l="PKP status" v={PKP_LABEL[vendor.pkp] || vendor.pkp} gated />
                <Row l="Tax Invoice (Faktur Pajak)" v={vendor.pkp === "PKP" ? "Required" : "Not required"} />
                <Row l="Withholding" v={withholdingLabel(vendor.pph, !!vendor.tax_id)} gated />
              </div>

              {/* Payment */}
              <div className="vd-card">
                <div className="vd-card-title">Payment</div>
                <Row l="Payment terms" v={termLabel(vendor.payment_terms)} />
                <Row l="Currency" v={vendor.currency || "IDR"} />
                <Row l="AP account" v={ACCT_LABELS[vendor.acct] || vendor.acct || "—"} gated />
              </div>

              {/* Bank accounts — vendor (pay to) + company (pay from) */}
              <div className="vd-card">
                <div className="vd-card-title">Bank Accounts</div>
                <div className="vd-bank-lbl">Vendor bank account <span className="vd-gate" title="Changing this field requires manager approval">⚷</span> <span className="vd-bank-hint">— paid to</span></div>
                {vendor.banks && vendor.banks.length > 0 ? (
                  <div className="vd-bank">
                    <div className="vd-bank-name">{vendor.banks[0].name}{vendor.banks[0].branch ? ` — ${vendor.banks[0].branch}` : ""}</div>
                    <div className="vd-bank-acc">{bankAcc(vendor.banks[0].acc)}</div>
                    <div className="vd-bank-holder">a/n {vendor.banks[0].holder || "—"}</div>
                  </div>
                ) : (
                  <div className="vd-row-val dim" style={{ textAlign: "left", fontSize: 12 }}>
                    No bank account on file.{!canEditBank && " Added by whoever onboards the vendor; a manager approves it."}
                  </div>
                )}
                {canEditBank && (
                  <button className="vd-btn vd-bank-btn" onClick={() => openBank("vendor")}>
                    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    {vendor.banks && vendor.banks.length > 0 ? "Change bank account" : "Add bank account"}
                  </button>
                )}

                <div className="vd-bank-lbl" style={{ marginTop: 16 }}>Company bank account <span className="vd-bank-hint">— paid from</span></div>
                {vendor.company_bank ? (
                  <div className="vd-bank">
                    <div className="vd-bank-name">{vendor.company_bank.name}{vendor.company_bank.branch ? ` — ${vendor.company_bank.branch}` : ""}</div>
                    <div className="vd-bank-acc">{bankAcc(vendor.company_bank.acc)}</div>
                    <div className="vd-bank-holder">a/n {vendor.company_bank.holder || "—"}</div>
                  </div>
                ) : (
                  <div className="vd-row-val dim" style={{ textAlign: "left", fontSize: 12 }}>No paying account set.</div>
                )}
                {canApprove && (
                  <button className="vd-btn vd-bank-btn" onClick={() => openBank("company")}>
                    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    {vendor.company_bank ? "Change company account" : "Set company account"}
                  </button>
                )}
              </div>

              {/* Contacts */}
              <div className="vd-card">
                <div className="vd-card-title">Primary Contact</div>
                <Row l="Name" v={vendor.contact || "—"} />
                <Row l="Role" v={vendor.contact_role || "—"} />
                <Row l="Email" v={vendor.email || "—"} />
                <Row l="Phone" v={vendor.phone || "—"} mono />
              </div>

              {/* Notes */}
              <div className="vd-card span2">
                <div className="vd-card-title">Internal Notes</div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  {vendor.notes || <span className="vd-row-val dim">No notes.</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TRANSACTIONS ────────────────────────────────────────── */}
        {tab === "transactions" && (
          <div className="vd-body">
            <div className="vd-card">
              <div className="vd-tx-head">
                <div>
                  <div className="vd-tx-out-lbl">Outstanding (Open + Overdue)</div>
                  <div className="vd-tx-out">{formatRupiah(outstanding)}</div>
                </div>
              </div>
              {txns.length === 0 ? (
                <div className="vd-empty">No transactions yet for this vendor.</div>
              ) : (
                <div className="vd-tx-tablewrap">
                  <table className="vd-tx-table">
                    <thead>
                      <tr>
                        <th>Invoice No.</th><th>Date</th><th>Due</th>
                        <th style={{ textAlign: "right" }}>Total</th><th>Journal Status</th><th>Payment Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {txns.map((b) => {
                        const ws = workflowStatus(b);
                        const journalLabel = ws === "PAID" ? "Posted" : STATUS_LABEL[ws];
                        const ps = b.pay === "paid" ? "paid" : statusOf(b.id);
                        const pm = PAYMENT_STATUS_META[ps] || PAYMENT_STATUS_META.unpaid;
                        return (
                          <tr key={b.id} className="vd-tx-row" onClick={() => navigate(`/bills/${b.id}`)}>
                            <td style={{ fontFamily: "var(--font-mono)" }}>{b.invNo}</td>
                            <td>{formatDate(b.date)}</td>
                            <td>{formatDate(b.due)}</td>
                            <td className="num">{formatRupiah(b.total)}</td>
                            <td><span className={`vd-badge ${journalTone(ws)}`}>{journalLabel}</span></td>
                            <td><span className={`vd-badge ${pm.tone}`}>{pm.label}</span></td>
                            <td style={{ textAlign: "right", color: "var(--color-action)" }}>→</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── VERSIONS ────────────────────────────────────────────── */}
        {tab === "versions" && (
          <div className="vd-body">
            <div className="vd-card">
              <div className="vd-card-title">Version history</div>
              <div className="vd-ver-intro">Each completed approval cycle freezes the vendor's full record as a version.</div>
              {vlist.length === 0 ? (
                <div className="vd-empty">No approved version yet — this vendor has never completed an approval cycle.</div>
              ) : (
                <div className="vd-ver-list">
                  {vlist.map((ver, i) => {
                    const open = openVer === ver.versionId;
                    return (
                      <div className={`vd-ver${open ? " open" : ""}`} key={ver.versionId}>
                        <button className="vd-ver-head" onClick={() => setOpenVer(open ? null : ver.versionId)}>
                          <span className="vd-ver-caret">{open ? "▾" : "▸"}</span>
                          <span className="vd-ver-id">{ver.versionId}</span>
                          {i === 0 && <span className="vd-ver-current">Current</span>}
                          <span className="vd-ver-meta">approved {formatDate(ver.approvedAt)} · {ver.approvedBy}</span>
                          <span className="vd-ver-changed">
                            {ver.changedFields.length > 0
                              ? `changed: ${ver.changedFields.map((f) => VER_FIELD_LABEL[f] || f).join(", ")}`
                              : "initial version"}
                          </span>
                        </button>
                        {open && <VersionSnapshot data={ver.data} reason={ver.reason} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ACTIVITY ────────────────────────────────────────────── */}
        {tab === "activity" && (
          <div className="vd-body">
            <div className="vd-card">
              <div className="vd-card-title">Change Log</div>
              {log.length === 0 ? (
                <div className="vd-empty">No changes recorded in this session. Status changes, health overrides, and holds will appear here.</div>
              ) : (
                <ul className="vd-log">
                  {log.map((e, i) => (
                    <li className="vd-log-item" key={i}>
                      <span className="vd-log-dot" />
                      <div className="vd-log-body">
                        <div className="vd-log-action">{e.action} <span className="vd-log-detail">{e.detail}</span></div>
                        <div className="vd-log-meta">{e.actor} · {formatDate(e.ts.slice(0, 10))}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Confirmation modal (Deactivate / Block / Reject) ──────── */}
      {dialog && (
        <div className="vd-modal-overlay" onClick={closeDialog}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">{dialog.title}</div>
            <div className="vd-modal-body">{dialog.body}</div>
            {dialog.reasonRequired && (
              <textarea
                className="vd-modal-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={dialog.reasonPlaceholder}
                autoFocus
              />
            )}
            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={closeDialog}>Cancel</button>
              <button
                className={`vd-btn ${dialog.danger ? "danger" : "primary"}`}
                onClick={confirmDialog}
                disabled={dialog.reasonRequired && reason.trim().length < 10}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change bank account modal (vendor payee = gated · company = logged) ── */}
      {bankTarget && (
        <div className="vd-modal-overlay" onClick={() => setBankTarget(null)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">
              {bankTarget === "company"
                ? (vendor.company_bank ? "Change company account" : "Set company account")
                : (vendor.banks && vendor.banks.length > 0 ? "Change bank account" : "Add bank account")}
            </div>
            <div className="vd-modal-body">
              {bankTarget === "company"
                ? <>The company account this vendor's bills are paid <strong>from</strong>. This is our own account — the change is logged but doesn't require approval.</>
                : <>Bank / payee details are a high-sensitivity change. Saving this sends the vendor back to <strong>Pending approval</strong> — an approver must confirm the new payee before it can post or pay.</>}
            </div>
            <div className="vd-bank-form">
              <label>Bank name</label>
              <input value={bankForm.name} onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })} placeholder="BCA / Mandiri / BNI…" autoFocus />
              <div className="vd-bank-grid">
                <div>
                  <label>Bank code (BI)</label>
                  <input value={bankForm.code} onChange={(e) => setBankForm({ ...bankForm, code: e.target.value })} placeholder="014" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
                <div>
                  <label>Account number</label>
                  <input value={bankForm.acc} onChange={(e) => setBankForm({ ...bankForm, acc: e.target.value })} placeholder="123-456-7890" style={{ fontFamily: "var(--font-mono)" }} />
                </div>
              </div>
              <label>Account holder</label>
              <input value={bankForm.holder} onChange={(e) => setBankForm({ ...bankForm, holder: e.target.value })} placeholder="Registered account name" />
            </div>
            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={() => setBankTarget(null)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveBank} disabled={!bankForm.name.trim() || digitsOnly(bankForm.acc).length < 4}>
                {bankTarget === "company" ? "Save account" : "Save — send for approval"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

function Row({ l, v, mono, gated }) {
  return (
    <div className="vd-row">
      <span className="vd-row-lbl">
        {l}
        {gated && <span className="vd-gate" title="Changing this field requires manager approval">⚷</span>}
      </span>
      <span className={`vd-row-val${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}

// Human labels for changed-field keys shown on a version row.
const VER_FIELD_LABEL = {
  code: "Code", name: "Display name", legal_name: "Legal name", type: "Entity type",
  address: "Address", tax_id: "NPWP/NIK", pkp: "PKP status", pph: "Withholding",
  payment_terms: "Payment terms", currency: "Currency", acct: "AP account",
  banks: "Bank account", company_bank: "Company bank", contact: "Contact",
  contact_role: "Contact role", email: "Email", phone: "Phone", notes: "Notes",
  relationship_tier: "Relationship tier", relationship_tier_note: "Tier note",
  status: "Lifecycle", approval: "Approval",
};

// Read-only full record of a frozen version — mirrors the Details tab layout.
function VersionSnapshot({ data, reason }) {
  const bank = data.banks && data.banks[0];
  return (
    <div className="vd-ver-snap">
      {reason && <div className="vd-ver-reason">Reason: {reason}</div>}
      <div className="vd-ver-grp">Identity</div>
      <Row l="Vendor code" v={data.code} mono />
      <Row l="Legal name" v={data.legal_name || data.name} />
      <Row l="Entity type" v={TYPE_LABEL[data.type] || data.type} />
      <Row l="Address" v={data.address || "—"} />
      <Row l="Relationship tier" v={TIER_LABEL[data.relationship_tier] || "Standard"} />
      <div className="vd-ver-grp">Tax &amp; Compliance</div>
      <Row l={data.type === "individual" ? "NIK" : "NPWP"} v={data.tax_id || "—"} mono />
      <Row l="PKP status" v={PKP_LABEL[data.pkp] || data.pkp} />
      <Row l="Tax Invoice (Faktur Pajak)" v={data.pkp === "PKP" ? "Required" : "Not required"} />
      <Row l="Withholding" v={withholdingLabel(data.pph, !!data.tax_id)} />
      <div className="vd-ver-grp">Payment</div>
      <Row l="Payment terms" v={termLabel(data.payment_terms)} />
      <Row l="Currency" v={data.currency || "IDR"} />
      <Row l="AP account" v={ACCT_LABELS[data.acct] || data.acct || "—"} />
      <div className="vd-ver-grp">Bank Accounts</div>
      <Row l="Vendor bank (paid to)" v={bank ? `${bank.name}${bank.branch ? ` — ${bank.branch}` : ""} · ${bankAcc(bank.acc)} · a/n ${bank.holder || "—"}` : "—"} />
      <Row l="Company bank (paid from)" v={data.company_bank ? `${data.company_bank.name}${data.company_bank.branch ? ` — ${data.company_bank.branch}` : ""} · ${bankAcc(data.company_bank.acc)}` : "—"} />
      <div className="vd-ver-grp">Primary Contact</div>
      <Row l="Name" v={data.contact || "—"} />
      <Row l="Role" v={data.contact_role || "—"} />
      <Row l="Email" v={data.email || "—"} />
      <Row l="Phone" v={data.phone || "—"} mono />
      <div className="vd-ver-grp">Internal Notes</div>
      <div className="vd-ver-notes">{data.notes || "—"}</div>
    </div>
  );
}
