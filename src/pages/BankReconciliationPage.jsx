// Bank Reconciliation — every statement line, reconciled by a person.
//
// Nothing is reconciled automatically. For each line the engine
// (lib/bankMatching.js) either suggests what it is — a recorded payment or
// receipt of the same amount, an open invoice within range, a bank fee or
// interest with its journal already drafted — or says it found nothing. A
// person confirms the suggestion, reconciles the line by hand, or parks it.
//
// Rules kept deliberately:
//
//   No confidence scores. Every suggestion carries a sentence built from the
//   record's own numbers. "2% under INV005's subtotal" is checkable; "93%" is
//   an invitation to accept something you have not read.
//
//   Reconciliation ends. There is a finish line, it is disabled until every
//   line is decided, and crossing it is what closes Gate 4 on the close board.

import { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from "react";
import "./modules.css";
import "./invoices-ledger.css";
import "./close.css";
import "./bank-reconciliation.css";
import { COMPANY_BANK_ACCOUNTS, bankAccountById, maskOf } from "../data/seed/bankAccounts";
import { periodLabel, statementLabel, statementFor, nextStatementThrough, coverageOf, CURRENT_PERIOD } from "../data/seed/bankStatement";
import { PERIODS } from "../lib/bankReconHistory";
import { EXCEPTION_TYPES, isOpen, countOf, paysInFull, subtotalOf } from "../lib/bankMatching";
import { runReconciliation, stateOf, reconcilable } from "../lib/bankRecon";
import { draftEntry, draftProblem, postedEntry, postedNote, matchEntry } from "../lib/reconJournal";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePayments } from "../state/PaymentsContext";
import { useInvoices } from "../state/InvoicesContext";
import { useBankRecon } from "../state/BankReconContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { MatchPanels, MatchBar, CategoryChip, ExcludeMenu, EXCLUDE_REASONS, Segmented } from "../components/ReconMatchView";
import { categoryOfLine } from "../lib/reconCategory";
import { matchBalance, allocate, DIRECTIONS, inDirection } from "../lib/manualMatch";
import ReconJournalModal from "../components/ReconJournalModal";
import { BILLS } from "../data/seed/bills";
import { defaultBreakdown, breakdownTotal } from "../lib/paymentBreakdown";
import { useBills } from "../state/BillsContext";
import { paymentJournalLines } from "../lib/paymentJournal";
import { TODAY } from "../lib/clock";

const TODAY_ISO = TODAY.toISOString().slice(0, 10);

function SparkleIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5l1.3 3.2L11.5 6l-3.2 1L7 10l-1.3-3L2.5 6l3.2-1.3L7 1.5z" />
      <path d="M11.5 9.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2z" />
    </svg>
  );
}

const fmtRp = (n) => (n == null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 0 }));

function fmtAmt(n) {
  if (n == null) return "—";
  return `${n < 0 ? "−" : ""}Rp ${fmtRp(Math.abs(n))}`;
}

