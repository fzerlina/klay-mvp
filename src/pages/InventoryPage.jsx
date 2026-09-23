import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useItems } from "../state/ItemsContext";
import { useInventorySubledger } from "../state/InventorySubledgerContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { isStocked } from "../data/seed/items";
import { ACTION_LABELS } from "../lib/inventorySubledger";
import { itemUnits } from "../lib/itemMaster";
import { formatRupiah, formatRupiahExact, formatDateEn } from "../lib/format";
import RecordMovementModal from "../components/RecordMovementModal";
import { DateRangeControls, inRange, useJeStatus } from "../components/StockTimeline";
import "./modules.css";
import "./invoices-ledger.css";
import "./items.css";
import "./inventory.css";

// ── Inventory Sub-Ledger ─────────────────────────────────────────────────────
// Route /inventory. Every stock movement across every item, newest first.
//
// This is the answer to "where did the number come from?". Stock is never an
// editable figure: each change is a movement — an item, a location, up or down
// by an amount, on a date, for a reason, by a person — and each location's
// balance is the running sum of its movements. The Balance column is that sum
// straight after the row, so any on-hand figure in the app can be walked back to
// the movements that produced it. Each movement drafts the journal entry the
// books follow; its status is read live from the Journal Entry page.
//
// There is no warehouse module. Locations are free-text names entered on the
// item (at creation, or when a movement names a new one).

const PILLS = [
  ["all", "All movements"],
  ["in", "Increases"],
  ["out", "Decreases"],
  ["opening", "Opening balances"],
];
const matchPill = (m, k) =>
  k === "all" ? true : k === "opening" ? m.action === "opening" : k === "in" ? m.unit > 0 && m.action !== "opening" : m.unit < 0;

