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

import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./close.css";
import "./bank-reconciliation.css";
import { COMPANY_BANK_ACCOUNTS, bankAccountById, maskOf, statementLabelOf } from "../data/seed/bankAccounts";
import { EXCEPTION_TYPES } from "../lib/bankMatching";
import { runReconciliation, stateOf, RECON_STATES, reconcilable } from "../lib/bankRecon";
import { writeOffEntry, writeOffNote } from "../lib/reconJournal";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { usePayments } from "../state/PaymentsContext";
import { useBankRecon } from "../state/BankReconContext";
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

const PERIODS = [
  { lbl: "Nov 2024", v: "2024-11", state: "locked" },
  { lbl: "Dec 2024", v: "2024-12", state: "locked" },
  { lbl: "Jan 2025", v: "2025-01", state: "locked" },
  { lbl: "Feb 2025", v: "2025-02", state: "locked" },
  { lbl: "Mar 2025", v: "2025-03", state: "locked" },
  { lbl: "Apr 2025", v: "2025-04", state: "active" },
  { lbl: "May 2025", v: "2025-05", state: "future" },
  { lbl: "Jun 2025", v: "2025-06", state: "future" },
];

// ── Exception groups, in the PRD's order ─────────────────────────────────────
//
// Anomalies first because an unusual amount should be questioned before it is
// matched. Timing last and collapsed because it is not a problem. The three in
// between block the gate; the three below it need a decision but not an
// investigation, which is why they each carry a batch action.

const GROUPS = [
  { key: "ANOMALY", open: true, blurb: "Verify before resolving — these are the amounts worth being wrong about." },
  { key: "GENUINE_MISMATCH", open: true, blurb: "The bank and the books disagree, and the difference is not explained by timing." },
  { key: "UNCLASSIFIED", open: true, blurb: "Nothing in the ledger accounts for these." },
  { key: "KNOWN_SYSTEMATIC", open: false, blurb: "Known and recurring. One tap each." },
  { key: "BANK_FEE", open: false, blurb: "Under the fee ceiling and described as a fee." },
  { key: "TIMING_DIFFERENCE", open: false, blurb: "Booked, not yet on a statement. These clear by themselves — no action needed." },
];

// ── Account card ─────────────────────────────────────────────────────────────

function AccountCard({ run, selected, onSelect }) {
  const { account, state, counts, statement } = run;
  const blocking = counts.blocking;
  const noActivity = statement.loaded && counts.total === 0;

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
      <div className="bank-card-amt">Rp {fmtRp(statement.closingBalance)}</div>
      <div className="bank-card-meta">
        {!reconcilable(account)
          ? "no GL account mapped"
          : !statement.loaded
            ? "no statement loaded"
            : noActivity
              ? `no activity · ${statementLabelOf(account)}`
              : <>Matched <strong>{counts.matched}</strong> of {counts.total} · {statementLabelOf(account)}</>}
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
  "confirm-timing": "Acknowledge",
  escalate: "Escalate",
};

