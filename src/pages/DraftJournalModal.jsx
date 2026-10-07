import { useState, useMemo } from "react";
import { getActiveAccounts, COA_BY_CODE } from "../data/seed/coa";
import { DIM_BY_KEY, paletteFor, dimensionsForAccount } from "../data/seed/dimensions";
import { TODAY } from "../lib/clock";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useVendors } from "../state/VendorsContext";

// Seed JEs store dates as local ISO "YYYY-MM-DD" strings; match that so list
// sorting (which calls String.localeCompare on je_date) keeps working.
const TODAY_ISO = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

function fmtRp(n) {
  if (!n) return "0";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

// Real dimension values only — "—" is the "not applicable" placeholder and
// shouldn't be offered as a pickable value when a line requires a dimension.
function valuesFor(key) {
  const dim = DIM_BY_KEY[key];
  if (!dim) return [];
  return dim.values.filter((v) => v !== "—");
}

let LINE_SEQ = 0;
function blankLine() {
  return { id: ++LINE_SEQ, account_code: "", debit: "", credit: "", description: "", dims: {}, payee: "" };
}

// Map pre-filled lines (from a stock adjustment or other flow) into the modal's
// internal line shape. Amounts come in as numbers; the inputs want strings.
function seedLines(initialLines) {
  if (!Array.isArray(initialLines) || !initialLines.length) return [blankLine(), blankLine()];
  return initialLines.map((l) => ({
    id: ++LINE_SEQ,
    account_code: l.account_code || "",
    debit: l.debit ? String(l.debit) : "",
    credit: l.credit ? String(l.credit) : "",
    description: l.description || "",
    // Kept when editing an existing draft, so nothing chosen is lost.
    payee: l.payee ? `${l.payee.kind}:${l.payee.id}` : "",
    dims: { ...(l.dimensions || {}) },
  }));
}

// `editing` is an existing draft to change in place; otherwise a new draft is
// made. `closedThrough` warns about a date in a closed period — a draft can sit
// there, but it cannot be submitted or posted until it is re-dated.
export default function DraftJournalModal({ open, intentQuery, initialLines, initialMemo, nextJeNumber, createdBy, editing, closedThrough, onClose, onSave }) {
  const accounts = useMemo(() => {
    return getActiveAccounts().slice().sort((a, b) => a.code.localeCompare(b.code));
  }, []);

  const [jeDate, setJeDate] = useState(editing?.je_date || TODAY_ISO);
  const [memo, setMemo] = useState(editing?.memo || initialMemo || intentQuery || "");
  // The document behind the entry (an invoice or receipt number). Payment shows
  // it as the Reference of a journal payable; blank reads as "—".
  const [reference, setReference] = useState(editing?.reference || "");
  const [lines, setLines] = useState(() => seedLines(editing?.lines || initialLines));
  const [showErrors, setShowErrors] = useState(false);
  // An accrual is usually undone on the 1st of next month, when the real
  // invoice is expected; ticking this schedules that reversal once it posts.
  const [autoReverse, setAutoReverse] = useState(!!editing?.auto_reverse);
  // Supporting documents. Kept in memory as object URLs — the prototype has no
  // file store — so they last for the session.
  const [attachments, setAttachments] = useState(() => editing?.attachments || []);
  const addFiles = (files) => setAttachments((prev) => [
    ...prev,
    ...[...files].map((f) => ({ name: f.name, size: f.size, type: f.type, url: URL.createObjectURL(f) })),
  ]);
  const periodClosed = !!closedThrough && jeDate.slice(0, 7) <= closedThrough;

  // A line on a reconcilable account is a payable the Payment list has to
  // settle, so it must say who is owed — without a payee there is nobody to pay
  // and nothing to match a bank line against. Other lines in the same entry
  // (the expense side) need none. Employees being reimbursed are registered as
  // vendors until there is an Expense module. Payees come from the vendor
  // master only (Payment discussion, 2026-10-07): that is where the bank
  // details and the payment history live.
  const { reconcilableAccounts } = useAccountingSettings();
  const { vendors } = useVendors();
  const isReconcilable = (code) => !!code && reconcilableAccounts.includes(code);
  const payeeOf = (key) => {
    const [kind, id] = String(key || "").split(":");
    const rec = kind === "vendor" ? vendors.find((v) => v.id === id) : null;
    return rec ? { kind, id, name: rec.name } : null;
  };
  const payeeVendors = useMemo(
    () => vendors.filter((v) => v.status !== "inactive").slice().sort((a, b) => a.name.localeCompare(b.name)),
    [vendors],
  );

  function applicableDims(code) {
    const acct = COA_BY_CODE[code];
    return acct ? dimensionsForAccount(acct) : [];
  }

  function patchLine(id, patch) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function onAccountChange(id, code) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        // Keep dimension values that still apply to the newly chosen account.
        const keys = code ? applicableDims(code) : [];
        const dims = {};
        for (const k of keys) if (l.dims[k]) dims[k] = l.dims[k];
        return { ...l, account_code: code, dims, payee: isReconcilable(code) ? l.payee : "" };
      }),
    );
  }

  function onAmountChange(id, field, raw) {
    const val = raw.replace(/[^\d]/g, "");
    const other = field === "debit" ? "credit" : "debit";
    patchLine(id, { [field]: val, [other]: val ? "" : undefined });
  }

  function setDim(id, key, value) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, dims: { ...l.dims, [key]: value } } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(id) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }

  // ── Totals + validation ──────────────────────────────────────────────
  const activeLines = lines.filter((l) => l.account_code);
  const totalDebit = activeLines.reduce((s, l) => s + (parseInt(l.debit, 10) || 0), 0);
  const totalCredit = activeLines.reduce((s, l) => s + (parseInt(l.credit, 10) || 0), 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  // Every active line needs exactly one side and all its applicable dimensions.
  const lineErrors = useMemo(() => {
    const errs = {};
    for (const l of lines) {
      if (!l.account_code) continue;
      const d = parseInt(l.debit, 10) || 0;
      const c = parseInt(l.credit, 10) || 0;
      const missing = [];
      if (d === 0 && c === 0) missing.push("amount");
      if (d > 0 && c > 0) missing.push("one side only");
      if (isReconcilable(l.account_code) && !payeeOf(l.payee)) missing.push("payee");
      for (const k of applicableDims(l.account_code)) {
        if (!l.dims[k]) missing.push(DIM_BY_KEY[k]?.label || k);
      }
      if (missing.length) errs[l.id] = missing;
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, reconcilableAccounts, vendors]);

  const dimsComplete = Object.keys(lineErrors).length === 0;
  const canSave = activeLines.length >= 2 && balanced && dimsComplete;

  if (!open) return null;

  // `submit` saves and sends for approval in one go; the page runs the same
  // checks as the Submit action (balanced, open period).
  function handleSave(submit = false) {
    if (!canSave || (submit && periodClosed)) {
      setShowErrors(true);
      return;
    }
    const je = {
      ...(editing || {}),
      je_number: editing?.je_number || nextJeNumber,
      je_date: jeDate,
      status: "draft",
      memo: memo.trim() || "Manual journal entry",
      reference: reference.trim() || null,
      reference_type: editing?.reference_type || "manual",
      reference_id: editing?.reference_id ?? null,
      created_by: editing?.created_by || createdBy || "You",
      created_date: editing?.created_date || TODAY_ISO,
      posted_by: null,
      posted_date: null,
      auto_reverse: autoReverse,
      attachments,
      lines: activeLines.map((l) => {
        const acct = COA_BY_CODE[l.account_code];
        return {
          account_code: l.account_code,
          account_name: acct?.name || "",
          debit: parseInt(l.debit, 10) || 0,
          credit: parseInt(l.credit, 10) || 0,
          description: l.description.trim(),
          dimensions: { ...l.dims },
          ...(isReconcilable(l.account_code) && payeeOf(l.payee) ? { payee: payeeOf(l.payee) } : {}),
        };
      }),
    };
    onSave(je, { submit, editing: !!editing });
  }

  return (
    <div className="dje-backdrop" onClick={onClose}>
      <div className="dje-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dje-head">
          <div>
            <div className="dje-title">{editing ? "Edit draft" : "Draft Journal Entry"}</div>
            <div className="dje-sub">{editing?.je_number || nextJeNumber} · Draft</div>
          </div>
          <button className="dje-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
          </button>
        </div>

        <div className="dje-body">
          <div className="dje-meta">
            <label className="dje-field">
              <span className="dje-field-lbl">Date</span>
              <input type="date" className="dje-input" value={jeDate} onChange={(e) => setJeDate(e.target.value)} />
            </label>
            <label className="dje-field dje-field-grow">
              <span className="dje-field-lbl">Memo</span>
              <input
                className="dje-input"
                placeholder="What is this entry for?"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </label>
            <label className="dje-field dje-field-ref">
              <span className="dje-field-lbl">Reference</span>
              <input
                className="dje-input"
                placeholder="Document no. (optional)"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          </div>
          {periodClosed && (
            <div className="dje-warn">
              {jeDate.slice(0, 7)} is closed. You can save this as a draft, but it cannot be submitted or posted until it is dated in an open period.
            </div>
          )}

          <div className="dje-lines-hdr">
            <span>Lines</span>
            <span className="dje-hint">Pick an account — the dimensions it requires appear automatically.</span>
          </div>

          {lines.map((l) => {
            const keys = applicableDims(l.account_code);
            const errs = showErrors ? lineErrors[l.id] : null;
            return (
              <div className={`dje-line${errs ? " has-err" : ""}`} key={l.id}>
                <div className="dje-line-main">
                  <select
                    className="dje-input dje-acct"
                    value={l.account_code}
                    onChange={(e) => onAccountChange(l.id, e.target.value)}
                  >
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.code} value={a.code}>{a.code} · {a.name}</option>
                    ))}
                  </select>
                  <input
                    className="dje-input dje-amt"
                    inputMode="numeric"
                    placeholder="Debit"
                    value={l.debit ? Number(l.debit).toLocaleString("id-ID") : ""}
                    onChange={(e) => onAmountChange(l.id, "debit", e.target.value)}
                  />
                  <input
                    className="dje-input dje-amt"
                    inputMode="numeric"
                    placeholder="Credit"
                    value={l.credit ? Number(l.credit).toLocaleString("id-ID") : ""}
                    onChange={(e) => onAmountChange(l.id, "credit", e.target.value)}
                  />
                  <button
                    className="dje-line-del"
                    onClick={() => removeLine(l.id)}
                    disabled={lines.length <= 1}
                    aria-label="Remove line"
                  >×</button>
                </div>

                <input
                  className="dje-input dje-desc"
                  placeholder="Line description (optional)"
                  value={l.description}
                  onChange={(e) => patchLine(l.id, { description: e.target.value })}
                />

                {isReconcilable(l.account_code) && (
                  <div className="dje-payee">
                    <span className="dje-dims-lbl">Payee</span>
                    <select
                      className={`dje-input dje-payee-sel${l.payee ? " set" : ""}`}
                      value={l.payee}
                      onChange={(e) => patchLine(l.id, { payee: e.target.value })}
                    >
                      <option value="">Who is owed this?</option>
                      {payeeVendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.name}</option>)}
                    </select>
                    <span className="dje-payee-hint">Reconcilable account — this line goes to Payment until it is paid.</span>
                  </div>
                )}

                {l.account_code && (
                  keys.length > 0 ? (
                    <div className="dje-dims">
                      <span className="dje-dims-lbl">Dimensions</span>
                      {keys.map((k) => {
                        const dim = DIM_BY_KEY[k];
                        const pal = paletteFor(dim.cls);
                        const set = !!l.dims[k];
                        return (
                          <span
                            className={`dje-dim-pick${set ? " set" : ""}`}
                            key={k}
                            style={set ? { background: pal.bg, color: pal.fg, borderColor: pal.bg } : undefined}
                          >
                            <span className="dje-dim-dot" style={{ background: pal.dot }} />
                            <select
                              className="dje-dim-sel"
                              value={l.dims[k] || ""}
                              onChange={(e) => setDim(l.id, k, e.target.value)}
                              style={set ? { color: pal.fg } : undefined}
                            >
                              <option value="">{dim.label}…</option>
                              {valuesFor(k).map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="dje-dims dje-dims-none">No dimensions required for this account.</div>
                  )
                )}

                {errs && <div className="dje-line-err">Needs: {errs.join(", ")}</div>}
              </div>
            );
          })}

          <button className="dje-add-line" onClick={addLine}>+ Add line</button>

          <label className="dje-check">
            <input type="checkbox" checked={autoReverse} onChange={(e) => setAutoReverse(e.target.checked)} />
            <span>
              <strong>Reverse automatically on the 1st of next month</strong>
              <span className="dje-hint">For accruals: once posted, the reversal is scheduled on the Scheduled tab.</span>
            </span>
          </label>

          <div className="dje-attach">
            <div className="dje-lines-hdr">
              <span>Attachments</span>
              <span className="dje-hint">The invoice, calculation or approval behind this entry.</span>
            </div>
            {attachments.map((a, i) => (
              <div key={`${a.name}-${i}`} className="dje-attach-item">
                <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
                <span className="dje-attach-size">{Math.max(1, Math.round((a.size || 0) / 1024))} KB</span>
                <button type="button" className="dje-line-del" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} aria-label="Remove attachment">×</button>
              </div>
            ))}
            <label className="dje-attach-add">
              + Attach file
              <input type="file" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
        </div>

        <div className="dje-foot">
          <div className="dje-totals">
            <span>Dr <strong>{fmtRp(totalDebit)}</strong></span>
            <span>Cr <strong>{fmtRp(totalCredit)}</strong></span>
            <span className={`dje-bal ${balanced ? "ok" : "off"}`}>
              {balanced ? "Balanced" : `Out by ${fmtRp(Math.abs(totalDebit - totalCredit))}`}
            </span>
          </div>
          <div className="dje-foot-actions">
            <button className="dje-btn" onClick={onClose}>Cancel</button>
            <button className="dje-btn" onClick={() => handleSave(false)} disabled={!canSave}>
              Save draft
            </button>
            <button
              className="dje-btn primary"
              onClick={() => handleSave(true)}
              disabled={!canSave || periodClosed}
              title={periodClosed ? "The date is in a closed period" : "Save and send for approval"}
            >
              Save &amp; submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
