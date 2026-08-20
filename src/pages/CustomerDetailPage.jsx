import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { INVOICES } from "../data/seed/invoices";
import { useCustomers, AR_ACCT_LABELS, shipsToBilling } from "../state/CustomersContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { withholdingLabel } from "../data/labels";
import { formatRupiah, formatDate, termLabel } from "../lib/format";
import RelationshipTierControl, { TIER_LABEL } from "../components/RelationshipTier";
import "./vendor-detail.css";

// ── Customer Detail (mirror of Vendor Detail, AR side) ───────────────────────
// Full page at /customers/:id. Two status axes (lifecycle + approval) plus an
// independent credit-hold flag, a section grid, an Invoices tab, version history,
// and an Audit log. Lifecycle/approval/hold actions are capability-gated:
// Submit is the maker action (ar transact); Approve / Reject / Deactivate /
// Reactivate / Credit hold / Release are the approver control (ar.post — Finance
// Manager + Accounting Manager). SoD: the AR Staff who onboards can't approve.

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
const TYPE_LABEL = { perusahaan: "Company", individu: "Individual" };

function digitsOnly(s) { return (s || "").replace(/\D/g, ""); }
function bankAcc(acc) {
  const d = digitsOnly(acc);
  return d.length > 4 ? `•••• ${d.slice(-4)}` : acc;
}

// AR invoice payment status → tone + label.
function invStatusMeta(payStatus) {
  switch (payStatus) {
    case "paid":       return { tone: "success", label: "Paid" };
    case "overdue":    return { tone: "review",  label: "Overdue" };
    case "partial":    return { tone: "action",  label: "Partial" };
    case "unpaid":     return { tone: "muted",   label: "Unpaid" };
    default:           return { tone: "muted",   label: payStatus || "—" };
  }
}
const BLANK_BANK = { name: "", code: "", branch: "", acc: "", holder: "" };

// Withholding label. The shared helper says "rate set per bill" for PPh 21,
// which is true on the AP side — on AR the rate lives on the customer record and
// is shown on its own row, so drop the suffix here.
function whtLabel(c) {
  return c.pph === "pph21" ? "PPh 21" : withholdingLabel(c.pph, !!c.npwp);
}

