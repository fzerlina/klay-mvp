// Bank Reconciliation — an exception workspace, not a transaction list.
//
// The screen shows what needs a person and hides what does not. Matched lines
// are behind a toggle and collapsed by default; timing differences are behind
// their own summary line, because a payment that will clear by itself is not
// the Finance Manager's problem and putting it in front of them teaches them to
// scroll past things.
//
// Three rules the earlier prototype broke, kept here deliberately:
//
//   No confidence scores. Every match carries a sentence built from the
//   record's own numbers. "Matched via PPh 23 formula" is checkable; "93%" is
//   an invitation to accept something you have not read.
//
//   Nothing is pre-matched. The engine (lib/bankMatching.js) computes every
//   link on render from the statement and the ledger. There is no `klay: {...}`
//   answer written next to a row.
//
//   Reconciliation ends. There is a finish line, it is disabled until the
//   blocking exceptions are gone, and crossing it is what closes Gate 4 on the
//   close board.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./close.css";
import "./bank-reconciliation.css";
import { COMPANY_BANK_ACCOUNTS, bankAccountById, maskOf } from "../data/seed/bankAccounts";
import { CURRENT_PERIOD, shiftPeriod, periodLabel } from "../data/seed/bankStatement";
import { EXCEPTION_TYPES, isOpen } from "../lib/bankMatching";
import { runReconciliation, stateOf, RECON_STATES, reconcilable } from "../lib/bankRecon";
import { writeOffEntry, writeOffNote } from "../lib/reconJournal";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePayments } from "../state/PaymentsContext";
import { useBankRecon, periodKey } from "../state/BankReconContext";
import { useClosePeriod } from "../state/ClosePeriodContext";
import ManualMatchModal from "../components/ManualMatchModal";
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDateShort(iso) {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]}`;
}

const ACCOUNT_GROUPS = [
  { k: "all", lbl: "All accounts" },
  { k: "operating", lbl: "Operating" },
  { k: "tax", lbl: "Tax" },
  { k: "payroll", lbl: "Payroll" },
  { k: "petty", lbl: "Petty Cash" },
  { k: "fx", lbl: "Foreign Currency" },
  { k: "deposit", lbl: "Deposit / Restricted" },
];

// Past months are open for upload — catching up before Klay, a late statement,
// a re-upload after a missing page. Closed books do not stop a reconciliation;
// they only move where its write-offs are dated (see resolveOne). Future months
// have nothing to upload yet. The range starts in February because the demo
// ledger starts in January with no opening balances behind it.
const PERIODS = [-2, -1, 0, 1, 2].map((n) => {
  const v = shiftPeriod(CURRENT_PERIOD, n);
  return { v, lbl: periodLabel(v), state: n < 0 ? "past" : n === 0 ? "current" : "future" };
});

const fmtIsoLong = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${parseInt(d, 10)} ${periodLabel(`${y}-${m}`).split(" ")[0]} ${y}`;
};

// ── Tabs ─────────────────────────────────────────────────────────────────────
//
// Every row is a line from the bank statement, so the four tabs always add up
// to the statement. Where a line sits depends on whether Klay has an answer:
//
//   Need confirmation   Klay has one and wants a yes — a suggested match, a
//                       fee or interest to write off, a payment made outside
//                       Klay to record
//   Not matched         Klay has none; a person has to look
//   Marked for later    parked with a note, and still holding the month open
//   Matched             matched automatically, or settled by someone

const CONFIRM_DETECTORS = new Set(["NAME_FROM_DESCRIPTION", "WIDENED_WINDOW", "PPH_WITHHOLDING", "FEE_PATTERN", "INTEREST_CREDIT"]);

function tabOf(ex) {
  if (ex.resolution?.action === "mark-later") return "later";
  if (ex.resolution) return "matched";
  return CONFIRM_DETECTORS.has(ex.detector) ? "confirm" : "unmatched";
}

const TABS = [
  { k: "confirm",   lbl: "Need confirmation", blurb: "Klay has an answer for each of these. One tap to confirm, write off or record." },
  { k: "unmatched", lbl: "Not matched",       blurb: "Nothing in Klay explains these lines. Riskiest first." },
  { k: "later",     lbl: "Marked for later",  blurb: "Parked for now. They still hold the month open until they're decided." },
  { k: "matched",   lbl: "Matched",           blurb: "Matched automatically, or settled by someone. Nothing to do." },
];

