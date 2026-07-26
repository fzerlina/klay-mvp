import { useState, useRef, useEffect } from "react";
import { useVendors } from "../state/VendorsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import "./relationship-tier.css";

// Vendor relationship tier (PRD TP-02). The tier lives on the vendor master, so
// this control reads/writes VendorsContext — edits made here (AP Aging) or on
// the Vendor page update the same record and show everywhere the vendor appears.

export const TIER_LABEL = { strategic: "Strategic", standard: "Standard", at_risk: "At-Risk" };
const TIERS = [
  { key: "strategic", label: "Strategic", desc: "Relationship-sensitive — prioritize on-time payment." },
  { key: "standard", label: "Standard", desc: "Default. No special handling." },
  { key: "at_risk", label: "At-Risk", desc: "Disputes or slow responses — weigh when sequencing payments." },
];
const TOOLTIP = {
  strategic: "Strategic vendor — relationship-sensitive. Late payment risks tightening terms, losing discounts, or price increases at renewal.",
  at_risk: "At-Risk vendor — documented disputes, slow responses, or payment issues. Use as a signal when sequencing payments.",
  standard: "Standard vendor — no special handling.",
};

// Display-only pill (no editing). Renders nothing for Standard.
export function TierPill({ tier }) {
  if (!tier || tier === "standard") return null;
  return <span className={`rt-pill ${tier}`} title={TOOLTIP[tier]}>{TIER_LABEL[tier]}</span>;
}

export default function RelationshipTierControl({ vendorId, editable }) {
  const { vendorById, setVendorTier } = useVendors();
  const { user, hasCapability } = useCurrentUser();
  // Tier-setting is a vendor-master capability (vendor.classify), not a
  // generic AP verb. Callers can force display-only with editable={false}.
  const canEdit = editable ?? hasCapability("vendor.classify");
  const v = vendorById(vendorId);
  const tier = v?.relationship_tier || "standard";

  const [open, setOpen] = useState(false);
  const [draftTier, setDraftTier] = useState(tier);
  const [note, setNote] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function openEditor(e) {
    e.stopPropagation();
    setDraftTier(tier);
    setNote(v?.relationship_tier_note || "");
    setOpen(true);
  }
  function save(e) {
    e.stopPropagation();
    if (!note.trim()) return;
    setVendorTier(vendorId, draftTier, note.trim(), user?.name);
    setOpen(false);
  }

  // Non-editable: just the pill (nothing for Standard).
  if (!canEdit) return <TierPill tier={tier} />;

  return (
    <span className="rt-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      {tier === "standard" ? (
        <button type="button" className="rt-set" onClick={openEditor} title="Set relationship tier">+ Tier</button>
      ) : (
        <button type="button" className={`rt-pill rt-pill-btn ${tier}`} onClick={openEditor} title={`${TOOLTIP[tier]}\n\nClick to edit`}>
          {TIER_LABEL[tier]}
        </button>
      )}
      {open && (
        <div className="rt-pop" onClick={(e) => e.stopPropagation()}>
          <div className="rt-pop-title">Relationship tier</div>
          <div className="rt-opts">
            {TIERS.map((t) => (
              <label key={t.key} className={`rt-opt${draftTier === t.key ? " on" : ""}`}>
                <input type="radio" name="rt-tier" checked={draftTier === t.key} onChange={() => setDraftTier(t.key)} />
                <span className="rt-opt-body">
                  <span className="rt-opt-lbl"><TierDot tier={t.key} /> {t.label}</span>
                  <span className="rt-opt-desc">{t.desc}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="rt-note-lbl">Reason <span className="rt-req">required</span></div>
          <textarea
            className="rt-note"
            maxLength={200}
            placeholder="Why this tier? (e.g. renewal leverage, repeated disputes)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <div className="rt-note-count">{note.length}/200</div>
          <div className="rt-actions">
            <button type="button" className="rt-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="rt-btn-save" onClick={save} disabled={!note.trim()}>Save</button>
          </div>
        </div>
      )}
    </span>
  );
}

function TierDot({ tier }) {
  return <span className={`rt-dot ${tier}`} />;
}