export default function InventoryPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { items } = useItems();
  const { read, online } = useInventorySubledger();
  const { inventoryCostingMethod } = useAccountingSettings();
  const jeStatus = useJeStatus();

  const stockedItems = useMemo(
    () => items.filter((i) => isStocked(i) && (i.lifecycle || "active") !== "inactive"),
    [items],
  );

  // One published read per stocked item; the ledger is their movements, flattened.
  const reads = useMemo(() => {
    const m = {};
    for (const it of items.filter(isStocked)) m[it.id] = read(it, inventoryCostingMethod);
    return m;
  }, [items, read, inventoryCostingMethod]);

  const all = useMemo(() => {
    const out = [];
    for (const it of items) {
      const st = reads[it.id];
      if (!st || st.state !== "known") continue;
      for (const m of st.movements) out.push({ ...m, item: it, unitLabel: itemUnits(it).primaryLabel });
    }
    // Newest first; within a day, the item's own (already newest-first) order.
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [items, reads]);

  const allLocations = useMemo(() => [...new Set(all.map((m) => m.loc))].sort(), [all]);

  const [pill, setPill] = useState("all");
  const [search, setSearch] = useState("");
  const [itemFilter, setItemFilter] = useState(params.get("item") || "");
  const [loc, setLoc] = useState("");
  const [range, setRange] = useState({ preset: "all", from: "", to: "" });
  const [moveOpen, setMoveOpen] = useState(false);
  const [toast, setToast] = useState("");
  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2800); }

  // Everything except the pill, so the pill counts answer "how many of each
  // within what I'm looking at".
  const scoped = useMemo(() => {
    const q = search.toLowerCase().trim();
    return all.filter((m) =>
      inRange(m.date, range) &&
      (!itemFilter || m.item.id === itemFilter) &&
      (!loc || m.loc === loc) &&
      (!q || [m.item.name, m.item.sku, m.loc, m.reason, m.note, m.je, m.by].some((v) => (v || "").toLowerCase().includes(q))),
    );
  }, [all, range, itemFilter, loc, search]);

  const rows = useMemo(() => scoped.filter((m) => matchPill(m, pill)), [scoped, pill]);
  const counts = useMemo(() => Object.fromEntries(PILLS.map(([k]) => [k, scoped.filter((m) => matchPill(m, k)).length])), [scoped]);

  // KPIs. Stock value is the ledger's current total (not range-bound); the
  // other three describe the movements in view.
  const kpi = useMemo(() => {
    let value = 0, known = 0, unavailable = 0;
    for (const st of Object.values(reads)) {
      if (st.state === "known") { value += st.stock_value || 0; known++; }
      else if (st.state === "unavailable") unavailable++;
    }
    let inV = 0, inN = 0, outV = 0, outN = 0, unposted = 0;
    for (const m of scoped) {
      if (m.unit > 0) { inV += m.value; inN++; } else { outV += -m.value; outN++; }
      const s = jeStatus(m);
      if (s === "draft" || s === "pending") unposted++;
    }
    return { value, known, unavailable, inV, inN, outV, outN, unposted };
  }, [reads, scoped, jeStatus]);

  const net = rows.reduce((s, m) => s + m.value, 0);
  const hasFilters = pill !== "all" || search || itemFilter || loc || range.preset !== "all";
  function resetAll() {
    setPill("all"); setSearch(""); setItemFilter(""); setLoc("");
    setRange({ preset: "all", from: "", to: "" });
  }

  const n = (v) => v.toLocaleString("id-ID");

  return (
    <div className="lg-page">
      <div className="lg-scroll-container">
        {/* ── Editorial header ──────────────────────────────────────── */}
        <div className="lg-head lg-head-plain">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="lg-title">Inventory Sub-Ledger</h1>
              <p className="im-lede">
                Every stock movement, for every item and location. Stock is never edited — each change
                is recorded here as a movement with a date, a reason and a journal entry, and every
                on-hand figure is the sum of its movements.
              </p>
            </div>
            <div className="lg-head-actions">
              <button className="lg-btn-brand" onClick={() => setMoveOpen(true)} disabled={!online}>
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Record movement
              </button>
            </div>
          </div>

          <div className="lg-kpi-strip">
            <button type="button" className="lg-kpi-cell" onClick={() => navigate("/items")}>
              <div className="lg-kpi-lbl">Stock value</div>
              <div className="lg-kpi-val">{kpi.known ? formatRupiah(kpi.value) : "Unavailable"}</div>
              <div className="lg-kpi-sub">
                {kpi.unavailable ? `partial — ${kpi.unavailable} unavailable` : `${kpi.known} stocked items · ${inventoryCostingMethod === "actual_cost" ? "actual cost" : "average cost"}`}
              </div>
            </button>
            <button type="button" className={`lg-kpi-cell${pill === "in" ? " active" : ""}`} onClick={() => setPill(pill === "in" ? "all" : "in")}>
              <div className="lg-kpi-lbl">Increases</div>
              <div className="lg-kpi-val">{formatRupiah(kpi.inV)}</div>
              <div className="lg-kpi-sub">{kpi.inN} movements in view</div>
            </button>
            <button type="button" className={`lg-kpi-cell${pill === "out" ? " active" : ""}`} onClick={() => setPill(pill === "out" ? "all" : "out")}>
              <div className="lg-kpi-lbl">Decreases</div>
              <div className="lg-kpi-val">{formatRupiah(kpi.outV)}</div>
              <div className="lg-kpi-sub">{kpi.outN} movements in view</div>
            </button>
            <button type="button" className="lg-kpi-cell" onClick={() => navigate("/journal-entry")}>
              <div className="lg-kpi-lbl">Journals not yet posted</div>
              <div className={`lg-kpi-val${kpi.unposted ? " warn" : ""}`}>{kpi.unposted}</div>
              <div className="lg-kpi-sub">stock the books haven’t caught up to</div>
            </button>
          </div>
        </div>

        {!online && (
          <div className="lg-table-wrap">
            <div className="im-outage">
              <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
              <div>
                <strong>Inventory Sub-Ledger unreachable.</strong> No movements can be shown or recorded
                until it answers — a blank ledger here is not an empty one.
              </div>
            </div>
          </div>
        )}

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="lg-table-wrap">
          <div className="lg-card">
            <div className="bp-tabs-row">
              {PILLS.map(([k, lbl]) => (
                <button key={k} className={`bp-tab${pill === k ? " active" : ""}`} onClick={() => setPill(k)}>
                  {lbl}
                  <span className="bp-tab-count">{counts[k]}</span>
                </button>
              ))}
            </div>

            <div className="lg-filter-row inv-filter-row">
              <div className="lg-search">
                <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5"/><path d="M9 9l3 3" strokeLinecap="round"/></svg>
                <input placeholder="Search item, location, reason, note, journal or person…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="lg-filter-meta inv-filter-meta">
                <DateRangeControls range={range} setRange={setRange} />
                <select className="inv-select" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
                  <option value="">All items</option>
                  {items.filter(isStocked).map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                </select>
                <select className="inv-select" value={loc} onChange={(e) => setLoc(e.target.value)}>
                  <option value="">All locations</option>
                  {allLocations.map((l) => <option key={l}>{l}</option>)}
                </select>
                {hasFilters && <button className="lg-reset-all" onClick={resetAll}>Reset all</button>}
              </div>
            </div>

            <div className="im-scroll">
              <div className="inv-inner">
                <div className="inv-col-header">
                  <div>Date</div>
                  <div>Item</div>
                  <div>Location</div>
                  <div>Movement</div>
                  <div className="im-num">Qty</div>
                  <div className="im-num">Unit cost</div>
                  <div className="im-num">Value</div>
                  <div className="im-num">Balance after</div>
                  <div>Journal</div>
                </div>

                {rows.length === 0 && <div className="lg-empty">No movements match these filters</div>}
                {rows.map((m, i) => {
                  const status = jeStatus(m);
                  return (
                    <div key={`${m.item.id}-${m.id || i}`} className={`inv-row${i % 2 ? " alt" : ""}`} onClick={() => navigate(`/items/${m.item.id}?tab=stock`)}>
                      <div className="inv-date">{formatDateEn(m.date)}</div>
                      <div className="inv-item">
                        <span className="im-name">{m.item.name}</span>
                        <span className="im-sku">{m.item.sku}</span>
                      </div>
                      <div className="inv-loc">{m.loc}</div>
                      <div className="inv-reason">
                        <span>{m.reason || ACTION_LABELS[m.action]}</span>
                        {(m.note || m.by) && <span className="inv-sub">{[m.by, m.note].filter(Boolean).join(" · ")}</span>}
                      </div>
                      <div className={`im-num inv-qty ${m.unit > 0 ? "in" : "out"}`}>{m.unit > 0 ? "+" : "−"}{n(Math.abs(m.unit))} <span className="inv-uom">{m.unitLabel}</span></div>
                      <div className="im-num">{n(Math.round(m.unit_cost))}</div>
                      <div className={`im-num ${m.value >= 0 ? "rm-pos" : "rm-neg"}`}>{m.value >= 0 ? "+" : "−"}{n(Math.abs(Math.round(m.value)))}</div>
                      <div className="im-num inv-bal">{n(m.loc_balance)}</div>
                      <div className="inv-je">
                        {m.je ? (
                          <>
                            <button className="stl-je" onClick={(e) => { e.stopPropagation(); navigate(`/journal-entry?je=${encodeURIComponent(m.je)}`); }}>{m.je}</button>
                            {status && <span className={`stl-je-status ${status}`}>{status}</span>}
                          </>
                        ) : <span className="im-dash">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="lg-footer">
        <div className="lg-footer-left">
          <span>Showing <span className="lg-footer-num">{rows.length}</span> movements</span>
        </div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Net value in view</span>
          <span className="lg-footer-total">{net < 0 ? "−" : ""}{formatRupiahExact(Math.abs(Math.round(net)))}</span>
        </div>
      </div>

      {moveOpen && (
        <RecordMovementModal
          items={stockedItems}
          item={itemFilter ? stockedItems.find((i) => i.id === itemFilter) : undefined}
          onClose={() => setMoveOpen(false)}
          onDone={({ item, row, je }) => {
            setMoveOpen(false);
            flash(`${item.name}: ${row.unit > 0 ? "+" : "−"}${n(Math.abs(row.unit))} at ${row.loc} recorded${je ? ` · ${je} drafted` : ""}`);
          }}
        />
      )}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
