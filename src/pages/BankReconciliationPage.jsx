// Bank Reconciliation — every statement line, reconciled by a person.
//
// Nothing is reconciled automatically. For each line the engine
// (lib/bankMatching.js) either suggests what it is — a cash journal of the
// same amount on this account, or a bank fee or interest with its journal
// already drafted — or says it found nothing. A person confirms the
// suggestion, matches the line by hand, or marks it for later.
//
// Rules kept deliberately:
//
//   No confidence scores. Every suggestion carries a sentence built from the
//   record's own numbers. "Exact amount · the only record with it" is
//   checkable; "93%" is an invitation to accept something you have not read.
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
import { EXCEPTION_TYPES, isOpen, countOf } from "../lib/bankMatching";
import { runReconciliation, stateOf, reconcilable } from "../lib/bankRecon";
import { draftEntry, draftProblem, postedEntry, postedNote, differenceEntry } from "../lib/reconJournal";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePayments } from "../state/PaymentsContext";
import { useBankRecon } from "../state/BankReconContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { MatchPanels, MatchBar, LaterButton, Segmented } from "../components/ReconMatchView";
import { matchBalance, allocate, DIRECTIONS, inDirection } from "../lib/manualMatch";
import ReconJournalModal from "../components/ReconJournalModal";
import QuickDraftModal from "../components/QuickDraftModal";
import { balancesOf } from "../lib/bankBalance";
import { bookRecordsFor } from "../lib/bankLedger";
import { useBills } from "../state/BillsContext";
import { useVendors } from "../state/VendorsContext";
import { useCustomers } from "../state/CustomersContext";
import { useInvoices } from "../state/InvoicesContext";
import { auditTextFor, breakdownTotal } from "../lib/paymentBreakdown";
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
// Each tab is a stage, and every bank line is in exactly one of them. The work
// sits on the left, in the order it is done; the two "done" tabs sit apart on
// the right, one for each way a line gets finished:
//
//   To reconcile      Klay suggests which cash journal on this account the
//                     line is, shown bank side | Klay side
//   To match          Klay has no suggestion; a person pairs the line with
//                     cash journals in a side-by-side view. A line with no
//                     cash journal in Klay has nothing to pair with yet
//   To post           bank charges and interest, each with the journal Klay
//                     drafted. Posting it is what finishes the line
//   Marked for later  parked, not decided — it still holds the account open
//   ── done ──
//   Reconciled        matched to a cash journal
//   Posted            a bank charge or interest whose journal is posted
//
// A posted journal is never undone here; it is reversed in the GL, and the
// line comes back to where it started. An account is reconciled once every
// line is Reconciled or Posted.

const NO_FILTER = { dir: "all", search: "" };
// No Money in/out chips: Reconciled is a record read top to bottom, and To
// reconcile is worked strongest-first with its search box.
const UNFILTERED_TABS = new Set(["reconciled", "confirm"]);

const JOURNAL_DETECTORS = new Set(["FEE_PATTERN", "INTEREST_CREDIT", "INTEREST_TAX"]);
// A bill paid from the bank but never recorded (PPH_WITHHOLDING) has nothing
// in Klay to match yet, so it waits in To match until its payment is recorded.
const CONFIRM_DETECTORS = new Set(["EXACT_AMOUNT"]);

function tabOf(ex) {
  if (ex.resolution?.action === "later") return "later";
  if (ex.resolution?.action === "post-journal") return "posted";
  if (ex.resolution) return "reconciled";
  // Its suggestion was set aside to match it by hand.
  if (ex.manual) return "tomatch";
  // A fee or interest line — its journal not posted yet, or posted and then
  // reversed in the GL — waits in To post.
  if (JOURNAL_DETECTORS.has(ex.detector)) return "journals";
  return CONFIRM_DETECTORS.has(ex.detector) ? "confirm" : "tomatch";
}

const TABS = [
  { k: "confirm",      lbl: "To reconcile" },
  { k: "tomatch",      lbl: "To match" },
  { k: "journals",     lbl: "To post" },
  { k: "later",        lbl: "Marked for later" },
  // Done — right-aligned.
  { k: "reconciled",   lbl: "Reconciled", done: true },
  { k: "posted",       lbl: "Posted",     done: true },
];

