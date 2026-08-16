import { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useInventory, VER_FIELD_LABEL } from "../state/InventoryContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { INV_CAT_LABELS, INV_UOM_LABELS, INV_STATUS_META } from "../data/seed/inventory";
import { COSTING_METHOD_LABELS } from "../data/seed/accountingSettings";
import { COA_BY_CODE } from "../data/seed/coa";

const ADJUST_REASONS = ["Stock count", "Damage", "Expiry", "Shrinkage", "Correction"];
const ADJUSTMENT_ACCOUNT = "5-1500"; // Inventory Adjustments (counter-account)
import {
  productUom, productCost, productAccounts, productHistory, productAudit,
  isServiceItem, ACTION_LABELS,
} from "../lib/productDetail";
import { formatRupiah, formatNumber, formatDate } from "../lib/format";
import "./vendor-detail.css";
import "./inventory.css";
import "./product-detail.css";

// ── Inventory / Product Detail ───────────────────────────────────────────────
// Full page at /inventory/:id. A KPI hero (stock count + total value) sits under
// the title; the rest splits across tabs: Information, Cost, Accounts, History,
// Versions, and Audit Trail.
//
// Versioning / approval (mirrors Vendor): editing an Active product routes it to
// Pending Review and it can't be used on bills until an approver (ap.post —
// Finance Manager / Accounting Manager) approves it, which freezes a new version.

