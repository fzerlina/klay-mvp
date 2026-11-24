// Reports → Tax Register.
//
// Every tax line for a range of masa pajak, one row per document and tax,
// with DPP, rate and tax amount — the end-of-month recap GKB builds by hand.
// Phase 2 (docs/research/tax-register/README.md §6; Linear P-TRA-32):
//   • Closed / Outstanding status on each line, set by its faktur / bukti
//     potong number — not a toggle. An outstanding line takes the number
//     inline ("+ Add no.").
//   • Summary of closed vs outstanding for PPN and PPh; a figure filters.
//   • A from–to masa range (GKB's customer sheet covers a whole year).
//   • Group by tax type, vendor / customer, or masa.
//   • PPh 4(2) withheld BY customers (rent, construction termins).
//   • PPh 4(2) construction: per project, termin vs progress, the running
//     prepaid / (accrued) balance, tied to the GL (1-5510).
//   • Exports in GKB's three sheet formats, plus the register itself.
//
// PPN rows are dated by the posting date of the bill or invoice; PPh rows by
// the payment, because Klay recognises withholding when a bill is paid.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBills } from "../state/BillsContext";
import { useInvoices } from "../state/InvoicesContext";
import { useVendors } from "../state/VendorsContext";
import { useCustomers } from "../state/CustomersContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { COMPANY } from "../data/seed/company";
import { formatDateEn } from "../lib/format";
import { monthLabel, periodPresets, recentMonthEnds, todayIso } from "../lib/reportPeriods";
import { downloadCsv, reportHeader, exportName, printReport } from "../lib/reportExport";
import { downloadXlsx } from "../lib/xlsxExport";
import {
  TAX_TYPE_BY_KEY, TAX_REGISTER_COLUMNS, buildTaxRegisterRange, totalsByType, masaLabel, masaList,
  taxStatus, taxFamily, computeConstruction, pph23Object,
} from "../lib/taxRegister";
import { ChoicePopover, loadLocal, saveLocal, useClickOutside } from "../components/ReportControls";
import "./modules.css";
import "./invoices-ledger.css";
import "./cashflow-report.css";
import "./profit-loss.css";
import "./tax-register.css";

