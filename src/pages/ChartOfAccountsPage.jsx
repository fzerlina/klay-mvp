import { useState, useMemo, Fragment } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { COA } from "../data/seed/coa";
import { CF_SECTIONS, CASH_LINE, childrenOf, groupDepth, groupPath, resolveCfAssign } from "../lib/cashFlow";
import { DIM_BY_KEY, paletteFor, dimensionsForAccount } from "../data/seed/dimensions";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles.css";
import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";

// Settings → Accounting → General Settings → Chart of accounts. Every account,
// grouped by section. An account's name can be changed (with a warning: the new
// name shows everywhere, posted journals included); its code and type can't.
// The edit dialog also holds "settle through Payment" — journal lines crediting
// the account become payables on the Payment list (reconcilable accounts).
// It also holds the account's Cash Flow group (Settings → Accounting → Cash
// flow builds the groups; direct method, account level — 25 Nov 2026).
// Editing needs coa.manage.

// Tax and control accounts the system posts to by code.
const LOCKED_CODES = new Set(["1-2100", "1-2200", "1-5100", "2-1100", "2-2100", "2-2200", "2-2300"]);
const CONTRA_TYPES = new Set(["contra_asset", "contra_revenue"]);
// Settled through their own subledger (bills, invoices), never through Payment.
const CONTROL_CODES = new Set(["1-2100", "2-1100"]);

const TYPE_LABELS = {
  asset: "Asset", liability: "Liability", equity: "Equity", revenue: "Revenue", expense: "Expense",
  contra_asset: "Contra asset", contra_revenue: "Contra revenue",
};

const SECTION_LABELS = {
  "g-asset": "Assets", "g-liability": "Liabilities", "g-equity": "Equity", "g-revenue": "Revenue",
  "g-cogs": "Cost of Goods Sold", "g-opex": "Operating Expenses", "g-other-pl": "Other Income / Expense", "g-tax": "Tax",
};

function topGroup(node, byId) {
  let cur = node;
  while (cur && cur.parent) cur = byId[cur.parent];
  return cur ? cur.id : null;
}

function subsectionLabel(node, byId) {
  const parent = node.parent && byId[node.parent];
  return parent && parent.level !== 0 ? parent.label || "" : "";
}

