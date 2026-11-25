import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./roles.css";
import "./cash-flow-structure.css";
import SettingsHeader, { ACCOUNTING_TABS } from "../components/SettingsHeader";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import {
  CF_SECTIONS, SECTION_BY_KEY, MAX_DEPTH, cfAccounts, resolveCfAssign, defaultCfGroups,
  childrenOf, groupDepth, descendantKeys, subtreeHeight, groupSection,
} from "../lib/cashFlow";

// Settings → Accounting → General Settings → Cash flow. The company builds the
// groups its Cash Flow report shows (team decision, 25 Nov 2026: every company
// lays it out differently and rebuilds it in Excel today). Operating,
// investing and financing are fixed (PSAK 2); inside them, groups nest up to
// MAX_DEPTH levels. Each account is put in a group on the Chart of accounts —
// this page only shows which accounts each group holds. Direct method: a cash
// movement lands in the group of the account on its other side.
// Editing needs coa.manage, like the chart itself.

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const AUDIT = ["General Settings", "Cash flow"];

export default function CashFlowStructurePage() {
  const { cfGroups: groups, setCfGroups, cfAssign, setCfAssign } = useAccountingSettings();
  const { hasCapability } = useCurrentUser();
  const { log } = useSettingsAudit();
  const canEdit = hasCapability("settings.coa.manage");
  const [modal, setModal] = useState(null); // { mode: "new", section, parent } | { mode: "edit", key }
  const [deleting, setDeleting] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [toast, setToast] = useState("");
  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const byKey = useMemo(() => Object.fromEntries(groups.map((g) => [g.key, g])), [groups]);
  const assigned = useMemo(() => resolveCfAssign(groups, cfAssign), [groups, cfAssign]);
  const accountsIn = useMemo(() => {
    const m = { cash: [], unassigned: [] };
    for (const a of cfAccounts()) {
      const k = assigned[a.code] || "unassigned";
      (m[k] ||= []).push(a);
    }
    return m;
  }, [assigned]);

  // ── Changes ───────────────────────────────────────────────────────────────
  function save({ key, label, labelId, parent, section }) {
    if (!key) {
      const g = { key: `g${Date.now().toString(36)}`, section, parent, label, labelId };
      setCfGroups((cur) => [...cur, g]);
      log(...AUDIT, `Added group “${label}” under ${parent ? `“${byKey[parent].label}”` : SECTION_BY_KEY[section].short}`);
      say(`“${label}” added. Put accounts in it from the Chart of accounts.`);
    } else {
      const old = byKey[key];
      const moved = descendantKeys(groups, key);
      setCfGroups((cur) => cur.map((g) => {
        if (g.key === key) return { ...g, label, labelId, parent, section };
        if (moved.includes(g.key)) return { ...g, section }; // a subtree moves section with its root
        return g;
      }));
      if (old.label !== label) log(...AUDIT, `Renamed group “${old.label}” → “${label}”`);
      if ((old.labelId || "") !== labelId) log(...AUDIT, `“${label}” Bahasa label: ${old.labelId || "—"} → ${labelId || "—"}`);
      if (old.parent !== parent || groupSection(groups, key) !== section) {
        log(...AUDIT, `Moved “${label}” under ${parent ? `“${byKey[parent].label}”` : SECTION_BY_KEY[section].short}`);
      }
      say(`“${label}” saved.`);
    }
    setModal(null);
  }

  function move(key, dir) {
    const g = byKey[key];
    const sibs = childrenOf(groups, g.parent, g.section);
    const i = sibs.findIndex((s) => s.key === key);
    const other = sibs[i + dir];
    if (!other) return;
    setCfGroups((cur) => {
      const a = cur.findIndex((x) => x.key === key), b = cur.findIndex((x) => x.key === other.key);
      const next = [...cur];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    log(...AUDIT, `Moved “${g.label}” ${dir < 0 ? "up" : "down"}`);
  }

  // Deleting a group never loses an account: its subgroups and accounts move
  // up to its parent — or, at the top, the subgroups become top-level and the
  // accounts go to Not assigned.
  function remove(key) {
    const g = byKey[key];
    const section = groupSection(groups, key);
    const accts = accountsIn[key] || [];
    setCfGroups((cur) => cur.filter((x) => x.key !== key).map((x) => (x.parent === key ? { ...x, parent: g.parent, section } : x)));
    if (accts.length) setCfAssign((cur) => ({ ...cur, ...Object.fromEntries(accts.map((a) => [a.code, g.parent || null])) }));
    log(...AUDIT, `Deleted group “${g.label}”${accts.length ? ` — ${plural(accts.length, "account")} moved to ${g.parent ? `“${byKey[g.parent].label}”` : "Not assigned"}` : ""}`);
    say(`“${g.label}” deleted.`);
    setDeleting(null);
  }

  function reset() {
    setCfGroups(defaultCfGroups());
    setCfAssign({});
    log(...AUDIT, "Reset groups and account assignments to the standard structure");
    say("Back to the standard structure.");
    setResetting(false);
  }

  // ── Rows ──────────────────────────────────────────────────────────────────
  const AccountChips = ({ k, accts }) => (
    <div className="cfs-accts" style={{ marginLeft: k === "cash" || k === "unassigned" ? 0 : (groupDepth(groups, k) + 1) * 22 }}>
      {accts.length === 0
        ? <span className="cfs-muted">No accounts directly in this group.</span>
        : accts.map((a) => <span key={a.code} className="cfs-chip"><b>{a.code}</b> {a.name}</span>)}
      <Link className="cfs-link" to={`/chart-of-accounts?cf=${encodeURIComponent(k)}`}>Change on the Chart of accounts →</Link>
    </div>
  );

  const GroupRow = ({ g }) => {
    const depth = groupDepth(groups, g.key);
    const kids = childrenOf(groups, g.key);
    const sibs = childrenOf(groups, g.parent, g.section);
    const i = sibs.findIndex((s) => s.key === g.key);
    const accts = accountsIn[g.key] || [];
    const isOpen = open.has(g.key);
    return (
      <Fragment>
        <div className={`cfs-row${kids.length ? " parent" : ""}`} style={{ paddingLeft: 16 + depth * 22 }}>
          <button type="button" className="cfs-name" onClick={() => toggle(g.key)} aria-expanded={isOpen} title="Show the accounts in this group">
            <svg className={`cfs-chev${isOpen ? " open" : ""}`} viewBox="0 0 12 12"><polyline points="4 2 8 6 4 10" /></svg>
            <span className="cfs-label">{g.label}</span>
            {g.labelId && <span className="cfs-label-id">{g.labelId}</span>}
          </button>
          <span className={`cfs-count${accts.length ? "" : " none"}`}>{plural(accts.length, "account")}</span>
          {canEdit && (
            <span className="cfs-acts">
              {depth < MAX_DEPTH - 1 && <button type="button" className="cfs-act" onClick={() => setModal({ mode: "new", section: g.section || groupSection(groups, g.key), parent: g.key })}>+ Subgroup</button>}
              <button type="button" className="cfs-act" onClick={() => setModal({ mode: "edit", key: g.key })}>Edit</button>
              <button type="button" className="cfs-icon" onClick={() => move(g.key, -1)} disabled={i === 0} aria-label={`Move ${g.label} up`} title="Move up">↑</button>
              <button type="button" className="cfs-icon" onClick={() => move(g.key, 1)} disabled={i === sibs.length - 1} aria-label={`Move ${g.label} down`} title="Move down">↓</button>
              <button type="button" className="cfs-act danger" onClick={() => setDeleting(g.key)}>Delete</button>
            </span>
          )}
        </div>
        {isOpen && <AccountChips k={g.key} accts={accts} />}
        {kids.map((c) => <GroupRow key={c.key} g={c} />)}
      </Fragment>
    );
  };

  const unassigned = accountsIn.unassigned;
  const del = deleting && byKey[deleting];

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <SettingsHeader
          title="General Settings"
          tabs={ACCOUNTING_TABS}
          intro="The groups your Cash Flow report shows, nested the way you present it. Each account sits in one group — set it on the Chart of accounts. Direct method: cash received or paid lands in the group of the account on the other side (e.g. Accounts Receivable → Receipts from customers)."
          actions={(
            <>
              <Link className="lg-btn-ghost" to="/reports/cash-flow">Open Cash Flow report</Link>
              {canEdit && <button type="button" className="lg-btn-ghost" onClick={() => setResetting(true)}>Reset to standard</button>}
            </>
          )}
        />
        <div className="acc-body cfs-body">
          <section className="cfs-card cfs-cash">
            <div className="cfs-row">
              <button type="button" className="cfs-name" onClick={() => toggle("cash")} aria-expanded={open.has("cash")}>
                <svg className={`cfs-chev${open.has("cash") ? " open" : ""}`} viewBox="0 0 12 12"><polyline points="4 2 8 6 4 10" /></svg>
                <span className="cfs-label">Cash and cash equivalents</span>
                <span className="cfs-label-id">Kas dan setara kas</span>
              </button>
              <span className="cfs-count">{plural(accountsIn.cash.length, "account")}</span>
              <span className="cfs-hint">Counted as cash, not as a flow. Time deposits and restricted cash sit in investing by default (PSAK 2).</span>
            </div>
            {open.has("cash") && <AccountChips k="cash" accts={accountsIn.cash} />}
            {unassigned.length > 0 && (
              <div className="cfs-row cfs-warn">
                <button type="button" className="cfs-name" onClick={() => toggle("unassigned")} aria-expanded={open.has("unassigned")}>
                  <svg className={`cfs-chev${open.has("unassigned") ? " open" : ""}`} viewBox="0 0 12 12"><polyline points="4 2 8 6 4 10" /></svg>
                  <span className="cfs-label">Not assigned</span>
                </button>
                <span className="cfs-count">{plural(unassigned.length, "account")}</span>
                <span className="cfs-hint">Their cash still counts, on a “Not assigned” line under operating.</span>
              </div>
            )}
            {open.has("unassigned") && unassigned.length > 0 && <AccountChips k="unassigned" accts={unassigned} />}
          </section>

          {CF_SECTIONS.map((s) => {
            const roots = childrenOf(groups, null, s.key);
            return (
              <section key={s.key} className="cfs-card">
                <div className="cfs-card-head">
                  <h2 className="cfs-title">{s.label}<span>{s.id}</span></h2>
                  {canEdit && <button type="button" className="rl-btn" onClick={() => setModal({ mode: "new", section: s.key, parent: null })}>+ Add group</button>}
                </div>
                {roots.length === 0 && <div className="cfs-row cfs-muted">No groups yet.</div>}
                {roots.map((g) => <GroupRow key={g.key} g={g} />)}
                <div className="cfs-total">{s.total}<span>{s.totalId}</span></div>
              </section>
            );
          })}
          <p className="cfs-foot">
            The report adds up each group and every group under it, then each activity; cash at the start plus the net change is checked against cash on the Balance Sheet. Groups nest up to {MAX_DEPTH} levels.
            {" "}Assigning a single journal to a different group than its account&apos;s isn&apos;t available yet.
          </p>
          {!canEdit && <p className="mr-ro" style={{ marginLeft: 0 }}>Read only — changing the structure needs the <em>Manage Chart of Accounts</em> capability.</p>}
        </div>
      </div>

      {modal && <GroupModal groups={groups} modal={modal} onSave={save} onClose={() => setModal(null)} />}

      {del && (
        <div className="rl-modal-overlay" onClick={() => setDeleting(null)}>
          <div className="rl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="rl-modal-title">Delete “{del.label}”?</div>
            <p className="rl-modal-body">
              {(() => {
                const kids = childrenOf(groups, del.key).length;
                const accts = (accountsIn[del.key] || []).length;
                const to = del.parent ? `“${byKey[del.parent].label}”` : null;
                const parts = [];
                if (accts) parts.push(`its ${plural(accts, "account")} move to ${to || "Not assigned"}`);
                if (kids) parts.push(`its ${plural(kids, "subgroup")} move up to ${to || `the top of ${SECTION_BY_KEY[groupSection(groups, del.key)].short.toLowerCase()}`}`);
                return parts.length ? `Nothing is lost: ${parts.join(", and ")}.` : "It has no accounts or subgroups.";
              })()}
            </p>
            <div className="rl-modal-actions">
              <button type="button" className="drawer-btn ghost" onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="drawer-btn rl-danger-btn" onClick={() => remove(del.key)}>Delete group</button>
            </div>
          </div>
        </div>
      )}

      {resetting && (
        <div className="rl-modal-overlay" onClick={() => setResetting(false)}>
          <div className="rl-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="rl-modal-title">Reset to the standard structure?</div>
            <p className="rl-modal-body">Your groups are replaced by the standard direct-method groups, and every account goes back to its default group. Posted journals don&apos;t change.</p>
            <div className="rl-modal-actions">
              <button type="button" className="drawer-btn ghost" onClick={() => setResetting(false)}>Cancel</button>
              <button type="button" className="drawer-btn rl-danger-btn" onClick={reset}>Reset</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}

// Add or edit a group: its English and Bahasa labels (the report prints Bahasa
// by default) and where it sits — the top of an activity, or under another
// group, as long as the whole subtree stays within MAX_DEPTH levels.
function GroupModal({ groups, modal, onSave, onClose }) {
  const editing = modal.mode === "edit" ? groups.find((g) => g.key === modal.key) : null;
  const [label, setLabel] = useState(editing?.label || "");
  const [labelId, setLabelId] = useState(editing?.labelId || "");
  const startSection = editing ? groupSection(groups, editing.key) : modal.section;
  const [place, setPlace] = useState(editing ? (editing.parent || `top:${startSection}`) : (modal.parent || `top:${modal.section}`));

  const height = editing ? subtreeHeight(groups, editing.key) : 1;
  const blocked = new Set(editing ? [editing.key, ...descendantKeys(groups, editing.key)] : []);
  const options = CF_SECTIONS.map((s) => {
    const walk = (parent) => childrenOf(groups, parent, s.key).flatMap((g) => [g, ...walk(g.key)]);
    return {
      s,
      groups: walk(null).filter((g) => !blocked.has(g.key) && groupDepth(groups, g.key) + 1 + height <= MAX_DEPTH),
    };
  });
  const parent = place.startsWith("top:") ? null : place;
  const section = parent ? groupSection(groups, parent) : place.slice(4);
  const ok = label.trim().length >= 2;

  return (
    <div className="rl-modal-overlay" onClick={onClose}>
      <div className="rl-modal wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="rl-modal-title">{editing ? "Edit group" : "Add group"}</div>
        <label className="rl-field">
          <span>Name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Payments to suppliers" autoFocus />
        </label>
        <label className="rl-field">
          <span>Name in Bahasa Indonesia</span>
          <input value={labelId} onChange={(e) => setLabelId(e.target.value)} placeholder="e.g. Pembayaran kepada pemasok" />
        </label>
        <label className="rl-field">
          <span>Sits under</span>
          <select value={place} onChange={(e) => setPlace(e.target.value)}>
            {options.map(({ s, groups: gs }) => (
              <optgroup key={s.key} label={s.label}>
                <option value={`top:${s.key}`}>{s.short} activities — top level</option>
                {gs.map((g) => <option key={g.key} value={g.key}>{" ".repeat(groupDepth(groups, g.key) + 1)}{g.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {editing && height > 1 && <p className="rl-modal-body">Its {plural(descendantKeys(groups, editing.key).length, "subgroup")} move with it.</p>}
        <div className="rl-modal-actions">
          <button type="button" className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="drawer-btn primary" disabled={!ok}
            onClick={() => onSave({ key: editing?.key, label: label.trim(), labelId: labelId.trim(), parent, section })}>
            {editing ? "Save" : "Add group"}
          </button>
        </div>
      </div>
    </div>
  );
}
