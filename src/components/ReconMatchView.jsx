// To match — the bank statement and Klay's books side by side.
//
// Left: statement lines nothing has been suggested for. Right: the cash
// journals on this account no line has been matched to — recorded payments and
// receipts, and posted journals through it. Nothing else: an open invoice or
// bill is not cash until its receipt or payment is recorded. Tick lines on
// both sides that belong together; the bar under the page adds them up and
// reconciles once they balance. Any number on either side, because one transfer often
// settles several bills, and one bill is sometimes paid in two transfers.
//
// The right side follows the left: once a line is ticked it shows only records
// in the same direction, with the ones that look like it first — same name
// read from the bank text, then same amount, then nearest date. A reading aid;
// nothing is ticked for you.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { COA } from "../data/seed/coa";
import { dayDiff } from "../lib/clock";
import { nameAgrees } from "../lib/bankMatching";
import { DIRECTIONS } from "../lib/manualMatch";

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

// "Mark for later" parks a line without deciding it — it still holds the
// account open. `dark` for the black bar.
export function LaterButton({ onClick, dark = false }) {
  return (
    <button type="button" className={dark ? "lg-footer-bulk-btn" : "recon-crow-later"} onClick={onClick}>
      Mark for later
    </button>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso) => (iso ? `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]}` : "—");
const fmtRp = (n) => Math.abs(n || 0).toLocaleString("id-ID", { maximumFractionDigits: 0 });
export const signedRp = (n) => `${n < 0 ? "−" : ""}Rp ${fmtRp(n)}`;
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
const accountName = (code) => COA.find((a) => a.code === code)?.name || code;

// What Klay had proposed for a line before it was set aside.
const suggestedRef = (l) => l.suggestion?.ref || l.billId || "";

const KIND_LABEL = { ap_payment: "Payment", je: "Journal" };

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

export function MatchPanels({ lines, candidates, spokenFor = 0, dir, onDir, canQuickDraft = true, onQuickDraft, selLines, selRecords, onToggleLine, onToggleRecord, onSetLines, onRestore }) {
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

  const klayRows = useMemo(() => {
    const q = qKlay.trim().toLowerCase();
    const parties = pickedLines.map((l) => l.counterparty).filter(Boolean);
    const first = pickedLines[0];
    const named = (r) => parties.some((p) => nameAgrees(p, r.counterparty));
    // The Klay pane filters by what a record is, not which way it moved —
    // that is the bank pane's filter. A ticked record always stays in view.
    const pool = candidates
      .filter((r) => !sign || Math.sign(r.amount) === sign);
    const rows = pool
      .filter((r) => selRecords.has(r.id) || !q ||
        [r.ref, r.billId, r.counterparty, r.label, String(Math.abs(r.amount))].some((v) => (v || "").toLowerCase().includes(q)))
      .map((r) => ({
        r,
        named: named(r),
        exact: !!first && r.amount === bankTotal,
        gap: first ? Math.abs(dayDiff(first.date, r.date)) : 0,
      }));
    if (first) rows.sort((a, b) => Number(b.named) - Number(a.named) || Number(b.exact) - Number(a.exact) || a.gap - b.gap);
    else rows.sort((a, b) => byDateDesc(a.r, b.r));
    return rows;
  }, [candidates, sign, selRecords, qKlay, bankTotal, lines, selLines]);

  const selectable = bankRows.filter((l) => !sign || Math.sign(l.amount) === sign);
  const allOn = selectable.length > 0 && selectable.every((l) => selLines.has(l.id));
  // Select-all only makes sense in one direction.
  const mixed = !sign && new Set(selectable.map((l) => Math.sign(l.amount))).size > 1;

  const pickedRecords = candidates.filter((r) => selRecords.has(r.id));
  // Quick draft writes the cash journal for one bank line at a time.
  const draftLine = pickedLines.length === 1 ? pickedLines[0] : null;
  const draftWhy = !canQuickDraft ? "Needs the Reconcile bank permission"
    : pickedLines.length === 0 ? "Tick the bank line it's for first"
    : pickedLines.length > 1 ? "Tick one bank line — a quick draft is for one line"
    : `Post the cash journal for the ${shortDate(draftLine.date)} line`;

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
                          Back to To reconcile
                        </button>
                      </span>
                    )}
                    {l.reversed && (
                      <span className="rm-was">{l.reversed.je} reversed in the GL by {l.reversed.reversedBy} · match it again</span>
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
          <button type="button" className="rm-quick" disabled={!draftLine || !canQuickDraft} title={draftWhy} onClick={() => draftLine && onQuickDraft?.(draftLine)}>
            + Quick draft
          </button>
        </header>
        {/* What Klay read into the ticked line, said where its counterpart is
            looked for: a debit that is a bill less its PPh 23, never recorded. */}
        {draftLine?.detector === "PPH_WITHHOLDING" && !draftLine.manual && (
          <div className="rm-banner" role="status">
            <span>
              Looks like <strong>{draftLine.billId}</strong>{draftLine.vendorName ? <> ({draftLine.vendorName})</> : null} less PPh 23 —
              the payment isn&rsquo;t recorded in Klay.
            </span>
            <span className="rm-banner-acts">
              {canQuickDraft && <button type="button" className="rm-was-btn" onClick={() => onQuickDraft?.(draftLine)}>Quick draft it</button>}
              <Link to="/payments" className="rm-was-btn">Record it in Payment</Link>
            </span>
          </div>
        )}
        <div className="rm-tools">
          <SearchBox value={qKlay} onChange={setQKlay} placeholder="Search vendor, customer, reference or amount" />
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
                  : sign
                    ? <>No cash journal left to match on this account.{draftLine && canQuickDraft ? <> <button type="button" className="rm-was-btn" onClick={() => onQuickDraft?.(draftLine)}>Quick draft it</button></> : null}</>
                    : "Nothing left in Klay to match in this direction."}
              </div>
            )}
            {klayRows.map(({ r, named, exact, gap }) => {
              const on = selRecords.has(r.id);
              return (
                <label key={r.id} className={`rm-row${on ? " on" : ""}`} role="row">
                  <span><Check checked={on} onChange={() => onToggleRecord(r.id)} label={`Select ${r.ref}`} /></span>
                  <span className="rm-date">{shortDate(r.date)}</span>
                  <span className="rm-main">
                    <span className="rm-ref">
                      {r.ref}{r.billId && r.billId !== r.ref ? <span className="rm-ref-sub"> · {r.billId}</span> : null}
                    </span>
                    <span className="rm-sub">{KIND_LABEL[r.kind] || "Record"} · {r.counterparty || r.label}</span>
                    {r.original != null && (
                      <span className="rm-part">Partly matched · {signedRp(r.amount).replace("−", "")} left of {signedRp(r.original).replace("−", "")}</span>
                    )}
                    {(named || exact || gap > 0) && pickedLines.length > 0 && (
                      <span className="rm-hints">
                        {named && <span className="recon-tag">Same name</span>}
                        {exact && <span className="recon-tag">Same amount</span>}
                        {gap > 0 && <span className="rm-gap">{gap}d apart</span>}
                      </span>
                    )}
                  </span>
                  <span className={`rm-amt${r.amount > 0 ? " in" : ""}`}>{signedRp(r.amount)}</span>
                </label>
              );
            })}
            {!qKlay && spokenFor > 0 && (
              <div className="rm-note">
                <span>{spokenFor} more {spokenFor === 1 ? "is" : "are"} already suggested for a bank line in To reconcile.</span>
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
// `preview` lists the journals Reconcile would post — a booked
// difference — shown before it does. `canPost` is false when this person
// can't post them.
export function MatchBar({ lineCount, recordCount, balance, diffAccounts, diffAcct, onDiffAcct, mode = "open", onMode, onReconcile, onLater, onClear, preview = null, canMatch = true, canPost = true }) {
  const { left, gap, short, booking, leaving, balanced, idle, openOn } = balance;
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
          <span className={`lg-footer-total${left !== 0 && recordCount ? " rm-bar-off" : ""}`}>{signedRp(lineCount || recordCount ? left : 0)}</span>
        </span>
        {status}
        {/* Every journal Reconcile posts, before it does: a booked
            difference, posted with the match. */}
        {preview && preview.map((j) => (
          <span key={j.jeNumber} className="rm-bar-draft" title={j.lines.map((l) => `${l.debit ? "Dr" : "Cr"} ${l.account_code} ${l.account_name} ${signedRp(l.debit || l.credit)}`).join("\n")}>
            <span className="lg-footer-lbl">Posts {j.jeNumber}</span>
            {j.lines.map((l, i) => <span key={i} className="rm-bar-draft-l">{l.debit ? "Dr" : "Cr"} {l.account_code} <b>{signedRp(l.debit || l.credit).replace("Rp ", "")}</b></span>)}
          </span>
        ))}
      </div>
      <div className="lg-footer-right">
        {lineCount > 0 && canMatch && <LaterButton dark onClick={onLater} />}
        {any && <button type="button" className="lg-footer-bulk-btn" onClick={onClear}>Clear</button>}
        <button type="button" className="rm-bar-go" disabled={!lineCount || !balanced || !canMatch || (!!preview && !canPost)}
          title={!canMatch || (preview && !canPost) ? "Needs the Reconcile bank permission" : undefined}
          onClick={onReconcile}>
          Reconcile{lineCount + recordCount > 2 ? ` ${lineCount} ↔ ${recordCount}` : ""}
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
