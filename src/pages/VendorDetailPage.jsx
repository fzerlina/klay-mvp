import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BILLS } from "../data/seed/bills";
import { useVendors } from "../state/VendorsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePayments, PAYMENT_STATUS_META } from "../state/PaymentsContext";
import { workflowStatus, STATUS_LABEL } from "../lib/billStatus";
import { CAT_LABELS, PPH_LABELS, ACCT_LABELS } from "../data/labels";
import { formatRupiah, formatDate } from "../lib/format";
import RelationshipTierControl, { TIER_LABEL } from "../components/RelationshipTier";
import "./vendor-detail.css";

// ── Vendor Detail (Vendor Master PRD — detail / confirmation screen) ─────────
// Full page at /vendors/:id. Status bar + health alerts, section grid, a real
// Transactions tab (bills for this vendor) and an Activity/change log.
// Lifecycle actions are capability-gated: Approve / Block / Unblock / Deactivate
// / Reactivate and manual health are the approver control (ap.post — Finance
// Manager + Accounting Manager, a prototype stand-in for vendor.confirm /
// vendor.hold). SoD: the AP Staff who onboards can't approve or hold.

const STATUS = {
  pending:  { cls: "pending",  lbl: "Pending · awaiting approval" },
  active:   { cls: "active",   lbl: "Active" },
  inactive: { cls: "inactive", lbl: "Inactive" },
  blocked:  { cls: "blocked",  lbl: "Blocked" },
};
const PKP_LABEL = { PKP: "PKP — VAT-registered", NON_PKP: "Non-PKP", UNKNOWN: "Unknown — not set" };
const HEALTH = { review: "Review", flagged: "Flagged" };
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
  const { vendorById, setVendorStatus, setVendorHealth, addVendorBank, changeLog } = useVendors();
  const { user, hasCapability, hasLevel } = useCurrentUser();
  const { statusOf } = usePayments();

  const vendor = vendorById(id);

  // Approver control (ap.post = Finance Manager + Accounting Manager). Stand-in
  // for the future vendor.confirm / vendor.hold capabilities.
  const canApprove = hasCapability("ap.post");
  const canBill = hasLevel("ap", "transact");

  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState(null); // confirmation modal config
  const [reason, setReason] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
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
  const meta = { actor: user.name };
  const doStatus = (status, extra) => { setVendorStatus(vendor.id, status, { ...meta, ...extra }); };

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
  const askBlock = () => openDialog({
    title: `Block ${vendor.name}?`,
    body: "No new invoices or payments will be allowed until the block is released. A reason is required.",
    reasonRequired: true, reasonPlaceholder: "e.g. Bank account fraud alert — verifying with the vendor directly",
    confirmLabel: "Block vendor", danger: true,
    onConfirm: (r) => { doStatus("blocked", { reason: r, event: "Blocked" }); flash(`${vendor.name} blocked`); },
  });
  const askReject = () => openDialog({
    title: `Reject ${vendor.name}?`,
    body: "The draft will be declined and set to Inactive. Record why, so whoever onboarded it can revise and resubmit.",
    reasonRequired: true, reasonPlaceholder: "e.g. NPWP doesn't match the company name on the invoice",
    confirmLabel: "Reject vendor", danger: true,
    onConfirm: (r) => { doStatus("inactive", { reason: r, event: "Rejected" }); flash(`${vendor.name} rejected`); },
  });

  // Add bank account (Tier 3 — vendor.manage_bank; here gated to managers). The
  // PRD flow: a manager adds the payout bank at confirmation, then activates.
  const openBank = () => { setBankForm(BLANK_BANK); setBankOpen(true); };
  function saveBank() {
    if (!bankForm.name.trim() || digitsOnly(bankForm.acc).length < 4) return;
    addVendorBank(vendor.id, { ...bankForm }, { actor: user.name });
    setBankOpen(false);
    flash("Bank account added");
  }

  // Derived health-panel metrics (PRD Zone 7 — populated when history exists).
  const avgInvoice = txns.length ? Math.round(txns.reduce((s, b) => s + (b.total || 0), 0) / txns.length) : 0;

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
              {HEALTH[vendor.health] && <span className={`vd-hchip ${vendor.health}`}>{HEALTH[vendor.health]}</span>}
              <RelationshipTierControl vendorId={vendor.id} />
            </div>
            <div className="vd-sub">
              <span>{vendor.code}</span>
              <span>·</span>
              <span>{CAT_LABELS[vendor.category] || vendor.category}</span>
              <span>·</span>
              <span>{TYPE_LABEL[vendor.type] || vendor.type}</span>
            </div>
          </div>
          <div className="vd-actions">
            {vendor.status === "pending" && canApprove && (
              <>
                <button className="vd-btn primary" onClick={() => { doStatus("active", { event: "Approved" }); flash(`${vendor.name} approved`); }}>
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Approve
                </button>
                <button className="vd-btn danger" onClick={askReject}>
                  <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Reject
                </button>
              </>
            )}
            {vendor.status === "blocked" && canApprove && (
              <button className="vd-btn primary" onClick={() => { doStatus("active"); flash(`${vendor.name} unblocked`); }}>
                <svg viewBox="0 0 24 24"><path d="M7 11V7a5 5 0 0 1 9.9-1" /><rect x="4" y="11" width="16" height="10" rx="2" /></svg> Unblock
              </button>
            )}
            {vendor.status === "inactive" && canApprove && (
              <button className="vd-btn" onClick={() => { doStatus("active"); flash(`${vendor.name} reactivated`); }}>
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Reactivate
              </button>
            )}
            {vendor.status === "active" && canApprove && (
              <>
                <button className="vd-btn" onClick={askDeactivate}>Deactivate</button>
                <button className="vd-btn danger" onClick={askBlock}>Block</button>
              </>
            )}
            {canBill && <button className="vd-btn" onClick={() => flash("New bill (demo)")}>
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> New Bill
            </button>}
          </div>
        </div>

        {/* ── Health / status alert ───────────────────────────────── */}
        {vendor.health === "flagged" && (
          <div className="vd-alert flagged">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div><strong>Flagged.</strong> This vendor has a flagged health signal (tax inconsistency, bank mismatch, or a manual flag). Review before posting new invoices or releasing payment.</div>
          </div>
        )}
        {vendor.health === "review" && (
          <div className="vd-alert review">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            <div><strong>Review recommended.</strong> Something about this vendor is worth a look — hover the chip on the list, or check the tax classification and recent activity.</div>
          </div>
        )}
        {vendor.status === "pending" && (
          <div className="vd-alert info" style={{ marginTop: vendor.health && vendor.health !== "healthy" ? 10 : 0 }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Draft — awaiting approval.</strong> {canApprove ? `Review the details${(!vendor.banks || vendor.banks.length === 0) ? ", add the vendor's bank account," : ","} then Approve to activate — or Reject to send it back.` : "An approver (Finance Manager or Accounting Manager) confirms tax details, adds the bank account, and activates it."}</div>
          </div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="vd-tabs">
          {[["overview", "Overview"], ["transactions", "Transactions"], ["activity", "Activity"]].map(([k, lbl]) => (
            <button key={k} className={`vd-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
              {lbl}
              {k === "transactions" && txns.length > 0 && <span className="vd-tab-count">{txns.length}</span>}
              {k === "activity" && log.length > 0 && <span className="vd-tab-count">{log.length}</span>}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ────────────────────────────────────────────── */}
        {tab === "overview" && (
          <div className="vd-body">
            <div className="vd-grid">
              {/* Identity */}
              <div className="vd-card">
                <div className="vd-card-title">Identity</div>
                <Row l="Display name" v={vendor.name} />
                <Row l="Legal name" v={vendor.legal_name || vendor.name} />
                <Row l="Vendor code" v={vendor.code} mono />
                <Row l="Entity type" v={TYPE_LABEL[vendor.type] || vendor.type} />
                <Row l="Category" v={CAT_LABELS[vendor.category] || vendor.category} />
                <Row l="Relationship tier" v={TIER_LABEL[vendor.relationship_tier] || "Standard"} />
                <Row l="Address" v={vendor.address || "—"} />
              </div>

              {/* Tax & Compliance */}
              <div className="vd-card">
                <div className="vd-card-title">
                  Tax &amp; Compliance
                  {canApprove && (
                    <span className="vd-health-set">
                      {["healthy", "review", "flagged"].map((h) => (
                        <button key={h} className={`${vendor.health === h ? `on ${h}` : ""}`}
                          onClick={() => { setVendorHealth(vendor.id, h, meta); flash(`Health set to ${h}`); }}>
                          {h === "healthy" ? "Healthy" : HEALTH[h]}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                <Row l="NPWP" v={vendor.tax_id || "—"} mono />
                <Row l="PKP status" v={PKP_LABEL[vendor.pkp] || vendor.pkp} />
                <Row l="PPh category" v={PPH_LABELS[vendor.pph] || vendor.pph} />
                <Row l="Health" v={vendor.health === "healthy" || !vendor.health ? "Current" : HEALTH[vendor.health]} />
              </div>

              {/* Payment */}
              <div className="vd-card">
                <div className="vd-card-title">Payment</div>
                <Row l="Payment terms" v={vendor.payment_terms || "—"} />
                <Row l="Currency" v={vendor.currency || "IDR"} />
                <Row l="Reconciliation account" v={ACCT_LABELS[vendor.acct] || vendor.acct || "—"} />
              </div>

              {/* Bank accounts */}
              <div className="vd-card">
                <div className="vd-card-title">Bank Account</div>
                {vendor.banks && vendor.banks.length > 0 ? (
                  vendor.banks.map((b, i) => (
                    <div className="vd-bank" key={i}>
                      {b.isDefault && <div className="vd-bank-def">Default</div>}
                      <div className="vd-bank-name">{b.name}{b.branch ? ` — ${b.branch}` : ""}</div>
                      <div className="vd-bank-acc">{bankAcc(b.acc)}</div>
                      <div className="vd-bank-holder">a/n {b.holder || "—"}</div>
                    </div>
                  ))
                ) : (
                  <div className="vd-row-val dim" style={{ textAlign: "left", fontSize: 12 }}>
                    No bank account on file.{!canApprove && " Added by a manager before the vendor is activated."}
                  </div>
                )}
                {canApprove && (
                  <button className="vd-btn" style={{ marginTop: 12 }} onClick={openBank}>
                    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Add bank account
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
              <div className="vd-card">
                <div className="vd-card-title">Internal Notes</div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  {vendor.notes || <span className="vd-row-val dim">No notes.</span>}
                </div>
              </div>

              {/* Health panel (PRD Zone 7) */}
              <div className="vd-card span2">
                <div className="vd-card-title">Vendor Health</div>
                {txns.length === 0 ? (
                  <div className="vd-row-val dim" style={{ textAlign: "left", fontSize: 12 }}>
                    No transaction history yet — behavioural metrics appear once this vendor has activity.
                  </div>
                ) : (
                  <div className="vd-metrics">
                    <div><div className="vd-metric-lbl">Outstanding</div><div className={`vd-metric-val${outstanding > 0 ? " danger" : ""}`}>{outstanding > 0 ? formatRupiah(outstanding) : "—"}</div></div>
                    <div><div className="vd-metric-lbl">Transactions</div><div className="vd-metric-val">{txns.length}</div></div>
                    <div><div className="vd-metric-lbl">Avg invoice</div><div className="vd-metric-val">{formatRupiah(avgInvoice)}</div></div>
                    <div><div className="vd-metric-lbl">Last transaction</div><div className="vd-metric-val" style={{ fontSize: 13 }}>{vendor.lastTx ? formatDate(vendor.lastTx) : "—"}</div></div>
                  </div>
                )}
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

      {/* ── Add bank account modal (Tier 3 — vendor.manage_bank) ──── */}
      {bankOpen && (
        <div className="vd-modal-overlay" onClick={() => setBankOpen(false)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">Add bank account</div>
            <div className="vd-modal-body">
              Bank details are a high-sensitivity change — set the vendor's payout account here, then Approve to activate.
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
              <button className="vd-btn" onClick={() => setBankOpen(false)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveBank} disabled={!bankForm.name.trim() || digitsOnly(bankForm.acc).length < 4}>Add account</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

function Row({ l, v, mono }) {
  return (
    <div className="vd-row">
      <span className="vd-row-lbl">{l}</span>
      <span className={`vd-row-val${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}
