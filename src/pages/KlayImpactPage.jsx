// Reports → Klay Impact.
//
// Time saved and money guarded over a period, so a client sees from day 1 what
// Klay does for them (Michael Andreas, 16 Nov 2026). Every row opens the
// records behind it in a side panel, the way the Balance Sheet drills to
// journal lines, so each number can be checked rather than trusted.
//
// The minutes per task are set by Klay (backend config) and shown read-only on
// every row — the estimate is never hidden (Michael, 16 Nov). How the numbers
// are counted and valued lives in lib/klayImpact.js.

import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { COMPANY } from "../data/seed/company";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { periodPresets, rangeLabel } from "../lib/reportPeriods";
import {
  OUTCOMES, NOT_COUNTED, KLAY_START, summarizeImpact, fmtDuration, fmtHours, fmtRpShort,
} from "../lib/klayImpact";
import "./modules.css";
import "./invoices-ledger.css";
import "./cashflow-report.css";
import "./klay-impact.css";

// Two ranges only (user, 18 Nov): this year, and everything since go-live.
const rp = (v) => (v == null ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("id-ID")}`);
const n = (v) => (v ? v.toLocaleString("id-ID") : "—");
const plural = (k, word) => `${k.toLocaleString("id-ID")} ${word}${k === 1 ? "" : "s"}`;

// One summary box: one central number, then what made it up — biggest
// first, name and amount. A line opens its records.
const TOP_N = 4;
const TABS = [
  { key: "time", label: "Time saved", note: "Minutes each are Klay's estimate of doing the task by hand." },
  { key: "money", label: "Money guarded", note: "Guarded: the flag stopped a document or got a mistake fixed." },
];
function SummaryBox({ tone, icon, label, value, rows, total, onMore, moreLabel }) {
  const ranked = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const top = ranked.slice(0, TOP_N);
  const rest = ranked.length - top.length;
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <section className={`ki-box ki-box-${tone}`} aria-label={label}>
      <div className="ki-box-head">
        <span className="ki-box-ico" aria-hidden>{icon}</span>
        <span className="ki-box-lbl">{label}</span>
      </div>
      <div className="ki-box-fig">
        <span className="ki-box-val">{value}</span>
      </div>
      <div className="ki-box-list">
        {top.map((r) => (
          <div key={r.key} className="ki-meter" title={`${r.label}: ${r.shown} · ${pct(r.value)}% of the total`}>
            <span className="ki-meter-name">{r.label}</span>
            <span className="ki-meter-val">{r.shown}</span>
          </div>
        ))}
        {!top.length && <div className="ki-box-empty">Nothing in this period yet.</div>}
      </div>
      <button type="button" className="ki-box-more" onClick={onMore}>
        {rest > 0 ? `+ ${rest} more · ` : ""}See all {moreLabel} ↓
      </button>
    </section>
  );
}

export default function KlayImpactPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "money" ? "money" : "time";
  const setTab = (t) => { const next = new URLSearchParams(params); next.set("tab", t); setParams(next, { replace: true }); };
  // "See all" in a box opens its tab and brings the table into view.
  const showTab = (t) => { setTab(t); requestAnimationFrame(() => document.getElementById("ki-tables")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const { fiscalYearStart } = useAccountingSettings();
  const presets = useMemo(() => {
    const ytd = periodPresets({ fiscalYearStart }).find((p) => p.key === "ytd");
    return [ytd, { key: "inception", label: "Since inception", from: KLAY_START, to: ytd.to }];
  }, [fiscalYearStart]);
  const presetKey = presets.some((p) => p.key === params.get("period")) ? params.get("period") : "ytd";
  const period = presets.find((p) => p.key === presetKey);

  const s = useMemo(() => summarizeImpact(period), [period]);


  const setPeriod = (key) => { const next = new URLSearchParams(params); next.set("period", key); setParams(next, { replace: true }); };
  const range = rangeLabel(period.from, period.to);

  return (
    <div className="lg-page ki-page">
      <div className="lg-scroll-container">
        {/* ── Hero band: the two numbers up front, in boxes ──────────── */}
        <header className="ki-band">
          <div className="ki-band-top">
            <button type="button" className="cfr-back ki-back" onClick={() => navigate("/reports")}>← Reports</button>
            <div className="ki-seg" role="radiogroup" aria-label="Period">
              {presets.map((p) => (
                <button key={p.key} type="button" role="radio" aria-checked={p.key === presetKey} className={`ki-seg-btn${p.key === presetKey ? " on" : ""}`} onClick={() => setPeriod(p.key)} title={rangeLabel(p.from, p.to)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ki-eyebrow">Klay Impact · {range}</div>
          <h1 className="ki-title">What Klay did for {COMPANY.legalName}</h1>
          <p className="ki-lede">The time your team didn't spend on manual work, and the money that didn't leave by mistake.</p>

          <div className="ki-boxes">
            <SummaryBox
              tone="time"
              icon={<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>}
              label="Time saved"
              value={`≈ ${fmtHours(s.totalMinutes)}`}
              rows={s.timeRows.map((r) => ({ key: r.key, label: r.label, value: r.totalMinutes, shown: fmtDuration(r.totalMinutes) }))}
              total={s.totalMinutes}
              onMore={() => showTab("time")}
              moreLabel="activities"
            />
            <SummaryBox
              tone="money"
              icon={<svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 3.2v5.6c0 4.6-3.2 8.3-7.5 10.2-4.3-1.9-7.5-5.6-7.5-10.2V5.7z" /><polyline points="8.8 12 11 14.2 15.4 9.8" /></svg>}
              label="Money guarded"
              value={fmtRpShort(s.guardedValue)}
              rows={s.moneyRows.map((r) => ({ key: r.key, label: r.label, value: r.guarded, shown: fmtRpShort(r.guarded) }))}
              total={s.moneyRows.reduce((t, r) => t + r.guarded, 0)}
              onMore={() => showTab("money")}
              moreLabel="checks"
            />
          </div>
        </header>

        <div className="ki-body">
          {/* ── How it adds up: one card, a tab per table ─────────────── */}
          <section className="ki-card" id="ki-tables">
            <div className="ki-tabbar">
              <div className="ki-tabs" role="tablist" aria-label="How it adds up">
                {TABS.map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`ki-tab${tab === t.key ? " on" : ""}`} onClick={() => setTab(t.key)}>
                    {t.label}
                    <span className="ki-tab-n">{t.key === "time" ? `≈ ${fmtHours(s.totalMinutes)}` : fmtRpShort(s.guardedValue)}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="ki-tab-note">{TABS.find((t) => t.key === tab).note}</p>
            {tab === "time" && (
            <div className="ki-table" role="tabpanel">
              <div className="ki-row ki-th ki-time" role="row">
                <span>Activity</span>
                <span>Module</span>
                <span className="num">Count</span>
                <span className="num" title="Set by Klay — the time this takes by hand. Shown so you can see how the total is reached.">Minutes each <span className="ki-est">est.</span></span>
                <span className="num">Time saved</span>
              </div>
              {s.timeRows.map((r) => {
                return (
                  <div key={r.key} className="ki-row ki-time" role="row" title={r.counts}>
                    <span className="ki-act">
                      <span className="ki-act-lbl">{r.label}</span>
                      <span className="ki-act-sub">{r.desc}</span>
                    </span>
                    <span className="ki-mods"><span className="ki-mod">{r.module}</span></span>
                    <span className="num">{n(r.count)}</span>
                    <span className="num ki-muted">{r.minutes} min</span>
                    <span className="num ki-strong">{fmtDuration(r.totalMinutes)}</span>
                  </div>
                );
              })}
              <div className="ki-row ki-time ki-total" role="row">
                <span>Total</span>
                <span />
                <span className="num">{n(s.taskCount)}</span>
                <span />
                <span className="num">{fmtDuration(s.totalMinutes)}</span>
              </div>
            </div>
            )}
            {tab === "money" && (
            <div className="ki-table" role="tabpanel">
              <div className="ki-row ki-th ki-money" role="row">
                <span>Check</span>
                <span>Module</span>
                <span className="num">Flagged</span>
                <span className="num">Guarded</span>
                <span className="num">Amount guarded (Rp)</span>
              </div>
              {s.moneyRows.map((r) => {
                return (
                  <div key={r.key} className="ki-row ki-money" role="row" title={moneyTip(r)}>
                    <span className="ki-act">
                      <span className="ki-act-lbl">{r.label}</span>
                      <span className="ki-act-sub">{r.desc}</span>
                    </span>
                    <span className="ki-mods">{r.modules.map((m) => <span key={m} className="ki-mod">{m}</span>)}</span>
                    <span className="num">{n(r.flaggedDocs)}</span>
                    <span className="num">{n(r.stoppedDocs)}</span>
                    <span className="num ki-strong ki-good">{rp(r.guarded)}</span>
                  </div>
                );
              })}
              <div className="ki-row ki-money ki-total" role="row">
                <span title="A document caught by more than one check counts once, at its largest value.">Total <span className="ki-muted ki-total-note">each document once</span></span>
                <span />
                <span className="num">{n(s.flaggedDocs)}</span>
                <span className="num">{n(s.guardedDocs)}</span>
                <span className="num ki-good">{rp(s.guardedValue)}</span>
              </div>
            </div>
            )}
          </section>

          <p className="ki-foot">
            Minutes each are set by Klay from the time the same task takes by hand, and apply to every period. Ask your Klay contact to adjust them for your team.
            A duplicate is valued at the full document, a suspicious-vendor catch at the bill, a tax mistake at the tax difference only.
            Money guarded reads the bill and invoice flag catalog; there are no payment-release flags yet, so a duplicate payment or redirected bank account at release isn't counted.
            Not counted anywhere: {NOT_COUNTED}.
          </p>
        </div>
      </div>

    </div>
  );
}

// ── Row tooltip helpers ─────────────────────────────────────────────────────

// Which outcomes count as guarded on a check, in its own words.
const guardsText = (row) => row.guards.map((g) => (g === "resolved" ? row.resolvedLabel : OUTCOMES[g].label)).join(" or ");
// One entry per flag code, naming the documents it runs on: "(bill, invoice)".
function codeGroups(codes) {
  const out = [];
  codes.forEach((c) => {
    const doc = c.ledger === "AR" ? "invoice" : c.ledger === "PAY" ? "payment" : "bill";
    const hit = out.find((x) => x.code === c.code);
    if (hit) {
      hit.on += `, ${doc}`;
      hit.live = hit.live || c.live;
      // "Possible duplicate bill" + "Possible duplicate invoice" → "Possible duplicate"
      if (hit.label !== c.label) hit.label = hit.label.replace(/ (bill|invoice)$/, "");
    } else out.push({ ...c, on: doc });
  });
  return out;
}

// Hover detail for a check: what it's valued at, what counts, the flags.
function moneyTip(r) {
  const rule = r.guardNote || `Guarded when ${guardsText(r).toLowerCase()}`;
  if (!r.codes.length) return `Valued at the ${r.basis.toLowerCase()}. ${rule}. Read from each paid bill's discount due date — not a flag.`;
  const flags = codeGroups(r.codes).map((c) => `${c.label} (${c.on})${c.live ? "" : " — not raised yet"}`).join("; ");
  return `Valued at the ${r.basis.toLowerCase()}. ${rule}. Flags: ${flags}.`;
}
