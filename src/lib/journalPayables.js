// Payables that are not bills.
//
// Some things the company owes are booked by a manual journal entry instead of
// a bill: a bonus, a reimbursement owed to an employee, a declared dividend.
// They still have to be paid, so the Payment list carries them next to bills.
//
// A journal line is payable when it CREDITS an account flagged reconcilable in
// the chart of accounts (Settings → Chart of Accounts) and names a payee. The
// payee is what makes it payable: without one there is nobody to pay and
// nothing for bank reconciliation to match. Lines without a payee — including
// every ledger entry made before the flag existed — stay off the list.
//
// Each payable line becomes a row shaped like an AP aging line, so the Payment
// list, its release checks, Record payment and the bank file treat a bill and a
// journal payable the same way. What differs is where the money is owed from:
// a bill relieves trade AP (2-1100), a journal payable relieves the line's own
// account, carried on the row as `payableAccount`.

import { daysSince } from "./clock";
import { COA_BY_CODE } from "../data/seed/coa";

// The row id is the entry number, so it reads as what it is on the list. An
// entry with several payable lines (a bonus split across three people) numbers
// them: JE-2025-0311/1, JE-2025-0311/2, …
export function journalPayableLines(entries, reconcilableCodes, paidSoFarOf = () => 0, { vendorById = () => null } = {}) {
  const codes = new Set(reconcilableCodes || []);
  const out = [];
  for (const je of entries || []) {
    if (je.status !== "posted") continue;
    const payable = (je.lines || []).filter((l) => codes.has(l.account_code) && (l.credit || 0) > 0 && l.payee?.id);
    payable.forEach((l, i) => {
      const id = payable.length > 1 ? `${je.je_number}/${i + 1}` : je.je_number;
      const total = l.credit;
      const remaining = Math.max(0, total - (paidSoFarOf(id) || 0));
      const due = l.due_date || je.je_date;
      out.push({
        id,
        kind: "journal",
        je_number: je.je_number,
        vendorId: l.payee.kind === "vendor" ? l.payee.id : null,
        customerId: l.payee.kind === "customer" ? l.payee.id : null,
        vendorName: l.payee.name,
        // The release checks read the vendor record for bank details and
        // payee approval. A customer payee has none in the vendor master.
        vendorRaw: l.payee.kind === "vendor" ? vendorById(l.payee.id) : null,
        // The list's invoice column carries the entry's memo — there is no
        // vendor invoice behind a journal payable.
        invNo: l.description || je.memo,
        memo: je.memo,
        invoiceDate: je.je_date,
        dueDate: due,
        daysOverdue: daysSince(due),
        total,
        remaining,
        pph23: 0,
        is_accrual: false,
        payableAccount: { code: l.account_code, name: l.account_name || COA_BY_CODE[l.account_code]?.name || l.account_code },
        // paymentStatusOf() reads sisa/total, the same as a bill record.
        raw: { id, total, sisa: remaining, je_number: je.je_number, line: l, je },
      });
    });
  }
  return out;
}

export const isJournalPayable = (line) => line?.kind === "journal";
