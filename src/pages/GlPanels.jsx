// The General Ledger's panels, kept out of GeneralLedgerPage so the page reads
// as the ledger it is:
//   • GlEntryDrawer   — click-to-drill (Core Ledger PRD §3.5): the entry and
//                       its source document in a slide-over, so the filters
//                       behind it stay put
//   • ReclassDialog   — quick reclassification of one posted line (§3.5)
//   • FiltersPopover  — the stackable filters (§3.4)
//   • ColumnsPopover  — which extended columns show (§3.3)

import { useEffect, useMemo, useState } from "react";
import AccountCombobox from "../components/AccountCombobox";
import { COA_BY_CODE, getActiveAccounts } from "../data/seed/coa";
import { DIM_BY_KEY, dimensionsForAccount, paletteFor } from "../data/seed/dimensions";
import { useDimensions } from "../state/DimensionsContext";
import { manualPostBlock, isClosedDate, firstOfNextMonth } from "../lib/journalLifecycle";
import { ACCOUNT_GROUPS, GL_STATUSES, EMPTY_FILTERS, toCents, lineDimensions } from "../lib/generalLedger";
import { JE_SOURCES, STATUS_LABEL, STATUS_BADGE_CLASS } from "./journalEntryShared";
import { formatDateEn } from "../lib/format";

export const fmtAmt = (cents) => (cents ? (cents / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 }) : "—");
// A balance on its wrong side (an asset in credit) is shown in brackets, the
// way a ledger printout shows it.
export const fmtBal = (cents) => {
  if (!cents) return "0";
  const s = (Math.abs(cents) / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });
  return cents < 0 ? `(${s})` : s;
};

function CloseIcon() {
  return <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>;
}

function DimChips({ dims }) {
  const keys = Object.keys(dims || {});
  if (!keys.length) return null;
  return (
    <span className="gl-dims">
      {keys.map((k) => {
        const p = paletteFor(DIM_BY_KEY[k]?.cls);
        return (
          <span key={k} className="gl-dim" style={{ background: p.bg, color: p.fg }} title={DIM_BY_KEY[k]?.label || k}>
            {dims[k]}
          </span>
        );
      })}
    </span>
  );
}

