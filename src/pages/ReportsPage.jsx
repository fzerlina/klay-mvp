import { useNavigate } from "react-router-dom";
import "./modules.css";
import "./reports.css";

// Reports — a hub, not a report. Each financial statement lives on its own
// route; this page is the single nav entry that indexes them. AP Aging folds
// in here too (it was a top-level nav item before the /reports consolidation).
// P&L has no page yet, so its card is marked coming soon rather than linking
// to a dead route.
const REPORTS = [
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
    to: null,
    soon: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-6" />
      </svg>
    ),
  },
  {
    key: "cashflow",
    title: "Cashflow Report",
    blurb: "Payables and receivables aging side by side — where cash is tied up and where it's owed, bucketed by age.",
    to: "/reports/cashflow",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    key: "general-ledger",
    title: "General Ledger",
    blurb: "Every posted journal line by account — the full transaction detail behind the trial balance.",
    to: "/general-ledger",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    key: "journal-entry",
    title: "Journal Entry",
    blurb: "Record and review manual journal entries — adjustments, accruals, and reclassifications.",
    to: "/journal-entry",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
];

export default function ReportsPage() {
  const navigate = useNavigate();
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
          {REPORTS.map((r) => (
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
