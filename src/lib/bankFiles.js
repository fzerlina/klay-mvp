// Bulk-transfer files for internet banking.
//
// Finance Staff select approved bills, export one file, and upload it to the
// bank's bulk-transfer screen instead of keying each transfer by hand.
// Exporting changes nothing in Klay: no payment is recorded and no status
// moves. The payments are recorded the usual way once the bank has executed
// them.
//
// The format follows the bank we pay FROM, so one file is written per source
// account. Each line transfers the bill's full open balance less the PPh it
// withholds — the tax is kept back for the tax office, never sent to the
// vendor.
//
// UNVERIFIED LAYOUTS. The three formats below are prototypes built from the
// general shape of each bank's bulk upload (a debit account, then one line per
// beneficiary), not from the banks' published templates. Column order, header
// records, delimiters and field lengths must be checked against a real
// template from KlikBCA Bisnis, Mandiri MCM and BRI CMS before anyone uploads
// one. The UI says so wherever a file is offered.

import { defaultBreakdown, cashOut, withheldTax } from "./paymentBreakdown";

// Company bank codes (seed/bankAccounts.js) → a format. Only these banks have
// one; any other source account cannot produce a file.
export const BANK_FILE_FORMATS = {
  BCA: {
    label: "BCA — KlikBCA Bisnis",
    delimiter: ",",
    // A header record carrying the debit account and control totals, then the
    // transfers.
    header: (ctx) => [["Debit account", "Transfer date", "Total lines", "Total amount"], [ctx.debitAccount, ctx.date, ctx.count, ctx.total]],
    columns: ["No", "Beneficiary account", "Beneficiary name", "Beneficiary bank", "Amount", "Remark"],
    row: (t, i) => [i + 1, t.account, t.holder, t.bank, t.amount, t.remark],
  },
  MDR: {
    label: "Mandiri — MCM",
    delimiter: ",",
    header: null,
    columns: ["Debit account", "Beneficiary account", "Beneficiary name", "Currency", "Amount", "Remark", "Beneficiary bank", "Transfer type"],
    row: (t, _i, ctx) => [ctx.debitAccount, t.account, t.holder, "IDR", t.amount, t.remark, t.bank, t.sameBank ? "In-house" : "Interbank"],
  },
  BRI: {
    label: "BRI — CMS",
    delimiter: ";",
    header: null,
    columns: ["Beneficiary account", "Beneficiary name", "Beneficiary bank", "Amount", "Remark"],
    row: (t) => [t.account, t.holder, t.bank, t.amount, t.remark],
  },
};

export const formatForAccount = (account) => (account ? BANK_FILE_FORMATS[account.bank] || null : null);

// Vendor-master bank names and company bank codes name the same banks
// differently ("Mandiri" vs "MDR").
const sameBank = (vendorBankName, companyCode) => {
  const v = String(vendorBankName || "").toUpperCase();
  const c = companyCode === "MDR" ? "MANDIRI" : String(companyCode || "").toUpperCase();
  return v === c;
};

// Bank remark fields are short; the invoice number is what the vendor matches
// the transfer against.
const REMARK_MAX = 30;

// Turn selected payment lines into transfers, setting aside any that cannot go
// in a file and saying why.
export function buildTransfers(lines, { vendorById, source }) {
  const transfers = [];
  const excluded = [];
  for (const l of lines) {
    const vendor = vendorById(l.vendorId);
    const banks = vendor?.banks || [];
    const vb = banks.find((b) => b.isDefault) || banks[0] || null;
    if (!vb || !vb.acc) {
      excluded.push({ line: l, reason: "No bank account on file in Vendor Master." });
      continue;
    }
    const bd = defaultBreakdown(l);
    const amount = cashOut(bd);
    if (amount <= 0) {
      excluded.push({ line: l, reason: "Nothing to transfer — the balance is all withholding." });
      continue;
    }
    transfers.push({
      billId: l.id,
      invNo: l.invNo,
      vendorName: l.vendorName,
      bank: vb.name,
      account: String(vb.acc).replace(/[^\d]/g, ""),
      accountDisplay: vb.acc,
      holder: vb.holder || l.vendorName,
      amount,
      withheld: withheldTax(bd),
      remark: String(l.invNo || l.id).slice(0, REMARK_MAX),
      sameBank: sameBank(vb.name, source?.bank),
    });
  }
  return { transfers, excluded };
}

const cell = (v, delimiter) => {
  const s = String(v ?? "");
  return s.includes(delimiter) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildBankFile(transfers, { source, date }) {
  const fmt = formatForAccount(source);
  if (!fmt) return null;
  const ctx = {
    debitAccount: source.number,
    date,
    count: transfers.length,
    total: transfers.reduce((s, t) => s + t.amount, 0),
  };
  const rows = [
    ...(fmt.header ? fmt.header(ctx) : []),
    fmt.columns,
    ...transfers.map((t, i) => fmt.row(t, i, ctx)),
  ];
  const content = rows.map((r) => r.map((v) => cell(v, fmt.delimiter)).join(fmt.delimiter)).join("\r\n");
  const filename = `${source.bank === "MDR" ? "MANDIRI" : source.bank}-bulk-transfer-${date}.csv`;
  return { filename, content, format: fmt };
}

export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
