import { Link, useLocation } from "react-router-dom";
import "./company-settings.css";

// Shared header for Settings pages: "Settings" eyebrow, title, optional intro
// and actions, and optional tabs. Tabs are links (each tab keeps its own URL so
// deep links like /roles/:key keep working) and say for themselves when they
// are active, so a tab stays lit on the pages under it.

const under = (pathname, to) => pathname === to || pathname.startsWith(to + "/");

// Settings → Users & Roles: people and what they can do, on one page, as
// DualEntry keeps Users & Roles together.
export const USERS_TABS = [
  { label: "Users", to: "/users", match: (l) => under(l.pathname, "/users") },
  { label: "Roles", to: "/roles", match: (l) => under(l.pathname, "/roles") },
];

// Settings → Company: who the company is and how it is organised.
export const COMPANY_TABS = [
  { label: "Company profile", to: "/company-settings", match: (l) => under(l.pathname, "/company-settings") },
  { label: "Departments", to: "/departments", match: (l) => under(l.pathname, "/departments") },
];

// Settings → Accounting: the ledger's structure (accounts, dimensions, tax,
// bank accounts) and one page of small preferences — as DualEntry splits
// Accounting Setup / Tax Setup from General preferences.
export const ACCOUNTING_TABS = [
  { label: "Chart of accounts", to: "/chart-of-accounts", match: (l) => under(l.pathname, "/chart-of-accounts") },
  { label: "Dimensions", to: "/dimensions", match: (l) => under(l.pathname, "/dimensions") },
  { label: "Tax", to: "/tax", match: (l) => under(l.pathname, "/tax") },
  { label: "Bank accounts", to: "/bank-accounts", match: (l) => under(l.pathname, "/bank-accounts") },
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

// True when `pathname` is anywhere under a tab set (for the sidebar).
export function inTabs(tabs, pathname) {
  return tabs.some((t) => t.match({ pathname, search: "" }));
}

export default function SettingsHeader({ title, intro, actions, tabs }) {
  const loc = useLocation();
  return (
    <div className={`lg-head cs-head${tabs ? "" : " lg-head-plain"}`}>
      <div className="cs-eyebrow">Settings</div>
      <div className="lg-head-top">
        <h1 className="lg-title">{title}</h1>
        {actions && <div className="lg-head-actions">{actions}</div>}
      </div>
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
