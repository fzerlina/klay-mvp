// Reports → Review log.
//
// Every variance review, on the Profit & Loss, the Trial Balance and the
// Balance Sheet, as one
// feed, newest first (user, 11 Nov 2026: "a Log page, accessible through a
// button" rather than a table; one feed, no type filter). A reason belongs to
// an account and a period, so one written on either report counts on both;
// each entry says where it was written and opens that report on that period.
// Read-only — reasons are written on the reports.

import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { COA_BY_CODE } from "../data/seed/coa";
import { rangeLabel } from "../lib/reportPeriods";
import { useVarianceReviews, reviewEvents } from "../state/VarianceReviewsContext";
import "./modules.css";
import "./invoices-ledger.css";
import "./profit-loss.css";

const rp = (v) => (v == null ? "—" : `Rp ${Math.abs(v).toLocaleString("id-ID")}`);
const dayLabel = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const timeLabel = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const ACTION = { reviewed: "marked reviewed", updated: "updated the reason on", reopened: "reopened" };
const REPORTS = {
  pl: { label: "P&L", name: "Profit & Loss", to: "/reports/profit-loss" },
  tb: { label: "Trial Balance", name: "Trial Balance", to: "/trial-balance" },
  bs: { label: "Balance Sheet", name: "Balance Sheet", to: "/reports/balance-sheet" },
};

export default function VarianceReviewLogPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const back = Object.values(REPORTS).find((r) => r.to === location.state?.back) || REPORTS.pl;
  const { reviews } = useVarianceReviews();
  const [q, setQ] = useState("");

  const events = useMemo(() => reviewEvents(reviews), [reviews]);
  const shown = events.filter((e) => {
    if (!q.trim()) return true;
    const name = COA_BY_CODE[e.code]?.name || "";
    return `${e.code} ${name} ${e.note || ""} ${e.by}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  // Grouped by day, as an activity log reads.
  const days = [];
  shown.forEach((e) => {
    const d = String(e.at).slice(0, 10);
    if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, items: [] });
    days[days.length - 1].items.push(e);
  });

  const open = (e) => navigate(REPORTS[e.report || "pl"].to, { state: { period: { from: e.from, to: e.to }, review: e.code } });

  return (
    <div className="lg-page pl-log-page">
      <div className="lg-scroll-container">
        <div className="lg-head">
          <Link to={back.to} className="pl-log-back">← {back.name}</Link>
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Review log</h1>
              <p className="pl-log-intro">
                Every variance reason written on the Profit &amp; Loss, the Trial Balance and the Balance Sheet — who reviewed which account, for which period, and why it moved.
              </p>
            </div>
          </div>
        </div>

        <div className="pl-log">
          <div className="pl-log-tools">
            <div className="lg-search pl-log-search">
              <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
              <input placeholder="Search account, reason or person…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <span className="pl-log-count">{shown.length} {shown.length === 1 ? "entry" : "entries"}</span>
          </div>

          {events.length === 0 && (
            <div className="pl-log-empty">
              <div className="pl-log-empty-title">No reviews yet</div>
              <p>Accounts flagged on the Profit &amp; Loss, the Trial Balance or the Balance Sheet get a reason when someone reviews them. Those reasons collect here.</p>
              <Link to={back.to} className="lg-btn-ghost">Go to {back.name}</Link>
            </div>
          )}
          {events.length > 0 && shown.length === 0 && <div className="pl-log-empty"><p>Nothing matches.</p></div>}

          {days.map((d) => (
            <section key={d.day} className="pl-log-day">
              <div className="pl-log-day-lbl">{dayLabel(d.day)}</div>
              {d.items.map((e) => {
                const name = COA_BY_CODE[e.code]?.name || e.code;
                const rep = REPORTS[e.report || "pl"];
                const delta = e.amount != null && e.prev != null ? e.amount - e.prev : null;
                const pctMove = delta != null && e.prev ? Math.round((Math.abs(delta) / Math.abs(e.prev)) * 100) : null;
                return (
                  <article key={e.id} className={`pl-log-item ${e.action}`}>
                    <span className="pl-log-avatar" aria-hidden="true">{initials(e.by)}</span>
                    <div className="pl-log-body">
                      <div className="pl-log-line">
                        <strong>{e.by}</strong> {ACTION[e.action] || e.action}{" "}
                        <span className="tb-code">{e.code}</span> <strong>{name}</strong>
                        <span className="pl-log-time">{timeLabel(e.at)}</span>
                      </div>
                      <div className="pl-log-meta">
                        <span className="pl-log-chip">{rangeLabel(e.from, e.to)}</span>
                        <span className="pl-log-chip pl-log-rep">{rep.label}</span>
                        {delta != null && (
                          <span className="pl-log-move">
                            {delta >= 0 ? "+" : "−"}{rp(delta)}{pctMove != null ? ` (${delta >= 0 ? "+" : "−"}${pctMove}%)` : " (new)"} · {rp(e.prev)} → {rp(e.amount)}
                          </span>
                        )}
                      </div>
                      {e.note && <blockquote className="pl-log-note">{e.note}</blockquote>}
                      <button type="button" className="pl-log-open" onClick={() => open(e)}>Open in {rep.name} →</button>
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
