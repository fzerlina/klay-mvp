import { useState, useRef, useEffect } from "react";
import { useVendors } from "../state/VendorsContext";
import { useCustomers } from "../state/CustomersContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import "./relationship-tier.css";

// Relationship tier — a master-data attribute of a VENDOR (AP) or CUSTOMER (AR).
// The tier lives on the master record, so this control reads/writes the matching
// context; edits made anywhere (list, detail, AP Aging) update the same record
// and show everywhere the party appears. Pass `vendorId` OR `customerId`.

export const TIER_LABEL = { strategic: "Strategic", standard: "Standard", at_risk: "In Dispute" };
const TIERS = [
  { key: "strategic", label: "Strategic", desc: "Relationship-sensitive — a key account to protect." },
  { key: "standard", label: "Standard", desc: "Default. No special handling." },
  { key: "at_risk", label: "In Dispute", desc: "In active dispute — weigh carefully." },
];
const TOOLTIP = {
  strategic: "Strategic — a key relationship. Handle with priority (terms, responsiveness, retention).",
  at_risk: "In Dispute — documented disputes, slow responses, or payment issues. Use as a signal.",
  standard: "Standard — no special handling.",
};

// Display-only pill (no editing). Renders nothing for Standard.
export function TierPill({ tier }) {
  if (!tier || tier === "standard") return null;
  return <span className={`rt-pill ${tier}`} title={TOOLTIP[tier]}>{TIER_LABEL[tier]}</span>;
}

export default function RelationshipTierControl({ vendorId, customerId, editable }) {
  const vendors = useVendors();
  const customers = useCustomers();
  const { user, hasCapability } = useCurrentUser();
  // Vendor (AP) vs customer (AR) — pick the matching master record + capability.
  const isCustomer = !!customerId;
  const id = customerId || vendorId;
  const getById = isCustomer ? customers.customerById : vendors.vendorById;
  const setTier = isCustomer ? customers.setCustomerTier : vendors.setVendorTier;
  // Tier-setting is a master-data capability (vendor.classify / customer.classify),
  // not a generic verb. Callers can force display-only with editable={false}.
  const canEdit = editable ?? hasCapability(isCustomer ? "customer.classify" : "vendor.classify");
  const v = getById(id);
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
    setTier(id, draftTier, note.trim(), user?.name);
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
