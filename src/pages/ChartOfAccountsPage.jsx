import { useState, useMemo, Fragment } from "react";
import { COA } from "../data/seed/coa";
import { DIM_BY_KEY, paletteFor, dimensionsForAccount } from "../data/seed/dimensions";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import "./invoices-ledger.css";
import "./settings-pages.css";

// Accounts whose code is fixed by the system (tax + control accounts).
// Display name is still editable; the lock icon flags them in the table.
const LOCKED_CODES = new Set([
  "1-2100", // Accounts Receivable — Trade (control)
  "1-2200", // Allowance for Doubtful Accounts (contra)
  "1-5100", // VAT Input
  "2-1100", // Accounts Payable — Trade (control)
  "2-2100", // VAT Output
  "2-2200", // Income Tax Payable
  "2-2300", // Withholding Tax Payable
]);

const CONTRA_TYPES = new Set(["contra_asset", "contra_revenue"]);
const CONTROL_CODES = new Set(["1-2100", "2-1100"]);

// Top-level section labels — shown as red uppercase section rows.
const SECTION_LABELS = {
  "g-asset":     "Assets",
  "g-liability": "Liabilities",
  "g-equity":    "Equity",
  "g-revenue":   "Revenue",
  "g-cogs":      "Cost of Goods Sold",
  "g-opex":      "Operating Expenses",
  "g-other-pl":  "Other Income / Expense",
  "g-tax":       "Tax",
};

// Walk the parent chain for an account; return the top-level group id.
function topGroup(node, byId) {
  let cur = node;
  while (cur && cur.parent) {
    cur = byId[cur.parent];
  }
  return cur ? cur.id : null;
}

// Walk one level above the leaf to get the subsection group label.
function subsectionLabel(node, byId) {
  if (!node.parent) return "";
  const parent = byId[node.parent];
  if (!parent || parent.level === 0) return ""; // top section, no sub
  return parent.label || "";
}

