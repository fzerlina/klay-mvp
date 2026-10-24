import { useState } from "react";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles.css";
import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import { TAX_CODES, TAX_KIND_LABELS, APPLIES_LABELS } from "../data/seed/taxCodes";
import { COA } from "../data/seed/coa";

// Settings → Accounting → General Ledger → Tax. One list of tax codes — VAT (PPN) and
// withholding (PPh) — each with its rate, what it applies to, the GL account it
// books to, and the dates it is valid for (as DualEntry's Tax Setup). A rate
// change is a new dated code, not an edit, so past documents keep their rate.
// Editing needs coa.manage (the Finance Manager), like the chart of accounts.
// The account a code books to is chosen when the code is added and can't be
// changed afterwards — entries already posted sit on it. Rate and what the
// code applies to stay editable.

const ACCOUNTS = COA.filter((a) => a.code && a.is_active).sort((a, b) => a.code.localeCompare(b.code));
const accountName = (code) => COA.find((a) => a.code === code)?.name;

function fmtDate(iso) {
  return iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function rateText(t) {
  if (t.rate == null) return "Per bill";
  return `${t.rate}%${t.nonNpwpRate != null ? ` · ${t.nonNpwpRate}% non-NPWP` : ""}`;
}

function TaxModal({ tax, onSave, onClose }) {
  const isNew = !tax;
  const [d, setD] = useState(tax || { code: "", name: "", kind: "vat", appliesTo: "purchases", rate: 0, account: "", validFrom: "", validTo: null, note: "" });
  const set = (f) => (e) => setD((x) => ({ ...x, [f]: e.target.value }));
  const ok = d.name.trim().length >= 2 && d.validFrom && (d.rate === null || d.rate === "" || Number(d.rate) >= 0);

  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">{isNew ? "Add tax code" : `Edit ${tax.name}`}</div>
        <label className="rl-field">
          <span>Name</span>
          <input autoFocus value={d.name} onChange={set("name")} placeholder="e.g. PPh 23" />
        </label>
        <div className="rl-form-grid">
          <label className="rl-field">
            <span>Type</span>
            <select value={d.kind} onChange={set("kind")}>
              {Object.entries(TAX_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="rl-field">
            <span>Applies to</span>
            <select value={d.appliesTo} onChange={set("appliesTo")}>
              {Object.entries(APPLIES_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="rl-field">
            <span>Rate (%)</span>
            <input inputMode="decimal" value={d.rate ?? ""} onChange={set("rate")} placeholder="Blank = set per bill" />
          </label>
          {d.kind === "withholding" && (
            <label className="rl-field">
              <span>Rate without NPWP (%)</span>
              <input inputMode="decimal" value={d.nonNpwpRate ?? ""} onChange={set("nonNpwpRate")} placeholder="Same as rate" />
            </label>
          )}
          <label className="rl-field">
            <span>Valid from</span>
            <input type="date" value={d.validFrom} onChange={set("validFrom")} />
          </label>
        </div>
        {isNew ? (
          <label className="rl-field">
            <span>Books to</span>
            <select value={d.account || ""} onChange={set("account")}>
              <option value="">No account</option>
              {ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
            </select>
            <em className="rl-field-hint" style={{ marginLeft: 0 }}>Can't be changed once the tax code is added.</em>
          </label>
        ) : (
          <div className="rl-field">
            <span>Books to</span>
            <div className="tx-fixed">
              {d.account ? <><span className="tx-code">{d.account}</span> {accountName(d.account)}</> : "No account"}
            </div>
            <em className="rl-field-hint" style={{ marginLeft: 0 }}>Fixed — entries already posted with this code sit on this account.</em>
          </div>
        )}
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="drawer-btn primary"
            disabled={!ok}
            onClick={() => onSave({
              ...d,
              name: d.name.trim(),
              code: d.code || d.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"),
              rate: d.rate === "" || d.rate == null ? null : Number(d.rate),
              ...(d.kind === "withholding" ? { nonNpwpRate: d.nonNpwpRate === "" || d.nonNpwpRate == null ? null : Number(d.nonNpwpRate) } : {}),
              account: isNew ? d.account || null : tax.account,
            })}
          >
            {isNew ? "Add tax code" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TaxSettingsPage() {
  const { hasCapability } = useCurrentUser();
  const canEdit = hasCapability("settings.tax.manage");
  const { log } = useSettingsAudit();
  const [codes, setCodes] = useState(() => [...TAX_CODES]);
  const [editing, setEditing] = useState(null); // null | "new" | tax code

  // Writes through to TAX_CODES, which bill posting, payments and the tax
  // register read at call time.
  function save(t) {
    const i = editing === "new" ? -1 : TAX_CODES.findIndex((x) => x.code === editing.code);
    if (i < 0) log("General Ledger", "Tax", `Added tax code ${t.name} — ${rateText(t)}${t.account ? `, books to ${t.account}` : ""}`);
    else {
      const old = TAX_CODES[i];
      const changes = [];
      if (old.name !== t.name) changes.push(`name ${old.name} → ${t.name}`);
      if (rateText(old) !== rateText(t)) changes.push(`rate ${rateText(old)} → ${rateText(t)}`);
      if (old.appliesTo !== t.appliesTo) changes.push(`applies to ${APPLIES_LABELS[old.appliesTo]} → ${APPLIES_LABELS[t.appliesTo]}`);
      if (old.validFrom !== t.validFrom) changes.push(`valid from ${fmtDate(old.validFrom)} → ${fmtDate(t.validFrom)}`);
      if (changes.length) log("General Ledger", "Tax", `${t.name}: ${changes.join("; ")}`);
    }
    if (i < 0) TAX_CODES.push(t);
    else TAX_CODES[i] = t;
    setCodes([...TAX_CODES]);
    setEditing(null);
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="General Ledger"
          tabs={ACCOUNTING_TABS}
          intro="The tax codes people pick on bills, invoices and items — VAT (PPN) and withholding (PPh) — with the rate, the account each books to, and the dates it's valid for."
          actions={canEdit && (
            <button type="button" className="lg-btn-brand" onClick={() => setEditing("new")}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add tax code
            </button>
          )}
        />

        <div className="acc-body">
          {["vat", "withholding"].map((kind) => (
            <section key={kind} className="tx-group">
              <div className="ru-section-hdr tx-group-hdr">
                <span className="ru-section-title">{TAX_KIND_LABELS[kind]}</span>
                <span className="ru-section-cnt">{codes.filter((t) => t.kind === kind).length}</span>
              </div>
              <div className="tx-table">
                <div className="tx-tr tx-th">
                  <div>Tax code</div>
                  <div>Applies to</div>
                  <div>Rate</div>
                  <div>Books to</div>
                </div>
                {codes.filter((t) => t.kind === kind).map((t) => (
                  <div
                    key={t.code}
                    className={`tx-tr${canEdit ? " editable" : ""}`}
                    onClick={() => canEdit && setEditing(t)}
                  >
                    <div>
                      <div className="tx-name">{t.name}</div>
                      <div className="tx-since">Since {fmtDate(t.validFrom)}</div>
                      {t.note && <div className="tx-note">{t.note}</div>}
                    </div>
                    <div>{APPLIES_LABELS[t.appliesTo]}</div>
                    <div className="tx-rate">{rateText(t)}</div>
                    <div>
                      {t.account
                        ? <><span className="tx-code">{t.account}</span> {accountName(t.account)}</>
                        : <span className="tx-muted">—</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {!canEdit && <p className="tx-ro">Read only — changing tax codes needs the <em>Manage tax codes</em> capability.</p>}
        </div>
      </div>

      {editing && <TaxModal tax={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}