export default function InventoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { itemById, updateItem, submitItem, approveItem, rejectItem, adjustStock, versionsOf, changeLog, movementLog } = useInventory();
  const { entries: journalEntries, stagePendingDraft, peekNextJeNumber } = useJournalEntries();
  const { user, hasCapability } = useCurrentUser();
  const { inventoryCostingMethod } = useAccountingSettings();
  const item = itemById(id);

  const [tab, setTab] = useState("information");
  const [histLoc, setHistLoc] = useState("all");
  const [openVer, setOpenVer] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editCost, setEditCost] = useState("");
  const [editSales, setEditSales] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjLoc, setAdjLoc] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjReason, setAdjReason] = useState(ADJUST_REASONS[0]);
  const [adjNote, setAdjNote] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [toast, setToast] = useState("");
  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2200); }

  if (!item) {
    return (
      <div className="vd-page">
        <div className="vd-empty" style={{ marginTop: 80 }}>
          Item not found.{" "}
          <button className="vd-btn" style={{ marginTop: 14 }} onClick={() => navigate("/inventory")}>Back to Inventory</button>
        </div>
      </div>
    );
  }

  const service = isServiceItem(item);
  const status = item.status || "active";
  const out = !service && (item.qty || 0) <= 0;
  const statusMeta = INV_STATUS_META[status] || INV_STATUS_META.active;
  const catLabel = INV_CAT_LABELS[item.category] || item.category;

  const uom = productUom(item);
  const cost = productCost(item);
  const accounts = productAccounts(item);
  // Live stock movements (session) prepended to the seeded baseline.
  const history = [...(movementLog[item.id] || []), ...productHistory(item)];
  const inventoryAccountCode = accounts.find((a) => a.key === "inventory")?.code || null;
  // A movement reaches the GL only once its journal entry posts. Surface each
  // movement's JE status so History reads as a per-item ledger — any non-Posted
  // row is stock the books haven't caught up to yet.
  const jeStatusByNumber = useMemo(
    () => Object.fromEntries(journalEntries.map((e) => [e.je_number, e.status])),
    [journalEntries],
  );
  const vlist = versionsOf(item.id);
  // Live change log (session) newest-first, then the seeded baseline (reversed).
  const auditLog = [...(changeLog[item.id] || []), ...productAudit(item).slice().reverse()];

  // Approver control — ap.post (Finance Manager + Accounting Manager), the same
  // seat that approves vendors. SoD: whoever edits shouldn't also approve.
  const canApprove = hasCapability("ap.post");

  const primaryLabel = uom.primary ? (INV_UOM_LABELS[uom.primary] || uom.primary) : "—";
  const secondaryLabel = uom.secondary ? (INV_UOM_LABELS[uom.secondary] || uom.secondary) : "—";

  const locs = service
    ? []
    : (Array.isArray(item.locations) && item.locations.length ? item.locations : [{ loc: "Main Warehouse", qty: item.qty || 0 }]);
  const locRows = locs.map((l) => ({ loc: l.loc, qty: l.qty || 0, value: (l.qty || 0) * (item.unit_cost || 0) }));

  // Movement History location filter.
  const histLocOptions = locs.map((l) => l.loc);
  const histRows = histLoc === "all" ? history : history.filter((h) => h.loc === histLoc);

  const meta = { actor: user.name };

  function openEdit() {
    setEditCost(String(item.unit_cost ?? ""));
    setEditSales(String(cost.sales_price ?? ""));
    setEditOpen(true);
  }
  function saveEdit() {
    const patch = {};
    if (editCost !== "" && Number(editCost) !== item.unit_cost) patch.unit_cost = Number(editCost);
    if (editSales !== "" && Number(editSales) !== cost.sales_price) patch.sales_price = Number(editSales);
    if (!Object.keys(patch).length) { setEditOpen(false); return; }
    const { routed } = updateItem(item.id, patch, meta);
    setEditOpen(false);
    flash(routed ? "Saved — sent for review" : "Changes saved");
  }
  // ── Stock adjustment → pre-filled manual journal ──────────────────────────
  function openAdjust() {
    setAdjLoc(locs[0]?.loc || "");
    setAdjQty("");
    setAdjReason(ADJUST_REASONS[0]);
    setAdjNote("");
    setAdjustOpen(true);
  }
  const adjTargetQty = locs.find((l) => l.loc === adjLoc)?.qty ?? locs[0]?.qty ?? 0;
  const adjDelta = adjQty === "" ? 0 : (Number(adjQty) || 0) - adjTargetQty;
  const adjValue = adjDelta * (item.unit_cost || 0);
  const invAcctName = inventoryAccountCode ? (COA_BY_CODE[inventoryAccountCode]?.name || inventoryAccountCode) : "Inventory";
  const adjAcctName = COA_BY_CODE[ADJUSTMENT_ACCOUNT]?.name || "Inventory Adjustments";

  function saveAdjust() {
    if (adjQty === "" || adjDelta === 0) { setAdjustOpen(false); return; }
    const jeNo = peekNextJeNumber();
    adjustStock(item.id, { loc: adjLoc, newQty: Number(adjQty), reason: adjReason, note: adjNote, actor: user.name, je_number: jeNo });
    // Decrease → Dr Inventory Adjustments / Cr Inventory. Increase → the reverse.
    const amt = Math.abs(adjValue);
    const decrease = adjDelta < 0;
    const lines = decrease
      ? [
          { account_code: ADJUSTMENT_ACCOUNT, debit: amt, credit: 0, description: `Stock write-down — ${item.name} (${adjReason})` },
          { account_code: inventoryAccountCode, debit: 0, credit: amt, description: `${item.sku} @ ${adjLoc}` },
        ]
      : [
          { account_code: inventoryAccountCode, debit: amt, credit: 0, description: `${item.sku} @ ${adjLoc}` },
          { account_code: ADJUSTMENT_ACCOUNT, debit: 0, credit: amt, description: `Stock increase — ${item.name} (${adjReason})` },
        ];
    stagePendingDraft({ memo: `Stock adjustment — ${item.name} · ${adjLoc} (${adjReason})`, lines });
    setAdjustOpen(false);
    navigate("/journal-entry");
  }

  function doSubmit() { submitItem(item.id, meta); flash("Submitted for review"); }
  function doApprove() { approveItem(item.id, meta); flash("Approved"); }
  function doReject() {
    if (reason.trim().length < 5) return;
    rejectItem(item.id, { ...meta, reason: reason.trim() });
    setRejectOpen(false); setReason(""); flash("Rejected");
  }

  return (
    <div className="vd-page">
      <div className="vd-scroll">
        {/* ── Top bar ─────────────────────────────────────────────── */}
        <div className="vd-top">
          <button className="vd-back" onClick={() => navigate("/inventory")} aria-label="Back to Inventory">
            <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          <div className="vd-headinfo">
            <div className="vd-title-row">
              <span className="vd-title">{item.name}</span>
              <span className={`iv-status iv-status-${statusMeta.tone}`}>{statusMeta.label}</span>
              {out && <span className="vd-status blocked">Out of stock</span>}
            </div>
            <div className="vd-sub">
              <span style={{ fontFamily: "var(--font-mono)" }}>{item.sku}</span>
              <span>·</span>
              <span>{catLabel}</span>
              {item.current_version > 0 && <><span>·</span><span>v{item.current_version}</span></>}
            </div>
          </div>
          <div className="vd-actions">
            <button className="vd-btn" onClick={openEdit}>
              <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg> Edit price
            </button>
            {!service && (
              <button className="vd-btn" onClick={openAdjust}>
                <svg viewBox="0 0 24 24"><path d="M20 12H4" /><path d="M12 4v16" /></svg> Adjust stock
              </button>
            )}
            {status === "draft" && (
              <button className="vd-btn primary" onClick={doSubmit}>
                <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Submit for review
              </button>
            )}
            {status === "pending_review" && canApprove && (
              <>
                <button className="vd-btn primary" onClick={doApprove}>
                  <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg> Approve
                </button>
                <button className="vd-btn danger" onClick={() => { setReason(""); setRejectOpen(true); }}>
                  <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> Reject
                </button>
              </>
            )}
            <button className="vd-btn" onClick={() => navigate("/inventory")}>Back to list</button>
          </div>
        </div>

        {/* ── Lifecycle / gating banner ───────────────────────────── */}
        {status === "draft" && (
          <div className="vd-alert info">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            <div><strong>Draft.</strong> This product can't be used on bills yet. Submit it for review to start the approval cycle.</div>
          </div>
        )}
        {status === "pending_review" && (
          <div className="vd-alert flagged">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div><strong>Pending review.</strong> Changes are awaiting approval — this product can't be used on new bills until approved. {canApprove ? "Review the change, then Approve or Reject." : "An approver (Finance Manager / Accounting Manager) must sign it off."}</div>
          </div>
        )}
        {out && status === "active" && (
          <div className="vd-alert flagged">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
            <div><strong>Out of stock.</strong> This item has zero quantity on hand. Restock before committing it to new orders.</div>
          </div>
        )}

        {/* ── Hero KPIs ───────────────────────────────────────────── */}
        <div className="pd-hero">
          <div className="pd-kpi">
            <div className="pd-kpi-lbl">Stock Count</div>
            <div className="pd-kpi-val">{service ? "—" : <>{(item.qty || 0).toLocaleString("id-ID")} <span className="pd-kpi-unit">{primaryLabel}</span></>}</div>
          </div>
          <div className="pd-kpi">
            <div className="pd-kpi-lbl">Total Stock Value</div>
            <div className="pd-kpi-val">{service ? "—" : formatRupiah(item.value)}</div>
          </div>
          <div className="pd-kpi">
            <div className="pd-kpi-lbl">Cost / Unit</div>
            <div className="pd-kpi-val">{formatRupiah(item.unit_cost)}</div>
          </div>
          <div className="pd-kpi">
            <div className="pd-kpi-lbl">Locations</div>
            <div className="pd-kpi-val">{service ? "—" : locs.length}</div>
          </div>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────── */}
        <div className="vd-tabs">
          {[["information", "Information"], ["cost", "Cost"], ["accounts", "Accounts"], ["history", "History"], ["versions", "Versions"], ["audit", "Audit Trail"]].map(([k, lbl]) => (
            <button key={k} className={`vd-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>
              {lbl}
              {k === "history" && history.length > 0 && <span className="vd-tab-count">{history.length}</span>}
              {k === "versions" && vlist.length > 0 && <span className="vd-tab-count">{vlist.length}</span>}
              {k === "audit" && auditLog.length > 0 && <span className="vd-tab-count">{auditLog.length}</span>}
            </button>
          ))}
        </div>

        {/* ── INFORMATION ─────────────────────────────────────────── */}
        {tab === "information" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card">
                <div className="vd-card-title">Details</div>
                <Row l="Product ID" v={item.sku} mono />
                <Row l="Product Name" v={item.name} />
                <Row l="Category" v={<span className={`cat-badge inv-${item.category}`}>{catLabel}</span>} />
                <Row l="Status" v={statusMeta.label} />
              </div>

              <div className="vd-card">
                <div className="vd-card-title">Unit of Measurement</div>
                <Row l="Primary" v={primaryLabel} />
                <Row l="Secondary" v={secondaryLabel} />
                <Row l="Conversion Ratio" v={uom.ratio ? `1 ${primaryLabel} = ${uom.ratio} ${secondaryLabel}` : "—"} />
              </div>

              {service ? (
                <div className="vd-card span2">
                  <div className="vd-card-title">Stock by Location</div>
                  <div className="dim" style={{ fontSize: 12.5 }}>Service items are not stocked, so they have no location breakdown.</div>
                </div>
              ) : (
                <div className="vd-card span2">
                  <div className="vd-card-title">Stock by Location</div>
                  <div className="vd-tx-tablewrap">
                    <table className="vd-tx-table">
                      <thead>
                        <tr>
                          <th>Location</th>
                          <th className="num">Stock Count</th>
                          <th className="num">Stock Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {locRows.map((l, i) => (
                          <tr key={i}>
                            <td>{l.loc}</td>
                            <td className="num">{l.qty.toLocaleString("id-ID")} {primaryLabel}</td>
                            <td className="num">{formatRupiah(l.value)}</td>
                          </tr>
                        ))}
                        <tr className="pd-loc-total">
                          <td>Total</td>
                          <td className="num">{(item.qty || 0).toLocaleString("id-ID")} {primaryLabel}</td>
                          <td className="num">{formatRupiah(item.value)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── COST ────────────────────────────────────────────────── */}
        {tab === "cost" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card">
                <div className="vd-card-title">Cost &amp; Pricing</div>
                <Row l="Cost / Unit" v={formatRupiah(item.unit_cost)} mono />
                <Row l="Cost Price" v={formatRupiah(cost.cost_price)} mono />
                <Row l="Purchase Price" v={formatRupiah(cost.purchase_price)} mono />
                <Row l="Sales Price" v={formatRupiah(cost.sales_price)} mono />
              </div>
              <div className="vd-card">
                <div className="vd-card-title">Costing Method <span className="pd-ro-tag">Read-only</span></div>
                <Row l="Method" v={service ? "—" : (COSTING_METHOD_LABELS[inventoryCostingMethod] || inventoryCostingMethod)} />
                <div className="pd-ro-note">Costing method is a company-wide policy, set once in <Link to="/inventory-settings" className="pd-je">Accounting Settings</Link> — it can't be changed per product.</div>
              </div>
            </div>
          </div>
        )}

        {/* ── ACCOUNTS ────────────────────────────────────────────── */}
        {tab === "accounts" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card span2">
                <div className="vd-card-title">GL Accounts <span className="pd-ro-tag">Read-only</span></div>
                {accounts.map((a) => (
                  <div className="vd-row" key={a.key}>
                    <span className="vd-row-lbl">{a.label}</span>
                    <span className="vd-row-val pd-acct">
                      {a.name ? <>{a.name} <span className="pd-acct-code">{a.code}</span></> : <span className="dim">Not applicable</span>}
                    </span>
                  </div>
                ))}
                <div className="pd-ro-note">Editable in Product Category Settings.</div>
              </div>
            </div>
          </div>
        )}

        {/* ── HISTORY ─────────────────────────────────────────────── */}
        {tab === "history" && (
          <div className="vd-body">
            <div className="vd-grid">
              <div className="vd-card span2">
                <div className="vd-tx-head">
                  <div className="vd-card-title" style={{ marginBottom: 0 }}>Movement History</div>
                  <div className="pd-hist-sub">Stock movements for this item</div>
                  {histLocOptions.length > 1 && (
                    <select className="pd-hist-filter" value={histLoc} onChange={(e) => setHistLoc(e.target.value)}>
                      <option value="all">All locations</option>
                      {histLocOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  )}
                </div>
                <div className="vd-tx-tablewrap">
                  <table className="vd-tx-table">
                    <thead>
                      <tr>
                        <th>Date</th><th>Action</th><th>Location</th><th className="num">Unit</th>
                        <th className="num">Cost / Unit</th><th className="num">Adjusted Value</th><th>Journal Entry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {histRows.length === 0 && (
                        <tr><td colSpan={7} className="dim" style={{ textAlign: "center", padding: 20 }}>No movements recorded.</td></tr>
                      )}
                      {histRows.map((h, i) => (
                        <tr className="vd-tx-row" key={i}>
                          <td>{formatDate(h.date)}</td>
                          <td><span className={`pd-act pd-act-${h.action}`}>{ACTION_LABELS[h.action] || h.action}</span></td>
                          <td>{h.loc || <span className="dim">—</span>}</td>
                          <td className="num">{h.unit > 0 ? "+" : ""}{h.unit.toLocaleString("id-ID")}</td>
                          <td className="num">{formatRupiah(h.unit_cost)}</td>
                          <td className="num">{h.value < 0 ? "−" : ""}{formatRupiah(Math.abs(h.value))}</td>
                          <td>{h.je
                            ? <span className="pd-je-cell"><Link className="pd-je" to="/journal-entry">{h.je}</Link><JeStatusChip status={h.status || jeStatusByNumber[h.je] || "draft"} /></span>
                            : <span className="dim">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── VERSIONS ────────────────────────────────────────────── */}
        {tab === "versions" && (
          <div className="vd-body">
            <div className="vd-card">
              <div className="vd-card-title">Version history</div>
              <div className="vd-ver-intro">Each completed approval cycle freezes the product's record as a version. Price changes are the usual trigger.</div>
              {vlist.length === 0 ? (
                <div className="vd-empty">No approved version yet — this product has never completed an approval cycle.</div>
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

        {/* ── AUDIT TRAIL ─────────────────────────────────────────── */}
        {tab === "audit" && (
          <div className="vd-body">
            <div className="vd-card span2">
              <div className="vd-card-title">Change Log</div>
              {auditLog.length === 0 ? (
                <div className="vd-empty">No changes recorded.</div>
              ) : (
                <ul className="vd-log">
                  {auditLog.map((e, i) => (
                    <li className="vd-log-item" key={i}>
                      <span className="vd-log-dot" />
                      <div className="vd-log-body">
                        <div className="vd-log-action">{e.action} {e.detail && <span className="vd-log-detail">{e.detail}</span>}</div>
                        <div className="vd-log-meta">{e.actor} · {formatDate(e.date)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Edit price modal ──────────────────────────────────────── */}
      {editOpen && (
        <div className="vd-modal-overlay" onClick={() => setEditOpen(false)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">Edit price — {item.name}</div>
            <div className="vd-modal-body">
              {status === "active" && <>Saving a price change sends this product for review; it can't be used on new bills until approved.<br /><br /></>}
              <div className="form-fld" style={{ marginBottom: 12 }}>
                <label>Cost / Unit (Rp)</label>
                <input type="number" min="0" value={editCost} onChange={(e) => setEditCost(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld" style={{ marginBottom: 0 }}>
                <label>Sales Price (Rp)</label>
                <input type="number" min="0" value={editSales} onChange={(e) => setEditSales(e.target.value)} style={{ fontFamily: "var(--font-mono)" }} />
              </div>
            </div>
            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveEdit}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Adjust stock modal ────────────────────────────────────── */}
      {adjustOpen && (
        <div className="vd-modal-overlay" onClick={() => setAdjustOpen(false)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">Adjust stock — {item.name}</div>
            <div className="vd-modal-body">
              Correct the on-hand count to the physical figure. This updates stock now and opens a pre-filled
              journal for the value change — review and post it to keep the books in step.
            </div>
            <div className="pd-adj-grid">
              {locs.length > 1 && (
                <div className="form-fld">
                  <label>Location</label>
                  <select value={adjLoc} onChange={(e) => setAdjLoc(e.target.value)}>
                    {locs.map((l) => <option key={l.loc} value={l.loc}>{l.loc}</option>)}
                  </select>
                </div>
              )}
              <div className="form-fld">
                <label>Current count</label>
                <input type="text" value={`${adjTargetQty.toLocaleString("id-ID")} ${primaryLabel}`} readOnly tabIndex={-1} className="ivc-ro" />
              </div>
              <div className="form-fld">
                <label>New physical count</label>
                <input type="number" min="0" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} placeholder="0" style={{ fontFamily: "var(--font-mono)" }} />
              </div>
              <div className="form-fld">
                <label>Reason</label>
                <select value={adjReason} onChange={(e) => setAdjReason(e.target.value)}>
                  {ADJUST_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-fld pd-adj-full">
                <label>Note (optional)</label>
                <input type="text" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="e.g. water damage in bay 3" />
              </div>
            </div>

            {adjQty !== "" && adjDelta !== 0 && (
              <div className="pd-adj-preview">
                <div className="pd-adj-preview-row">
                  <span>Change</span>
                  <span className={adjDelta < 0 ? "pd-adj-neg" : "pd-adj-pos"}>
                    {adjDelta > 0 ? "+" : ""}{adjDelta.toLocaleString("id-ID")} {primaryLabel} · {adjDelta < 0 ? "−" : ""}{formatRupiah(Math.abs(adjValue))}
                  </span>
                </div>
                <div className="pd-adj-je-lbl">Journal preview</div>
                <div className="pd-adj-je">
                  {adjDelta < 0 ? (
                    <>
                      <div><span>Dr</span> {adjAcctName} <span className="pd-acct-code">{ADJUSTMENT_ACCOUNT}</span><b>{formatRupiah(Math.abs(adjValue))}</b></div>
                      <div><span>Cr</span> {invAcctName} <span className="pd-acct-code">{inventoryAccountCode}</span><b>{formatRupiah(Math.abs(adjValue))}</b></div>
                    </>
                  ) : (
                    <>
                      <div><span>Dr</span> {invAcctName} <span className="pd-acct-code">{inventoryAccountCode}</span><b>{formatRupiah(Math.abs(adjValue))}</b></div>
                      <div><span>Cr</span> {adjAcctName} <span className="pd-acct-code">{ADJUSTMENT_ACCOUNT}</span><b>{formatRupiah(Math.abs(adjValue))}</b></div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={() => setAdjustOpen(false)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveAdjust} disabled={adjQty === "" || adjDelta === 0}>
                Create adjustment journal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject modal ──────────────────────────────────────────── */}
      {rejectOpen && (
        <div className="vd-modal-overlay" onClick={() => setRejectOpen(false)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vd-modal-title">Reject changes to {item.name}?</div>
            <div className="vd-modal-body">
              {(item.current_version || 0) === 0
                ? "This returns the product to Draft so it can be revised and resubmitted. Record why."
                : "This discards the pending change; the product reverts to its last approved version. Record why."}
            </div>
            <textarea className="vd-modal-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. cost increase not backed by a supplier quote" autoFocus />
            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={() => setRejectOpen(false)}>Cancel</button>
              <button className="vd-btn danger" onClick={doReject} disabled={reason.trim().length < 5}>Reject</button>
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

// Posting status of a movement's journal entry. A movement isn't reflected in
// the GL until its JE is Posted; Draft means stock moved but the books haven't.
const JE_STATUS_META = {
  posted:  { label: "Posted",         tone: "posted" },
  draft:   { label: "Draft",          tone: "draft" },
  pending: { label: "Pending Review", tone: "pending" },
  void:    { label: "Void",           tone: "void" },
};
function JeStatusChip({ status }) {
  const m = JE_STATUS_META[status] || JE_STATUS_META.draft;
  return <span className={`pd-je-status pd-je-${m.tone}`}>{m.label}</span>;
}

// Frozen snapshot of the price-bearing fields at approval time.
function VersionSnapshot({ data, reason }) {
  const d = data || {};
  const money = (v) => (v == null ? "—" : formatRupiah(v));
  return (
    <div className="vd-ver-snap">
      <Row l="Product ID" v={d.sku} mono />
      <Row l="Status" v={INV_STATUS_META[d.status]?.label || d.status} />
      <Row l="Cost / Unit" v={money(d.unit_cost)} mono />
      <Row l="Cost Price" v={money(d.cost_price)} mono />
      <Row l="Purchase Price" v={money(d.purchase_price)} mono />
      <Row l="Sales Price" v={money(d.sales_price)} mono />
      <Row l="Stock Value" v={money(d.value)} mono />
      {reason && <div className="vd-ver-reason">Reason: {reason}</div>}
    </div>
  );
}
