import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { todayIso } from "../state/InventorySubledgerContext";
import { ACTION_LABELS } from "../lib/inventorySubledger";
import { addDays } from "../lib/clock";
import { formatDateEn, formatRupiahExact } from "../lib/format";
import "./record-movement.css";

// Date-range presets, relative to the demo clock.
export const RANGE_PRESETS = [
  ["all", "All time"],
  ["month", "This month"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
];
export function presetRange(key) {
  const t = todayIso();
  if (key === "month") return { from: `${t.slice(0, 8)}01`, to: t };
  if (key === "30") return { from: addDays(t, -29), to: t };
  if (key === "90") return { from: addDays(t, -89), to: t };
  return { from: "", to: "" };
}

// The journal status a movement shows is the ENTRY's, read live — a draft that
// has since been posted on the Journal Entry page reads Posted here too.
export function useJeStatus() {
  const { entries } = useJournalEntries();
  return useMemo(() => {
    const m = {};
    for (const e of entries) m[e.je_number] = e.status;
    return (row) => (!row.je ? null : row.seeded ? row.status : (m[row.je] || row.status || null));
  }, [entries]);
}

export function DateRangeControls({ range, setRange }) {
  const { preset, from, to } = range;
  return (
    <>
      <div className="stl-presets">
        {RANGE_PRESETS.map(([k, lbl]) => (
          <button key={k} className={preset === k ? "on" : ""} onClick={() => setRange({ preset: k, ...presetRange(k) })}>{lbl}</button>
        ))}
      </div>
      <label className="stl-date">
        From <input type="date" value={from} max={to || todayIso()} onChange={(e) => setRange({ preset: "custom", from: e.target.value, to })} />
      </label>
      <label className="stl-date">
        To <input type="date" value={to} min={from || undefined} max={todayIso()} onChange={(e) => setRange({ preset: "custom", from, to: e.target.value })} />
      </label>
    </>
  );
}

export const inRange = (d, { from, to }) => (!from || d >= from) && (!to || d <= to);

// ── One item's movements, as a timeline ─────────────────────────────────────
// Newest first, grouped by day. Each entry shows what moved, where, why, who
// recorded it, the journal it wrote, and the location balance right after it —
// so the current figure can be read back to the movements that produced it.
export default function StockTimeline({ movements, unitLabel, locations, onRecord, canRecord = true }) {
  const navigate = useNavigate();
  const jeStatus = useJeStatus();
  const [range, setRange] = useState({ preset: "all", from: "", to: "" });
  const [loc, setLoc] = useState("");

  const scoped = useMemo(() => movements.filter((m) => !loc || m.loc === loc), [movements, loc]);
  const shown = useMemo(() => scoped.filter((m) => inRange(m.date, range)), [scoped, range]);

  // Period roll-forward: opening + in − out = closing, for the scope selected.
  const summary = useMemo(() => {
    const bal = (m) => (loc ? m.loc_balance : m.balance);
    // movements are newest-first: the first one before the range is the
    // balance the period opens on.
    const before = range.from ? scoped.find((m) => m.date < range.from) : null;
    const opening = before ? bal(before) : 0;
    let inQ = 0, outQ = 0;
    for (const m of shown) { if (m.unit > 0) inQ += m.unit; else outQ += -m.unit; }
    return { opening, inQ, outQ, closing: opening + inQ - outQ };
  }, [scoped, shown, range.from, loc]);

  const days = useMemo(() => {
    const g = [];
    for (const m of shown) {
      if (!g.length || g[g.length - 1].date !== m.date) g.push({ date: m.date, rows: [] });
      g[g.length - 1].rows.push(m);
    }
    return g;
  }, [shown]);

  const n = (v) => v.toLocaleString("id-ID");

  return (
    <div>
      <div className="stl-toolbar">
        <DateRangeControls range={range} setRange={setRange} />
        {locations.length > 1 && (
          <select value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l}>{l}</option>)}
          </select>
        )}
        {onRecord && (
          <>
            <span className="stl-spacer" />
            <button className="vd-btn primary stl-record" onClick={onRecord} disabled={!canRecord}>+ Record movement</button>
          </>
        )}
      </div>

      <div className="stl-summary">
        <div><div className="stl-sum-lbl">Opening</div><div className="stl-sum-val">{n(summary.opening)}</div></div>
        <div><div className="stl-sum-lbl">In</div><div className="stl-sum-val rm-pos">+{n(summary.inQ)}</div></div>
        <div><div className="stl-sum-lbl">Out</div><div className="stl-sum-val rm-neg">−{n(summary.outQ)}</div></div>
        <div><div className="stl-sum-lbl">Closing</div><div className="stl-sum-val">{n(summary.closing)} <span style={{ fontSize: 11, fontWeight: 500 }}>{unitLabel}</span></div></div>
      </div>

      {days.length === 0 && <div className="stl-empty">No movements in this period.</div>}
      {days.map((d) => (
        <div key={d.date}>
          <div className="stl-day">{formatDateEn(d.date)}</div>
          <div className="stl-list">
            {d.rows.map((m, i) => {
              const dir = m.action === "opening" ? "open" : m.unit > 0 ? "in" : "out";
              const status = jeStatus(m);
              return (
                <div className="stl-item" key={m.id || `${d.date}-${i}`}>
                  <span className={`stl-dot ${dir}`} />
                  <div>
                    <div className="stl-head">
                      <span className={`stl-qty ${m.unit > 0 ? "in" : "out"}`}>{m.unit > 0 ? "+" : "−"}{n(Math.abs(m.unit))} {unitLabel}</span>
                      <span className="stl-loc">{m.loc}</span>
                      <span className="stl-reason">· {m.reason || ACTION_LABELS[m.action] || m.action}</span>
                    </div>
                    <div className="stl-meta">
                      {m.by && <span>{m.by}</span>}
                      {m.note && <span>· {m.note}</span>}
                      {m.je && (
                        <>
                          <span>·</span>
                          <button className="stl-je" onClick={() => navigate(`/journal-entry?je=${encodeURIComponent(m.je)}`)}>{m.je}</button>
                          {status && <span className={`stl-je-status ${status}`}>{status}</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="stl-right">
                    <div className="stl-bal">{n(m.loc_balance)} {unitLabel}</div>
                    <div className="stl-val">{m.value >= 0 ? "+" : "−"}{formatRupiahExact(Math.abs(Math.round(m.value)))}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
