// Recording a payment against a posted bill.
//
// Shared by the Payment list and Bill Detail so the same act is performed the
// same way wherever it is reached. A payment answers four questions, in this
// order: how is it being paid, out of which of our accounts, into which of the
// vendor's, and how does the amount break down. The breakdown comes last
// because the first three decide what the breakdown even means.
//
// `bill` needs { id, vendorId, vendorName, invNo, remaining, pph23 }, so either
// page can pass an aging line or a raw bill record.

import { useEffect, useMemo, useState } from "react";
import {
  COMMON_DEDUCTION_ACCOUNTS, DEDUCTION_ACCOUNTS, PAYMENT_METHODS, PAYMENT_METHOD_BY_KEY,
  accountByCode, breakdownTotal, cashOut, defaultBreakdown, deductionsOf, newDeduction,
  validateBreakdown, withheldTax,
} from "../lib/paymentBreakdown";
import { accountsForMethod, maskOf } from "../data/seed/bankAccounts";
import { useVendors } from "../state/VendorsContext";
import { formatRupiah, formatRupiahExact } from "../lib/format";
import "../pages/ap-aging.css";
import "../pages/payments.css";

export default function RecordPaymentModal({ bill, onConfirm, onClose }) {
  const { vendorById } = useVendors();
  const vendor = bill.vendorId ? vendorById(bill.vendorId) : null;

  // The vendor's bank account is READ-ONLY here. Where a vendor is paid is a
  // Vendor Master decision that goes through its own change control — a
  // release check fires when it moves — so letting it be retyped at the moment
  // money leaves would route around the one control that catches redirection
  // fraud. One account: the default, or the only one on file.
  const vendorBank = useMemo(() => {
    const banks = vendor?.banks || [];
    return banks.find((b) => b.isDefault) || banks[0] || null;
  }, [vendor]);

  const [bd, setBd] = useState(() => defaultBreakdown(bill));

  const sourceOptions = useMemo(() => accountsForMethod(bd.method), [bd.method]);
  const source = sourceOptions.find((a) => a.id === bd.sourceAccountId) || null;

  // Switching method switches the pool of accounts it can draw on, so a source
  // that is no longer eligible is dropped rather than silently left pointing at
  // an operating account on a cash payment. With exactly one option there is
  // nothing to choose — it is selected and shown as a fact.
  useEffect(() => {
    setBd((prev) => {
      if (sourceOptions.some((a) => a.id === prev.sourceAccountId)) return prev;
      return { ...prev, sourceAccountId: sourceOptions.length === 1 ? sourceOptions[0].id : null };
    });
  }, [sourceOptions]);

  const deductions = deductionsOf(bd);
  const check = validateBreakdown(bd, bill.remaining);
  const allocated = breakdownTotal(bd);
  const openAfter = Math.max(0, bill.remaining - allocated);
  const withheld = withheldTax(bd);

  const patch = (p) => setBd((prev) => ({ ...prev, ...p }));

  // Moving a deduction takes the difference out of the vendor's cash, so the
  // total allocated stays where it was and the bill stays fully covered until
  // you deliberately lower the cash line.
  const setDeductionAmount = (id, amount) => setBd((prev) => {
    const row = deductionsOf(prev).find((d) => d.id === id);
    const delta = amount - (Number(row?.amount) || 0);
    return {
      ...prev,
      to_vendor: Math.max(0, (prev.to_vendor || 0) - delta),
      deductions: deductionsOf(prev).map((d) => (d.id === id ? { ...d, amount } : d)),
    };
  });
  const setDeductionAccount = (id, account) => setBd((prev) => ({
    ...prev,
    deductions: deductionsOf(prev).map((d) => (d.id === id ? { ...d, account } : d)),
  }));
  const addDeduction = () => setBd((prev) => ({ ...prev, deductions: [...deductionsOf(prev), newDeduction()] }));
  const dropDeduction = (id) => setBd((prev) => {
    const row = deductionsOf(prev).find((d) => d.id === id);
    return {
      ...prev,
      to_vendor: (prev.to_vendor || 0) + (Number(row?.amount) || 0),
      deductions: deductionsOf(prev).filter((d) => d.id !== id),
    };
  });

  const methodMeta = PAYMENT_METHOD_BY_KEY[bd.method];
  const isCash = bd.method === "cash";

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

          {/* ── How ─────────────────────────────────────────────────────── */}
          <div className="pm-sec">
            <div className="pm-sec-lbl">Payment method</div>
            <div className="pm-method-row">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`pm-method${bd.method === m.key ? " on" : ""}`}
                  onClick={() => patch({ method: m.key })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {methodMeta && <div className="pm-sec-hint">{methodMeta.hint}</div>}
          </div>

          {/* ── Out of which of our accounts ────────────────────────────── */}
          <div className="pm-sec">
            <div className="pm-sec-lbl">{isCash ? "Paid from (cash float)" : "Paid from"}</div>
            {sourceOptions.length === 0 ? (
              <div className="pm-acct-empty">
                No {isCash ? "petty cash" : "bank"} account is set up for this. Add one in Settings → Bank Accounts.
              </div>
            ) : sourceOptions.length === 1 ? (
              <AccountCard account={sourceOptions[0]} note="The only account available for this method." />
            ) : (
              <>
                <select
                  className="pm-select"
                  value={bd.sourceAccountId || ""}
                  onChange={(e) => patch({ sourceAccountId: e.target.value || null })}
                >
                  <option value="">Choose an account…</option>
                  {sourceOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {maskOf(a)} · {a.currency}
                    </option>
                  ))}
                </select>
                {source && <AccountCard account={source} />}
              </>
            )}
          </div>

          {bd.method === "giro" && (
            <div className="pm-sec">
              <div className="pm-sec-lbl">Giro number</div>
              <input
                className="pm-text-input"
                value={bd.giroNumber}
                placeholder="e.g. GR-0042817"
                onChange={(e) => patch({ giroNumber: e.target.value })}
              />
              <div className="pm-sec-hint">
                Reconciliation looks for this number when the giro clears, so the bill and the bank line can be matched then.
              </div>
            </div>
          )}

          {/* ── Into which of theirs ────────────────────────────────────── */}
          <div className="pm-sec">
            <div className="pm-sec-lbl">Paid to</div>
            {vendorBank ? (
              <div className={`pm-acct-card readonly${isCash ? " muted" : ""}`}>
                <div className="pm-acct-main">
                  <span className="pm-acct-name">{vendorBank.holder || bill.vendorName}</span>
                  <span className="pm-acct-lock" title="Set in Vendor Master">Read-only</span>
                </div>
                <div className="pm-acct-sub">
                  {vendorBank.name}{vendorBank.branch ? ` · ${vendorBank.branch}` : ""} · {vendorBank.acc}
                </div>
                <div className="pm-acct-note">
                  {isCash
                    ? "Not used — this is a cash payment. Kept visible so the vendor on file is still the vendor being paid."
                    : "From Vendor Master. Change it there, where the change is reviewed."}
                </div>
              </div>
            ) : (
              <div className="pm-acct-empty">
                No bank account on file for this vendor. Add one in Vendor Master before paying by transfer.
              </div>
            )}
          </div>

          {/* ── How much, and booked where ──────────────────────────────── */}
          <div className="pm-sec">
            <div className="pm-sec-lbl">Breakdown</div>
            <div className="pm-bd-list">
              <div className="pm-bd-row cash">
                <div className="pm-bd-lbl">
                  <span className="pm-bd-name">To vendor</span>
                  <span className="pm-bd-hint">
                    {isCash ? "Cash handed over from the float." : "Cash that actually leaves the account above."}
                  </span>
                </div>
                <div className="pm-bd-input">
                  <span className="apa-modal-prefix">Rp</span>
                  <input
                    inputMode="numeric"
                    autoFocus
                    value={bd.to_vendor ? bd.to_vendor.toLocaleString("id-ID") : ""}
                    placeholder="0"
                    onChange={(e) => patch({ to_vendor: digits(e.target.value) })}
                  />
                </div>
                <span aria-hidden className="pm-bd-x-spacer" />
              </div>

              {deductions.map((d) => (
                <DeductionRow
                  key={d.id}
                  row={d}
                  onAmount={(v) => setDeductionAmount(d.id, v)}
                  onAccount={(v) => setDeductionAccount(d.id, v)}
                  onRemove={() => dropDeduction(d.id)}
                />
              ))}
            </div>

            <button type="button" className="pm-bd-add-btn" onClick={addDeduction}>+ Add a deduction</button>
          </div>

          <div className="pm-bd-tally">
            <div className="pm-bd-tally-row">
              <span>Clears off the bill</span>
              <strong>{formatRupiahExact(allocated)}</strong>
            </div>
            <div className="pm-bd-tally-row">
              <span>{isCash ? "Leaves the cash float" : bd.method === "giro" ? "Leaves the bank when the giro clears" : "Leaves the bank"}</span>
              <strong>{formatRupiahExact(cashOut(bd))}</strong>
            </div>
            <div className={`pm-bd-tally-row${openAfter > 0 ? " open" : " paid"}`}>
              <span>{openAfter > 0 ? "Still open after this" : "Bill is paid in full"}</span>
              <strong>{openAfter > 0 ? formatRupiahExact(openAfter) : "—"}</strong>
            </div>
          </div>

          {withheld > 0 && (
            <div className="pm-bd-tax">
              {bill.vendorName} receives <strong>{formatRupiahExact(cashOut(bd))}</strong>, the tax office is owed{" "}
              <strong>{formatRupiahExact(withheld)}</strong> — a bukti potong obligation is created for that amount.
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
          {/* The label reads off the allocation, not off `check`: while the
              form is still incomplete the button is disabled anyway, and
              calling a full payment "partial" just because a source account is
              missing tells the user the wrong thing about their own numbers. */}
          <button type="button" className="apa-modal-btn primary" disabled={!check.ok} onClick={() => onConfirm(bill.id, bd)}>
            {openAfter > 0 ? "Record partial payment" : "Record full payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

const digits = (s) => Number(String(s).replace(/[^\d]/g, "")) || 0;

// One deduction: an amount and the account it is booked to. Both are the
// user's to set — the account is the classification, so there is no separate
// "type" to pick and then silently map to a code.
function DeductionRow({ row, onAmount, onAccount, onRemove }) {
  const picked = accountByCode(row.account);
  const suggestion = COMMON_DEDUCTION_ACCOUNTS.find((s) => s.code === row.account);
  return (
    <div className="pm-bd-row deduction">
      <div className="pm-bd-lbl">
        <select
          className="pm-select pm-bd-acct"
          value={row.account}
          onChange={(e) => onAccount(e.target.value)}
        >
          <option value="">Choose an account…</option>
          <optgroup label="Common on payments">
            {COMMON_DEDUCTION_ACCOUNTS.map((s) => (
              <option key={s.code} value={s.code}>{s.code} · {accountByCode(s.code).name}</option>
            ))}
          </optgroup>
          <optgroup label="All accounts">
            {DEDUCTION_ACCOUNTS.map((a) => (
              <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
            ))}
          </optgroup>
        </select>
        <span className="pm-bd-hint">
          {suggestion ? suggestion.hint
            : picked ? `Booked to ${picked.name} — ${picked.fs === "BS" ? "balance sheet" : "profit & loss"}.`
              : "Pick where this part of the balance is booked."}
        </span>
      </div>
      <div className="pm-bd-input">
        <span className="apa-modal-prefix">Rp</span>
        <input
          inputMode="numeric"
          value={row.amount ? row.amount.toLocaleString("id-ID") : ""}
          placeholder="0"
          onChange={(e) => onAmount(digits(e.target.value))}
        />
      </div>
      <button type="button" className="pm-bd-x" onClick={onRemove} aria-label="Remove this deduction">×</button>
    </div>
  );
}

// Our own account, shown as a fact once it is settled.
function AccountCard({ account, note }) {
  return (
    <div className="pm-acct-card">
      <div className="pm-acct-main">
        <span className="pm-acct-dot" style={{ background: account.bankColor }} aria-hidden />
        <span className="pm-acct-name">{account.name}</span>
        <span className="pm-acct-cur">{account.currency}</span>
      </div>
      <div className="pm-acct-sub">
        {account.bank} · {account.number}
        {account.glAccount ? ` · ${account.glAccount} ${account.glAccountName}` : " · no GL account mapped"}
      </div>
      {note && <div className="pm-acct-note">{note}</div>}
    </div>
  );
}