function ExceptionRow({ ex, onAction, busy }) {
  const meta = EXCEPTION_TYPES[ex.type];
  const resolved = !!ex.resolution;

  return (
    <div className={`recon-ex${resolved ? " resolved" : ""} ${meta?.tone || "muted"}`}>
      <div className="recon-ex-head">
        <div className="recon-ex-title">{ex.title}</div>
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
        </div>
      ) : (
        <div className="recon-ex-actions">
          {(ex.actions || []).map((a) => (
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

function ExceptionGroup({ spec, items, openByDefault, onAction, onBatch, busy }) {
  const meta = EXCEPTION_TYPES[spec.key];
  const [open, setOpen] = useState(openByDefault);
  const live = items.filter((e) => !e.resolution);
  if (!items.length) return null;

  const n = live.length;
  const all = n === 1 ? "" : `all ${n} `;
  const batch =
    spec.key === "BANK_FEE" ? { action: "write-off-fee", label: `Write off ${all}to Bank Charges` }
    : spec.key === "KNOWN_SYSTEMATIC" ? { action: "write-off-interest", label: `Post ${all}to Interest Income` }
    : spec.key === "TIMING_DIFFERENCE" ? { action: "confirm-timing", label: n === 1 ? "Acknowledge" : `Acknowledge all ${n}` }
    : null;

  return (
    <div className={`recon-group ${meta?.tone || "muted"}${open ? " open" : ""}`}>
      <div className="recon-group-head">
        <button type="button" className="recon-group-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <svg viewBox="0 0 12 12" className="recon-group-caret"><polyline points="4 2 8 6 4 10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="recon-group-name">{meta?.label}</span>
          <span className="recon-group-count">{live.length || "done"}</span>
        </button>
        <span className="recon-group-blurb">{spec.blurb}</span>
        {batch && live.length > 0 && (
          <button type="button" className="recon-group-batch" disabled={busy} onClick={() => onBatch(batch.action, live)}>
            {batch.label}
          </button>
        )}
      </div>
      {open && (
        <div className="recon-group-body">
          {items.map((ex) => (
            <ExceptionRow key={ex.id} ex={ex} onAction={onAction} busy={busy} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Matched lines, behind a toggle ───────────────────────────────────────────

function MatchedList({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="recon-matched">
      {rows.map(({ line, link }) => (
        <div className="recon-matched-row" key={line.id}>
          <div className="recon-matched-date">{fmtDateShort(line.date)}</div>
          <div className="recon-matched-desc">
            {line.description}
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
              {phase === "done" && `${account.name} · ${statementLabelOf(account)}`}
            </div>
            <div className="bank-upload-sub">
              {phase === "picker" && "CSV, PDF or MT940. Klay detects the bank and the account from the file."}
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
              <div className="bank-upload-stat"><strong>{counts.timing}</strong> in transit — no action needed</div>
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
  const [showMatched, setShowMatched] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  // Decisions live in a context, not here. The engine is a pure function of the
  // statement and the ledger; what a person decided is laid over the top. They
  // sit outside this component because the close board asks the same question —
  // write off the last fee here and Gate 4 there has to agree.
  const { resolutions, completed, resolve, resolveMany, markComplete } = useBankRecon();

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

  const runs = useMemo(
    () =>
      COMPANY_BANK_ACCOUNTS.map((a) => {
        const run = runReconciliation(a.id, { extraPayments: livePayments });
        if (!run) return null;
        // Overlay this session's decisions, then re-derive the state from them —
        // so writing off the last open fee moves the account to fully reconciled
        // without anything having to remember to recompute.
        const exceptions = run.exceptions.map((e) => (resolutions[e.id] ? { ...e, resolution: resolutions[e.id] } : e));
        const withRes = { ...run, exceptions };
        return { ...withRes, state: stateOf(withRes, run.statement), counts: recount(run.lines, exceptions) };
      }).filter(Boolean),
    [livePayments, resolutions],
  );

  const runById = useMemo(() => Object.fromEntries(runs.map((r) => [r.accountId, r])), [runs]);
  const run = runById[selectedAccount];
  const account = run?.account || bankAccountById(selectedAccount);

  const filteredAccounts = runs.filter((r) => accountGroup === "all" || r.account.group === accountGroup);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (e) =>
      !q ||
      e.title.toLowerCase().includes(q) ||
      e.explanation.toLowerCase().includes(q) ||
      (e.description || "").toLowerCase().includes(q) ||
      (e.counterparty || "").toLowerCase().includes(q);
    const out = {};
    for (const g of GROUPS) out[g.key] = (run?.exceptions || []).filter((e) => e.type === g.key && match(e));
    return out;
  }, [run, search]);

  const matchedRows = useMemo(() => (run?.lines || []).filter((r) => r.link), [run]);

  // ── Resolving ──────────────────────────────────────────────────────────────

  function resolveOne(action, ex, jeNumber) {
    if (action === "record-payment" && ex.billId) {
      navigate(`/bills/${ex.billId}?tab=payment`);
      return null;
    }
    if (action === "write-off-fee" || action === "write-off-interest" || action === "write-off") {
      const { je, error } = writeOffEntry({ exception: ex, account, jeNumber, by: user.name, today: TODAY_ISO });
      if (error) { showToast(error); return null; }
      addJournalEntry(je);
      return { action, at: TODAY_ISO, by: user.name, note: writeOffNote(ex, je.je_number), jeNumber: je.je_number };
    }
    if (action === "confirm-timing") {
      return { action, at: TODAY_ISO, by: user.name, note: `Acknowledged by ${user.name} — expected to clear on its own.` };
    }
    if (action === "confirm-suggestion" && ex.suggestion) {
      return { action, at: TODAY_ISO, by: user.name, note: `Matched to ${ex.suggestion.ref} by ${user.name}. Klay will recognise this counterparty next time.` };
    }
    if (action === "escalate") {
      return { action, at: TODAY_ISO, by: user.name, note: `Escalated by ${user.name} — left open on the books for investigation.` };
    }
    if (action === "manual-match") {
      showToast("Manual match opens the ledger search — not wired in this pass.");
      return null;
    }
    return null;
  }

  function onAction(action, ex) {
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

  const blocking = run?.counts.blocking ?? 0;
  const openNonTiming = (run?.exceptions || []).filter((e) => !e.resolution && e.type !== "TIMING_DIFFERENCE").length;
  const canComplete = run?.statement.loaded && openNonTiming === 0;
  const isComplete = !!completed[selectedAccount];

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
                  className={`lg-pt-tab ${p.state}${period === p.v ? " active" : ""}`}
                  onClick={() => setPeriod(p.v)}
                  title={p.state === "locked" ? "Period locked" : p.state === "future" ? "Period hasn't started" : ""}
                >
                  {p.state === "locked" && (
                    <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  )}
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
            {statementLabelOf(account)}
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
                  : canComplete ? "Close Gate 4 for this account"
                    : `${openNonTiming} item${openNonTiming === 1 ? "" : "s"} still need a decision`
              }
              onClick={() => { markComplete(selectedAccount, TODAY_ISO); showToast(`${account.name} marked reconciled — Gate 4 closed for this account.`); }}
            >
              {isComplete ? "Complete" : "Mark reconciliation complete"}
            </button>
          </div>
        </div>

        {run?.balanceCheck && !run.balanceCheck.ok && (
          <div className="recon-balance-warn">{run.balanceCheck.message}</div>
        )}

        <div className="lg-table-wrap">
          <div className="lg-card recon-card">
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

            {run?.statement.loaded && run.counts.total > 0 && (
              <div className="recon-account-summary">
                <span className="recon-account-summary-icon"><SparkleIcon /></span>
                <div className="recon-account-summary-text">
                  <strong>Klay matched {run.counts.matched} of {run.counts.total} lines</strong>
                  {blocking > 0 && <> · <strong className="recon-account-summary-warn">{blocking}</strong> need investigating</>}
                  {openNonTiming - blocking > 0 && <> · {openNonTiming - blocking} one-tap {openNonTiming - blocking === 1 ? "decision" : "decisions"}</>}
                  {openNonTiming === 0 && <> · nothing left to decide</>}
                  {run.counts.timing > 0 && <> · {run.counts.timing} in transit, no action needed</>}
                </div>
              </div>
            )}

            {!run?.statement.loaded ? (
              <div className="recon-empty">
                {reconcilable(account)
                  ? <>No statement loaded for {account?.name}. Upload one to reconcile this account.</>
                  : <>{account?.name} has no GL account mapped in Settings → Bank Accounts, so there is nothing to reconcile a statement against.</>}
              </div>
            ) : run.counts.total === 0 ? (
              <div className="recon-empty">
                No transactions on the {statementLabelOf(account)} statement for {account?.name}.
              </div>
            ) : (
              <div className="recon-groups">
                {GROUPS.map((g) => (
                  <ExceptionGroup
                    key={g.key}
                    spec={g}
                    items={grouped[g.key]}
                    openByDefault={g.open}
                    onAction={onAction}
                    onBatch={onBatch}
                    busy={false}
                  />
                ))}

                <div className={`recon-group matched${showMatched ? " open" : ""}`}>
                  <div className="recon-group-head">
                    <button type="button" className="recon-group-toggle" onClick={() => setShowMatched((v) => !v)} aria-expanded={showMatched}>
                      <svg viewBox="0 0 12 12" className="recon-group-caret"><polyline points="4 2 8 6 4 10" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      <span className="recon-group-name">Matched</span>
                      <span className="recon-group-count">{matchedRows.length}</span>
                    </button>
                    <span className="recon-group-blurb">Confirmed against the ledger. Hover any line for the reason it matched.</span>
                  </div>
                  {showMatched && <div className="recon-group-body"><MatchedList rows={matchedRows} /></div>}
                </div>
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
          <span><span className="lg-footer-num">{run?.counts.matched || 0}</span> matched</span>
          <span className="lg-footer-sep">·</span>
          <span><span className="lg-footer-num">{openNonTiming}</span> to decide</span>
          <span className="lg-footer-sep">·</span>
          <span><span className="lg-footer-num">{run?.counts.timing || 0}</span> in transit</span>
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

      <UploadModal open={uploadOpen} run={run} onClose={() => setUploadOpen(false)} />
      {toast && <div className="recon-toast">{toast}</div>}
    </div>
  );
}

// Counts recomputed over the overlaid exceptions. Mirrors countOf in
// bankMatching.js, which cannot be used directly because it runs before any of
// this session's decisions exist.
function recount(rows, exceptions) {
  const live = exceptions.filter((e) => !e.resolution);
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
