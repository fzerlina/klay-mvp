// Quick draft — the cash journal for a statement line nothing in Klay explains.
//
// Opened from To match's Klay side. The bank side is the line itself: its
// date, its amount and its account are fixed, because they are what the bank
// printed. The person only says what the money was for, and the type picks the
// other side of the entry:
//
//   Vendor payment (AP)   money out. Against a bill: recorded as that bill's
//                         payment, PPh 23 included when the bank amount is the
//                         bill less it. It skips the payment approval — the
//                         money has already left — so it is flagged, and the
//                         payment approvers get a task to review it. Without a
//                         bill: Dr Accounts Payable, Cr Bank, for the vendor
//   Customer receipt (AR) money in. Dr Bank, Cr Accounts Receivable; against an
//                         invoice it also records the receipt on it
//   Other journal         either way. Any account on the other side — an
//                         expense, income, tax, payroll, a transfer, a refund
//
// Posting writes the journal. It is not paired with the line here: it appears
// on the Klay side ticked, and the line is reconciled to it by hand.

import { useMemo, useState } from "react";
import { COA } from "../data/seed/coa";
import { bankLineFor, draftProblem } from "../lib/reconJournal";
import { paymentJournalLines } from "../lib/paymentJournal";
import { emptyBreakdown, newDeduction, remainingWithholding, breakdownTotal, WITHHOLDING_ACCOUNT } from "../lib/paymentBreakdown";
import { nameAgrees } from "../lib/bankMatching";
import { formatRupiahExact } from "../lib/format";

export const ACCT_AP = "2-1100";
export const ACCT_AR = "1-2100";

