// Non-Bank Reconciliation — cash that has no bank statement behind it.
//
// Petty cash and cash on hand, e-wallets, payment gateways and clearing
// accounts. There is no statement to match line by line, so the month works
// the other way round: a person brings an ending balance and the evidence for
// it (a cash count, the app balance, a settlement report, a schedule), then
// ticks the GL lines that evidence includes. lib/nonBankRecon.js says how the
// numbers fit together.
//
// Rules kept from Bank Reconciliation:
//
//   Nothing reconciles on its own. Klay adds up and drafts the difference
//   journal; a person ticks, posts and submits.
//
//   Reconciliation ends. Submit is disabled until the difference is zero, and
//   a month counts as reconciled only once a second person approves it.

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./modules.css";
import "./invoices-ledger.css";
import "./close.css";
import "./bank-reconciliation.css";
import "./non-bank-reconciliation.css";
import { NON_BANK_ACCOUNTS, NON_BANK_TYPES, DENOMINATIONS, denomKey } from "../data/seed/nonBankAccounts";
import { PERIODS } from "../lib/bankReconHistory";
import { CURRENT_PERIOD, monthEnd } from "../data/seed/bankStatement";
import { accountChain, linesOn, recordKey, differenceDraft, countTotal, defaultStatementDate, nameOf, STATUS } from "../lib/nonBankRecon";
import { useNonBankRecon } from "../state/NonBankReconContext";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { useCurrentUser } from "../state/CurrentUserContext";
import { Segmented } from "../components/ReconMatchView";
import { COA } from "../data/seed/coa";
import { TODAY } from "../lib/clock";

// The demo day in local time — toISOString() would give the UTC day, a day early east of Greenwich.
const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;
const NEEDS_RECONCILE = "Needs the Reconcile bank permission";

const fmtRp = (n) => (n == null ? "—" : Math.abs(n).toLocaleString("id-ID", { maximumFractionDigits: 0 }));
const fmtAmt = (n) => (n == null ? "—" : `${n < 0 ? "−" : ""}Rp ${fmtRp(n)}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (period) => `${MONTH_NAMES[parseInt(period.slice(5, 7), 10) - 1]} ${period.slice(0, 4)}`;
const monthOnly = (period) => MONTH_NAMES[parseInt(period.slice(5, 7), 10) - 1];
const fmtDate = (iso) => (iso ? `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}` : "—");
const fmtDateShort = (iso) => (iso ? `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]}` : "—");
const amountIn = (v) => {
  const neg = /^\s*[-−]/.test(String(v));
  const n = parseInt(String(v).replace(/[^0-9]/g, ""), 10) || 0;
  return neg ? -n : n;
};

// What a person brings for each kind of account, said where they enter it.
const EVIDENCE_HINT = {
  cash: "Count the cash with a witness. The total becomes the ending balance, and the signed sheet is the evidence.",
  ewallet: "Use the balance the app shows at the end of the statement date. Attach the statement export or a screenshot.",
  gateway: "Use the closing balance on the settlement report for the statement date. Attach the report.",
  clearing: "A clearing account should hold nothing once everything has arrived. Enter 0, attach the schedule of what is still in transit, and leave those lines unticked.",
};

function Banner({ tone = "info", children, actions = null }) {
  return (
    <div className={`nbr-banner ${tone}`}>
      <div className="nbr-banner-text">{children}</div>
      {actions && <div className="nbr-banner-actions">{actions}</div>}
    </div>
  );
}

function Modal({ title, sub, onClose, wide = false, children, foot }) {
  return (
    <div className="bank-upload-backdrop" onClick={onClose}>
      <div className={`bank-upload-modal nbr-modal${wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="bank-upload-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">{title}</div>
            {sub && <div className="bank-upload-sub">{sub}</div>}
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>
        <div className="nbr-modal-body">{children}</div>
        <div className="bank-upload-foot">{foot}</div>
      </div>
    </div>
  );
}

// ── Account card ────────────────────────────────────────────────────────────

