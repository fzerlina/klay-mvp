import { useState, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAssets, VER_FIELD_LABEL } from "../state/AssetsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import {
  TYPE_LABELS, TYPE_VERB, METHOD_LABELS, DURATION_UNIT_LABELS, COMPUTATION_LABELS,
  STATUS_META, PAUSE_REASONS, CANCELLATION_REASONS, DISPOSAL_REASONS,
  assetAccounts, journalLines, disposalGainLoss, nextPeriod, categoryLabel,
} from "../lib/fixedAssets";
import { categoriesForType } from "../data/seed/fixedAssets";
import { formatRupiah, formatRupiahExact, formatDateEn } from "../lib/format";
import "./vendor-detail.css";
import "./items.css";
import "./assets.css";

// ── Fixed Asset Detail ───────────────────────────────────────────────────────
// Route /assets/:id. Five tabs: Overview · Schedule · Bills History ·
// Versions · Audit Trail. Schedule folds the posted journal lines into the
// same table (expand a posted row to see its debit/credit) rather than a
// separate tab — one place to see what happened in a given period.
//
// NOTHING ON THIS PAGE IS APPROVAL-GATED. Edits save immediately. What keeps
// that safe is not a signature but `scheduleLocked` — method, duration,
// computation, rate, acquisition date, type and accounts freeze once a period
// has posted, and no capability can sign that away. Versions and the audit
// trail record the rest.

const VER_ORIGIN_VERB = { created: "created", changed: "changed" };

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.running;
  return <span className={`vd-status ${meta.tone}`}>{meta.label}</span>;
}

function KpiTile({ label, value }) {
  return (
    <div>
      <div className="vd-metric-lbl">{label}</div>
      <div className="vd-metric-val" style={{ fontSize: 15, fontWeight: 700 }}>
        {value == null ? <span className="fa-none">Not computable</span> : value}
      </div>
    </div>
  );
}

