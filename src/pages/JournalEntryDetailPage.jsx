import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useJournalEntries } from "../state/JournalEntriesContext";
import { COA_BY_CODE, accountPath } from "../data/seed/coa";
import { DIM_BY_KEY, paletteFor, dimensionsForAccount, sampleDimensionValue } from "../data/seed/dimensions";
import { withEvent, isClosedDate, periodOf } from "../lib/journalLifecycle";
import { useClosePeriod } from "../state/ClosePeriodContext";
import { formatDate } from "../lib/format";
import { describeRecurrence, recurringInstances, RECURRENCE_STATUS } from "../lib/recurringJournals";
import {
  fmtRp, STATUS_LABEL, STATUS_BADGE_CLASS, ACTION_ICON, useJournalRows, useJournalActions, displayStatus, RecurringIcon,
} from "./journalEntryShared";
import "./modules.css";
import "./invoices-ledger.css";
import "./journal-entry-detail.css";

// One journal entry on its own page (decided 25 Oct 2026), replacing the side
// drawer on the Journal Entry list. Lines get the full width; the record —
// details, attachments, audit trail — sits beside them. The actions are the
// list's own (pages/journalEntryShared.jsx), so a button here and the row
// menu there run the same checks.
//
// Reached from a list row, from the form after saving, and by deep link:
// /journal-entry/:jeNumber?line=N lands on line N (the Payment tab on a bill
// links each debit and credit it wrote this way).

