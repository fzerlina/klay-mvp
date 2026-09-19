import { useState, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAssets, VER_FIELD_LABEL } from "../state/AssetsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import {
  TYPE_LABELS, TYPE_VERB, TYPE_ORDER, METHOD_LABELS, METHOD_ORDER, RATE_METHODS,
  DURATION_UNIT_LABELS, COMPUTATION_LABELS, COMPUTATION_ORDER,
  BOOK_STATUS_TONE, BOOK_STATUS_LEDGER, BOOK_STATUS_SHORT, bookStatusLabel, bookStatusShort, OPERATIONAL_TONE,
  LIFECYCLE_META, OPERATIONAL_META, operationalStatesForType, operationalApplies,
  HOLD_REASONS, DEACTIVATION_REASONS, DISPOSAL_REASONS, BOOK_EVENT_LABELS,
  statusConflicts, assetAccounts, journalLines, bookEventLines, disposalGainLoss,
  nextPeriod, categoryLabel, methodBuildsSchedule, durationInMonths, depreciableValue,
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
// computation, rate, in-service date, type and accounts freeze once a period
// has posted, and no capability can sign that away. Versions and the audit
// trail record the rest.
//
// THE THREE AXES. The header carries all of them, weighted by consequence:
// the book status is the pill, the lifecycle only shows when it isn't Active,
// and the operational status is a muted chip you click to change. The Status
// card underneath states what each one does — including, for the operational
// axis, that it does nothing at all to the ledger.

const VER_ORIGIN_VERB = { created: "created", changed: "changed" };

// The header states all three axes and changes none of them. Every status
// change goes through the Edit form, so there is ONE place a record is
// altered and one Save that reports what happened — rather than a dated
// event hiding behind a pill, which read as a field and was not one.
function BookStatusPill({ asset }) {
  const tone = BOOK_STATUS_TONE[asset.book_status] || "active";
  return <span className={`vd-status ${tone}`} title={bookStatusLabel(asset)}>{bookStatusShort(asset)}</span>;
}

function OperationalPill({ asset }) {
  const label = OPERATIONAL_META[asset.operational_status]?.label;
  if (!operationalApplies(asset.type) || !label) return null;
  return (
    <span
      className={`vd-status ${OPERATIONAL_TONE[asset.operational_status] || "inactive"}`}
      title="Operational status — what is happening on the ground. No ledger effect."
    >
      {label}
    </span>
  );
}
function KpiTile({ label, value, hint }) {
  return (
    <div>
      <div className="vd-metric-lbl">{label}</div>
      <div className="vd-metric-val" style={{ fontSize: 15, fontWeight: 700 }}>
        {value == null ? <span className="fa-none">{hint || "Not computable"}</span> : value}
      </div>
    </div>
  );
}