// Ship-to as shown on the record: the explicit address, or the billing fallback.
function shipToLabel(c) {
  return shipsToBilling(c) ? "Same as billing address" : c.shippingAddress;
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { customerById, setCustomerStatus, submitCustomer, rejectCustomer, setCustomerApproval, setCustomerHold, setCompanyBank, changeLog, versionsOf } = useCustomers();
  const { user, hasCapability, hasLevel } = useCurrentUser();

  const customer = customerById(id);

  // Approver control (ar.post = Finance Manager + Accounting Manager).
  const canApprove = hasCapability("ar.post");
  const canInvoice = hasLevel("ar", "transact");

  const [tab, setTab] = useState("overview");
  const [openVer, setOpenVer] = useState(null); // expanded version snapshot id
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState("");
  const [bankOpen, setBankOpen] = useState(false); // receiving-account editor
  const [bankForm, setBankForm] = useState(BLANK_BANK);
  const [toast, setToast] = useState("");
  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2200); }
  function openDialog(cfg) { setReason(""); setDialog(cfg); }
  function closeDialog() { setDialog(null); setReason(""); }

  const txns = useMemo(() => {
    if (!customer) return [];
    return INVOICES.filter((inv) => inv.customer === customer.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [customer]);
  const outstanding = useMemo(() => txns.filter((inv) => inv.payStatus !== "paid").reduce((s, inv) => s + (inv.total || 0), 0), [txns]);
  const log = (customer && changeLog[customer.id]) || [];
  const vlist = customer ? versionsOf(customer.id) : [];

  if (!customer) {
    return (
      <div className="vd-page">
        <div className="vd-empty" style={{ marginTop: 80 }}>
          Customer not found.{" "}
          <button className="vd-btn" style={{ marginTop: 14 }} onClick={() => navigate("/customers")}>Back to Customers</button>
        </div>
      </div>
    );
  }

  const st = STATUS[customer.status] || STATUS.active;
  const appr = APPROVAL[customer.approval] || APPROVAL.approved;
  const isDraft = customer.status === "draft";
  // "Awaiting approval" = submitted (Active) but not yet approved. A Draft is
  // pre-submit, so its Approve/Reject don't show until it's submitted.
  const awaitingApproval = !isDraft && customer.approval === "pending_approval";
  // Credit used = open receivables (unpaid + overdue + partial). Paid invoices
  // drop out, so this is live exposure rather than lifetime billed volume.
  const creditUsed = customer.ar || 0;
  const overLimit = customer.creditLimit > 0 && creditUsed > customer.creditLimit;
  const creditPct = customer.creditLimit > 0 ? Math.round((creditUsed / customer.creditLimit) * 100) : 0;
  const meta = { actor: user.name };
  const doStatus = (status, extra) => { setCustomerStatus(customer.id, status, { ...meta, ...extra }); };
  const doApprove = () => { setCustomerApproval(customer.id, "approved", { ...meta, event: "Approved" }); };

  function confirmDialog() {
    if (!dialog) return;
    if (dialog.reasonRequired && reason.trim().length < 10) return;
    dialog.onConfirm(reason.trim());
    closeDialog();
  }

  // ── Confirmation-modal openers ────────────────────────────────────────────
  const askDeactivate = () => openDialog({
    title: `Deactivate ${customer.name}?`,
    body: "This customer won't be available for new invoices. You can reactivate it later.",
    reasonRequired: false, confirmLabel: "Deactivate", danger: false,
    onConfirm: (r) => { doStatus("inactive", { reason: r, event: "Deactivated" }); flash(`${customer.name} set to inactive`); },
  });
  const askHold = () => openDialog({
    title: `Place ${customer.name} on credit hold?`,
    body: "No new invoices should be issued until the hold is released. Use for over-limit exposure, bad-debt risk, or an open dispute. A reason is required.",
    reasonRequired: true, reasonPlaceholder: "e.g. AR far exceeds the credit limit — pausing new orders until paid down",
    confirmLabel: "Place on hold", danger: true,
    onConfirm: (r) => { setCustomerHold(customer.id, true, { reason: r, actor: user.name }); flash(`${customer.name} placed on credit hold`); },
  });
  const askReject = () => openDialog({
    title: `Reject ${customer.name}?`,
    body: (customer.current_version || 0) === 0
      ? "This returns the customer to Draft so whoever onboarded it can revise and resubmit. Record why."
      : "This discards the pending change; the customer stays on its last approved version. Record why.",
    reasonRequired: true, reasonPlaceholder: "e.g. NPWP doesn't match the legal name provided",
    confirmLabel: "Reject", danger: true,
    onConfirm: (r) => { rejectCustomer(customer.id, { reason: r, actor: user.name }); flash(`${customer.name} rejected`); },
  });

  // Change the company (receiving) account — our own account, logged not gated.
  const openBank = () => {
    setBankForm(customer.company_bank ? { ...BLANK_BANK, ...customer.company_bank } : BLANK_BANK);
    setBankOpen(true);
  };
  function saveBank() {
    if (!bankForm.name.trim() || digitsOnly(bankForm.acc).length < 4) return;
    setCompanyBank(customer.id, { ...bankForm }, { actor: user.name });
    flash("Receiving account updated");
    setBankOpen(false);
  }

  const primary = customer.contacts?.[0];

  return (
    <div className="vd-page">
      <div className="vd-scroll">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <div className="vd-top">
          <button className="vd-back" onClick={() => navigate("/customers")} aria-label="Back to Customers">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div className="vd-headinfo">
            <div className="vd-title-row">
              <span className="vd-title">{customer.name}</span>
              {customer.status !== "active" && <span className={`vd-status ${st.cls}`}>{st.lbl}</span>}
              {awaitingApproval && <span className={`vd-status ${appr.cls}`}>{appr.lbl}</span>}
              {customer.on_hold && <span className="vd-status blocked">Credit hold</span>}
              <RelationshipTierControl customerId={customer.id} />
            </div>
            <div className="vd-sub">
              <span>{customer.code}</span>
              <span>·</span>
              <span>{TYPE_LABEL[customer.type] || customer.type}</span>
              <span>·</span>
              <span>{termLabel(customer.top)}</span>
            </div>
          </div>
          <div className="vd-actions">
            {isDraft && canInvoice && (
              <button className="vd-btn primary" onClick={() => { submitCustomer(customer.id, { actor: user.name }); flash(`${customer.name} submitted — now active, pending approval`); }}>
                <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Submit for approval
              </button>
            )}
            {awaitingApproval && canApprove && (
              <>
                <button className="vd-btn primary" onClick={() => { doApprove(); flash(`${customer.name} approved`); }}>
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Approve
                </button>
                <button className="vd-btn danger" onClick={askReject}>
                  <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Reject
                </button>
              </>
            )}
            {customer.status === "inactive" && canApprove && (
              <button className="vd-btn" onClick={() => { doStatus("active", { event: "Reactivated" }); flash(`${customer.name} reactivated`); }}>
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Reactivate
              </button>
            )}
            {customer.status === "active" && canApprove && (
              <button className="vd-btn" onClick={askDeactivate}>Deactivate</button>
            )}
            {customer.status === "active" && !customer.on_hold && canApprove && (
              <button className="vd-btn danger" onClick={askHold}>Credit hold</button>
            )}
            {customer.on_hold && canApprove && (
              <button className="vd-btn primary" onClick={() => { setCustomerHold(customer.id, false, { actor: user.name }); flash(`${customer.name} released from credit hold`); }}>
                <svg viewBox="0 0 24 24"><path d="M7 11V7a5 5 0 0 1 9.9-1" /><rect x="4" y="11" width="16" height="10" rx="2" /></svg> Release hold
              </button>
            )}
            {canInvoice && !isDraft && <button className="vd-btn" onClick={() => flash("New invoice (demo)")}>
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> New Invoice
            </button>}
          </div>
        </div>

        {/* ── Draft / Approval / Hold / Over-limit alerts ─────────── */}
        {isDraft && (
          <div className="vd-alert info">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Draft.</strong> This customer can't be used on invoices yet. {canInvoice ? "Submit it for approval to make it Active — then a manager approves it before it can post." : "Whoever onboarded it submits it for approval to make it Active."}</div>
          </div>
        )}
        {awaitingApproval && (
          <div className="vd-alert info">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Pending approval.</strong> This customer is usable to create invoices, but stays blocking at posting until approved. {canApprove ? "Review the details, then Approve — or Reject to send it back." : "An approver (Finance Manager or Accounting Manager) signs it off."}</div>
          </div>
        )}
        {customer.on_hold && (
          <div className="vd-alert flagged" style={{ marginTop: (isDraft || awaitingApproval) ? 10 : 0 }}>
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div><strong>Credit hold.</strong> No new invoices should be issued until released.{customer.hold_reason ? ` Reason: ${customer.hold_reason}` : ""} {canApprove ? "Use Release hold once resolved." : "An approver releases the hold."}</div>
          </div>
        )}
        {overLimit && !customer.on_hold && (
          <div className="vd-alert review" style={{ marginTop: (isDraft || awaitingApproval) ? 10 : 0 }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            <div><strong>Over credit limit.</strong> AR <strong>{formatRupiah(customer.ar)}</strong> exceeds the limit of <strong>{formatRupiah(customer.creditLimit)}</strong>. Consider a credit hold or a limit review before new orders.</div>
          </div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="vd-tabs">
          {[["overview", "Details"], ["transactions", "Invoices & Payment History"], ["versions", "Versions"], ["activity", "Audit log"]].map(([k, lbl]) => (
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
              <span className="vd-gate">⚷</span> Changing a marked field starts a new approval cycle — the customer stays usable to create invoices but is blocked at posting until re-approved.
            </div>
            <div className="vd-grid">
              {/* Status — the two axes + hold */}
              <div className="vd-card">
                <div className="vd-card-title">Status</div>
                <Row l="Lifecycle status" v={st.lbl} />
                <Row l="Approval status" v={appr.lbl} />
                <Row l="Current version" v={vlist[0]?.versionId || "— none yet"} />
                {customer.on_hold && <Row l="Credit hold" v={customer.hold_reason || "On hold"} />}
              </div>

              {/* Identity */}
              <div className="vd-card">
                <div className="vd-card-title">Identity</div>
                <Row l="Customer code" v={customer.code} mono />
                <Row l="Legal name" v={customer.legalName || customer.name} gated />
                <Row l="Entity type" v={TYPE_LABEL[customer.type] || customer.type} />
                <Row l="Billing address" v={customer.address || "—"} />
                <Row l="Shipping address" v={shipToLabel(customer)} />
                <Row l="Relationship tier" v={TIER_LABEL[customer.relationship_tier] || "Standard"} />
              </div>

              {/* Tax & Compliance */}
              <div className="vd-card">
                <div className="vd-card-title">Tax &amp; Compliance</div>
                <Row l={customer.type === "individu" ? "NIK / NPWP" : "NPWP"} v={customer.npwp || "—"} mono gated />
                <Row l="Withholding" v={whtLabel(customer)} gated />
                {customer.pph === "pph21" && (
                  <Row l="PPh 21 rate" v={customer.pph21Rate != null ? `${customer.pph21Rate}%` : "— not set"} gated />
                )}
              </div>

              {/* Credit & Terms */}
              <div className="vd-card">
                <div className="vd-card-title">Credit &amp; Terms</div>
                <Row l="Payment terms" v={termLabel(customer.top)} gated />
                <Row l="Credit limit" v={customer.creditLimit > 0 ? formatRupiah(customer.creditLimit) : "— none set"} gated />
                <Row
                  l="Credit used"
                  v={
                    <span className="vd-credit">
                      <span className={overLimit ? "vd-credit-val over" : "vd-credit-val"}>{formatRupiah(creditUsed)}</span>
                      {customer.creditLimit > 0 && <span className="vd-credit-pct">{creditPct}% of limit</span>}
                      {overLimit && <span className="vd-over-chip">Over limit</span>}
                    </span>
                  }
                />
                {customer.creditLimit > 0 && (
                  <div className="vd-credit-bar">
                    <div className={overLimit ? "vd-credit-fill over" : "vd-credit-fill"} style={{ width: `${Math.min(creditPct, 100)}%` }} />
                  </div>
                )}
                <Row l="Currency" v={customer.currency || "IDR"} />
              </div>

              {/* Receiving account — our house account, single */}
              <div className="vd-card">
                <div className="vd-card-title">Receiving Account</div>
                <div className="vd-bank-lbl">Company receiving account <span className="vd-bank-hint">— paid into</span></div>
                {customer.company_bank ? (
                  <div className="vd-bank">
                    <div className="vd-bank-name">{customer.company_bank.name}{customer.company_bank.branch ? ` — ${customer.company_bank.branch}` : ""}</div>
                    <div className="vd-bank-acc">{bankAcc(customer.company_bank.acc)}</div>
                    <div className="vd-bank-holder">a/n {customer.company_bank.holder || "—"}</div>
                  </div>
                ) : (
                  <div className="vd-row-val dim" style={{ textAlign: "left", fontSize: 12 }}>No receiving account set.</div>
                )}
                {canApprove && (
                  <button className="vd-btn vd-bank-btn" onClick={openBank}>
                    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    {customer.company_bank ? "Change receiving account" : "Set receiving account"}
                  </button>
                )}
              </div>

              {/* AR accounts — the GL control accounts this customer may post to.
                  Deliberately separate from the receiving account above: the bank
                  we get paid into has nothing to do with the AR account we post to. */}
              <div className="vd-card">
                <div className="vd-card-title">AR Accounts</div>
                {(customer.accts || []).map((a) => (
                  <div className="vd-acct-row" key={a}>
                    <span className="vd-acct-code">{AR_ACCT_LABELS[a] || a}</span>
                    {a === customer.defaultAcct && <span className="vd-acct-default">Default</span>}
                  </div>
                ))}
                {(customer.accts || []).length === 0 && (
                  <div className="vd-row-val dim" style={{ textAlign: "left", fontSize: 12 }}>No AR account set.</div>
                )}
                <div className="vd-acct-hint">An invoice opens on the default and can post to any permitted account.</div>
              </div>


              {/* Contacts */}
              <div className="vd-card">
                <div className="vd-card-title">Primary Contact</div>
                <Row l="Name" v={primary?.name || "—"} />
                <Row l="Role" v={primary?.title || "—"} />
                <Row l="Email" v={primary?.email || "—"} />
                <Row l="Phone" v={primary?.phone || "—"} mono />
              </div>

              {/* Notes */}
              <div className="vd-card span2">
                <div className="vd-card-title">Internal Notes</div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  {customer.notes || <span className="vd-row-val dim">No notes.</span>}
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
                <div className="vd-empty">No invoices yet for this customer.</div>
              ) : (
                <div className="vd-tx-tablewrap">
                  <table className="vd-tx-table">
                    <thead>
                      <tr>
                        <th>Invoice No.</th><th>Date</th><th>Due</th>
                        <th style={{ textAlign: "right" }}>Total</th><th>Payment Status</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {txns.map((inv) => {
                        const pm = invStatusMeta(inv.payStatus);
                        return (
                          <tr key={inv.id} className="vd-tx-row">
                            <td style={{ fontFamily: "var(--font-mono)" }}>{inv.invNo}</td>
                            <td>{formatDate(inv.date)}</td>
                            <td>{formatDate(inv.due)}</td>
                            <td className="num">{formatRupiah(inv.total)}</td>
                            <td><span className={`vd-badge ${pm.tone}`}>{pm.label}</span></td>
                            <td style={{ textAlign: "right", color: "var(--color-text-tertiary)" }} />
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
              <div className="vd-ver-intro">Each completed approval cycle freezes the customer's full record as a version.</div>
              {vlist.length === 0 ? (
                <div className="vd-empty">No approved version yet — this customer has never completed an approval cycle.</div>
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
                <div className="vd-empty">No changes recorded in this session. Status changes, approvals, and credit holds will appear here.</div>
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

      {/* ── Confirmation modal (Deactivate / Credit hold / Reject) ── */}
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

      {/* ── Change receiving account modal (our own account — logged) ── */}
      {bankOpen && (
        <div className="vd-modal-overlay" onClick={() => setBankOpen(false)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">{customer.company_bank ? "Change receiving account" : "Set receiving account"}</div>
            <div className="vd-modal-body">
              The company account this customer's invoices are paid <strong>into</strong>. This is our own account — the change is logged but doesn't require approval.
            </div>
            <div className="vd-bank-form">
              <label>Bank name</label>
              <input value={bankForm.name} onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })} placeholder="BCA / Mandiri / BNI…" autoFocus />
              <div className="vd-bank-grid">
                <div>
                  <label>Branch</label>
                  <input value={bankForm.branch} onChange={(e) => setBankForm({ ...bankForm, branch: e.target.value })} placeholder="KCU Sudirman" />
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
              <button className="vd-btn" onClick={() => setBankOpen(false)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveBank} disabled={!bankForm.name.trim() || digitsOnly(bankForm.acc).length < 4}>Save account</button>
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
  code: "Code", name: "Display name", legalName: "Legal name", type: "Entity type",
  address: "Billing address", shippingAddress: "Shipping address",
  npwp: "NPWP/NIK", pph: "Withholding", pph21Rate: "PPh 21 rate",
  top: "Payment terms", currency: "Currency", creditLimit: "Credit limit",
  accts: "AR accounts", defaultAcct: "Default AR account",
  company_bank: "Receiving account", contacts: "Contacts", notes: "Notes",
  relationship_tier: "Relationship tier", relationship_tier_note: "Tier note",
  status: "Lifecycle", approval: "Approval",
};

// Read-only full record of a frozen version — mirrors the Details tab layout.
function VersionSnapshot({ data, reason }) {
  const c = data.company_bank;
  const primary = data.contacts?.[0];
  return (
    <div className="vd-ver-snap">
      {reason && <div className="vd-ver-reason">Reason: {reason}</div>}
      <div className="vd-ver-grp">Identity</div>
      <Row l="Customer code" v={data.code} mono />
      <Row l="Legal name" v={data.legalName || data.name} />
      <Row l="Entity type" v={TYPE_LABEL[data.type] || data.type} />
      <Row l="Billing address" v={data.address || "—"} />
      <Row l="Shipping address" v={shipToLabel(data)} />
      <Row l="Relationship tier" v={TIER_LABEL[data.relationship_tier] || "Standard"} />
      <div className="vd-ver-grp">Tax &amp; Compliance</div>
      <Row l={data.type === "individu" ? "NIK / NPWP" : "NPWP"} v={data.npwp || "—"} mono />
      {data.pph === "pph21" && (
        <Row l="PPh 21 rate" v={data.pph21Rate != null ? `${data.pph21Rate}%` : "— not set"} />
      )}
      <Row l="Withholding" v={whtLabel(data)} />
      <div className="vd-ver-grp">Credit &amp; Terms</div>
      <Row l="Payment terms" v={termLabel(data.top)} />
      <Row l="Credit limit" v={data.creditLimit > 0 ? formatRupiah(data.creditLimit) : "—"} />
      <Row l="AR accounts" v={(data.accts || []).map((a) => AR_ACCT_LABELS[a] || a).join(" · ") || "—"} />
      <Row l="Default AR account" v={AR_ACCT_LABELS[data.defaultAcct] || data.defaultAcct || "—"} />
      <Row l="Currency" v={data.currency || "IDR"} />
      <div className="vd-ver-grp">Receiving Account</div>
      <Row l="Company receiving account (paid into)" v={c ? `${c.name}${c.branch ? ` — ${c.branch}` : ""} · ${bankAcc(c.acc)} · a/n ${c.holder || "—"}` : "—"} />
      <div className="vd-ver-grp">Primary Contact</div>
      <Row l="Name" v={primary?.name || "—"} />
      <Row l="Role" v={primary?.title || "—"} />
      <Row l="Email" v={primary?.email || "—"} />
      <Row l="Phone" v={primary?.phone || "—"} mono />
      <div className="vd-ver-grp">Internal Notes</div>
      <div className="vd-ver-notes">{data.notes || "—"}</div>
    </div>
  );
}