function LockIcon() {
  return (
    <svg className="coa-lock" viewBox="0 0 24 24" aria-label="Locked">
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// The group options, nested, by activity — and "cash" or none.
function CfGroupSelect({ groups, value, onChange }) {
  const walk = (parent, section) => childrenOf(groups, parent, section).flatMap((g) => [g, ...walk(g.key)]);
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="cash">{CASH_LINE.label} — counted as cash</option>
      {CF_SECTIONS.map((s) => (
        <optgroup key={s.key} label={s.label}>
          {walk(null, s.key).map((g) => <option key={g.key} value={g.key}>{" ".repeat(groupDepth(groups, g.key))}{g.label}</option>)}
        </optgroup>
      ))}
      <option value="">Not assigned</option>
    </select>
  );
}

function CfGroupCell({ groups, k }) {
  if (k === "cash") return <span className="coa-cf cash">{CASH_LINE.label}</span>;
  if (!k) return <span className="coa-tag coa-cf-none">Not assigned</span>;
  const path = groupPath(groups, k);
  return (
    <span className="coa-cf" title={path.join(" › ")}>
      <span className="coa-cf-sec">{path[0]}</span>{path[path.length - 1]}
    </span>
  );
}

function EditAccountModal({ acct, lineCount, reconcilable, cfGroups, cfGroup, onClose, onSave }) {
  const [name, setName] = useState(acct.name);
  const [payable, setPayable] = useState(reconcilable);
  const [cf, setCf] = useState(cfGroup);
  const renamed = name.trim() !== acct.name;
  const canPay = acct.fs === "BS" && !CONTROL_CODES.has(acct.code);
  const ok = name.trim().length >= 2 && (renamed || payable !== reconcilable || cf !== cfGroup);
  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">Edit account</div>
        <dl className="coa-facts">
          <dt>Code</dt><dd className="mr-code">{acct.code}{LOCKED_CODES.has(acct.code) && <LockIcon />}</dd>
          <dt>Type</dt><dd>{TYPE_LABELS[acct.type] || acct.type} · normal balance {acct.normal_balance}</dd>
        </dl>
        <label className="rl-field">
          <span>Account name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {renamed && (
          <p className="coa-warn">
            The new name replaces “{acct.name}” everywhere — reports, the ledger and the{" "}
            {lineCount.toLocaleString("id-ID")} journal line{lineCount === 1 ? "" : "s"} already posted to {acct.code}.
            The code and balances don't change. Make sure it still describes what's booked here.
          </p>
        )}
        {canPay && (
          <label className="coa-check">
            <input type="checkbox" checked={payable} onChange={(e) => setPayable(e.target.checked)} />
            <span>
              Settle through Payment
              <em>Journal lines crediting this account need a payee and stay on the Payment list until paid.</em>
            </span>
          </label>
        )}
        <label className="rl-field">
          <span>Cash flow group</span>
          <CfGroupSelect groups={cfGroups} value={cf} onChange={setCf} />
          <em className="coa-field-help">
            Cash received or paid against this account lands in this group on the Cash Flow report.{" "}
            <Link to="/cash-flow-structure">Edit the groups</Link>
          </em>
        </label>
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="drawer-btn primary" disabled={!ok} onClick={() => onSave(name.trim(), payable, cf)}>
            {renamed ? "Rename account" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChartOfAccountsPage() {
  const [search, setSearch] = useState("");
  const [lockedOnly, setLockedOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const [rev, setRev] = useState(0); // bumps when a rename writes into COA
  const [toast, setToast] = useState("");
  const { reconcilableAccounts, toggleReconcilable, cfGroups, cfAssign, setCfAssign } = useAccountingSettings();
  const [params, setParams] = useSearchParams();
  const cfFilter = params.get("cf") || ""; // "" | group key | "cash" | "unassigned"
  const setCfFilter = (v) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set("cf", v); else n.delete("cf"); return n; }, { replace: true });
  const cfOf = useMemo(() => resolveCfAssign(cfGroups, cfAssign), [cfGroups, cfAssign]);
  const unassignedCount = Object.values(cfOf).filter((v) => !v).length;
  const { entries } = useJournalEntries();
  const { hasCapability } = useCurrentUser();
  const { log } = useSettingsAudit();
  const canEdit = hasCapability("settings.coa.manage");

  const byId = useMemo(() => Object.fromEntries(COA.map((n) => [n.id, n])), []);
  const accounts = useMemo(() => COA.filter((n) => n.code), []);
  const lockedCount = accounts.filter((a) => LOCKED_CODES.has(a.code)).length;

  const linesByCode = useMemo(() => {
    const m = {};
    for (const je of entries) {
      if (je.status !== "posted") continue;
      for (const l of je.lines || []) m[l.account_code] = (m[l.account_code] || 0) + 1;
    }
    return m;
  }, [entries]);

  // Section → subsection → rows, in chart order; empty groups drop out.
  const q = search.trim().toLowerCase();
  const sections = useMemo(() => {
    const out = [];
    const bySec = new Map();
    for (const acct of accounts) {
      if (lockedOnly && !LOCKED_CODES.has(acct.code)) continue;
      if (q && !`${acct.code} ${acct.name}`.toLowerCase().includes(q)) continue;
      if (cfFilter && (cfFilter === "unassigned" ? cfOf[acct.code] : cfOf[acct.code] !== cfFilter)) continue;
      const top = topGroup(acct, byId);
      if (!top) continue;
      if (!bySec.has(top)) {
        bySec.set(top, { key: top, label: SECTION_LABELS[top] || byId[top]?.label || top, subs: new Map() });
        out.push(bySec.get(top));
      }
      const subs = bySec.get(top).subs;
      const sub = subsectionLabel(acct, byId);
      if (!subs.has(sub)) subs.set(sub, []);
      subs.get(sub).push(acct);
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, byId, q, lockedOnly, rev, cfFilter, cfOf]);
  const shown = sections.reduce((n, s) => n + [...s.subs.values()].reduce((m, r) => m + r.length, 0), 0);

  function save(acct, name, payable, cf) {
    if (cf !== cfOf[acct.code]) {
      const label = (k) => (k === "cash" ? CASH_LINE.label : k ? groupPath(cfGroups, k).join(" › ") : "Not assigned");
      setCfAssign((cur) => ({ ...cur, [acct.code]: cf }));
      log("General Settings", "Chart of accounts", `${acct.code} ${name}: cash flow group ${label(cfOf[acct.code])} → ${label(cf)}`);
    }
    if (name !== acct.name) {
      log("General Settings", "Chart of accounts", `Renamed ${acct.code}: ${acct.name} → ${name}`);
      acct.name = name; // write-through: every screen reads COA
    }
    if (payable !== reconcilableAccounts.includes(acct.code)) {
      toggleReconcilable(acct.code);
      log("General Settings", "Chart of accounts", `${acct.code} ${name}: settle through Payment ${payable ? "on" : "off"}`);
    }
    setRev((n) => n + 1);
    setEditing(null);
    setToast(`${acct.code} saved.`);
    setTimeout(() => setToast(""), 2200);
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="General Settings"
          tabs={ACCOUNTING_TABS}
          intro="Every account in the ledger, by section. Rename an account or change its Cash Flow group from its row — the code, type and balances stay as they are. Locked tax and control accounts can be renamed too."
        />
        <div className="acc-body">
          <div className="coa-tools">
            <input className="coa-search" placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="coa-filter">
              <input type="checkbox" checked={lockedOnly} onChange={(e) => setLockedOnly(e.target.checked)} />
              Locked only
            </label>
            <label className="coa-filter">
              Cash flow
              <select className="coa-cf-filter" value={cfFilter} onChange={(e) => setCfFilter(e.target.value)} aria-label="Filter by cash flow group">
                <option value="">All groups</option>
                <option value="unassigned">Not assigned ({unassignedCount})</option>
                <option value="cash">{CASH_LINE.label}</option>
                {CF_SECTIONS.map((s) => (
                  <optgroup key={s.key} label={s.label}>
                    {(function walk(parent) { return childrenOf(cfGroups, parent, s.key).flatMap((g) => [g, ...walk(g.key)]); })(null)
                      .map((g) => <option key={g.key} value={g.key}>{" ".repeat(groupDepth(cfGroups, g.key))}{g.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <span className="coa-count">
              {shown === accounts.length ? <><b>{accounts.length}</b> accounts · <b>{lockedCount}</b> locked</> : <><b>{shown}</b> of {accounts.length} accounts</>}
            </span>
          </div>

          <div className="coa-wrap">
            <table className="coa-table">
              <thead>
                <tr><th>Code</th><th>Account name</th><th>Type</th><th>Dimensions</th><th>Cash flow group</th><th /></tr>
              </thead>
              <tbody>
                {sections.length === 0 && <tr className="coa-empty"><td colSpan={6}>No accounts match your filter.</td></tr>}
                {sections.map((sec) => (
                  <Fragment key={sec.key}>
                    <tr className="coa-section-row"><td colSpan={6}>{sec.label}</td></tr>
                    {[...sec.subs.entries()].map(([sub, rows]) => (
                      <Fragment key={sub || "-"}>
                        {sec.subs.size > 1 && sub && <tr className="coa-subsection-row"><td colSpan={6}>{sub}</td></tr>}
                        {rows.map((acct) => {
                          const dims = dimensionsForAccount(acct);
                          return (
                            <tr key={acct.code} className={`coa-row${canEdit ? " editable" : ""}`} onClick={() => canEdit && setEditing(acct)}>
                              <td className="code">{acct.code}{LOCKED_CODES.has(acct.code) && <LockIcon />}</td>
                              <td>
                                {acct.name}
                                {CONTROL_CODES.has(acct.code) && <span className="coa-tag">Control</span>}
                                {CONTRA_TYPES.has(acct.type) && <span className="coa-tag">Contra</span>}
                              </td>
                              <td className="type">{TYPE_LABELS[acct.type] || acct.type}</td>
                              <td>
                                {dims.length === 0 ? <span className="coa-muted">—</span> : (
                                  <span className="coa-dim-chips">
                                    {dims.map((k) => {
                                      const dim = DIM_BY_KEY[k];
                                      if (!dim) return null;
                                      const pal = paletteFor(dim.cls);
                                      return <span className="coa-dim-chip" key={k} style={{ background: pal.bg, color: pal.fg }}>{dim.label}</span>;
                                    })}
                                  </span>
                                )}
                              </td>
                              <td className="cf"><CfGroupCell groups={cfGroups} k={cfOf[acct.code]} /></td>
                              <td className="act">
                                {canEdit && <button type="button" className="coa-edit" onClick={(e) => { e.stopPropagation(); setEditing(acct); }}>Edit</button>}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="coa-legend">
            <span><LockIcon /> Locked — the system posts to it by code</span>
            <span><span className="coa-tag">Control</span> posts only through bills or invoices</span>
            <span><span className="coa-tag">Contra</span> opposite normal balance</span>
          </div>
          {!canEdit && <p className="mr-ro" style={{ marginLeft: 0 }}>Read only — changing accounts needs the <em>Manage Chart of Accounts</em> capability.</p>}
        </div>
      </div>
      {editing && (
        <EditAccountModal
          acct={editing}
          lineCount={linesByCode[editing.code] || 0}
          reconcilable={reconcilableAccounts.includes(editing.code)}
          cfGroups={cfGroups}
          cfGroup={cfOf[editing.code] ?? null}
          onClose={() => setEditing(null)}
          onSave={(name, payable, cf) => save(editing, name, payable, cf)}
        />
      )}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
