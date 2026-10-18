import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useInvoices } from "../state/InvoicesContext";
import { formatRupiah, formatDateEn } from "../lib/format";
import { todayIso } from "../lib/reportPeriods";
import { buildArAgingLines, buildCustomerPivot, AGE_BUCKETS } from "../lib/arAging";
import "../pages/modules.css";
import "../pages/ap-aging.css";

const SHIELD = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>;
const CHEVRON = <svg className="apa-at-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg>;
const BUCKET_LABEL = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, b.lbl]));

// Opens one invoice: InvoicesPage reads ?open=<id> and shows its drawer.
const invoiceHref = (id) => `/invoices?open=${encodeURIComponent(id)}`;

function bucketSev(key) {
  if (key === "b1_30" || key === "b31_60") return "amt-warn";
  if (key === "b61_90" || key === "b91_120" || key === "b_gt120") return "amt-danger";
  return "";
}

function agingMeta(line) {
  const d = line.daysOverdue;
  const due = `Due ${formatDateEn(line.dueDate)}`;
  const part = line.partial ? ` · part-paid, ${formatRupiah(line.total)} invoiced` : "";
  if (d > 0) return `${due} · ${d}d overdue${part}`;
  if (d === 0) return `${due} · due today${part}`;
  return `${due} · in ${Math.abs(d)}d${part}`;
}

function LineCells({ line }) {
  return (
    <>
      {AGE_BUCKETS.map((b) => {
        const hit = line.ageBucket === b.key;
        return (
          <div key={b.key} className={hit ? bucketSev(b.key) : "apa-at-cell-zero"}>
            {hit ? formatRupiah(line.remaining) : "—"}
          </div>
        );
      })}
      <div className="apa-at-cell-strong">{formatRupiah(line.remaining)}</div>
    </>
  );
}

// Detail view — one flat row per outstanding invoice; opens the invoice.
function ArAgingRow({ line, onOpen }) {
  return (
    <div className="apa-at-vendor" onClick={onOpen}>
      <div className="apa-vendor-cell apa-flat-label">
        <div className="apa-flat-top">
          <span className="apa-at-inv-no">{line.invNo}</span>
          {line.partial && <span className="cfr-tag">PART-PAID</span>}
        </div>
        <div className="apa-flat-sub">
          <span className="apa-flat-vendor">{line.customerName}</span>
          <span className="apa-flat-meta">· {agingMeta(line)}</span>
        </div>
      </div>
      <LineCells line={line} />
    </div>
  );
}

