import { useState } from "react";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles.css";
import "./journal-templates.css";
import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";
import { LEAF_ACCOUNTS, accountName } from "../components/RecordList";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";

// Settings → Accounting → General Ledger → Journal templates. The company's
// common transaction types, each a list of debit and credit lines. Picking one
// on a new manual journal (Journal Entry → Draft) fills in its lines; a line
// with no account is chosen there ("Select account during journal creation").
// Templates carry no amounts. Seeded at migration setup
// (data/seed/journalTemplates.js); editing needs coa.manage.

const SIDE_LABEL = { debit: "Debit", credit: "Credit" };

export function TemplateLines({ lines }) {
  return (
    <ul className="jt-lines">
      {lines.map((l, i) => (
        <li key={i}>
          <span className={`jt-side ${l.side}`}>{SIDE_LABEL[l.side]}</span>
          {l.account
            ? <span><span className="mr-code">{l.account}</span> · {accountName(l.account) || "Unknown account"}</span>
            : <span className="jt-pick">Select account during journal creation</span>}
        </li>
      ))}
    </ul>
  );
}

function TemplateModal({ template, onSave, onClose }) {
  const isNew = !template;
  const [name, setName] = useState(template?.name || "");
  const [lines, setLines] = useState(() => (template?.lines || [{ side: "debit", account: null }, { side: "credit", account: null }]).map((l) => ({ ...l })));
  const patch = (i, p) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const sides = new Set(lines.map((l) => l.side));
  const ok = name.trim().length >= 2 && lines.length >= 2 && sides.has("debit") && sides.has("credit");
  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal jt-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">{isNew ? "Create journal template" : "Edit journal template"}</div>
        <label className="rl-field">
          <span>Template name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vendor Invoice (domestic)" />
        </label>
        <div className="rl-field">
          <span>Lines</span>
          <div className="jt-edit-lines">
            {lines.map((l, i) => (
              <div key={i} className="jt-edit-line">
                <select value={l.side} onChange={(e) => patch(i, { side: e.target.value })} aria-label="Side">
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
                <select value={l.account || ""} onChange={(e) => patch(i, { account: e.target.value || null })} aria-label="Account">
                  <option value="">Select during journal creation</option>
                  {LEAF_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                </select>
                <button type="button" className="jt-remove" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">
                  <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="jt-add" onClick={() => setLines((ls) => [...ls, { side: "debit", account: null }])}>+ Add line</button>
          {!ok && name.trim().length >= 2 && <em className="rl-field-err">A template needs at least one debit and one credit line.</em>}
        </div>
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="drawer-btn primary" disabled={!ok}
            onClick={() => onSave({ id: template?.id || `JT-${Date.now()}`, name: name.trim(), lines })}>
            {isNew ? "Create template" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const describe = (t) => t.lines.map((l) => `${l.side === "debit" ? "Dr" : "Cr"} ${l.account || "(chosen on the journal)"}`).join(", ");

export default function JournalTemplatesPage() {
  const { journalTemplates, saveJournalTemplate, deleteJournalTemplate } = useAccountingSettings();
  const { hasCapability } = useCurrentUser();
  const { log } = useSettingsAudit();
  const canEdit = hasCapability("settings.posting_rules.manage");
  const [editing, setEditing] = useState(null); // null | "new" | template
  const [deleting, setDeleting] = useState(null);

  function save(t) {
    const old = journalTemplates.find((x) => x.id === t.id);
    if (!old) log("General Ledger", "Journal templates", `Created template “${t.name}” — ${describe(t)}`);
    else {
      if (old.name !== t.name) log("General Ledger", "Journal templates", `Renamed template “${old.name}” → “${t.name}”`);
      if (describe(old) !== describe(t)) log("General Ledger", "Journal templates", `“${t.name}” lines: ${describe(old)} → ${describe(t)}`);
    }
    saveJournalTemplate(t);
    setEditing(null);
  }

  function remove(t) {
    deleteJournalTemplate(t.id);
    log("General Ledger", "Journal templates", `Deleted template “${t.name}”`);
    setDeleting(null);
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="General Ledger"
          tabs={ACCOUNTING_TABS}
          intro="Templates for your most common transaction types. When recording a manual journal, pick a template and its accounts are filled in — remove, edit or create templates as needed."
          actions={canEdit && (
            <button type="button" className="lg-btn-brand" onClick={() => setEditing("new")}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Create journal template
            </button>
          )}
        />
        <div className="acc-body jt-list">
          {journalTemplates.length === 0 && <div className="mr-empty">No templates yet.</div>}
          {journalTemplates.map((t) => (
            <section key={t.id} className="jt-card">
              <div className="jt-card-head">
                <h2 className="jt-name">{t.name}</h2>
                {canEdit && (
                  <div className="jt-actions">
                    <button type="button" className="rl-btn" onClick={() => setEditing(t)}>Edit</button>
                    <button type="button" className="rl-btn jt-danger" onClick={() => setDeleting(t)}>Delete</button>
                  </div>
                )}
              </div>
              <TemplateLines lines={t.lines} />
            </section>
          ))}
          {!canEdit && <p className="mr-ro" style={{ marginLeft: 0 }}>Read only — changing templates needs the <em>Manage posting rules</em> capability.</p>}
        </div>
      </div>

      {editing && <TemplateModal template={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {deleting && (
        <div className="rl-modal-overlay" onClick={() => setDeleting(null)}>
          <div className="rl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="rl-modal-title">Delete “{deleting.name}”?</div>
            <p className="rl-modal-body">It won't be offered on new journals. Journals already made from it keep their lines.</p>
            <div className="rl-modal-actions">
              <button type="button" className="drawer-btn ghost" onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="drawer-btn rl-danger-btn" onClick={() => remove(deleting)}>Delete template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
