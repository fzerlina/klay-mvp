import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { COA } from "../data/seed/coa";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import { canDelete, withEvent, isoOf } from "../lib/journalLifecycle";
import { TODAY } from "../lib/clock";
import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";
import { COMPANY, MONTHS } from "../data/seed/company";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles.css";

// Settings → Accounting → General Ledger → Preferences. The small, company-wide accounting
// choices, one section each — as DualEntry gathers its posting and record
// preferences on one General preferences page. New one-off settings go here
// rather than getting their own page.
//   • Basics — base currency, fiscal year, time zone (set at company creation)
//   • Posting — auto-assign late bills to the open period
//   • Closing — the day of the next month each month's books close by
//   • Delete journals — by JE number; only when Klay has turned it on
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
  const { log } = useSettingsAudit();
  const canEdit = useCurrentUser().hasCapability("settings.entity.manage");
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
              <select value={fiscalYearStart} disabled={!canEdit} onChange={(e) => {
                log("General Ledger", "Preferences", `Fiscal year start: ${MONTHS[fiscalYearStart - 1]} → ${MONTHS[Number(e.target.value) - 1]}`);
                setFiscalYearStart(Number(e.target.value));
              }}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <em>Fiscal year {MONTHS[fiscalYearStart - 1]} – {MONTHS[(fiscalYearStart + 10) % 12]}.</em>
            </label>
            <label className="cp-field">
              <span>Time zone</span>
              <select value={timezone} disabled={!canEdit} onChange={(e) => {
                log("General Ledger", "Preferences", `Time zone: ${timezone} → ${e.target.value}`);
                setTimezone(e.target.value);
              }}>
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

// Day N of the next month: when a month's books are due to close.
const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
function cutoffDate(period, day) {
  const [y, m] = period.split("-").map(Number);
  const next = new Date(m === 12 ? y + 1 : y, m === 12 ? 0 : m, day);
  return next.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function ClosingSection() {
  const { closeCutoffDay, setCloseCutoffDay } = useAccountingSettings();
  const canEdit = useCurrentUser().hasCapability("settings.period.lock");
  const { nextOpenPeriod } = useClosePeriod();
  const { log } = useSettingsAudit();
  const pick = (day) => {
    log("General Ledger", "Preferences", `Closing cut-off: day ${closeCutoffDay} → day ${day} of the following month`);
    setCloseCutoffDay(day);
  };
  return (
    <Section id="closing" title="Closing">
      <div className="pp-setting-card">
        <div className="pp-setting-pad">
          <div className="pp-setting-title">Monthly cut-off</div>
          <p className="pp-setting-desc">
            The day of the following month by which each month's books should be closed.
          </p>
          <div className="cp-grid ap-basics">
            <label className="cp-field">
              <span>Close by</span>
              <select value={closeCutoffDay} disabled={!canEdit} onChange={(e) => pick(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, k) => k + 1).map((d) => (
                  <option key={d} value={d}>{ordinal(d)} of the following month</option>
                ))}
              </select>
              <em>{periodLabel(nextOpenPeriod)} closes by {cutoffDate(nextOpenPeriod, closeCutoffDay)}.</em>
            </label>
          </div>
        </div>
      </div>
    </Section>
  );
}