const num = (v) => (v == null ? "—" : Math.abs(v) < 0.005 ? "—" : (v < 0 ? "(" : "") + Math.abs(v).toLocaleString("id-ID") + (v < 0 ? ")" : ""));
const rp = (v) => (v < 0 ? "(Rp " : "Rp ") + Math.abs(Math.round(v || 0)).toLocaleString("id-ID") + (v < 0 ? ")" : "");
const rate = (v) => (v == null ? "—" : `${v.toLocaleString("id-ID")}%`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ALL = "all";
const DOCNO_KEY = "klay.taxRegister.docNos"; // numbers entered here; a document field in the product
const STATUS_LABEL = { closed: "Closed", outstanding: "Outstanding", na: "n/a" };
const GROUPS = { type: "Tax type", party: "Vendor / customer", masa: "Masa" };
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortMasa = (ym) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(ym.slice(5)) - 1]}-${ym.slice(2, 4)}`;

// The months a masa can be picked from: this month to date, then the eleven before it.
function masaOptions() {
  return [todayIso(), ...recentMonthEnds(11)].map((d, i) => ({
    value: d.slice(0, 7),
    label: i === 0 ? `${monthLabel(d)} · to date` : monthLabel(d),
  }));
}

function ExportMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div className="lg-meta-btn-wrap" ref={ref}>
      <button type="button" className="lg-btn-brand" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        Export
      </button>
      {open && (
        <div className="lg-popover tr-export-pop" role="menu">
          {items.map((sec) => (
            <Fragment key={sec.title}>
              <div className="lg-popover-section-lbl">{sec.title}</div>
              <div className="lg-popover-list">
                {sec.items.map((it) => (
                  <button key={it.label} type="button" role="menuitem" className="lg-popover-item" onClick={() => { setOpen(false); it.run(); }}>
                    <span>{it.label}</span>{it.hint && <span className="tb-period-range">{it.hint}</span>}
                  </button>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// Status pill + the faktur / bukti potong number, entered inline.
function StatusCell({ row, status, docNo, entered, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(docNo || "");
  useEffect(() => { setVal(docNo || ""); }, [docNo]);
  const isPpn = row.type.startsWith("ppn");
  const what = isPpn ? "faktur no." : "bupot no.";
  if (status === "na") return <span className="tr-status na" title="PPh on a manual journal — no bukti potong to wait for.">n/a</span>;
  if (editing) {
    return (
      <form className="tr-docno-form" onSubmit={(e) => { e.preventDefault(); onSave(val.trim()); setEditing(false); }}>
        <input autoFocus className="tr-docno-input tr-mono" value={val} placeholder={isPpn ? "e-Faktur no." : "Bukti potong no."} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }} aria-label={`${what} for ${row.docNo}`} />
        <button type="submit" className="tr-docno-save">Save</button>
      </form>
    );
  }
  return (
    <div className="tr-status-cell">
      <span className={`tr-status ${status}`}>{STATUS_LABEL[status]}</span>
      {status === "closed"
        ? <button type="button" className="tr-docno tr-mono" title={entered ? `Entered here — click to change the ${what}` : `Click to change the ${what}`} onClick={() => setEditing(true)}>{docNo}</button>
        : <button type="button" className="tr-docno-add no-print" onClick={() => setEditing(true)}>+ Add {what}</button>}
    </div>
  );
}

export default function TaxRegisterPage() {
  const navigate = useNavigate();
  const { bills } = useBills();
  const { invoices } = useInvoices();
  const { vendors } = useVendors();
  const { customers } = useCustomers();
  const { entries } = useJournalEntries();
  const { user } = useCurrentUser();

  // ── Parameters ────────────────────────────────────────────────────────────
  const months = useMemo(masaOptions, []);
  const lastMonth = periodPresets().find((p) => p.key === "last_month").from.slice(0, 7);
  const [fromYm, setFromYm] = useState(lastMonth);
  const [toYm, setToYm] = useState(lastMonth);
  const [view, setView] = useState("register"); // register | construction
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [familyFilter, setFamilyFilter] = useState(ALL);
  const [groupBy, setGroupBy] = useState("type");
  const [groupOpen, setGroupOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [docNos, setDocNos] = useState(() => loadLocal(DOCNO_KEY, {}));
  const [toast, setToast] = useState("");
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 1800); };
  const saveDocNo = (row, no) => {
    const next = { ...docNos, [row.id]: no };
    if (!no && !row.taxDocNo) delete next[row.id];
    setDocNos(next); saveLocal(DOCNO_KEY, next);
    showToast(no ? `${row.docNo}: ${row.type.startsWith("ppn") ? "faktur" : "bukti potong"} no. saved — line closed` : `${row.docNo} is outstanding again`);
  };
  const setFrom = (v) => { setFromYm(v); if (v > toYm) setToYm(v); };
  const setTo = (v) => { setToYm(v); if (v < fromYm) setFromYm(v); };
  const range = masaList(fromYm, toYm);
  const rangeText = fromYm === toYm ? monthLabel(`${fromYm}-01`) : `${monthLabel(`${fromYm}-01`)} – ${monthLabel(`${toYm}-01`)}`;
  const masaText = fromYm === toYm ? `Masa ${masaLabel(fromYm)}` : `Masa ${masaLabel(fromYm)} – ${masaLabel(toYm)}`;

  // ── Rows ──────────────────────────────────────────────────────────────────
  const allRows = useMemo(
    () => buildTaxRegisterRange({ fromYm, toYm, bills, invoices, vendors, customers, entries }),
    [fromYm, toYm, bills, invoices, vendors, customers, entries],
  );
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  // The range's posted lines with their status — what the summary totals.
  const masaRows = useMemo(() => allRows.filter((r) => r.posted).map((r) => {
    const docNo = docNos[r.id] ?? r.taxDocNo;
    return { ...r, docNoNow: docNo, entered: r.id in docNos, status: taxStatus(r, docNos) };
  }), [allRows, docNos]);

  const summary = useMemo(() => ["ppn", "pph"].map((fam) => {
    const rows = masaRows.filter((r) => taxFamily(r.type) === fam);
    const part = (st) => { const x = rows.filter((r) => r.status === st); return { count: x.length, tax: x.reduce((s, r) => s + Math.abs(r.tax), 0) }; };
    return { fam, label: fam === "ppn" ? "PPN" : "PPh", total: part("closed").tax + part("outstanding").tax + part("na").tax, count: rows.length, closed: part("closed"), outstanding: part("outstanding"), na: part("na") };
  }), [masaRows]);

  const q = search.trim().toLowerCase();
  const searched = useMemo(() => (q
    ? masaRows.filter((r) => [r.party, r.npwp, r.docNo, r.ref, r.jeNumber, r.docNoNow, r.memo].some((v) => v && String(v).toLowerCase().includes(q)))
    : masaRows), [masaRows, q]);
  const byFamily = familyFilter === ALL ? searched : searched.filter((r) => taxFamily(r.type) === familyFilter);
  const byStatus = statusFilter === ALL ? byFamily : byFamily.filter((r) => r.status === statusFilter);
  const totals = totalsByType(byStatus);
  const activeType = totals.some((t) => t.type === typeFilter) ? typeFilter : ALL;
  const rows = activeType === ALL ? byStatus : byStatus.filter((r) => r.type === activeType);
  const typePills = [{ k: ALL, lbl: "All types", count: byStatus.length }, ...totals.map((t) => ({ k: t.type, lbl: TAX_TYPE_BY_KEY[t.type].label, count: t.count }))];
  const statusPills = [
    { k: ALL, lbl: "All", count: byFamily.length },
    { k: "outstanding", lbl: "Outstanding", count: byFamily.filter((r) => r.status === "outstanding").length },
    { k: "closed", lbl: "Closed", count: byFamily.filter((r) => r.status === "closed").length },
  ];

  // Groups for the table.
  const groups = useMemo(() => {
    const keyOf = { type: (r) => r.type, party: (r) => r.party || "Manual journals", masa: (r) => r.masa }[groupBy];
    const map = new Map();
    rows.forEach((r) => { const k = keyOf(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
    let list = [...map.entries()].map(([k, rs]) => ({
      key: k, rows: rs, count: rs.length,
      label: groupBy === "type" ? TAX_TYPE_BY_KEY[k]?.label : groupBy === "masa" ? `Masa ${masaLabel(k)} · ${monthLabel(`${k}-01`)}` : k,
      npwp: groupBy === "party" ? rs.find((r) => r.npwp)?.npwp : null,
      dpp: rs.reduce((s, r) => s + (r.dpp || 0), 0), tax: rs.reduce((s, r) => s + r.tax, 0),
      noDpp: rs.filter((r) => r.dpp == null).length,
      open: rs.filter((r) => r.status === "outstanding").length,
    }));
    if (groupBy === "party") list = list.sort((a, b) => Math.abs(b.tax) - Math.abs(a.tax));
    if (groupBy === "masa") list = list.sort((a, b) => a.key.localeCompare(b.key));
    return list;
  }, [rows, groupBy]);

  const screenCols = TAX_REGISTER_COLUMNS.filter((c) => c.screen !== false && c.key !== "taxDocNo");
  const labelSpan = Math.max(1, screenCols.findIndex((c) => c.num));
  const filtered = activeType !== ALL || statusFilter !== ALL || familyFilter !== ALL || q;
  const resetFilters = () => { setTypeFilter(ALL); setStatusFilter(ALL); setFamilyFilter(ALL); setSearch(""); };

  // ── Construction ─────────────────────────────────────────────────────────
  const cons = useMemo(() => computeConstruction({ fromYm, toYm, entries, customers }), [fromYm, toYm, entries, customers]);

  // ── Export ────────────────────────────────────────────────────────────────
  const filterText = [
    familyFilter !== ALL && familyFilter.toUpperCase(),
    activeType !== ALL && TAX_TYPE_BY_KEY[activeType].label,
    statusFilter !== ALL && STATUS_LABEL[statusFilter],
    q && `matching "${search.trim()}"`,
  ].filter(Boolean).join(" · ") || "All tax types";
  const runLine = () => `Run ${new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}${user?.name ? ` by ${user.name}` : ""}`;
  const head = (title) => [[{ v: COMPANY.legalName, s: "bold" }], [{ v: title, s: "title" }], [`${masaText} (${rangeText})`], [{ v: runLine(), s: "muted" }], []];
  const fileBase = (slug) => `${slug}_${fromYm}${toYm !== fromYm ? `_${toYm}` : ""}.xlsx`;

  const exportRegisterCsv = () => {
    const columns = [
      ...TAX_REGISTER_COLUMNS.map((c) => ({ label: c.label, value: (r) => (c.key === "taxDocNo" ? r.docNoNow || "" : c.value(r)) })),
      { label: "Status", value: (r) => STATUS_LABEL[r.status] },
    ];
    downloadCsv(exportName("tax-register", fromYm, toYm !== fromYm ? toYm : ""), {
      header: reportHeader({ report: "Tax Register", period: `${masaText} · ${filterText}`, runBy: user?.name }), columns, rows,
    });
  };
  const exportRegisterXlsx = () => {
    const cols = TAX_REGISTER_COLUMNS.filter((c) => c.key !== "source" && c.key !== "jeNumber");
    const out = [...head("Tax Register"), [{ v: filterText, s: "muted" }], [],
      [...cols.map((c) => ({ v: c.label, s: c.num ? "headNum" : "head" })), { v: "Status", s: "head" }]];
    const freeze = out.length;
    rows.forEach((r) => out.push([...cols.map((c) => {
      if (c.key === "taxDocNo") return r.docNoNow || "";
      const v = c.value(r);
      return c.num ? (v == null ? null : { v, s: "num" }) : v;
    }), STATUS_LABEL[r.status]]));
    downloadXlsx(fileBase("tax-register"), { sheet: "Tax Register", rows: out, widths: cols.map((c) => (c.key === "party" ? 34 : c.num ? 16 : 14)).concat(12), freeze });
    showToast("Tax Register exported to Excel");
  };

  // GKB sheet 1 — PPh 4(2) by Customer: customer header (no, name, NPWP,
  // year bruto), then masa → invoice lines.
  const exportPph42Customer = () => {
    const lines = masaRows.filter((r) => r.type === "pph42_cust");
    const by = new Map();
    lines.forEach((r) => { if (!by.has(r.party)) by.set(r.party, []); by.get(r.party).push(r); });
    const out = [...head("PPh 4(2) by Customer"),
      ["NO", "NAMA PERUSAHAAN", "NPWP", "MASA PAJAK", "NOMOR BUPOT", "NILAI BRUTO", "TARIF", "PPH YANG DIPOTONG", "KETERANGAN", "STATUS"].map((h, i) => ({ v: h, s: i >= 5 && i <= 7 ? "headNum" : "head" }))];
    let n = 0;
    [...by.entries()].forEach(([party, rs]) => {
      n += 1;
      out.push([{ v: n, s: "bold" }, { v: party, s: "bold" }, rs[0].npwp || "", "", "", { v: rs.reduce((s, r) => s + r.dpp, 0), s: "numBold" }]);
      let lastMasa = null;
      rs.sort((a, b) => a.masa.localeCompare(b.masa) || a.docNo.localeCompare(b.docNo)).forEach((r) => {
        out.push(["", "", "", r.masa !== lastMasa ? shortMasa(r.masa) : "", r.docNoNow || "", { v: r.dpp, s: "num" }, { v: r.rate / 100, s: "pct" }, { v: r.tax, s: "num" }, r.docNo, STATUS_LABEL[r.status]]);
        lastMasa = r.masa;
      });
    });
    if (!lines.length) out.push(["", "No PPh 4(2) withheld by customers in this range."]);
    downloadXlsx(fileBase("pph42-by-customer"), { sheet: "PPh 4(2) by Customer", rows: out, widths: [5, 34, 22, 12, 14, 16, 8, 18, 22, 12] });
    showToast("PPh 4(2) by Customer exported");
  };

  // GKB sheet 2 — PPh 23 withheld from vendors: month → vendor, kind of
  // tax, gross, rate, tax, evidence (bukti potong no. + date). NPWP added:
  // Coretax's BPPU needs it.
  const exportPph23Vendor = () => {
    const lines = masaRows.filter((r) => r.type === "pph23" && r.partyKind === "vendor")
      .sort((a, b) => a.masa.localeCompare(b.masa) || (a.party || "").localeCompare(b.party || ""));
    const out = [...head("PPh 23 from Vendor"),
      ["Month", "Name of Company", "NPWP", "Kind of Taxes", "Gross Income", "Rate", "Amount of Taxes", "Evidence — Doc No.", "Evidence — Date", "Status"].map((h, i) => ({ v: h, s: i >= 4 && i <= 6 ? "headNum" : "head" }))];
    let last = null;
    lines.forEach((r) => {
      out.push([r.masa !== last ? MONTH_EN[Number(r.masa.slice(5)) - 1] : "", r.party, r.npwp || "", pph23Object(vendorById.get(r.partyId)),
        r.dpp == null ? null : { v: r.dpp, s: "num" }, r.rate == null ? null : { v: r.rate / 100, s: "pct" }, { v: r.tax, s: "num" },
        r.docNoNow || "", r.docNoNow ? r.postingDate || "" : "", STATUS_LABEL[r.status]]);
      last = r.masa;
    });
    if (!lines.length) out.push(["", "No PPh 23 withheld from vendors in this range."]);
    downloadXlsx(fileBase("pph23-from-vendor"), { sheet: "PPh 23 from Vendor", rows: out, widths: [12, 34, 22, 30, 16, 8, 16, 16, 12, 12] });
    showToast("PPh 23 from Vendor exported");
  };

  // GKB sheet 3 — PPh 4(2) Construction, columns A–M.
  const exportConstruction = () => {
    const H = ["No", "Project / Masa", "Customer / Invoice No.", "Contract Value (IDR)", "Termin Received (IDR)", "Rate", "PPh Withheld (IDR)", "Bukti Potong No.", "Revenue Recognized (IDR)", "PPh Expensed (IDR)", "Prepaid / (Accrued) Balance (IDR)", "Position", "Bukpot Status"];
    const out = [...head("PPh 4(2) Construction"), H.map((h, i) => ({ v: h, s: [3, 4, 6, 8, 9, 10].includes(i) ? "headNum" : "head" }))];
    const n = (v) => ({ v, s: "num" });
    cons.projects.forEach((p, i) => {
      out.push([{ v: `${i + 1}.`, s: "bold" }, { v: p.name, s: "bold" }, { v: p.customerName, s: "bold" }, { v: p.contract, s: "numBold" }, { v: p.terminAmount, s: "numBold" }, "", { v: p.withheld, s: "numBold" }, "", { v: p.revenue, s: "numBold" }, { v: p.expensed, s: "numBold" }, { v: p.balance, s: "numBold" }, p.balance >= 0 ? "Prepaid" : "Accrued", ""]);
      if (Math.abs(p.opening) >= 0.5) out.push(["", "Balance brought forward", "", "", "", "", "", "", "", "", n(p.opening), p.opening >= 0 ? "Prepaid" : "Accrued", ""]);
      p.months.forEach((m) => out.push(["", shortMasa(m.ym), m.termin ? `${m.termin.invNo} (${m.termin.label})` : "—", "", m.terminAmount ? n(m.terminAmount) : "-", { v: p.rate / 100, s: "pct" },
        m.withheld ? n(m.withheld) : "-", m.termin?.bupotNo || "", n(m.revenue), n(m.expensed), n(m.balance), m.balance >= 0 ? "Prepaid" : "Accrued", STATUS_LABEL[m.status]]));
    });
    const tot = (k) => cons.projects.reduce((s, p) => s + p[k], 0);
    out.push([], ["", { v: "Total period", s: "bold" }, "", "", { v: tot("terminAmount"), s: "numBold" }, "", { v: tot("withheld"), s: "numBold" }, "", { v: tot("revenue"), s: "numBold" }, { v: tot("expensed"), s: "numBold" }, { v: cons.balance, s: "numBold" }, "", ""]);
    out.push(["", { v: `GL ${cons.glAccount} at ${cons.asOf}`, s: "muted" }, "", "", "", "", "", "", "", "", { v: cons.gl, s: "num" }, cons.ties ? "Ties" : "Difference", ""]);
    downloadXlsx(fileBase("pph42-construction"), { sheet: "PPh 4(2) Construction", rows: out, widths: [5, 38, 32, 16, 16, 7, 16, 14, 18, 16, 20, 10, 12] });
    showToast("PPh 4(2) Construction exported");
  };
  const exportItems = [
    { title: "Register", items: [{ label: "Excel (.xlsx)", hint: "lines on screen", run: exportRegisterXlsx }, { label: "CSV", run: exportRegisterCsv }, { label: "Print / PDF", run: printReport }] },
    { title: "GKB formats", items: [
      { label: "PPh 4(2) by Customer", run: exportPph42Customer },
      { label: "PPh 23 from Vendor", run: exportPph23Vendor },
      { label: "PPh 4(2) Construction", run: exportConstruction },
    ] },
  ];

  // ── Cells ─────────────────────────────────────────────────────────────────
  const cell = (c, r) => {
    switch (c.key) {
      case "type": return <span className={`tr-type tr-type-${TAX_TYPE_BY_KEY[r.type]?.side}`}>{TAX_TYPE_BY_KEY[r.type]?.label}</span>;
      case "docNo": return (
        <div className="tr-doc">
          {r.link
            ? <button type="button" className="pl-amt-link tr-doc-no" onClick={() => navigate(r.link)}>{r.docNo}</button>
            : <span className="tr-doc-no">{r.docNo}</span>}
          <span className="tr-sub">
            {r.source}{r.ref && r.ref !== r.docNo ? ` · ${r.ref}` : ""}{r.source === "Payment" && r.jeNumber ? ` · ${r.jeNumber}` : ""}
          </span>
        </div>
      );
      case "docDate": return formatDateEn(r.docDate);
      case "postingDate": return r.postingDate ? formatDateEn(r.postingDate) : <span className="tr-muted">—</span>;
      case "party":
        if (r.party) {
          const to = r.partyId ? `/${r.partyKind === "customer" ? "customers" : "vendors"}/${r.partyId}` : null;
          return to ? <button type="button" className="tr-party" onClick={() => navigate(to)}>{r.party}</button> : r.party;
        }
        return <span className="tr-muted" title="Manual journal — no vendor or customer on it">{r.memo || "—"}</span>;
      case "npwp": return r.npwp ? <span className="tr-mono">{r.npwp}</span> : <span className="tr-muted">—</span>;
      case "dpp": return num(r.dpp);
      case "rate": return rate(r.rate);
      case "tax": return num(r.tax);
      case "account": return r.account
        ? <button type="button" className="pl-amt-link tr-mono" title={`Open ${r.account} in the General Ledger`} onClick={() => navigate(`/reports/general-ledger?account=${r.account}&period=custom&from=${r.masa}-01&to=${r.postingDate || r.docDate}`)}>{r.account}</button>
        : "—";
      default: return c.value(r);
    }
  };
  const statusCol = <th key="status" title="Closed once the faktur / bukti potong number is recorded">Status · faktur / bupot no.</th>;

  return (
    <div className="lg-page pl-page tr-page">
      <div className="lg-scroll-container">
        <div className="print-only pl-print-head">
          <div className="pl-print-co">{COMPANY.legalName}</div>
          <div className="pl-print-title">{view === "construction" ? "PPh 4(2) Construction" : "Tax Register"}</div>
          <div className="pl-print-period">{masaText} ({rangeText}){view === "register" ? ` · ${filterText}` : ""}</div>
        </div>

        <div className="lg-head lg-head-plain no-print">
          <div className="lg-head-top">
            <div style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="cfr-back" onClick={() => navigate("/reports")}>← Reports</button>
              <h1 className="lg-title">Tax Register</h1>
              <p className="cfr-lede">
                Every PPN and PPh line for {rangeText}, per vendor, customer and document — closed once its faktur or bukti potong number is in.
                PPN is dated by the posting date; PPh by the payment (or the customer&apos;s receipt).
              </p>
            </div>
            <div className="lg-head-actions">
              <div className="tr-masa-range" role="group" aria-label="Masa pajak range">
                <select className="pl-select tr-masa" value={fromYm} onChange={(e) => setFrom(e.target.value)} aria-label="From masa">
                  {[...months].reverse().map((m) => <option key={m.value} value={m.value}>Masa {masaLabel(m.value)}</option>)}
                </select>
                <span className="tr-masa-to">to</span>
                <select className="pl-select tr-masa" value={toYm} onChange={(e) => setTo(e.target.value)} aria-label="To masa">
                  {[...months].reverse().map((m) => <option key={m.value} value={m.value}>Masa {masaLabel(m.value)}</option>)}
                </select>
              </div>
              <ExportMenu items={exportItems} />
            </div>
          </div>

          <div className="lg-pills-row tr-views">
            {[["register", "Register"], ["construction", "PPh 4(2) construction"]].map(([k, l]) => (
              <button key={k} type="button" className={`lg-pill${view === k ? " active" : ""}`} onClick={() => setView(k)}>
                {l}{k === "construction" && <span className="lg-pill-count">{cons.projects.length}</span>}
              </button>
            ))}
          </div>

          {view === "register" && (
            <div className="tr-summary">
              {summary.map((s) => (
                <div key={s.fam} className={`tr-sum-card${familyFilter === s.fam ? " on" : ""}`}>
                  <button type="button" className="tr-sum-head" onClick={() => { setFamilyFilter(familyFilter === s.fam && statusFilter === ALL ? ALL : s.fam); setStatusFilter(ALL); }}
                    title={`Show only ${s.label} lines`}>
                    <span className="tr-sum-lbl">{s.label}</span>
                    <span className="tr-sum-total">{rp(s.total)}</span>
                    <span className="tr-sum-count">{plural(s.count, "line")}</span>
                  </button>
                  <div className="tr-sum-split">
                    {["closed", "outstanding"].map((st) => (
                      <button key={st} type="button" className={`tr-sum-part ${st}${familyFilter === s.fam && statusFilter === st ? " on" : ""}`}
                        onClick={() => { const on = familyFilter === s.fam && statusFilter === st; setFamilyFilter(on ? ALL : s.fam); setStatusFilter(on ? ALL : st); }}>
                        <span className={`tr-status ${st}`}>{STATUS_LABEL[st]}</span>
                        <span className="tr-sum-amt">{rp(s[st].tax)}</span>
                        <span className="tr-sum-count">{plural(s[st].count, "line")}</span>
                      </button>
                    ))}
                  </div>
                  {s.na.count > 0 && <div className="tr-sum-na">{plural(s.na.count, "journal line")} without a document ({rp(s.na.tax)}) — n/a</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {view === "register" ? (
          <div className="lg-table-wrap pl-wrap">
            <div className="lg-card pl-card">
              <div className="lg-pills-row no-print">
                {statusPills.map((p) => (
                  <button key={p.k} type="button" className={`lg-pill${statusFilter === p.k ? " active" : ""}`} onClick={() => setStatusFilter(p.k)}>
                    {p.lbl}<span className="lg-pill-count">{p.count}</span>
                  </button>
                ))}
                <span className="tb-tool-sep" aria-hidden="true" />
                {typePills.map((p) => (
                  <button key={p.k} type="button" className={`lg-pill tr-type-pill${activeType === p.k ? " active" : ""}`} onClick={() => setTypeFilter(p.k)}>
                    {p.lbl}<span className="lg-pill-count">{p.count}</span>
                  </button>
                ))}
              </div>
              <div className="lg-filter-row no-print">
                <div className="lg-search">
                  <svg viewBox="0 0 14 14"><circle cx="6" cy="6" r="3.5" /><path d="M9 9l3 3" strokeLinecap="round" /></svg>
                  <input placeholder="Search vendor, customer, NPWP, document or bupot no.…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="lg-filter-meta">
                  <div className="lg-meta-btn-wrap">
                    <button className="lg-meta-btn" onClick={() => setGroupOpen((o) => !o)} aria-haspopup="menu" aria-expanded={groupOpen}>
                      <span className="meta-lbl">Group by:</span><span className="meta-val">{GROUPS[groupBy]}</span>
                    </button>
                    {groupOpen && <ChoicePopover items={Object.entries(GROUPS).map(([k, lbl]) => ({ k, lbl }))} value={groupBy} onPick={(k) => { setGroupBy(k); setGroupOpen(false); }} onClose={() => setGroupOpen(false)} />}
                  </div>
                  {filtered && <button type="button" className="lg-reset-all" onClick={resetFilters}>Reset all</button>}
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="pl-empty">No tax lines for {rangeText}{filtered ? " with these filters" : ""}.</div>
              ) : (
                <div className="pl-table-scroll">
                  <table className="pl-table tr-table">
                    <thead>
                      <tr>
                        {screenCols.map((c, i) => (
                          <Fragment key={c.key}>
                            {i === screenCols.findIndex((x) => x.num) && statusCol}
                            <th className={c.num ? "pl-num" : ""} title={c.key === "postingDate" ? "PPN: when the bill or invoice posted. PPh: the payment date." : undefined}>
                              {c.label.replace(/ \((Rp|%)\)$/, "")}{c.num && c.key !== "rate" && <span className="pl-th-unit"> (Rp)</span>}
                            </th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <Fragment key={g.key}>
                          <tr className="pl-row-heading tr-group">
                            <td colSpan={screenCols.length + 1}>
                              {g.label}{g.npwp && <span className="tr-mono tr-group-npwp"> · NPWP {g.npwp}</span>}
                              <span className="pl-sec-count">{plural(g.count, "line")}{g.open ? ` · ${g.open} outstanding` : ""}</span>
                            </td>
                          </tr>
                          {g.rows.map((r) => (
                            <tr key={r.id} className={`tr-row${r.status === "outstanding" ? " is-open" : ""}`}>
                              {screenCols.map((c, i) => (
                                <Fragment key={c.key}>
                                  {i === screenCols.findIndex((x) => x.num) && (
                                    <td className="tr-c-status"><StatusCell row={r} status={r.status} docNo={r.docNoNow} entered={r.entered} onSave={(no) => saveDocNo(r, no)} /></td>
                                  )}
                                  <td className={`${c.num ? "pl-num" : ""} tr-c-${c.key}`}>{cell(c, r)}</td>
                                </Fragment>
                              ))}
                            </tr>
                          ))}
                          <tr className="pl-row-subtotal minor">
                            <td colSpan={labelSpan + 1}>Total {groupBy === "type" ? g.label : g.label}</td>
                            {screenCols.slice(labelSpan).map((c) => (
                              <td key={c.key} className={c.num ? "pl-num" : ""}>
                                {c.key === "dpp" ? (g.noDpp === g.count ? "—" : num(g.dpp)) : c.key === "tax" && groupBy === "type" ? num(g.tax) : c.key === "tax" ? <span title="Mixes PPN and PPh — a sum across tax types">{num(g.tax)}</span> : ""}
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="pl-foot">
              Posted lines only. A line is Closed once its faktur pajak or bukti potong number is recorded; enter it on the line (&ldquo;+ Add&rdquo;).
              Paid (NTPN) and reported (SPT Masa) are per masa, not per line, and come later. PPh 4(2) by customers is tax a customer withheld from what it paid us — we receive the bukti potong.
            </p>
          </div>
        ) : (
          <div className="lg-table-wrap pl-wrap">
            <div className="lg-card pl-card">
              <div className="pl-table-scroll">
                <table className="pl-table tr-table tr-cons">
                  <thead>
                    <tr>
                      <th>Project / masa</th><th>Customer / invoice</th><th className="pl-num">Contract value</th><th className="pl-num">Termin received</th><th className="pl-num">Rate</th>
                      <th className="pl-num">PPh withheld</th><th>Bukti potong</th><th className="pl-num">Revenue recognised</th><th className="pl-num">PPh expensed</th>
                      <th className="pl-num">Prepaid / (accrued)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cons.projects.map((p) => (
                      <Fragment key={p.id}>
                        <tr className="pl-row-heading tr-group tr-cons-head">
                          <td><strong>{p.name}</strong></td>
                          <td><button type="button" className="tr-party" onClick={() => navigate(`/customers/${p.customer}`)}>{p.customerName}</button></td>
                          <td className="pl-num">{num(p.contract)}</td><td className="pl-num">{num(p.terminAmount)}</td><td className="pl-num">{rate(p.rate)}</td>
                          <td className="pl-num">{num(p.withheld)}</td><td /><td className="pl-num">{num(p.revenue)}</td><td className="pl-num">{num(p.expensed)}</td>
                          <td className="pl-num"><strong>{num(p.balance)}</strong> <span className={`tr-pos ${p.balance >= 0 ? "pre" : "acc"}`}>{p.balance >= 0 ? "Prepaid" : "Accrued"}</span></td>
                        </tr>
                        {Math.abs(p.opening) >= 0.5 && (
                          <tr className="tr-row"><td className="tr-muted">Brought forward</td><td colSpan={8} /><td className="pl-num">{num(p.opening)}</td></tr>
                        )}
                        {p.months.map((m) => (
                          <tr key={m.ym} className={`tr-row${m.status === "outstanding" ? " is-open" : ""}`}>
                            <td className="tr-cons-masa">Masa {masaLabel(m.ym)}</td>
                            <td>{m.termin ? <span className="tr-doc"><span className="tr-doc-no">{m.termin.invNo}</span><span className="tr-sub">{m.termin.label}</span></span> : <span className="tr-muted">No termin</span>}</td>
                            <td />
                            <td className="pl-num">{num(m.terminAmount)}</td><td className="pl-num">{rate(p.rate)}</td><td className="pl-num">{num(m.withheld)}</td>
                            <td>{m.status === "na" ? <span className="tr-status na">n/a</span> : <span className="tr-status-cell"><span className={`tr-status ${m.status}`}>{STATUS_LABEL[m.status]}</span>{m.termin.bupotNo && <span className="tr-mono">{m.termin.bupotNo}</span>}</span>}</td>
                            <td className="pl-num">{num(m.revenue)}</td><td className="pl-num">{num(m.expensed)}</td>
                            <td className={`pl-num${m.balance < 0 ? " tr-acc-amt" : ""}`}>{num(m.balance)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="pl-row-subtotal">
                      <td colSpan={3}>Total {rangeText}</td>
                      <td className="pl-num">{num(cons.projects.reduce((s, p) => s + p.terminAmount, 0))}</td><td />
                      <td className="pl-num">{num(cons.projects.reduce((s, p) => s + p.withheld, 0))}</td><td />
                      <td className="pl-num">{num(cons.projects.reduce((s, p) => s + p.revenue, 0))}</td>
                      <td className="pl-num">{num(cons.projects.reduce((s, p) => s + p.expensed, 0))}</td>
                      <td className="pl-num">{num(cons.balance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className={`tr-tie ${cons.ties ? "ok" : "off"}`}>
                <span className="tr-tie-mark" aria-hidden="true">{cons.ties ? "✓" : "!"}</span>
                <span>
                  Projects net to <strong>{rp(cons.balance)}</strong> (prepaid {rp(cons.prepaid)} · accrued {rp(cons.accrued)})
                  {cons.ties ? " — ties to " : " — differs from "}
                  <Link className="pl-amt-link" to={`/reports/general-ledger?account=${cons.glAccount}&period=custom&from=${fromYm}-01&to=${cons.asOf}`}>{cons.glAccount} Prepaid Tax — PPh 4(2) Final</Link>
                  {" "}at {formatDateEn(cons.asOf)}{cons.ties ? "." : ` (${rp(cons.gl)}).`}
                </span>
              </div>
            </div>
            <p className="pl-foot">
              The customer withholds PPh 4(2) final on each termin; revenue is recognised by progress, and the PPh on it is expensed as it&apos;s earned.
              Withheld ahead of revenue is prepaid; revenue ahead of termins is accrued. The balance runs from each project&apos;s first month. Project contracts and progress come from the project module later; here they&apos;re sample data.
            </p>
          </div>
        )}
      </div>
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
