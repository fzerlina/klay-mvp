import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import "../pages/modules.css";
import "./company-settings.css";

// Shared header for Settings pages: "Settings" eyebrow, title, optional intro
// and actions, and optional tabs. Tabs are links (each tab keeps its own URL so
// deep links like /roles/:key keep working) and say for themselves when they
// are active, so a tab stays lit on the pages under it. Every Settings page
// also gets a History button: the audit trail of changes in its section.

const under = (pathname, to) => pathname === to || pathname.startsWith(to + "/");

// Settings → Users & Roles: people and what they can do, on one page, as
// DualEntry keeps Users & Roles together.
export const USERS_TABS = [
  { label: "Users", to: "/users", match: (l) => under(l.pathname, "/users") },
  { label: "Roles", to: "/roles", match: (l) => under(l.pathname, "/roles") },
];

// Settings → Company: one page, no tabs — kept as a set of one so the sidebar
// can light up.
export const COMPANY_TABS = [
  { label: "Company profile", to: "/company-settings", match: (l) => under(l.pathname, "/company-settings") },
];

// Settings → Accounting: the ledger's structure (accounts, dimensions, tax,
// bank accounts), the default accounts every module pre-fills from, and one
// page of small preferences — as DualEntry splits
// Accounting Setup / Tax Setup from General preferences.
export const ACCOUNTING_TABS = [
  { label: "Chart of accounts", to: "/chart-of-accounts", match: (l) => under(l.pathname, "/chart-of-accounts") },
  { label: "Dimensions", to: "/dimensions", match: (l) => under(l.pathname, "/dimensions") },
  { label: "Tax", to: "/tax", match: (l) => under(l.pathname, "/tax") },
  { label: "Bank accounts", to: "/bank-accounts", match: (l) => under(l.pathname, "/bank-accounts") },
  { label: "Journal templates", to: "/journal-templates", match: (l) => under(l.pathname, "/journal-templates") },
  { label: "Preferences", to: "/accounting-preferences", match: (l) => under(l.pathname, "/accounting-preferences") },
];

// Module settings (Payables, Receivables, Inventory): one route per tab, the
// first tab at the module's base path.
const exact = (to) => (l) => l.pathname === to;
const moduleTabs = (tabs) => tabs.map(([label, to]) => ({ label, to, match: exact(to) }));

export const PAYABLES_TABS = moduleTabs([
  ["Payment terms", "/settings/payables"],
  ["Vendor categories", "/settings/payables/vendor-categories"],
  ["Payment methods", "/settings/payables/payment-methods"],
]);
export const RECEIVABLES_TABS = moduleTabs([
  ["Payment terms", "/settings/receivables"],
  ["Invoices", "/settings/receivables/invoices"],
]);
export const INVENTORY_TABS = moduleTabs([
  ["Item categories", "/settings/inventory"],
  ["Units", "/settings/inventory/units"],
  ["Sites & locations", "/settings/inventory/sites"],
  ["Costing", "/settings/inventory/costing"],
]);
// Single-page modules still get a tab set of one, so the sidebar can light up.
export const FIXED_ASSETS_TABS = moduleTabs([["Asset categories", "/settings/fixed-assets"]]);
export const RECONCILIATION_TABS = moduleTabs([["Reconciliation", "/settings/reconciliation"]]);
// Its own menu item, no tabs on the page — a set of one for the sidebar.
export const DEFAULT_ACCOUNTS_TABS = moduleTabs([["Default accounts", "/settings/default-accounts"]]);

// True when `pathname` is anywhere under a tab set (for the sidebar).
export function inTabs(tabs, pathname) {
  return tabs.some((t) => t.match({ pathname, search: "" }));
}

const fmtAt = (iso) => new Date(iso).toLocaleString("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

// The Settings audit trail for one section, with a switch to every section.
function HistoryDrawer({ area, onClose }) {
  const { entries } = useSettingsAudit();
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.filter((e) => e.area === area);
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="Audit trail">
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title">Audit trail</div>
            <div className="cs-audit-sub">{all ? "All settings" : area} · {shown.length} change{shown.length === 1 ? "" : "s"}</div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>
        <div className="cs-audit-switch">
          <button type="button" className={all ? "" : "on"} onClick={() => setAll(false)}>{area}</button>
          <button type="button" className={all ? "on" : ""} onClick={() => setAll(true)}>All settings</button>
        </div>
        <div className="drawer-body">
          {shown.length === 0 && <div className="cs-audit-empty">No changes recorded yet.</div>}
          {shown.map((e) => (
            <div key={e.id} className="cs-audit-row">
              <span className="cs-audit-dot" aria-hidden />
              <div>
                <div className="cs-audit-what">{e.summary}</div>
                <div className="cs-audit-meta">
                  {all ? `${e.area} › ` : ""}{e.page} · by {e.by} · {fmtAt(e.at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function SettingsHeader({ title, intro, actions, tabs }) {
  const loc = useLocation();
  const [history, setHistory] = useState(false);
  return (
    <div className={`lg-head cs-head${tabs ? "" : " lg-head-plain"}`}>
      <div className="cs-eyebrow">Settings</div>
      <div className="lg-head-top">
        <h1 className="lg-title">{title}</h1>
        <div className="lg-head-actions">
          <button type="button" className="cs-history-btn" onClick={() => setHistory(true)}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 3 3 9 9 9" /><polyline points="12 7 12 12 15 14" /></svg>
            History
          </button>
          {actions}
        </div>
      </div>
      {history && <HistoryDrawer area={title} onClose={() => setHistory(false)} />}
      {intro && <p className="settings-sub cs-intro">{intro}</p>}
      {tabs && (
        <nav className="cs-tabs" aria-label={title}>
          {tabs.map((t) => (
            <Link key={t.label} to={t.to} className={`cs-tab${t.match(loc) ? " active" : ""}`}>
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
