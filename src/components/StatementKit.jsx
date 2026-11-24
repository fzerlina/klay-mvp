// Statement kit — the small pieces the Phase 2 statements share (Changes in
// Equity, Cash Flow, Director's Summary): number formats, the English-on-
// screen / Bahasa-in-print label, the toolbar icons, the format settings
// popover, and the print header and sign-off block. Same look and behaviour
// as the Balance Sheet and Profit & Loss, which keep their own copies.

import { useRef } from "react";
import { COMPANY } from "../data/seed/company";
import { useClickOutside, Check } from "./ReportControls";

export const UNITS = {
  1:       { en: "Amounts in Rupiah",              id: "Dinyatakan dalam Rupiah",        head: "Rp" },
  1000:    { en: "Amounts in thousands of Rupiah", id: "Dinyatakan dalam ribuan Rupiah", head: "Rp '000" },
  1000000: { en: "Amounts in millions of Rupiah",  id: "Dinyatakan dalam jutaan Rupiah", head: "Rp m" },
};

// Statement amounts: id-ID grouping, negatives in parentheses, zero as a dash.
export const num = (v, unit = 1) => {
  if (v == null) return "";
  const s = v / unit;
  if (Math.abs(s) < (unit === 1 ? 0.005 : 0.5)) return "—";
  const t = Math.abs(s).toLocaleString("id-ID", unit === 1 ? undefined : { maximumFractionDigits: 0 });
  return s < 0 ? `(${t})` : t;
};
export const rp = (v) => {
  if (v == null) return "—";
  const s = "Rp " + Math.abs(Math.round(v)).toLocaleString("id-ID");
  return v < 0 ? `(${s})` : s;
};
// Short rupiah for tiles: Rp 1,2 M / Rp 850 jt.
export const rpShort = (v) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const f = (x, d) => x.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
  const s = a >= 1e12 ? `Rp ${f(a / 1e12, 2)} T` : a >= 1e9 ? `Rp ${f(a / 1e9, 2)} M` : a >= 1e6 ? `Rp ${f(a / 1e6, 0)} jt` : `Rp ${f(a, 0)}`;
  return v < 0 ? `(${s})` : s;
};
export const pct = (v, digits = 1) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v * 100).toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
  return v < 0 ? `(${s})` : s;
};
export const r2 = (v) => Math.round(v * 100) / 100;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const longDate = (iso, lang) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${(lang === "id" ? ID_MONTHS : EN_MONTHS)[m - 1]} ${y}`; };
// "For the period 1 January 2025 to 31 March 2025" / "Untuk periode …".
export const forPeriod = (from, to, lang) =>
  lang === "id" ? `Untuk periode ${longDate(from, "id")} sampai dengan ${longDate(to, "id")}` : `For the period ${longDate(from, "en")} to ${longDate(to, "en")}`;

// English on screen; Bahasa in print and Excel when the report is set to it.
export function Lbl({ en, id, lang }) {
  if (lang !== "id" || !id || id === en) return en;
  return <><span className="pl-lbl-screen">{en}</span><span className="pl-lbl-print">{id}</span></>;
}

export const GEAR = <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
export const CAL = <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
export const ARROW = <svg viewBox="0 0 24 24"><path d="M7 17L17 7"/><path d="M8 7h9v9"/></svg>;
export const DOWNLOAD = <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
export const Chevron = ({ closed }) => <svg className={`lg-group-chevron${closed ? " closed" : ""}`} viewBox="0 0 9 9"><path d="M2 3l2.5 3L7 3"/></svg>;

// Report format: amounts in, labels in print/Excel, plus any report-specific
// switches ({ label, checked, onChange }).
export function FormatPopover({ unit, onUnit, lang, onLang, switches = [], extra = null, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, onClose);
  const units = [[1, "Rupiah"], [1000, "Thousands"], [1000000, "Millions"]];
  const langs = [["id", "Bahasa Indonesia"], ["en", "English"]];
  return (
    <div className="lg-popover tb-settings-pop pl-settings-pop" ref={ref}>
      {switches.length > 0 && <div className="lg-popover-section-lbl">Report format</div>}
      {switches.map((s) => (
        <label key={s.label} className="tb-switch-row">
          <span>{s.label}</span>
          <input type="checkbox" className="tb-switch" checked={s.checked} onChange={(e) => s.onChange(e.target.checked)} />
        </label>
      ))}
      <div className="lg-popover-section-lbl">Amounts in</div>
      <div className="lg-popover-list">
        {units.map(([k, lbl]) => (
          <button key={k} className={`lg-popover-item${unit === k ? " selected" : ""}`} onClick={() => onUnit(k)}>
            <span>{lbl}</span>{unit === k && <Check />}
          </button>
        ))}
      </div>
      <div className="lg-popover-section-lbl">Labels in print and Excel</div>
      <div className="lg-popover-list">
        {langs.map(([k, lbl]) => (
          <button key={k} className={`lg-popover-item${lang === k ? " selected" : ""}`} onClick={() => onLang(k)}>
            <span>{lbl}</span>{lang === k && <Check />}
          </button>
        ))}
      </div>
      {extra}
    </div>
  );
}

export function PrintHead({ title, lines }) {
  return (
    <div className="print-only tb-print-head">
      <div className="tb-print-company">{COMPANY.legalName}</div>
      <div className="tb-print-title">{title}</div>
      {lines.filter(Boolean).map((l) => <div key={l} className="tb-print-period">{l}</div>)}
    </div>
  );
}

export function SignOff({ lang, preparedBy, roles }) {
  const labels = roles || (lang === "id" ? ["Disiapkan oleh", "Diperiksa oleh", "Disetujui oleh"] : ["Prepared by", "Reviewed by", "Approved by"]);
  return (
    <div className="print-only tb-signoff">
      {labels.map((lbl, i) => (
        <div key={lbl} className="tb-sign">
          <div className="tb-sign-lbl">{lbl}</div>
          <div className="tb-sign-line" />
          <div className="tb-sign-name">{(i === 0 && preparedBy) || (lang === "id" ? "Nama" : "Name")}</div>
          <div className="tb-sign-date">{lang === "id" ? "Tanggal:" : "Date:"}</div>
        </div>
      ))}
    </div>
  );
}

// Excel sign-off rows, same three roles as the printed block.
export function signOffRows(lang, preparedBy) {
  const sign = lang === "id" ? ["Disiapkan oleh", "Diperiksa oleh", "Disetujui oleh", "Tanggal:", "Nama"] : ["Prepared by", "Reviewed by", "Approved by", "Date:", "Name"];
  return [[], [],
    ["", { v: sign[0], s: "bold" }, { v: sign[1], s: "bold" }, { v: sign[2], s: "bold" }],
    [], ["", preparedBy || sign[4], sign[4], sign[4]],
    ["", { v: sign[3], s: "muted" }, { v: sign[3], s: "muted" }, { v: sign[3], s: "muted" }]];
}