// Summary view — one row per customer with bucket totals; click to expand the
// customer's invoices. The customer name opens the customer.
function CustomerSummaryRow({ row, expanded, onToggle, onOpenInvoice, onOpenCustomer }) {
  const n = row.invoices.length;
  return (
    <>
      <div className={`apa-at-vendor${expanded ? " expanded" : ""}`} onClick={onToggle} aria-expanded={expanded}>
        <div className="apa-vendor-cell">
          {CHEVRON}
          <span className="apa-vendor-name">
            <button type="button" className="cfr-party-link" onClick={(e) => { e.stopPropagation(); onOpenCustomer(); }}>{row.customerName}</button>
          </span>
          <span className="apa-vendor-count">{n} invoice{n === 1 ? "" : "s"}</span>
        </div>
        {AGE_BUCKETS.map((b) => (
          <div key={b.key} className={row.buckets[b.key] ? bucketSev(b.key) : "apa-at-cell-zero"}>
            {row.buckets[b.key] ? formatRupiah(row.buckets[b.key]) : "—"}
          </div>
        ))}
        <div className="apa-at-cell-strong">{formatRupiah(row.total)}</div>
      </div>
      {expanded && (
        <div className="apa-at-expand">
          {row.invoices.map((l) => (
            <div key={l.id} className="apa-at-inv clickable" onClick={() => onOpenInvoice(l.id)}>
              <div className="apa-at-inv-label">
                <div className="apa-at-inv-top">
                  <span className="apa-at-inv-no">{l.invNo}</span>
                  {l.partial && <span className="cfr-tag">PART-PAID</span>}
                </div>
                <span className="apa-at-inv-meta">{agingMeta(l)}</span>
              </div>
              <LineCells line={l} />
            </div>
          ))}
        </div>
      )}
    </>
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
          <div className="lg-filter-fld-lbl">Aging bucket</div>
          <div className="apa-fchips">
            {AGE_BUCKETS.map((b) => <Chip key={b.key} dim="bucket" val={b.key} label={b.lbl} />)}
          </div>
        </div>
        <div className="lg-filter-fld">
          <div className="lg-filter-fld-lbl">Other</div>
          <div className="apa-fchips">
            <Chip dim="special" val="overdue" label="Overdue only" />
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

// CSV shapes for the page's Export menu (see ApAgingTable).
const bucketCols = (get) => AGE_BUCKETS.map((b) => ({ label: b.lbl, value: (r) => get(r, b.key) }));
const DETAIL_COLUMNS = [
  { label: "Invoice", value: (l) => l.invNo },
  { label: "Customer", value: (l) => l.customerName },
  { label: "Invoice date", value: (l) => l.invoiceDate },
  { label: "Due date", value: (l) => l.dueDate },
  { label: "Days overdue", value: (l) => Math.max(0, l.daysOverdue) },
  { label: "Bucket", value: (l) => BUCKET_LABEL[l.ageBucket] },
  { label: "Invoice total", value: (l) => l.total },
  ...bucketCols((l, k) => (l.ageBucket === k ? l.remaining : 0)),
  { label: "Outstanding", value: (l) => l.remaining },
];
const SUMMARY_COLUMNS = [
  { label: "Customer", value: (r) => r.customerName },
  { label: "Customer code", value: (r) => r.customerCode },
  { label: "Invoices", value: (r) => r.invoices.length },
  ...bucketCols((r, k) => r.buckets[k]),
  { label: "Outstanding", value: (r) => r.total },
];

// The AR Aging Table — receivables as of a date, in a Summary (per customer,
// expandable) or Detail (per invoice) view. The mirror of ApAgingTable.
export default function ArAgingTable({ asOf = todayIso(), view = "detail", exportRef }) {
  const navigate = useNavigate();
  const { invoices } = useInvoices();

  const [tableSearch, setTableSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({ bucket: new Set(), special: new Set() });
  const [expanded, setExpanded] = useState(() => new Set());

  const filterCount = filters.bucket.size + filters.special.size;
  const toggleFilter = (dim, val) => setFilters((f) => {
    const next = new Set(f[dim]);
    next.has(val) ? next.delete(val) : next.add(val);
    return { ...f, [dim]: next };
  });
  const clearFilters = () => setFilters({ bucket: new Set(), special: new Set() });
  const toggleExpanded = (id) => setExpanded((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allLines = useMemo(() => buildArAgingLines(asOf, invoices), [asOf, invoices]);

  const rows = useMemo(() => {
    let lines = allLines;
    if (filters.special.has("overdue")) lines = lines.filter((l) => l.daysOverdue > 0);
    if (filters.bucket.size) lines = lines.filter((l) => filters.bucket.has(l.ageBucket));
    const q = tableSearch.trim().toLowerCase();
    if (q) lines = lines.filter((l) =>
      l.customerName.toLowerCase().includes(q) || (l.invNo || "").toLowerCase().includes(q));
    return [...lines].sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0) || b.remaining - a.remaining);
  }, [allLines, filters, tableSearch]);

  const pivot = useMemo(() => buildCustomerPivot(rows), [rows]);

  const grandTotals = useMemo(() => {
    const t = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b_gt120: 0, total: 0 };
    for (const l of rows) {
      t[l.ageBucket] += l.remaining;
      t.total += l.remaining;
    }
    return t;
  }, [rows]);

  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = view === "summary"
      ? { columns: SUMMARY_COLUMNS, rows: pivot }
      : { columns: DETAIL_COLUMNS, rows };
  }, [exportRef, view, rows, pivot]);

  const summary = view === "summary";
  const countLabel = summary
    ? `${pivot.length} customer${pivot.length === 1 ? "" : "s"}`
    : `${rows.length} invoice${rows.length === 1 ? "" : "s"}`;

  return (
    <div className="apa-page ar-aging">
      <div className="lg-table-wrap">
        <div className="lg-card bp-card">
          <div className="lg-filter-row no-print">
            <div className="apa-search">
              <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" /></svg>
              <input
                className="apa-search-input"
                placeholder="Search customer or invoice…"
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
                <div>{summary ? "Customer" : "Invoice · Customer"}</div>
                <div>Current</div>
                <div>1–30</div>
                <div>31–60</div>
                <div>61–90</div>
                <div>91–120</div>
                <div>&gt;120</div>
                <div>Total</div>
              </div>

              {rows.length === 0 ? (
                tableSearch.trim() ? (
                  <EmptyState title="No invoices match" sub={`Nothing matches "${tableSearch.trim()}". Try a different customer name or invoice number.`} />
                ) : (
                  <EmptyState title="No outstanding receivables" sub={`No invoices were open on ${formatDateEn(asOf)}.`} />
                )
              ) : (
                <>
                  {summary
                    ? pivot.map((r) => (
                      <CustomerSummaryRow
                        key={r.customerId}
                        row={r}
                        expanded={expanded.has(r.customerId)}
                        onToggle={() => toggleExpanded(r.customerId)}
                        onOpenInvoice={(id) => navigate(invoiceHref(id))}
                        onOpenCustomer={() => navigate(`/customers/${r.customerId}`)}
                      />
                    ))
                    : rows.map((line) => (
                      <ArAgingRow key={line.id} line={line} onOpen={() => navigate(invoiceHref(line.id))} />
                    ))}
                  <div className="apa-at-grand">
                    <div>Grand Total · {countLabel}</div>
                    <div>{formatRupiah(grandTotals.current)}</div>
                    <div>{formatRupiah(grandTotals.b1_30)}</div>
                    <div>{formatRupiah(grandTotals.b31_60)}</div>
                    <div>{formatRupiah(grandTotals.b61_90)}</div>
                    <div>{formatRupiah(grandTotals.b91_120)}</div>
                    <div>{formatRupiah(grandTotals.b_gt120)}</div>
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