function AccountCard({ row, selected, onSelect }) {
  const { account, status, ending, glBalance, difference } = row;
  const type = NON_BANK_TYPES[account.type];
  return (
    <button type="button" className={`bank-card nbr-card${selected ? " selected" : ""}`} onClick={() => onSelect(account.id)} aria-pressed={selected}>
      <div className="bank-card-head">
        <div className="bank-card-logo nbr-logo" style={{ background: account.color }}>{type.logo}</div>
        <div className="bank-card-id">
          <div className="bank-card-title">{account.name}</div>
          <div className="bank-card-no">{type.label} · {account.glAccount}</div>
        </div>
        <span className={`recon-state-pill ${status.tone}`}>{status.label}</span>
      </div>
      <div className="bank-card-bals">
        <span className="bank-card-bal-lbl">{account.type === "cash" ? "Count" : "Evidence"}</span>
        <span className="bank-card-bal">{ending == null ? "Not entered" : `Rp ${fmtRp(ending)}`}</span>
        <span className="bank-card-bal-lbl">Klay</span>
        <span className="bank-card-bal">{fmtAmt(glBalance)}</span>
        {difference != null && (
          <>
            <span className="bank-card-bal-lbl">Diff</span>
            <span className={`bank-card-bal diff${difference === 0 ? " zero" : ""}`}>{fmtAmt(difference)}</span>
          </>
        )}
      </div>
    </button>
  );
}

// ── Evidence: start a month, or change what it rests on ─────────────────────

function CountSheet({ counts, onChange, readOnly = false }) {
  return (
    <div className="nbr-count">
      <div className="nbr-count-row nbr-count-head">
        <span>Denomination</span><span className="num">Pieces</span><span className="num">Amount</span>
      </div>
      {DENOMINATIONS.map((d) => {
        const k = denomKey(d);
        const n = counts[k] || 0;
        return (
          <div key={k} className="nbr-count-row">
            <span>Rp {d.value.toLocaleString("id-ID")} <em>{d.kind}</em></span>
            {readOnly
              ? <span className="num">{n || "—"}</span>
              : <input className="num" inputMode="numeric" value={n || ""} placeholder="0" aria-label={`Rp ${d.value} ${d.kind}s`}
                  onChange={(e) => onChange({ ...counts, [k]: amountIn(e.target.value) })} />}
            <span className="num">{n ? fmtRp(n * d.value) : "—"}</span>
          </div>
        );
      })}
      <div className="nbr-count-row nbr-count-total">
        <span>Total counted</span><span /><span className="num">Rp {fmtRp(countTotal(counts))}</span>
      </div>
    </div>
  );
}

