import { useState, useMemo, useRef } from "react";
import "./modules.css";
import "./invoices-ledger.css";
import "./settings-pages.css";
import "./bank-accounts-settings.css";
import { COMPANY_BANK_ACCOUNTS } from "../data/seed/bankAccounts";
import { COA } from "../data/seed/coa";
import SettingsHeader, { RECONCILIATION_TABS } from "../components/SettingsHeader";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import { useCurrentUser } from "../state/CurrentUserContext";

// Settings → Accounting → Reconciliation → Bank accounts. Saves write through
// to COMPANY_BANK_ACCOUNTS, which payments and reconciliation read. An account
// held overseas (luar negeri) names its bank freely and needs a SWIFT/BIC code;
// a foreign-currency account at an Indonesian bank may carry one too.

const BANK_OPTIONS = [
  { v: "BCA",     lbl: "Bank Central Asia (BCA)", color: "#0050A8" },
  { v: "BNI",     lbl: "Bank Negara Indonesia (BNI)", color: "#F37021" },
  { v: "MDR",     lbl: "Bank Mandiri", color: "#003D7A" },
  { v: "BRI",     lbl: "Bank Rakyat Indonesia (BRI)", color: "#003D7A" },
  { v: "CIMB",    lbl: "CIMB Niaga", color: "#7B2D8E" },
  { v: "PERMATA", lbl: "Permata Bank", color: "#1A8C53" },
  { v: "DANAMON", lbl: "Bank Danamon", color: "#F26E21" },
  { v: "MAYBANK", lbl: "Maybank Indonesia", color: "#FFC429" },
  { v: "OTHER",   lbl: "Other", color: "#777777" },
];

const GROUP_OPTIONS = [
  { v: "operating", lbl: "Operating" },
  { v: "tax",       lbl: "Tax" },
  { v: "payroll",   lbl: "Payroll" },
  { v: "petty",     lbl: "Petty Cash" },
  { v: "fx",        lbl: "Foreign Currency" },
  { v: "deposit",   lbl: "Deposit / Restricted" },
];

const CURRENCY_OPTIONS = ["IDR", "USD", "SGD", "EUR", "JPY", "AUD"];

// GL accounts a bank account can post to: the cash and cash-equivalent
// accounts in the chart of accounts, so a payment from this account lands on a
// code the ledger actually has.
const AVAILABLE_GL_ACCOUNTS = COA.filter((a) => a.parent === "g-cash" && a.code && a.is_active).map((a) => ({ code: a.code, name: a.name }));