// Shown only when Klay has turned deletion on in the backend — it is not a
// switch in the app. Someone enters the JE numbers, Klay checks each one, and
// on confirm with a reason each becomes "deleted": out of the ledger, listed
// under Deleted, the deletion in the entry's own audit trail.
const parseNumbers = (text) => [...new Set(text.toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];

function DeleteJournalsSection() {
  const { entries, updateJournalEntry } = useJournalEntries();
  const { closedThrough } = useClosePeriod();
  const { user, hasCapability } = useCurrentUser();
  const { log } = useSettingsAudit();
  const canDeleteHere = hasCapability("gl.je.reverse");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(null); // [{ number, je, check }]
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");

  const ready = (checked || []).filter((r) => r.check.ok);

  function runCheck() {
    setDone("");
    setChecked(parseNumbers(text).map((number) => {
      const je = entries.find((e) => e.je_number.toUpperCase() === number);
      return { number, je, check: je ? canDelete(je, { closedThrough }) : { ok: false, reason: "No journal with this number." } };
    }));
  }

  function confirm() {
    const by = user.name;
    const why = reason.trim();
    for (const r of ready) {
      updateJournalEntry(r.je.je_number, (cur) => withEvent(
        { ...cur, status: "deleted", deletion: { deleted_by: by, deleted_at: isoOf(TODAY), reason: why } },
        "deleted", by, `Deleted from Settings → Preferences: ${why}`,
      ));
    }
    log("General Ledger", "Preferences", `Deleted ${ready.map((r) => r.je.je_number).join(", ")} — ${why}`);
    setDone(`${ready.length} journal${ready.length === 1 ? "" : "s"} deleted. ${ready.length === 1 ? "It's" : "They're"} listed under Deleted on Journal Entry.`);
    setConfirming(false);
    setChecked(null);
    setText("");
    setReason("");
  }

  return (
    <Section id="delete-journals" title="Delete journals">
      <div className="pp-setting-card">
        <div className="pp-setting-pad">
          <p className="pp-setting-desc" style={{ marginTop: 0 }}>
            Turned on for this company by Klay. Enter the numbers of posted manual journals to delete. A deleted
            journal leaves the ledger but stays listed under <strong>Deleted</strong>, and the deletion — who, when
            and why — is recorded in its audit trail. Reversing stays the standard correction.
          </p>
          <p className="pp-setting-note">
            Journals from bills, payments, invoices and bank reconciliation are deleted at their source, and nothing in
            a closed period can be deleted.
          </p>
          {canDeleteHere ? (
            <>
              <div className="dj-input-row">
                <textarea className="dj-input" rows={2} value={text} placeholder="e.g. JE-2025-0412, JE-2025-0413"
                  onChange={(e) => { setText(e.target.value); setChecked(null); }} aria-label="Journal numbers" />
                <button type="button" className="rl-btn" disabled={!parseNumbers(text).length} onClick={runCheck}>Check</button>
              </div>
              {checked && (
                <ul className="dj-results">
                  {checked.map((r) => (
                    <li key={r.number} className={r.check.ok ? "ok" : "no"}>
                      <span className="mr-code">{r.number}</span>
                      <span className="dj-memo">{r.je ? `${r.je.memo} · ${r.je.je_date}` : ""}</span>
                      <span className="dj-verdict">{r.check.ok ? "Will be deleted" : r.check.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              {ready.length > 0 && (
                <div className="dj-confirm">
                  <label className="cp-field">
                    <span>Reason</span>
                    <input value={reason} placeholder="e.g. Duplicates of entries posted from the bank import" onChange={(e) => setReason(e.target.value)} />
                    <em>Saved in each journal's audit trail.</em>
                  </label>
                  <button type="button" className="drawer-btn rl-danger-btn dj-go" disabled={reason.trim().length < 5} onClick={() => setConfirming(true)}>
                    Delete {ready.length} journal{ready.length === 1 ? "" : "s"}
                  </button>
                </div>
              )}
              {done && <p className="dj-done">{done}</p>}
            </>
          ) : (
            <p className="pp-setting-note">Deleting journals needs the <em>Reverse journals</em> capability.</p>
          )}
        </div>
      </div>
      {confirming && (
        <div className="rl-modal-overlay" onClick={() => setConfirming(false)}>
          <div className="rl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="rl-modal-title">Delete {ready.length} journal{ready.length === 1 ? "" : "s"}?</div>
            <p className="rl-modal-body">
              {ready.map((r) => r.je.je_number).join(", ")} will leave the ledger and every report. This can't be undone
              here. Reason: “{reason.trim()}”.
            </p>
            <div className="rl-modal-actions">
              <button type="button" className="drawer-btn ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="drawer-btn rl-danger-btn" onClick={confirm}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function PostingSection() {
  const { closedThrough, nextOpenPeriod, autoAssignLateBills, setAutoAssignLateBills } = useClosePeriod();
  const { log } = useSettingsAudit();
  const canEdit = useCurrentUser().hasCapability("settings.posting_rules.manage");
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
            disabled={!canEdit}
            onClick={() => {
              log("General Ledger", "Preferences", `Auto-assign late bills to the open period: ${autoAssignLateBills ? "off" : "on"}`);
              setAutoAssignLateBills(!autoAssignLateBills);
            }}
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
  const { log } = useSettingsAudit();
  const canEdit = useCurrentUser().hasCapability("settings.posting_rules.manage");
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
                disabled={!canEdit}
                onClick={() => {
                  if (o.k === inventoryCostingMethod) return;
                  log("Inventory", "Costing", `Costing method: ${COSTING_OPTIONS.find((x) => x.k === inventoryCostingMethod)?.title} → ${o.title}`);
                  setInventoryCostingMethod(o.k);
                }}
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

// Shown on Settings → Fixed Assets → Preferences. Not offered: "None", which
// is a per-asset choice (goodwill), never a company default.
const DEPRECIATION_OPTIONS = [
  {
    k: "straight_line",
    title: "Straight line",
    desc: "The same charge every period across the asset's duration, down to its salvage value.",
  },
  {
    k: "declining_balance",
    title: "Declining balance",
    desc: "A fixed rate of the remaining book value each period — larger charges early, smaller later. Each asset needs its rate.",
  },
];

export function FixedAssetPreferencesSection() {
  const { assetDepreciationMethod: method, setAssetDepreciationMethod: setMethod } = useAccountingSettings();
  const { log } = useSettingsAudit();
  const canEdit = useCurrentUser().hasCapability("settings.posting_rules.manage");
  return (
    <Section id="fixed-assets" title="New assets">
      <div className="pp-setting-card">
        <div className="pp-setting-pad">
        <div className="pp-setting-title">Depreciation method</div>
        <p className="pp-setting-desc">
          The method every new asset, prepaid and intangible starts on. Each asset can still change it until its
          first period posts.
        </p>
        <div className="is-options">
          {DEPRECIATION_OPTIONS.map((o) => {
            const selected = method === o.k;
            return (
              <button
                key={o.k}
                type="button"
                className={`is-option${selected ? " selected" : ""}`}
                disabled={!canEdit}
                onClick={() => {
                  if (o.k === method) return;
                  log("Fixed Assets", "Preferences", `Depreciation method: ${DEPRECIATION_OPTIONS.find((x) => x.k === method)?.title} → ${o.title}`);
                  setMethod(o.k);
                }}
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
          A change applies to assets added from then on. Assets already in the register keep the method they have.
        </p>
        </div>
      </div>
    </Section>
  );
}

// Shown on Settings → Reconciliation.
export function ReconciliationSection() {
  const { reconDifferenceAccounts: codes, setReconDifferenceAccounts: setCodes } = useAccountingSettings();
  const { log } = useSettingsAudit();
  const canEdit = useCurrentUser().hasCapability("settings.posting_rules.manage");
  const [adding, setAdding] = useState("");
  const available = RECON_ELIGIBLE.filter((a) => !codes.includes(a.code));
  const add = (code) => {
    if (!code) return;
    log("Reconciliation", "Reconciliation", `Added difference account ${code} ${accountOf(code)?.name || ""}`);
    setCodes([...codes, code]);
    setAdding("");
  };
  const remove = (code) => {
    log("Reconciliation", "Reconciliation", `Removed difference account ${code} ${accountOf(code)?.name || ""}`);
    setCodes(codes.filter((c) => c !== code));
  };

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
                <button type="button" className="brs-remove" disabled={!canEdit} onClick={() => remove(code)} aria-label={`Remove ${code}`}>
                  <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
                </button>
              </div>
            ))
          )}
        </div>
        <div className="brs-add">
          <select className="brs-select" value={adding} disabled={!canEdit} onChange={(e) => add(e.target.value)} aria-label="Add an account">
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
  const { journalDeletion } = useAccountingSettings();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="General Ledger"
          tabs={ACCOUNTING_TABS}
          intro="Company-wide accounting choices: the basics set at company creation, how late bills post, and when each month's books close."
        />
        <BasicsSection />
        <PostingSection />
        <ClosingSection />
        {journalDeletion && <DeleteJournalsSection />}
        <div style={{ height: 40 }} />
      </div>
    </div>
  );
}