// The only dialog left on this page. Every status change moved into the Edit
// form; a value revision keeps its own because it has something to say before
// it commits — the new per-period charge, the posted total that does not move,
// and the end date that does not move either.
function ReviseModal({ asset, onClose, onConfirm, previewValueRevision }) {
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const preview = newValue ? previewValueRevision(asset, newValue) : null;

  const lbl = { display: "block", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".03em", color: "var(--color-text-tertiary)", margin: "12px 0 4px" };
  const inp = { width: "100%", padding: "8px 10px", border: "1px solid var(--color-border-default)", borderRadius: 6 };

  function submit() {
    setError("");
    const res = onConfirm({ newValue, reason, note });
    if (res && !res.ok) { setError(res.error); return; }
    onClose();
  }

  return (
    <div className="vd-modal-overlay" onClick={onClose}>
      <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vd-modal-title">Revise Value</div>
        <div className="vd-modal-body">
          The effective period is always the next open one — posted charges never move. Refused below
          what has already been released.
        </div>

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

        <label style={lbl}>Reason</label>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Freight billed separately after the original invoice" style={inp} />
        <textarea className="vd-modal-reason" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <div style={{ marginTop: 10, color: "var(--color-danger-text)", fontSize: 12 }}>{error}</div>}

        <div className="vd-modal-actions">
          <button className="vd-btn" onClick={onClose}>Cancel</button>
          <button className="vd-btn primary" onClick={submit}>Revise</button>
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
    assetById, updateAsset, read, reviseValue, previewValueRevision, setOperationalStatus,
    capitaliseAsset, placeInService, holdForSale, returnToService,
    deactivateAsset, reactivateAsset, disposeAsset,
    scheduleLocked, deactivateGuard, operationalEditable, bookStatusTransitions,
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
  const accounts = assetAccounts(asset).filter((a) => a.code);
  const lock = scheduleLocked(asset);
  const catLock = categoryChangeGuard(asset);
  const meta = { actor: user.name };
  const log = changeLog[asset.id] || [];
  const vlist = versionsOf(asset.id);
  const gainLoss = asset.disposal ? disposalGainLoss(r, asset.disposal.proceeds) : null;
  const conflicts = statusConflicts(asset);
  const life = LIFECYCLE_META[asset.lifecycle] || LIFECYCLE_META.active;

  // Every action is shown, and a blocked one stays visible but disabled with
  // the reason in its tooltip — hiding an action teaches nothing about why it
  // isn't available.
  const deactivateCheck = deactivateGuard(asset);
  const transitions = bookStatusTransitions(asset);
  const opEditable = operationalEditable(asset);
  // Only once something has posted is there history for a revision to protect.
  // Before that the value is an ordinary edit, in the dialog below.
  const canRevise = asset.lifecycle === "active" && asset.book_status !== "disposed" && r.posted_periods > 0;

  function openEdit() {
    setForm({
      name: asset.name || "", description: asset.description || "", category: asset.category || "",
      serial_no: asset.serial_no || "", subsidiary: asset.subsidiary || "", notes: asset.notes || "",
      type: asset.type, first_value: asset.first_value ?? "", salvage_value: asset.salvage_value ?? 0,
      acquisition_date: asset.acquisition_date || "", service_date: asset.service_date || "",
      method: asset.method, rate: asset.rate ?? "",
      duration_value: asset.duration_value ?? "", duration_unit: asset.duration_unit,
      computation: asset.computation,
      // The three axes. book_to is a DESTINATION, not the current value —
      // empty means "leave the book status alone", and picking one reveals
      // whatever that destination needs to be dated and reasoned.
      lifecycle: asset.lifecycle,
      inactive_reason: DEACTIVATION_REASONS[0],
      operational_status: asset.operational_status || "",
      book_to: "",
      book_date: "",
      book_reason: "",
      book_note: "",
      proceeds: "",
      customer: "",
    });
    setEditOpen(true);
  }
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // One Save, applied in a deliberate order: fields, then the ground truth,
  // then the ledger, then the record. Book before lifecycle matters — it is
  // what lets someone dispose of an asset and archive it in a single save,
  // since Make Inactive is refused on a live asset but allowed on a disposed
  // one. Anything that fails stops the rest and keeps the dialog open with the
  // reason, so a half-applied save is never silently accepted.
  function saveEdit() {
    const done = [];

    // The inputs hand back strings; the schedule engine does arithmetic on
    // these, so they are coerced here rather than one layer deeper where a
    // string would quietly become NaN mid-walk.
    const payload = lock.locked ? form : {
      ...form,
      first_value: Number(form.first_value) || 0,
      salvage_value: Number(form.salvage_value) || 0,
      duration_value: Number(form.duration_value) || 1,
      rate: form.rate === "" || form.rate == null ? null : Number(form.rate),
      service_date: form.service_date || null,
    };
    const res = updateAsset(asset.id, payload, meta);
    if (res?.error) { flash(res.error); return; }
    if (res?.changed?.length) done.push("details");

    const opNext = form.operational_status || null;
    if (operationalApplies(asset.type) && opNext !== (asset.operational_status || null)) {
      const r1 = setOperationalStatus(asset.id, { status: opNext, actor: user.name });
      if (!r1?.ok) { flash(r1.error); return; }
      done.push("operational status");
    }

    if (form.book_to) {
      const fns = {
        capitalise: () => capitaliseAsset(asset.id, { note: form.book_note, actor: user.name }),
        service: () => placeInService(asset.id, { date: form.book_date, note: form.book_note, actor: user.name }),
        hold: () => holdForSale(asset.id, { reason: form.book_reason, note: form.book_note, actor: user.name }),
        return: () => returnToService(asset.id, { note: form.book_note, actor: user.name }),
        dispose: () => disposeAsset(asset.id, {
          date: form.book_date, reason: form.book_reason,
          proceeds: Number(form.proceeds) || 0, customer: form.customer, actor: user.name,
        }),
      };
      const t = transitions.find((x) => x.to === form.book_to);
      if (t && ["service", "dispose"].includes(t.action) && !form.book_date) {
        flash(t.action === "service" ? "Enter the in-service date." : "Enter the disposal date.");
        return;
      }
      const r2 = t && fns[t.action] ? fns[t.action]() : { ok: false, error: "That book status is not reachable from here." };
      if (!r2?.ok) { flash(r2.error); return; }
      done.push("book status");
    }

    if (form.lifecycle !== asset.lifecycle) {
      const r3 = form.lifecycle === "inactive"
        ? deactivateAsset(asset.id, { reason: form.inactive_reason, note: form.book_note, actor: user.name })
        : reactivateAsset(asset.id, { actor: user.name });
      if (!r3?.ok) { flash(r3.error); return; }
      done.push("lifecycle");
    }

    setEditOpen(false);
    flash(done.length ? `Saved — ${done.join(", ")}` : "No changes");
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
              <BookStatusPill asset={asset} />
              <OperationalPill asset={asset} />
              {asset.lifecycle !== "active" && <span className={`fa-life ${life.tone}`}>{life.label}</span>}
            </div>
            <div className="vd-sub">{asset.asset_tag} · {TYPE_LABELS[asset.type]} · {TYPE_VERB[asset.type]}</div>
          </div>
          <div className="vd-actions">
            {canRevise && (
              <button className="vd-btn" onClick={() => setModal(true)}>Revise Value</button>
            )}
            <button className="vd-btn" onClick={openEdit}>Edit</button>
          </div>
        </div>

        {/* Where the floor and the books disagree. Advisory: each one names the
            event that would settle it, because a warning that only says
            something is wrong gets dismissed. */}
        {conflicts.length > 0 && (
          <div style={{ margin: "0 32px 16px" }}>
            {conflicts.map((c) => (
              <div className={`fa-flag ${c.tier}`} key={c.key}>
                <strong>{c.title}.</strong> {c.detail}
              </div>
            ))}
          </div>
        )}

        {asset.lifecycle === "inactive" && (
          <div style={{ margin: "0 32px 16px" }}>
            <div className="fac-note">
              <strong>Made inactive {asset.inactivation?.at}</strong> — {asset.inactivation?.reason}.
              {asset.inactivation?.note ? ` ${asset.inactivation.note}` : ""} No value moved and no journal was written;
              the record is out of the working register, and Reactivate puts it back.
            </div>
          </div>
        )}

        <div className="vd-body" style={{ maxWidth: 1040 }}>
          <div className="vd-card span2" style={{ marginBottom: 16 }}>
            <div className="vd-card-title">Position</div>
            <div className="vd-metrics">
              <KpiTile label="Original Value" value={formatRupiahExact(asset.first_value)} />
              <KpiTile
                label="Book Value"
                value={r.book_value != null ? formatRupiahExact(r.book_value) : null}
                hint={r.never_ran ? "Never in the books" : undefined}
              />
              <KpiTile
                label="Accumulated"
                value={r.not_in_service || r.not_depreciated ? null : formatRupiahExact(r.accumulated)}
                hint={r.not_depreciated ? "Not depreciated" : "Not in service"}
              />
              <KpiTile
                label="This Period's Charge"
                value={r.not_in_service || r.not_depreciated ? null : formatRupiahExact(r.period_charge)}
                hint={r.not_depreciated ? "Indefinite life" : "No schedule yet"}
              />
            </div>
          </div>

          <div className="vd-tabs" style={{ padding: 0, marginBottom: 16 }}>
            {TABS.map(([k, lbl]) => (
              <button key={k} className={`vd-tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{lbl}</button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="vd-grid">
              {/* The three axes, stated. Each row says what the axis means and
                  what it does — including the one that does nothing. */}
              <div className="vd-card span2">
                <div className="vd-card-title">Status</div>
                <div className="vd-row">
                  <span className="vd-row-lbl">Record lifecycle</span>
                  <span className="vd-row-val">
                    {life.label}
                    <span className="fa-axis-note">{life.hint}</span>
                  </span>
                </div>
                <div className="vd-row">
                  <span className="vd-row-lbl">Book status</span>
                  <span className="vd-row-val">
                    {bookStatusLabel(asset)}
                    <span className="fa-axis-note">{BOOK_STATUS_LEDGER[asset.book_status]}</span>
                  </span>
                </div>
                <div className="vd-row">
                  <span className="vd-row-lbl">Operational status</span>
                  <span className="vd-row-val">
                    {operationalApplies(asset.type)
                      ? (OPERATIONAL_META[asset.operational_status]?.label || "Not set")
                      : <span className="dim">Not applicable</span>}
                    <span className="fa-axis-note">
                      {operationalApplies(asset.type)
                        ? `Manually selected. No ledger effect — it never changes what a period charges. ${operationalStatesForType(asset.type).length} states apply to this type.`
                        : "A prepaid has no operational axis: the only state that would parse is “in use”, which just restates the book status."}
                    </span>
                  </span>
                </div>
                <div className="vd-row">
                  <span className="vd-row-lbl">In-service date</span>
                  <span className="vd-row-val">
                    {asset.service_date ? formatDateEn(asset.service_date) : <span className="dim">Not yet in service</span>}
                    <span className="fa-axis-note">The schedule starts here, not at acquisition.</span>
                  </span>
                </div>
              </div>

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
                <div className="vd-row"><span className="vd-row-lbl">In-Service Date</span><span className="vd-row-val">{asset.service_date ? formatDateEn(asset.service_date) : <span className="dim">—</span>}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Salvage Value</span><span className="vd-row-val">{formatRupiahExact(asset.salvage_value || 0)}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Depreciable Value</span><span className="vd-row-val" style={{ fontWeight: 700 }}>{formatRupiahExact(depreciableValue(asset.first_value, asset.salvage_value))}</span></div>
                <div className="vd-row"><span className="vd-row-lbl">Method</span><span className="vd-row-val">{METHOD_LABELS[asset.method]}</span></div>
                {asset.rate != null && <div className="vd-row"><span className="vd-row-lbl">Rate</span><span className="vd-row-val">{(asset.rate * 100).toFixed(2)}%</span></div>}
                {methodBuildsSchedule(asset.method) && (
                  <>
                    <div className="vd-row">
                      <span className="vd-row-lbl">Duration</span>
                      <span className="vd-row-val">
                        {asset.duration_value} {DURATION_UNIT_LABELS[asset.duration_unit]}
                        {asset.duration_unit === "years" && <span className="fa-axis-note">{durationInMonths(asset)} months — every schedule charges monthly.</span>}
                      </span>
                    </div>
                    <div className="vd-row"><span className="vd-row-lbl">Computation</span><span className="vd-row-val">{COMPUTATION_LABELS[asset.computation]}</span></div>
                  </>
                )}
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

              {/* Michael's rule — a book-status change moves the ledger, an
                  operational one does not — is only checkable if the screen
                  shows the movement. So each book event carries its journal,
                  and the two that move nothing say so. */}
              <div className="vd-card span2">
                <div className="vd-card-title">Book Events</div>
                <p className="vd-ver-intro">
                  Every change of book status, with the journal it moved. Placing in service and stopping a
                  schedule move nothing on the day — they change what the next period charges.
                </p>
                <div className="fa-scroll">
                  <table className="vd-tx-table">
                    <thead><tr><th>Period</th><th>Event</th><th>Journal</th><th>Note</th></tr></thead>
                    <tbody>
                      {(asset.book_events || []).map((ev, i) => {
                        const lines = bookEventLines(asset, ev, r);
                        return (
                          <tr key={i}>
                            <td className="mono">{ev.period}</td>
                            <td>{BOOK_EVENT_LABELS[ev.event] || ev.event}</td>
                            <td className="dim">
                              {lines.length === 0
                                ? <span className="fa-none">No journal</span>
                                : lines.map((l, j) => (
                                    <div key={j}>
                                      Dr {l.debit?.name || "—"} · Cr {l.credit?.name || "—"} · {formatRupiahExact(l.amount)}
                                    </div>
                                  ))}
                            </td>
                            <td className="dim">{ev.note || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
              {r.not_depreciated ? (
                <div className="fac-note">
                  <strong>This asset is not depreciated.</strong> It has an indefinite life, so there is no
                  term to spread its cost over and no schedule to build. It stays at cost until an impairment
                  test moves it — which this module does not yet perform (§10).
                </div>
              ) : r.not_in_service ? (
                // Never a column of zeroes for a schedule that does not exist.
                <div className="fac-note">
                  <strong>No schedule exists yet.</strong> This asset is {bookStatusLabel(asset).toLowerCase()}, so nothing
                  is being released. A schedule is built the moment it is placed in service, and it starts
                  from the in-service date — not from the acquisition date.
                </div>
              ) : r.schedule.length === 0 ? (
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
                              className={`fa-sched-row${row.held ? " suspended" : ""}${row.revised ? " revised" : ""}`}
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
                                {row.held && <span className="fa-sched-tag paused">Held for sale</span>}
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
              <div className="vd-ver-intro">
                Every change to a governed field freezes a snapshot. A schedule copies from a version, never
                from a live re-read — that is what keeps a posted period posted. The operational status is
                deliberately absent: it cannot reach a financial figure, so it is audited, not versioned.
              </div>
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
            {/* Status — all three axes live here; the header only states them.
                A book status is still not a field: the control picks a
                DESTINATION, and choosing one reveals what that destination
                needs to be dated and reasoned before Save will run it. */}
            <div className="fa-edit-sec" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>Status</div>

            <label>Record lifecycle</label>
            <select className="fa-edit-input" value={form.lifecycle} onChange={(e) => setF("lifecycle", e.target.value)}>
              <option value="active">Active</option>
              <option
                value="inactive"
                disabled={asset.lifecycle === "active" && deactivateCheck.blocked}
                title={deactivateCheck.blocked ? deactivateCheck.reason : undefined}
              >
                Inactive
              </option>
            </select>
            {asset.lifecycle === "active" && deactivateCheck.blocked && (
              <div className="fac-note" style={{ marginTop: 6 }}>{deactivateCheck.reason}</div>
            )}
            {form.lifecycle === "inactive" && asset.lifecycle === "active" && (
              <>
                <label>Reason for making inactive</label>
                <select className="fa-edit-input" value={form.inactive_reason} onChange={(e) => setF("inactive_reason", e.target.value)}>
                  {DEACTIVATION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </>
            )}

            <label>Book status</label>
            <select
              className="fa-edit-input"
              value={form.book_to}
              disabled={transitions.length === 0}
              onChange={(e) => setF("book_to", e.target.value)}
            >
              <option value="">Leave as {bookStatusLabel(asset)}</option>
              {transitions.map((t) => (
                <option key={t.to} value={t.to} disabled={t.blocked} title={t.blocked ? t.reason : undefined}>
                  Change to {asset.type === "fixed_asset" ? BOOK_STATUS_SHORT[t.to] : t.label}
                </option>
              ))}
            </select>
            {form.book_to && (() => {
              const t = transitions.find((x) => x.to === form.book_to);
              if (!t) return null;
              return (
                <>
                  <div className="fac-note" style={{ marginTop: 6 }}>{BOOK_STATUS_LEDGER[t.to]}</div>
                  {t.action === "service" && (
                    <>
                      <label>In-service date</label>
                      <input type="date" value={form.book_date} onChange={(e) => setF("book_date", e.target.value)} />
                    </>
                  )}
                  {t.action === "hold" && (
                    <>
                      <label>Reason</label>
                      <select className="fa-edit-input" value={form.book_reason || HOLD_REASONS[0]} onChange={(e) => setF("book_reason", e.target.value)}>
                        {HOLD_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </>
                  )}
                  {t.action === "dispose" && (
                    <>
                      <label>Disposal date</label>
                      <input type="date" value={form.book_date} onChange={(e) => setF("book_date", e.target.value)} />
                      <label>Reason</label>
                      <select className="fa-edit-input" value={form.book_reason || DISPOSAL_REASONS[0]} onChange={(e) => setF("book_reason", e.target.value)}>
                        {DISPOSAL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <div className="vd-bank-grid">
                        <div>
                          <label>Proceeds (Rp)</label>
                          <input type="number" min="0" value={form.proceeds} onChange={(e) => setF("proceeds", e.target.value)} placeholder="0 if scrapped" />
                        </div>
                        <div>
                          <label>Customer (if sold)</label>
                          <input value={form.customer} onChange={(e) => setF("customer", e.target.value)} />
                        </div>
                      </div>
                    </>
                  )}
                </>
              );
            })()}

            <label>Operational status</label>
            {operationalApplies(asset.type) ? (
              <>
                <select
                  className="fa-edit-input"
                  value={form.operational_status}
                  disabled={opEditable.blocked}
                  onChange={(e) => setF("operational_status", e.target.value)}
                >
                  <option value="">Not set</option>
                  {operationalStatesForType(asset.type).map((k) => <option key={k} value={k}>{OPERATIONAL_META[k].label}</option>)}
                </select>
                <div className="fac-note" style={{ marginTop: 6 }}>
                  {opEditable.blocked ? opEditable.reason : "No ledger effect — it never changes what a period charges."}
                </div>
              </>
            ) : (
              <div className="fac-note">A prepaid has no operational axis — it is not on a floor.</div>
            )}

            <div className="fa-edit-sec">Identity</div>
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
                    <option value="">Select a category…</option>
                    {categoriesForType(form.type || asset.type).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div><label>Serial Number</label><input value={form.serial_no} onChange={(e) => setF("serial_no", e.target.value)} /></div>
              </div>
              {catLock.blocked && <div className="fac-note" style={{ marginTop: 8 }}>{catLock.reason}</div>}
              <label>Subsidiary</label><input value={form.subsidiary} onChange={(e) => setF("subsidiary", e.target.value)} />
              <label>Notes</label><input value={form.notes} onChange={(e) => setF("notes", e.target.value)} />

              {/* PRD §0.10: schedule-defining fields are editable until the
                  first period posts, and frozen for good afterwards. Until now
                  only the freeze existed, so a duration typed wrong on day one
                  could never be corrected. */}
              {lock.locked ? (
                <div className="fac-note" style={{ marginTop: 14 }}>
                  <strong>Schedule parameters are frozen.</strong> {lock.reason}
                </div>
              ) : (
                <>
                  <div className="fa-edit-sec">
                    Schedule parameters
                    <span className="fa-fld-tag">Editable — nothing has posted</span>
                  </div>
                  <div className="vd-bank-grid">
                    <div>
                      <label>Type</label>
                      <select value={form.type} onChange={(e) => setF("type", e.target.value)} className="fa-edit-input">
                        {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>Original Value (Rp)</label>
                      <input type="number" min="0" value={form.first_value} onChange={(e) => setF("first_value", e.target.value)} />
                    </div>
                  </div>
                  <div className="vd-bank-grid">
                    <div>
                      <label>Salvage Value (Rp)</label>
                      <input type="number" min="0" value={form.salvage_value} onChange={(e) => setF("salvage_value", e.target.value)} />
                    </div>
                    <div>
                      <label>Depreciable Value</label>
                      <input type="text" readOnly value={formatRupiahExact(depreciableValue(form.first_value, form.salvage_value))} />
                    </div>
                  </div>
                  <div className="vd-bank-grid">
                    <div>
                      <label>Acquisition Date</label>
                      <input type="date" value={form.acquisition_date} onChange={(e) => setF("acquisition_date", e.target.value)} />
                    </div>
                    <div>
                      <label>In-Service Date</label>
                      <input type="date" value={form.service_date} onChange={(e) => setF("service_date", e.target.value)} disabled={asset.book_status !== "in_service"} />
                    </div>
                  </div>
                  <div className="vd-bank-grid">
                    <div>
                      <label>Method</label>
                      <select value={form.method} onChange={(e) => setF("method", e.target.value)} className="fa-edit-input">
                        {METHOD_ORDER.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label>Rate per period</label>
                      <input
                        type="number" min="0" max="1" step="0.01" value={form.rate}
                        disabled={!RATE_METHODS.includes(form.method)}
                        placeholder={RATE_METHODS.includes(form.method) ? "e.g. 0.25" : "Not used by this method"}
                        onChange={(e) => setF("rate", e.target.value)}
                      />
                    </div>
                  </div>
                  {!methodBuildsSchedule(form.method) ? (
                    <div className="fac-note" style={{ marginTop: 10 }}>
                      Not depreciated — no duration or computation applies. The asset sits at cost until an
                      impairment test moves it.
                    </div>
                  ) : (
                  <div className="vd-bank-grid">
                    <div>
                      <label>Duration</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input type="number" min="1" value={form.duration_value} onChange={(e) => setF("duration_value", e.target.value)} style={{ flex: 1 }} />
                        <select value={form.duration_unit} onChange={(e) => setF("duration_unit", e.target.value)} className="fa-edit-input" style={{ flex: 1 }}>
                          {Object.entries(DURATION_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label>Computation</label>
                      <select value={form.computation} onChange={(e) => setF("computation", e.target.value)} className="fa-edit-input">
                        {COMPUTATION_ORDER.map((c) => <option key={c} value={c}>{COMPUTATION_LABELS[c]}</option>)}
                      </select>
                    </div>
                  </div>
                  )}
                  {form.type !== asset.type && (
                    <div className="fac-note" style={{ marginTop: 10 }}>
                      Changing the type re-scopes the category list and the GL account set. Pick a category that
                      belongs to the new type before saving.
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="vd-modal-actions">
              <button className="vd-btn" onClick={() => setEditOpen(false)}>Cancel</button>
              <button className="vd-btn primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <ReviseModal
          asset={asset}
          previewValueRevision={previewValueRevision}
          onClose={() => setModal(null)}
          onConfirm={runRevise}
        />
      )}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
