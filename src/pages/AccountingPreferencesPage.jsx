import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { COA } from "../data/seed/coa";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";
import { COMPANY, MONTHS } from "../data/seed/company";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";

// Settings → Accounting → General Ledger → Preferences. The small, company-wide accounting
// choices, one section each — as DualEntry gathers its posting and record
// preferences on one General preferences page. New one-off settings go here
// rather than getting their own page.
//   • Basics — base currency, fiscal year, time zone (set at company creation)
//   • Posting — auto-assign late bills to the open period
//   • Journals — soft-delete of posted manual journals (off unless asked for)
// Costing method and reconciliation difference accounts moved to their module
// settings (Settings → Inventory → Costing, Settings → Reconciliation); their
// sections are exported from here and rendered there.

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function periodLabel(yyyymm) {
  if (!yyyymm || yyyymm.length < 7) return "—";
  const [y, m] = yyyymm.split("-");
  return `${MONTHS_EN[parseInt(m, 10) - 1] || m} ${y}`;
}

const COSTING_OPTIONS = [
  {
    k: "average_cost",
    title: "Average Cost",
    desc: "Every unit on hand is carried at one blended weighted-average cost. Each purchase recomputes the average. Simpler to run and smooths out price swings.",
  },
  {
    k: "actual_cost",
    title: "Actual Cost",
    desc: "Each unit keeps its own purchase cost (specific identification / cost layers). More precise cost of goods sold, but needs per-layer tracking.",
  },
];

// Anything but cash and bank: booking a bank difference to another bank
// account would just move it.
const RECON_ELIGIBLE = COA.filter((a) => a.code && a.is_active && a.parent !== "g-cash").sort((a, b) => a.code.localeCompare(b.code));
const accountOf = (code) => COA.find((a) => a.code === code);

function Section({ id, title, children }) {
  return (
    <section id={id} className="ap-section">
      <h2 className="ap-section-title">{title}</h2>
      {children}
    </section>
  );
}

