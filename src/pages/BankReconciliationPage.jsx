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

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./close.css";
import "./bank-reconciliation.css";
import { COMPANY_BANK_ACCOUNTS, bankAccountById, maskOf } from "../data/seed/bankAccounts";
import { periodLabel, CURRENT_PERIOD } from "../data/seed/bankStatement";
import { PERIODS } from "../lib/bankReconHistory";
import { EXCEPTION_TYPES, STRENGTHS, isOpen, countOf, paysInFull, subtotalOf } from "../lib/bankMatching";
import { runReconciliation, stateOf, reconcilable } from "../lib/bankRecon";
import { draftEntry, draftProblem, postedEntry, postedNote, differenceEntry } from "../lib/reconJournal";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePayments } from "../state/PaymentsContext";
import { useInvoices } from "../state/InvoicesContext";
import { useBankRecon } from "../state/BankReconContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import ManualMatchModal from "../components/ManualMatchModal";
import ReconJournalModal from "../components/ReconJournalModal";
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
// Every row is a line from the bank statement, so the tabs always add up to
// the statement:
//
//   Review journals     a bank fee or interest nothing in Klay raises; Klay
//                       drafted the journal and wants it posted or edited
//   Need confirmation   Klay suggests which record or invoice the line is
//   Not reconciled      Klay has no suggestion; a person has to look
//   Marked for later    parked, and still holding the month open
//   Reconciled          decided by someone

const JOURNAL_DETECTORS = new Set(["FEE_PATTERN", "INTEREST_CREDIT"]);
const CONFIRM_DETECTORS = new Set(["EXACT_AMOUNT", "INVOICE_EXACT", "INVOICE_RANGE", "PPH_WITHHOLDING", ...JOURNAL_DETECTORS]);

function tabOf(ex) {
  if (ex.resolution?.action === "mark-later") return "later";
  if (ex.resolution) return "reconciled";
  if (JOURNAL_DETECTORS.has(ex.detector)) return "journals";
  return CONFIRM_DETECTORS.has(ex.detector) ? "confirm" : "unreconciled";
}

const TABS = [
  { k: "journals",     lbl: "Review journals" },
  { k: "confirm",      lbl: "Need confirmation" },
  { k: "unreconciled", lbl: "Not reconciled" },
  { k: "later",        lbl: "Marked for later" },
  { k: "reconciled",   lbl: "Reconciled" },
];

// Need confirmation is grouped by how strong the match is (STRENGTHS in
// lib/bankMatching.js), strongest first. Every line still needs a yes; the
// grouping says where to look hardest. Strong matches can be confirmed in one
// tap.
const CONFIRM_SECTIONS = [
  { k: "strong", lbl: STRENGTHS.strong.label, blurb: "Exact amount and nothing else fits.",
    batch: { action: "primary", label: (n) => (n === 1 ? "Confirm" : `Confirm all ${n}`) } },
  { k: "likely", lbl: STRENGTHS.likely.label, blurb: "One fact is missing — check the detail before confirming." },
  { k: "weak",   lbl: STRENGTHS.weak.label,   blurb: "Only the amount is close. Look at these before confirming." },
].map((sec) => ({ ...sec, test: (e) => (e.strength || "weak") === sec.k }));

// Review journals is grouped by what the journal is for; both kinds come in
// bulk, so each can be posted in one tap.
const JOURNAL_SECTIONS = [
  { k: "fee",      lbl: "Bank fees",     test: (e) => e.detector === "FEE_PATTERN" },
  { k: "interest", lbl: "Bank interest", test: (e) => e.detector === "INTEREST_CREDIT" },
].map((sec) => ({ ...sec, batch: { action: "post-journal", label: (n) => (n === 1 ? "Post" : `Post all ${n}`) } }));

// ── Account card ─────────────────────────────────────────────────────────────

