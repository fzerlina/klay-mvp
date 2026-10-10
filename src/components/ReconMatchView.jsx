// To match — the bank statement and Klay's books side by side.
//
// Left: statement lines nothing has been suggested for. Right: what Klay holds
// that no line has been reconciled to — recorded payments and receipts on this
// account, journals through it, and open invoices. Tick lines on both sides
// that belong together; the bar under the page adds them up and reconciles
// once they balance. Any number on either side, because one transfer often
// settles several bills, and one bill is sometimes paid in two transfers.
//
// The right side follows the left: once a line is ticked it shows only records
// in the same direction, with the ones that look like it first — same name
// read from the bank text, then same amount, then nearest date. A reading aid;
// nothing is ticked for you.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { COA } from "../data/seed/coa";
import { dayDiff } from "../lib/clock";
import { nameAgrees, AR_TOLERANCE } from "../lib/bankMatching";
import { DIRECTIONS } from "../lib/manualMatch";
import { CATEGORIES, CATEGORY_FILTERS, categoryOfRecord } from "../lib/reconCategory";

// A small segmented control. `label` names which side it filters.
export function Segmented({ label, options, value, onChange }) {
  return (
    <div className="recon-seg">
      {label && <span className="recon-seg-lbl">{label}</span>}
      <div className="recon-dir" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.k} type="button" className={`recon-dir-btn${value === o.k ? " on" : ""}`} aria-pressed={value === o.k} title={o.title} onClick={() => onChange(o.k)}>
            {o.lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

// AP / AR / Bank / Other — what Klay knows a line or record to be.
export function CategoryChip({ cat }) {
  const c = CATEGORIES[cat];
  if (!c) return null;
  return <span className={`recon-cat ${c.k}`} title={c.title}>{c.lbl}</span>;
}

// Why a line can be set aside without a Klay record. Each is a statement
// artefact rather than a business event — anything that moved money for the
// company belongs in the books, not in Excluded.
export const EXCLUDE_REASONS = [
  { k: "duplicate", lbl: "Printed twice on the statement" },
  { k: "reversed", lbl: "Reversed by the bank" },
  { k: "not-ours", lbl: "Not this company’s transaction" },
];

// "Exclude", then the reason. `dark` for the black bar, where it opens upward.
export function ExcludeMenu({ onPick, dark = false, label = "Exclude" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <span className={`recon-excl${dark ? " dark" : ""}`} ref={ref}>
      <button type="button" className={dark ? "lg-footer-bulk-btn" : "recon-crow-later"} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <span className="recon-excl-pop" role="menu">
          <span className="recon-excl-head">Exclude because it was…</span>
          {EXCLUDE_REASONS.map((r) => (
            <button key={r.k} type="button" role="menuitem" className="recon-excl-item" onClick={() => { setOpen(false); onPick(r.k); }}>
              {r.lbl}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => (iso ? `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]}` : "—");
const fmtRp = (n) => Math.abs(n || 0).toLocaleString("id-ID", { maximumFractionDigits: 0 });
export const signedRp = (n) => `${n < 0 ? "−" : ""}Rp ${fmtRp(n)}`;
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const accountName = (code) => COA.find((a) => a.code === code)?.name || code;

// What Klay had proposed for a line before it was set aside.
const suggestedRef = (l) => l.suggestion?.ref || l.suggestion?.invoiceId || l.billId || "";

const KIND_LABEL = { ap_payment: "Payment", je: "Journal", invoice: "Open invoice" };

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="rm-search">
      <svg viewBox="0 0 14 14" aria-hidden><circle cx="6" cy="6" r="4.2" /><line x1="9.2" y1="9.2" x2="12.5" y2="12.5" /></svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onChange(""); }}
        placeholder={placeholder}
      />
    </div>
  );
}

function Check({ checked, disabled, onChange, label }) {
  return <input type="checkbox" className="rm-check" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />;
}

export function MatchPanels({ lines, candidates, spokenFor = 0, dir, onDir, cat = "all", onCat, selLines, selRecords, onToggleLine, onToggleRecord, onSetLines, onRestore }) {
  const [qBank, setQBank] = useState("");
  const [qKlay, setQKlay] = useState("");

  const pickedLines = lines.filter((l) => selLines.has(l.id));
  // The direction the selection has committed to, or 0 for none yet.
  const sign = pickedLines.length ? Math.sign(pickedLines[0].amount) : 0;
  const bankTotal = pickedLines.reduce((s, l) => s + l.amount, 0);

  const bankRows = useMemo(() => {
    const q = qBank.trim().toLowerCase();
    return lines
      .filter((l) => !q || [l.description, l.counterparty, String(Math.abs(l.amount))].some((v) => (v || "").toLowerCase().includes(q)))
      .sort(byDateDesc);
  }, [lines, qBank]);

  // Open invoices are not movements on this account — every unpaid invoice in
  // the company is one — so they are not listed wholesale. They appear when a
  // ticked receipt points at them (the customer it names, or an amount within
  // range), when searched for, or once ticked. Everything else is book records.
  const { klayRows, hiddenInvoices } = useMemo(() => {
    const q = qKlay.trim().toLowerCase();
    const parties = pickedLines.map((l) => l.counterparty).filter(Boolean);
    const first = pickedLines[0];
    const nearTotal = (r) => !!first && r.amount !== bankTotal && Math.abs(bankTotal - r.amount) <= Math.round(Math.abs(r.amount) * AR_TOLERANCE);
    const named = (r) => parties.some((p) => nameAgrees(p, r.counterparty));
    // The Klay pane filters by what a record is, not which way it moved —
    // that is the bank pane's filter. A ticked record always stays in view.
    const pool = candidates
      .filter((r) => cat === "all" || selRecords.has(r.id) || categoryOfRecord(r) === cat)
      .filter((r) => !sign || Math.sign(r.amount) === sign);
    // Choosing AR on the Klay pane is asking for them, so it lists them all.
    const surfaced = (r) => r.kind !== "invoice" || cat === "ar" || selRecords.has(r.id) || !!q || (sign > 0 && (named(r) || nearTotal(r)));
    const rows = pool
      .filter(surfaced)
      .filter((r) => selRecords.has(r.id) || !q ||
        [r.ref, r.billId, r.counterparty, r.label, String(Math.abs(r.amount))].some((v) => (v || "").toLowerCase().includes(q)))
      .map((r) => ({
        r,
        named: named(r),
        exact: !!first && r.amount === bankTotal,
        near: r.kind === "invoice" && nearTotal(r),
        gap: first ? Math.abs(dayDiff(first.date, r.date)) : 0,
      }));
    if (first) rows.sort((a, b) => Number(b.named) - Number(a.named) || Number(b.exact || b.near) - Number(a.exact || a.near) || a.gap - b.gap);
    else rows.sort((a, b) => byDateDesc(a.r, b.r));
    return { klayRows: rows, hiddenInvoices: pool.filter((r) => !surfaced(r)).length };
  }, [candidates, cat, sign, selRecords, qKlay, bankTotal, lines, selLines]);

  const selectable = bankRows.filter((l) => !sign || Math.sign(l.amount) === sign);
  const allOn = selectable.length > 0 && selectable.every((l) => selLines.has(l.id));
  // Select-all only makes sense in one direction.
  const mixed = !sign && new Set(selectable.map((l) => Math.sign(l.amount))).size > 1;

  const pickedRecords = candidates.filter((r) => selRecords.has(r.id));

  return (
    <>
    <div className="rm-split">
      <section className="rm-pane bank" aria-label="Bank statement lines">
        <header className="rm-pane-head">
          <span className="rm-pane-kicker">Bank statement</span>
          <span className="rm-pane-count">{lines.length} to match</span>
        </header>
        <div className="rm-tools">
          <SearchBox value={qBank} onChange={setQBank} placeholder="Search description or amount" />
          <Segmented options={DIRECTIONS} value={dir} onChange={onDir} />
        </div>
        <div className="rm-table" role="table">
          <div className="rm-row rm-thead" role="row">
            <span>
              <Check
                checked={allOn}
                disabled={mixed || selectable.length === 0}
                onChange={() => onSetLines(allOn ? [] : selectable.map((l) => l.id))}
                label="Select all bank lines"
              />
            </span>
            <span role="columnheader">Date ↓</span>
            <span role="columnheader">Bank description</span>
            <span role="columnheader" className="num">Amount</span>
          </div>
          <div className="rm-body">
            {bankRows.length === 0 ? (
              <div className="rm-empty">{qBank ? "No bank line matches that search." : "Every line on the statement has a suggestion or a decision."}</div>
            ) : bankRows.map((l) => {
              const on = selLines.has(l.id);
              const off = !!sign && Math.sign(l.amount) !== sign;
              return (
                <label key={l.id} className={`rm-row${on ? " on" : ""}${off ? " off" : ""}`} role="row" title={off ? "The selection is the other direction" : l.explanation}>
                  <span><Check checked={on} disabled={off} onChange={() => onToggleLine(l.id)} label={`Select ${l.description}`} /></span>
                  <span className="rm-date">{shortDate(l.date)}</span>
                  <span className="rm-main">
                    <span className="rm-desc">{l.description}</span>
                    {l.manual && (
                      <span className="rm-was">
                        {suggestedRef(l) ? <>Klay suggested {suggestedRef(l)} · </> : null}
                        <button type="button" className="rm-was-btn" onClick={(e) => { e.preventDefault(); onRestore?.(l); }}>
                          Back to Need confirmation
                        </button>
                      </span>
                    )}
                  </span>
                  <span className={`rm-amt${l.amount > 0 ? " in" : ""}`}>{signedRp(l.amount)}</span>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <div className="rm-divider" aria-hidden />

      <section className="rm-pane klay" aria-label="Klay transactions">
        <header className="rm-pane-head">
          <span className="rm-pane-kicker">Klay transactions</span>
          <span className="rm-pane-count">
            {klayRows.length} {sign < 0 ? "money out" : sign > 0 ? "money in" : "not matched"}
          </span>
        </header>
        <div className="rm-tools">
          <SearchBox value={qKlay} onChange={setQKlay} placeholder="Search vendor, customer, reference or amount" />
          <Segmented options={CATEGORY_FILTERS} value={cat} onChange={onCat} />
        </div>
        <div className="rm-table" role="table">
          <div className="rm-row rm-thead" role="row">
            <span />
            <span role="columnheader">Date ↓</span>
            <span role="columnheader">Transaction</span>
            <span role="columnheader" className="num">Amount</span>
          </div>
          <div className="rm-body">
            {klayRows.length === 0 && (
              <div className="rm-empty">
                {qKlay
                  ? "Nothing in Klay matches that search."
                  : cat !== "all"
                    ? `No ${CATEGORIES[cat].lbl} transaction left to match${sign ? " in this direction" : ""}.`
                  : sign < 0
                    ? "No payment left to match on this account. If it was paid outside Klay, record the payment from its bill first."
                    : sign > 0
                      ? "No open invoice names this customer or comes within 3% of the amount. Search for one by number, customer or amount."
                      : "Nothing left in Klay to match in this direction."}
              </div>
            )}
            {klayRows.map(({ r, named, exact, near, gap }) => {
              const on = selRecords.has(r.id);
              return (
                <label key={r.id} className={`rm-row${on ? " on" : ""}`} role="row">
                  <span><Check checked={on} onChange={() => onToggleRecord(r.id)} label={`Select ${r.ref}`} /></span>
                  <span className="rm-date">{shortDate(r.date)}</span>
                  <span className="rm-main">
                    <span className="rm-ref">
                      <CategoryChip cat={categoryOfRecord(r)} />
                      {r.ref}{r.billId && r.billId !== r.ref ? <span className="rm-ref-sub"> · {r.billId}</span> : null}
                    </span>
                    <span className="rm-sub">{KIND_LABEL[r.kind] || "Record"} · {r.counterparty || r.label}</span>
                    {r.original != null && (
                      <span className="rm-part">{r.kind === "invoice" ? "Part-paid" : "Partly matched"} · {signedRp(r.amount).replace("−", "")} left of {signedRp(r.original).replace("−", "")}</span>
                    )}
                    {(named || exact || near || gap > 0) && pickedLines.length > 0 && (
                      <span className="rm-hints">
                        {named && <span className="recon-tag">Same name</span>}
                        {exact && <span className="recon-tag">Same amount</span>}
                        {near && <span className="recon-tag">Within 3%</span>}
                        {gap > 0 && <span className="rm-gap">{gap}d apart</span>}
                      </span>
                    )}
                  </span>
                  <span className={`rm-amt${r.amount > 0 ? " in" : ""}`}>{signedRp(r.amount)}</span>
                </label>
              );
            })}
            {!qKlay && (hiddenInvoices > 0 || spokenFor > 0) && (
              <div className="rm-note">
                {hiddenInvoices > 0 && (
                  <span>
                    {hiddenInvoices} open invoice{hiddenInvoices === 1 ? "" : "s"} not listed — choose AR to see them all, tick a receipt to see that customer's, or search by number, customer or amount.
                  </span>
                )}
                {spokenFor > 0 && (
                  <span>{spokenFor} more {spokenFor === 1 ? "is" : "are"} already suggested for a bank line in Need confirmation.</span>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>

    {/* What is ticked, held under the side it came from. Pinned to the bottom
        of the view so it sits on the black bar, on the same grid as the tables
        above — the amounts line up with the Amount columns. */}
    <div className="rm-tray" aria-label="Selected">
      <TraySide
        title="Bank statement"
        total={bankTotal}
        rows={pickedLines.map((l) => ({ id: l.id, date: l.date, text: l.description, amount: l.amount }))}
        empty="No bank line ticked"
        onRemove={onToggleLine}
      />
      <div className="rm-tray-divider" aria-hidden />
      <TraySide
        title="Klay transactions"
        total={pickedRecords.reduce((s, r) => s + r.amount, 0)}
        rows={pickedRecords.map((r) => ({ id: r.id, date: r.date, text: `${r.ref} · ${r.counterparty || r.label}`, amount: r.amount }))}
        empty="No Klay transaction ticked"
        onRemove={onToggleRecord}
      />
    </div>
    </>
  );
}

function TraySide({ title, total, rows, empty, onRemove }) {
  return (
    <div className="rm-tray-side">
      <div className="rm-row rm-tray-head">
        <span />
        <span className="rm-tray-title">{title}<span className="rm-bar-n">{rows.length}</span></span>
        <span className="rm-tray-total">{rows.length ? signedRp(total) : "—"}</span>
      </div>
      <div className="rm-tray-list">
        {rows.length === 0 ? (
          <div className="rm-tray-empty">{empty}</div>
        ) : rows.map((r) => (
          <div key={r.id} className="rm-row rm-tray-row">
            <button type="button" className="rm-tray-x" onClick={() => onRemove(r.id)} aria-label={`Untick ${r.text}`}>×</button>
            <span className="rm-date">{shortDate(r.date)}</span>
            <span className="rm-tray-text">{r.text}</span>
            <span className="rm-amt">{signedRp(r.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// The bar under the page while To match is open: the difference between the
// two sides and the one button. Each side's own total sits in the tray above,
// under its column.
export function MatchBar({ lineCount, recordCount, balance, diffAccounts, diffAcct, onDiffAcct, mode = "open", onMode, onReconcile, onExclude, onClear, preview = null, canMatch = true }) {
  const { left, inRange, gap, short, booking, leaving, balanced, idle, openOn } = balance;
  const any = lineCount + recordCount > 0;
  const gapRp = signedRp(Math.abs(left)).replace("−", "");
  const picker = diffAccounts.length === 0 ? (
    <span className="rm-bar-status warn"><Link to="/bank-recon-settings">Add a difference account</Link> to book it</span>
  ) : (
    <label className="rm-bar-diff">
      <span className={booking ? "" : "warn"}>{booking ? "Book to" : "Book it to"}</span>
      <select value={diffAcct} onChange={(e) => onDiffAcct(e.target.value)}>
        <option value="">Choose an account…</option>
        {diffAccounts.map((code) => <option key={code} value={code}>{code} · {accountName(code)}</option>)}
      </select>
    </label>
  );
  let status;
  if (!lineCount || !recordCount) {
    status = <span className="rm-bar-hint">{any ? `Now tick the ${lineCount ? "Klay transactions" : "bank lines"} it belongs with` : "Tick lines on both sides that belong together"}</span>;
  } else if (idle.length) {
    status = <span className="rm-bar-status warn">The bank amount runs out before {idle[0].ref} — untick it</span>;
  } else if (left === 0) {
    status = <span className="rm-bar-status ok"><CheckIcon /> Balanced</span>;
  } else if (inRange) {
    status = <span className="rm-bar-status ok"><CheckIcon /> Within {Math.round(AR_TOLERANCE * 100)}% of the invoice{recordCount > 1 ? "s" : ""}</span>;
  } else if (short) {
    // The bank paid less than Klay holds: by default the rest stays open on
    // the Klay item — nothing is unexplained yet, only unfinished.
    status = (
      <>
        <span className="rm-bar-mode" role="group" aria-label="What to do with the shortfall">
          <button type="button" className={mode === "open" ? "on" : ""} onClick={() => onMode("open")}>Leave open</button>
          <button type="button" className={mode === "book" ? "on" : ""} onClick={() => onMode("book")}>Book it</button>
        </span>
        {leaving
          ? <span className="rm-bar-status ok"><CheckIcon /> {gapRp} stays open on {openOn?.ref}</span>
          : picker}
      </>
    );
  } else if (gap) {
    // The bank holds more than the Klay items: that cash has to land somewhere.
    status = <><span className="rm-bar-status warn">{gapRp} more on the bank than in Klay</span>{picker}</>;
  }

  return (
    <div className="lg-footer rm-bar">
      <div className="rm-bar-figs">
        <span className="rm-bar-fig">
          <span className="lg-footer-lbl">Difference</span>
          <span className={`lg-footer-total${left !== 0 && recordCount && !inRange ? " rm-bar-off" : ""}`}>{signedRp(lineCount || recordCount ? left : 0)}</span>
        </span>
        {status}
        {/* What Match will draft — receipts, a booked difference — before it does. */}
        {preview && (
          <span className="rm-bar-draft" title={preview.map((l) => `${l.debit ? "Dr" : "Cr"} ${l.account_code} ${l.account_name} ${signedRp(l.debit || l.credit)}`).join("\n")}>
            <span className="lg-footer-lbl">Drafts</span>
            {preview.map((l, i) => <span key={i} className="rm-bar-draft-l">{l.debit ? "Dr" : "Cr"} {l.account_code} <b>{signedRp(l.debit || l.credit).replace("Rp ", "")}</b></span>)}
          </span>
        )}
      </div>
      <div className="lg-footer-right">
        {lineCount > 0 && canMatch && <ExcludeMenu dark onPick={onExclude} />}
        {any && <button type="button" className="lg-footer-bulk-btn" onClick={onClear}>Clear</button>}
        {/* Matching never posts: when the match needs a journal, it drafts one
            for Review & post journals, and the button says so. */}
        <button type="button" className="rm-bar-go" disabled={!lineCount || !balanced || !canMatch}
          title={canMatch ? undefined : "Matching needs the Reconcile bank permission"} onClick={onReconcile}>
          {preview ? "Match & draft journal" : "Match"}{lineCount + recordCount > 2 ? ` ${lineCount} ↔ ${recordCount}` : ""}
        </button>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="5" /><polyline points="3.6 6.2 5.3 7.8 8.4 4.6" />
    </svg>
  );
}