// Generic action modal — Pause / Resume / Cancel / Dispose / Revise value.
function ActionModal({ action, onClose, onConfirm, previewValueRevision, asset }) {
  const [reason, setReason] = useState(action.defaultReason || "");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [newValue, setNewValue] = useState("");
  const [proceeds, setProceeds] = useState("");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState("");

  const preview = action.type === "revise" && newValue ? previewValueRevision(asset, newValue) : null;

  function submit() {
    setError("");
    let res;
    if (action.type === "pause") res = onConfirm({ reason, note });
    else if (action.type === "resume") res = onConfirm({});
    else if (action.type === "cancel") res = onConfirm({ reason, note });
    else if (action.type === "dispose") res = onConfirm({ date, reason, proceeds: Number(proceeds) || 0, customer });
    else if (action.type === "revise") res = onConfirm({ newValue, reason, note });
    if (res && !res.ok) { setError(res.error); return; }
    onClose();
  }

  const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--color-text-tertiary)", margin: "12px 0 4px" };
  const inp = { width: "100%", padding: "8px 10px", border: "1px solid var(--color-border-default)", borderRadius: 6 };

  return (
    <div className="vd-modal-overlay" onClick={onClose}>
      <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vd-modal-title">{action.title}</div>
        <div className="vd-modal-body">{action.body}</div>

        {action.type === "dispose" && (
          <>
            <label style={lbl}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
            <label style={lbl}>Proceeds (Rp)</label>
            <input type="number" min="0" value={proceeds} onChange={(e) => setProceeds(e.target.value)} placeholder="0 if scrapped" style={{ ...inp, fontFamily: "var(--font-mono)" }} />
            <label style={lbl}>Customer (if sold)</label>
            <input type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} style={inp} />
          </>
        )}
        {action.type === "revise" && (
          <>
            <label style={lbl}>New value (Rp)</label>
            <input type="number" min="0" value={newValue} onChange={(e) => setNewValue(e.target.value)} style={{ ...inp, fontFamily: "var(--font-mono)" }} />
            {preview && (
              <div className="fac-note" style={{ marginTop: 10 }}>
                Effective <strong>{nextPeriod(preview.last_posted_period || preview.first_period || "")}</strong>. New per-period
                charge: <strong>{formatRupiahExact(preview.next_charge)}</strong>. Posted total through{" "}
                {preview.last_posted_period || "—"} stays <strong>{formatRupiahExact(preview.accumulated)}</strong>, unchanged.
                End date stays <strong>{preview.final_period}</strong>.
              </div>
            )}
          </>
        )}
        {(action.type === "pause" || action.type === "cancel" || action.type === "dispose") && (
          <>
            <label style={lbl}>Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} style={inp}>
              {(action.reasons || []).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <textarea className="vd-modal-reason" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )}
        {error && <div style={{ marginTop: 10, color: "var(--color-danger-text)", fontSize: 12 }}>{error}</div>}

        <div className="vd-modal-actions">
          <button className="vd-btn" onClick={onClose}>Cancel</button>
          <button className="vd-btn primary" onClick={submit}>{action.confirmLabel || "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

const TABS = [["overview", "Overview"], ["schedule", "Schedule"], ["bills", "Bills History"], ["versions", "Versions"], ["audit", "Audit Trail"]];

export default function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    assetById, updateAsset, read, reviseValue, previewValueRevision,
    pauseAsset, resumeAsset, cancelAsset, disposeAsset, scheduleLocked, disposalGuard,
    categoryChangeGuard, closedThrough, changeLog, versionsOf,
  } = useAssets();
  const { user } = useCurrentUser();
  const asset = assetById(id);

  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [modal, setModal] = useState(null);
  const [expandedPeriod, setExpandedPeriod] = useState(null);
  const [toast, setToast] = useState("");
  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2600); }

  if (!asset) {
    return (
      <div className="vd-page">
        <div className="vd-empty" style={{ marginTop: 80 }}>
          Asset not found.{" "}
          <button className="vd-btn" style={{ marginTop: 14 }} onClick={() => navigate("/assets")}>Back to Fixed Assets</button>
        </div>
      </div>
    );
  }

  const r = read(asset);
  const accounts = assetAccounts(asset);
  const lock = scheduleLocked(asset);
  const catLock = categoryChangeGuard(asset);
  const disposeCheck = disposalGuard(asset, { targetPeriod: nextPeriod(closedThrough) });
  const meta = { actor: user.name };
  const log = changeLog[asset.id] || [];
  const vlist = versionsOf(asset.id);
  const gainLoss = asset.disposal ? disposalGainLoss(r, asset.disposal.proceeds) : null;

  function openEdit() {
    setForm({
      name: asset.name || "", description: asset.description || "", category: asset.category || "",
      serial_no: asset.serial_no || "", subsidiary: asset.subsidiary || "", notes: asset.notes || "",
    });
    setEditOpen(true);
  }
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  function saveEdit() {
    const res = updateAsset(asset.id, form, meta);
    if (res?.error) { flash(res.error); return; }
    setEditOpen(false);
    flash("Saved");
  }

  function runAction(fn) {
    return (payload) => {
      const res = fn(asset.id, { ...payload, actor: user.name });
      if (res?.ok) flash("Done");
      return res;
    };
  }
  function runRevise(payload) {
    const res = reviseValue(asset.id, { newValue: payload.newValue, reason: payload.reason, note: payload.note, actor: user.name });
    if (res?.ok) flash("Value revision recorded");
    return res;
  }

  return (
    <div className="vd-page">
      <div className="vd-scroll">
        <div className="vd-top">
          <button className="vd-back" onClick={() => navigate("/assets")}><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg></button>
          <div className="vd-av">{TYPE_LABELS[asset.type]?.slice(0, 2).toUpperCase() || "FA"}</div>
          <div className="vd-headinfo">
            <div className="vd-title-row">
              <div className="vd-title">{asset.name}</div>
              <StatusPill status={asset.status} />
            </div>
            <div className="vd-sub">{asset.asset_tag} · {TYPE_LABELS[asset.type]} · {TYPE_VERB[asset.type]}</div>
          </div>
          <div className="vd-actions">
            {asset.status === "running" && (
              <button className="vd-btn" onClick={() => setModal({ type: "pause", title: "Pause", body: "No charge accrues while paused. The duration extends by however long it sits — nothing is skipped.", reasons: PAUSE_REASONS, confirmLabel: "Pause" })}>Pause</button>
            )}
            {asset.status === "paused" && <button className="vd-btn" onClick={() => runAction(resumeAsset)({})}>Resume</button>}
            {["running", "paused"].includes(asset.status) && (
              <button className="vd-btn" onClick={() => setModal({ type: "cancel", title: "Cancel Asset", body: "Posted journals stand and every unposted future charge never happens. This is not a disposal — the remaining book value is stranded.", reasons: CANCELLATION_REASONS, confirmLabel: "Cancel Asset" })}>Cancel</button>
            )}
            {["running", "paused"].includes(asset.status) && (
              <button
                className="vd-btn" disabled={disposeCheck.blocked} title={disposeCheck.blocked ? disposeCheck.reason : undefined}
                onClick={() => setModal({ type: "dispose", title: "Dispose / Sell Asset", body: "No charge posts in the disposal period. Gain or loss realises against book value as of the period before it.", reasons: DISPOSAL_REASONS, defaultReason: "Sold", confirmLabel: "Dispose" })}
              >Dispose / Sell</button>
            )}
            {["running", "paused"].includes(asset.status) && (
              <button className="vd-btn" onClick={() => setModal({ type: "revise", title: "Revise Value", body: "The effective period is always the next open one — posted charges never move. Refused below what's already released." })}>Revise Value</button>
            )}
            <button className="vd-btn" onClick={openEdit}>Edit</button>
          </div>
        </div>

        {asset.status === "cancelled" && r.book_value != null && r.book_value > 0 && (
          <div style={{ margin: "0 32px 16px" }}>
            <div className="fa-stranded">
              <strong>{formatRupiahExact(r.book_value)} of book value is stranded.</strong> Cancelled {asset.cancellation?.period} — {asset.cancellation?.reason}.
              If this asset is gone, dispose of it instead; if it's not, it needs a schedule.
            </div>
          </div>
        )}

        <div className="vd-body" style={{ maxWidth: 1040 }}>
          <div className="vd-card span2" style={{ marginBottom: 16 }}>
            <div className="vd-card-title">Position</div>
            <div className="vd-metrics">
              <KpiTile label="Original Value" value={formatRupiahExact(asset.first_value)} />
              <KpiTile label="Book Value" value={r.book_value != null ? formatRupiahExact(r.book_value) : null} />
              <KpiTile label="Accumulated" value={formatRupiahExact(r.accumulated)} />
              <KpiTile label="This Period's Charge" value={formatRupiahExact(r.period_charge)} />
            </div>
          </div>

          <div className="vd-tabs" style={{ padding: 0, marginBottom: 16 }}>
            {TABS.map(([k, lbl]) => (
              <button key={k} className={`vd-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{lbl}</button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="vd-grid">
              <div className="vd-card">
                <div className="vd-card-title">Identity</div>
                <div className="vd-row"><span className="vd-row-lbl">Asset ID</span><span className="vd-row-val mono">{asset.asset_tag}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Name</span><span className="vd-row-val">{asset.name}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Description</span><span className="vd-row-val">{asset.description || "—"}</span></div>
                <div className="vd-row">
                  <span className="vd-row-lbl">Category</span>
                  <span className="vd-row-val">
                    {categoryLabel(asset.category)}
                    {catLock.blocked && <span className="fa-lock" title={catLock.reason} style={{ marginLeft: 6 }}><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>}
                  </span>
                </div>
                <div className="vd-row"><span className="vd-row-lbl">Serial Number</span><span className="vd-row-val mono">{asset.serial_no || "—"}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Type</span><span className="vd-row-val">{TYPE_LABELS[asset.type]}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Subsidiary</span><span className="vd-row-val">{asset.subsidiary || "—"}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Notes</span><span className="vd-row-val dim">{asset.notes || "—"}</span></div>
              </div>
              <div className="vd-card">
                <div className="vd-card-title">
                  Schedule Parameters
                  {lock.locked && <span className="fa-lock" title={lock.reason}><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>Locked</span>}
                </div>
                <div className="vd-row"><span className="vd-row-lbl">Acquisition Date</span><span className="vd-row-val">{formatDateEn(asset.acquisition_date)}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Method</span><span className="vd-row-val">{METHOD_LABELS[asset.method]}</span></div>
                {asset.rate != null && <div className="vd-row"><span className="vd-row-lbl">Rate</span><span className="vd-row-val">{(asset.rate * 100).toFixed(2)}%</span></div>}
                <div className="vd-row"><span className="vd-row-lbl">Duration</span><span className="vd-row-val">{asset.duration_value} {DURATION_UNIT_LABELS[asset.duration_unit]}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Computation</span><span className="vd-row-val">{COMPUTATION_LABELS[asset.computation]}</span></div>
              </div>
              <div className="vd-card span2">
                <div className="vd-card-title">GL Accounts <span className="fa-fld-tag">From category · read-only</span></div>
                {accounts.map((a) => (
                  <div className="vd-row" key={a.key}>
                    <span className="vd-row-lbl">{a.label}</span>
                    <span className="vd-row-val">{a.name ? <>{a.name} <span className="mono" style={{ color: "var(--color-text-tertiary)", marginLeft: 6 }}>{a.code}</span></> : <span className="dim">Not applicable</span>}</span>
                  </div>
                ))}
              </div>
              {asset.value_revisions.length > 0 && (
                <div className="vd-card span2">
                  <div className="vd-card-title">Value Revisions</div>
                  <div className="vd-row"><span className="vd-row-lbl">First recognised at</span><span className="vd-row-val">{formatRupiah(asset.first_value)}</span></div>
                  <div className="vd-row"><span className="vd-row-lbl">Carries now</span><span className="vd-row-val" style={{ fontWeight: 700 }}>{formatRupiahExact(r.current_value)}</span></div>
                  {asset.value_revisions.map((rev, i) => (
                    <div className="vd-row" key={i}>
                      <span className="vd-row-lbl">Effective {rev.effective_period}</span>
                      <span className="vd-row-val">{formatRupiah(rev.new_value)} — {rev.reason || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              {asset.disposal && (
                <div className="vd-card span2">
                  <div className="vd-card-title">Disposal</div>
                  <div className="vd-row"><span className="vd-row-lbl">Date</span><span className="vd-row-val">{formatDateEn(asset.disposal.date)}</span></div>
                  <div className="vd-row"><span className="vd-row-lbl">Reason</span><span className="vd-row-val">{asset.disposal.reason}</span></div>
                  <div className="vd-row"><span className="vd-row-lbl">Proceeds</span><span className="vd-row-val">{formatRupiah(asset.disposal.proceeds)}</span></div>
                  <div className="vd-row"><span className="vd-row-lbl">Customer</span><span className="vd-row-val">{asset.disposal.customer || "—"}</span></div>
                  <div className="vd-row"><span className="vd-row-lbl">Gain / (Loss)</span><span className="vd-row-val" style={{ fontWeight: 700 }}>{gainLoss == null ? "—" : formatRupiahExact(gainLoss)}</span></div>
                </div>
              )}
            </div>
          )}

          {tab === "schedule" && (
            <div className="vd-card">
              <div className="vd-card-title">Schedule</div>
              {r.schedule.length === 0 ? (
                <div className="vd-empty">No schedule yet.</div>
              ) : (
                <div className="fa-scroll">
                  <table className="vd-tx-table">
                    <thead><tr><th></th><th>Period</th><th style={{ textAlign: "right" }}>Charge</th><th style={{ textAlign: "right" }}>Accumulated</th><th style={{ textAlign: "right" }}>Book Value</th><th>Status</th></tr></thead>
                    <tbody>
                      {r.schedule.map((row) => {
                        const posted = row.period <= closedThrough;
                        const lines = posted ? journalLines(asset, row) : [];
                        const expanded = expandedPeriod === row.period;
                        return (
                          <Fragment key={row.period}>
                            <tr
                              className={`fa-sched-row${row.suspended ? " suspended" : ""}${row.revised ? " revised" : ""}`}
                              style={{ cursor: posted && lines.length ? "pointer" : "default" }}
                              onClick={() => posted && lines.length && setExpandedPeriod(expanded ? null : row.period)}
                            >
                              <td className="dim">{posted && lines.length ? (expanded ? "▾" : "▸") : ""}</td>
                              <td>{row.period}</td>
                              <td className="num">{formatRupiahExact(row.charge)}</td>
                              <td className="num">{formatRupiahExact(row.accumulated)}</td>
                              <td className="num">{formatRupiahExact(row.bookValue)}</td>
                              <td>
                                {posted ? "Posted" : "Scheduled"}
                                {row.suspended && <span className="fa-sched-tag paused">Paused</span>}
                                {row.revised && <span className="fa-sched-tag revised">Revised</span>}
                              </td>
                            </tr>
                            {expanded && lines.map((line, i) => (
                              <tr key={`${row.period}-je-${i}`} className="fa-journal-row">
                                <td></td>
                                <td colSpan={2} className="dim">{line.debit ? `Dr ${line.debit.name} (${line.debit.code})` : "—"}</td>
                                <td colSpan={2} className="dim">{line.credit ? `Cr ${line.credit.name} (${line.credit.code})` : "—"}</td>
                                <td className="num dim">{formatRupiahExact(line.amount)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "bills" && (
            <div className="vd-card">
              <div className="vd-card-title">Bills History</div>
              <p className="vd-ver-intro">Every AP bill that fed this asset's cost — the original purchase, plus any later capital additions or improvements. One asset can carry more than one bill.</p>
              {asset.bills.length === 0 ? (
                <div className="vd-empty">No bills linked to this asset.</div>
              ) : (
                <div className="fa-scroll">
                  <table className="vd-tx-table">
                    <thead><tr><th>Bill</th><th>Description</th><th>Date</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                    <tbody>
                      {asset.bills.map((b, i) => (
                        <tr key={i}>
                          <td className="mono">{b.bill_id}{b.line_no ? `, line ${b.line_no}` : ""}</td>
                          <td>{b.desc}</td>
                          <td>{formatDateEn(b.date)}</td>
                          <td className="num">{formatRupiahExact(b.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "versions" && (
            <div className="vd-card">
              <div className="vd-ver-intro">Every change to a governed field freezes a snapshot. A schedule copies from a version, never from a live re-read — that is what keeps a posted period posted.</div>
              <div className="vd-ver-list">
                {vlist.map((v) => (
                  <div className="vd-ver" key={v.versionId}>
                    <div className="vd-ver-head">
                      <span className="vd-ver-id">{v.versionId}</span>
                      {v.version === vlist[0].version && <span className="vd-ver-current">Current</span>}
                      <span className="vd-ver-meta">{VER_ORIGIN_VERB[v.origin] || v.origin} by {v.by} on {v.at}</span>
                      {v.changedFields?.length > 0 && <span className="vd-ver-changed">{v.changedFields.map((f) => VER_FIELD_LABEL[f] || f).join(", ")}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "audit" && (
            <div className="vd-card">
              <div className="vd-card-title">Audit Trail</div>
              {log.length === 0 ? <div className="vd-empty">No events recorded.</div> : (
                <ul className="vd-log">
                  {log.map((e, i) => (
                    <li className="vd-log-item" key={i}>
                      <span className="vd-log-dot" />
                      <div className="vd-log-body">
                        <div className="vd-log-action">{e.action}</div>
                        <div className="vd-log-detail">{e.detail}</div>
                        <div className="vd-log-meta">{e.date} · {e.actor}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {editOpen && form && (
        <div className="vd-modal-overlay" onClick={() => setEditOpen(false)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="vd-modal-title">Edit Asset</div>
            <div className="vd-bank-form">
              <label>Name</label><input value={form.name} onChange={(e) => setF("name", e.target.value)} />
              <label>Description</label><input value={form.description} onChange={(e) => setF("description", e.target.value)} />
              <div className="vd-bank-grid">
                <div>
                  <label>Category {catLock.blocked && <span className="fa-fld-tag">Locked</span>}</label>
                  <select
                    value={form.category} disabled={catLock.blocked} title={catLock.blocked ? catLock.reason : undefined}
                    onChange={(e) => setF("category", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--color-border-default)", borderRadius: 6 }}
                  >
                    {categoriesForType(asset.type).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div><label>Serial Number</label><input value={form.serial_no} onChange={(e) => setF("serial_no", e.target.value)} /></div>
              </div>
              {catLock.blocked && <div className="fac-note" style={{ marginTop: 8 }}>{catLock.reason}</div>}
              <label>Subsidiary</label><input value={form.subsidiary} onChange={(e) => setF("subsidiary", e.target.value)} />
              <label>Notes</label><input value={form.notes} onChange={(e) => setF("notes", e.target.value)} />
            </div>
            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <ActionModal
          action={modal}
          asset={asset}
          previewValueRevision={previewValueRevision}
          onClose={() => setModal(null)}
          onConfirm={
            modal.type === "pause" ? runAction(pauseAsset)
            : modal.type === "resume" ? runAction(resumeAsset)
            : modal.type === "cancel" ? runAction(cancelAsset)
            : modal.type === "dispose" ? runAction(disposeAsset)
            : modal.type === "revise" ? runRevise
            : () => ({ ok: true })
          }
        />
      )}

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