// Name, number, balance and how far along it is — the bank, the statement
// period and the state are already said elsewhere on the page.
function AccountCard({ run, selected, onSelect }) {
  const { account, counts, statement } = run;
  const scoped = statement.loaded && reconcilable(account);
  const done = scoped && counts.open === 0;

  return (
    <button
      type="button"
      className={`bank-card${selected ? " selected" : ""}${!scoped ? " empty" : ""}`}
      onClick={() => onSelect(account.id)}
      aria-pressed={selected}
    >
      <div className="bank-card-head">
        <div className="bank-card-logo" style={{ background: account.bankColor }}>{account.bank.slice(0, 1)}</div>
        <div className="bank-card-id">
          <div className="bank-card-title">{account.name}</div>
          <div className="bank-card-no">{maskOf(account)}</div>
        </div>
      </div>
      <div className="bank-card-amt">Rp {fmtRp(statement.closingBalance)}</div>
      {scoped ? (
        <div className="bank-card-progress">
          <span className="recon-bar sm" aria-hidden>
            <span className="recon-bar-seg reconciled" style={{ width: `${counts.total ? (counts.reconciled / counts.total) * 100 : 100}%` }} />
          </span>
          <span className={`bank-card-count${done ? " done" : ""}`}>
            {done ? "Reconciled" : <><strong>{fmtShort(openMoney(run.exceptions).total)}</strong> left</>}
          </span>
        </div>
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
      <div className="recon-td-acts">
        {actions.map(({ a, label, kind }) => (
          <button
            key={a}
            type="button"
            className={kind === "link" ? "recon-crow-later" : `recon-ex-btn${kind === "primary" ? " primary" : ""}`}
            onClick={() => onAction(a, ex)}
          >
            {label}
          </button>
        ))}
      </div>
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

// What goes in the Journal no. and Matching result cells for a line that has
// not been decided.
function openCells(ex, draftOf) {
  const s = ex.suggestion;
  switch (ex.detector) {
    case "EXACT_AMOUNT":
      return {
        journal: s.ref,
        result: <Result head="Same amount" sub={[s.billId && s.billId !== s.ref ? s.billId : null, s.party || s.label].filter(Boolean).join(" · ")} />,
      };
    case "INVOICE_EXACT":
    case "INVOICE_RANGE":
      return {
        journal: <span className="recon-td-none">—</span>,
        result: (
          <Result
            head={s.basis === "exact" ? "Same as invoice subtotal" : `${pctOf(s)} ${s.diff < 0 ? "under" : "over"} invoice subtotal`}
            sub={`${s.invoiceId} · ${s.customerName}${s.paysInFull ? "" : " · leaves a balance open"}`}
          />
        ),
      };
    case "PPH_WITHHOLDING":
      return {
        journal: <span className="recon-td-none">—</span>,
        result: <Result tone="warn" head="Bill less 2% PPh 23" sub={`${ex.billId} · ${ex.vendorName} · not recorded in Klay`} />,
      };
    case "FEE_PATTERN":
    case "INTEREST_CREDIT": {
      const d = draftOf(ex);
      return {
        journal: <span className="recon-td-draft">Draft{d.edited ? " · edited" : ""}</span>,
        result: (
          <Result
            head={ex.detector === "FEE_PATTERN" ? "Bank fee" : "Bank interest"}
            sub={[...d.draft.lines].sort((x, y) => Number(!!y.debit) - Number(!!x.debit)).map((l) => `${l.debit ? "Dr" : "Cr"} ${l.account_code}`).join(" · ")}
          />
        ),
      };
    }
    case "DUPLICATE_PAYMENT":
      return { journal: <span className="recon-td-none">—</span>, result: <Result tone="danger" head="Possible duplicate" sub={ex.brief} /> };
    case "VA_UNREGISTERED":
      return { journal: <span className="recon-td-none">—</span>, result: <Result tone="danger" head="No match" sub={`VA ${ex.vaNumber} not in the registry`} /> };
    default:
      return {
        journal: <span className="recon-td-none">—</span>,
        result: <Result tone="warn" head="No match" sub={ex.counterparty ? `Nothing in Klay with this amount · names ${ex.counterparty}` : "Nothing in Klay with this amount"} />,
      };
  }
}

const PRIMARY = {
  EXACT_AMOUNT: { a: "reconcile", label: "Reconcile" },
  INVOICE_EXACT: { a: "reconcile", label: "Reconcile" },
  INVOICE_RANGE: { a: "reconcile", label: "Reconcile" },
  PPH_WITHHOLDING: { a: "record-payment", label: "Record payment" },
  FEE_PATTERN: { a: "post-journal", label: "Post" },
  INTEREST_CREDIT: { a: "post-journal", label: "Post" },
};

// ── The journal table ────────────────────────────────────────────────────────
//
// Date · Bank statement line · Debit · Credit · Amount · Actions. A journal is
// checked account by account, so the accounts get columns of their own rather
// than being squeezed into a matching-result cell.

function JournalHead() {
  return (
    <div className="recon-trow recon-jrow recon-thead" role="row">
      <div role="columnheader">Date</div>
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

function JournalRow({ ex, onAction, draftOf }) {
  const [open, setOpen] = useState(false);
  const { draft, edited } = draftOf(ex);
  const actions = [
    { a: "post-journal", label: "Post", kind: "primary" },
    { a: "edit-journal", label: "Edit" },
    { a: "mark-later", label: "Later", kind: "link" },
  ];
  return (
    <div className="recon-trow recon-jrow" role="row">
      <div className="recon-td-date">{fmtDateShort(ex.date)}</div>
      <button type="button" className="recon-td-line" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Show Klay's reasoning">
        <span className="recon-td-desc">{ex.description}</span>
        {edited && <span className="recon-td-draft">Edited</span>}
        {open && <span className="recon-td-more">{ex.explanation}</span>}
      </button>
      <div className="recon-td-result"><JournalSide lines={draft.lines.filter((l) => l.debit)} /></div>
      <div className="recon-td-result"><JournalSide lines={draft.lines.filter((l) => l.credit)} /></div>
      <div className="recon-td-amt">{fmtAmt(ex.amount)}</div>
      <div className="recon-td-acts">
        {actions.map(({ a, label, kind }) => (
          <button key={a} type="button" className={kind === "link" ? "recon-crow-later" : `recon-ex-btn${kind === "primary" ? " primary" : ""}`} onClick={() => onAction(a, ex)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// An undecided line — suggested, not reconciled, or parked.
function OpenRow({ ex, onAction, draftOf }) {
  const parked = ex.resolution?.action === "mark-later";
  const primary = PRIMARY[ex.detector];
  const journal = JOURNAL_DETECTORS.has(ex.detector);
  const actions = [
    ...(primary ? [{ ...primary, kind: "primary" }] : []),
    ...(journal ? [{ a: "edit-journal", label: "Edit" }] : [{ a: "manual-match", label: "Reconcile manually" }]),
    parked ? { a: "unmark", label: "Move back", kind: "link" } : { a: "mark-later", label: "Later", kind: "link" },
  ];
  const cells = openCells(ex, draftOf);
  const result = (
    <>
      {cells.result}
      {ex.basis && <span className="recon-res-basis">{ex.basis}</span>}
      {parked && <span className="recon-res-note">{ex.resolution.note}</span>}
    </>
  );
  return <TableRow ex={ex} onAction={onAction} actions={actions} journal={cells.journal} result={result} />;
}

// A decided line and what decided it. Reconciling only links records, so it
// can be undone; a posted journal is reversed in the journal instead — which
// includes a manual reconciliation that booked a difference.
const UNDOABLE = new Set(["reconcile", "manual-match"]);
const RESOLVED_HEAD = { "post-journal": "Journal posted", reconcile: "Reconciled", "manual-match": "Reconciled manually" };
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
      result={<Result tone="ok" head={RESOLVED_HEAD[r.action] || "Reconciled"} sub={r.note} />}
    />
  );
}

function Section({ title, blurb, items, batch, onBatch, render }) {
  if (!items.length) return null;
  return (
    <div className="recon-section">
      {title && (
        <div className="recon-section-head">
          <span className="recon-section-title">{title}</span>
          <span className="recon-group-count">{items.length}</span>
          {blurb && <span className="recon-section-blurb">{blurb}</span>}
          {batch && (
            <button type="button" className="recon-group-batch" onClick={() => onBatch(batch.action, items)}>
              {batch.label(items.length)}
            </button>
          )}
        </div>
      )}
      {items.map(render)}
    </div>
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────
//
// Statements are seeded rather than parsed, so this reports what the run found
// instead of pretending to read a file. The opening-balance check is real: it
// is the one guard that catches a page missing from a PDF.

function UploadModal({ open, run, onClose }) {
  const [phase, setPhase] = useState("picker");
  useEffect(() => { if (!open) setPhase("picker"); }, [open]);
  useEffect(() => {
    if (phase !== "processing") return;
    const t = setTimeout(() => setPhase("done"), 1400);
    return () => clearTimeout(t);
  }, [phase]);
  if (!open || !run) return null;

  const { counts, balanceCheck, account, statement } = run;

  return (
    <div className="bank-upload-backdrop" onClick={onClose}>
      <div className="bank-upload-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bank-upload-head">
          <span className="bank-upload-icon" aria-hidden><SparkleIcon /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">
              {phase === "picker" && "Upload bank statement"}
              {phase === "processing" && "Reading the statement"}
              {phase === "done" && `${account.name} · ${run.statementLabel}`}
            </div>
            <div className="bank-upload-sub">
              {phase === "picker" && `${account.name} · ${periodLabel(statement.period)} statement. CSV, PDF or MT940 — Klay detects the bank from the file.`}
              {phase === "processing" && "Extracting transactions, then looking for what each one is"}
              {phase === "done" && `${statement.lines.length} transactions`}
            </div>
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>
        <div className="bank-upload-body">
          {phase === "picker" && (
            <button type="button" className="bank-upload-drop" onClick={() => setPhase("processing")}>
              <strong>Choose a file or drop it here</strong>
              <span>BCA, Mandiri, BRI and BNI exports are recognised without column mapping.</span>
            </button>
          )}
          {phase === "processing" && <div className="bank-upload-proc">Reading {statement.lines.length} lines…</div>}
          {phase === "done" && (
            <div className="bank-upload-done">
              <div className={`bank-upload-balance ${balanceCheck.ok ? "ok" : "warn"}`}>{balanceCheck.message}</div>
              <div className="bank-upload-stat"><strong>{counts.open - counts.blocking}</strong> with a suggestion to confirm</div>
              <div className="bank-upload-stat"><strong>{counts.blocking}</strong> need you</div>
              <div className="bank-upload-fields">
                Read from the statement: date, amount, in/out, description and balances. Suggestions rest on the amount;
                a name read out of the description only breaks a tie.
              </div>
              <button type="button" className="lg-btn-brand" onClick={onClose}>Start reconciling</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BankReconciliationPage() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const { payments: allPayments } = usePayments();
  const { invoices, recordReceipt, undoReceipt } = useInvoices();

  const [selectedAccount, setSelectedAccount] = useState("bca-op");
  const [accountListOpen, setAccountListOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // The statement line being reconciled by hand, or null.
  const [manualFor, setManualFor] = useState(null);
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
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  // Decisions live in a context, not here. The engine is a pure function of the
  // statement and the ledger; what a person decided is laid over the top. They
  // sit outside this component because the close board asks the same question.
  const { resolutions, drafts, resolve, unresolve, resolveMany, saveDraft } = useBankRecon();
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
      const exceptions = run.exceptions.map((e) => (resolutions[e.id] ? { ...e, resolution: resolutions[e.id] } : e));
      const withRes = { ...run, exceptions };
      return { ...withRes, state: stateOf(withRes, run.statement), counts: countOf(run.lines, exceptions), pending: run };
    },
    [livePayments, resolutions],
  );

  const runs = useMemo(() => COMPANY_BANK_ACCOUNTS.map((a) => overlaid(a.id, period)).filter(Boolean), [overlaid, period]);

  // Each month's standing, for the month menu.
  const monthStatus = useMemo(() => Object.fromEntries(PERIODS.map((p) => {
    const scoped = COMPANY_BANK_ACCOUNTS.map((a) => overlaid(a.id, p)).filter((r) => r && r.statement.loaded && reconcilable(r.account));
    return [p, { done: scoped.filter((r) => r.counts.open === 0).length, total: scoped.length }];
  })), [overlaid]);
  const runById = useMemo(() => Object.fromEntries(runs.map((r) => [r.accountId, r])), [runs]);
  const run = runById[selectedAccount];
  const account = run?.account || bankAccountById(selectedAccount);

  const filteredAccounts = runs;

  // Across accounts: one with a statement is reconciled once every line on it
  // is decided. Accounts with no statement or no GL account are not counted.
  const inScope = runs.filter((r) => r.statement.loaded && reconcilable(r.account));
  const accountsDone = inScope.filter((r) => r.counts.open === 0).length;
  const allLeft = inScope.reduce((sum, r) => sum + openMoney(r.exceptions).total, 0);

  const byTab = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (e) =>
      !q ||
      [e.title, e.explanation, e.brief, e.description, e.counterparty, e.resolution?.note, String(Math.abs(e.amount))]
        .some((v) => (v || "").toLowerCase().includes(q));
    const out = { confirm: [], journals: [], unreconciled: [], later: [], reconciled: [] };
    for (const e of run?.exceptions || []) if (match(e)) out[tabOf(e)].push(e);
    const rank = (e) => EXCEPTION_TYPES[e.type]?.rank ?? 9;
    out.unreconciled.sort((a, b) => rank(a) - rank(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }, [run, search]);

  const tabCount = Object.fromEntries(TABS.map((t) => [t.k, byTab[t.k].length]));
  const activeTab = tab || ["journals", "confirm", "unreconciled", "later"].find((k) => tabCount[k] > 0) || "reconciled";
  // A new account starts again from the first tab with work in it.
  useEffect(() => { setTab(null); }, [selectedAccount, period]);

  // The journal a fee or interest line would post: the one somebody edited, or
  // Klay's draft from the account mapping.
  const draftOf = useCallback(
    (ex) => (drafts[ex.id] ? { draft: drafts[ex.id], edited: true } : { draft: draftEntry({ exception: ex, account }), edited: false }),
    [drafts, account],
  );

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
    if (s.kind === "invoice") {
      recordReceipt(s.invoiceId, { amount: ex.amount, date: ex.date, lineId: ex.lineId, by: user.name, paysInFull: s.paysInFull });
      const outcome = s.paysInFull ? `${s.invoiceId} is paid` : `${s.invoiceId} is part-paid`;
      return { action: "reconcile", at: TODAY_ISO, by: user.name, invoiceIds: [s.invoiceId], note: `Reconciled to ${s.invoiceId} by ${user.name}. ${outcome}.` };
    }
    return { action: "reconcile", at: TODAY_ISO, by: user.name, recordIds: [s.recordId], journals: [s.ref], note: `Reconciled to ${s.ref}${s.billId && s.billId !== s.ref ? ` (${s.billId})` : ""} by ${user.name}.` };
  }

  function decide(action, ex, jeNumber) {
    if (action === "record-payment" && ex.billId) { navigate(`/bills/${ex.billId}?tab=payment`); return null; }
    if (action === "manual-match") { setManualFor(ex); return null; }
    if (action === "edit-journal") { setJournalFor(ex); return null; }
    if (action === "post-journal") return postJournal(ex, draftOf(ex).draft, jeNumber);
    if (action === "reconcile" && ex.suggestion) return reconcileSuggestion(ex);
    if (action === "mark-later") {
      return { action, at: TODAY_ISO, by: user.name, note: `Marked for later by ${user.name}. Still open — the account isn't reconciled until it's decided.` };
    }
    return null;
  }

  function onAction(action, ex) {
    if (action === "unmark") { unresolve(ex.id); showToast("Moved back."); return; }
    if (action === "undo") {
      unresolve(ex.id);
      if (ex.resolution?.invoiceIds?.length) undoReceipt(ex.lineId);
      showToast(`Undone — the ${fmtDateShort(ex.date)} line is back in ${CONFIRM_DETECTORS.has(ex.detector) ? "Need confirmation" : "Not reconciled"}.`);
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
    items.forEach((ex) => {
      const a = action === "primary" ? PRIMARY[ex.detector]?.a : action;
      if (!a || a === "record-payment") return;
      // Only journals take a number, so the sequence advances per journal.
      const res = decide(a, ex, bump(base, a === "post-journal" ? n++ : n));
      if (res) next[ex.id] = res;
    });
    if (!Object.keys(next).length) return;
    resolveMany(next);
    const done = Object.keys(next).length;
    const js = (k) => `${k} journal${k === 1 ? "" : "s"} posted`;
    showToast(n === done ? `${js(n)}.` : `${done} lines reconciled${n ? `, ${js(n)}` : ""}.`);
  }

  function onJournalSave(draft) {
    saveDraft(journalFor.id, draft);
    setJournalFor(null);
    showToast("Draft saved. Post it when it's right.");
  }

  function onJournalPost(draft) {
    const ex = journalFor;
    saveDraft(ex.id, draft);
    const res = postJournal(ex, draft, peekNextJeNumber());
    if (!res) return;
    resolve(ex.id, res);
    setJournalFor(null);
    showToast(res.note);
  }

  // What Reconcile manually can offer: records on this account and open
  // invoices that no decided line has claimed. Suggestions for other lines are
  // not decisions, so their records stay available.
  const manualCandidates = useMemo(() => {
    if (!run) return [];
    const usedRecords = new Set();
    const usedInvoices = new Set();
    for (const e of run.exceptions) {
      const r = e.resolution;
      if (!r || r.action === "mark-later") continue;
      (r.recordIds || []).forEach((id) => usedRecords.add(id));
      (r.invoiceIds || []).forEach((id) => usedInvoices.add(id));
    }
    const records = (run.records || []).filter((r) => !usedRecords.has(r.id));
    const open = invoices
      .filter((i) => i.approval === "sent" && i.payStatus !== "paid" && !usedInvoices.has(i.id))
      .map((i) => ({
        id: `inv:${i.id}`, kind: "invoice", invoiceId: i.id, ref: i.id, billId: null,
        counterparty: i.customerName, label: `Invoice to ${i.customerName}`, amount: subtotalOf(i), date: i.date,
      }));
    return [...records, ...open];
  }, [run, invoices]);

  // `diff` is { accountCode, amount } when the person booked the gap between
  // the bank line and the records to a difference account; amount is signed
  // like the statement.
  function onManualMatch(picked, diff = null) {
    const ex = manualFor;
    if (!ex) return;
    const records = picked.filter((r) => r.kind !== "invoice");
    const invs = picked.filter((r) => r.kind === "invoice");
    // What the records account for: the bank line, less any booked difference.
    const settledAmount = ex.amount - (diff?.amount || 0);
    // Split what arrived across the invoices by subtotal, the last taking the
    // rounding, and settle each by the same rule the suggestions use.
    const totalSub = invs.reduce((s, r) => s + r.amount, 0);
    let left = settledAmount - records.reduce((s, r) => s + r.amount, 0);
    const settled = invs.map((r, i) => {
      const share = i === invs.length - 1 ? left : Math.round((settledAmount * r.amount) / totalSub);
      left -= share;
      const full = paysInFull(share, r.amount);
      recordReceipt(r.invoiceId, { amount: share, date: ex.date, lineId: ex.lineId, by: user.name, paysInFull: full });
      return `${r.invoiceId}${full ? "" : " (part-paid)"}`;
    });
    const refs = [...records.map((r) => r.ref), ...settled].join(" + ");
    let note = `Reconciled manually to ${refs} by ${user.name}.`;
    let je = null;
    if (diff) {
      // Same closed-month rule as fee and interest journals.
      const postDate = isLocked(ex.date) ? openPostDate : null;
      je = differenceEntry({
        exception: ex, account, diff: diff.amount, accountCode: diff.accountCode,
        refs, jeNumber: peekNextJeNumber(), by: user.name, today: TODAY_ISO, postDate,
      });
      addJournalEntry(je);
      note += ` Rp ${fmtRp(Math.abs(diff.amount))} difference booked to ${diff.accountCode} in ${je.je_number}.`;
    }
    resolve(ex.id, {
      action: "manual-match", at: TODAY_ISO, by: user.name, note,
      recordIds: records.map((r) => r.id),
      journals: [...records.map((r) => r.ref), ...(je ? [je.je_number] : [])],
      invoiceIds: invs.map((r) => r.invoiceId),
      ...(je ? { jeNumber: je.je_number, difference: { accountCode: diff.accountCode, amount: diff.amount } } : {}),
    });
    setManualFor(null);
    showToast(note);
  }


  const left = openMoney(run?.exceptions);
  // Rupiah per tab, over the whole statement rather than the search results.
  const tabMoney = Object.fromEntries(TABS.map((t) => [t.k, 0]));
  for (const e of run?.exceptions || []) tabMoney[tabOf(e)] += Math.abs(e.amount);

  const openRow = (ex) => <OpenRow key={ex.id} ex={ex} onAction={onAction} draftOf={draftOf} />;

  return (
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

        {/* ── Selected account: state, and the finish line ──────────────── */}
        <div className="recon-acct-head">
          <div className="recon-acct-title">
            <strong>{account?.name}</strong>
            <span className="close-meta-sep">·</span>
            {run?.statementLabel}
            <span className="close-meta-sep">·</span>
            {run?.statement.lines.length || 0} transactions
          </div>
          <div className="recon-acct-right">
            {left.total > 0 && (
              <span className="recon-left">
                <span className="recon-left-main"><strong>{fmtShort(left.total)}</strong> left to reconcile</span>
                <span className="recon-left-split">{fmtShort(left.moneyIn)} in · {fmtShort(left.moneyOut)} out</span>
              </span>
            )}
            <span className={`recon-state-pill ${run?.state.tone}`}>{run?.state.label}</span>
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
            <div className="lg-filter-row">
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
            </div>

            {!run?.statement.loaded ? (
              <div className="recon-empty">
                {reconcilable(account)
                  ? <>No statement loaded for {account?.name}. Upload one to reconcile this account.</>
                  : <>{account?.name} has no GL account mapped in Settings → Bank Accounts, so there is nothing to reconcile a statement against.</>}
              </div>
            ) : run.counts.total === 0 ? (
              <div className="recon-empty">
                No transactions on the {run.statementLabel} statement for {account?.name}.
              </div>
            ) : (
              <div className="recon-groups" role="table">
                {tabCount[activeTab] > 0 && (activeTab === "journals" ? <JournalHead /> : <TableHead />)}
                {activeTab === "confirm" && CONFIRM_SECTIONS.map((sec) => (
                  <Section key={sec.k} title={sec.lbl} blurb={sec.blurb} items={byTab.confirm.filter(sec.test)} batch={sec.batch} onBatch={onBatch} render={openRow} />
                ))}
                {activeTab === "journals" && JOURNAL_SECTIONS.map((sec) => (
                  <Section key={sec.k} title={sec.lbl} items={byTab.journals.filter(sec.test)} batch={sec.batch} onBatch={onBatch}
                    render={(ex) => <JournalRow key={ex.id} ex={ex} onAction={onAction} draftOf={draftOf} />} />
                ))}
                {activeTab === "unreconciled" && (
                  <Section items={byTab.unreconciled} render={openRow} />
                )}
                {activeTab === "later" && (
                  <Section items={byTab.later} render={openRow} />
                )}
                {activeTab === "reconciled" && (
                  <Section items={byTab.reconciled} render={(ex) => <ReconciledRow key={ex.id} ex={ex} onAction={onAction} />} />
                )}
                {tabCount[activeTab] === 0 && (
                  <div className="recon-empty">
                    {search ? "Nothing here matches the search." : activeTab === "reconciled" ? "Nothing reconciled yet. Every line waits for a person to confirm it." : "Nothing here."}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer — bank against books ──────────────────────────────── */}
      <div className="lg-footer">
        <div className="lg-footer-left">
          {[
            ["reconciled", "reconciled"],
            ["journals", "journals to review"],
            ["confirm", "to confirm"],
            ["unreconciled", "not reconciled"],
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

      {manualFor && (
        <ManualMatchModal
          line={manualFor}
          candidates={manualCandidates}
          diffAccounts={reconDifferenceAccounts}
          onConfirm={onManualMatch}
          onClose={() => setManualFor(null)}
        />
      )}
      {journalFor && (
        <ReconJournalModal
          exception={journalFor}
          draft={draftOf(journalFor).draft}
          onSave={onJournalSave}
          onPost={onJournalPost}
          onClose={() => setJournalFor(null)}
        />
      )}
      <UploadModal open={uploadOpen} run={run?.pending || run} onClose={() => setUploadOpen(false)} />
      {toast && <div className="recon-toast">{toast}</div>}
    </div>
  );
}