// To reconcile is ordered by how strong the match is (STRENGTHS in
// lib/bankMatching.js), strongest first. The strength itself is never shown —
// each row's basis line says in words why it sits where it does. Every line
// still needs a yes; Reconcile all gives it to every row in view at once.
const CONFIRM_SECTIONS = ["strong", "likely", "weak"].map((k) => ({ k, test: (e) => (e.strength || "weak") === k }));

// To post: the bank's own charges and interest, drafted when the statement
// loads. Posting one reconciles its line.
const JOURNAL_SECTIONS = [
  { k: "fees",     lbl: "Bank charges", test: (e) => e.detector === "FEE_PATTERN" },
  { k: "interest", lbl: "Interest",     test: (e) => e.detector !== "FEE_PATTERN" },
];

// ── Who may do what ──────────────────────────────────────────────────────────
//
// One capability, bank.reconcile, covers the whole page: matching and
// reconciling lines, and posting the journals reconciliation writes (bank
// charges and interest, booked differences, quick drafts). It does not need
// gl.post — those journals exist only to explain a bank line. Quick draft
// alone is also open to bank.quick_draft (Finance Manager): it posts the
// journal, but matching and reconciling it still needs bank.reconcile.
// `postBlock(row)` says why this person can't post this particular journal, or
// null: only the capability — Enforced and Relaxed segregation of duties treat
// the page alike.
const Perm = createContext({ canMatch: true, canPost: true, postBlock: () => null });
const NEEDS = { "post-journal": "post", reconcile: "match", "manual-match": "match", undo: "match", later: "match", "move-back": "match", restore: "match" };
const WHY_NOT = {
  post: "Needs the Reconcile bank permission",
  match: "Needs the Reconcile bank permission",
};
const allowed = (perm, a) => {
  const need = NEEDS[a];
  return !need || (need === "post" ? perm.canPost : perm.canMatch);
};

// ── Account card ─────────────────────────────────────────────────────────────

// The selected card is the page's header — there is no second strip
// repeating it above the table.
// Name, number, state, then the account's ending balance by the bank and by
// Klay, and the difference (lib/bankBalance.js) — hover it for what explains
// it. No progress figures — the state pill says whether there is work left.
function BalanceRows({ bal }) {
  const why = bal.diff == null ? undefined
    : `${bal.notInKlay.n} bank line${bal.notInKlay.n === 1 ? "" : "s"} not in Klay yet: ${fmtAmt(bal.notInKlay.amount)}\n`
      + `${bal.notOnBank.n} Klay entr${bal.notOnBank.n === 1 ? "y" : "ies"} not on the statement yet: ${fmtAmt(bal.notOnBank.amount)}`
      + (bal.explained ? "\nThe difference is fully explained by these." : "");
  return (
    <div className="bank-card-bals">
      <span className="bank-card-bal-lbl">Bank</span>
      <span className="bank-card-bal">{bal.bank == null ? "No statement" : `Rp ${fmtRp(bal.bank)}`}</span>
      <span className="bank-card-bal-lbl">Klay</span>
      <span className="bank-card-bal">Rp {fmtRp(bal.klay)}</span>
      {bal.diff != null && (
        <>
          <span className="bank-card-bal-lbl">Diff</span>
          <span className={`bank-card-bal diff${bal.diff === 0 ? " zero" : ""}`} title={why}>{fmtAmt(bal.diff)}</span>
        </>
      )}
    </div>
  );
}