// ── Click-to-drill slide-over ─────────────────────────────────────────────
// Shows the whole entry with the clicked line highlighted, then the document
// it came from (a bill's or invoice's lines, the matching account marked).
// Reversal and reclassification links move the panel to the related entry.
export function GlEntryDrawer({ target, entries, bills, invoices, sourceOf, onOpenEntry, onJump, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const je = entries.find((j) => j.je_number === target.je_number);
  if (!je) return null;
  const line = target.line != null ? je.lines[target.line] : null;
  const src = sourceOf(je);
  const bill = ["bill", "ap_bill", "bill_payment", "payment"].includes(je.reference_type) ? bills.find((b) => b.id === je.reference_id) : null;
  const invoice = ["invoice", "invoice_payment"].includes(je.reference_type) ? invoices.find((i) => i.id === je.reference_id) : null;
  const doc = bill || invoice;
  const totals = je.lines.reduce((t, l) => ({ dr: t.dr + toCents(l.debit), cr: t.cr + toCents(l.credit) }), { dr: 0, cr: 0 });

  const related = [
    je.reversed_by && { lbl: "Reversed by", n: je.reversed_by },
    je.reversal_of && { lbl: "Reverses", n: je.reversal_of },
    je.reclass_of && { lbl: "Reclassifies", n: je.reclass_of.je_number },
    ...entries.filter((j) => j.reclass_of?.je_number === je.je_number && ["posted", "pending", "draft"].includes(j.status))
      .map((j) => ({ lbl: `Reclassified by (${STATUS_LABEL[j.status].toLowerCase()})`, n: j.je_number })),
  ].filter(Boolean);

  return (
    <div className="gl-drawer-backdrop" onClick={onClose}>
      <aside className="gl-drawer" onClick={(e) => e.stopPropagation()} aria-label={`Journal entry ${je.je_number}`}>
        <div className="gl-drawer-head">
          <div>
            <div className="gl-drawer-eyebrow">Journal entry</div>
            <div className="gl-drawer-title">
              <span className="mono">{je.je_number}</span>
              <span className={`badge badge-${STATUS_BADGE_CLASS[je.status] || "draft"}`}>{STATUS_LABEL[je.status] || je.status}</span>
            </div>
            <div className="gl-drawer-memo">{je.memo}</div>
          </div>
          <button type="button" className="dje-x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>

        <div className="gl-drawer-body">
          <dl className="gl-drawer-meta">
            <div><dt>Date</dt><dd>{formatDateEn(je.je_date)}</dd></div>
            <div><dt>Source</dt><dd>{src ? src.label : "Manual journal"}</dd></div>
            <div><dt>Prepared by</dt><dd>{je.created_by || "—"}</dd></div>
            <div><dt>Posted</dt><dd>{je.posted_by ? `${je.posted_by} · ${formatDateEn(je.posted_date)}` : "Not yet"}</dd></div>
            {related.map((r) => (
              <div key={r.lbl + r.n}>
                <dt>{r.lbl}</dt>
                <dd><button type="button" className="gl-link mono" onClick={() => onJump(r.n)}>{r.n}</button></dd>
              </div>
            ))}
          </dl>

          <div className="gl-drawer-sec">Lines</div>
          <div className="gl-drawer-lines">
            {je.lines.map((l, i) => (
              <div key={i} className={`gl-drawer-line${target.line === i ? " hl" : ""}`}>
                <div className="gl-drawer-line-acct">
                  <span className="gl-code">{l.account_code}</span>
                  <span className="gl-name">{COA_BY_CODE[l.account_code]?.name || l.account_name}</span>
                </div>
                <div className="num">{fmtAmt(toCents(l.debit))}</div>
                <div className="num">{fmtAmt(toCents(l.credit))}</div>
                <div className="gl-drawer-line-desc">
                  {l.description}
                  {l.payee?.name && <span className="gl-drawer-payee"> · {l.payee.name}</span>}
                  <DimChips dims={lineDimensions(je, l)} />
                </div>
              </div>
            ))}
            <div className="gl-drawer-line total">
              <div>Total</div>
              <div className="num">{fmtAmt(totals.dr)}</div>
              <div className="num">{fmtAmt(totals.cr)}</div>
            </div>
          </div>

          {doc && (
            <>
              <div className="gl-drawer-sec">{bill ? "Bill" : "Invoice"} {doc.invNo}</div>
              <div className="gl-doc">
                <div className="gl-doc-head">
                  <div>
                    <div className="gl-doc-party">{bill ? bill.vendorName : invoice.customerName}</div>
                    <div className="gl-doc-sub">{doc.id} · {formatDateEn(doc.date)}{doc.due ? ` · due ${formatDateEn(doc.due)}` : ""}</div>
                  </div>
                  <div className="gl-doc-total">Rp {fmtAmt(toCents(doc.total))}</div>
                </div>
                {(doc.items || []).map((it, i) => {
                  const hit = line && it.acct && it.acct === line.account_code;
                  return (
                    <div key={i} className={`gl-doc-item${hit ? " hl" : ""}`}>
                      <span className="gl-doc-item-desc">{it.desc}{it.acct ? <span className="gl-code"> · {it.acct}</span> : null}</span>
                      <span className="num">{it.qty} × {fmtAmt(toCents(it.price))}</span>
                      <span className="num strong">{fmtAmt(toCents(it.subtotal))}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="gl-drawer-foot">
          <button type="button" className="dje-btn" onClick={() => onOpenEntry(je.je_number, target.line)}>Open entry page</button>
          {src && <button type="button" className="dje-btn primary" onClick={src.open}>Open {src.label.replace(/^Entry /, "entry ")}</button>}
        </div>
      </aside>
    </div>
  );
}

// ── Quick reclassification ────────────────────────────────────────────────
// `preview(params)` builds the journal and runs the submit checks, so the
// dialog shows exactly what will be sent and why it can't be, if it can't.
const ACTIVE_ACCOUNTS = getActiveAccounts().slice().sort((a, b) => a.code.localeCompare(b.code));

export function ReclassDialog({ line, closedThrough, nextNumber, preview, onClose, onConfirm }) {
  const { valuesOf } = useDimensions();
  const full = Math.max(line.dc, line.cc);
  const [toCode, setToCode] = useState(line.code);
  const [dims, setDims] = useState(() => ({ ...line.dims }));
  const [amount, setAmount] = useState(String(full / 100));
  const [date, setDate] = useState(() => (isClosedDate(line.date, closedThrough) ? firstOfNextMonth(`${closedThrough}-01`) : line.date));
  const [reason, setReason] = useState("");

  const targetDims = dimensionsForAccount(COA_BY_CODE[toCode]);
  const amountCents = toCents(amount);
  const shownDims = Object.fromEntries(targetDims.map((k) => [k, dims[k] || ""]));
  const sameDims = targetDims.every((k) => (dims[k] || "") === (line.dims[k] || ""));

  let problem = null;
  if (toCode === line.code && sameDims) problem = "Pick another account, or change a dimension.";
  else if (!(amountCents > 0)) problem = "Enter an amount to move.";
  else if (amountCents > full) problem = `You can move at most Rp ${fmtAmt(full)} — the whole line.`;
  else if (!reason.trim()) problem = "Say why — it becomes the journal's memo.";
  const params = { toCode, amountCents, toDims: shownDims, date, reason: reason.trim() };
  const built = useMemo(() => (problem ? null : preview(params)), [problem, toCode, amountCents, JSON.stringify(shownDims), date, reason]); // eslint-disable-line react-hooks/exhaustive-deps
  const block = problem || (built && !built.check.ok ? built.check.reason : null);

  return (
    <div className="dje-backdrop" onClick={onClose}>
      <div className="dje-modal jad-modal gl-reclass" onClick={(e) => e.stopPropagation()}>
        <div className="dje-head">
          <div>
            <div className="dje-title">Reclassify line</div>
            <div className="dje-sub">{line.je_number} line {line.lineIndex + 1} · {line.desc}</div>
          </div>
          <button className="dje-x" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="dje-body">
          <div className="gl-reclass-from">
            <span className="dje-field-lbl">From</span>
            <div><span className="gl-code">{line.code}</span> {line.name}</div>
            <div className="gl-reclass-from-amt">{line.dc ? "Debit" : "Credit"} Rp {fmtAmt(full)}</div>
            <DimChips dims={line.dims} />
          </div>

          <label className="dje-field">
            <span className="dje-field-lbl">To account</span>
            <AccountCombobox value={toCode} onChange={setToCode} accounts={ACTIVE_ACCOUNTS} blockOf={manualPostBlock} />
          </label>

          {targetDims.length > 0 && (
            <div className="gl-reclass-dims">
              {targetDims.map((k) => (
                <label key={k} className="dje-field">
                  <span className="dje-field-lbl">{DIM_BY_KEY[k]?.label || k}</span>
                  <select className="dje-input" value={dims[k] || ""} onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))}>
                    <option value="">Select…</option>
                    {valuesOf(k).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}

          <div className="gl-reclass-row">
            <label className="dje-field">
              <span className="dje-field-lbl">Amount to move (Rp)</span>
              <input type="number" min="0" step="0.01" className="dje-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="dje-field">
              <span className="dje-field-lbl">Journal date</span>
              <input type="date" className="dje-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <p className="jad-note">Less than the whole line moves part of it; the rest stays where it is.</p>

          <label className="dje-field">
            <span className="dje-field-lbl">Why</span>
            <input className="dje-input" value={reason} placeholder="e.g. Factory consumables booked to Office Supplies" onChange={(e) => setReason(e.target.value)} />
          </label>

          {built && (
            <div className="gl-reclass-preview">
              <div className="gl-drawer-sec">{nextNumber} · sent for approval</div>
              {built.entry.lines.map((l, i) => (
                <div key={i} className="gl-drawer-line">
                  <div className="gl-drawer-line-acct"><span className="gl-code">{l.account_code}</span><span className="gl-name">{l.account_name}</span></div>
                  <div className="num">{fmtAmt(toCents(l.debit))}</div>
                  <div className="num">{fmtAmt(toCents(l.credit))}</div>
                </div>
              ))}
            </div>
          )}
          {block && <div className="dje-warn">{block}</div>}
          <p className="jad-note">The original line stays as posted. This sends a reclassification journal for approval — someone other than you approves it on the Journal Entry page, and the ledger shows the move once it posts.</p>
        </div>
        <div className="dje-foot">
          <span />
          <div className="dje-foot-actions">
            <button className="dje-btn" onClick={onClose}>Cancel</button>
            <button className="dje-btn primary" disabled={!!block} onClick={() => onConfirm(params)}>Send for approval</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Popovers ──────────────────────────────────────────────────────────────
function usePopoverClose(open, ref, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open, ref, onClose]);
}
export { usePopoverClose };

const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Chips({ options, value, onChange }) {
  return (
    <div className="gl-chips">
      {options.map((o) => (
        <button key={o.key} type="button" className={`gl-chip${value.includes(o.key) ? " on" : ""}`} onClick={() => onChange(toggleIn(value, o.key))}>
          {o.color && <span className="gl-acct-dot" style={{ background: o.color }} />}{o.label}
        </button>
      ))}
    </div>
  );
}

// The dimensions offered as filters: the PRD's three (Location, Project, Cost
// Centre) and Department, the one most entries carry.
export const FILTER_DIMS = ["loc", "proj", "cc", "dept"];

export function FiltersPopover({ filters, onChange, parties }) {
  const { valuesOf } = useDimensions();
  const set = (patch) => onChange({ ...filters, ...patch });
  // Posted is always on: unticking it would leave nothing that moves a balance.
  const statuses = GL_STATUSES.filter((s) => s.key !== "posted");
  return (
    <div className="gl-pop gl-filters" role="dialog" aria-label="Filters">
      <div className="gl-pop-sec">
        <div className="gl-pop-lbl">Status</div>
        <div className="gl-chips">
          <span className="gl-chip on fixed" title="Posted lines always show — they are the ledger">Posted</span>
          {statuses.map((s) => (
            <button key={s.key} type="button" className={`gl-chip${filters.statuses.includes(s.key) ? " on" : ""}`}
              onClick={() => set({ statuses: toggleIn(filters.statuses, s.key) })}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="gl-pop-hint">Draft and pending lines show tagged and never move a balance.</div>
      </div>

      <div className="gl-pop-sec">
        <div className="gl-pop-lbl">Account type</div>
        <Chips options={ACCOUNT_GROUPS.filter((g) => g.k !== "other").map((g) => ({ key: g.k, label: g.lbl, color: g.color }))}
          value={filters.types} onChange={(types) => set({ types })} />
      </div>

      <div className="gl-pop-sec">
        <div className="gl-pop-lbl">Account codes</div>
        <div className="gl-pop-range">
          <input className="dje-input" placeholder="From, e.g. 6" value={filters.codeFrom} onChange={(e) => set({ codeFrom: e.target.value })} />
          <span>–</span>
          <input className="dje-input" placeholder="To, e.g. 6-3999" value={filters.codeTo} onChange={(e) => set({ codeTo: e.target.value })} />
        </div>
      </div>

      <div className="gl-pop-sec">
        <div className="gl-pop-lbl">Source</div>
        <Chips options={JE_SOURCES} value={filters.sources} onChange={(sources) => set({ sources })} />
      </div>

      <div className="gl-pop-sec">
        <div className="gl-pop-lbl">Line amount (Rp)</div>
        <div className="gl-pop-range">
          <input type="number" min="0" className="dje-input" placeholder="At least" value={filters.min} onChange={(e) => set({ min: e.target.value })} />
          <span>–</span>
          <input type="number" min="0" className="dje-input" placeholder="At most" value={filters.max} onChange={(e) => set({ max: e.target.value })} />
        </div>
      </div>

      <div className="gl-pop-sec">
        <div className="gl-pop-lbl">Vendor / customer</div>
        <select className="dje-input" value={filters.party} onChange={(e) => set({ party: e.target.value })}>
          <option value="">Anyone</option>
          {parties.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="gl-pop-sec">
        <div className="gl-pop-lbl">Dimensions</div>
        <div className="gl-pop-dims">
          {FILTER_DIMS.map((k) => (
            <label key={k}>
              <span>{DIM_BY_KEY[k]?.label || k}</span>
              <select className="dje-input" value={filters.dims[k] || ""} onChange={(e) => set({ dims: { ...filters.dims, [k]: e.target.value } })}>
                <option value="">Any</option>
                {valuesOf(k).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="gl-pop-sec">
        <label className="gl-pop-check">
          <input type="checkbox" checked={filters.hideReversed} onChange={(e) => set({ hideReversed: e.target.checked })} />
          Hide reversed entries and their reversals
        </label>
      </div>

      <div className="gl-pop-foot">
        <button type="button" className="dje-btn" onClick={() => onChange(EMPTY_FILTERS)}>Reset</button>
      </div>
    </div>
  );
}

export function ColumnsPopover({ columns, shown, onChange }) {
  return (
    <div className="gl-pop gl-columns" role="dialog" aria-label="Columns">
      <div className="gl-pop-lbl">Extra columns</div>
      {columns.map((c) => (
        <label key={c.key} className="gl-pop-check">
          <input type="checkbox" checked={shown.includes(c.key)} onChange={() => onChange(toggleIn(shown, c.key))} />
          {c.label}
        </label>
      ))}
      <div className="gl-pop-hint">Currency, FX rate, quantity and reconciliation status join when entries carry them — every entry here is in IDR.</div>
    </div>
  );
}
