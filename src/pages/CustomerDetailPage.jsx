import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { INVOICES } from "../data/seed/invoices";
import { useCustomers } from "../state/CustomersContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { formatRupiah, formatDate } from "../lib/format";
import RelationshipTierControl, { TIER_LABEL } from "../components/RelationshipTier";
import "./vendor-detail.css";

// ── Customer Detail (mirror of Vendor Detail, AR side) ───────────────────────
// Full page at /customers/:id. Status bar + health alerts, section grid, a
// Transactions tab (invoices for this customer) and an Activity/change log.
// Lifecycle actions are capability-gated: Approve / Credit hold / Release /
// Deactivate / Reactivate and manual health are the approver control (ar.post —
// Finance Manager + Accounting Manager). SoD: the AR Staff who onboards a
// customer can't approve it or place a credit hold.

const STATUS = {
  pending:  { cls: "pending",  lbl: "Pending · awaiting approval" },
  active:   { cls: "active",   lbl: "Active" },
  inactive: { cls: "inactive", lbl: "Inactive" },
  blocked:  { cls: "blocked",  lbl: "Credit hold" },
};
const HEALTH = { review: "Review", flagged: "Flagged" };
const TYPE_LABEL = { perusahaan: "Company", individu: "Individual" };

// AR invoice payment status → tone + label (seed uses Bahasa enum values).
function invStatusMeta(payStatus) {
  switch (payStatus) {
    case "lunas":      return { tone: "success", label: "Paid" };
    case "overdue":    return { tone: "review",  label: "Overdue" };
    case "sebagian":   return { tone: "action",  label: "Partial" };
    case "belumbayar": return { tone: "muted",   label: "Unpaid" };
    default:           return { tone: "muted",   label: payStatus || "—" };
  }
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { customerById, setCustomerStatus, setCustomerHealth, changeLog } = useCustomers();
  const { user, hasCapability, hasLevel } = useCurrentUser();

  const customer = customerById(id);

  // Approver control (ar.post = Finance Manager + Accounting Manager).
  const canApprove = hasCapability("ar.post");
  const canInvoice = hasLevel("ar", "transact");

  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState("");
  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2200); }
  function openDialog(cfg) { setReason(""); setDialog(cfg); }
  function closeDialog() { setDialog(null); setReason(""); }

  const txns = useMemo(() => {
    if (!customer) return [];
    return INVOICES.filter((inv) => inv.customer === customer.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [customer]);
  const outstanding = useMemo(() => txns.filter((inv) => inv.payStatus !== "lunas").reduce((s, inv) => s + (inv.total || 0), 0), [txns]);
  const log = (customer && changeLog[customer.id]) || [];

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
  const meta = { actor: user.name };
  const doStatus = (status, extra) => { setCustomerStatus(customer.id, status, { ...meta, ...extra }); };
  const overLimit = customer.creditLimit > 0 && (customer.ar || 0) > customer.creditLimit;

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
  const askBlock = () => openDialog({
    title: `Place ${customer.name} on credit hold?`,
    body: "No new invoices will be allowed until the hold is released. Use for over-limit exposure, bad debt, or an open dispute. A reason is required.",
    reasonRequired: true, reasonPlaceholder: "e.g. AR far exceeds the credit limit — pausing new orders until paid down",
    confirmLabel: "Place on hold", danger: true,
    onConfirm: (r) => { doStatus("blocked", { reason: r, event: "Credit hold" }); flash(`${customer.name} placed on credit hold`); },
  });
  const askReject = () => openDialog({
    title: `Reject ${customer.name}?`,
    body: "The draft will be declined and set to Inactive. Record why, so whoever onboarded it can revise and resubmit.",
    reasonRequired: true, reasonPlaceholder: "e.g. NPWP doesn't match the legal name provided",
    confirmLabel: "Reject customer", danger: true,
    onConfirm: (r) => { doStatus("inactive", { reason: r, event: "Rejected" }); flash(`${customer.name} rejected`); },
  });

  const avgInvoice = txns.length ? Math.round(txns.reduce((s, inv) => s + (inv.total || 0), 0) / txns.length) : 0;

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
              {HEALTH[customer.health] && <span className={`vd-hchip ${customer.health}`}>{HEALTH[customer.health]}</span>}
              <RelationshipTierControl customerId={customer.id} />
            </div>
            <div className="vd-sub">
              <span>{customer.code}</span>
              <span>·</span>
              <span>{TYPE_LABEL[customer.type] || customer.type}</span>
              <span>·</span>
              <span>{customer.top}</span>
            </div>
          </div>
          <div className="vd-actions">
            {customer.status === "pending" && canApprove && (
              <>
                <button className="vd-btn primary" onClick={() => { doStatus("active", { event: "Approved" }); flash(`${customer.name} approved`); }}>
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Approve
                </button>
                <button className="vd-btn danger" onClick={askReject}>
                  <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Reject
                </button>
              </>
            )}
            {customer.status === "blocked" && canApprove && (
              <button className="vd-btn primary" onClick={() => { doStatus("active", { event: "Credit hold released" }); flash(`${customer.name} released`); }}>
                <svg viewBox="0 0 24 24"><path d="M7 11V7a5 5 0 0 1 9.9-1" /><rect x="4" y="11" width="16" height="10" rx="2" /></svg> Release hold
              </button>
            )}
            {customer.status === "inactive" && canApprove && (
              <button className="vd-btn" onClick={() => { doStatus("active", { event: "Reactivated" }); flash(`${customer.name} reactivated`); }}>
                <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Reactivate
              </button>
            )}
            {customer.status === "active" && canApprove && (
              <>
                <button className="vd-btn" onClick={askDeactivate}>Deactivate</button>
                <button className="vd-btn danger" onClick={askBlock}>Credit hold</button>
              </>
            )}
            {canInvoice && <button className="vd-btn" onClick={() => flash("New invoice (demo)")}>
              <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg> New Invoice
            </button>}
          </div>
        </div>

        {/* ── Health / status alert ───────────────────────────────── */}
        {customer.health === "flagged" && (
          <div className="vd-alert flagged">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div><strong>Flagged.</strong> This customer has a flagged health signal (over-limit exposure, bad-debt risk, or a manual flag). Review before issuing new invoices or extending credit.</div>
          </div>
        )}
        {customer.health === "review" && (
          <div className="vd-alert review">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            <div><strong>Review recommended.</strong> Something about this customer is worth a look — check the AR balance against the credit limit and recent payment behaviour.</div>
          </div>
        )}
        {overLimit && customer.status !== "blocked" && (
          <div className="vd-alert review" style={{ marginTop: customer.health && customer.health !== "healthy" ? 10 : 0 }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            <div><strong>Over credit limit.</strong> AR <strong>{formatRupiah(customer.ar)}</strong> exceeds the limit of <strong>{formatRupiah(customer.creditLimit)}</strong>. Consider a credit hold or a limit review before new orders.</div>
          </div>
        )}
        {customer.status === "pending" && (
          <div className="vd-alert info" style={{ marginTop: (customer.health && customer.health !== "healthy") || overLimit ? 10 : 0 }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Draft — awaiting approval.</strong> {canApprove ? "Review the details, then Approve to activate — or Reject to send it back." : "An approver (Finance Manager or Accounting Manager) confirms the details and activates it."}</div>
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
                <Row l="Display name" v={customer.name} />
                <Row l="Legal name" v={customer.legalName || customer.name} />
                <Row l="Customer code" v={customer.code} mono />
                <Row l="Entity type" v={TYPE_LABEL[customer.type] || customer.type} />
                <Row l="Relationship tier" v={TIER_LABEL[customer.relationship_tier] || "Standard"} />
                <Row l="Address" v={customer.address || "—"} />
              </div>

              {/* Tax & Compliance */}
              <div className="vd-card">
                <div className="vd-card-title">
                  Tax &amp; Compliance
                  {canApprove && (
                    <span className="vd-health-set">
                      {["healthy", "review", "flagged"].map((h) => (
                        <button key={h} className={`${customer.health === h ? `on ${h}` : ""}`}
                          onClick={() => { setCustomerHealth(customer.id, h, meta); flash(`Health set to ${h}`); }}>
                          {h === "healthy" ? "Healthy" : HEALTH[h]}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
                <Row l="NPWP" v={customer.npwp || "—"} mono />
                <Row l="Health" v={customer.health === "healthy" || !customer.health ? "Current" : HEALTH[customer.health]} />
              </div>

              {/* Credit & Terms */}
              <div className="vd-card">
                <div className="vd-card-title">Credit &amp; Terms</div>
                <Row l="Payment terms" v={customer.top || "—"} />
                <Row l="Credit limit" v={customer.creditLimit > 0 ? formatRupiah(customer.creditLimit) : "—"} />
                <Row l="AR balance" v={customer.ar > 0 ? formatRupiah(customer.ar) : "—"} />
                <Row l="Currency" v={customer.currency || "IDR"} />
              </div>

              {/* Invoicing */}
              <div className="vd-card">
                <div className="vd-card-title">Invoicing</div>
                <Row l="Invoice mode" v={customer.invMode === "auto" ? "Automatic" : "Manual"} />
                <Row l="Channel" v={customer.invCh?.length > 0 ? customer.invCh.join(", ") : "—"} />
                <Row l="Last invoice" v={customer.lastInv ? formatDate(customer.lastInv) : "—"} />
              </div>

              {/* Contacts */}
              <div className="vd-card">
                <div className="vd-card-title">Primary Contact</div>
                <Row l="Name" v={customer.contacts?.[0]?.name || "—"} />
                <Row l="Role" v={customer.contacts?.[0]?.title || "—"} />
                <Row l="Email" v={customer.contacts?.[0]?.email || "—"} />
                <Row l="Phone" v={customer.contacts?.[0]?.phone || "—"} mono />
              </div>

              {/* Notes */}
              <div className="vd-card">
                <div className="vd-card-title">Internal Notes</div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                  {customer.notes || <span className="vd-row-val dim">No notes.</span>}
                </div>
              </div>

              {/* Health panel */}
              <div className="vd-card span2">
                <div className="vd-card-title">Customer Health</div>
                {txns.length === 0 ? (
                  <div className="vd-row-val dim" style={{ textAlign: "left", fontSize: 12 }}>
                    No transaction history yet — behavioural metrics appear once this customer has activity.
                  </div>
                ) : (
                  <div className="vd-metrics">
                    <div><div className="vd-metric-lbl">Outstanding</div><div className={`vd-metric-val${outstanding > 0 ? " danger" : ""}`}>{outstanding > 0 ? formatRupiah(outstanding) : "—"}</div></div>
                    <div><div className="vd-metric-lbl">Invoices</div><div className="vd-metric-val">{txns.length}</div></div>
                    <div><div className="vd-metric-lbl">Avg invoice</div><div className="vd-metric-val">{formatRupiah(avgInvoice)}</div></div>
                    <div><div className="vd-metric-lbl">Last invoice</div><div className="vd-metric-val" style={{ fontSize: 13 }}>{customer.lastInv ? formatDate(customer.lastInv) : "—"}</div></div>
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

        {/* ── ACTIVITY ────────────────────────────────────────────── */}
        {tab === "activity" && (
          <div className="vd-body">
            <div className="vd-card">
              <div className="vd-card-title">Change Log</div>
              {log.length === 0 ? (
                <div className="vd-empty">No changes recorded in this session. Status changes, health overrides, and credit holds will appear here.</div>
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