// Need confirmation is split by the kind of yes being asked for, so the two
// kinds that come in bulk (fees, interest) can be cleared in one tap.
const plural = (n) => (n === 1 ? "" : `all ${n} `);
const CONFIRM_SECTIONS = [
  { k: "suggest",  lbl: "Suggested matches", test: (e) => e.detector === "NAME_FROM_DESCRIPTION" || e.detector === "WIDENED_WINDOW" },
  { k: "outside",  lbl: "Paid outside Klay", test: (e) => e.detector === "PPH_WITHHOLDING" },
  { k: "fee",      lbl: "Bank fees",         test: (e) => e.detector === "FEE_PATTERN",
    batch: { action: "write-off-fee", label: (n) => `Write off ${plural(n)}to Bank Charges` } },
  { k: "interest", lbl: "Interest",          test: (e) => e.detector === "INTEREST_CREDIT",
    batch: { action: "write-off-interest", label: (n) => `Post ${plural(n)}to Interest Income` } },
];

// ── Account card ─────────────────────────────────────────────────────────────

function AccountCard({ run, selected, onSelect }) {
  const { account, state, counts, statement } = run;
  const blocking = counts.blocking;
  const noActivity = statement.loaded && counts.total === 0;
  const notUploaded = run.notUploaded;

  return (
    <button
      type="button"
      className={`bank-card${selected ? " selected" : ""}${noActivity ? " empty" : ""}`}
      onClick={() => onSelect(account.id)}
      aria-pressed={selected}
    >
      <div className="bank-card-head">
        <div className="bank-card-logo" style={{ background: account.bankColor }}>{account.bank.slice(0, 1)}</div>
        <div className="bank-card-id">
          <div className="bank-card-title">{account.name}</div>
          <div className="bank-card-no">{account.bank} · {maskOf(account)}</div>
        </div>
        <span className={`bank-card-pill ${state.tone === "success" ? "ok" : state.tone === "muted" ? "empty" : "warn"}`}>
          {blocking > 0 ? `${blocking} to resolve` : state.label}
        </span>
      </div>
      <div className="bank-card-amt">{notUploaded ? "—" : `Rp ${fmtRp(statement.closingBalance)}`}</div>
      <div className="bank-card-meta">
        {!reconcilable(account)
          ? "no GL account mapped"
          : notUploaded
            ? `${periodLabel(statement.period)} not uploaded`
            : !statement.loaded
            ? "no statement loaded"
            : noActivity
              ? `no activity · ${run.statementLabel}`
              : <>Matched <strong>{counts.matched}</strong> of {counts.total} · {run.statementLabel}</>}
      </div>
    </button>
  );
}

// ── One exception ────────────────────────────────────────────────────────────

const ACTION_LABEL = {
  "record-payment": "Record payment",
  "manual-match": "Match manually",
  "write-off": "Write off",
  "write-off-fee": "Write off to Bank Charges",
  "write-off-interest": "Post to Interest Income",
  "confirm-suggestion": "Confirm match",
  "mark-later": "Mark for later",
  unmark: "Move back",
};

// A match only links two records, so taking it back is safe: the line returns
// to the tab it came from and its records become available again. Write-offs
// are not here — they posted a journal entry, which is reversed in the journal.
const UNDOABLE = new Set(["manual-match", "confirm-suggestion"]);