function BasicsSection() {
  const { baseCurrency, fiscalYearStart, setFiscalYearStart, timezone, setTimezone } = useAccountingSettings();
  const created = new Date(COMPANY.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <Section id="basics" title="Basics">
      <div className="pp-setting-card">
        <div className="pp-setting-pad">
          <p className="pp-setting-desc" style={{ marginTop: 0 }}>
            Set when the company was created on {created}. Posting periods follow the fiscal year.
          </p>
          <div className="cp-grid ap-basics">
            <label className="cp-field">
              <span>Base currency</span>
              <select value={baseCurrency} disabled>
                <option value="IDR">IDR — Indonesian Rupiah</option>
              </select>
              <em>Locked — entries have already been posted in IDR.</em>
            </label>
            <label className="cp-field">
              <span>Fiscal year starts</span>
              <select value={fiscalYearStart} onChange={(e) => setFiscalYearStart(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <em>Fiscal year {MONTHS[fiscalYearStart - 1]} – {MONTHS[(fiscalYearStart + 10) % 12]}.</em>
            </label>
            <label className="cp-field">
              <span>Time zone</span>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="Asia/Jakarta">WIB — Asia/Jakarta (UTC+7)</option>
                <option value="Asia/Makassar">WITA — Asia/Makassar (UTC+8)</option>
                <option value="Asia/Jayapura">WIT — Asia/Jayapura (UTC+9)</option>
              </select>
              <em>Decides which day a transaction falls on.</em>
            </label>
          </div>
        </div>
      </div>
    </Section>
  );
}

function JournalsSection() {
  const { journalDeletion, setJournalDeletion } = useAccountingSettings();
  return (
    <Section id="journals" title="Journals">
      <div className="pp-setting-card">
        <div className="pp-setting-main">
          <div className="pp-setting-text">
            <div className="pp-setting-title">Allow deleting posted journals</div>
            <p className="pp-setting-desc">
              Lets people delete a posted manual journal instead of reversing it. A deletion is never silent: someone
              requests it with a reason, and someone else who can post journals approves it. The entry then leaves
              the ledger but stays listed under <strong>Deleted</strong>, and the request, the approval and the entry
              itself remain in the audit trail.
            </p>
            <p className="pp-setting-note">
              Journals from bills, payments, invoices and bank reconciliation are deleted at their source, and nothing
              in a closed period can be deleted. Reversing is the standard correction — turn this on only if your
              auditor accepts deletions.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={journalDeletion}
            className={`pp-switch${journalDeletion ? " on" : ""}`}
            onClick={() => setJournalDeletion(!journalDeletion)}
          >
            <span className="pp-switch-knob" />
          </button>
        </div>
        <div className={`pp-setting-status${journalDeletion ? " on" : ""}`}>
          {journalDeletion
            ? "On — posted manual journals can be deleted with approval."
            : "Off — posted journals are corrected by reversing them."}
        </div>
      </div>
    </Section>
  );
}

function PostingSection() {
  const { closedThrough, nextOpenPeriod, autoAssignLateBills, setAutoAssignLateBills } = useClosePeriod();
  return (
    <Section id="posting" title="Posting">
      <div className="pp-setting-card">
        <div className="pp-setting-main">
          <div className="pp-setting-text">
            <div className="pp-setting-title">Auto-assign late bills to the open period</div>
            <p className="pp-setting-desc">
              When a bill is dated in a period that&rsquo;s already closed, post it to the current open
              period (<strong>{periodLabel(nextOpenPeriod)}</strong>) automatically. The invoice date is
              preserved as a document fact — only the accounting period rolls forward. Periods up to{" "}
              <strong>{periodLabel(closedThrough)}</strong> are closed.
            </p>
            <p className="pp-setting-note">
              Turn this off to require someone to reassign each late bill by hand before it can post.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoAssignLateBills}
            className={`pp-switch${autoAssignLateBills ? " on" : ""}`}
            onClick={() => setAutoAssignLateBills(!autoAssignLateBills)}
          >
            <span className="pp-switch-knob" />
          </button>
        </div>
        <div className={`pp-setting-status${autoAssignLateBills ? " on" : ""}`}>
          {autoAssignLateBills
            ? `On — late bills post to ${periodLabel(nextOpenPeriod)} automatically.`
            : "Off — late bills must be reassigned manually before posting."}
        </div>
      </div>
    </Section>
  );
}

// Shown on Settings → Inventory → Costing.
export function InventorySection() {
  const { inventoryCostingMethod, setInventoryCostingMethod } = useAccountingSettings();
  return (
    <Section id="inventory" title="Inventory">
      <div className="pp-setting-card">
        <div className="pp-setting-pad">
        <div className="pp-setting-title">Costing method</div>
        <p className="pp-setting-desc">
          How stock is valued across the company — every product&rsquo;s stock value and cost of goods sold.
          It can&rsquo;t be overridden per item.
        </p>
        <div className="is-options">
          {COSTING_OPTIONS.map((o) => {
            const selected = inventoryCostingMethod === o.k;
            return (
              <button
                key={o.k}
                type="button"
                className={`is-option${selected ? " selected" : ""}`}
                onClick={() => setInventoryCostingMethod(o.k)}
              >
                <span className="is-option-radio" aria-hidden />
                <span className="is-option-body">
                  <span className="is-option-title">
                    {o.title}
                    {selected && <span className="is-current">Current</span>}
                  </span>
                  <span className="is-option-desc">{o.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="pp-setting-note">
          A one-time setup choice. Changing it after transactions exist restates cost of goods sold and
          inventory value, and in production would need a controlled revaluation.
        </p>
        </div>
      </div>
    </Section>
  );
}

// Shown on Settings → Reconciliation.
export function ReconciliationSection() {
  const { reconDifferenceAccounts: codes, setReconDifferenceAccounts: setCodes } = useAccountingSettings();
  const [adding, setAdding] = useState("");
  const available = RECON_ELIGIBLE.filter((a) => !codes.includes(a.code));
  const add = (code) => {
    if (!code) return;
    setCodes([...codes, code]);
    setAdding("");
  };
  const remove = (code) => setCodes(codes.filter((c) => c !== code));

  return (
    <Section id="reconciliation" title="Bank reconciliation">
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
            codes.map((code) => (
              <div key={code} className="brs-row">
                <span className="brs-code">{code}</span>
                <span className="brs-name">{accountOf(code)?.name || "Unknown account"}</span>
                <button type="button" className="brs-remove" onClick={() => remove(code)} aria-label={`Remove ${code}`}>
                  <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
                </button>
              </div>
            ))
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
    </Section>
  );
}

export default function AccountingPreferencesPage() {
  // Old links (/posting-periods, …) land on #posting / #inventory / #reconciliation.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="General Ledger"
          tabs={ACCOUNTING_TABS}
          intro="Company-wide accounting choices: the basics set at company creation, how late bills post, and whether posted journals can be deleted."
        />
        <BasicsSection />
        <PostingSection />
        <JournalsSection />
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