// Short money, the same convention as the payment module: "Rp 312,4 jt".
function fmtShort(n) {
  const a = Math.abs(n || 0);
  if (a >= 1e9) return `Rp ${(a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e6) return `Rp ${(a / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `Rp ${a.toLocaleString("id-ID")}`;
}

// What is still open on a run, in rupiah. Money in and money out are kept
// apart and summed as absolute amounts: netting them would let a Rp 50M receipt
// and a Rp 50M payment, neither reconciled, read as nothing left to do.
function openMoney(exceptions = []) {
  let moneyIn = 0, moneyOut = 0;
  for (const e of exceptions) {
    if (!isOpen(e)) continue;
    if (e.amount > 0) moneyIn += e.amount; else moneyOut -= e.amount;
  }
  return { moneyIn, moneyOut, total: moneyIn + moneyOut };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (period) => `${MONTH_NAMES[parseInt(period.slice(5, 7), 10) - 1]} ${period.slice(0, 4)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDateShort(iso) {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
}
const fmtIsoLong = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
};

// ── Tabs ─────────────────────────────────────────────────────────────────────
//
// Each tab is a stage, and every bank line is in exactly one of them, left to
// right in the order of the work:
//
//   Need confirmation   Klay suggests which record or invoice the line is,
//                       shown bank side | Klay side
//   To match            Klay has no suggestion; a person pairs the line with
//                       Klay transactions in a side-by-side view
//   Review & post       waiting on a journal: a bank fee or interest, or a
//     journals          match that drafted one (a receipt, a difference). One
//                       row per journal — a receipt can cover several lines
//   Reconciled          done: matched to what the books already hold, or its
//                       journal posted. A posted journal is never undone here;
//                       a wrong one is reversed in the GL, and the line comes
//                       back to Review & post journals
//   Excluded            set aside as not needing a Klay record: a line the
//                       statement printed twice, a transfer the bank reversed
//
// An account is reconciled once every line is Reconciled or Excluded.

// The Klay type filter lives only in To match's Klay pane.
const NO_FILTER = { dir: "all", cat: "all", search: "" };
// No Money in/out chips: Reconciled is a record read top to bottom, and Need
// confirmation is worked strongest-first with its search box.
const UNFILTERED_TABS = new Set(["reconciled", "confirm"]);

const JOURNAL_DETECTORS = new Set(["FEE_PATTERN", "INTEREST_CREDIT", "INTEREST_TAX"]);
const CONFIRM_DETECTORS = new Set(["EXACT_AMOUNT", "INVOICE_EXACT", "INVOICE_RANGE", "PPH_WITHHOLDING", ...JOURNAL_DETECTORS]);

function tabOf(ex) {
  if (ex.resolution?.action === "exclude") return "excluded";
  // Matched, waiting on its journal: shown as that journal's row.
  if (ex.resolution?.pendingJournal) return "journals";
  if (ex.resolution) return "reconciled";
  // A fee or interest line whose posted journal was reversed in the GL.
  if (ex.reopened) return "journals";
  // Its suggestion was set aside to match it by hand.
  if (ex.manual) return "tomatch";
  if (JOURNAL_DETECTORS.has(ex.detector)) return "journals";
  return CONFIRM_DETECTORS.has(ex.detector) ? "confirm" : "tomatch";
}

const TABS = [
  { k: "confirm",      lbl: "Need confirmation" },
  { k: "tomatch",      lbl: "To match" },
  { k: "journals",     lbl: "Review & post journals" },
  { k: "reconciled",   lbl: "Reconciled" },
  { k: "excluded",     lbl: "Excluded" },
];

// Need confirmation is grouped by how strong the match is (STRENGTHS in
// lib/bankMatching.js), strongest first. Every line still needs a yes; the
// grouping says where to look hardest. Groups are not named; each row's
// basis line says why it sits where it does. Strong matches can be confirmed in
// one tap from beside the search bar.
const CONFIRM_SECTIONS = ["strong", "likely", "weak"].map((k) => ({ k, test: (e) => (e.strength || "weak") === k }));

// Review & post journals: everything waiting to be posted, by where it came from.
// Bank charges and interest are drafted when the statement loads; the rest by
// a match (a customer receipt, a difference somebody chose to book).
const JOURNAL_SECTIONS = [
  { k: "bank",  lbl: "Bank charges & interest", test: (e) => !e.isMatchDraft },
  { k: "match", lbl: "From matches",            test: (e) => !!e.isMatchDraft },
];

// ── Who may do what ──────────────────────────────────────────────────────────
//
// Two capabilities, two steps. Matching needs bank.reconcile; posting a
// journal to the ledger needs gl.post. Somebody who holds both does both.
// Editing a draft is preparation, so either is enough for it.
// `postBlock(row)` says why this person can't post this particular journal, or
// null: the capability, a payment's approval right, and segregation of duties.
const Perm = createContext({ canMatch: true, canPost: true, postBlock: () => null });
const NEEDS = { "post-journal": "post", reconcile: "match", "draft-payment": "match", "manual-match": "match", undo: "match", "restore-excluded": "match", restore: "match" };
const WHY_NOT = {
  post: "Posting needs the Post to ledger permission",
  match: "Matching needs the Reconcile bank permission",
};
const allowed = (perm, a) => {
  const need = NEEDS[a];
  return !need || (need === "post" ? perm.canPost : perm.canMatch);
};

// ── Account card ─────────────────────────────────────────────────────────────

// The selected card is the page's header — there is no second strip
// repeating it above the table.
// Name, number, state, the bank's closing balance and the statement it holds.
// No progress figures — the state pill says whether there is work left.
function AccountCard({ run, selected, onSelect }) {
  const { account, statement } = run;
  const scoped = statement.loaded && reconcilable(account);
  // "Apr 1–20" — the month menu above already says the year.
  const span = (run.statementLabel || "").replace(/, \d{4}$/, "");

  return (
    <button
      type="button"
      className={`bank-card${selected ? " selected" : ""}${!scoped && !statement.awaitingUpload ? " empty" : ""}${statement.awaitingUpload ? " awaiting" : ""}`}
      onClick={() => onSelect(account.id)}
      aria-pressed={selected}
    >
      <div className="bank-card-head">
        <div className="bank-card-logo" style={{ background: account.bankColor }}>{account.bank.slice(0, 1)}</div>
        <div className="bank-card-id">
          <div className="bank-card-title">{account.name}</div>
          <div className="bank-card-no">{maskOf(account)}</div>
        </div>
        {(scoped || statement.awaitingUpload) && <span className={`recon-state-pill ${run.state.tone}`}>{run.state.label}</span>}
      </div>
      <div className="bank-card-amt">Rp {fmtRp(statement.closingBalance)}</div>
      {scoped ? (
        <div className="bank-card-stmt">{span} · {statement.lines.length} lines</div>
      ) : statement.awaitingUpload ? (
        <div className="bank-card-stmt">Nothing uploaded for {monthName(statement.period).split(" ")[0]}</div>
      ) : (
        <div className="bank-card-meta">{reconcilable(account) ? "No statement loaded" : "No GL account mapped"}</div>
      )}
    </button>
  );
}

const pillLabel = ({ counts, state }) =>
  counts.blocking > 0 ? `${counts.blocking} to resolve` : counts.open > 0 ? `${counts.open} to confirm` : state.label;

// ── The table ────────────────────────────────────────────────────────────────
//
// One row per bank statement line, in six columns:
//
//   Date · Bank statement line · Journal no. · Matching result · Amount · Actions
//
// Click the bank line for Klay's full reasoning.

function TableHead() {
  return (
    <div className="recon-trow recon-thead" role="row">
      <div role="columnheader">Date</div>
      <div role="columnheader">Bank statement line</div>
      <div role="columnheader">Journal no.</div>
      <div role="columnheader">Matching result</div>
      <div role="columnheader" className="num">Amount</div>
      <div role="columnheader" className="acts" />
    </div>
  );
}

// A row's buttons, then — on an undecided line — Exclude with its reasons. A
// button the person lacks the capability for stays visible, disabled, and
// says which permission it needs.
function RowActions({ ex, actions, onAction, exclude = false }) {
  const perm = useContext(Perm);
  return (
    <div className="recon-td-acts">
      {actions.map(({ a, label, kind }) => {
        const why = a === "post-journal" ? perm.postBlock(ex) : allowed(perm, a) ? null : WHY_NOT[NEEDS[a]];
        const ok = !why;
        return (
          <button key={a} type="button" disabled={!ok} title={why || undefined}
            className={kind === "link" ? "recon-crow-later" : `recon-ex-btn${kind === "primary" ? " primary" : ""}`}
            onClick={() => onAction(a, ex)}>
            {label}
          </button>
        );
      })}
      {exclude && perm.canMatch && <ExcludeMenu onPick={(reason) => onAction("exclude", ex, reason)} />}
    </div>
  );
}

function TableRow({ ex, onAction, actions, journal, result }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="recon-trow" role="row">
      <div className="recon-td-date">{fmtDateShort(ex.date)}</div>
      <button type="button" className="recon-td-line" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Show Klay's reasoning">
        <span className="recon-td-desc">{ex.description}</span>
        {open && <span className="recon-td-more">{ex.explanation}</span>}
      </button>
      <div className="recon-td-je">{journal}</div>
      <div className="recon-td-result">{result}</div>
      <div className="recon-td-amt">{fmtAmt(ex.amount)}</div>
      <RowActions ex={ex} actions={actions} onAction={onAction} />
    </div>
  );
}

const Result = ({ tone = "info", head, sub, children }) => (
  <>
    <span className={`recon-res-head ${tone}`}>{head}</span>
    {sub && <span className="recon-res-sub">{sub}</span>}
    {children}
  </>
);

const pctOf = (s) => `${Number((Math.abs(s.diff / s.subtotal) * 100).toFixed(1))}%`;

const PRIMARY = {
  EXACT_AMOUNT: { a: "reconcile", label: "Match" },
  // Matching an invoice drafts its receipt journal, so the button says so.
  INVOICE_EXACT: { a: "reconcile", label: "Match & draft" },
  INVOICE_RANGE: { a: "reconcile", label: "Match & draft" },
  // Paid from the bank app, never recorded: match it and draft the payment,
  // which somebody allowed to approve payments then approves by posting.
  PPH_WITHHOLDING: { a: "draft-payment", label: "Match & draft payment" },
  FEE_PATTERN: { a: "post-journal", label: "Post" },
  INTEREST_CREDIT: { a: "post-journal", label: "Post" },
  INTEREST_TAX: { a: "post-journal", label: "Post" },
};

// ── The journal table ────────────────────────────────────────────────────────
//
// Date · Bank statement line · Debit · Credit · Amount · Actions. A journal is
// checked account by account, so the accounts get columns of their own rather
// than being squeezed into a matching-result cell.

// A tick box that can also show "some ticked".
function TriCheck({ on, some = false, onChange, label, disabled = false }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !on && some; }, [on, some]);
  return <input ref={ref} type="checkbox" className="rm-check" checked={on} disabled={disabled} onChange={onChange} aria-label={label} />;
}

function JournalHead({ sel }) {
  return (
    <div className="recon-trow recon-jrow recon-thead" role="row">
      <div role="columnheader" className="recon-jsel">
        {sel && <TriCheck on={sel.all} some={sel.some} onChange={sel.toggleAll} label="Select every journal" />}
        Date
      </div>
      <div role="columnheader">Bank statement line</div>
      <div role="columnheader">Debit</div>
      <div role="columnheader">Credit</div>
      <div role="columnheader" className="num">Amount</div>
      <div role="columnheader" className="acts" />
    </div>
  );
}

// One side of the entry: every line on it, split journals included.
function JournalSide({ lines }) {
  return lines.map((l, i) => (
    <span className="recon-jside" key={i}>
      <span className="recon-jside-acct"><strong>{l.account_code}</strong> {l.account_name}</span>
      {lines.length > 1 && <span className="recon-jside-amt">{fmtAmt(l.debit || l.credit)}</span>}
    </span>
  ));
}

function JournalRow({ ex, onAction, draftOf, selected = false, onToggle = null }) {
  const [open, setOpen] = useState(false);
  const { draft, edited } = draftOf(ex);
  const payment = ex.kind === "payment";
  const actions = [
    { a: "post-journal", label: payment ? "Approve & post" : "Post", kind: "primary" },
    // A payment's journal follows from its split; change the payment, not the lines.
    ...(payment ? [] : [{ a: "edit-journal", label: "Edit" }]),
  ];
  return (
    <div className={`recon-trow recon-jrow${selected ? " on" : ""}`} role="row">
      <label className="recon-td-date recon-jsel">
        {onToggle && <input type="checkbox" className="rm-check" checked={selected} onChange={() => onToggle(ex.id)} aria-label={`Select ${ex.description}`} />}
        {fmtDateShort(ex.date)}
      </label>
      <button type="button" className="recon-td-line" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Show Klay's reasoning">
        <span className="recon-td-desc">{ex.description}</span>
        {ex.reversed && <span className="recon-td-draft recon-reversed" title={`Reversed in the GL by ${ex.reversed.reversedBy}${ex.reversed.by ? ` (${ex.reversed.by})` : ""}`}>{ex.reversed.je} reversed</span>}
        {payment && <span className="recon-td-draft recon-reversed" title="Paid from the bank app with no approved payment request in Klay">Paid outside Klay · needs approval</span>}
        {edited && <span className="recon-td-draft">Edited</span>}
        {open && <span className="recon-td-more">{ex.explanation}</span>}
      </button>
      <div className="recon-td-result"><JournalSide lines={draft.lines.filter((l) => l.debit)} /></div>
      <div className="recon-td-result"><JournalSide lines={draft.lines.filter((l) => l.credit)} /></div>
      <div className="recon-td-amt">{fmtAmt(ex.amount)}</div>
      {/* A match's draft goes away by undoing the match, not by excluding. */}
      <RowActions ex={ex} actions={actions} onAction={onAction} exclude={!ex.isMatchDraft} />
    </div>
  );
}

// ── Need confirmation: bank side | Klay side ─────────────────────────────────
//
// A suggestion is a claim that two things are the same, so the row shows both
// things — the statement line on the left, the Klay transaction on the right,
// each with its own date and amount — split down the middle. What Klay read
// into the pair (and why it ranks where it does) sits under the Klay side.

function ConfirmHead() {
  return (
    <div className="cf-row cf-thead" role="row">
      <div className="cf-side bank">
        <span className="cf-kicker">Bank statement</span>
        <span role="columnheader">Date</span>
        <span role="columnheader">Description</span>
        <span role="columnheader" className="num">Amount</span>
      </div>
      <div className="cf-gutter" />
      <div className="cf-side klay">
        <span className="cf-kicker">Klay transaction</span>
        <span role="columnheader">Date</span>
        <span role="columnheader">Transaction</span>
        <span role="columnheader" className="num">Amount</span>
      </div>
      <div role="columnheader" className="acts" />
    </div>
  );
}

function ConfirmRow({ ex, onAction, klay }) {
  const [open, setOpen] = useState(false);
  const primary = PRIMARY[ex.detector];
  const actions = [
    ...(primary ? [{ ...primary, kind: "primary" }] : []),
    { a: "manual-match", label: "Match manually" },
  ];
  const same = klay.amount === ex.amount;
  return (
    <div className="cf-row" role="row">
      <div className="cf-side bank">
        <span className="recon-td-date">{fmtDateShort(ex.date)}</span>
        <button type="button" className="recon-td-line" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Show Klay's reasoning">
          <span className="recon-td-desc">{ex.description}</span>
          {open && <span className="recon-td-more">{ex.explanation}</span>}
        </button>
        <span className="recon-td-amt">{fmtAmt(ex.amount)}</span>
      </div>
      <div className="cf-gutter" aria-hidden>
        <span className={`cf-eq${same ? "" : " near"}`} title={same ? "Same amount" : "Amounts differ"}>{same ? "=" : "≈"}</span>
      </div>
      <div className="cf-side klay">
        <span className="recon-td-date">{klay.date ? fmtDateShort(klay.date) : "—"}</span>
        <div className="recon-td-result">
          <span className="cf-ref">{klay.cat && <CategoryChip cat={klay.cat} />}{klay.ref}{klay.refSub && <span className="cf-ref-sub"> · {klay.refSub}</span>}</span>
          <span className="recon-res-sub" title={klay.sub}>{klay.sub}</span>
          <span className="cf-why-line">
            {klay.why && <span className={`cf-why ${klay.tone || ""}`}>{klay.why}</span>}
            {klay.why && ex.basis && " · "}
            {ex.basis && <span className="recon-res-basis">{ex.basis}</span>}
          </span>
        </div>
        <span className="recon-td-amt">{klay.amount == null ? "—" : fmtAmt(klay.amount)}</span>
      </div>
      <RowActions ex={ex} actions={actions} onAction={onAction} exclude />
    </div>
  );
}

// A reconciled line and how: matched to what the books hold, or its journal
// posted. A match with no journal only links records, so it can be undone; a
// posted journal is reversed in the GL, never undone here.
const UNDOABLE = new Set(["reconcile", "manual-match"]);
const RESOLVED_HEAD = { "post-journal": "Journal posted", reconcile: "Matched", "manual-match": "Matched manually" };
function ReconciledRow({ ex, onAction, cat }) {
  const r = ex.resolution;
  const actions = UNDOABLE.has(r.action) && !r.jeNumber ? [{ a: "undo", label: "Undo", kind: "link" }] : [];
  const journals = r.journals?.length ? r.journals : r.jeNumber ? [r.jeNumber] : [];
  return (
    <TableRow
      ex={ex}
      onAction={onAction}
      actions={actions}
      journal={journals.length ? journals.map((j) => <span key={j} className="recon-td-jeno">{j}</span>) : <span className="recon-td-none">—</span>}
      result={<Result tone="ok" head={<>{cat && <CategoryChip cat={cat} />}{RESOLVED_HEAD[r.action] || "Matched"}</>} sub={r.note} />}
    />
  );
}

// A line set aside as needing no Klay record, and why. Restore puts it back
// where it came from.
function ExcludedRow({ ex, onAction }) {
  const r = ex.resolution;
  return (
    <TableRow
      ex={ex}
      onAction={onAction}
      actions={[{ a: "restore-excluded", label: "Restore", kind: "link" }]}
      journal={<span className="recon-td-none">—</span>}
      result={<Result tone="muted" head={EXCLUDE_REASONS.find((x) => x.k === r.reason)?.lbl || "Excluded"} sub={r.note} />}
    />
  );
}

// A run of rows of one kind. Unnamed: the order says strongest first, and each
// row says why it is where it is.
function Section({ items, render, label = null, sel = null }) {
  if (!items.length) return null;
  return (
    <div className="recon-section">
      {label && (
        <div className="recon-section-head">
          {sel && <TriCheck on={sel.all} some={sel.some} onChange={sel.toggleAll} label={`Select every journal in ${label}`} />}
          <span className="recon-section-title">{label}</span>
          <span className="recon-section-blurb">{items.length}</span>
        </div>
      )}
      {items.map(render)}
    </div>
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────
//
// Where a reconciliation begins. Statements are seeded rather than parsed, so
// whatever file is chosen stands for the account's statement: the steps show
// what a real upload does — recognise the bank, extract the lines, check the
// opening balance against last month's closing, match against Klay — and the
// lines appear when it finishes. The opening-balance check is the real one.

const BANK_FULL = { MDR: "Mandiri", PERMATA: "Permata" };
const STEP_MS = 650;

function CheckMark() {
  return <svg viewBox="0 0 10 10" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="2 5.2 4.2 7.2 8 3" /></svg>;
}

function UploadModal({ open, account, run, period, onUpload, onDone, onClose }) {
  const [phase, setPhase] = useState("picker");
  const [fileName, setFileName] = useState("");
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  // The lines on file before this upload, kept for the summary of what it added,
  // and the upload itself as it was when it started — recording it changes
  // what "the next statement" is, and the summary must not follow.
  const before = useRef(new Set());
  const snap = useRef(null);
  useEffect(() => { if (!open) { setPhase("picker"); setFileName(""); setStep(0); } }, [open]);

  // The file stands for the latest statement the bank has — or, when nothing
  // newer exists, the one already on file again.
  const onFileThrough = account ? coverageOf(account.id, period) : null;
  const target = account ? nextStatementThrough(account.id, period) || onFileThrough : null;
  const issued = useMemo(() => (account && target ? statementFor(account.id, { period, through: target }) : null), [account, period, target]);
  const onFileIds = useMemo(() => new Set((run?.statement?.loaded ? run.statement.lines : []).map((l) => l.id)), [run]);
  const fresh = issued ? issued.lines.filter((l) => !onFileIds.has(l.id)).length : 0;
  const overlap = issued ? issued.lines.length - fresh : 0;
  const bank = account ? BANK_FULL[account.bank] || account.bank : "";
  const live = { first: !onFileThrough, target, total: issued?.lines.length || 0, label: issued ? statementLabel(issued) : "", fresh, overlap, opening: issued?.openingBalance };
  const u = phase === "picker" ? live : snap.current || live;
  const first = u.first;
  const steps = issued?.loaded ? [
    `Reading ${fileName}`,
    `${bank} statement recognised · ${account.name} ${maskOf(account)}`,
    `${u.total} transactions in the file · ${u.label}`,
    first
      ? `Opening balance Rp ${fmtRp(u.opening)} agrees with last month's closing`
      : `${u.overlap} already on file, kept as they are · ${u.fresh} new`,
    u.fresh ? `Matching ${first ? "each line" : `the ${u.fresh} new line${u.fresh === 1 ? "" : "s"}`} against Klay` : "Nothing new to match",
  ] : [];

  // Walk the steps; the last one records the upload, so the lines are there
  // when the summary shows.
  useEffect(() => {
    if (phase !== "processing") return undefined;
    if (step >= steps.length) { onUpload({ through: u.target, file: fileName, added: u.fresh }); setPhase("done"); return undefined; }
    const t = setTimeout(() => setStep((n) => n + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [phase, step, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !account) return null;

  const begin = (name) => { before.current = onFileIds; snap.current = live; setFileName(name); setStep(0); setPhase("processing"); };
  const ymd = (iso) => iso.replace(/-/g, "");
  const sample = `mutasi-${account.number}-${ymd(`${period}-01`)}-${ymd(target || `${period}-01`)}.pdf`;
  const onFile = (f) => { if (f) begin(f.name); };
  const reconciled = run?.state?.key === "RECONCILED";

  // The result: where the lines THIS upload added went, from the fresh run.
  const where = { confirm: 0, tomatch: 0, journals: 0 };
  let added = 0;
  for (const e of run?.exceptions || []) {
    if (before.current.has(e.lineId)) continue;
    added++;
    const t = tabOf(e);
    if (where[t] != null) where[t]++;
  }

  return (
    <div className="bank-upload-backdrop" onClick={phase === "processing" ? undefined : onClose}>
      <div className="bank-upload-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Upload bank statement">
        <div className="bank-upload-head">
          <span className="bank-upload-icon" aria-hidden><SparkleIcon /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">
              {phase === "picker" && `Upload ${account.name} statement`}
              {phase === "processing" && "Reading the statement"}
              {phase === "done" && `${account.name} · ${u.label}`}
            </div>
            <div className="bank-upload-sub">
              {phase === "picker" && `${periodLabel(period)} · PDF, CSV, Excel or MT940 — the bank is recognised from the file.`}
              {phase === "processing" && fileName}
              {phase === "done" && (first ? `${u.total} transactions read from ${fileName}` : `${added} new line${added === 1 ? "" : "s"} from ${fileName} · on file through ${fmtDateShort(u.target)}`)}
            </div>
          </div>
          {phase !== "processing" && (
            <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
            </button>
          )}
        </div>

        <div className="bank-upload-body">
          {phase === "picker" && (
            <>
              {onFileThrough && (
                <div className="bank-upload-hint">
                  <SparkleIcon />
                  <span>
                    {reconciled
                      ? <>{periodLabel(period)} is reconciled. New lines in this file will reopen it; lines already on file are kept with their decisions.</>
                      : <>On file through {fmtDateShort(onFileThrough)}. This upload adds whatever is new{nextStatementThrough(account.id, period) ? ` — the bank has lines through ${fmtDateShort(target)}` : ""}; lines already on file are kept with their decisions.</>}
                  </span>
                </div>
              )}
              <div
                className={`bank-upload-drop${dragging ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
              >
                <svg className="bank-upload-drop-icon" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 16V4" /><polyline points="7 9 12 4 17 9" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                </svg>
                <div className="bank-upload-drop-title">Drop the statement here</div>
                <div className="bank-upload-drop-sub">BCA, Mandiri, BNI, BRI, CIMB and Permata exports are read without column mapping.</div>
                <button type="button" className="bank-upload-browse" onClick={() => inputRef.current?.click()}>Choose a file</button>
                <input ref={inputRef} type="file" hidden accept=".pdf,.csv,.xls,.xlsx,.sta,.txt,.mt940" onChange={(e) => onFile(e.target.files?.[0])} />
              </div>
              <button type="button" className="bank-upload-sample" onClick={() => begin(sample)}>
                No file to hand? Use the sample statement <span className="mono">{sample}</span>
              </button>
            </>
          )}

          {phase === "processing" && (
            <div className="bank-upload-processing">
              {steps.map((label, i) => (
                <div key={i} className={`bank-upload-step${i < step ? " done" : i === step ? " active" : ""}`}>
                  <span className="bank-upload-step-mark">{i < step ? <CheckMark /> : i === step ? <span className="bank-upload-spinner" /> : null}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}

          {phase === "done" && added === 0 && (
            <div className="bank-upload-balance ok">Nothing new — every line in this file is already on file. Nothing changes.</div>
          )}
          {phase === "done" && added > 0 && (
            <>
              <div className="bank-upload-result">
                <div className="bank-upload-result-stat ok">
                  <div className="bank-upload-result-val">{where.confirm}</div>
                  <div className="bank-upload-result-lbl">Klay suggests a match</div>
                </div>
                <div className="bank-upload-result-stat">
                  <div className="bank-upload-result-val">{where.journals}</div>
                  <div className="bank-upload-result-lbl">Bank charges drafted</div>
                </div>
                <div className={`bank-upload-result-stat${where.tomatch ? " warn" : ""}`}>
                  <div className="bank-upload-result-val">{where.tomatch}</div>
                  <div className="bank-upload-result-lbl">Need matching by hand</div>
                </div>
              </div>
              <div className={`bank-upload-balance ${run?.balanceCheck?.ok ? "ok" : "warn"}`}>
                {first ? run?.balanceCheck?.message : "Running balance agrees with the lines already on file."}
              </div>
            </>
          )}
        </div>

        {phase === "done" && (
          <div className="bank-upload-foot">
            <button type="button" className="bank-upload-btn primary" onClick={onDone}>Start reconciling</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BankReconciliationPage() {
  const { user, hasCapability } = useCurrentUser();
  // Matching needs bank.reconcile, posting needs gl.post (see Perm above).
  const canMatch = hasCapability("bank.reconcile");
  const canPost = hasCapability("gl.post");
  const canApprovePay = hasCapability("payment.approve");
  const { addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { payments: allPayments, recordPayment } = usePayments();
  const { bills, updateBill } = useBills();
  const { invoices, recordReceipt, undoReceipt } = useInvoices();

  const [selectedAccount, setSelectedAccount] = useState("bca-op");
  const [accountListOpen, setAccountListOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // The fee or interest line whose journal is being edited, or null.
  const [journalFor, setJournalFor] = useState(null);
  // null = let the page pick: the first tab with something in it.
  const [tab, setTab] = useState(null);
  // The month being reconciled. Earlier months open as they were left and can
  // still be changed.
  const [period, setPeriod] = useState(CURRENT_PERIOD);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const monthMenuRef = useRef(null);
  useEffect(() => {
    if (!monthMenuOpen) return;
    const onDoc = (e) => { if (monthMenuRef.current && !monthMenuRef.current.contains(e.target)) setMonthMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [monthMenuOpen]);
  // Each tab keeps its own filters — search, Money in/out, Klay type — so
  // narrowing one tab never touches another, and tab counts stay whole.
  const [filters, setFilters] = useState({});
  // To match: what is ticked on each side, and where a difference would go.
  const [selLines, setSelLines] = useState(() => new Set());
  const [selRecords, setSelRecords] = useState(() => new Set());
  const [diffAcct, setDiffAcct] = useState("");
  // A shortfall: leave it open on the Klay items ("open"), or book it ("book").
  const [matchMode, setMatchMode] = useState("open");
  const clearMatch = useCallback(() => { setSelLines(new Set()); setSelRecords(new Set()); setDiffAcct(""); setMatchMode("open"); }, []);
  // Review & post journals: the ticked rows, for posting several at once.
  const [selJournals, setSelJournals] = useState(() => new Set());
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  // Decisions live in a context, not here. The engine is a pure function of the
  // statement and the ledger; what a person decided is laid over the top. They
  // sit outside this component because the close board asks the same question.
  const { resolutions, drafts, manual, matchDrafts, reopened, uploaded, markUploaded, resolve, unresolve, resolveMany, saveDraft, setManualFor, saveMatchDraft, removeMatchDraft } = useBankRecon();
  const { isLocked, nextOpenPeriod } = useClosePeriod();
  const { reconDifferenceAccounts, sodMode } = useAccountingSettings();
  // The first open month, for journals from a month whose books are closed.
  const openPostDate = `${nextOpenPeriod}-01`;

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2400);
  }

  // Payments recorded in this session count. A reconciliation that ignored them
  // would report a payment you just made as an unexplained bank debit.
  const livePayments = useMemo(() => {
    const out = {};
    for (const [billId, p] of Object.entries(allPayments || {})) {
      if (p?.history?.length) out[billId] = p.history;
    }
    return Object.keys(out).length ? out : null;
  }, [allPayments]);

  // One account's run with this session's decisions laid over it. Overlaying
  // re-derives the state, so reconciling the last line moves the account to
  // fully reconciled without anything having to remember to recompute.
  const overlaid = useCallback(
    (accountId, p = CURRENT_PERIOD) => {
      const run = runReconciliation(accountId, { extraPayments: livePayments, period: p });
      if (!run) return null;
      // A fee or interest line whose journal was reversed in the GL carries
      // `reopened` (and `reversed`, for its row's badge).
      const exceptions = run.exceptions.map((e) => (resolutions[e.id] || manual[e.id] || reopened[e.id]
        ? {
          ...e,
          ...(resolutions[e.id] ? { resolution: resolutions[e.id] } : {}),
          ...(manual[e.id] ? { manual: true } : {}),
          ...(reopened[e.id] && !resolutions[e.id] ? { reopened: true, reversed: reopened[e.id] } : {}),
        }
        : e));
      const withRes = { ...run, exceptions };
      return { ...withRes, state: stateOf(withRes, run.statement), counts: countOf(run.lines, exceptions), pending: run };
    },
    [livePayments, resolutions, manual, reopened, uploaded],
  );

  const runs = useMemo(() => COMPANY_BANK_ACCOUNTS.map((a) => overlaid(a.id, period)).filter(Boolean), [overlaid, period]);

  // Each month's standing, for the month menu.
  const monthStatus = useMemo(() => Object.fromEntries(PERIODS.map((p) => {
    const scoped = COMPANY_BANK_ACCOUNTS.map((a) => overlaid(a.id, p)).filter((r) => r && (r.statement.loaded || r.statement.awaitingUpload) && reconcilable(r.account));
    return [p, { done: scoped.filter((r) => r.state.key === "RECONCILED").length, total: scoped.length }];
  })), [overlaid]);
  const runById = useMemo(() => Object.fromEntries(runs.map((r) => [r.accountId, r])), [runs]);
  const run = runById[selectedAccount];
  const recordById = useMemo(() => Object.fromEntries((run?.records || []).map((r) => [r.id, r])), [run]);
  const account = run?.account || bankAccountById(selectedAccount);

  const filteredAccounts = runs;

  // Across accounts: one with a statement is reconciled once every line on it
  // is decided. Accounts with no statement or no GL account are not counted.
  // An account still waiting for its statement is in scope and not reconciled.
  const inScope = runs.filter((r) => (r.statement.loaded || r.statement.awaitingUpload) && reconcilable(r.account));
  const accountsDone = inScope.filter((r) => r.state.key === "RECONCILED").length;
  const allLeft = inScope.reduce((sum, r) => sum + openMoney(r.exceptions).total, 0);

  // Journals a match drafted, as rows of Review & post journals. Each stands for the
  // bank line(s) it came from; its amount is the bank side of the entry.
  const draftRows = useMemo(() => Object.values(matchDrafts)
    .filter((d) => d.accountId === selectedAccount && d.period === period)
    .map((d) => ({
      id: d.id, isMatchDraft: true, kind: d.kind || "journal", date: d.date, description: d.description, amount: d.bankAmount, lineId: d.primaryLineId,
      reversed: d.reversed || null,
      explanation: d.reversed
        ? `${d.reversed.je} was reversed in the GL by ${d.reversed.reversedBy}. The match stands — correct this journal and post it again.`
        : `Drafted when ${d.lineIds.length > 1 ? "these bank lines were" : "this bank line was"} matched to ${d.refs}.`,
    })), [matchDrafts, selectedAccount, period]);

  // Every row in its stage, before any filter. Tab counts come from here, so a
  // filter on one tab never changes the number on another.
  const allByTab = useMemo(() => {
    const out = { confirm: [], journals: [], tomatch: [], reconciled: [], excluded: [] };
    for (const e of run?.exceptions || []) {
      // A match waiting on its journal is shown by the journal's row.
      if (e.resolution?.pendingJournal) continue;
      out[tabOf(e)].push(e);
    }
    out.journals.push(...draftRows);
    const rank = (e) => EXCEPTION_TYPES[e.type]?.rank ?? 9;
    out.tomatch.sort((a, b) => rank(a) - rank(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }, [run, draftRows]);

  // What each tab shows: its rows narrowed by its own filters.
  const byTab = useMemo(() => {
    const out = {};
    for (const [k, rows] of Object.entries(allByTab)) {
      const f = filters[k] || NO_FILTER;
      const q = f.search.trim().toLowerCase();
      out[k] = rows.filter((e) =>
        (UNFILTERED_TABS.has(k) || inDirection(f.dir, e.amount))
        // To match searches each side in its own pane.
        && (k === "tomatch" || !q || [e.title, e.explanation, e.brief, e.description, e.counterparty, e.resolution?.note, String(Math.abs(e.amount))]
          .some((v) => (v || "").toLowerCase().includes(q))));
    }
    return out;
  }, [allByTab, filters]);

  const tabCount = Object.fromEntries(TABS.map((t) => [t.k, allByTab[t.k].length]));
  const activeTab = tab || ["confirm", "tomatch", "journals"].find((k) => tabCount[k] > 0) || "reconciled";

  // The open tab's filters, and setters that only ever touch that tab.
  const { dir, cat, search } = filters[activeTab] || NO_FILTER;
  const setTabFilter = (patch) => setFilters((prev) => ({ ...prev, [activeTab]: { ...(prev[activeTab] || NO_FILTER), ...patch } }));
  const setSearch = (v) => setTabFilter({ search: v });
  const setCat = (v) => setTabFilter({ cat: v });
  // Choosing a direction points the Klay filter at what usually moves that
  // way: money in is mostly AR, money out mostly AP. Only a default — interest
  // (Bank) and QRIS takings (Other) are money in too, a tap away.
  const pickDir = (d) => setTabFilter({ dir: d, cat: d === "in" ? "ar" : d === "out" ? "ap" : "all" });
  // A new account starts again from the first tab with work in it.
  useEffect(() => { setTab(null); }, [selectedAccount, period]);
  // A selection belongs to one account, one month, one direction.
  // A line sent here by Reconcile manually arrives ticked.
  const preselect = useRef(null);
  useEffect(() => {
    clearMatch();
    setSelJournals(new Set());
    if (preselect.current) { setSelLines(new Set([preselect.current])); preselect.current = null; }
  }, [selectedAccount, period, dir, activeTab, clearMatch]);

  // The journal a fee or interest line would post: the one somebody edited, or
  // Klay's draft from the account mapping.
  // A match's draft is its own; it is "edited" once somebody saved changes.
  const draftOf = useCallback(
    (ex) => ex.isMatchDraft
      ? { draft: matchDrafts[ex.id], edited: !!matchDrafts[ex.id]?.edited }
      : drafts[ex.id] ? { draft: drafts[ex.id], edited: true } : { draft: draftEntry({ exception: ex, account }), edited: false },
    [drafts, matchDrafts, account],
  );

  // ── Who may post this ─────────────────────────────────────────────────────
  //
  // A journal's preparer is whoever matched the line (a match's draft) or
  // edited the draft (a fee or interest line); Klay's own untouched drafts have
  // no human preparer. Under ENFORCED segregation of duties (Settings → Access
  // policy) the preparer cannot post it — two people. RELAXED lets them, and
  // the posting is flagged for audit.
  const preparerOf = (row) => (row.isMatchDraft ? matchDrafts[row.id]?.draftedBy : drafts[row.id]?.editedBy) || null;
  const selfPosting = (row) => preparerOf(row) === user.name;
  const postBlock = (row) => {
    if (row.isMatchDraft && row.kind === "payment" && !canApprovePay) return "Approving a payment needs the Approve payments permission";
    if (!canPost) return WHY_NOT.post;
    if (sodMode === "ENFORCED" && selfPosting(row)) return "Segregation of duties is enforced — you prepared this journal, so someone else posts it";
    return null;
  };
  const perm = { canMatch, canPost, postBlock };
  const SELF_FLAG = " Posted by its preparer under Relaxed segregation of duties — flagged for audit.";

  // ── Deciding ───────────────────────────────────────────────────────────────

  function postJournal(ex, draft, jeNumber) {
    const problem = draftProblem(draft, ex);
    if (problem) { showToast(problem); return null; }
    // A line from a month whose books are closed cannot be posted into it; the
    // entry is dated the first day of the first open month instead.
    const postDate = isLocked(draft.je_date) ? openPostDate : null;
    const je = postedEntry({ draft, exception: ex, jeNumber, by: user.name, today: TODAY_ISO, postDate });
    addJournalEntry(je);
    const moved = postDate ? ` Dated ${fmtIsoLong(postDate)} — ${periodLabel(draft.je_date.slice(0, 7))} is closed.` : "";
    const flag = selfPosting(ex) ? SELF_FLAG : "";
    return { action: "post-journal", at: TODAY_ISO, by: user.name, note: postedNote(ex, je.je_number, user.name) + moved + flag, jeNumber: je.je_number };
  }

  // The journal a match needs, drafted into Review & post journals; returns its id,
  // or null when the match needs none (it matched records already posted).
  const DRAFTED = " Journal drafted — post it from Review & post journals.";
  function draftForMatch({ lines, receipts = [], diff = null, refs }) {
    const primary = lines[0];
    const description = lines.map((l) => l.description).join(" + ");
    const entry = matchEntry({ account, date: primary.date, description, refs, receipts, diff });
    if (!entry) return null;
    const id = `JD-${primary.id}`;
    saveMatchDraft(id, { ...entry, id, accountId: account.id, period, lineIds: lines.map((l) => l.id), primaryLineId: primary.lineId, date: primary.date, description, refs, draftedBy: user.name });
    return id;
  }

  // Where a customer's overpayment goes by default: the first income account
  // among the difference accounts. Only a draft — Edit changes it.
  const overpayAccount = reconDifferenceAccounts.find((c) => c.startsWith("4")) || reconDifferenceAccounts[0] || "4-2300";

  // Posts a match's draft. Returns the resolution updates for its line(s) —
  // matched, now reconciled — or null when the draft can't post.
  function postMatchDraft(d, jeNumber) {
    const pseudo = { amount: d.bankAmount, lineId: d.primaryLineId };
    const problem = draftProblem(d, pseudo);
    if (problem) { showToast(problem); return null; }
    const flag = selfPosting({ isMatchDraft: true, id: d.id }) ? SELF_FLAG : "";
    if (d.kind === "payment") {
      // Posting it is approving it: the payment module records the payment —
      // approved now, by this person — and writes its journal. The bank line
      // then ties to that new payment record.
      const idx = allPayments?.[d.billId]?.history?.length || 0;
      const written = recordPayment([{ id: d.billId, breakdown: d.breakdown, date: d.je_date, approvedBy: user.name, source: "bank_reconciliation" }], user.name) || {};
      if (!written[d.billId]) { showToast(`Could not record the payment on ${d.billId}.`); return null; }
      const je = { je_number: written[d.billId] };
      // The same two writes Record payment makes on the bill: the payment, and
      // the bill's own balance and audit trail.
      const live = bills.find((b) => b.id === d.billId);
      const open = live?.sisa != null ? live.sisa : live?.total || 0;
      const paid = breakdownTotal(d.breakdown);
      const full = paid >= open;
      updateBill(d.billId, full ? { pay: "paid", sisa: 0 } : { sisa: open - paid }, {
        type: "paid", by: user.name, date: d.je_date, time: "",
        action: `Paid from ${account.name} outside Klay — found on the bank statement, approved and recorded in bank reconciliation (${je.je_number})`,
      });
      removeMatchDraft(d.id);
      const updates = {};
      for (const id of d.lineIds) {
        const r = resolutions[id];
        if (!r) continue;
        updates[id] = {
          ...r, pendingJournal: false, jeNumber: je.je_number, journals: [je.je_number], recordIds: [`${d.billId}:${idx}`],
          note: `${r.note.replace(PAY_DRAFTED, "")} Payment approved and recorded by ${user.name} as ${je.je_number}.${flag}`,
        };
      }
      return { updates, je };
    }
    const postDate = isLocked(d.je_date) ? openPostDate : null;
    const je = postedEntry({ draft: d, exception: pseudo, jeNumber, by: user.name, today: TODAY_ISO, postDate });
    addJournalEntry(je);
    removeMatchDraft(d.id);
    const updates = {};
    for (const id of d.lineIds) {
      const r = resolutions[id];
      if (!r) continue;
      const { id: _id, edited: _ed, reversed: _rv, ...postedDraft } = d;
      updates[id] = {
        ...r, pendingJournal: false, jeNumber: je.je_number, journals: [...(r.journals || []), je.je_number], postedDraft,
        note: `${r.note.replace(DRAFTED, "").replace(" — needs a new journal.", ".")} Journal ${je.je_number} posted by ${user.name}.${flag}`,
      };
    }
    return { updates, je };
  }

  function reconcileSuggestion(ex) {
    const s = ex.suggestion;
    if (s.kind === "invoice") {
      recordReceipt(s.invoiceId, { amount: ex.amount, date: ex.date, lineId: ex.lineId, by: user.name, paysInFull: s.paysInFull });
      const outcome = s.paysInFull ? `${s.invoiceId} is paid` : `${s.invoiceId} is part-paid`;
      // Paid short by the PPh 23 the customer withheld: the invoice is settled
      // in full and the tax is a prepayment. Paid over: the invoice is settled
      // and the extra goes to income — a draft, so Edit can move it.
      const over = Math.max(0, ex.amount - s.subtotal);
      const receipt = {
        invoiceId: s.invoiceId, customerName: s.customerName, cash: ex.amount - over,
        withheld: s.paysInFull && ex.amount < s.subtotal ? s.subtotal - ex.amount : 0,
      };
      const draftId = draftForMatch({ lines: [ex], receipts: [receipt], diff: over ? { accountCode: overpayAccount, amount: over } : null, refs: s.invoiceId });
      return {
        action: "reconcile", at: TODAY_ISO, by: user.name, invoiceIds: [s.invoiceId], matchId: ex.id,
        note: `Matched to ${s.invoiceId} by ${user.name}. ${outcome}.${DRAFTED}`,
        ...(draftId ? { draftId, pendingJournal: true } : {}),
      };
    }
    return { action: "reconcile", at: TODAY_ISO, by: user.name, recordIds: [s.recordId], journals: [s.ref], note: `Matched to ${s.ref}${s.billId && s.billId !== s.ref ? ` (${s.billId})` : ""} by ${user.name}.` };
  }

  // A bill paid from the bank app and never recorded: the payment it was,
  // drafted from the bill — cash out as the statement shows, the PPh 23 the
  // bill carries withheld — with its journal previewed in Review & post.
  const PAY_DRAFTED = " Payment drafted for approval in Review & post journals.";
  function draftPayment(ex) {
    const bill = BILLS.find((b) => b.id === ex.billId);
    if (!bill) return null;
    const breakdown = defaultBreakdown({ remaining: bill.total, pph23: bill.pph23 || 0 }, { sourceAccountId: account.id, method: "bank", rail: "BI_FAST" });
    const { lines } = paymentJournalLines(breakdown, { vendorName: bill.vendorName });
    const asLines = lines.map((l) => ({ account_code: l.account_code, account_name: l.account_name, debit: l.side === "DR" ? l.amount : 0, credit: l.side === "CR" ? l.amount : 0, description: l.description }));
    // The bank line first — it is what the statement printed.
    const bankFirst = [...asLines.filter((l) => l.credit === -ex.amount), ...asLines.filter((l) => l.credit !== -ex.amount)];
    const id = `JD-${ex.id}`;
    saveMatchDraft(id, {
      id, kind: "payment", billId: bill.id, breakdown, je_date: ex.date,
      memo: `Payment — ${bill.vendorName} · ${bill.invNo} (paid outside Klay)`, lines: bankFirst, bankAmount: ex.amount,
      accountId: account.id, period, lineIds: [ex.id], primaryLineId: ex.lineId, date: ex.date, description: ex.description, refs: bill.id, draftedBy: user.name,
    });
    return {
      action: "reconcile", at: TODAY_ISO, by: user.name, matchId: ex.id, draftId: id, pendingJournal: true, billIds: [bill.id],
      note: `Matched to ${bill.id} by ${user.name} — paid outside Klay, no approved payment request.${PAY_DRAFTED}`,
    };
  }

  function decide(action, ex, jeNumber) {
    if (action === "draft-payment" && ex.billId) return draftPayment(ex);
    if (action === "edit-journal") { setJournalFor(ex); return null; }
    if (action === "post-journal") return postJournal(ex, draftOf(ex).draft, jeNumber);
    if (action === "reconcile" && ex.suggestion) return reconcileSuggestion(ex);
    return null;
  }

  // Excluded: the line needs no Klay record. It counts as decided — the
  // account can reconcile with it — and the reason stays on the line.
  const excludeRes = (reason) => {
    const lbl = EXCLUDE_REASONS.find((x) => x.k === reason)?.lbl || "Excluded";
    return { action: "exclude", reason, at: TODAY_ISO, by: user.name, note: `Excluded by ${user.name} — ${lbl.toLowerCase()}.` };
  };

  function onAction(action, ex, arg) {
    if (action === "exclude") {
      resolve(ex.id, excludeRes(arg));
      showToast(`Excluded — the ${fmtDateShort(ex.date)} line is in Excluded. Restore it from there.`);
      return;
    }
    if (action === "restore-excluded") {
      unresolve(ex.id);
      showToast(`Restored — the ${fmtDateShort(ex.date)} line is back in ${TABS.find((t) => t.k === tabOf({ ...ex, resolution: null }))?.lbl}.`);
      return;
    }
    // Match manually: set the suggestion aside and take the line to To match,
    // ticked, where its records can be picked on the Klay side.
    if (action === "manual-match") {
      setManualFor(ex.id, true);
      preselect.current = ex.id;
      setTab("tomatch");
      showToast(`Moved to To match — tick the Klay transactions the ${fmtDateShort(ex.date)} line belongs with.`);
      return;
    }
    if (action === "restore") {
      setManualFor(ex.id, false);
      setSelLines((prev) => { const next = new Set(prev); next.delete(ex.id); return next; });
      showToast("Suggestion restored — the line is back in Need confirmation.");
      return;
    }
    if (action === "post-journal" && ex.isMatchDraft) {
      const out = postMatchDraft(matchDrafts[ex.id], peekNextJeNumber());
      if (!out) return;
      resolveMany(out.updates);
      const n = Object.keys(out.updates).length;
      showToast(`Journal ${out.je.je_number} posted — ${n} bank line${n === 1 ? "" : "s"} reconciled.`);
      return;
    }
    if (action === "undo") {
      // Lines matched together come back together, and an unposted draft the
      // match made goes with them.
      const r = ex.resolution || {};
      if (r.draftId) removeMatchDraft(r.draftId);
      (r.group || [ex.id]).forEach(unresolve);
      if (r.invoiceIds?.length) undoReceipt(r.receiptLineId || ex.lineId);
      const where = TABS.find((t) => t.k === tabOf({ ...ex, resolution: null }))?.lbl;
      showToast(r.group?.length > 1
        ? `Undone — ${r.group.length} bank lines are back.`
        : `Undone — the ${fmtDateShort(ex.date)} line is back in ${where}.`);
      return;
    }
    const res = decide(action, ex, peekNextJeNumber());
    if (!res) return;
    resolve(ex.id, res);
    showToast(res.note);
  }

  function onBatch(action, items) {
    const next = {};
    const base = peekNextJeNumber();
    const bump = (n, i) => {
      const m = /^JE-(\d{4})-(\d+)$/.exec(n);
      return m ? `JE-${m[1]}-${String(parseInt(m[2], 10) + i).padStart(4, "0")}` : `${n}-${i}`;
    };
    let n = 0;
    let drafted = 0;
    let skipped = 0;
    items.forEach((ex) => {
      const a = action === "primary" ? PRIMARY[ex.detector]?.a : action;
      if (!a) return;
      // Payments are approved one at a time; journals this person may not post
      // (segregation of duties, permissions) are left for someone who may.
      if (a === "post-journal" && (ex.kind === "payment" || postBlock(ex))) { skipped++; return; }
      // Only journals take a number, so the sequence advances per journal.
      if (a === "post-journal" && ex.isMatchDraft) {
        const out = postMatchDraft(matchDrafts[ex.id], bump(base, n++));
        if (out) Object.assign(next, out.updates);
        return;
      }
      const res = decide(a, ex, bump(base, a === "post-journal" ? n++ : n));
      if (res) { next[ex.id] = res; if (res.pendingJournal) drafted++; }
    });
    const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
    const left = skipped ? ` ${plural(skipped, "journal")} left for someone else to post or approve.` : "";
    if (!Object.keys(next).length) { if (left) showToast(left.trim()); return; }
    resolveMany(next);
    showToast(action === "post-journal"
      ? `${plural(n, "journal")} posted.${left}`
      : `${plural(Object.keys(next).length, "line")} matched${drafted ? `, ${plural(drafted, "journal")} drafted for Review & post journals` : ""}.`);
  }

  function onJournalSave(draft) {
    if (journalFor.isMatchDraft) saveMatchDraft(journalFor.id, { ...matchDrafts[journalFor.id], ...draft, edited: true });
    else saveDraft(journalFor.id, { ...draft, editedBy: user.name });
    setJournalFor(null);
    showToast("Draft saved. Post it when it's right.");
  }

  function onJournalPost(draft) {
    const ex = journalFor;
    if (ex.isMatchDraft) {
      const d = { ...matchDrafts[ex.id], ...draft, edited: true };
      saveMatchDraft(ex.id, d);
      const out = postMatchDraft(d, peekNextJeNumber());
      if (!out) return;
      resolveMany(out.updates);
      setJournalFor(null);
      showToast(`Journal ${out.je.je_number} posted.`);
      return;
    }
    saveDraft(ex.id, { ...draft, editedBy: user.name });
    const res = postJournal(ex, draft, peekNextJeNumber());
    if (!res) return;
    resolve(ex.id, res);
    setJournalFor(null);
    showToast(res.note);
  }

  // What a line could be matched to by hand: records on this account and open
  // invoices, each at what is still unmatched on it. A record matched in part
  // (a payment whose second transfer has not arrived) stays with the rest; an
  // invoice part-paid stays with its balance. Suggestions for other lines are
  // not decisions, so their records stay available.
  const manualCandidates = useMemo(() => {
    if (!run) return [];
    const used = {};
    const seen = new Set();
    for (const e of run.exceptions) {
      const r = e.resolution;
      if (!r || r.action === "exclude") continue;
      // Lines matched together share one decision — count it once.
      const key = r.matchId || e.id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.recordAlloc) for (const [id, amt] of Object.entries(r.recordAlloc)) used[id] = (used[id] || 0) + amt;
      else for (const id of r.recordIds || []) used[id] = recordById[id]?.amount || 0;
    }
    const records = (run.records || []).flatMap((r) => {
      const rest = r.amount - (used[r.id] || 0);
      if (Math.abs(rest) < 1) return [];
      return used[r.id] ? [{ ...r, amount: rest, original: r.amount }] : [r];
    });
    const open = invoices
      .filter((i) => i.approval === "sent" && i.payStatus !== "paid")
      .flatMap((i) => {
        const sub = subtotalOf(i);
        const received = (i.receipts || []).reduce((t, x) => t + x.amount, 0);
        const rest = sub - received;
        if (rest < 1) return [];
        return [{
          id: `inv:${i.id}`, kind: "invoice", invoiceId: i.id, ref: i.id, billId: null,
          counterparty: i.customerName, label: `Invoice to ${i.customerName}`, amount: rest, date: i.date,
          ...(received ? { original: sub } : {}),
        }];
      });
    return [...records, ...open];
  }, [run, invoices, recordById]);

  // Matches bank lines to Klay items by hand, from To match. `diff` is
  // { accountCode, amount } when the person booked the gap to a difference
  // account; amount is signed like the statement. Without one, a shortfall
  // stays open on the Klay items (lib/manualMatch.js). Several lines matched
  // together share one decision; undoing any of them undoes all of them.
  function reconcileLines(lines, picked, diff = null) {
    if (!lines.length) return null;
    const primary = lines[0];
    const ex = lines.length === 1 ? primary : {
      ...primary,
      amount: lines.reduce((s, l) => s + l.amount, 0),
      description: lines.map((l) => l.description).join(" + "),
    };
    // What the Klay items account for: the bank lines, less any booked
    // difference — applied oldest first, so the newest carries what stays open.
    const settledAmount = ex.amount - (diff?.amount || 0);
    const alloc = allocate(settledAmount, picked).filter((a) => a.share !== 0);
    const records = alloc.filter((a) => a.item.kind !== "invoice");
    const invs = alloc.filter((a) => a.item.kind === "invoice");
    const restOf = (a) => `Rp ${fmtRp(Math.abs(a.item.amount - a.share))} left open`;
    const receipts = [];
    const settled = invs.map((a) => {
      // Paid in full by the suggestions' rule: short by no more than PPh 23,
      // which the receipt journal books as a prepayment.
      const full = paysInFull(a.share, a.item.amount);
      recordReceipt(a.item.invoiceId, { amount: a.share, date: ex.date, lineId: ex.lineId, by: user.name, paysInFull: full });
      receipts.push({
        invoiceId: a.item.invoiceId, customerName: a.item.counterparty, cash: a.share,
        withheld: full && a.share < a.item.amount ? a.item.amount - a.share : 0,
      });
      return full ? a.item.invoiceId : `${a.item.invoiceId} (part-paid, ${restOf(a)})`;
    });
    const refs = [...records.map((a) => (a.full ? a.item.ref : `${a.item.ref} (${restOf(a)})`)), ...settled].join(" + ");
    const together = lines.length > 1 ? ` together with ${lines.length - 1} other bank line${lines.length === 2 ? "" : "s"}` : "";
    let note = `Matched manually${together} to ${refs} by ${user.name}.`;
    // Receipts and any booked difference go into one draft; matching never
    // posts. Records already in the books need nothing.
    if (diff) note += ` Rp ${fmtRp(Math.abs(diff.amount))} difference to ${diff.accountCode}.`;
    const draftId = draftForMatch({ lines, receipts, diff, refs });
    if (draftId) note += DRAFTED;
    const res = {
      action: "manual-match", at: TODAY_ISO, by: user.name, note, matchId: primary.id,
      recordIds: records.map((a) => a.item.id),
      // How much of each record this match used; the rest stays matchable.
      recordAlloc: Object.fromEntries(records.map((a) => [a.item.id, a.share])),
      journals: records.map((a) => a.item.ref),
      invoiceIds: invs.map((a) => a.item.invoiceId),
      ...(diff ? { difference: { accountCode: diff.accountCode, amount: diff.amount } } : {}),
      ...(draftId ? { draftId, pendingJournal: true } : {}),
      ...(lines.length > 1 ? { group: lines.map((l) => l.id), receiptLineId: primary.lineId } : {}),
    };
    resolveMany(Object.fromEntries(lines.map((l) => [l.id, res])));
    showToast(note);
    return res;
  }

  // ── To match ───────────────────────────────────────────────────────────────

  // The Klay side of To match is what a person could still pair a line with:
  // not what Klay already proposes for a line in Need confirmation (that record
  // is spoken for — confirming or reconciling that line manually is where it
  // gets decided), and nothing dated after the statement ends, which cannot be
  // on it. A line moved here by Reconcile manually frees its suggestion.
  const { matchCandidates, spokenFor } = useMemo(() => {
    if (!run) return { matchCandidates: [], spokenFor: 0 };
    const claimed = new Set();
    for (const e of run.exceptions) {
      if (!isOpen(e) || !e.suggestion || e.manual) continue;
      if (e.suggestion.recordId) claimed.add(e.suggestion.recordId);
      if (e.suggestion.invoiceId) claimed.add(`inv:${e.suggestion.invoiceId}`);
    }
    const through = run.statement.through;
    const inWindow = manualCandidates.filter((r) => !through || r.date <= through);
    const free = inWindow.filter((r) => !claimed.has(r.id));
    return { matchCandidates: free, spokenFor: inWindow.length - free.length };
  }, [run, manualCandidates]);

  const matchLines = byTab.tomatch.filter((e) => selLines.has(e.id));
  const matchRecords = matchCandidates.filter((r) => selRecords.has(r.id));
  const matchBankTotal = matchLines.reduce((s, l) => s + l.amount, 0);
  const matchBal = matchBalance(matchBankTotal, matchRecords, { diffAcct, mode: matchMode });
  const toggleIn = (setter) => (id) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // What Match would draft, for the bar to show before anything happens: the
  // same allocation and receipt rules as reconcileLines, without side effects.
  const matchPreview = useMemo(() => {
    if (!matchLines.length || !matchRecords.length || !matchBal.balanced) return null;
    const diff = matchBal.booking ? { accountCode: diffAcct, amount: matchBal.left } : null;
    const alloc = allocate(matchBankTotal - (diff?.amount || 0), matchRecords).filter((a) => a.share !== 0 && a.item.kind === "invoice");
    const receipts = alloc.map((a) => ({
      invoiceId: a.item.invoiceId, customerName: a.item.counterparty, cash: a.share,
      withheld: paysInFull(a.share, a.item.amount) && a.share < a.item.amount ? a.item.amount - a.share : 0,
    }));
    const entry = matchEntry({ account, date: matchLines[0].date, description: "", refs: "", receipts, diff });
    return entry ? entry.lines : null;
  }, [matchLines, matchRecords, matchBal, diffAcct, matchBankTotal, account]);

  function onMatchReconcile() {
    if (!matchLines.length || !matchBal.balanced) return;
    reconcileLines(matchLines, matchRecords, matchBal.booking ? { accountCode: diffAcct, amount: matchBal.left } : null);
    clearMatch();
  }

  function onMatchExclude(reason) {
    if (!matchLines.length) return;
    const res = excludeRes(reason);
    resolveMany(Object.fromEntries(matchLines.map((l) => [l.id, res])));
    showToast(`${matchLines.length} line${matchLines.length === 1 ? "" : "s"} excluded. Restore from Excluded.`);
    clearMatch();
  }

  // The Klay side of a suggestion: what the engine thinks the bank line is,
  // with its own date and amount so the two can be read against each other.
  const invoiceById = useMemo(() => Object.fromEntries(invoices.map((i) => [i.id, i])), [invoices]);
  function klayOf(ex) {
    const s = ex.suggestion;
    if (ex.detector === "EXACT_AMOUNT") {
      const r = recordById[s.recordId];
      return {
        date: r?.date, amount: r?.amount ?? ex.amount, ref: s.ref,
        refSub: s.billId && s.billId !== s.ref ? s.billId : null,
        sub: `${r?.kind === "je" ? "Journal" : ex.amount < 0 ? "Payment" : "Receipt"} · ${s.party || s.label}`,
        // The basis already opens with "Exact amount".
        why: ex.basis ? null : "Same amount",
      };
    }
    if (ex.detector === "INVOICE_EXACT" || ex.detector === "INVOICE_RANGE") {
      return {
        date: invoiceById[s.invoiceId]?.date, amount: s.subtotal, ref: s.invoiceId,
        sub: `Open invoice · ${s.customerName}`,
        why: (s.basis === "exact" ? "Same as invoice subtotal" : `${pctOf(s)} ${s.diff < 0 ? "under" : "over"} invoice subtotal`)
          + (s.paysInFull ? "" : " · leaves a balance open"),
      };
    }
    if (ex.detector === "PPH_WITHHOLDING") {
      return {
        date: null, amount: ex.amount, ref: ex.billId,
        sub: `Bill · ${ex.vendorName}`,
        why: "Bill less 2% PPh 23 · paid outside Klay, no approved payment request", tone: "warn",
      };
    }
    return { date: null, amount: null, ref: "—", sub: ex.brief || "", why: "" };
  }


  // Rupiah per tab, over the whole statement rather than the search results.
  const tabMoney = Object.fromEntries(TABS.map((t) => [t.k, 0]));
  for (const e of run?.exceptions || []) tabMoney[tabOf(e)] += Math.abs(e.amount);

  // The tab's one-tap action, named for exactly what it covers.
  const strong = byTab.confirm.filter((e) => e.strength === "strong");
  // Ticked journals that are still on the list (a posted one drops off).
  const journalsPicked = byTab.journals.filter((j) => selJournals.has(j.id));
  const selOf = (items) => {
    const n = items.filter((j) => selJournals.has(j.id)).length;
    return {
      all: n > 0 && n === items.length,
      some: n > 0,
      toggleAll: () => setSelJournals((prev) => {
        const next = new Set(prev);
        const on = items.every((j) => next.has(j.id));
        for (const j of items) if (on) next.delete(j.id); else next.add(j.id);
        return next;
      }),
    };
  };
  const toggleJournal = (id) => setSelJournals((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Post all stays at the top for the common case; the tick boxes are for a
  // chosen few.
  const bulk =
    activeTab === "journals" && byTab.journals.length > 1
      ? { action: "post-journal", items: byTab.journals, label: `Post all ${byTab.journals.length} journals`, ok: perm.canPost, why: WHY_NOT.post }
      : activeTab === "confirm" && strong.length > 0
        ? { action: "primary", items: strong, label: `Confirm ${strong.length} strong match${strong.length === 1 ? "" : "es"}`, ok: perm.canMatch, why: WHY_NOT.match }
        : null;


  return (
    <Perm.Provider value={perm}>
    <div className="lg-page bank-recon-page">
      <div className="lg-scroll-container">
        <div className="bank-recon-hero">
          <div className="lg-head">
            <div className="lg-head-top">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 className="lg-title">Bank Reconciliation</h1>
              </div>
              <div className="lg-head-actions">
                <button className="lg-btn-brand" onClick={() => setUploadOpen(true)}>
                  <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Upload statement
                </button>
              </div>
            </div>
          </div>

          <div className="bank-period-wrap">
            <div className="bank-month" ref={monthMenuRef}>
              <button type="button" className="bank-month-btn" onClick={() => setMonthMenuOpen((v) => !v)} aria-expanded={monthMenuOpen}>
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" /><line x1="1.5" y1="5.5" x2="12.5" y2="5.5" /><line x1="4.5" y1="1" x2="4.5" y2="3.5" /><line x1="9.5" y1="1" x2="9.5" y2="3.5" />
                </svg>
                <strong>{monthName(period)}</strong>
                {period === CURRENT_PERIOD && <span className="bank-month-tag">Current</span>}
                <svg viewBox="0 0 12 12" className="bank-month-caret" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="3 5 6 8 9 5" />
                </svg>
              </button>
              {monthMenuOpen && (
                <div className="bank-filter-pop bank-month-pop">
                  {PERIODS.map((p) => {
                    const st = monthStatus[p];
                    const done = st.total > 0 && st.done === st.total;
                    return (
                      <button key={p} type="button" className={`bank-filter-pop-item${p === period ? " active" : ""}`} onClick={() => { setPeriod(p); setMonthMenuOpen(false); }}>
                        <span className="bank-filter-pop-label">{monthName(p)}{p === CURRENT_PERIOD && <span className="bank-month-tag">Current</span>}</span>
                        <span className={`bank-month-state${done ? " done" : ""}`}>{done ? "Reconciled" : `${st.done} of ${st.total} accounts`}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="bank-accts-progress" title="An account is reconciled once every line on its statement is decided.">
              <span className="bank-accts-progress-lbl">
                <strong>{accountsDone}</strong> of {inScope.length} accounts reconciled
                {allLeft > 0 && <> · <strong>{fmtShort(allLeft)}</strong> left across all accounts</>}
              </span>
              <span className="recon-bar" aria-hidden>
                <span className="recon-bar-seg reconciled" style={{ width: `${inScope.length ? (accountsDone / inScope.length) * 100 : 0}%` }} />
              </span>
            </div>
          </div>

          <div className="bank-carousel-row">
            <div className="bank-carousel">
              {(() => {
                const selectedIn = filteredAccounts.find((r) => r.accountId === selectedAccount);
                let visible = filteredAccounts.slice(0, 3);
                if (selectedIn && !visible.some((r) => r.accountId === selectedAccount)) {
                  visible = [selectedIn, ...filteredAccounts.slice(0, 2)];
                }
                const remaining = filteredAccounts.length - visible.length;
                return (
                  <>
                    {visible.map((r) => (
                      <AccountCard key={r.accountId} run={r} selected={selectedAccount === r.accountId} onSelect={setSelectedAccount} />
                    ))}
                    {remaining > 0 && (
                      <button type="button" className="bank-card bank-card-more" onClick={() => setAccountListOpen(true)}>
                        <div className="bank-card-more-icon">
                          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="3" cy="7" r="1" /><circle cx="7" cy="7" r="1" /><circle cx="11" cy="7" r="1" />
                          </svg>
                        </div>
                        <div className="bank-card-more-val">+{remaining}</div>
                        <div className="bank-card-more-lbl">more accounts</div>
                        <div className="bank-card-more-cta">View all →</div>
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {run?.balanceCheck && !run.balanceCheck.ok && (
          <div className="recon-balance-warn">{run.balanceCheck.message}</div>
        )}

        <div className="lg-table-wrap">
          <div className="lg-card recon-card">
            {run?.statement.loaded && run.counts.total > 0 && (
              <div className="bp-tabs-row">
                {TABS.map((t) => (
                  <button key={t.k} type="button" className={`bp-tab${activeTab === t.k ? " active" : ""}`} onClick={() => setTab(t.k)}>
                    {t.lbl}
                    <span className="bp-tab-count">{tabCount[t.k]}</span>
                  </button>
                ))}
              </div>
            )}
            {/* To match carries these filters on its own two panes. */}
            {activeTab !== "tomatch" && (
            <div className="lg-filter-row">
              {!UNFILTERED_TABS.has(activeTab) && <Segmented label="Bank" options={DIRECTIONS} value={dir} onChange={pickDir} />}
              <div className="lg-klay-bar">
                <span className="lg-klay-bar-icon" aria-hidden><SparkleIcon /></span>
                <input
                  className="lg-klay-bar-input"
                  placeholder="Search the statement — a vendor, a customer, an amount, a reference"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setSearch(""); } }}
                />
                {search && (
                  <button type="button" className="lg-klay-chips-clear" onClick={() => setSearch("")}>Clear</button>
                )}
              </div>
              {bulk && (
                <button type="button" className="recon-group-batch" disabled={!bulk.ok} title={bulk.ok ? undefined : bulk.why} onClick={() => onBatch(bulk.action, bulk.items)}>
                  {bulk.label}
                </button>
              )}
            </div>
            )}

            {run?.statement.awaitingUpload ? (
              <div className="recon-empty recon-awaiting">
                <div className="recon-awaiting-title">No statement for {account?.name} yet</div>
                <div>Upload the {monthName(period).split(" ")[0]} statement and Klay reads every line and matches it against the books. It can be uploaded again later in the month — each upload adds what&rsquo;s new.</div>
                <button type="button" className="lg-btn-brand" onClick={() => setUploadOpen(true)}>Upload statement</button>
              </div>
            ) : !run?.statement.loaded ? (
              <div className="recon-empty">
                {reconcilable(account)
                  ? <>No statement loaded for {account?.name}. Upload one to reconcile this account.</>
                  : <>{account?.name} has no GL account mapped in Settings → Bank Accounts, so there is nothing to reconcile a statement against.</>}
              </div>
            ) : run.counts.total === 0 ? (
              <div className="recon-empty">
                No transactions on the {run.statementLabel} statement for {account?.name}.
              </div>
            ) : activeTab === "tomatch" ? (
              <MatchPanels
                lines={byTab.tomatch}
                candidates={matchCandidates}
                spokenFor={spokenFor}
                onRestore={(ex) => onAction("restore", ex)}
                dir={dir}
                onDir={pickDir}
                cat={cat}
                onCat={setCat}
                selLines={selLines}
                selRecords={selRecords}
                onToggleLine={toggleIn(setSelLines)}
                onToggleRecord={toggleIn(setSelRecords)}
                onSetLines={(ids) => setSelLines(new Set(ids))}
              />
            ) : (
              <div className="recon-groups" role="table">
                {tabCount[activeTab] > 0 && (activeTab === "journals" ? <JournalHead sel={selOf(byTab.journals)} /> : activeTab === "confirm" ? <ConfirmHead /> : <TableHead />)}
                {activeTab === "confirm" && CONFIRM_SECTIONS.map((sec) => (
                  <Section key={sec.k} items={byTab.confirm.filter(sec.test)}
                    render={(ex) => <ConfirmRow key={ex.id} ex={ex} onAction={onAction} klay={{ ...klayOf(ex), cat: categoryOfLine(ex, recordById) }} />} />
                ))}
                {activeTab === "journals" && JOURNAL_SECTIONS.map((sec) => (
                  <Section key={sec.k} label={sec.lbl} items={byTab.journals.filter(sec.test)} sel={selOf(byTab.journals.filter(sec.test))}
                    render={(ex) => <JournalRow key={ex.id} ex={ex} onAction={onAction} draftOf={draftOf} selected={selJournals.has(ex.id)} onToggle={toggleJournal} />} />
                ))}
                {activeTab === "excluded" && (
                  <Section items={byTab.excluded} render={(ex) => <ExcludedRow key={ex.id} ex={ex} onAction={onAction} />} />
                )}
                {activeTab === "reconciled" && (
                  <Section items={byTab.reconciled} render={(ex) => <ReconciledRow key={ex.id} ex={ex} onAction={onAction} cat={categoryOfLine(ex, recordById)} />} />
                )}
                {byTab[activeTab].length === 0 && (
                  <div className="recon-empty">
                    {tabCount[activeTab] > 0 ? "Nothing here matches this tab's filters." : activeTab === "reconciled" ? "Nothing reconciled yet. A line is reconciled once it is matched and any journal it needs is posted." : activeTab === "excluded" ? "Nothing excluded. Exclude a line that needs no Klay record — say, one the statement printed twice." : "Nothing here."}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer — bank against books ──────────────────────────────── */}
      {activeTab === "journals" && journalsPicked.length > 0 ? (
        <div className="lg-footer rm-bar">
          <div className="rm-bar-figs">
            <span className="rm-bar-fig">
              <span className="lg-footer-lbl">Selected</span>
              <span className="lg-footer-total">{journalsPicked.length} journal{journalsPicked.length === 1 ? "" : "s"}</span>
            </span>
            <span className="rm-bar-fig">
              <span className="lg-footer-lbl">Bank lines</span>
              <span className="lg-footer-total">{fmtShort(journalsPicked.reduce((t, j) => t + Math.abs(j.amount), 0))}</span>
            </span>
            {!perm.canPost && <span className="rm-bar-hint">{WHY_NOT.post}.</span>}
          </div>
          <div className="lg-footer-right">
            <button type="button" className="lg-footer-bulk-btn" onClick={() => setSelJournals(new Set())}>Clear</button>
            <button type="button" className="rm-bar-go" disabled={!perm.canPost} title={perm.canPost ? undefined : WHY_NOT.post}
              onClick={() => { onBatch("post-journal", journalsPicked); setSelJournals(new Set()); }}>
              Post {journalsPicked.length} journal{journalsPicked.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      ) : activeTab === "tomatch" && run?.statement.loaded ? (
        <MatchBar
          canMatch={perm.canMatch}
          preview={matchPreview}
          lineCount={matchLines.length}
          recordCount={matchRecords.length}
          balance={matchBal}
          diffAccounts={reconDifferenceAccounts}
          diffAcct={diffAcct}
          onDiffAcct={setDiffAcct}
          mode={matchMode}
          onMode={setMatchMode}
          onReconcile={onMatchReconcile}
          onExclude={onMatchExclude}
          onClear={clearMatch}
        />
      ) : (
      <div className="lg-footer">
        <div className="lg-footer-left">
          {[
            ["confirm", "to confirm"],
            ["tomatch", "to match"],
            ["journals", "journals to post"],
            ["reconciled", "reconciled"],
            ...(tabCount.excluded ? [["excluded", "excluded"]] : []),
          ].map(([k, lbl], i) => (
            <span key={k} className="recon-foot-item">
              {i > 0 && <span className="lg-footer-sep">·</span>}
              <span><span className="lg-footer-num">{tabCount[k]}</span> {lbl}</span>
              {tabMoney[k] > 0 && <span className="recon-foot-amt">{fmtShort(tabMoney[k])}</span>}
            </span>
          ))}
        </div>
        <div className="lg-footer-right">
          <span className="lg-footer-lbl">Opening</span>
          <span className="lg-footer-total">Rp {fmtRp(run?.statement.openingBalance)}</span>
          <span className="lg-footer-sep">·</span>
          <span className="lg-footer-lbl">Closing per bank</span>
          <span className="lg-footer-total">Rp {fmtRp(run?.statement.closingBalance)}</span>
        </div>
      </div>
      )}

      {accountListOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setAccountListOpen(false)} />
          <div className="drawer bank-accounts-list-drawer">
            <div className="drawer-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="drawer-title">All bank accounts</div>
                <div className="drawer-sub">{runs.length} accounts · most to resolve first</div>
              </div>
              <button className="drawer-close" onClick={() => setAccountListOpen(false)} aria-label="Close">
                <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
              </button>
            </div>
            <div className="drawer-body">
              {[...runs]
                .sort((a, b) => b.counts.blocking - a.counts.blocking || b.counts.open - a.counts.open || a.account.name.localeCompare(b.account.name))
                .map((r) => (
                  <button
                    key={r.accountId}
                    type="button"
                    className={`bank-list-item${selectedAccount === r.accountId ? " selected" : ""}`}
                    onClick={() => { setSelectedAccount(r.accountId); setAccountListOpen(false); }}
                  >
                    <div className="bank-list-item-logo" style={{ background: r.account.bankColor }}>{r.account.bank.slice(0, 1)}</div>
                    <div className="bank-list-item-info">
                      <div className="bank-list-item-title">{r.account.name}</div>
                      <div className="bank-list-item-meta">{maskOf(r.account)}</div>
                    </div>
                    <div className="bank-list-item-right">
                      <div className="bank-list-item-amt">Rp {fmtRp(r.statement.closingBalance)}</div>
                      <span className={`bank-list-item-pill ${r.state.tone === "success" ? "ok" : r.state.tone === "muted" ? "empty" : "warn"}`}>
                        {pillLabel(r)}
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </>
      )}

      {journalFor && (
        <ReconJournalModal
          canPost={!postBlock(journalFor)}
          exception={journalFor}
          draft={draftOf(journalFor).draft}
          onSave={onJournalSave}
          onPost={onJournalPost}
          onClose={() => setJournalFor(null)}
        />
      )}
      <UploadModal
        open={uploadOpen}
        account={account}
        run={run}
        period={period}
        onUpload={(info) => markUploaded(account.id, { at: TODAY_ISO, period, ...info })}
        onDone={() => { setUploadOpen(false); setTab(null); showToast(`${account.name} statement uploaded — on file through ${fmtDateShort(run?.statement.through)}.`); }}
        onClose={() => setUploadOpen(false)}
      />
      {toast && <div className="recon-toast">{toast}</div>}
    </div>
    </Perm.Provider>
  );
}