export default function ChartOfAccountsPage() {
  const [search, setSearch] = useState("");
  const [lockedOnly, setLockedOnly] = useState(false);
  const { reconcilableAccounts, toggleReconcilable } = useAccountingSettings();

  const byId = useMemo(() => Object.fromEntries(COA.map((n) => [n.id, n])), []);

  // Leaf accounts (only nodes with a `code`).
  const accounts = useMemo(() => COA.filter((n) => n.code), []);

  // KPIs at the top of the page.
  const totalCount = accounts.length;
  const lockedCount = accounts.filter((a) => LOCKED_CODES.has(a.code)).length;
  const editableCount = totalCount - lockedCount;

  // Group accounts by section → subsection, preserving COA insertion order.
  const sections = useMemo(() => {
    const out = []; // [{ key, label, subs: [{ label, rows: [...] }] }]
    const sectionMap = new Map();
    for (const acct of accounts) {
      const topId = topGroup(acct, byId);
      if (!topId) continue;
      const subLbl = subsectionLabel(acct, byId);
      if (!sectionMap.has(topId)) {
        sectionMap.set(topId, { key: topId, label: SECTION_LABELS[topId] || byId[topId]?.label || topId, subs: [], subByLbl: new Map() });
        out.push(sectionMap.get(topId));
      }
      const sec = sectionMap.get(topId);
      if (!sec.subByLbl.has(subLbl)) {
        const newSub = { label: subLbl, rows: [] };
        sec.subByLbl.set(subLbl, newSub);
        sec.subs.push(newSub);
      }
      sec.subByLbl.get(subLbl).rows.push(acct);
    }
    return out;
  }, [accounts, byId]);

  // Filter helper: search + locked-only checkbox.
  const q = search.trim().toLowerCase();
  function passes(acct) {
    if (lockedOnly && !LOCKED_CODES.has(acct.code)) return false;
    if (q) {
      const hay = (acct.code + " " + acct.name).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  // Build the filtered tree shape; sections / subs with no surviving rows collapse out.
  const filteredSections = useMemo(() => {
    const out = [];
    for (const sec of sections) {
      const subs = [];
      for (const sub of sec.subs) {
        const rows = sub.rows.filter(passes);
        if (rows.length > 0) subs.push({ label: sub.label, rows });
      }
      if (subs.length > 0) out.push({ key: sec.key, label: sec.label, subs });
    }
    return out;
  }, [sections, q, lockedOnly]);

  return (
    <div className="settings-page">
      <h1 className="lg-title">Chart of Accounts</h1>
      <div className="settings-sub">
        Review the default chart of accounts. Rename or recode any account, and
        add new accounts where you need them. Some tax and control accounts have
        a <span style={{ color: "#A02020" }}>🔒</span> — only their display name
        can change.
      </div>

      <div className="coa-page-meta">
        <span className="stat"><span className="num">{totalCount}</span> accounts</span>
        <span className="stat"><span className="lock-mini">🔒</span><span className="num">{lockedCount}</span> locked</span>
        <span className="stat"><span className="num">{editableCount}</span> editable</span>
      </div>

      <div className="coa-tools">
        <input
          className="coa-search"
          placeholder="Search code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="coa-spacer" />
        <span
          className={`coa-lock-toggle${lockedOnly ? " on" : ""}`}
          onClick={() => setLockedOnly(!lockedOnly)}
        >
          <span className="check">{lockedOnly ? "✓" : ""}</span>
          Show only 🔒 locked
        </span>
      </div>

      <table className="coa-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Account name</th>
            <th>Dimensions</th>
            <th title="Journal lines on this account are payables settled through Payment">Reconcilable</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          {filteredSections.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--color-text-tertiary)", fontSize: 12 }}>
                No accounts match your filter.
              </td>
            </tr>
          )}
          {filteredSections.map((sec) => (
            <Fragment key={sec.key}>
              <tr className="coa-section-row">
                <td colSpan={6}>{sec.label}</td>
              </tr>
              {sec.subs.map((sub, si) => {
                const showSub = sec.subs.length > 1 && sub.label;
                return (
                  <Fragment key={si}>
                    {showSub && (
                      <tr className="coa-subsection-row">
                        <td colSpan={6}>{sub.label}</td>
                      </tr>
                    )}
                    {sub.rows.map((acct) => {
                      const locked = LOCKED_CODES.has(acct.code);
                      const isContra = CONTRA_TYPES.has(acct.type);
                      const isControl = CONTROL_CODES.has(acct.code);
                      return (
                        <tr key={acct.code} className={`coa-row depth-1${locked ? " locked-row" : ""}`}>
                          <td className="code">{acct.code}</td>
                          <td className="name">
                            {acct.name}
                            {isControl && <span className="coa-tag ctrl">CTRL</span>}
                            {isContra && <span className="coa-tag contra">CONTRA</span>}
                          </td>
                          <td className="dims">
                            {(() => {
                              const keys = dimensionsForAccount(acct);
                              if (keys.length === 0) return <span className="coa-dim-none">—</span>;
                              return (
                                <span className="coa-dim-chips">
                                  {keys.map((k) => {
                                    const dim = DIM_BY_KEY[k];
                                    if (!dim) return null;
                                    const pal = paletteFor(dim.cls);
                                    return (
                                      <span
                                        className="coa-dim-chip"
                                        key={k}
                                        style={{ background: pal.bg, color: pal.fg }}
                                      >
                                        {dim.label}
                                      </span>
                                    );
                                  })}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="recon-col">
                            {/* Only balance-sheet accounts hold something owed.
                                Control accounts are settled through their own
                                subledger (bills, invoices), so they stay out. */}
                            {acct.fs === "BS" && !isControl ? (
                              <button
                                type="button"
                                role="switch"
                                aria-checked={reconcilableAccounts.includes(acct.code)}
                                className={`coa-recon-toggle${reconcilableAccounts.includes(acct.code) ? " on" : ""}`}
                                title={reconcilableAccounts.includes(acct.code)
                                  ? "Journal lines crediting this account appear on Payment until paid. A payee is required on those lines."
                                  : "Make journal lines on this account payable through Payment"}
                                onClick={() => toggleReconcilable(acct.code)}
                              >
                                <span className="knob" />
                              </button>
                            ) : <span className="coa-dim-none">—</span>}
                          </td>
                          <td className="lock-col">
                            {locked && (
                              <span className="coa-lock-ico" title="Code is fixed by the system. Display name is editable.">🔒</span>
                            )}
                          </td>
                          <td className="actions">
                            <button className="coa-row-act" title="Edit account">✎</button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="coa-legend">
        <span className="coa-legend-item">
          <span className="coa-lock-ico">🔒</span>
          <span>locked — only the display name can change</span>
        </span>
        <span className="coa-legend-item">
          <span className="coa-tag contra">CONTRA</span>
          <span>contra-account, opposite normal balance</span>
        </span>
        <span className="coa-legend-item">
          <span className="coa-tag ctrl">CTRL</span>
          <span>control account, posts via subledger only</span>
        </span>
        <span className="coa-legend-item">
          <span className="coa-recon-toggle on" aria-hidden><span className="knob" /></span>
          <span>reconcilable — journal lines crediting it need a payee and appear on Payment until paid</span>
        </span>
      </div>
    </div>
  );
}
