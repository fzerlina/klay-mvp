// Recording a payment against a posted bill.
//
// Shared by the Payment list and Bill Detail so the same act is performed the
// same way wherever it is reached: every payment is composed of named parts
// rather than one anonymous amount. Deductions come out of the vendor's share
// as you type, so the allocation stays pinned to the open balance until you
// deliberately lower the cash line — which is what turns the payment into a
// partial.
//
// `bill` needs only { id, vendorName, invNo, remaining, pph23 }, so either page
// can pass an aging line or a raw bill record.

import { useMemo, useState } from "react";
import {
  BREAKDOWN_BY_KEY, DEDUCTION_TYPES, breakdownTotal, cashOut,
  defaultBreakdown, validateBreakdown,
} from "../lib/paymentBreakdown";
import { formatRupiah, formatRupiahExact } from "../lib/format";
import "../pages/ap-aging.css";
import "../pages/payments.css";

export default function RecordPaymentModal({ bill, onConfirm, onClose }) {
  const [bd, setBd] = useState(() => defaultBreakdown(bill));
  const [adding, setAdding] = useState(false);
  // Deduction rows the user has opened. Tracked separately from the values so a
  // row you just added stays on screen at Rp 0 while you type into it.
  const [opened, setOpened] = useState(() => (bill.pph23 > 0 ? ["withholding"] : []));

  const shown = useMemo(
    () => DEDUCTION_TYPES.filter((t) => (bd[t.key] || 0) !== 0 || opened.includes(t.key)),
    [bd, opened],
  );

  const unshown = DEDUCTION_TYPES.filter((t) => !shown.some((s) => s.key === t.key));
  const check = validateBreakdown(bd, bill.remaining);
  const allocated = breakdownTotal(bd);
  const openAfter = Math.max(0, bill.remaining - allocated);

  // Moving a deduction takes the difference out of the vendor's cash, so the
  // total stays where it was.
  const setDeduction = (key, value) => setBd((prev) => {
    const delta = value - (prev[key] || 0);
    return { ...prev, [key]: value, to_vendor: Math.max(0, (prev.to_vendor || 0) - delta) };
  });
  const dropDeduction = (key) => {
    setBd((prev) => ({ ...prev, [key]: 0, to_vendor: (prev.to_vendor || 0) + (prev[key] || 0) }));
    setOpened((prev) => prev.filter((k) => k !== key));
  };

  return (
    <div className="apa-modal-scrim" onClick={onClose}>
      <div className="apa-modal pm-pay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="apa-modal-head">
          <h3>Record payment</h3>
          <button type="button" className="apa-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="apa-modal-body">
          <div className="apa-modal-row"><span>Vendor</span><strong>{bill.vendorName}</strong></div>
          <div className="apa-modal-row"><span>Invoice</span><strong>{bill.invNo}</strong></div>
          <div className="apa-modal-row"><span>Open balance</span><strong>{formatRupiah(bill.remaining)}</strong></div>

          <div className="pm-bd-list">
            <MoneyRow
              type={BREAKDOWN_BY_KEY.to_vendor}
              value={bd.to_vendor}
              autoFocus
              onChange={(v) => setBd((prev) => ({ ...prev, to_vendor: v }))}
            />
            {shown.map((t) => (
              <MoneyRow
                key={t.key}
                type={t}
                value={bd[t.key] || 0}
                onChange={(v) => setDeduction(t.key, v)}
                onRemove={() => dropDeduction(t.key)}
              />
            ))}
          </div>

          {unshown.length > 0 && (
            <div className="pm-bd-add">
              <button type="button" className="pm-bd-add-btn" onClick={() => setAdding((a) => !a)}>
                {adding ? "− Close" : "+ Add a deduction"}
              </button>
              {adding && (
                <div className="pm-bd-menu">
                  {unshown.map((t) => (
                    <button key={t.key} type="button" onClick={() => { setOpened((p) => [...p, t.key]); setAdding(false); }}>
                      <span className="pm-bd-menu-lbl">{t.label}</span>
                      <span className="pm-bd-menu-hint">{t.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pm-bd-tally">
            <div className="pm-bd-tally-row">
              <span>Clears off the bill</span>
              <strong>{formatRupiahExact(allocated)}</strong>
            </div>
            <div className="pm-bd-tally-row">
              <span>Leaves the bank</span>
              <strong>{formatRupiahExact(cashOut(bd))}</strong>
            </div>
            <div className={`pm-bd-tally-row${openAfter > 0 ? " open" : " paid"}`}>
              <span>{openAfter > 0 ? "Still open after this" : "Bill is paid in full"}</span>
              <strong>{openAfter > 0 ? formatRupiahExact(openAfter) : "—"}</strong>
            </div>
          </div>

          {bd.withholding > 0 && (
            <div className="pm-bd-tax">
              {bill.vendorName} receives <strong>{formatRupiahExact(cashOut(bd))}</strong>, the tax office is owed{" "}
              <strong>{formatRupiahExact(bd.withholding)}</strong> — a bukti potong obligation is created for that amount.
            </div>
          )}

          <div className="apa-modal-note">
            {!check.ok ? check.reason
              : openAfter > 0
                ? "A partial payment. The remainder keeps its original aging and re-enters the request queue."
                : "Pays the bill in full. Every component above is booked to its own account."}
          </div>
        </div>

        <div className="apa-modal-foot">
          <button type="button" className="apa-modal-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="apa-modal-btn primary" disabled={!check.ok} onClick={() => onConfirm(bill.id, bd)}>
            {check.paysInFull ? "Record full payment" : "Record partial payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One typed component of a payment.
function MoneyRow({ type, value, onChange, onRemove, autoFocus }) {
  return (
    <div className={`pm-bd-row${type.cash ? " cash" : ""}`}>
      <div className="pm-bd-lbl">
        <span className="pm-bd-name">{type.label}</span>
        <span className="pm-bd-hint">{type.hint}</span>
      </div>
      <div className="pm-bd-input">
        <span className="apa-modal-prefix">Rp</span>
        <input
          inputMode="numeric"
          autoFocus={autoFocus}
          value={value ? value.toLocaleString("id-ID") : ""}
          placeholder="0"
          onChange={(e) => onChange(Number(String(e.target.value).replace(/[^\d]/g, "")) || 0)}
        />
      </div>
      {onRemove
        ? <button type="button" className="pm-bd-x" onClick={onRemove} aria-label={`Remove ${type.label}`}>×</button>
        : <span aria-hidden className="pm-bd-x-spacer" />}
    </div>
  );
}
