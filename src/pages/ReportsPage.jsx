import { useNavigate } from "react-router-dom";
import { useCurrentUser } from "../state/CurrentUserContext";
import "./modules.css";
import "./reports.css";

// Reports — a hub, not a report. Each financial statement lives on its own
// route; this page is the single nav entry that indexes them. AP Aging folds
// in here too (it was a top-level nav item before the /reports consolidation).
// The General Ledger leads: it is where every other report drills down to.
// It is still read on GL access (`module`), so a role without it doesn't see
// the card. The Inventory Sub-Ledger (/inventory) page still exists but isn't
// listed.
const REPORTS = [
  {
    key: "directors-summary",
    title: "Director's Summary",
    blurb: "One page for the directors — revenue, profit, cash and equity against the prior period, with the finance team's commentary.",
    to: "/reports/directors-summary",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    key: "klay-impact",
    title: "Klay Impact",
    blurb: "Time Klay saved your team and money it kept from leaving by mistake — duplicates, tax mistakes and suspicious vendors caught.",
    to: "/reports/klay-impact",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /><polyline points="8.5 12 11 14.5 15.5 9.5" />
      </svg>
    ),
  },
  {
    key: "general-ledger",
    title: "General Ledger",
    blurb: "Every journal line by account — opening balance, each posting by date and the running balance to close.",
    to: "/reports/general-ledger",
    module: "gl",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    key: "trial-balance",
    title: "Trial Balance",
    blurb: "Every account's debit and credit balance for the period — the proof the ledger foots before you close.",
    to: "/trial-balance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    key: "pl",
    title: "Profit & Loss",
    blurb: "Revenue less expenses over the period — the income statement that rolls up to net profit.",
    to: "/reports/profit-loss",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-6" />
      </svg>
    ),
  },
  {
    key: "bs",
    title: "Balance Sheet",
    blurb: "What the company owns, owes and is worth on a date — assets, liabilities and equity, proved to balance.",
    to: "/reports/balance-sheet",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" /><path d="M5 21h14" /><path d="M3 8h18" /><path d="M6 8l-3 6a3 3 0 0 0 6 0z" /><path d="M18 8l-3 6a3 3 0 0 0 6 0z" />
      </svg>
    ),
  },
  {
    key: "cash-flow",
    title: "Cash Flow",
    blurb: "Arus kas — cash from operating, investing and financing activities over the period, proved against cash on the Balance Sheet.",
    to: "/reports/cash-flow",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h13" /><polyline points="13 3 17 7 13 11" /><path d="M20 17H7" /><polyline points="11 13 7 17 11 21" />
      </svg>
    ),
  },
  {
    key: "changes-in-equity",
    title: "Changes in Equity",
    blurb: "Perubahan modal — how share capital, paid-in capital and retained earnings moved over the period, tied to the Balance Sheet.",
    to: "/reports/changes-in-equity",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-9-9" /><path d="M12 3v9h9" /><path d="M16 3.5A9 9 0 0 1 20.5 8" />
      </svg>
    ),
  },
  {
    key: "cashflow",
    title: "Cash Position & Aging",
    blurb: "Cash in the bank, what customers owe and what you owe vendors — by age, as of any date.",
    to: "/reports/cashflow",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    key: "tax-register",
    title: "Tax Register",
    blurb: "Every PPN and PPh line for a tax month — per vendor, per document, with DPP and tax — ready to export for the monthly recap.",
    to: "/reports/tax-register",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><line x1="9" y1="17" x2="15" y2="11" /><circle cx="9.5" cy="11.5" r="1" /><circle cx="14.5" cy="16.5" r="1" />
      </svg>
    ),
  },
];

export default function ReportsPage() {
  const navigate = useNavigate();
  const { can } = useCurrentUser();
  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Reports</h1>
              <p className="rp-lede">Financial statements and schedules for the current period. Open one to drill in.</p>
            </div>
          </div>
        </div>

        <div className="rp-grid">
          {REPORTS.filter((r) => can(r.module)).map((r) => (
            <button
              key={r.key}
              type="button"
              className={`rp-card${r.soon ? " soon" : ""}`}
              disabled={r.soon}
              onClick={() => r.to && navigate(r.to)}
            >
              <span className="rp-card-ico" aria-hidden>{r.icon}</span>
              <span className="rp-card-body">
                <span className="rp-card-title-row">
                  <span className="rp-card-title">{r.title}</span>
                  {r.soon && <span className="rp-card-soon">Coming soon</span>}
                </span>
                <span className="rp-card-blurb">{r.blurb}</span>
              </span>
              {!r.soon && <span className="rp-card-arrow" aria-hidden>→</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