function ExceptionRow({ ex, onAction, busy }) {
  const meta = EXCEPTION_TYPES[ex.type];
  const parked = ex.resolution?.action === "mark-later";
  const resolved = !!ex.resolution && !parked;
  // A parked line keeps every way of settling it, plus a way back.
  const actions = parked ? [...(ex.actions || []).filter((a) => a !== "mark-later"), "unmark"] : ex.actions || [];

  return (
    <div className={`recon-ex${resolved ? " resolved" : ""} ${meta?.tone || "muted"}`}>
      <div className="recon-ex-head">
        <div className="recon-ex-title">
          {ex.title}
          {ex.detector === "NAME_FROM_DESCRIPTION" && <span className="recon-tag">Name read from description · confirm</span>}
        </div>
        <div className="recon-ex-amt">{fmtAmt(ex.amount)}</div>
        <div className="recon-ex-date">{fmtDateShort(ex.date)}</div>
      </div>
      <div className="recon-ex-why">{ex.explanation}</div>
      {ex.description && ex.description !== ex.title && (
        <div className="recon-ex-raw">{ex.description}</div>
      )}
      {resolved ? (
        <div className="recon-ex-done">
          <svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {ex.resolution.note}
          {UNDOABLE.has(ex.resolution.action) && (
            <button type="button" className="recon-crow-later recon-undo" onClick={() => onAction("undo", ex)}>Undo</button>
          )}
        </div>
      ) : (
        <div className="recon-ex-actions">
          {parked && <div className="recon-ex-parked">{ex.resolution.note}</div>}
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              className={`recon-ex-btn${a.startsWith("write-off") || a.startsWith("confirm") || a === "record-payment" ? " primary" : ""}`}
              disabled={busy}
              onClick={() => onAction(a, ex)}
            >
              {ACTION_LABEL[a] || a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── A Need-confirmation row ──────────────────────────────────────────────────
//
// One line per bank line: what the bank printed, what Klay found, and the one
// action that settles it. The section header already names the kind of item and
// the amount has its own column, so neither is repeated; the full explanation
// opens on click rather than being printed on every row.

const PRIMARY_ACTION = {
  NAME_FROM_DESCRIPTION: "confirm-suggestion",
  WIDENED_WINDOW: "confirm-suggestion",
  PPH_WITHHOLDING: "record-payment",
  FEE_PATTERN: "write-off-fee",
  INTEREST_CREDIT: "write-off-interest",
};
const PRIMARY_LABEL = { "confirm-suggestion": "Confirm", "record-payment": "Record payment", "write-off-fee": "Write off", "write-off-interest": "Post" };

// One bank statement line: date, what the bank printed, amount, and the
// actions in the right-hand column. Click the text for Klay's full reasoning.
function LineRow({ ex, onAction, actions, showBrief = true }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="recon-crow">
      <div className="recon-crow-date">{fmtDateShort(ex.date)}</div>
      <button type="button" className="recon-crow-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="recon-crow-desc">{ex.description}</span>
        {showBrief && ex.brief && <span className="recon-crow-why">{ex.brief}</span>}
        {open && <span className="recon-crow-more">{ex.explanation}</span>}
      </button>
      <div className="recon-crow-amt">{fmtAmt(ex.amount)}</div>
      <div className="recon-crow-acts">
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

function ConfirmRow({ ex, onAction }) {
  const primary = PRIMARY_ACTION[ex.detector];
  const actions = [
    ...(primary ? [{ a: primary, label: PRIMARY_LABEL[primary], kind: "primary" }] : []),
    ...((ex.actions || []).includes("mark-later") ? [{ a: "mark-later", label: "Later", kind: "link" }] : []),
  ];
  return <LineRow ex={ex} onAction={onAction} actions={actions} />;
}

// Not matched: the bank line alone. Klay has no answer, so there is no "what
// Klay found" line to show; the reasoning is one click away.
function UnmatchedRow({ ex, onAction }) {
  const has = (a) => (ex.actions || []).includes(a);
  const actions = [
    ...(has("manual-match") ? [{ a: "manual-match", label: "Match manually" }] : []),
    ...(has("write-off") ? [{ a: "write-off", label: "Write off" }] : []),
    ...(has("mark-later") ? [{ a: "mark-later", label: "Later", kind: "link" }] : []),
  ];
  return <LineRow ex={ex} onAction={onAction} actions={actions} showBrief={false} />;
}

// Marked for later: the same line, the note on who parked it, and a way back.
function ParkedRow({ ex, onAction }) {
  const primary = PRIMARY_ACTION[ex.detector];
  const has = (a) => (ex.actions || []).includes(a);
  const actions = [
    ...(primary ? [{ a: primary, label: PRIMARY_LABEL[primary], kind: "primary" }] : []),
    ...(has("manual-match") ? [{ a: "manual-match", label: "Match manually" }] : []),
    ...(!primary && has("write-off") ? [{ a: "write-off", label: "Write off" }] : []),
    { a: "unmark", label: "Move back", kind: "link" },
  ];
  return <LineRow ex={{ ...ex, brief: ex.resolution?.note }} onAction={onAction} actions={actions} />;
}

function Section({ title, items, batch, onAction, onBatch, Row = ExceptionRow }) {
  if (!items.length) return null;
  const live = items.filter((e) => !e.resolution);
  return (
    <div className="recon-section">
      {(title || batch) && (
        <div className="recon-section-head">
          {title && <span className="recon-section-title">{title}</span>}
          {title && <span className="recon-group-count">{items.length}</span>}
          {batch && live.length > 1 && (
            <button type="button" className="recon-group-batch" onClick={() => onBatch(batch.action, live)}>
              {batch.label(live.length)}
            </button>
          )}
        </div>
      )}
      {items.map((ex) => <Row key={ex.id} ex={ex} onAction={onAction} busy={false} />)}
    </div>
  );
}

// ── Matched lines ────────────────────────────────────────────────────────────

function MatchedList({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="recon-matched">
      {rows.map(({ line, link }) => (
        <div className="recon-matched-row" key={line.id}>
          <div className="recon-matched-date">{fmtDateShort(line.date)}</div>
          <div className="recon-matched-desc">
            {line.description}
            {link.matchType === "KNOWN_NAME" && <span className="recon-tag">Known name</span>}
            <span className="recon-matched-signal">{link.signal}</span>
          </div>
          <div className="recon-matched-ref">{link.record.ref}</div>
          <div className="recon-matched-amt">{fmtAmt(line.amount)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────
//
// Statements are seeded rather than parsed, so this reports what the run found
// instead of pretending to read a file. The opening-balance check is real: it
// is the one guard that catches a page missing from a PDF, which per-line
// matching never would.

function UploadModal({ open, run, onClose, onUploaded }) {
  const [phase, setPhase] = useState("picker");
  useEffect(() => { if (!open) setPhase("picker"); }, [open]);
  useEffect(() => {
    if (phase !== "processing") return;
    const t = setTimeout(() => { setPhase("done"); onUploaded?.(); }, 1400);
    return () => clearTimeout(t);
  }, [phase, onUploaded]);
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
              {phase === "processing" && "Extracting transactions, then matching against the ledger"}
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
          {phase === "processing" && <div className="bank-upload-proc">Matching {statement.lines.length} lines…</div>}
          {phase === "done" && (
            <div className="bank-upload-done">
              <div className={`bank-upload-balance ${balanceCheck.ok ? "ok" : "warn"}`}>{balanceCheck.message}</div>
              <div className="bank-upload-stat"><strong>{counts.matched}</strong> matched automatically</div>
              <div className="bank-upload-stat"><strong>{counts.blocking}</strong> need you</div>
              <div className="bank-upload-fields">
                Read from the statement: date, amount, in/out, description and balances. Names are read out of the
                description; transfer methods come from the payments recorded in Klay.
              </div>
              <button type="button" className="lg-btn-brand" onClick={onClose}>See the exceptions</button>
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

  const [selectedAccount, setSelectedAccount] = useState("bca-op");
  const [accountGroup, setAccountGroup] = useState("all");
  const [groupPopOpen, setGroupPopOpen] = useState(false);
  const groupPopRef = useRef(null);
  const [period, setPeriod] = useState("2025-04");
  const [accountListOpen, setAccountListOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // The statement line being matched by hand, or null.
  const [manualFor, setManualFor] = useState(null);
  // null = let the page pick: the first tab with something in it.
  const [tab, setTab] = useState(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  // Decisions live in a context, not here. The engine is a pure function of the
  // statement and the ledger; what a person decided is laid over the top. They
  // sit outside this component because the close board asks the same question —
  // write off the last fee here and Gate 4 there has to agree.
  const { resolutions, completed, uploaded, resolve, unresolve, resolveMany, markComplete, markUploaded } = useBankRecon();
  const { isLocked, nextOpenPeriod } = useClosePeriod();
  const isCurrent = period === CURRENT_PERIOD;
  // The first open month, for write-offs from a month whose books are closed.
  const openPostDate = `${nextOpenPeriod}-01`;

  useEffect(() => {
    if (!groupPopOpen) return;
    const onDoc = (e) => { if (groupPopRef.current && !groupPopRef.current.contains(e.target)) setGroupPopOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [groupPopOpen]);

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

  // One account in one month, with this session's decisions laid over it. A
  // past month nobody has uploaded yet shows as not uploaded — the statement
  // exists in the seed, but Klay would not have seen it. `pending` keeps the
  // run so the upload modal can report on it.
  const overlaid = useCallback(
    (accountId, p) => {
      const run = runReconciliation(accountId, { extraPayments: livePayments, period: p });
      if (!run) return null;
      if (p !== CURRENT_PERIOD && run.statement.loaded && !uploaded[periodKey(accountId, p)]) {
        const statement = { ...run.statement, loaded: false, lines: [] };
        const empty = { ...run, statement, lines: [], links: [], exceptions: [], outstanding: [], balanceCheck: null };
        return { ...empty, state: stateOf(empty, statement), counts: recount([], []), notUploaded: true, pending: run };
      }
      const exceptions = run.exceptions.map((e) => (resolutions[e.id] ? { ...e, resolution: resolutions[e.id] } : e));
      const withRes = { ...run, exceptions };
      return { ...withRes, state: stateOf(withRes, run.statement), counts: recount(run.lines, exceptions), pending: run };
    },
    [livePayments, resolutions, uploaded],
  );

  // Overlaying re-derives the state from the decisions, so writing off the last
  // open fee moves the account to fully reconciled without anything having to
  // remember to recompute.
  const runs = useMemo(
    () => COMPANY_BANK_ACCOUNTS.map((a) => overlaid(a.id, period)).filter(Boolean),
    [overlaid, period],
  );

  // The month bar's dots: where the selected account stands in each month.
  const periodStatus = useMemo(() => {
    const out = {};
    for (const p of PERIODS) {
      if (p.state === "future") { out[p.v] = { tone: "none", label: "Not started" }; continue; }
      const r = overlaid(selectedAccount, p.v);
      if (!r || !r.statement.from) out[p.v] = { tone: "none", label: "No statement feed" };
      else if (r.notUploaded) out[p.v] = { tone: "none", label: "Not uploaded" };
      else if (completed[periodKey(selectedAccount, p.v)] || r.state.key === "FULLY_RECONCILED") out[p.v] = { tone: "ok", label: "Reconciled" };
      else out[p.v] = { tone: r.counts.blocking > 0 ? "warn" : "open", label: r.state.label };
    }
    return out;
  }, [overlaid, selectedAccount, completed]);

  const runById = useMemo(() => Object.fromEntries(runs.map((r) => [r.accountId, r])), [runs]);
  const run = runById[selectedAccount];
  const account = run?.account || bankAccountById(selectedAccount);

  const filteredAccounts = runs.filter((r) => accountGroup === "all" || r.account.group === accountGroup);

  const byTab = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (e) =>
      !q ||
      e.title.toLowerCase().includes(q) ||
      e.explanation.toLowerCase().includes(q) ||
      (e.description || "").toLowerCase().includes(q) ||
      (e.counterparty || "").toLowerCase().includes(q);
    const out = { confirm: [], unmatched: [], later: [], matched: [] };
    for (const e of run?.exceptions || []) if (match(e)) out[tabOf(e)].push(e);
    const rank = (e) => EXCEPTION_TYPES[e.type]?.rank ?? 9;
    out.unmatched.sort((a, b) => rank(a) - rank(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }, [run, search]);

  const matchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (run?.lines || []).filter(
      (r) => r.link && (!q || r.line.description.toLowerCase().includes(q) || r.link.signal.toLowerCase().includes(q)),
    );
  }, [run, search]);

  const tabCount = {
    confirm: byTab.confirm.length,
    unmatched: byTab.unmatched.length,
    later: byTab.later.length,
    matched: matchedRows.length + byTab.matched.length,
  };
  const activeTab = tab || ["confirm", "unmatched", "later"].find((k) => tabCount[k] > 0) || "matched";
  // A new account or month starts again from the first tab with work in it.
  useEffect(() => { setTab(null); }, [selectedAccount, period]);

  // ── Resolving ──────────────────────────────────────────────────────────────

  function resolveOne(action, ex, jeNumber) {
    if (action === "record-payment" && ex.billId) {
      navigate(`/bills/${ex.billId}?tab=payment`);
      return null;
    }
    if (action === "write-off-fee" || action === "write-off-interest" || action === "write-off") {
      // A line from a month whose books are closed cannot be written off into
      // it; the entry is dated the first day of the first open month instead.
      const postDate = isLocked(ex.date) ? openPostDate : null;
      const { je, error } = writeOffEntry({ exception: ex, account, jeNumber, by: user.name, today: TODAY_ISO, postDate });
      if (error) { showToast(error); return null; }
      addJournalEntry(je);
      const moved = postDate ? ` Dated ${fmtIsoLong(postDate)} — ${periodLabel(ex.date.slice(0, 7))} is closed.` : "";
      return { action, at: TODAY_ISO, by: user.name, note: writeOffNote(ex, je.je_number) + moved, jeNumber: je.je_number };
    }
    if (action === "confirm-suggestion" && ex.suggestion) {
      const learn = ex.suggestion.learnName;
      return {
        action, at: TODAY_ISO, by: user.name,
        note: learn
          ? `Matched to ${ex.suggestion.ref} by ${user.name}. "${learn.raw}" is now a known name for ${learn.name}.`
          : `Matched to ${ex.suggestion.ref} by ${user.name}.`,
      };
    }
    if (action === "mark-later") {
      return { action, at: TODAY_ISO, by: user.name, note: `Marked for later by ${user.name}. Still open — the month can't be marked reconciled until it's decided.` };
    }
    if (action === "manual-match") {
      setManualFor(ex);
      return null;
    }
    return null;
  }

  function onAction(action, ex) {
    if (action === "unmark") {
      unresolve(ex.id);
      showToast("Moved back.");
      return;
    }
    if (action === "undo") {
      unresolve(ex.id);
      showToast(`Match undone — the ${fmtDateShort(ex.date)} line is back in ${CONFIRM_DETECTORS.has(ex.detector) ? "Need confirmation" : "Not matched"}.`);
      return;
    }
    const res = resolveOne(action, ex, peekNextJeNumber());
    if (!res) return;
    resolve(ex.id, res);
    showToast(res.note);
  }

  function onBatch(action, items) {
    const next = {};
    let base = peekNextJeNumber();
    const bump = (n, i) => {
      const m = /^JE-(\d{4})-(\d+)$/.exec(n);
      return m ? `JE-${m[1]}-${String(parseInt(m[2], 10) + i).padStart(4, "0")}` : `${n}-${i}`;
    };
    items.forEach((ex, i) => {
      const res = resolveOne(action, ex, bump(base, i));
      if (res) next[ex.id] = res;
    });
    if (!Object.keys(next).length) return;
    resolveMany(next);
    showToast(`${Object.keys(next).length} resolved.`);
  }

  // What Match manually can offer: records on this account the engine left
  // unclaimed, minus anything a person has already tied to another line.
  const manualCandidates = useMemo(() => {
    if (!run) return [];
    const used = new Set(run.links.map((l) => l.recordId));
    for (const e of run.exceptions) {
      if (e.resolution?.recordIds) e.resolution.recordIds.forEach((id) => used.add(id));
      if (e.resolution?.action === "confirm-suggestion" && e.suggestion) used.add(e.suggestion.recordId);
    }
    return (run.outstanding || []).map((o) => o.record).filter((r) => !used.has(r.id));
  }, [run]);

  function onManualMatch(records) {
    const ex = manualFor;
    if (!ex) return;
    const refs = records.map((r) => r.ref).join(" + ");
    const note = `Matched manually to ${refs} by ${user.name}.`;
    resolve(ex.id, { action: "manual-match", at: TODAY_ISO, by: user.name, note, recordIds: records.map((r) => r.id) });
    setManualFor(null);
    showToast(note);
  }

  const onUploaded = useCallback(() => {
    if (!isCurrent) markUploaded(periodKey(selectedAccount, period), TODAY_ISO);
  }, [isCurrent, markUploaded, selectedAccount, period]);

  const blocking = run?.counts.blocking ?? 0;
  // Parked lines count as open: marking for later is not a decision.
  const openNonTiming = (run?.exceptions || []).filter(isOpen).length;
  const canComplete = run?.statement.loaded && openNonTiming === 0;
  const isComplete = !!completed[periodKey(selectedAccount, period)];
  const booksClosed = isLocked(`${period}-01`);

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
            <div className="lg-period-tabs">
              <div className="lg-pt-arr"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg></div>
              {PERIODS.map((p) => (
                <div
                  key={p.v}
                  className={`lg-pt-tab${p.state === "future" ? " future" : ""}${period === p.v ? " active" : ""}`}
                  onClick={() => { if (p.state !== "future") setPeriod(p.v); }}
                  title={p.state === "future" ? "This month hasn't ended — no statement to upload yet" : `${p.lbl} · ${periodStatus[p.v]?.label || ""}`}
                >
                  {p.state !== "future" && <span className={`bank-pt-dot ${periodStatus[p.v]?.tone || "none"}`} aria-hidden />}
                  {p.lbl}
                </div>
              ))}
              <div className="lg-pt-arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg></div>
            </div>
            <div className="bank-filter-wrap" ref={groupPopRef}>
              <button
                type="button"
                className={`bank-filter-btn${accountGroup !== "all" ? " active" : ""}`}
                onClick={() => setGroupPopOpen((v) => !v)}
                aria-expanded={groupPopOpen}
                title="Filter accounts by group"
              >
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 2.5h11l-4 5v4l-3 1.5v-5.5z" />
                </svg>
                <span className="bank-filter-label">{ACCOUNT_GROUPS.find((g) => g.k === accountGroup)?.lbl || "All"}</span>
                <svg viewBox="0 0 12 12" className="bank-filter-caret" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 5 6 8 9 5" />
                </svg>
              </button>
              {groupPopOpen && (
                <div className="bank-filter-pop">
                  {ACCOUNT_GROUPS.map((g) => {
                    const count = g.k === "all" ? runs.length : runs.filter((r) => r.account.group === g.k).length;
                    const active = accountGroup === g.k;
                    return (
                      <button
                        key={g.k}
                        type="button"
                        className={`bank-filter-pop-item${active ? " active" : ""}`}
                        onClick={() => { setAccountGroup(g.k); setGroupPopOpen(false); }}
                      >
                        <span className="bank-filter-pop-label">{g.lbl}</span>
                        <span className="bank-filter-pop-count">{count}</span>
                        {active && (
                          <svg className="bank-filter-pop-check" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="2 6 5 9 10 3" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
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
            {run?.notUploaded ? periodLabel(period) : run?.statementLabel}
            <span className="close-meta-sep">·</span>
            {run?.statement.lines.length || 0} transactions
          </div>
          <div className="recon-acct-right">
            <span className={`recon-state-pill ${isComplete ? "success" : run?.state.tone}`}>
              {isComplete ? "Reconciliation complete" : run?.state.label}
            </span>
            <button
              type="button"
              className="recon-complete-btn"
              disabled={!canComplete || isComplete}
              title={
                isComplete ? "Already marked complete"
                  : canComplete ? (isCurrent ? "Close Gate 4 for this account" : `Mark ${periodLabel(period)} reconciled`)
                    : `${openNonTiming} item${openNonTiming === 1 ? "" : "s"} still need a decision`
              }
              onClick={() => {
                markComplete(periodKey(selectedAccount, period), TODAY_ISO);
                showToast(isCurrent
                  ? `${account.name} marked reconciled — Gate 4 closed for this account.`
                  : `${account.name} marked reconciled for ${periodLabel(period)}.`);
              }}
            >
              {isComplete ? "Complete" : "Mark reconciliation complete"}
            </button>
          </div>
        </div>

        {run?.balanceCheck && !run.balanceCheck.ok && (
          <div className="recon-balance-warn">{run.balanceCheck.message}</div>
        )}

        {booksClosed && run?.statement.loaded && (
          <div className="recon-closed-note">
            The books for {periodLabel(period)} are closed. Matching works as usual; bank fees and interest written off
            here post on {fmtIsoLong(openPostDate)}, the first open month.
          </div>
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
                  placeholder="Search the exceptions — a vendor, an amount, a reference"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setSearch(""); } }}
                />
                {search && (
                  <button type="button" className="lg-klay-chips-clear" onClick={() => setSearch("")}>Clear</button>
                )}
              </div>
            </div>

            {run?.notUploaded ? (
              <div className="recon-empty">
                No {periodLabel(period)} statement uploaded for {account?.name} yet.{" "}
                <button type="button" className="recon-empty-link" onClick={() => setUploadOpen(true)}>Upload it</button> to reconcile the month.
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
            ) : (
              <div className="recon-groups">
                {activeTab === "confirm" && CONFIRM_SECTIONS.map((sec) => (
                  <Section key={sec.k} title={sec.lbl} items={byTab.confirm.filter(sec.test)} batch={sec.batch} Row={ConfirmRow} onAction={onAction} onBatch={onBatch} />
                ))}
                {activeTab === "unmatched" && <Section items={byTab.unmatched} Row={UnmatchedRow} onAction={onAction} onBatch={onBatch} />}
                {activeTab === "later" && <Section items={byTab.later} Row={ParkedRow} onAction={onAction} onBatch={onBatch} />}
                {activeTab === "matched" && (
                  <>
                    {matchedRows.length > 0 && <MatchedList rows={matchedRows} />}
                    <Section title={byTab.matched.length ? "Settled by someone" : null} items={byTab.matched} onAction={onAction} onBatch={onBatch} />
                  </>
                )}
                {tabCount[activeTab] === 0 && (
                  <div className="recon-empty">{search ? "Nothing here matches the search." : "Nothing here."}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer — bank against books ──────────────────────────────── */}
      <div className="lg-footer">
        <div className="lg-footer-left">
          {/* Separate flex children, not one span: .lg-footer-sep gets its
              spacing from the footer's own flex gap, so nesting the whole line
              inside a single span collapsed it to "10 matched·11 to decide". */}
          <span><span className="lg-footer-num">{tabCount.matched}</span> matched</span>
          <span className="lg-footer-sep">·</span>
          <span><span className="lg-footer-num">{tabCount.confirm}</span> to confirm</span>
          <span className="lg-footer-sep">·</span>
          <span><span className="lg-footer-num">{tabCount.unmatched}</span> not matched</span>
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
                <div className="drawer-sub">{runs.length} accounts · worst state first</div>
              </div>
              <button className="drawer-close" onClick={() => setAccountListOpen(false)} aria-label="Close">
                <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
              </button>
            </div>
            <div className="drawer-body">
              {[...runs]
                .sort((a, b) => b.counts.blocking - a.counts.blocking || a.account.name.localeCompare(b.account.name))
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
                        {r.counts.blocking > 0 ? `${r.counts.blocking} to resolve` : r.state.label}
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
          onConfirm={onManualMatch}
          onClose={() => setManualFor(null)}
        />
      )}
      <UploadModal
        open={uploadOpen}
        run={run?.pending || run}
        onUploaded={onUploaded}
        onClose={() => setUploadOpen(false)}
      />
      {toast && <div className="recon-toast">{toast}</div>}
    </div>
  );
}

// Counts recomputed over the overlaid exceptions. Mirrors countOf in
// bankMatching.js, which cannot be used directly because it runs before any of
// this session's decisions exist.
function recount(rows, exceptions) {
  const live = exceptions.filter(isOpen);
  const by = (t) => live.filter((e) => e.type === t).length;
  return {
    total: rows.length,
    matched: rows.filter((r) => r.link).length,
    anomaly: by("ANOMALY"),
    genuine: by("GENUINE_MISMATCH"),
    unclassified: by("UNCLASSIFIED"),
    systematic: by("KNOWN_SYSTEMATIC"),
    fee: by("BANK_FEE"),
    timing: by("TIMING_DIFFERENCE"),
    blocking: live.filter((e) => EXCEPTION_TYPES[e.type]?.blocking).length,
    open: live.length,
  };
}