export default function JournalEntryDetailPage() {
  const { jeNumber } = useParams();
  const [params] = useSearchParams();
  const { state: navState, pathname, search } = useLocation();
  const navigate = useNavigate();
  const { entries, updateJournalEntry } = useJournalEntries();
  const rows = useJournalRows();
  const { closedThrough } = useClosePeriod();

  const [toast, setToast] = useState("");
  const toastTmr = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTmr.current) clearTimeout(toastTmr.current);
    toastTmr.current = setTimeout(() => setToast(""), 2200);
  }
  // A result handed over on navigation (the form after saving), shown once.
  useEffect(() => {
    if (!navState?.toast) return;
    showToast(navState.toast);
    navigate(`${pathname}${search}`, { replace: true, state: { fromTab: navState.fromTab } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navState?.toast]);

  const fromTab = navState?.fromTab || null;
  const backTo = `/journal-entry${fromTab ? `?tab=${fromTab}` : ""}`;
  const { actionsFor, runAction, sourceOf, storedOf, openEntry, setRecurrenceStatus, dialogs, canTransact, actor } = useJournalActions({
    showToast,
    fromTab,
    // A scheduled entry, once posted, lives on under its new number.
    onPostedScheduled: (n) => navigate(`/journal-entry/${encodeURIComponent(n)}`, { replace: true, state: { fromTab } }),
  });

  const row = rows.find((r) => r.je_number === jeNumber);
  const focusLine = (() => { const n = parseInt(params.get("line"), 10); return Number.isInteger(n) ? n : null; })();
  useEffect(() => {
    if (focusLine == null) return;
    document.querySelector(`[data-line="${focusLine}"]`)?.scrollIntoView({ block: "center" });
  }, [focusLine, row?.je_number]);

  if (!row) {
    return (
      <div className="lg-page">
        <div className="lg-scroll-container jed">
          <button type="button" className="jed-back" onClick={() => navigate(backTo)}>← Journal Entries</button>
          <div className="jed-missing">
            <div className="jed-missing-title">{jeNumber} not found</div>
            <p>There is no journal entry with this number. A scheduled entry gets a new number once it posts.</p>
          </div>
        </div>
      </div>
    );
  }

  const stored = row.status === "scheduled" ? row : storedOf(row);
  const src = sourceOf(stored);
  const acts = actionsFor(row);
  const danger = acts.filter((a) => a.danger);
  const secondary = acts.filter((a) => !a.primary && !a.danger);
  const primary = acts.filter((a) => a.primary);
  const files = stored.attachments || [];
  // Every lifecycle move appends to `history` (lib/journalLifecycle.js).
  // Seeded entries predate it, so their creation (and a posting made before
  // any history) is read off the record itself and leads the trail.
  const history = stored.history || [];
  const events = [
    ...(history[0]?.action === "created" ? [] : [{ at: stored.created_date, action: "created", by: stored.created_by }]),
    ...(!history.length && stored.posted_by ? [{ at: stored.posted_date, action: "posted", by: stored.posted_by }] : []),
    ...history,
  ];
  // A repeating entry: what it has drafted, and its next month on the Scheduled tab.
  const drafted = stored.recurrence ? recurringInstances(entries, stored.je_number) : [];
  const nextRecurring = stored.recurrence
    ? rows.filter((r) => r.status === "scheduled" && r.recurring_of === stored.je_number).sort((a, b) => a.je_date.localeCompare(b.je_date))[0]
    : null;
  const payees = [...new Map((row.lines || []).filter((l) => l.payee).map((l) => [l.payee.id, l.payee.name])).values()];
  const entryPayee = stored.payee?.name || (payees.length === 1 ? payees[0] : payees.length > 1 ? `${payees.length} payees` : null);

  const details = [
    ["Journal no.", row.status === "scheduled" ? "Assigned on posting" : row.je_number],
    ["Posting date", formatDate(row.je_date)],
    ["Memo", row.memo],
    ["Payee", entryPayee || "—"],
    ["Reference", stored.reference || "—"],
    ["Type", stored.reference_type || "manual"],
    ["Created by", `${stored.created_by || "—"}${stored.created_date ? ` · ${formatDate(stored.created_date)}` : ""}`],
    ["Posted by", stored.posted_by ? `${stored.posted_by} · ${formatDate(stored.posted_date)}` : "—"],
  ];

  function attach(fileList) {
    const added = [...fileList].map((f) => ({ name: f.name, size: f.size, type: f.type, url: URL.createObjectURL(f) }));
    if (!added.length) return;
    updateJournalEntry(stored.je_number, (cur) => withEvent({ ...cur, attachments: [...(cur.attachments || []), ...added] }, "attached", actor, added.map((a) => a.name).join(", ")));
    showToast(`${added.length} file${added.length === 1 ? "" : "s"} attached to ${stored.je_number}`);
  }

  return (
    <div className="lg-page">
      <div className="lg-scroll-container jed">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="jed-head">
          <button type="button" className="jed-back" onClick={() => navigate(backTo)}>← Journal Entries</button>
          <div className="jed-head-main">
            <div className="jed-head-text">
              <div className="jed-title-row">
                <h1 className="jed-title">{row.status === "scheduled" ? "Scheduled entry" : row.je_number}</h1>
                <RecurringIcon je={stored} />
                <span className={`badge badge-${STATUS_BADGE_CLASS[displayStatus(stored)]}`}>{STATUS_LABEL[displayStatus(stored)]}</span>
                {stored.self_approved && <span className="je-self-chip" title="Prepared and posted by the same person (Self-posting)">Self-posted</span>}
                {stored.system_posted && <span className="je-sys-chip" title="Posted automatically on its scheduled date — nobody clicked Post">Auto-posted</span>}
              </div>
              <div className="jed-sub">{row.memo}</div>
            </div>
            <div className="jed-actions">
              {danger.map((a) => (
                <button key={a.key} className="drawer-btn ghost danger-text" disabled={!a.check.ok} title={a.check.ok ? "" : a.check.reason} onClick={() => runAction(a.key, row)}>
                  {ACTION_ICON[a.icon]}{a.label}
                </button>
              ))}
              {secondary.map((a) => (
                <button key={a.key} className="drawer-btn ghost" disabled={!a.check.ok} title={a.check.ok ? "" : a.check.reason} onClick={() => runAction(a.key, row)}>
                  {ACTION_ICON[a.icon]}{a.label}
                </button>
              ))}
              {primary.map((a) => (
                <button key={a.key} className="drawer-btn primary" disabled={!a.check.ok} title={a.check.ok ? "" : a.check.reason} onClick={() => runAction(a.key, row)}>
                  {ACTION_ICON[a.icon]}{a.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {row.status === "pending" && isClosedDate(row.je_date, closedThrough) && (
          <div className="jed-stale">
            <strong>{periodOf(row.je_date)} is closed.</strong> This entry can't be posted until its posting date is in an open period — send it back so the preparer can re-date it.
          </div>
        )}
        {row.status === "scheduled" && row.schedule && (
          <div className={`drawer-sched-callout jed-callout${row.schedule.due ? " due" : ""}`}>
            {row.schedule.kind === "recurring" ? (
              <>
                <div className="drawer-sched-eyebrow">
                  {row.schedule.due ? "Due — drafting now" : `Scheduled · becomes a draft on ${formatDate(row.schedule.postsOn)}`}
                </div>
                <p className="drawer-sched-text">
                  {row.schedule.periodLabel}'s copy of {row.recurring_of}, which repeats monthly. On {formatDate(row.schedule.postsOn)} it
                  becomes a draft for {row.created_by} to review and submit, and gets its journal number then. It never posts by
                  itself — it goes through approval like any manual journal.
                  {row.schedule.note && <> {row.schedule.note}</>}
                </p>
              </>
            ) : (
              <>
                <div className="drawer-sched-eyebrow">
                  {row.schedule.due ? "Due — posting now" : `Scheduled · posts itself on ${formatDate(row.schedule.postsOn)}`}
                </div>
                <p className="drawer-sched-text">
                  {row.schedule.kind === "reversal"
                      ? <>Undoes {row.schedule.reverses} on {formatDate(row.schedule.postsOn)} — every debit and credit swapped.</>
                      : <>Drafted from the fixed asset register for {row.schedule.periodLabel}. It is read-only — change an asset and this entry follows.</>}
                  {" "}It posts itself on {formatDate(row.schedule.postsOn)} — no approval needed — recorded as posted by the system, and gets its journal number then.
                  {row.schedule.note && <> {row.schedule.note}</>}
                </p>
              </>
            )}
            {row.schedule.sources.length > 0 && (
              <div className="drawer-sched-list">
                {row.schedule.sources.map((s, i) => (
                  <div key={`${s.id}-${i}`} className="drawer-sched-item">
                    <span className="drawer-sched-tag">{s.tag}</span>
                    <span className="drawer-sched-name">{s.name}</span>
                    <span className="drawer-sched-amt">Rp {fmtRp(s.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {row.schedule.unmapped.length > 0 && (
              <div className="drawer-sched-warn">
                Left out — no account mapped for {row.schedule.unmapped.join(", ")}. Set the accounts on the asset category.
              </div>
            )}
          </div>
        )}

        <div className="jed-body">
          {/* ── Lines ─────────────────────────────────────────────────── */}
          <section className="jed-card jed-lines-card">
            <div className="jed-card-title">Lines · {row.lines.length}</div>
            <table className="jed-lines">
              <thead>
                <tr><th className="jed-idx">#</th><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr>
              </thead>
              <tbody>
                {row.lines.map((l, i) => {
                  const acct = COA_BY_CODE[l.account_code];
                  const keys = acct ? dimensionsForAccount(acct) : [];
                  const simulated = keys.length > 0 && !l.dimensions;
                  return (
                    <tr key={i} data-line={i} className={focusLine === i ? "je-line-focus" : ""}>
                      <td className="jed-idx">{i + 1}</td>
                      <td>
                        <div className="jed-acct"><span className="jed-code">{l.account_code}</span> {l.account_name || acct?.name}</div>
                        {acct && <div className="jed-path">{accountPath(acct).join(" › ")}</div>}
                        {keys.length > 0 && (
                          <div className="jed-dims">
                            {keys.map((k) => {
                              const dim = DIM_BY_KEY[k];
                              if (!dim) return null;
                              const val = l.dimensions?.[k] ?? sampleDimensionValue(k, `${row.je_number}|${l.account_code}|${k}`);
                              if (!val) return null;
                              const pal = paletteFor(dim.cls);
                              return (
                                <span className="je-line-dim" key={k} style={{ background: pal.bg, color: pal.fg }}>
                                  <span className="je-line-dim-k">{dim.label}</span>
                                  <span className="je-line-dim-v">{val}</span>
                                </span>
                              );
                            })}
                            {simulated && <span className="je-line-dim-sim" title="Illustrative values — this entry predates per-line dimension tagging">simulated</span>}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="jed-desc">{l.description || <span className="jed-muted">—</span>}</div>
                        {l.payee && <div className="jed-payee">Payee: <strong>{l.payee.name}</strong></div>}
                      </td>
                      <td className="num">{l.debit > 0 ? fmtRp(l.debit) : ""}</td>
                      <td className="num">{l.credit > 0 ? fmtRp(l.credit) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td colSpan={2} className="jed-total-lbl">Total</td>
                  <td className="num">Rp {fmtRp(row.debit)}</td>
                  <td className="num">Rp {fmtRp(row.credit)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* ── The record ────────────────────────────────────────────── */}
          <aside className="jed-side">
            <section className="jed-card">
              <div className="jed-card-title">Details</div>
              <dl className="jed-dl">
                {details.map(([k, val]) => (<div key={k}><dt>{k}</dt><dd>{val}</dd></div>))}
                <div>
                  <dt>Source</dt>
                  <dd>{src ? <button type="button" className="je-link" onClick={src.open}>{src.label} →</button> : "Manual entry"}</dd>
                </div>
                {stored.reversed_by && (
                  <div><dt>Reversed by</dt><dd><button type="button" className="je-link" onClick={() => openEntry(stored.reversed_by)}>{stored.reversed_by} →</button></dd></div>
                )}
                {stored.auto_reverse && !stored.reversed_by && row.status !== "scheduled" && (
                  <div><dt>Auto-reverse</dt><dd>{stored.reversal_date ? `On ${formatDate(stored.reversal_date)}` : "On the 1st of the month after it posts"}</dd></div>
                )}
                {stored.self_approved && (
                  <div><dt>Approval</dt><dd>Self-posted — prepared and posted by {stored.posted_by}</dd></div>
                )}
                {stored.system_posted && (
                  <div><dt>Approval</dt><dd>None needed — posted automatically on its scheduled date</dd></div>
                )}
              </dl>
            </section>

            {stored.recurrence && row.status !== "scheduled" && (
              <section className="jed-card">
                <div className="jed-card-title jed-rec-title">
                  Repeats monthly
                  <span className={`jed-rec-status ${stored.recurrence.status}`}>
                    {stored.status === "posted" ? RECURRENCE_STATUS[stored.recurrence.status] : "Starts once posted"}
                  </span>
                </div>
                <div className="jed-rec-desc">{describeRecurrence(stored.recurrence)}</div>
                <div className="jed-rec-meta">
                  Each month arrives as a draft for {stored.recurrence.set_by || stored.created_by} to review and submit — nothing posts by itself.
                </div>
                {stored.status === "posted" && stored.recurrence.status === "active" && (
                  <div className="jed-rec-next">
                    {nextRecurring
                      ? <>Next: <button type="button" className="je-link" onClick={() => openEntry(nextRecurring.je_number)}>{nextRecurring.schedule.periodLabel} · {formatDate(nextRecurring.je_date)} →</button></>
                      : "Nothing more in the next two months."}
                  </div>
                )}
                {drafted.length > 0 && (
                  <div className="jed-rec-list">
                    <div className="jed-rec-list-lbl">Drafted so far · {drafted.length}</div>
                    {drafted.map((d) => (
                      <button key={d.je_number} type="button" className="jed-rec-item" onClick={() => openEntry(d.je_number)}>
                        <span className="jed-code">{d.je_number}</span>
                        <span className="jed-rec-item-date">{formatDate(d.je_date)}</span>
                        <span className={`badge badge-${STATUS_BADGE_CLASS[displayStatus(d)]}`}>{STATUS_LABEL[displayStatus(d)]}</span>
                      </button>
                    ))}
                  </div>
                )}
                {canTransact && stored.status === "posted" && stored.recurrence.status !== "ended" && (
                  <div className="jed-rec-actions">
                    {stored.recurrence.status === "active"
                      ? <button type="button" className="drawer-btn ghost" onClick={() => setRecurrenceStatus(stored, "paused")}>Pause</button>
                      : <button type="button" className="drawer-btn ghost" onClick={() => setRecurrenceStatus(stored, "active")}>Resume</button>}
                    <button
                      type="button"
                      className="drawer-btn ghost danger-text"
                      onClick={() => { if (window.confirm(`Stop ${stored.je_number} repeating? Drafts already made stay as they are.`)) setRecurrenceStatus(stored, "ended"); }}
                    >
                      End repeat
                    </button>
                  </div>
                )}
              </section>
            )}

            {row.status !== "scheduled" && (
              <section className="jed-card">
                <div className="jed-card-title">Attachments · {files.length}</div>
                {files.length === 0 && <div className="je-attach-empty">Nothing attached.</div>}
                {files.map((a, i) => (
                  <div key={`${a.name}-${i}`} className="je-attach-row">
                    <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
                    <span>{Math.max(1, Math.round((a.size || 0) / 1024))} KB</span>
                  </div>
                ))}
                {/* Evidence can be added at any stage, posted included — it
                    changes nothing in the ledger. */}
                {stored.status !== "void" && canTransact && (
                  <label className="dje-attach-add">
                    + Attach file
                    <input type="file" multiple onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
              </section>
            )}

            {row.status !== "scheduled" && (
              <section className="jed-card">
                <div className="jed-card-title">Audit trail</div>
                <div className="je-audit">
                  {events.map((ev, i) => (
                    <div key={i} className="je-audit-item">
                      <span className="je-audit-dot" />
                      <div>
                        <div className="je-audit-head"><strong>{ev.action.charAt(0).toUpperCase() + ev.action.slice(1)}</strong> · {ev.by}</div>
                        <div className="je-audit-date">{formatDate(ev.at)}</div>
                        {ev.note && <div className="je-audit-note">{ev.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
        <div style={{ height: 32 }} />
      </div>

      {dialogs}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
