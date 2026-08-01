import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { useVendors } from "../state/VendorsContext";
import RelationshipTierControl from "./RelationshipTier";
import { TODAY } from "../lib/clock";
import { formatRupiah, formatDateEn } from "../lib/format";
import {
  buildAgingLines,
  isAgingTableRow,
  AGE_BUCKETS,
  RELATIONSHIP_LABEL,
} from "../lib/apAging";
import PpnChip from "./PpnChip";
import "../pages/modules.css";
import "../pages/ap-aging.css";

const SHIELD = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>;

function bucketSev(key) {
  if (key === "b1_30" || key === "b31_60") return "amt-warn";
  if (key === "b61_90" || key === "b91_120" || key === "b_gt120") return "amt-danger";
  return "";
}

function agingMeta(line) {
  if (line.is_accrual) return "Awaiting invoice";
  const d = line.daysOverdue;
  const due = `Due ${formatDateEn(line.dueDate)}`;
  if (d > 0) return `${due} · ${d}d overdue`;
  if (d === 0) return `${due} · due today`;
  return `${due} · in ${Math.abs(d)}d`;
}

// One flat row per outstanding bill — no vendor grouping. The bill's balance
// lands in the single age bucket it belongs to.
function ApAgingRow({ line, onOpen }) {
  return (
    <div className="apa-at-vendor" onClick={onOpen}>
      <div className="apa-vendor-cell apa-flat-label">
        <div className="apa-flat-top">
          <span className="apa-at-inv-no">{line.invNo}</span>
          {line.is_accrual && <span className="apa-inv-accrual">ACCRUAL</span>}
          {!line.is_accrual && <PpnChip invoiceDate={line.invoiceDate} />}
        </div>
        <div className="apa-flat-sub">
          <span className="apa-flat-vendor">{line.vendorName}</span>
          <RelationshipTierControl vendorId={line.vendorId} editable={false} />
          <span className="apa-flat-meta">· {agingMeta(line)}</span>
        </div>
      </div>
      {AGE_BUCKETS.map((b) => {
        const hit = !line.is_accrual && line.ageBucket === b.key;
        return (
          <div key={b.key} className={hit ? bucketSev(b.key) : "apa-at-cell-zero"}>
            {hit ? formatRupiah(line.remaining) : "—"}
          </div>
        );
      })}
      <div className={line.is_accrual ? "apa-at-cell-accrual" : "apa-at-cell-zero"}>
        {line.is_accrual ? formatRupiah(line.remaining) : "—"}
      </div>
      <div className="apa-at-cell-strong">{formatRupiah(line.remaining)}</div>
    </div>
  );
}

function EmptyState({ title, sub }) {
  return (
    <div className="apa-empty">
      {SHIELD}
      <div className="apa-empty-title">{title}</div>
      <div className="apa-empty-sub">{sub}</div>
    </div>
  );
}

