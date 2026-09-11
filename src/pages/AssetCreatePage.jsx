import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAssets } from "../state/AssetsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import {
  TYPE_LABELS, TYPE_ORDER, METHOD_LABELS, METHOD_ORDER, RATE_METHODS,
  DURATION_UNIT_LABELS, COMPUTATION_LABELS, COMPUTATION_HINTS, COMPUTATION_ORDER,
} from "../lib/fixedAssets";
import { categoriesForType } from "../data/seed/fixedAssets";
import { assetAccounts } from "../lib/fixedAssets";
import "./invoice-create.css";
import "./items.css";
import "./assets.css";

// ── Add New Asset ────────────────────────────────────────────────────────────
// Every field here is ENTERED (Fixed Asset PRD §3) — there is no class to
// propose method/duration/computation/accounts, because there is no class in
// this design. Creation is ungated: saving lands the asset directly in
// Running, the same convention Item Master uses for a new item landing Active.

export default function AssetCreatePage() {
  const navigate = useNavigate();
  const { addAsset } = useAssets();
  const { user } = useCurrentUser();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [type, setType] = useState("fixed_asset");
  const [subsidiary, setSubsidiary] = useState("PT Induk");
  const [firstValue, setFirstValue] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [method, setMethod] = useState("straight_line");
  const [rate, setRate] = useState("");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit] = useState("months");
  const [computation, setComputation] = useState("constant_period");

  const [toast, setToast] = useState("");
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(""), 2600); }

  const needsRate = RATE_METHODS.includes(method);
  const categoryOptions = categoriesForType(type);
  // Category resolves the accounts, and the permitted categories depend on the
  // type — so switching type has to clear a category that no longer applies.
  const validCategory = categoryOptions.some((c) => c.key === category) ? category : "";
  const accountPreview = validCategory ? assetAccounts({ category: validCategory }) : [];

  const canSubmit = Boolean(
    name.trim() && Number(firstValue) > 0 && acquisitionDate &&
    Number(durationValue) > 0 && validCategory &&
    (!needsRate || Number(rate) > 0),
  );

  function onSave() {
    if (!canSubmit) { showToast("Fill in every required field first"); return; }
    const asset = addAsset({
      name: name.trim(), description: description.trim(), category: validCategory, serial_no: serialNo.trim(),
      type, subsidiary,
      first_value: Number(firstValue),
      acquisition_date: acquisitionDate, method,
      rate: needsRate ? Number(rate) : null,
      duration_value: Number(durationValue), duration_unit: durationUnit, computation,
      actor: user.name,
    });
    showToast(`${asset.name} added — Running ✓`);
    setTimeout(() => navigate(`/assets/${asset.id}`), 700);
  }

  return (
    <div className="addpage">
      <div className="ap-head">
        <button className="ap-close" onClick={() => navigate("/assets")} aria-label="Close">
          <svg viewBox="0 0 24 24"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
        </button>
        <div className="ap-title">Add New Asset</div>
        <div className="ap-hint" style={{ flex: 1, marginLeft: 8 }}>Fields marked * are required</div>
      </div>

      <div className="ap-s1" style={{ alignItems: "stretch", padding: "28px 24px 96px" }}>
        <div style={{ width: "100%", maxWidth: 680, margin: "0 auto" }}>

          {/* 1 — Identity */}
          <div className="form-sec card">
            <div className="form-sec-title">Identity</div>
            <div className="form-fld">
              <label>Asset Name <span className="vc-req">*</span></label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Injection Molder Line 2" />
            </div>
            <div className="form-fld">
              <label>Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this thing actually is" />
            </div>
            <div className="fg2">
              <div className="form-fld">
                <label>Category <span className="vc-req">*</span></label>
                <select value={validCategory} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select a category…</option>
                  {categoryOptions.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <span className="vc-hint">Resolves the GL account set below. The list depends on the type.</span>
              </div>
              <div className="form-fld">
                <label>Serial Number</label>
                <input type="text" value={serialNo} onChange={(e) => setSerialNo(e.target.value)} />
              </div>
            </div>
            <div className="fg2" style={{ marginBottom: 0 }}>
              <div className="form-fld">
                <label>Type <span className="vc-req">*</span></label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
                <span className="vc-hint">Sets the vocabulary and account set below — the schedule maths is identical for all three.</span>
              </div>
              <div className="form-fld">
                <label>Subsidiary</label>
                <input type="text" value={subsidiary} onChange={(e) => setSubsidiary(e.target.value)} />
              </div>
            </div>
          </div>

          {/* 2 — Value & acquisition */}
          <div className="form-sec card">
            <div className="form-sec-title">Value &amp; Acquisition</div>
            <div className="fg2" style={{ marginBottom: 0 }}>
              <div className="form-fld">
                <label>Original Value (Rp) <span className="vc-req">*</span></label>
                <input type="number" min="0" value={firstValue} onChange={(e) => setFirstValue(e.target.value)} placeholder="0" />
              </div>
              <div className="form-fld">
                <label>Acquisition Date <span className="vc-req">*</span></label>
                <input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* 3 — Method & schedule */}
          <div className="form-sec card">
            <div className="form-sec-title">Method &amp; Schedule</div>
            <div className="fg2">
              <div className="form-fld">
                <label>Method <span className="vc-req">*</span></label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHOD_ORDER.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                </select>
              </div>
              {needsRate && (
                <div className="form-fld">
                  <label>Rate per period <span className="vc-req">*</span></label>
                  <input type="number" min="0" max="1" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 0.25" />
                  <span className="vc-hint">Applied to the remaining book value each period, at this asset's own cadence.</span>
                </div>
              )}
            </div>
            <div className="fg2">
              <div className="form-fld">
                <label>Duration <span className="vc-req">*</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" min="1" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} placeholder="0" style={{ flex: 1 }} />
                  <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)} style={{ flex: 1 }}>
                    {Object.entries(DURATION_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <span className="vc-hint">{durationUnit === "years" ? "One charge at each year end — not a monthly schedule." : "One charge at each month end."}</span>
              </div>
              <div className="form-fld">
                <label>Computation</label>
                <select value={computation} onChange={(e) => setComputation(e.target.value)}>
                  {COMPUTATION_ORDER.map((c) => <option key={c} value={c}>{COMPUTATION_LABELS[c]}</option>)}
                </select>
                <span className="vc-hint">{COMPUTATION_HINTS[computation]}</span>
              </div>
            </div>
          </div>

          {/* 4 — Accounts, resolved from Category */}
          <div className="form-sec card">
            <div className="form-sec-title">GL Account Set <span className="imc-rotag">Read-only</span></div>
            {!validCategory ? (
              <div className="imc-note">Pick a category above and its account set appears here.</div>
            ) : (
              <div className="imc-acct-list">
                {accountPreview.map((a) => (
                  <div className="imc-acct-row" key={a.key}>
                    <span className="imc-acct-lbl">{a.label}</span>
                    <span className="imc-acct-val">
                      {a.name ? <>{a.name} <span className="imc-acct-code">{a.code}</span></> : <span className="imc-acct-na">Not applicable</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <span className="vc-hint" style={{ marginTop: 10, display: "block" }}>
              Resolved from the category and configured once in settings — never set per asset, so no asset
              can drift onto an account of its own. A prepaid shows no accumulated-contra and no loss account:
              it releases straight out of its own account, and it is never disposed of.
            </span>
          </div>

        </div>
      </div>

      <div className="ap-foot">
        <span className="ap-hint">Creating an asset needs no approval — nothing here is sign-off gated.</span>
        <button className="ap-btn" onClick={() => navigate("/assets")}>Cancel</button>
        <button className="ap-btn-send" onClick={onSave} disabled={!canSubmit}>
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
          Add Asset
        </button>
      </div>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