function AccountCard({ run, bal, selected, onSelect }) {
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
      {bal ? <BalanceRows bal={bal} /> : <div className="bank-card-amt">Rp {fmtRp(statement.closingBalance)}</div>}
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

// A row's buttons, then — on an undecided line — Mark for later. A button the
// person lacks the capability for stays visible, disabled, and says which
// permission it needs.
function RowActions({ ex, actions, onAction, later = false }) {
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
      {later && perm.canMatch && <LaterButton onClick={() => onAction("later", ex)} />}
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

const PRIMARY = {
  EXACT_AMOUNT: { a: "reconcile", label: "Reconcile" },
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
  const actions = [
    { a: "post-journal", label: "Post", kind: "primary" },
    { a: "edit-journal", label: "Edit" },
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
        {edited && <span className="recon-td-draft">Edited</span>}
        {open && <span className="recon-td-more">{ex.explanation}</span>}
      </button>
      <div className="recon-td-result"><JournalSide lines={draft.lines.filter((l) => l.debit)} /></div>
      <div className="recon-td-result"><JournalSide lines={draft.lines.filter((l) => l.credit)} /></div>
      <div className="recon-td-amt">{fmtAmt(ex.amount)}</div>
      <RowActions ex={ex} actions={actions} onAction={onAction} later />
    </div>
  );
}

// ── To reconcile: bank side | Klay side ──────────────────────────────────────
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
          <span className="cf-ref">{klay.ref}{klay.refSub && <span className="cf-ref-sub"> · {klay.refSub}</span>}</span>
          <span className="recon-res-sub" title={klay.sub}>{klay.sub}</span>
          <span className="cf-why-line">
            {klay.why && <span className={`cf-why ${klay.tone || ""}`}>{klay.why}</span>}
            {klay.why && ex.basis && " · "}
            {ex.basis && <span className="recon-res-basis">{ex.basis}</span>}
          </span>
        </div>
        <span className="recon-td-amt">{klay.amount == null ? "—" : fmtAmt(klay.amount)}</span>
      </div>
      <RowActions ex={ex} actions={actions} onAction={onAction} later />
    </div>
  );
}

// A reconciled line and how: matched to what the books hold, or its journal
// posted. A match with no journal only links records, so it can be undone; a
// posted journal is reversed in the GL, never undone here.
const UNDOABLE = new Set(["reconcile", "manual-match"]);
const RESOLVED_HEAD = { "post-journal": "Journal posted", reconcile: "Matched", "manual-match": "Matched manually" };
function ReconciledRow({ ex, onAction }) {
  const r = ex.resolution;
  const actions = UNDOABLE.has(r.action) && !r.jeNumber ? [{ a: "undo", label: "Undo", kind: "link" }] : [];
  const journals = r.journals?.length ? r.journals : r.jeNumber ? [r.jeNumber] : [];
  return (
    <TableRow
      ex={ex}
      onAction={onAction}
      actions={actions}
      journal={journals.length ? journals.map((j) => <span key={j} className="recon-td-jeno">{j}</span>) : <span className="recon-td-none">—</span>}
      result={<Result tone="ok" head={RESOLVED_HEAD[r.action] || "Matched"} sub={r.note} />}
    />
  );
}

// A bank charge or interest line whose journal is posted: the entry as it went
// to the ledger, with its number. Reversed in the GL, never undone here.
function PostedRow({ ex, posted }) {
  const [open, setOpen] = useState(false);
  const r = ex.resolution;
  return (
    <div className="recon-trow recon-jrow" role="row">
      <div className="recon-td-date recon-jsel">{fmtDateShort(ex.date)}</div>
      <button type="button" className="recon-td-line" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Show how it was posted">
        <span className="recon-td-desc">{ex.description}</span>
        {r.jeNumber && <span className="recon-td-jeno">{r.jeNumber}</span>}
        {open && <span className="recon-td-more">{r.note}</span>}
      </button>
      <div className="recon-td-result"><JournalSide lines={posted.lines.filter((l) => l.debit)} /></div>
      <div className="recon-td-result"><JournalSide lines={posted.lines.filter((l) => l.credit)} /></div>
      <div className="recon-td-amt">{fmtAmt(ex.amount)}</div>
      <div className="recon-td-acts" />
    </div>
  );
}