function TableFilterPopover({ filters, onToggle, onClear, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const Chip = ({ dim, val, label }) => (
    <button type="button" className={`apa-fchip${filters[dim].has(val) ? " active" : ""}`} onClick={() => onToggle(dim, val)}>
      {label}
    </button>
  );

  return (
    <div className="lg-popover lg-filter-pop apa-filter-pop" ref={ref}>
      <div className="lg-filter-body">
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Relationship</div>
          <div className="apa-fchips">
            {Object.entries(RELATIONSHIP_LABEL).map(([v, l]) => <Chip key={v} dim="tier" val={v} label={l} />)}
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Aging bucket</div>
          <div className="apa-fchips">
            {AGE_BUCKETS.map((b) => <Chip key={b.key} dim="bucket" val={b.key} label={b.lbl} />)}
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Other</div>
          <div className="apa-fchips">
            <Chip dim="special" val="accrual" label="Accruals only" />
          </div>
        </div>
      </div>
      <div className="apa-filter-foot">
        <button type="button" className="lg-filter-reset" onClick={onClear}>Clear all</button>
        <button type="button" className="lg-filter-apply" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

// The AP Aging Table — the GL-reconciled payables report as a flat list of
// outstanding bills bucketed by age. Reads live bills + vendor tiers; owns its
// own search / filter state.
export default function ApAgingTable() {
  const navigate = useNavigate();
  const { bills } = useBills();
  const { tierOf } = useVendors();

  const [tableSearch, setTableSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ tier: new Set(), bucket: new Set(), special: new Set() });

  const filterCount = filters.tier.size + filters.bucket.size + filters.special.size;
  const toggleFilter = (dim, val) => setFilters((f) => {
    const next = new Set(f[dim]);
    next.has(val) ? next.delete(val) : next.add(val);
    return { ...f, [dim]: next };
  });
  const clearFilters = () => setFilters({ tier: new Set(), bucket: new Set(), special: new Set() });

  const allLines = useMemo(() => buildAgingLines(TODAY, bills), [bills]);

  const rows = useMemo(() => {
    let lines = allLines.filter(isAgingTableRow);
    if (filters.tier.size) lines = lines.filter((l) => filters.tier.has(tierOf(l.vendorId)));
    if (filters.bucket.size) lines = lines.filter((l) => filters.bucket.has(l.ageBucket));
    if (filters.special.has("accrual")) lines = lines.filter((l) => l.is_accrual);
    const q = tableSearch.trim().toLowerCase();
    if (q) lines = lines.filter((l) =>
      l.vendorName.toLowerCase().includes(q) || (l.invNo || "").toLowerCase().includes(q));
    // Most overdue first; accruals (no due date) sort to the end.
    return [...lines].sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0) || b.remaining - a.remaining);
  }, [allLines, filters, tableSearch, tierOf]);

  const grandTotals = useMemo(() => {
    const t = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b_gt120: 0, accrual: 0, total: 0 };
    for (const l of rows) {
      if (l.is_accrual) t.accrual += l.remaining;
      else t[l.ageBucket] += l.remaining;
      t.total += l.remaining;
    }
    return t;
  }, [rows]);

  return (
    <div className="apa-page">
      <div className="lg-table-wrap">
        <div className="lg-card bp-card">
          <div className="lg-filter-row">
            <div className="apa-search">
              <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" /></svg>
              <input
                className="apa-search-input"
                placeholder="Search vendor or invoice…"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
              {tableSearch && (
                <button type="button" className="apa-search-clear" onClick={() => setTableSearch("")} aria-label="Clear search">×</button>
              )}
            </div>
            <div className="lg-filter-meta">
              {filterCount > 0 && (
                <button type="button" className="lg-filter-reset" onClick={clearFilters}>Clear filters</button>
              )}
              <div className="lg-meta-btn-wrap">
                <button type="button" className={`lg-meta-btn${filterCount > 0 ? " active" : ""}`} onClick={() => setFilterOpen((o) => !o)}>
                  <svg viewBox="0 0 12 12"><path d="M1 2.5h10l-4 4.5V11L5 9.5V7L1 2.5z" /></svg>
                  Filter
                  {filterCount > 0 && <span className="lg-filter-badge">{filterCount}</span>}
                </button>
                {filterOpen && (
                  <TableFilterPopover
                    filters={filters}
                    onToggle={toggleFilter}
                    onClear={clearFilters}
                    onClose={() => setFilterOpen(false)}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="apa-at-scroll">
            <div className="apa-at-inner">
              <div className="apa-at-header">
                <div>Bill · Vendor</div>
                <div>Current</div>
                <div>1–30</div>
                <div>31–60</div>
                <div>61–90</div>
                <div>91–120</div>
                <div>&gt;120</div>
                <div>Accrual</div>
                <div>Total</div>
              </div>

              {rows.length === 0 ? (
                tableSearch.trim() ? (
                  <EmptyState title="No bills match" sub={`Nothing matches "${tableSearch.trim()}". Try a different vendor name or invoice number.`} />
                ) : (
                  <EmptyState title="No outstanding balances" sub="All bills are settled." />
                )
              ) : (
                <>
                  {rows.map((line) => (
                    <ApAgingRow key={line.id} line={line} onOpen={() => navigate(`/bills/${line.id}`)} />
                  ))}
                  <div className="apa-at-grand">
                    <div>Grand Total · {rows.length} bill{rows.length === 1 ? "" : "s"}</div>
                    <div>{formatRupiah(grandTotals.current)}</div>
                    <div>{formatRupiah(grandTotals.b1_30)}</div>
                    <div>{formatRupiah(grandTotals.b31_60)}</div>
                    <div>{formatRupiah(grandTotals.b61_90)}</div>
                    <div>{formatRupiah(grandTotals.b91_120)}</div>
                    <div>{formatRupiah(grandTotals.b_gt120)}</div>
                    <div style={{ color: grandTotals.accrual > 0 ? "#9FCFFF" : "rgba(255,255,255,.4)" }}>
                      {grandTotals.accrual > 0 ? formatRupiah(grandTotals.accrual) : "—"}
                    </div>
                    <div>{formatRupiah(grandTotals.total)}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