function fmtRp(n) {
  if (n == null) return "—";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

// SWIFT/BIC: 4-letter bank, 2-letter country, 2-char location, optional 3-char branch.
const SWIFT_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const isOverseas = (a) => a.location === "overseas";
const bankLabel = (a) => (isOverseas(a) ? a.bankName || "Overseas bank" : a.bank);

function groupLabel(k) {
  return GROUP_OPTIONS.find((g) => g.v === k)?.lbl || k;
}

// ── Edit/Add drawer ─────────────────────────────────────────────────────
function BankAccountDrawer({ open, account, onClose, onSave, onArchive, canCreate, canManage, canDelete }) {
  const isNew = !account?.id;
  const [draft, setDraft] = useState(account || {});

  // Reset draft when drawer reopens with a different account
  const lastIdRef = useRef(null);
  if (open && lastIdRef.current !== (account?.id ?? "new")) {
    lastIdRef.current = account?.id ?? "new";
    setDraft(account ? { location: "domestic", ...account } : { location: "domestic", bank: "BCA", currency: "IDR", group: "operating", active: true });
  }

  if (!open) return null;

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const overseas = isOverseas(draft);
  const swift = (draft.swift || "").trim().toUpperCase();
  const swiftOk = swift ? SWIFT_RE.test(swift) : !overseas;
  const valid = (overseas ? (draft.bankName || "").trim() && (draft.country || "").trim() : draft.bank) && draft.name && draft.number && swiftOk;
  const showSwift = overseas || (draft.currency && draft.currency !== "IDR");

  function pickBank(v) {
    const bank = BANK_OPTIONS.find((b) => b.v === v);
    update({ bank: v, bankColor: bank?.color || "#777" });
  }
  function pickLocation(v) {
    update(v === "overseas"
      ? { location: v, bank: "OTHER", bankColor: "#777777", currency: draft.currency === "IDR" ? "USD" : draft.currency }
      : { location: v, bankName: null, country: null, bank: "BCA", bankColor: "#0050A8" });
  }
  function pickGl(code) {
    if (!code) { update({ glAccount: null, glAccountName: null }); return; }
    const gl = AVAILABLE_GL_ACCOUNTS.find((g) => g.code === code);
    update({ glAccount: code, glAccountName: gl?.name || null });
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer ba-drawer">
        <div className="drawer-head">
          <div className="drawer-av bank" style={{ background: draft.bankColor || "#777" }}>
            {(draft.bank || "?").slice(0, 1)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title">{isNew ? "Add bank account" : draft.name || "(no name)"}</div>
            <div className="drawer-sub">
              {isNew ? "Configure a new account for reconciliation" : `${draft.bank} · ${draft.number || ""}`}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose}>
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="drawer-body">
          <div className="ba-section">
            <div className="ba-section-title">Bank</div>
            <div className="ba-field">
              <label>Held at</label>
              <select value={draft.location || "domestic"} onChange={(e) => pickLocation(e.target.value)}>
                <option value="domestic">A bank in Indonesia</option>
                <option value="overseas">A bank overseas (luar negeri)</option>
              </select>
            </div>
            {overseas ? (
              <div className="ba-field-row">
                <div className="ba-field">
                  <label>Bank name <span className="ba-req">*</span></label>
                  <input type="text" value={draft.bankName || ""} placeholder="e.g. DBS Bank" onChange={(e) => update({ bankName: e.target.value })} />
                </div>
                <div className="ba-field">
                  <label>Country <span className="ba-req">*</span></label>
                  <input type="text" value={draft.country || ""} placeholder="e.g. Singapore" onChange={(e) => update({ country: e.target.value })} />
                </div>
              </div>
            ) : (
              <div className="ba-field">
                <label>Bank</label>
                <select value={draft.bank || ""} onChange={(e) => pickBank(e.target.value)}>
                  {BANK_OPTIONS.map((b) => <option key={b.v} value={b.v}>{b.lbl}</option>)}
                </select>
              </div>
            )}
            <div className="ba-field">
              <label>Account name <span className="ba-req">*</span></label>
              <input type="text" value={draft.name || ""} placeholder="e.g. BCA Operating" onChange={(e) => update({ name: e.target.value })} />
              <div className="ba-help">Display name used across Bank Reconciliation and reports.</div>
            </div>
            <div className="ba-field-row">
              <div className="ba-field">
                <label>Account number <span className="ba-req">*</span></label>
                <input type="text" value={draft.number || ""} placeholder="0123456789" onChange={(e) => update({ number: e.target.value })} />
              </div>
              <div className="ba-field">
                <label>Currency</label>
                <select value={draft.currency || "IDR"} onChange={(e) => update({ currency: e.target.value })}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {showSwift && (
              <div className="ba-field">
                <label>SWIFT / BIC code {overseas && <span className="ba-req">*</span>}</label>
                <input type="text" className="ba-mono-input" value={draft.swift || ""} placeholder="e.g. DBSSSGSG" maxLength={11}
                  onChange={(e) => update({ swift: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
                {swift && !SWIFT_RE.test(swift)
                  ? <div className="ba-err">A SWIFT code is 8 or 11 characters: bank (4 letters), country (2 letters), location (2), optional branch (3).</div>
                  : <div className="ba-help">{overseas ? "Needed to send and receive international transfers." : "Optional — for receiving international transfers into this account."}</div>}
              </div>
            )}
            <div className="ba-field">
              <label>Account group</label>
              <select value={draft.group || "operating"} onChange={(e) => update({ group: e.target.value })}>
                {GROUP_OPTIONS.map((g) => <option key={g.v} value={g.v}>{g.lbl}</option>)}
              </select>
              <div className="ba-help">Used to filter the carousel on Bank Reconciliation.</div>
            </div>
          </div>

          <div className="ba-section">
            <div className="ba-section-title">GL link</div>
            <div className="ba-field">
              <label>Linked GL account</label>
              <select value={draft.glAccount || ""} onChange={(e) => pickGl(e.target.value || null)}>
                <option value="">— Not linked yet —</option>
                {AVAILABLE_GL_ACCOUNTS.map((g) => (
                  <option key={g.code} value={g.code}>{g.code} · {g.name}</option>
                ))}
              </select>
              {!draft.glAccount && (
                <div className="ba-warn">
                  <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff"/></svg>
                  Reconciliation needs a linked GL account to post matches. You can link this later.
                </div>
              )}
              {draft.glAccount && (
                <div className="ba-help">
                  Posts matched bank entries to <strong>{draft.glAccount} · {draft.glAccountName}</strong>.
                </div>
              )}
            </div>
          </div>

          <div className="ba-section">
            <div className="ba-section-title">Opening balance</div>
            <div className="ba-field">
              <label>Opening balance ({draft.currency || "IDR"})</label>
              <input
                type="number"
                value={draft.openingBalance ?? ""}
                placeholder="0"
                onChange={(e) => update({ openingBalance: e.target.value === "" ? null : Number(e.target.value) })}
              />
              <div className="ba-help">The balance carried into Klay when this account was first set up.</div>
            </div>
          </div>

          <div className="ba-section">
            <div className="ba-section-title">Status</div>
            <label className="ba-toggle">
              <input type="checkbox" checked={!!draft.active} onChange={(e) => update({ active: e.target.checked })} />
              <span>Active — appears in Bank Reconciliation</span>
            </label>
          </div>

          {!isNew && canDelete && (
            <div className="ba-section">
              <button type="button" className="ba-archive-btn" onClick={() => onArchive(draft)}>
                Archive this bank account
              </button>
              <div className="ba-help">Archived accounts are hidden from Bank Reconciliation but their history is preserved.</div>
            </div>
          )}
        </div>

        <div className="drawer-footer">
          <button className="drawer-btn ghost" onClick={onClose}>Cancel</button>
          <button className="drawer-btn primary" disabled={!valid || !(isNew ? canCreate : canManage)}
            title={(isNew ? canCreate : canManage) ? undefined : "Your role can't change bank accounts"} onClick={() => onSave(draft)}>
            {isNew ? "Add account" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function BankAccountsSettingsPage() {
  const [accounts, setAccountsState] = useState(() => [...COMPANY_BANK_ACCOUNTS]);
  const { log } = useSettingsAudit();
  const { hasCapability } = useCurrentUser();
  const canCreate = hasCapability("bank.account.create");
  const canManage = hasCapability("bank.account.manage");
  const canDelete = hasCapability("bank.account.delete");
  // Write-through, so payments and reconciliation see the change.
  const setAccounts = (fn) => setAccountsState((prev) => {
    const next = fn(prev);
    COMPANY_BANK_ACCOUNTS.splice(0, COMPANY_BANK_ACCOUNTS.length, ...next);
    return next;
  });
  const [groupFilter, setGroupFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(null); // null | { account } | { account: null }  for new
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 1800);
  }

  const filtered = useMemo(() => {
    let list = accounts.filter((a) => a.active !== false);
    if (groupFilter !== "all") list = list.filter((a) => a.group === groupFilter);
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((a) =>
      (a.name || "").toLowerCase().includes(q) ||
      (a.number || "").includes(q) ||
      bankLabel(a).toLowerCase().includes(q) ||
      (a.swift || "").toLowerCase().includes(q) ||
      (a.glAccount || "").toLowerCase().includes(q),
    );
    return list;
  }, [accounts, groupFilter, search]);

  function handleSave(draft) {
    draft = { ...draft, swift: (draft.swift || "").trim().toUpperCase() || null };
    if (draft.id) {
      const before = accounts.find((a) => a.id === draft.id) || {};
      const changes = [
        ["name", "name"], ["number", "number"], ["currency", "currency"], ["glAccount", "GL account"], ["swift", "SWIFT"],
        ["bankName", "bank"], ["country", "country"],
      ].filter(([k]) => (before[k] || "") !== (draft[k] || "")).map(([k, l]) => `${l} ${before[k] || "—"} → ${draft[k] || "—"}`);
      if (changes.length) log("Reconciliation", "Bank accounts", `${draft.name}: ${changes.join("; ")}`);
      setAccounts((prev) => prev.map((a) => (a.id === draft.id ? { ...a, ...draft } : a)));
      showToast(`${draft.name} updated`);
    } else {
      const id = `bank-${Date.now()}`;
      const newAcct = { id, ...draft, active: draft.active !== false };
      setAccounts((prev) => [...prev, newAcct]);
      log("Reconciliation", "Bank accounts", `Added bank account ${draft.name}${draft.glAccount ? ` → ${draft.glAccount}` : ""}${draft.swift ? ` (SWIFT ${draft.swift})` : ""}`);
      showToast(`${draft.name} added`);
    }
    setDrawer(null);
  }
  function handleArchive(draft) {
    setAccounts((prev) => prev.map((a) => (a.id === draft.id ? { ...a, active: false } : a)));
    log("Reconciliation", "Bank accounts", `Archived bank account ${draft.name}`);
    showToast(`${draft.name} archived`);
    setDrawer(null);
  }

  return (
    <div className="lg-page bank-accounts-page">
      <div className="lg-scroll-container">
        {/* ── Header: Reconciliation tabs + add ─────────────────────────── */}
        <SettingsHeader
          title="Reconciliation"
          tabs={RECONCILIATION_TABS}
          intro="The bank accounts your team reconciles against. Link each to a GL account from your Chart of Accounts so matched entries post to the right ledger."
          actions={canCreate && (
            <button type="button" className="lg-btn-brand" onClick={() => setDrawer({ account: null })}>
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add bank account
            </button>
          )}
        />

        {/* ── Table card (pills + search + grid rows) ─────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card lg-table-bank-accounts">
            <div className="lg-pills-row">
              <button
                type="button"
                className={`lg-pill${groupFilter === "all" ? " active" : ""}`}
                onClick={() => setGroupFilter("all")}
              >
                All
                <span className="lg-pill-count">{accounts.filter((a) => a.active !== false).length}</span>
              </button>
              {GROUP_OPTIONS.map((g) => {
                const count = accounts.filter((a) => a.active !== false && a.group === g.v).length;
                return (
                  <button
                    key={g.v}
                    type="button"
                    className={`lg-pill${groupFilter === g.v ? " active" : ""}`}
                    onClick={() => setGroupFilter(g.v)}
                  >
                    {g.lbl}
                    <span className="lg-pill-count">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="lg-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input
                  type="text"
                  placeholder="Search by name, number, or GL code…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="lg-col-header">
              <div>Bank</div>
              <div>Account name</div>
              <div>Number</div>
              <div>Group</div>
              <div>Currency</div>
              <div>GL link</div>
              <div style={{ textAlign: "right" }}>Opening balance</div>
              <div />
            </div>

            {filtered.length === 0 && (
              <div className="lg-empty">No accounts in this view.</div>
            )}

            {filtered.map((a, i) => (
              <div
                key={a.id}
                className={`lg-row${i % 2 === 1 ? " alt" : ""}`}
                onClick={() => setDrawer({ account: a })}
              >
                <div className="ba-bank-cell">
                  <span className="ba-bank-logo" style={{ background: a.bankColor || "#777" }}>
                    {bankLabel(a).slice(0, 1)}
                  </span>
                  <span className="ba-bank-code">
                    {bankLabel(a)}
                    {isOverseas(a) && <span className="ba-bank-country">{a.country}</span>}
                  </span>
                </div>
                <div className="ba-name">{a.name}</div>
                <div className="ba-mono">
                  {a.number}
                  {a.swift && <span className="ba-swift">SWIFT {a.swift}</span>}
                </div>
                <div>{groupLabel(a.group)}</div>
                <div className="ba-mono">{a.currency}</div>
                <div>
                  {a.glAccount ? (
                    <div className="ba-gl-cell">
                      <span className="ba-mono ba-gl-code">{a.glAccount}</span>
                      <span className="ba-gl-name">{a.glAccountName}</span>
                    </div>
                  ) : (
                    <span className="ba-gl-warn">
                      <svg viewBox="0 0 12 12"><path d="M6 1.5l5 8.5h-10z" fill="currentColor"/><line x1="6" y1="5" x2="6" y2="7.5" stroke="#fff" strokeWidth="1.4"/><circle cx="6" cy="8.8" r="0.6" fill="#fff"/></svg>
                      Not linked
                    </span>
                  )}
                </div>
                <div className="lg-cell-total"><span className="lg-cell-total-rp">Rp</span>{fmtRp(a.openingBalance)}</div>
                <div className="ba-row-edit"><span className="ba-edit-link">Edit →</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BankAccountDrawer
        open={!!drawer}
        account={drawer?.account || null}
        onClose={() => setDrawer(null)}
        onSave={handleSave}
        onArchive={handleArchive}
        canCreate={canCreate}
        canManage={canManage}
        canDelete={canDelete}
      />

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