// A line parked for later — still open. Move back returns it to where it was.
function LaterRow({ ex, onAction }) {
  return (
    <TableRow
      ex={ex}
      onAction={onAction}
      actions={[{ a: "move-back", label: "Move back", kind: "link" }]}
      journal={<span className="recon-td-none">—</span>}
      result={<Result tone="muted" head="Marked for later" sub={ex.resolution.note} />}
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
  // bank.reconcile covers matching and posting alike (see Perm above).
  const canMatch = hasCapability("bank.reconcile");
  const canPost = canMatch;
  const canQuickDraft = canMatch || hasCapability("bank.quick_draft");
  const { entries: jeEntries, addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { payments: allPayments, recordPayment } = usePayments();
  const { bills, updateBill } = useBills();
  const { vendors } = useVendors();
  const { customers } = useCustomers();
  const { invoices, recordReceipt } = useInvoices();

  const [selectedAccount, setSelectedAccount] = useState("bca-op");
  const [accountListOpen, setAccountListOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // The fee or interest line whose journal is being edited, or null.
  const [journalFor, setJournalFor] = useState(null);
  // The To match line a cash journal is being quick-drafted for, or null.
  const [quickFor, setQuickFor] = useState(null);
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
  // To post: the ticked rows, for posting several at once.
  const [selJournals, setSelJournals] = useState(() => new Set());
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  // Decisions live in a context, not here. The engine is a pure function of the
  // statement and the ledger; what a person decided is laid over the top. They
  // sit outside this component because the close board asks the same question.
  const { resolutions, drafts, manual, reopened, quickDrafts, uploaded, markUploaded, resolve, unresolve, resolveMany, saveDraft, setManualFor, addQuickDraft } = useBankRecon();
  const { isLocked, nextOpenPeriod } = useClosePeriod();
  const { reconDifferenceAccounts } = useAccountingSettings();
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
      // A line whose journal was reversed in the GL carries `reopened` (and
      // `reversed`, for its row's badge).
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

  // Each account's ending balance by the bank and by Klay. An account still
  // waiting for its statement has no run records, so its books are read
  // directly — Klay's side is known before the bank's is.
  const balanceById = useMemo(() => Object.fromEntries(runs
    .filter((r) => reconcilable(r.account) && (r.statement.loaded || r.statement.awaitingUpload))
    .map((r) => {
      const books = r.statement.loaded
        ? r.records
        : bookRecordsFor(r.accountId, { from: r.statement.from, to: r.statement.through, extraPayments: livePayments });
      const quick = Object.values(quickDrafts).filter((q) => q.accountId === r.accountId && q.period === period);
      return [r.accountId, balancesOf({ statement: r.statement, exceptions: r.exceptions, records: [...books, ...quick] })];
    })), [runs, quickDrafts, period, livePayments]);

  // Each month's standing, for the month menu.
  const monthStatus = useMemo(() => Object.fromEntries(PERIODS.map((p) => {
    const scoped = COMPANY_BANK_ACCOUNTS.map((a) => overlaid(a.id, p)).filter((r) => r && (r.statement.loaded || r.statement.awaitingUpload) && reconcilable(r.account));
    return [p, { done: scoped.filter((r) => r.state.key === "RECONCILED").length, total: scoped.length }];
  })), [overlaid]);
  const runById = useMemo(() => Object.fromEntries(runs.map((r) => [r.accountId, r])), [runs]);
  const run = runById[selectedAccount];
  // The account's cash journals: the run's, plus any quick-drafted this session.
  const records = useMemo(() => [
    ...(run?.records || []),
    ...Object.values(quickDrafts).filter((r) => r.accountId === selectedAccount && r.period === period),
  ], [run, quickDrafts, selectedAccount, period]);
  const recordById = useMemo(() => Object.fromEntries(records.map((r) => [r.id, r])), [records]);
  const account = run?.account || bankAccountById(selectedAccount);

  const filteredAccounts = runs;

  // Across accounts: one with a statement is reconciled once every line on it
  // is decided. Accounts with no statement or no GL account are not counted.
  // An account still waiting for its statement is in scope and not reconciled.
  const inScope = runs.filter((r) => (r.statement.loaded || r.statement.awaitingUpload) && reconcilable(r.account));
  const accountsDone = inScope.filter((r) => r.state.key === "RECONCILED").length;
  const allLeft = inScope.reduce((sum, r) => sum + openMoney(r.exceptions).total, 0);

  // Every row in its stage, before any filter. Tab counts come from here, so a
  // filter on one tab never changes the number on another.
  const allByTab = useMemo(() => {
    const out = { confirm: [], journals: [], tomatch: [], reconciled: [], posted: [], later: [] };
    for (const e of run?.exceptions || []) out[tabOf(e)].push(e);
    const rank = (e) => EXCEPTION_TYPES[e.type]?.rank ?? 9;
    out.tomatch.sort((a, b) => rank(a) - rank(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }, [run]);

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
  const { dir, search } = filters[activeTab] || NO_FILTER;
  const setTabFilter = (patch) => setFilters((prev) => ({ ...prev, [activeTab]: { ...(prev[activeTab] || NO_FILTER), ...patch } }));
  const setSearch = (v) => setTabFilter({ search: v });
  // Choosing a direction points the Klay filter at what usually moves that
  // way: money in is mostly AR, money out mostly AP. Only a default — interest
  // (Bank) and QRIS takings (Other) are money in too, a tap away.
  const pickDir = (d) => setTabFilter({ dir: d });
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
  const draftOf = useCallback(
    (ex) => drafts[ex.id] ? { draft: drafts[ex.id], edited: true } : { draft: draftEntry({ exception: ex, account }), edited: false },
    [drafts, account],
  );
  // What a posted bank charge or interest line went to the ledger as: the
  // journal itself where it is in the GL, else (an earlier month's, settled
  // before this session) the entry Klay drafts for it.
  const postedOf = (ex) => jeEntries.find((j) => j.je_number === ex.resolution?.jeNumber) || draftOf(ex).draft;

  // ── Who may post this ─────────────────────────────────────────────────────
  //
  // Whoever holds bank.reconcile, under Enforced and Relaxed segregation of
  // duties alike: the one capability covers reconciling and posting, so the
  // person who edits a draft may post it too.
  const postBlock = () => (canPost ? null : WHY_NOT.post);
  const perm = { canMatch, canPost, postBlock };

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
    return { action: "post-journal", at: TODAY_ISO, by: user.name, note: postedNote(ex, je.je_number, user.name) + moved, jeNumber: je.je_number };
  }

  function reconcileSuggestion(ex) {
    const s = ex.suggestion;
    return { action: "reconcile", at: TODAY_ISO, by: user.name, recordIds: [s.recordId], journals: [s.ref], note: `Matched to ${s.ref}${s.billId && s.billId !== s.ref ? ` (${s.billId})` : ""} by ${user.name}.` };
  }

  function decide(action, ex, jeNumber) {
    if (action === "edit-journal") { setJournalFor(ex); return null; }
    if (action === "post-journal") return postJournal(ex, draftOf(ex).draft, jeNumber);
    if (action === "reconcile" && ex.suggestion) return reconcileSuggestion(ex);
    return null;
  }

  // Marked for later: parked, not decided. It still holds the account open.
  const laterRes = () => ({ action: "later", at: TODAY_ISO, by: user.name, note: `Marked for later by ${user.name}.` });

  function onAction(action, ex) {
    if (action === "later") {
      resolve(ex.id, laterRes());
      showToast(`The ${fmtDateShort(ex.date)} line is in Marked for later — it still needs reconciling.`);
      return;
    }
    if (action === "move-back") {
      unresolve(ex.id);
      showToast(`Moved back — the ${fmtDateShort(ex.date)} line is in ${TABS.find((t) => t.k === tabOf({ ...ex, resolution: null }))?.lbl}.`);
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
      showToast("Suggestion restored — the line is back in To reconcile.");
      return;
    }
    if (action === "undo") {
      // Lines matched together come back together.
      const r = ex.resolution || {};
      (r.group || [ex.id]).forEach(unresolve);
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
    let skipped = 0;
    items.forEach((ex) => {
      const a = action === "primary" ? PRIMARY[ex.detector]?.a : action;
      if (!a) return;
      // Journals this person may not post are left for someone who may.
      if (a === "post-journal" && postBlock(ex)) { skipped++; return; }
      // Only journals take a number, so the sequence advances per journal.
      const res = decide(a, ex, bump(base, a === "post-journal" ? n++ : n));
      if (res) next[ex.id] = res;
    });
    const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
    const left = skipped ? ` ${plural(skipped, "journal")} left for someone else to post.` : "";
    if (!Object.keys(next).length) { if (left) showToast(left.trim()); return; }
    resolveMany(next);
    showToast(action === "post-journal"
      ? `${plural(n, "journal")} posted.${left}`
      : `${plural(Object.keys(next).length, "line")} reconciled.`);
  }

  function onJournalSave(draft) {
    saveDraft(journalFor.id, { ...draft, editedBy: user.name });
    setJournalFor(null);
    showToast("Draft saved. Post it when it's right.");
  }

  function onJournalPost(draft) {
    const ex = journalFor;
    saveDraft(ex.id, { ...draft, editedBy: user.name });
    const res = postJournal(ex, draft, peekNextJeNumber());
    if (!res) return;
    resolve(ex.id, res);
    setJournalFor(null);
    showToast(res.note);
  }

  // What a line could be matched to by hand: the cash journals on this account,
  // each at what is still unmatched on it. A record matched in part (a payment
  // whose second transfer has not arrived) stays with the rest. Suggestions
  // for other lines are not decisions, so their records stay available.
  const manualCandidates = useMemo(() => {
    if (!run) return [];
    const used = {};
    const seen = new Set();
    for (const e of run.exceptions) {
      const r = e.resolution;
      if (!r || r.action === "later") continue;
      // Lines matched together share one decision — count it once.
      const key = r.matchId || e.id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.recordAlloc) for (const [id, amt] of Object.entries(r.recordAlloc)) used[id] = (used[id] || 0) + amt;
      else for (const id of r.recordIds || []) used[id] = recordById[id]?.amount || 0;
    }
    return records.flatMap((r) => {
      const rest = r.amount - (used[r.id] || 0);
      if (Math.abs(rest) < 1) return [];
      return used[r.id] ? [{ ...r, amount: rest, original: r.amount }] : [r];
    });
  }, [run, records, recordById]);

  // Matches bank lines to cash journals by hand, from To match. `diff` is
  // { accountCode, amount } when the person booked the gap to a difference
  // account; amount is signed like the statement, and its journal is posted
  // with the match. Without one, a shortfall stays open on the Klay items
  // (lib/manualMatch.js). Several lines matched together share one decision;
  // undoing any of them undoes all of them.
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
    const records = allocate(settledAmount, picked).filter((a) => a.share !== 0);
    const restOf = (a) => `Rp ${fmtRp(Math.abs(a.item.amount - a.share))} left open`;
    const refs = records.map((a) => (a.full ? a.item.ref : `${a.item.ref} (${restOf(a)})`)).join(" + ");
    const together = lines.length > 1 ? ` together with ${lines.length - 1} other bank line${lines.length === 2 ? "" : "s"}` : "";
    let note = `Matched manually${together} to ${refs} by ${user.name}.`;
    // A booked difference is posted with the match — the bar showed it first.
    let je = null;
    if (diff) {
      const entry = differenceEntry({ account, date: primary.date, description: lines.map((l) => l.description).join(" + "), refs, diff });
      const pseudo = { amount: diff.amount, lineId: primary.lineId };
      const problem = draftProblem(entry, pseudo);
      if (problem) { showToast(problem); return null; }
      const postDate = isLocked(entry.je_date) ? openPostDate : null;
      je = postedEntry({ draft: entry, exception: pseudo, jeNumber: peekNextJeNumber(), by: user.name, today: TODAY_ISO, postDate });
      addJournalEntry(je);
      note += ` Rp ${fmtRp(Math.abs(diff.amount))} difference posted to ${diff.accountCode} as ${je.je_number}.`;
    }
    const res = {
      action: "manual-match", at: TODAY_ISO, by: user.name, note, matchId: primary.id,
      recordIds: records.map((a) => a.item.id),
      // How much of each record this match used; the rest stays matchable.
      recordAlloc: Object.fromEntries(records.map((a) => [a.item.id, a.share])),
      journals: [...records.map((a) => a.item.ref), ...(je ? [je.je_number] : [])],
      ...(diff ? { difference: { accountCode: diff.accountCode, amount: diff.amount }, jeNumber: je.je_number } : {}),
      ...(lines.length > 1 ? { group: lines.map((l) => l.id) } : {}),
    };
    resolveMany(Object.fromEntries(lines.map((l) => [l.id, res])));
    showToast(note);
    return res;
  }

  // ── To match ───────────────────────────────────────────────────────────────

  // The Klay side of To match is what a person could still pair a line with:
  // not what Klay already proposes for a line in To reconcile (that record
  // is spoken for — confirming or reconciling that line manually is where it
  // gets decided), and nothing dated after the statement ends, which cannot be
  // on it. A line moved here by Reconcile manually frees its suggestion.
  const { matchCandidates, spokenFor } = useMemo(() => {
    if (!run) return { matchCandidates: [], spokenFor: 0 };
    const claimed = new Set();
    for (const e of run.exceptions) {
      if (!isOpen(e) || !e.suggestion || e.manual) continue;
      if (e.suggestion.recordId) claimed.add(e.suggestion.recordId);
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

  // Every journal Reconcile would post, for the bar to show before
  // anything happens: today only a booked difference.
  const matchPreview = useMemo(() => {
    if (!matchLines.length || !matchRecords.length || !matchBal.balanced || !matchBal.booking) return null;
    const entry = differenceEntry({ account, date: matchLines[0].date, description: "", refs: "", diff: { accountCode: diffAcct, amount: matchBal.left } });
    return entry ? [{ jeNumber: peekNextJeNumber(), lines: entry.lines }] : null;
  }, [matchLines, matchRecords, matchBal, diffAcct, account, peekNextJeNumber]);

  function onMatchReconcile() {
    if (!matchLines.length || !matchBal.balanced) return;
    reconcileLines(matchLines, matchRecords, matchBal.booking ? { accountCode: diffAcct, amount: matchBal.left } : null);
    clearMatch();
  }

  // ── Quick draft ──────────────────────────────────────────────────────────
  //
  // Posts the cash journal a To match line was missing (components/
  // QuickDraftModal.jsx says what each type writes). The journal then sits on
  // the Klay side, ticked next to its line — reconciling the two is still a
  // person's Reconcile, the same as any manual match.
  function onQuickPost(p) {
    const line = quickFor;
    const by = user.name;
    const base = { accountId: account.id, period, date: line.date, amount: line.amount, counterparty: p.party, quick: true, lineId: line.lineId };
    let record;
    if (p.kind === "bill-payment") {
      const index = allPayments[p.bill.id]?.history?.length || 0;
      const jeBy = recordPayment([{ id: p.bill.id, breakdown: p.breakdown, paysInFull: p.full, date: line.date, fromBank: { lineId: line.lineId, accountId: account.id } }], by, { unapproved: true });
      const open = p.bill.sisa != null ? p.bill.sisa : p.bill.total;
      updateBill(p.bill.id, p.full ? { pay: "paid", sisa: 0 } : { sisa: open - breakdownTotal(p.breakdown) }, {
        type: "paid", by, date: line.date, time: "",
        action: `${auditTextFor(p.breakdown, p.full, { sourceName: account.name })} — recorded from the bank statement without an approval`,
      });
      record = { ...base, id: `${p.bill.id}:${index}`, kind: "ap_payment", ref: jeBy[p.bill.id], label: `Payment to ${p.party}`, billId: p.bill.id };
    } else {
      const postDate = isLocked(line.date) ? openPostDate : null;
      const jeNumber = peekNextJeNumber();
      addJournalEntry({
        je_number: jeNumber, je_date: postDate || line.date, status: "posted", memo: p.memo,
        reference_type: "bank_quick_draft", reference_id: line.lineId,
        created_by: by, created_date: TODAY_ISO, posted_by: by, posted_date: TODAY_ISO,
        lines: p.entry.lines.map((l) => ({ account_code: l.account_code, account_name: l.account_name, debit: l.debit || 0, credit: l.credit || 0, description: l.description || "" })),
      });
      if (p.invoice) recordReceipt(p.invoice.id, { amount: Math.abs(line.amount), date: line.date, lineId: line.lineId, by, paysInFull: p.paysInFull });
      record = { ...base, id: `${jeNumber}:qd`, kind: "je", ref: jeNumber, label: p.memo, contraCodes: [p.contra], billId: null };
    }
    addQuickDraft(record);
    setSelLines(new Set([line.id]));
    setSelRecords(new Set([record.id]));
    setQuickFor(null);
    showToast(canMatch
      ? `${record.ref} posted — it's ticked on the Klay side. Reconcile to finish.`
      : `${record.ref} posted — it's waiting on the Klay side for whoever reconciles the bank.`);
  }

  function onMatchLater() {
    if (!matchLines.length) return;
    const res = laterRes();
    resolveMany(Object.fromEntries(matchLines.map((l) => [l.id, res])));
    showToast(`${matchLines.length} line${matchLines.length === 1 ? "" : "s"} marked for later. Move ${matchLines.length === 1 ? "it" : "them"} back from Marked for later.`);
    clearMatch();
  }

  // The Klay side of a suggestion: what the engine thinks the bank line is,
  // with its own date and amount so the two can be read against each other.
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
    return { date: null, amount: null, ref: "—", sub: ex.brief || "", why: "" };
  }


  // Rupiah per tab, over the whole statement rather than the search results.
  const tabMoney = Object.fromEntries(TABS.map((t) => [t.k, 0]));
  for (const e of run?.exceptions || []) tabMoney[tabOf(e)] += Math.abs(e.amount);

  // The tab's one-tap action, named for exactly what it covers.
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
      : activeTab === "confirm" && byTab.confirm.length > 1
        ? { action: "primary", items: byTab.confirm, label: `Reconcile all ${byTab.confirm.length}`, ok: perm.canMatch, why: WHY_NOT.match }
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
                      <AccountCard key={r.accountId} run={r} bal={balanceById[r.accountId]} selected={selectedAccount === r.accountId} onSelect={setSelectedAccount} />
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
                {TABS.map((t, i) => (
                  <button key={t.k} type="button" className={`bp-tab${activeTab === t.k ? " active" : ""}${t.done ? " recon-tab-done" : ""}${t.done && !TABS[i - 1]?.done ? " recon-tab-done-first" : ""}`} onClick={() => setTab(t.k)}>
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
                selLines={selLines}
                selRecords={selRecords}
                onToggleLine={toggleIn(setSelLines)}
                onToggleRecord={toggleIn(setSelRecords)}
                onSetLines={(ids) => setSelLines(new Set(ids))}
                canQuickDraft={canQuickDraft}
                onQuickDraft={(l) => setQuickFor(l)}
              />
            ) : (
              <div className="recon-groups" role="table">
                {tabCount[activeTab] > 0 && (activeTab === "journals" ? <JournalHead sel={selOf(byTab.journals)} /> : activeTab === "posted" ? <JournalHead /> : activeTab === "confirm" ? <ConfirmHead /> : <TableHead />)}
                {activeTab === "confirm" && CONFIRM_SECTIONS.map((sec) => (
                  <Section key={sec.k} items={byTab.confirm.filter(sec.test)}
                    render={(ex) => <ConfirmRow key={ex.id} ex={ex} onAction={onAction} klay={klayOf(ex)} />} />
                ))}
                {activeTab === "journals" && JOURNAL_SECTIONS.map((sec) => (
                  <Section key={sec.k} label={sec.lbl} items={byTab.journals.filter(sec.test)} sel={selOf(byTab.journals.filter(sec.test))}
                    render={(ex) => <JournalRow key={ex.id} ex={ex} onAction={onAction} draftOf={draftOf} selected={selJournals.has(ex.id)} onToggle={toggleJournal} />} />
                ))}
                {activeTab === "later" && (
                  <Section items={byTab.later} render={(ex) => <LaterRow key={ex.id} ex={ex} onAction={onAction} />} />
                )}
                {activeTab === "reconciled" && (
                  <Section items={byTab.reconciled} render={(ex) => <ReconciledRow key={ex.id} ex={ex} onAction={onAction} />} />
                )}
                {activeTab === "posted" && JOURNAL_SECTIONS.map((sec) => (
                  <Section key={sec.k} label={sec.lbl} items={byTab.posted.filter(sec.test)}
                    render={(ex) => <PostedRow key={ex.id} ex={ex} posted={postedOf(ex)} />} />
                ))}
                {byTab[activeTab].length === 0 && (
                  <div className="recon-empty">
                    {tabCount[activeTab] > 0 ? "Nothing here matches this tab's filters." : activeTab === "reconciled" ? "Nothing reconciled yet. A line is reconciled once it is matched to a cash journal." : activeTab === "posted" ? "Nothing posted yet. Bank charges and interest land here once their journal is posted from To post." : activeTab === "later" ? "Nothing marked for later. Park a line here when it needs looking into — it still has to be reconciled." : "Nothing here."}
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
          canPost={perm.canPost}
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
          onLater={onMatchLater}
          onClear={clearMatch}
        />
      ) : (
      <div className="lg-footer">
        <div className="lg-footer-left">
          {[
            ["confirm", "to reconcile"],
            ["tomatch", "to match"],
            ["journals", "to post"],
            ...(tabCount.later ? [["later", "marked for later"]] : []),
            ["reconciled", "reconciled"],
            ["posted", "posted"],
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

      {quickFor && (
        <QuickDraftModal
          line={quickFor}
          account={account}
          vendors={vendors}
          customers={customers}
          bills={bills}
          invoices={invoices}
          paymentHistoryOf={(id) => allPayments[id]?.history || []}
          canPost={canQuickDraft}
          onPost={onQuickPost}
          onClose={() => setQuickFor(null)}
        />
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