function EvidenceModal({ account, period, record, userName, onSave, onClose }) {
  const isCash = account.type === "cash";
  const [statementDate, setStatementDate] = useState(record?.statementDate || defaultStatementDate(period));
  const [balance, setBalance] = useState(record ? String(record.endingBalance) : account.type === "clearing" ? "0" : "");
  const [fileName, setFileName] = useState(record?.evidence?.fileName || "");
  const [counts, setCounts] = useState(record?.evidence?.count?.counts || {});
  const [countedBy, setCountedBy] = useState(record?.evidence?.count?.countedBy || userName);
  const [witnessedBy, setWitnessedBy] = useState(record?.evidence?.count?.witnessedBy || "");
  const fileRef = useRef(null);

  const start = `${period}-01`;
  const last = monthEnd(period) > TODAY_ISO ? TODAY_ISO : monthEnd(period);
  const ending = isCash ? countTotal(counts) : amountIn(balance);
  const problem =
    statementDate < start || statementDate > last ? `The statement date has to fall in ${monthName(period)}, no later than today.`
      : isCash && ending === 0 ? "Count the cash first."
        : isCash && !witnessedBy.trim() ? "Name the witness. A count needs a second person present."
          : !isCash && balance.trim() === "" ? "Enter the ending balance."
            : !isCash && !fileName ? "Attach the evidence."
              : null;

  function save() {
    if (problem) return;
    onSave({
      statementDate,
      endingBalance: ending,
      evidence: isCash
        ? { kind: "count", fileName, count: { counts, countedBy, witnessedBy, countedAt: statementDate } }
        : { kind: "file", fileName },
    });
  }

  return (
    <Modal
      title={record ? "Change the evidence" : isCash ? "Count cash" : "Start reconciliation"}
      sub={`${account.name} · ${monthName(period)}`}
      wide={isCash}
      onClose={onClose}
      foot={
        <>
          {problem && <span className="nbr-foot-problem">{problem}</span>}
          <button type="button" className="bank-upload-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="bank-upload-btn primary" disabled={!!problem} onClick={save}>
            {record ? "Save" : "Start reconciliation"}
          </button>
        </>
      }
    >
      <div className="bank-upload-hint">{EVIDENCE_HINT[account.type]}</div>
      <div className="rj-fields">
        <label className="rj-field">
          <span>{isCash ? "Counted on" : "Statement date"}</span>
          <input type="date" value={statementDate} min={start} max={last} onChange={(e) => setStatementDate(e.target.value)} />
        </label>
        {!isCash && (
          <label className="rj-field rj-field-grow">
            <span>Ending balance ({NON_BANK_TYPES[account.type].evidence.toLowerCase()})</span>
            <input inputMode="numeric" value={balance === "" ? "" : amountIn(balance).toLocaleString("id-ID")} placeholder="Rp 0"
              onChange={(e) => setBalance(e.target.value)} />
          </label>
        )}
        {isCash && (
          <>
            <label className="rj-field">
              <span>Counted by</span>
              <input value={countedBy} onChange={(e) => setCountedBy(e.target.value)} />
            </label>
            <label className="rj-field">
              <span>Witnessed by</span>
              <input value={witnessedBy} placeholder={account.custodian ? `e.g. ${account.custodian}` : ""} onChange={(e) => setWitnessedBy(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {isCash && <CountSheet counts={counts} onChange={setCounts} />}
      <div className="nbr-attach">
        <input ref={fileRef} type="file" hidden onChange={(e) => setFileName(e.target.files?.[0]?.name || fileName)} />
        <span className="nbr-attach-lbl">{isCash ? "Photo of the signed count sheet (optional)" : "Evidence"}</span>
        {fileName ? <span className="nbr-file">{fileName}</span> : <span className="nbr-attach-none">Nothing attached</span>}
        <button type="button" className="lg-btn-ghost" onClick={() => fileRef.current?.click()}>{fileName ? "Replace" : "Attach file"}</button>
      </div>
    </Modal>
  );
}

// ── The difference journal ─────────────────────────────────────────────────

const LEAVES = COA.filter((a) => a.type !== "group" && a.is_active !== false);

function DifferenceModal({ account, draft, difference, canPost, onPost, onClose }) {
  const [memo, setMemo] = useState(draft.memo);
  const [other, setOther] = useState(account.differenceAccount);
  const lines = draft.lines.map((l) => (l.account_code === account.glAccount ? l : { ...l, account_code: other, account_name: nameOf(other), description: memo }));
  return (
    <Modal
      title="Difference journal"
      sub={`${account.name} · ${fmtAmt(difference)} to clear`}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="bank-upload-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="bank-upload-btn primary" disabled={!canPost} title={canPost ? undefined : NEEDS_RECONCILE}
            onClick={() => onPost({ ...draft, memo, lines })}>Post journal</button>
        </>
      }
    >
      <div className="bank-upload-hint">
        Klay drafted this from the difference. Posting it adds a line to {account.name} and ticks it, which brings the difference to zero.
      </div>
      <div className="rj-fields">
        <label className="rj-field">
          <span>Date</span>
          <input type="date" value={draft.je_date} disabled />
        </label>
        <label className="rj-field rj-field-grow">
          <span>Memo</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
      </div>
      <div className="rj-lines nbr-je">
        <div className="rj-line rj-line-head"><span>Account</span><span>Description</span><span className="num">Debit</span><span className="num">Credit</span><span /></div>
        {lines.map((l) => (
          <div key={l.account_code === account.glAccount ? "own" : "other"} className={`rj-line${l.account_code === account.glAccount ? " rj-line-locked" : ""}`}>
            {l.account_code === account.glAccount
              ? <span className="rj-acct">{l.account_code} {l.account_name}</span>
              : (
                <select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Difference account">
                  {LEAVES.filter((a) => a.code !== account.glAccount).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                </select>
              )}
            <span className="rj-desc">{l.description}</span>
            <span className="num">{l.debit ? fmtRp(l.debit) : ""}</span>
            <span className="num">{l.credit ? fmtRp(l.credit) : ""}</span>
            <span>{l.account_code === account.glAccount && <span className="rj-lock">Fixed</span>}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ReasonModal({ title, sub, label, cta, onSubmit, onClose }) {
  const [text, setText] = useState("");
  return (
    <Modal title={title} sub={sub} onClose={onClose}
      foot={
        <>
          <button type="button" className="bank-upload-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="bank-upload-btn primary" disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>{cta}</button>
        </>
      }>
      <label className="rj-field">
        <span>{label}</span>
        <textarea className="nbr-textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
    </Modal>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

const VIEWS = [
  { k: "all", lbl: "All" },
  { k: "ticked", lbl: "Ticked" },
  { k: "outstanding", lbl: "Outstanding" },
];

export default function NonBankReconciliationPage() {
  const { entries, addJournalEntry, peekNextJeNumber } = useJournalEntries();
  const nb = useNonBankRecon();
  const { user, hasCapability } = useCurrentUser();
  const canReconcile = hasCapability("bank.reconcile");

  // Every account's month, derived from the ledger as it stands.
  const chains = useMemo(
    () => Object.fromEntries(NON_BANK_ACCOUNTS.map((a) => [a.id, accountChain(a, linesOn(entries, a.glAccount), nb.records, PERIODS)])),
    [entries, nb.records],
  );
  const doneIn = (p) => NON_BANK_ACCOUNTS.filter((a) => chains[a.id][p].status.key === "approved").length;
  // Open on the oldest month still being closed.
  const firstOpen = [...PERIODS].sort().find((p) => doneIn(p) < NON_BANK_ACCOUNTS.length) || CURRENT_PERIOD;

  const [pickedPeriod, setPeriod] = useState(null);
  const period = pickedPeriod || firstOpen;
  const [accountId, setAccountId] = useState(NON_BANK_ACCOUNTS[0].id);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [view, setView] = useState("all");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);

  const rows = NON_BANK_ACCOUNTS.map((a) => chains[a.id][period]);
  const row = chains[accountId][period];
  const { account, record, status } = row;
  const key = recordKey(account.id, period);
  const type = NON_BANK_TYPES[account.type];
  const editable = !!record && record.status === "draft" && canReconcile;
  const ticked = new Set(record?.ticked || []);
  const done = rows.filter((r) => r.status.key === "approved").length;
  const waiting = rows.filter((r) => r.status.key === "review").length;

  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2600);
  }

  const toggle = (id) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id); else next.add(id);
    nb.setTicked(key, next);
  };
  const tickAll = () => nb.setTicked(key, row.candidates.map((l) => l.id));

  function onStart(evidence) {
    if (record) nb.updateEvidence(key, evidence, user.name);
    else nb.start(account.id, period, evidence, user.name);
    setModal(null);
    showToast(record ? "Evidence updated." : `Started. Tick the lines the ${type.evidence.toLowerCase()} includes.`);
  }

  function onPostDifference(draft) {
    const jeNumber = peekNextJeNumber();
    addJournalEntry({
      je_number: jeNumber, je_date: draft.je_date, status: "posted", memo: draft.memo,
      reference_type: "nonbank_reconciliation", reference_id: key,
      created_by: user.name, created_date: TODAY_ISO, posted_by: user.name, posted_date: TODAY_ISO,
      lines: draft.lines.map((l) => ({ account_code: l.account_code, account_name: l.account_name, debit: l.debit || 0, credit: l.credit || 0, description: l.description || "" })),
    });
    const own = draft.lines.findIndex((l) => l.account_code === account.glAccount);
    nb.setTicked(key, [...ticked, `${jeNumber}#${own}`]);
    nb.logJournal(key, user.name, jeNumber);
    setModal(null);
    showToast(`${jeNumber} posted and ticked.`);
  }

  // Who may act on a submitted month, and if not, why not.
  const isPreparer = record?.preparedBy === user.name;
  const reviewBlock = !canReconcile ? NEEDS_RECONCILE : isPreparer ? "You prepared this, so someone else has to review it" : null;

  const visible = row.candidates.filter((l) => (view === "ticked" ? ticked.has(l.id) : view === "outstanding" ? !ticked.has(l.id) : true));
  const carried = visible.filter((l) => l.carried);
  const thisMonth = visible.filter((l) => !l.carried);
  const counts = { all: row.candidates.length, ticked: row.candidates.filter((l) => ticked.has(l.id)).length };
  counts.outstanding = counts.all - counts.ticked;

  // A plain function, not a component: a component declared here would remount
  // on every render and drop the focus of the note being typed.
  function lineRow(l) {
    const on = ticked.has(l.id);
    const note = record?.notes?.[l.id];
    return (
      <div key={l.id} className={`nbr-row${on ? " on" : ""}`} role="row">
        <span>
          <input type="checkbox" className="rm-check" checked={on} disabled={!editable} onChange={() => toggle(l.id)} aria-label={`Tick ${l.memo}`} />
        </span>
        <span className="nbr-date">{fmtDateShort(l.date)}</span>
        <span><Link className="nbr-je-link" to={`/journal-entry/${l.je}`}>{l.je}</Link></span>
        <span className="nbr-desc">
          <span className="nbr-memo">{l.memo}</span>
          {l.carried && <span className="nbr-tag">From {MONTHS[parseInt(l.date.slice(5, 7), 10) - 1]}</span>}
          {l.refType === "nonbank_reconciliation" && <span className="nbr-tag diff">Difference</span>}
          {!on && (editable
            ? <input className="nbr-note" placeholder="Why is it outstanding? (optional)" value={note || ""} onChange={(e) => nb.setNote(key, l.id, e.target.value)} />
            : note && <span className="nbr-note-text">{note}</span>)}
        </span>
        <span className="num nbr-in">{l.amount > 0 ? fmtRp(l.amount) : ""}</span>
        <span className="num nbr-out">{l.amount < 0 ? fmtRp(l.amount) : ""}</span>
      </div>
    );
  }

  const prev = PERIODS.filter((p) => p < period).sort().at(-1);
  // A later month built on this one has to be reopened first, or its
  // beginning balance would rest on a month that is changing under it.
  const next = PERIODS.filter((p) => p > period).sort()[0];
  const reopenBlock = !canReconcile ? NEEDS_RECONCILE
    : next && chains[account.id][next]?.record ? `${monthName(next)} is already started on top of this month` : null;

  return (
    <div className="lg-page bank-recon-page nbr-page">
      <div className="lg-scroll-container">
        <div className="bank-recon-hero">
          <div className="lg-head">
            <div className="lg-head-top">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 className="lg-title">Non-Bank Reconciliation</h1>
                <div className="nbr-intro">Cash with no bank statement behind it: petty cash, e-wallets, payment gateways and clearing accounts.</div>
              </div>
            </div>
          </div>

          <div className="bank-period-wrap">
            <div className="bank-month">
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
                    const n = doneIn(p);
                    const all = n === NON_BANK_ACCOUNTS.length;
                    return (
                      <button key={p} type="button" className={`bank-filter-pop-item${p === period ? " active" : ""}`} onClick={() => { setPeriod(p); setMonthMenuOpen(false); }}>
                        <span className="bank-filter-pop-label">{monthName(p)}{p === CURRENT_PERIOD && <span className="bank-month-tag">Current</span>}</span>
                        <span className={`bank-month-state${all ? " done" : ""}`}>{all ? "Reconciled" : `${n} of ${NON_BANK_ACCOUNTS.length} accounts`}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="bank-accts-progress" title="An account is reconciled once a reviewer approves its month.">
              <span className="bank-accts-progress-lbl">
                <strong>{done}</strong> of {rows.length} accounts reconciled
                {waiting > 0 && <> · <strong>{waiting}</strong> waiting for review</>}
              </span>
              <span className="recon-bar" aria-hidden>
                <span className="recon-bar-seg reconciled" style={{ width: `${(done / rows.length) * 100}%` }} />
              </span>
            </div>
          </div>

          <div className="nbr-cards">
            {rows.map((r) => <AccountCard key={r.account.id} row={r} selected={r.account.id === accountId} onSelect={(id) => { setAccountId(id); setView("all"); }} />)}
          </div>
        </div>

        <div className="lg-table-wrap">
          <div className="lg-card nbr-panel">
            <div className="nbr-head">
              <div className="nbr-head-id">
                <div className="nbr-head-title">
                  {account.name}
                  <span className={`recon-state-pill ${status.tone}`}>{status.label}</span>
                </div>
                <div className="nbr-head-meta">
                  {type.label} · {account.glAccount} {nameOf(account.glAccount)}
                  {account.custodian && <> · Custodian {account.custodian}</>}
                  {" · "}Differences to {account.differenceAccount} {nameOf(account.differenceAccount)}
                </div>
              </div>
              <div className="nbr-head-actions">
                {!record && status.key !== "blocked" && (
                  <button type="button" className="lg-btn-brand" disabled={!canReconcile} title={canReconcile ? undefined : NEEDS_RECONCILE} onClick={() => setModal({ kind: "evidence" })}>
                    {account.type === "cash" ? "Count cash" : "Start reconciliation"}
                  </button>
                )}
                {record?.status === "draft" && (
                  <button type="button" className="lg-btn-ghost" disabled={!canReconcile} title={canReconcile ? undefined : NEEDS_RECONCILE} onClick={() => setModal({ kind: "evidence" })}>
                    {account.type === "cash" ? "Recount" : "Change evidence"}
                  </button>
                )}
                {record?.status === "review" && (
                  <>
                    <button type="button" className="lg-btn-ghost" disabled={!!reviewBlock} title={reviewBlock || undefined} onClick={() => setModal({ kind: "sendBack" })}>Send back</button>
                    <button type="button" className="lg-btn-brand" disabled={!!reviewBlock} title={reviewBlock || undefined}
                      onClick={() => { nb.approve(key, user.name); showToast(`${account.name} reconciled for ${monthOnly(period)}.`); }}>Approve</button>
                  </>
                )}
                {record?.status === "approved" && (
                  <button type="button" className="lg-btn-ghost" disabled={!!reopenBlock} title={reopenBlock || undefined} onClick={() => setModal({ kind: "reopen" })}>Reopen</button>
                )}
              </div>
            </div>

            {status.key === "blocked" && (
              <Banner>Reconcile {monthOnly(row.blockedBy)} first. Each month starts from the one before it, so {monthOnly(period)} opens once {monthOnly(row.blockedBy)} is approved.</Banner>
            )}
            {record?.sentBack && record.status === "draft" && (
              <Banner tone="danger">Sent back by <strong>{record.sentBack.by}</strong> on {fmtDate(record.sentBack.at)}: &ldquo;{record.sentBack.comment}&rdquo;</Banner>
            )}
            {record?.status === "review" && (
              <Banner tone="warn">
                Submitted by <strong>{record.preparedBy}</strong> on {fmtDate(record.submittedAt)} and waiting for a reviewer.
                {reviewBlock ? <> {reviewBlock}.</> : <> Check the evidence and the ticked lines, then approve or send it back.</>}
              </Banner>
            )}
            {record?.status === "approved" && (
              <Banner tone="success">Approved by <strong>{record.reviewedBy}</strong> on {fmtDate(record.approvedAt)}. Prepared by {record.preparedBy}. Read-only.</Banner>
            )}

            {!record ? (
              <div className="recon-empty nbr-empty">
                <div className="recon-awaiting-title">{status.key === "blocked" ? `${monthName(period)} hasn't started` : `Nothing reconciled for ${monthName(period)} yet`}</div>
                <div>{EVIDENCE_HINT[account.type]}</div>
                <div className="nbr-empty-sub">
                  {row.candidates.length} GL line{row.candidates.length === 1 ? "" : "s"} up to {fmtDate(row.statementDate)} to check · Klay balance {fmtAmt(row.glBalance)}
                </div>
              </div>
            ) : (
              <>
                <div className="nbr-evidence">
                  <div className="nbr-ev"><span>{account.type === "cash" ? "Counted on" : "Statement date"}</span><strong>{fmtDate(record.statementDate)}</strong></div>
                  <div className="nbr-ev"><span>Ending balance</span><strong>Rp {fmtRp(record.endingBalance)}</strong></div>
                  <div className="nbr-ev"><span>Beginning balance</span><strong>{fmtAmt(row.beginning)}</strong><em>{prev && chains[account.id][prev]?.record ? `${monthOnly(prev)} ending` : "Opening balance"}</em></div>
                  <div className="nbr-ev nbr-ev-grow">
                    <span>Evidence</span>
                    {record.evidence.kind === "count" ? (
                      <strong>
                        <button type="button" className="recon-empty-link" onClick={() => setModal({ kind: "count" })}>Cash count</button>
                        {" "}by {record.evidence.count.countedBy}, witnessed by {record.evidence.count.witnessedBy}
                      </strong>
                    ) : <strong><span className="nbr-file">{record.evidence.fileName}</span></strong>}
                    {record.evidence.kind === "count" && record.evidence.fileName && <em><span className="nbr-file">{record.evidence.fileName}</span></em>}
                  </div>
                </div>

                <div className="lg-filter-row nbr-toolbar">
                  <Segmented label="Show" options={VIEWS.map((v) => ({ ...v, lbl: `${v.lbl} ${counts[v.k]}` }))} value={view} onChange={setView} />
                  <div className="nbr-toolbar-right">
                    {editable && counts.ticked > 0 && <button type="button" className="lg-btn-ghost" onClick={() => nb.setTicked(key, [])}>Clear ticks</button>}
                    {editable && counts.outstanding > 0 && (
                      <button type="button" className="recon-group-batch" onClick={tickAll}>Tick all through {fmtDateShort(record.statementDate)}</button>
                    )}
                  </div>
                </div>

                <div className="nbr-table" role="table">
                  <div className="nbr-row nbr-row-head" role="row">
                    <span /><span>Date</span><span>Journal</span><span>Description</span><span className="num">In</span><span className="num">Out</span>
                  </div>
                  {carried.length > 0 && <div className="nbr-group">Outstanding from earlier months</div>}
                  {carried.map(lineRow)}
                  {carried.length > 0 && thisMonth.length > 0 && <div className="nbr-group">{monthName(period)}</div>}
                  {thisMonth.map(lineRow)}
                  {visible.length === 0 && (
                    <div className="recon-empty">{view === "outstanding" ? "Nothing outstanding. Every line is ticked." : view === "ticked" ? "Nothing ticked yet." : "No GL lines on this account up to the statement date."}</div>
                  )}
                </div>

                <div className="nbr-log">
                  <div className="nbr-log-title">Activity</div>
                  {[...(record.log || [])].reverse().map((e, i) => (
                    <div key={i} className="nbr-log-row"><span className="nbr-log-at">{fmtDate(e.at)}</span><span><strong>{e.by}</strong> · {e.text}</span></div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {record && (
        <div className="lg-footer rm-bar">
          <div className="rm-bar-figs">
            <span className="rm-bar-fig"><span className="lg-footer-lbl">Beginning</span><span className="lg-footer-total">{fmtAmt(row.beginning)}</span></span>
            <span className="rm-bar-fig"><span className="lg-footer-lbl">+ Ticked</span><span className="lg-footer-total">{fmtAmt(row.tickedNet)}</span></span>
            <span className="rm-bar-fig"><span className="lg-footer-lbl">Ending balance</span><span className="lg-footer-total">{fmtAmt(row.ending)}</span></span>
            <span className="rm-bar-fig"><span className="lg-footer-lbl">Outstanding</span><span className="lg-footer-total">{fmtAmt(row.outstandingNet)}<span className="rm-bar-n">{row.outstandingCount}</span></span></span>
            <span className="rm-bar-fig">
              <span className="lg-footer-lbl">Difference</span>
              <span className={`lg-footer-total${row.difference === 0 ? " nbr-zero" : " rm-bar-off"}`}>{fmtAmt(row.difference)}</span>
            </span>
            {record.status === "draft" && row.difference !== 0 && <span className="rm-bar-hint">Tick more lines, or post the difference journal.</span>}
            {!canReconcile && record.status === "draft" && <span className="rm-bar-hint">{NEEDS_RECONCILE}.</span>}
          </div>
          {record.status === "draft" && (
            <div className="lg-footer-right">
              {row.difference !== 0 && (
                <button type="button" className="lg-footer-bulk-btn" disabled={!canReconcile} onClick={() => setModal({ kind: "difference" })}>Draft difference journal</button>
              )}
              <button type="button" className="rm-bar-go" disabled={!canReconcile || row.difference !== 0}
                title={!canReconcile ? NEEDS_RECONCILE : row.difference !== 0 ? "The difference has to be zero first" : undefined}
                onClick={() => { nb.submit(key, user.name); showToast("Submitted. Someone else with Reconcile bank reviews it."); }}>
                Submit for review
              </button>
            </div>
          )}
        </div>
      )}

      {modal?.kind === "evidence" && (
        <EvidenceModal account={account} period={period} record={record} userName={user.name} onSave={onStart} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "count" && (
        <Modal title="Cash count" sub={`${account.name} · ${fmtDate(record.statementDate)}`} onClose={() => setModal(null)} wide
          foot={<button type="button" className="bank-upload-btn ghost" onClick={() => setModal(null)}>Close</button>}>
          <div className="nbr-count-meta">Counted by <strong>{record.evidence.count.countedBy}</strong>, witnessed by <strong>{record.evidence.count.witnessedBy}</strong>{record.evidence.fileName && <> · <span className="nbr-file">{record.evidence.fileName}</span></>}</div>
          <CountSheet counts={record.evidence.count.counts} readOnly />
        </Modal>
      )}
      {modal?.kind === "difference" && (
        <DifferenceModal account={account} difference={row.difference} canPost={canReconcile}
          draft={differenceDraft(account, period, row.difference, record.statementDate)}
          onPost={onPostDifference} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "sendBack" && (
        <ReasonModal title="Send back" sub={`${account.name} · ${monthName(period)}`} label={`What should ${record.preparedBy} fix?`} cta="Send back"
          onClose={() => setModal(null)}
          onSubmit={(c) => { nb.sendBack(key, user.name, c); setModal(null); showToast(`Sent back to ${record.preparedBy}.`); }} />
      )}
      {modal?.kind === "reopen" && (
        <ReasonModal title="Reopen reconciliation" sub={`${account.name} · ${monthName(period)}`} label="Why does it need reopening?" cta="Reopen"
          onClose={() => setModal(null)}
          onSubmit={(r) => { nb.reopen(key, user.name, r); setModal(null); showToast("Reopened. It needs review again before it counts."); }} />
      )}

      {toast && <div className="recon-toast">{toast}</div>}
    </div>
  );
}
