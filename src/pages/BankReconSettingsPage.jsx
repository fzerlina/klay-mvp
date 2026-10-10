import { useState } from "react";
import { COA } from "../data/seed/coa";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { DEFAULT_FEE_CEILING, FEE_CEILING_BY_BANK } from "../data/seed/bankFees";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";

// Settings → Accounting → Bank reconciliation. Owns the accounts Reconcile
// manually may book a difference to — the few rupiah between a bank line and
// the records it pays. Only these appear in that picker, so a person
// reconciling can't send a gap to whatever account comes to mind.

// Anything but cash and bank: booking a bank difference to another bank
// account would just move it.
const ELIGIBLE = COA.filter((a) => a.code && a.is_active && a.parent !== "g-cash").sort((a, b) => a.code.localeCompare(b.code));
const accountOf = (code) => COA.find((a) => a.code === code);

export default function BankReconSettingsPage() {
  const { reconDifferenceAccounts: codes, setReconDifferenceAccounts: setCodes } = useAccountingSettings();
  const [adding, setAdding] = useState("");

  const available = ELIGIBLE.filter((a) => !codes.includes(a.code));
  const add = (code) => {
    if (!code) return;
    setCodes([...codes, code]);
    setAdding("");
  };
  const remove = (code) => setCodes(codes.filter((c) => c !== code));

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Bank reconciliation</h1>
              <p className="settings-sub">
                How Klay handles what&rsquo;s left over when a bank line is reconciled by hand.
              </p>
            </div>
          </div>
        </div>

        <div className="pp-setting-card">
          <div className="pp-setting-main">
            <div className="pp-setting-text">
              <div className="pp-setting-title">Difference accounts</div>
              <p className="pp-setting-desc">
                When the Klay transactions ticked in To match don&rsquo;t add up to the bank line exactly — bank
                rounding, a few rupiah lost on a transfer — the difference can be booked to one of these accounts.
                Klay drafts a journal for it in Review &amp; post journals.
              </p>
            </div>
          </div>

          <div className="brs-list">
            {codes.length === 0 ? (
              <div className="brs-empty">
                No accounts yet. Until one is added, a manual reconciliation has to add up exactly.
              </div>
            ) : (
              codes.map((code) => {
                const a = accountOf(code);
                return (
                  <div key={code} className="brs-row">
                    <span className="brs-code">{code}</span>
                    <span className="brs-name">{a?.name || "Unknown account"}</span>
                    <button type="button" className="brs-remove" onClick={() => remove(code)} aria-label={`Remove ${code}`}>
                      <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="brs-add">
            <select className="brs-select" value={adding} onChange={(e) => add(e.target.value)} aria-label="Add an account">
              <option value="">Add an account…</option>
              {available.map((a) => (
                <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* What each bank's charges top out at. A debit the bank describes as
            a fee, at or under its bank's ceiling, is drafted as a bank charge;
            anything larger has to be matched. Placeholders until confirmed
            against each bank's published fee schedule (data/seed/bankFees.js). */}
        <div className="pp-setting-card">
          <div className="pp-setting-main">
            <div className="pp-setting-text">
              <div className="pp-setting-title">Bank fee ceilings</div>
              <p className="pp-setting-desc">
                A debit the bank describes as a fee, up to this amount, is drafted as a bank charge in Review &amp; post
                journals. Anything larger is treated as a payment and has to be matched. Banks not listed use
                Rp {DEFAULT_FEE_CEILING.toLocaleString("id-ID")}.
              </p>
            </div>
          </div>
          <div className="brs-list">
            {Object.entries(FEE_CEILING_BY_BANK).map(([bank, ceiling]) => (
              <div key={bank} className="brs-row">
                <span className="brs-code">{BANK_NAMES[bank] || bank}</span>
                <span className="brs-name">Up to Rp {ceiling.toLocaleString("id-ID")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// The master stores Mandiri as "MDR" for its card logo.
const BANK_NAMES = { MDR: "Mandiri", PERMATA: "Permata" };