const LEAVES = COA.filter((a) => a.type !== "group" && a.is_active !== false);
const nameOf = (code) => LEAVES.find((a) => a.code === code)?.name || code;
// Other journal offers everything but the bank accounts themselves — the bank
// side is already the line.
const OTHER_ACCOUNTS = LEAVES.filter((a) => !/^Bank\b/.test(a.name || "") && !["11110", "11120"].includes(a.code));
const rp = (n) => formatRupiahExact(Math.abs(n || 0));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]} ${iso.slice(0, 4)}`;

const TYPES = {
  ap: { k: "ap", lbl: "Vendor payment (AP)" },
  ar: { k: "ar", lbl: "Customer receipt (AR)" },
  other: { k: "other", lbl: "Other journal" },
};

const openOf = (b) => (b.sisa != null ? b.sisa : b.total);
const invoiceOpen = (i) => (i.dpp || i.total) - (i.receipts || []).reduce((s, r) => s + r.amount, 0);

export default function QuickDraftModal({ line, account, vendors, customers, bills, invoices, paymentHistoryOf, canPost = true, onPost, onClose }) {
  const out = line.amount < 0;
  const cash = Math.abs(line.amount);
  const types = out ? [TYPES.ap, TYPES.other] : [TYPES.ar, TYPES.other];

  // What the line already points at: a bill it looks like the payment of, or
  // the party named in the bank text.
  const guessVendor = line.billId
    ? bills.find((b) => b.id === line.billId)?.vendor
    : vendors.find((v) => nameAgrees(line.counterparty, v.name))?.id;
  const guessCustomer = customers.find((c) => nameAgrees(line.counterparty, c.name))?.id;

  const [type, setType] = useState(types[0].k);
  const [vendorId, setVendorId] = useState(guessVendor || "");
  const [billId, setBillId] = useState(line.billId || "");
  const [customerId, setCustomerId] = useState(guessCustomer || "");
  const [invoiceId, setInvoiceId] = useState("");
  const [otherAcct, setOtherAcct] = useState("");
  const [memo, setMemo] = useState(line.description);

  const vendor = vendors.find((v) => v.id === vendorId) || null;
  const customer = customers.find((c) => c.id === customerId) || null;
  const vendorBills = useMemo(
    () => bills.filter((b) => b.vendor === vendorId && b.approval === "approved" && b.pay !== "paid" && openOf(b) > 0),
    [bills, vendorId],
  );
  const customerInvoices = useMemo(
    () => invoices.filter((i) => i.customer === customerId && i.approval === "sent" && i.payStatus !== "paid" && invoiceOpen(i) > 0),
    [invoices, customerId],
  );
  const bill = vendorBills.find((b) => b.id === billId) || null;
  const invoice = customerInvoices.find((i) => i.id === invoiceId) || null;

  const bankLine = bankLineFor(account);
  const bankSide = { ...bankLine, debit: out ? 0 : cash, credit: out ? cash : 0, description: `Statement — ${line.description}` };

  // The entry, and what stops it posting.
  const plan = useMemo(() => {
    if (type === "ap") {
      if (!vendor) return { problem: "Choose the vendor." };
      if (bill) {
        const open = openOf(bill);
        const pph = remainingWithholding(bill.pph23, paymentHistoryOf(bill.id));
        const bd = { ...emptyBreakdown(), sourceAccountId: account.id, to_vendor: cash };
        let note;
        if (pph > 0 && cash + pph === open) {
          bd.deductions = [newDeduction({ amount: pph, account: WITHHOLDING_ACCOUNT })];
          note = `Pays ${bill.id} in full: ${rp(cash)} sent + ${rp(pph)} PPh 23 withheld.`;
        } else if (cash <= open) {
          note = cash === open ? `Pays ${bill.id} in full.` : `Part-pays ${bill.id}: ${rp(open - cash)} stays open.`;
        } else {
          return { problem: `${rp(cash)} is more than ${bill.id}'s open balance of ${rp(open)}. Record it without a bill, or as an Other journal.` };
        }
        const { lines } = paymentJournalLines(bd, { vendorName: vendor.name });
        return {
          kind: "bill-payment", breakdown: bd, full: breakdownTotal(bd) >= open, note,
          lines: lines.map((l) => ({ account_code: l.account_code, account_name: l.account_name, debit: l.side === "DR" ? l.amount : 0, credit: l.side === "CR" ? l.amount : 0, description: l.description })),
        };
      }
      return {
        kind: "journal", contra: ACCT_AP, note: `No bill — ${rp(cash)} to ${vendor.name}'s payable.`,
        lines: [bankSide, { account_code: ACCT_AP, account_name: nameOf(ACCT_AP), debit: cash, credit: 0, description: `Paid to ${vendor.name}` }],
      };
    }
    if (type === "ar") {
      if (!customer) return { problem: "Choose the customer." };
      const open = invoice ? invoiceOpen(invoice) : 0;
      if (invoice && cash > open) return { problem: `${rp(cash)} is more than ${invoice.id}'s open ${rp(open)}. Record it without an invoice, or as an Other journal.` };
      return {
        kind: "journal", contra: ACCT_AR, invoice, paysInFull: invoice ? cash >= open : false,
        note: invoice ? (cash >= open ? `Settles ${invoice.id}.` : `Part-pays ${invoice.id}: ${rp(open - cash)} stays open.`) : `No invoice — ${rp(cash)} from ${customer.name}.`,
        lines: [bankSide, { account_code: ACCT_AR, account_name: nameOf(ACCT_AR), debit: 0, credit: cash, description: `Received from ${customer.name}${invoice ? ` · ${invoice.id}` : ""}` }],
      };
    }
    if (!otherAcct) return { problem: "Choose the account on the other side." };
    return {
      kind: "journal", contra: otherAcct,
      lines: [bankSide, { account_code: otherAcct, account_name: nameOf(otherAcct), debit: out ? cash : 0, credit: out ? 0 : cash, description: memo }],
    };
  }, [type, vendor, bill, customer, invoice, otherAcct, memo, cash, out, account, bankSide.account_code]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = plan.lines ? { je_date: line.date, memo, lines: plan.lines } : null;
  const balance = entry && plan.kind === "journal" ? draftProblem(entry, line) : null;
  const problem = plan.problem || balance || (!memo.trim() ? "Add a memo." : null);

  function post() {
    if (problem || !canPost) return;
    onPost({
      ...plan, type, memo: memo.trim(), entry,
      vendor, bill, customer, invoice: plan.invoice || null,
      party: vendor?.name || customer?.name || "",
    });
  }

  return (
    <div className="bank-upload-backdrop" onClick={onClose}>
      <div className="bank-upload-modal rj-modal qd-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Quick draft">
        <div className="bank-upload-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="bank-upload-title">Quick draft</div>
            <div className="bank-upload-sub">{line.description}</div>
          </div>
          <button type="button" className="bank-upload-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>

        <div className="rj-body">
          <div className="qd-bank" title="The bank side is what the bank printed, so it can't be changed here.">
            <span>{day(line.date)}</span>
            <span>{account.name}</span>
            <strong className={out ? "" : "in"}>{out ? "−" : ""}{rp(cash)}</strong>
          </div>

          <div className="qd-types" role="group" aria-label="What was this money for?">
            <span className="qd-lbl">What was this money for?</span>
            <div className="recon-dir">
              {types.map((t) => (
                <button key={t.k} type="button" className={`recon-dir-btn${type === t.k ? " on" : ""}`} aria-pressed={type === t.k} onClick={() => setType(t.k)}>{t.lbl}</button>
              ))}
            </div>
          </div>

          <div className="rj-fields">
            {type === "ap" && (
              <>
                <label className="rj-field rj-field-grow">
                  <span>Vendor</span>
                  <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setBillId(""); }}>
                    <option value="">Choose a vendor…</option>
                    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </label>
                <label className="rj-field rj-field-grow">
                  <span>Bill</span>
                  <select value={billId} onChange={(e) => setBillId(e.target.value)} disabled={!vendor}>
                    <option value="">No bill</option>
                    {vendorBills.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.invNo} · {rp(openOf(b))} open</option>)}
                  </select>
                </label>
              </>
            )}
            {type === "ar" && (
              <>
                <label className="rj-field rj-field-grow">
                  <span>Customer</span>
                  <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(""); }}>
                    <option value="">Choose a customer…</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="rj-field rj-field-grow">
                  <span>Invoice</span>
                  <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!customer}>
                    <option value="">No invoice</option>
                    {customerInvoices.map((i) => <option key={i.id} value={i.id}>{i.id} · {rp(invoiceOpen(i))} open</option>)}
                  </select>
                </label>
              </>
            )}
            {type === "other" && (
              <label className="rj-field rj-field-grow">
                <span>Account</span>
                <select value={otherAcct} onChange={(e) => setOtherAcct(e.target.value)}>
                  <option value="">Choose an account…</option>
                  {OTHER_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                </select>
              </label>
            )}
            <label className="rj-field rj-field-grow qd-memo">
              <span>Memo</span>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </label>
          </div>

          {plan.kind === "bill-payment" && (
            <div className="qd-warn">
              Recorded as {bill.id}&rsquo;s payment without an approval — the money has already left the bank. Payment approvers get a task to review it.
            </div>
          )}

          {entry && (
            <div className="rj-lines">
              <div className="rj-line rj-line-head">
                <span>Account</span><span>Description</span><span className="num">Debit</span><span className="num">Credit</span><span />
              </div>
              {entry.lines.map((l, i) => (
                <div className="rj-line rj-line-locked" key={i}>
                  <span className="rj-acct"><strong>{l.account_code}</strong> {l.account_name}</span>
                  <span className="rj-desc">{l.description}</span>
                  <span className="num">{l.debit ? rp(l.debit) : "—"}</span>
                  <span className="num">{l.credit ? rp(l.credit) : "—"}</span>
                  <span />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mm-foot">
          <div className={`mm-foot-sum${problem ? " rj-problem" : ""}`}>{problem || plan.note || "Balanced. The bank side equals the statement line."}</div>
          <button type="button" className="recon-ex-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="recon-ex-btn primary" disabled={!!problem || !canPost} title={canPost ? undefined : "Needs the Reconcile bank permission"} onClick={post}>
            Post journal
          </button>
        </div>
      </div>
    </div>
  );
}
