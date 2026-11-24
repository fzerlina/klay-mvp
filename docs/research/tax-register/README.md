# Tax Register — product discovery & competitor benchmark

**Status:** Draft for review · **Date:** 24 Nov 2026 · **Page:** Reports › Tax Register (`/reports/tax-register`, `src/pages/TaxRegisterPage.jsx`)

Benchmarked against DualEntry, Rillet, Campfire, Digits, Puzzle, Xero, QuickBooks Online, Accurate Online, Mekari Jurnal, Odoo and NetSuite, plus Coretax DJP (2025) formats. Everything is from public docs, help centres, release notes, tax-news sites and vendor forums, read on 24 Nov 2026. The requirements come from the GKB Slack thread and the "Export Taxation" sample sheet (§0). See [§8 Caveats](#8-caveats-on-the-evidence) before quoting anything as fact.

Scope of the next phase (Linear, 3 design days): a closed / outstanding status on each line; a summary of closed vs outstanding for PPN and PPh; group by customer or vendor; exports matching the 3 sample sheets; a PPh 4(2) construction view per project with a prepaid / (accrued) balance tied to the GL.

---

## TL;DR

1. **Nobody tracks bukti potong status per line.** None of the 11 vendors documents a received / outstanding status for a withholding certificate on each line, a closed-vs-outstanding summary, or a per-project prepaid / (accrued) PPh view. Closest: DualEntry's Withholding Register (*Unremitted / Remitted* tabs plus a Remittance Status column) and Odoo's tax return (*Review → Submit → Pay*). The GKB ask is open space, not catch-up.
2. **Two of the three sample sheets are sales-side PPh, which Klay doesn't record yet.** *PPh 4(2) by Customer* and *PPh 4(2) Construction* list tax that **customers withheld from us**. Klay's register reads PPh only from bill payments (we withhold from vendors). Customers already carry a withholding type (`CustomerCreatePage.jsx`), and `1-5500 Prepaid Tax — PPh 23` exists, but invoices and receipts never book the deduction. That's the first dependency, ahead of any UI.
3. **"Closed" means the bukti potong is in hand.** The construction sheet's *Bukpot Status* is **Closed** when a Bukti Potong No. is recorded, **Outstanding** when a termin was withheld but no number yet, and **n/a** in a masa with no termin. The PPh 23 sheet's *Evidence (Doc No., Date)* is blank on the same logic. Paying and reporting the tax are per-masa events, not per-line ones (Accurate records the NTPN on the payment; Odoo and QBO track per return).
4. **The samples span a year, not one masa.** *PPh 4(2) by Customer* runs Jan–Dec 2024 grouped by customer, with the masa shown once per month block. The register today picks one masa, so a masa **range** is a prerequisite for the exports.
5. **The construction view is a running balance, not a list.** Per project: PPh withheld at each termin (cash) minus PPh expensed on revenue recognised by progress (`revenue × rate`). The cumulative difference is the project's **Prepaid** (+) or **(Accrued)** position. The sum across projects must tie to the GL prepaid and accrued PPh final accounts. No vendor, local or global, does this; GKB keeps it in Excel.
6. **Coretax has changed the export target.** Since 2025, e-Faktur and e-Bupot (BPPU for PPh 4(2) / 15 / 22 / 23) are imported into Coretax as **XML produced from DJP's Excel converter templates**. Accurate exports Coretax XML for outgoing faktur only; Odoo exports it per invoice; nobody exports BPPU. Customers see the bupot issued to them under **eBupot › Bukti Potong Saya**, which can export to Excel. Matching that file against Outstanding lines is the cheapest way to close lines in bulk.
7. **GKB's sheets are the spec for the exports.** The column lists in §0 should be copied exactly, merged two-row header included. `src/lib/xlsxExport.js` writes one sheet with formulas, but has no merged cells yet.

---

## 0. What GKB asked for (Slack thread + sample sheets)

**Thread** ([Slack](https://smplwrld.slack.com/archives/C0AQCTEUACE/p1792343155600439?thread_ts=1792024427.897629&cid=C0AQCTEUACE), 15–20 Oct 2026):
- Michael (15 Oct): GKB wants a tax export. The MVP could be a list of tax lines that can be exported, inside a tax reporting area of financial reporting.
- Vina (19 Oct): proposed parameters (masa; tax type PPN Masukan / PPN Keluaran / PPh 23 / PPh 4(2) / PPh Final 0.5% / PPh 26; vendor/customer search) and line data (tax type, doc no. and date, party, NPWP, faktur / bukti potong no., DPP, rate, tax). That's the base version built today.
- Michael (19 Oct): they probably want to see "which tax have been paid, which are still open", plus a summary of **closed vs outstanding** totals for PPN and PPh.
- Fidya (20 Oct): yes, **list + status + summary closed vs outstanding**. Companies like GKB usually also need to **track prepaid PPh final 4(2)**: the PPh is withheld when a termin is received, but revenue is recognised by progress. Example in the *PPh 4(2) Construction* sheet: grouped per project, prepaid/accrued balance per project, tied to the GL. Attached: [Export Taxation](https://docs.google.com/spreadsheets/d/1BwwqmksTJJBrvXNUAG8d21JTw3NLMmub8hRYYHVfEUQ/edit).

### 0.1 Sheet "PPh 4(2) by Customer" (A1:I103)

| Col | Header (exact) | Content in the sample |
|---|---|---|
| A | NO | 1, 2, … on the customer header row only |
| B | NAMA PERUSAHAAN | Customer (the withholder), header row only |
| C | NPWP | Customer NPWP, header row only (`01.000.000-2.000.000` format) |
| D | MASA PAJAK | `Jan-24` … `Dec-24`, written on the first line of each month block only |
| E | NOMOR BUPOT | 10-digit bukti potong no. (`2000000441`); in the sample the same number repeats on every line of a customer, which looks like redacted data |
| F | NILAI BRUTO | Gross (DPP). The customer header row holds the customer's **year total** (e.g. 1,572,622,092) |
| G | TARIF | 10% (PPh 4(2) on land/building rent) |
| H | PPH YANG DIPOTONG | Tax withheld = bruto × tarif; blank on the header row |
| I | KETERANGAN | Our invoice no. (`INV/2024010006`) |

**Shape:** grouped by customer → masa → invoice; Jan–Dec 2024; ~3–6 lines per customer per month. No status column: a line with a Nomor Bupot is treated as done. No grand total.

### 0.2 Sheet "PPh 23 from Vendor" (A1:K30)

Two-row header with merged cells:

| Cols | Header row 1 | Header row 2 | Content in the sample |
|---|---|---|---|
| A–B (merged) | Month | — | `January`, `February` (full month name) |
| C–D (merged) | Name of Company | — | Vendor (REBO, SUTARNO, MUJIRIN, BERKAT ABADI, MULTI SCREEN INDONESIA) |
| E–F (merged) | Kind of Taxes | — | Service object, not the tax type: *Jasa Teknik*, *Jasa Penyelengara Kegiatan atau Event Organizer*, *Jasa Konsultan*, *Jasa Outsourcing Services*, *Jasa Pembasmi hama* |
| G | Gross Income | — | Bruto |
| H | Rate | — | 2% or 4% (4% = the 100% surcharge for a payee without NPWP) |
| I | Amount of Taxes | — | Bruto × rate |
| J | Evidence | Doc No. | Blank on every visible row |
| K | Evidence | Date | Blank on every visible row |

**Shape:** grouped by month, then vendor; one row per bill. **No NPWP column** (Coretax's BPPU needs one). "Evidence" is the bukti potong we issue; blank = not issued yet, i.e. outstanding. The direction (we withhold from vendors) is the natural reading but needs confirming (§7 Q2).

### 0.3 Sheet "PPh 4(2) Construction" (A1:M11)

| Col | Header (exact) | Project header row | Masa row |
|---|---|---|---|
| A | No | `1.`, `2.` | — |
| B | Project / Masa | Project name (*Gedung Kantor Sentosa*) | `Jul-26`, `Aug-26`, `Sep-26` |
| C | Customer / Invoice No. | Customer (*PT Sentosa Properti*) | `INV/2026070101 (DP 20%)`, `INV/2026090105 (Termin 1)`, or `—` when no termin |
| D | Contract Value (IDR) | 2,000,000,000 | — |
| E | Termin Received (IDR) | Sum of termins | Termin amount, `-` if none |
| F | Rate | — | 2.65% (PP 9/2022, certified medium/large contractor) |
| G | PPh Withheld (IDR) | Sum | Termin × rate |
| H | Bukti Potong No. | — | `2000007101`, or blank |
| I | Revenue Recognized (IDR) | Sum | Revenue recognised in the masa (by progress) |
| J | PPh Expensed (IDR) | Sum | Revenue × rate |
| K | Prepaid / (Accrued) Balance (IDR) | Closing balance | **Running** balance: cumulative withheld − cumulative expensed |
| L | Position | Prepaid / Accrued | Prepaid when K > 0, Accrued when K < 0 |
| M | Bukpot Status | — | **Closed** (bupot no. recorded) · **Outstanding** (termin withheld, no bupot no.) · **n/a** (no termin that masa) |

Last row **Total period**: Termin 1,300,000,000 · PPh withheld 34,450,000 · Revenue 1,400,000,000 · PPh expensed 37,100,000. Its balance cell is blank, but the net is (2,650,000): project 1 prepaid 2,650,000, project 2 accrued (5,300,000). That net, split into prepaid and accrued, is what should tie to the GL.

Worked check, project 1: Jul 10.6M withheld − 3.975M expensed = 6.625M prepaid → Aug 0 − 7.95M = (1.325M) accrued → Sep 13.25M − 9.275M = 2.65M prepaid. Sep is **Outstanding**: withheld, but no bupot number yet.

### 0.4 What "closed" vs "outstanding" means

| Line kind | Outstanding | Closed | Evidence |
|---|---|---|---|
| PPh withheld **by a customer** (sheets 1, 3) | Customer paid net of PPh, no bukti potong received | Bukti potong number (and date) recorded | Sheet 3 *Bukpot Status*; sheet 1 *Nomor Bupot* |
| PPh we withheld **from a vendor** (sheet 2) | Withheld on payment, no bukti potong issued | Evidence Doc No. + Date filled | Sheet 2 *Evidence* |
| Masa with no termin (construction) | — | — (**n/a**) | Sheet 3 |
| PPN Masukan / Keluaran | *Not in the samples.* Proposed: faktur pajak no. missing (Keluaran: not yet issued in Coretax; Masukan: not yet received or credited) | Faktur no. recorded (Masukan: credited) | Proposal, §7 Q3 |

"Paid" (setor, NTPN) and "reported" (SPT masa filed) belong to the **masa**, not the line. Michael's "which tax have been paid" fits a masa-level status better (§6 #11).

---

## 1. Who uses the Tax Register and what for

| Who | When | Job to be done | What they need from the screen |
|---|---|---|---|
| **Tax / finance staff** (preparer) | Monthly, before the 15th (setor) and 20th (lapor) | "What PPN and PPh do I owe or report for this masa, and is every line complete?" | Lines per masa with NPWP, DPP, rate, faktur / bupot no.; missing numbers flagged |
| **AR staff** | Weekly / at month-end | "Which customers deducted PPh but haven't sent the bukti potong?" | Outstanding PPh by customer, oldest first, with invoice no. to chase |
| **Finance Manager** (reviewer) | Month-end close | "Do the tax accounts tie, and what's still open?" | Closed vs outstanding summary for PPN and PPh; GL tie-out; construction prepaid / accrued per project |
| **Project controller** (construction) | Monthly, with the progress billing | "Is PPh final over- or under-withheld against revenue on each project?" | Per-project running prepaid / (accrued) balance |
| **External tax consultant / auditor** | SPT Tahunan (1771), audit, *pemeriksaan* | "Show me the credits you claim and the bukti potong behind them." | Excel per customer / vendor for the year, bupot numbers, ties to the GL |

**Key moments:** monthly setor/lapor deadlines, month-end close, SPT Tahunan (PPh 23 credits need a bukti potong; a tax court case upheld the credit only because the bupot was produced), and tax audits.

---

## 2. Klay today

| Area | What exists |
|---|---|
| Period | One **masa** (this month to date + previous 11), defaults to last month. No range. |
| Rows | `buildTaxRegister` (`src/lib/taxRegister.js`) builds from three sources: **bills** → PPN Masukan (dated by posting); **invoices** → PPN Keluaran (dated by invoice, once out of draft); **ledger lines on 1-5100 / 2-2100 / 2-2300** → PPh withheld on **bill payments** (dated by payment), plus manual journals that touch a tax account. Split by rate when a document mixes 11% and 12%. |
| Tax types | PPN Masukan, PPN Keluaran, PPh 23, PPh 4(2), PPh Final 0.5%, PPh 26, PPh 21. 0.5% and 26 have **no code in Settings › Tax** (`TaxSettingsPage.jsx`); defaults are hard-coded and flagged. |
| Columns | Tax type · Document no. (+ source · ref · JE) · Document date · Posting date · Vendor / customer · NPWP / NITKU · Faktur / bukti potong no. · DPP · Rate · Tax · GL account. Export-only: Masa, Source, Klay ref, Journal. One list (`TAX_REGISTER_COLUMNS`) drives both screen and CSV. |
| Summary | KPI strip with one cell per tax type (Rp tax, line count, DPP), click to filter |
| Slicing | Tax-type pills with counts; search over party, NPWP, doc no., faktur / bupot no.; grouped by tax type with a subtotal per type |
| Drill-down | Doc no. → bill; party → vendor / customer; GL account → General Ledger for the masa |
| Output | **CSV** ("Excel (CSV)": lines, then totals per type); Print / PDF with company, masa and filter |
| Scope | Posted lines only |

**Internal gaps found while reading the code**

- **No customer-side PPh.** Invoices and receipts never book PPh withheld by the customer, although customers carry a withholding type (`pph23` / `pph42`, `CustomerCreatePage.jsx`) and `arAging.js` notes the invoice "doesn't say". Sheets 1 and 3 can't be built from today's data.
- **Faktur and bukti potong numbers are never filled.** `fakturNo` and `buktiPotongNo` are read (`taxRegister.js` lines 156, 185, 231) but no seed, form or page writes them, so that column always shows "—". Status depends on this field.
- **No status** of any kind on a line or a masa.
- **No objek pajak** ("Kind of Taxes": Jasa Teknik, Jasa Konsultan…) on vendors, bills or lines; sheet 2 needs it, and so does Coretax (kode objek pajak).
- **Construction view prerequisites are missing.** The **Project** dimension exists (`seed/dimensions.js`: PRJ-Anggrek, PRJ-Melati…) but has no contract value, customer, PPh rate or progress revenue. The COA has `1-5500 Prepaid Tax — PPh 23` and `8-1300 Final Tax (PPh Final)`, but no *Prepaid PPh final 4(2)* asset or *Accrued PPh final* liability.
- **Export:** CSV only. `src/lib/xlsxExport.js` (used by GL, TB, BS, P&L) writes one sheet with styles and `SUM` formulas but **no merged cells**, which sheet 2's two-row header uses.
- **PPh 23 4% rate:** the register shows the bill's rate; there's no flag that the 4% came from a missing NPWP.

---

## 3. Functionality benchmark

**Legend:** ✓ documented · ◐ partial / workaround / other screen · ✗ documented as missing · ? not found in public sources · — not applicable

**Abbreviations:** DE = DualEntry · Ril = Rillet · Camp = Campfire · Dig = Digits · Puz = Puzzle · QBO = QuickBooks Online · Acc = Accurate Online · Jur = Mekari Jurnal · NS = NetSuite

**Indonesia support:** only Accurate, Jurnal, Odoo (`l10n_id`, `l10n_id_efaktur_coretax`) and NetSuite (Indonesia VAT reports) have any. DualEntry's VAT list (33 countries), GST list (6) and e-invoicing list (7) exclude Indonesia. Xero Indonesia mentions e-Faktur in marketing only.

### 3.1 Lines & period

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Line-level tax report (doc, party, base, rate, tax) | ✓ Withholding Register; US Sales Tax Detail | ◐ Sales Tax / VAT report: no., date, pre-tax, tax | ? API only | ✗ no sales tax | ? | ◐ transactions by tax rate | ◐ Taxable Sales Detail | ◐ SPT PPN/PPnBM by Tanggal Pajak | ◐ by date, period, tax type | ◐ tax report, expand line | ◐ Form 1111 box detail |
| Input vs output VAT | ◐ separate accounts, no return report | ✓ Revenue vs Expense sections | ◐ receivable split on bills | ✗ | ? | ✓ collected vs paid | ✗ US sales tax is output only | ✓ Pajak Masukan / Keluaran / both | ◐ | ✓ Sales / Purchases | ✓ A2 output, B1–B3 input |
| Withholding we deduct from vendors | ✓ Withholding Register + 1099 | ◐ 1099 only | ◐ AP withholding (Oct 2026), no report | ◐ 1099 eligibility | ◐ 1099 Vendors tab | ✗ manual negative lines | ◐ India TDS Payable | ◐ SPT PPh Ps. 23 + daftar bukti potong | ✓ Laporan Pajak Pemotongan | ✗ std; paid app | ✓ Tax Withheld for Vendor |
| Withholding deducted **by customers** (prepaid) | ? AP only | ? | ◐ invoice `withholding_info` (API) | ? | ? | ✗ | ◐ India TDS Receivable | ◐ at Penerimaan Penjualan | ◐ at Terima Pembayaran, up to 10 | ✗ std | ✓ Tax Withheld by Customer |
| Certificate no. per line | ? | ? | ◐ cert rate, no number | — | ? | ✗ | ? | ✓ "Bukti Potong PPh 23" field | ? | ◐ third-party app | ? |
| Year / range across tax months | ✓ date range | ◐ YTD / last quarter | ? | — | ? | ◐ per return | ◐ per return | ◐ per masa | ✓ date range | ◐ per return; report any range | ◐ per tax period |

### 3.2 Status, summary & tie-out

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Certificate status per line (received / outstanding) | ◐ 1099 e-file status only | ? | ? | ◐ W-9 Requested → Received (per vendor) | ◐ W-9 attachable | ✗ | ? | ? | ◐ in Klikpajak only | ◐ third-party Draft → Issued | ? |
| Paid / remitted status | ✓ Unremitted / Remitted per line | ? | ◐ via Taxwire | ✗ | ✗ | ◐ Filed vs Unfiled (typed in) | ✓ per return; Overdue | ◐ "Ambil" PPh into payment + NTPN | ◐ in Klikpajak | ✓ Review → Submit → Pay | ✗ |
| Closed vs outstanding summary | ◐ grand total only | ? | ? | ? | ? | ◐ Unfiled total | ◐ tax due, payments, balance due | ? printed SPT only | ? | ◐ amount to pay / refund | ◐ summary report |
| Tie-out to GL tax account | ✓ documented recipe: Unremitted = payable balance | ? one liability account | ◐ Taxwire reconciliation | ? | ? | ✓ VAT Reconciliation (UK) | ◐ adjustments shift balance | ? | ◐ Klikpajak auto-recon | ◐ closing entry + checks | ◐ lock keeps tax = GL |

### 3.3 Grouping & projects

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Group by customer / vendor | ◐ vendor filter; export and subtotal in Excel | ? | ? | ◐ per-vendor card | ◐ per-vendor spend | ✗ sort by contact requested | ? jurisdiction nesting | ? | ◐ per customer (receivables) | ? | ✓ vendor / customer reports |
| Filter by project / dimension | ◐ classification (US report) | ? | ? | ? | ? | ✗ tracking filter requested | ? | ? | ? project costing, not tax | ✓ analytic filter | ? |
| Construction PPh per project, prepaid / (accrued) | ? none found | ? | ? | ? | ? | ? | ? | ? | ? blog books expense at cash | ✗ third-party app has no projects | ? |

### 3.4 Output & filing

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Excel export | ✓ Excel / PDF / CSV | ◐ "Download" | ? | ◐ in Financial Package | ◐ 1099 template | ? | ✓ | ✓ report export; e-Faktur CSV | ✓ PDF / CSV / XLS | ✓ Export All (XLSX) | ◐ CSV / DAT / PDF |
| Indonesian e-file (Coretax e-Faktur / e-Bupot XML) | ✗ no Indonesia | ✗ | ✗ | ✗ | ✗ | ✗ marketing only | ✗ | ◐ Coretax XML for faktur keluaran only, no BPPU | ◐ via Klikpajak (CSV / API) | ◐ e-Faktur XML per invoice; no e-Bupot | ◐ no Coretax found |
| Filing workflow / tax period lock | ◐ remittance locks lines | ? | ? | ✗ | ✗ | ✓ MTD file, mark filed | ◐ record payment | ◐ export / print, upload elsewhere | ◐ in Klikpajak | ✓ return + Lock Tax Return date | ✗ |
| Drill-down to source doc | ✓ Record No | ✓ row → invoice | ? | ? | ◐ row → vendor | ◐ GST recon only | ? | ✓ click to edit | ◐ | ✓ expand + annotate | ✓ box → detail |

---

## 4. Vendor notes (UX and the ideas worth taking)

### DualEntry — closest peer, deepest docs (no Indonesian tax)
- **No Indonesia, no PPN, no PPh.** The VAT list (33 countries, 23 Sep 2026), GST list (6) and e-invoicing (AR, BE, DE, IT, MX, ES, SE) all leave it out. The only withholding example is India (10%, "194J"). "DualEntry does not e-file returns directly today."
- **Withholding Register** (Reports › Tax): tabs **Overview / Unremitted / Remitted**. Filters: Company, Vendor, Tax Agency, Record Type (Bill, Direct Expense, Vendor Credit). Columns: Vendor, Tax Agency, Record No, Record Type, Posting Date, Withholding Rate, Rate, Currency, Net Amount, Gross Amount, Withheld Amount, Payable Amount, **Remittance Status**, **Remittance No**. One Grand total row, hidden when currencies mix. **No grouping**: the docs say to export and subtotal in Excel.
- **Status comes from a document, not a checkbox.** A line is "open" while its record is posted and not on a **Withholding Remittance** (Accounting › Money Out). You tick open lines onto the remittance (Date, Payee = tax agency, Bank, Liability account, Reference no.), and that locks the source records. Archiving the remittance reopens them. This is the model for "closed by evidence".
- **GL tie-out is a documented recipe.** Run Unremitted from the earliest date for one company; the Withheld total should equal the withholding payable balance.
- **1099:** "1099 Taxable Report by Vendor", CSV or IRS FIRE export; Tax1099 e-filing tracks ACCEPTED / REJECTED / RESUBMIT per form.
- **Sales tax:** collected and use tax post to "Tax Payable"; you pay by posting a bill to the agency vendor; no liability report (the docs point to the GL). The US Sales Tax Detail report has a classification filter and a Record No drill-down.
- Klay's Settings › Tax already copies DualEntry's Tax Setup (dated codes, account per code).

### Rillet
- Reporting › Close Reports: **1099 Report, Sales Tax Report, VAT Report**. The VAT Report splits Revenue and Expense sections; Sales Tax offers YTD / last YTD / last quarter. All tax posts to one "Sales Tax Liability" account. No withholding.

### Campfire
- No end-user help site, so known from the API and changelog. It's the **only US-style vendor with withholding on the AR side**: `withholding_info` on invoices and `withheld_amount` on payments, i.e. our customer-withheld PPh case. AP withholding scheme arrived Oct 2026, using the vendor certificate's rate but no certificate number. Sales tax / VAT is computed and filed by partners (Avalara, Anrok, Taxwire).

### Digits
- Doesn't track sales tax. Its **W-9 status labels** are the best pattern for document tracking: *Requested → Received / Needs review*, *Ready / Not required / W-9 Required*, and a bulk "Request W-9s". Per vendor, not per line.

### Puzzle
- Reports › Vendors › "1099 Vendors" tab, suggesting vendors over $600, with a 1099 template export. No indirect-tax features found on its own help site.

### Xero
- Accounting › Tax › VAT/GST returns. **No withholding at all**: Philippine users enter negative lines by hand and ask for BIR forms on the ideas forum. The NZ GST transactions tab has switchable columns (Date, Account, Reference, Details, Gross, GST, Net). The GST Reconciliation report has Filed vs Unfiled columns, but the filed amounts are typed in and reportedly not saved. Filtering by tracking category and sorting by contact are open requests. Xero Central was unreadable, so this column is the weakest.

### QuickBooks Online
- Sales Tax › Overview › **Review sales tax**: "+ Add an adjustment", "View tax liability report", "Record payment"; Returns / Payments tabs with an **Overdue** status. Liability report columns: Tax name, Gross total, Non-taxable amount, Taxable amount, Tax amount, nested state → county → city. Per-return status, not per-line. India TDS Payable / Receivable exist but users report the payable report missing.

### Accurate Online — the local reference
- Laporan: **SPT PPN/PPN BM** (by Tanggal Pajak; type *Pajak Masukan / Keluaran / both*; click a transaction to edit), **SPT PPh Ps. 23** (tabs *Surat Pemberitahuan (SPT)* and *Bukti Pemotongan*), **ePPh 2326 dan ePPh 1771**, SPT PPh Ps. 15, Bukti Potong PPh Ps. 21. A **"laporan daftar bukti potong PPh pembelian"** exists (totals fixed in release #5010, 23 Oct 2026).
- **Customer withholding:** PPh 23 shows on the sales invoice but is journalled at **Penerimaan Penjualan**, where "Opsi Dipotong PPh" and a **Bukti Potong PPh 23** number field are entered. Sales PPh goes to an *Akun Pajak Penjualan* (other current asset). It feeds the ePPh 1771 export for the annual credit.
- **Paying:** Kas & Bank › Pembayaran › **"Ambil"** pulls open PPh Pembelian (4(2), 15, 21, 23) and PPh Penjualan (4(2), 15) into one payment, then you record the **NTPN** on *Info Lainnya*. That's a masa-level "paid" status, like DualEntry's remittance.
- **Coretax:** release #2438 (28 Jan 2025) added XML export ("bisa pilih faktur yang akan di ekspor"). A 2025 webinar says Coretax export covers only *faktur keluaran dan dokumen keluaran*; no BPPU.
- No received / outstanding status for bupot, no project view and no tax-to-GL tie-out found.

### Mekari Jurnal
- Laporan › tab Pajak › **Laporan Pajak Penjualan / Laporan Pajak Pemotongan**. Taxes have a "Pemotongan" checkbox, and a "Grup" tax can combine PPN 12% with PPh 23 −2%. Customer deductions happen at Invoice › Tindakan › **Terima Pembayaran** (%, amount, "Multi Pemotongan" up to 10).
- Status, e-Faktur, e-Bupot Unifikasi, e-Billing and e-Filing live in **Klikpajak** (Mekari's PJAP). It checks NPWP/NITKU against DJP and claims Coretax sync without file uploads. Bupot status exists only there ("faktur pajak / bukti potong yang sudah disetujui").
- The Jurnal blog on termin invoices books "Beban PPh Final Pasal 4 ayat (2)" when cash arrives, not matched to progress. That's exactly the gap GKB's construction sheet fills by hand.
- Klikpajak's reconciliation template (Part C1) matches the **PPh dibayar di muka** GL account to bupot received, chases customers for missing ones monthly against Coretax, and keeps a difference log with a cause code, evidence, action, target date, age and status. Its rule is that no difference stays without a cause code and evidence. That's the closest public description of GKB's "outstanding".

### Odoo
- Accounting › Accounting › **Tax Returns**: a card per period (deadline, company) with **Review → Submit → Pay** steps that turn green. Checks are labelled *To review* / *Anomaly* / *Reviewed or Supervised*; Pay offers Mark Paid. There's a **Lock Tax Return** date and a tax closing entry. Reports: analytic filter, annotate, gear › "Export All (XLSX)".
- `l10n_id_efaktur_coretax`: Actions › "Download e-faktur" produces Coretax XML **per invoice**, and the tax invoice number comes back from Coretax. **No e-Bupot** in the standard product.
- Withholding is third-party only: the `lm_id_withholding` (Odoo 18) app covers PPh 21 / 23 / 4(2) on vendor bills, bupot Draft → Issued, numbering `BP-YYYY/NNNNN`, CSV / Coretax XML export, no projects. An old OpenSynergy v8 module handled incoming and outgoing PPh 23 bupot.

### NetSuite
- Indonesia VAT: Reports › VAT/GST › Tax Reports (International), in English or Bahasa, with supplementary schedules A1 / A2 / B1 / B2 / B3. No Coretax export found (third-party connectors exist).
- Withholding Tax SuiteApp (legacy, fixes only): **Tax Withheld for Vendor** and **Tax Withheld by Customer**, summary and detail, by subsidiary / period / tax type; PDF / CSV / DAT. The Philippine pair **QAP** (payees we withheld from) and **SAWT** (agents who withheld from us) is the closest precedent for separate payable and receivable registers. SuiteTax accounts get no provisioned withholding reports.

### Coretax DJP (from 1 Jan 2025)
- **Import formats:** DJP publishes Excel → XML converters for Faktur Keluaran, Retur Faktur Masukan, Dokumen Lain (updated Jan 2026), **BPPU** (PPh 4(2) / 15 / 22 / 23; updated Sep 2025), BPNR, Digunggung and BP21. Data goes on a "DATA" sheet; definitions on "REF" / "Keterangan"; Developer › Export writes the XML. The Faktur template has a "Faktur" sheet (NPWP Penjual, Baris, tanggal faktur … ID TKU Pembeli) and "DetailFaktur" rows linked by *Baris*. The buyer's ID TKU is the 22-digit NITKU when the buyer has an NPWP, otherwise `000000`.
- **BPPU entry fields:** Taxable period, Status, TIN, NITKU, tax facility held by the recipient, Name of Taxable Object, **Taxable Object Code**, Tax Base, Rate, Income Tax, KAP, reference document Type / Number / Date, withholder NITKU. Lists show *Not Yet Issued → Issued*; the number is assigned once the status is Normal.
- **Withholdee view:** eBupot › **Bukti Potong Saya**, filtered by jenis bupot, masa/tahun, nomor pemotongan and NPWP pemotong; per-document PDF; table export to CSV / Excel / PDF. A missing slip usually means the customer hasn't issued it or used the wrong 16-digit NPWP.
- **Pajak Masukan:** prepopulated under e-Faktur › Pajak Masukan; actions *Kreditkan Faktur* / *Tidak Kreditkan*, status Approved → Credited; the masa can be changed up to 3 periods later.
- **Construction rates (PP 9/2022):** 1.75% (small certified / individual), 2.65% (medium/large certified; certified integrated), 4% (uncertified; uncertified integrated), 3.5% (certified consultancy), 6% (uncertified consultancy). Base = payment amount, withheld at down payment and each termin; if the payer isn't a withholding agent, the contractor pays it itself (*setor sendiri*). DJP is evaluating the regime (2026).

---

## 5. Patterns across the market

1. **Status is derived from evidence, not ticked.** DualEntry: a line is Remitted when it's on a remittance document. Accurate: paid when pulled into a payment with an NTPN. Coretax: a bupot is Issued once DJP numbers it. GKB's sheets work the same way: a bupot number means Closed. Klay should derive *Closed* from a recorded number (+ date), not offer a bare toggle.
2. **Payable and receivable withholding are separate lists.** NetSuite (vendor vs customer; QAP vs SAWT), Accurate (PPh Pembelian vs PPh Penjualan), and GKB's sheets (by Customer vs from Vendor). One register with a side filter is fine on screen; the exports must stay separate.
3. **Paid / filed is a period event.** QBO, Odoo, Xero and Accurate track it per return or per payment, never per line. Per line, only the document status (faktur / bupot) varies.
4. **Status tabs, not a status filter buried in a menu.** DualEntry's *Overview / Unremitted / Remitted* and Coretax's *Not Yet Issued / Issued* put the open work one click away.
5. **Grouping by party is mostly left to Excel.** DualEntry says so explicitly; Xero users ask for it. GKB's sheet 1 is that Excel subtotal. Doing it on screen and in the export is a small differentiator.
6. **Tie to the GL with a recipe, then a check.** DualEntry documents "Unremitted total = payable balance". Xero UK has a VAT Reconciliation. Klikpajak reconciles prepaid PPh against bupot. Nobody shows the tie-out on the tax report itself.
7. **Coretax output = DJP's Excel converter layout.** Local vendors export the faktur side; nobody exports BPPU, and nobody imports *Bukti Potong Saya* to match. Both are open.
8. **Construction PPh final is still a spreadsheet.** No vendor tracks prepaid vs accrued PPh 4(2) per project. Jurnal's own blog books it at cash, which mismatches revenue under progress recognition.

---

## 6. Proposed scope

Phases: **V1 (MVP)** = this Linear ticket, 3 design days · **V1.1** = next increment · **Later** = needs a PRD or integration · **Not now**.

| # | Item | Phase | Why (one line) |
|---|---|---|---|
| 1 | **Status column per line**: *Closed* (green) / *Outstanding* (amber) / *n/a* (grey), derived from faktur / bupot no. (+ date). Hover shows the rule. | V1 (MVP) | The core ask in the thread; matches sheet 3 *Bukpot Status* and the evidence-not-checkbox pattern. |
| 2 | **Record bukti potong / faktur no. + date** inline or in a row side panel; the line turns Closed; audit trail entry; clearing the number reopens it. | V1 (MVP) | `buktiPotongNo` / `fakturNo` are read but never written, so status has nothing to read. |
| 3 | **Status tabs** *All · Outstanding · Closed* with counts, above the tax-type pills | V1 (MVP) | DualEntry's Unremitted / Remitted; the AR chase list is one click away. |
| 4 | **Summary: closed vs outstanding for PPN and PPh.** Two cards (PPN, PPh), each Total · Closed · Outstanding (Rp + count), click to filter; per-type breakdown under them | V1 (MVP) | Michael's and Fidya's explicit ask; replaces the per-type KPI strip. |
| 5 | **Masa range** (from–to masa, default last month; presets *This year*, *Last year*) | V1 (MVP) | Sheet 1 covers Jan–Dec; one masa can't produce it. |
| 6 | **Group by** *Tax type* (default) · *Customer* · *Vendor* · *Masa* · *Project*. Party header row = No · Name · NPWP · total bruto; masa written once per month block; subtotal with closed / outstanding | V1 (MVP) | Sheet 1's shape; vendors leave this to Excel. |
| 7 | **Sales-side PPh lines** (PPh 23 / 4(2) withheld by the customer at receipt, to a prepaid account), seeded for the prototype; *Side* filter Purchases / Sales | V1 (MVP) | 2 of 3 sheets are customer-withheld; without it the exports are empty. |
| 8 | **XLSX export with 3 presets**: *PPh 4(2) by Customer*, *PPh 23 from Vendor*, *PPh 4(2) Construction*, using the exact headers in §0 (incl. sheet 2's merged two-row header); CSV stays as the flat list | V1 (MVP) | The sheets are GKB's spec; needs merged-cell support in `xlsxExport.js`. |
| 9 | **Construction view** (tab *PPh 4(2) construction*): per project, the sheet 3 columns, running Prepaid / (Accrued), Position, Bukpot Status, *Total period*, and a **GL tie-out footer** (prepaid account, accrued account, register net, difference ✓ / ✗) | V1 (MVP) | Fidya's GKB-type need; nobody else has it. Read-only, computed. |
| 10 | **Objek pajak** ("Kind of Taxes") on PPh lines, from a vendor default, overridable on the bill | V1 (MVP), vendor default only | Sheet 2 column; also Coretax's Taxable Object Code later. |
| 11 | **Masa-level status**: *Paid* (NTPN, date) and *Reported* (SPT date) per tax type per masa, shown above the lines | V1.1 | "Which tax have been paid" is a period fact (Accurate NTPN, Odoo Pay, QBO). |
| 12 | **Import Coretax "Bukti Potong Saya" export** to match bupot to Outstanding lines (NPWP pemotong + DPP + masa) and close them in bulk | V1.1 | Closes dozens of lines a month without typing; no vendor does it. |
| 13 | **Aging of outstanding bupot** (days since receipt) + "Copy chase list" per customer | V1.1 | Klikpajak's practice; AR's weekly job. |
| 14 | **GL tie-out on every tax account** (1-5100, 2-2100, 2-2300, prepaid PPh) as a Needs review check | V1.1 | DualEntry's recipe made visible; reuses the TB / recon review pattern. |
| 15 | PPh Final 0.5% and PPh 26 codes in Settings › Tax; NPWP-missing flag on 4% lines | V1.1 | Removes hard-coded defaults in `taxRegister.js`. |
| 16 | **Coretax XML export**: BPPU (PPh 23 / 4(2)) and Faktur Keluaran, via DJP's converter layout | Later | Real filing value, but strict templates to verify against DJP's REF sheet. |
| 17 | **Construction month-end JE**: post PPh expense = revenue × rate, moving prepaid ↔ accrued per project | Later | Needs project contracts and a revenue-by-progress rule; a JE PRD amendment. |
| 18 | Project master data: contract value, customer, PPh rate, retention | Later | V1 reads them from seed; real setup belongs to a project module. |
| 19 | Tax return workflow per masa (Review → Submit → Pay, tax lock date) | Later | Odoo's pattern; depends on #11 and period locking. |
| 20 | Direct DJP / PJAP integration (e-Filing, e-Billing, Coretax API) | Not now | Needs PJAP partnership (Klikpajak model); out of MVP scope. |
| 21 | PPh 21 payroll (BPA1 / BP21) | Not now | Payroll isn't in Klay V1. |
| 22 | Multi-entity / consolidated tax registers | Not now | Klay V1 is single-entity. |

**Concrete layout to mimic (V1)**

- **Header:** masa range picker · Export (XLSX presets ▸, CSV, Print). Below it, **two summary cards**, *PPN* and *PPh*, each showing *Total Rp · Closed Rp (n) · Outstanding Rp (n)* with a thin closed/outstanding bar; clicking *Outstanding* sets the status tab. Under the cards, a compact per-type row: *PPN Masukan · PPN Keluaran · PPh 23 · PPh 4(2) …* with their outstanding amounts.
- **Toolbar:** status tabs *All · Outstanding · Closed* (DualEntry) · tax-type pills · Side *Purchases / Sales* · Group by popover (same component as TB / P&L) · search.
- **Table:** existing columns + **Objek pajak** (PPh) + **Status** pill right after *Faktur / bukti potong no.*; an Outstanding row shows "+ Add bupot no." in that cell.
- **Group by Customer** = sheet 1: header row *No · Customer · NPWP · Σ bruto · Σ PPh · n outstanding*; detail rows with masa shown once per month block; Keterangan = invoice no.
- **Construction tab** = sheet 3 one-to-one: project header row (customer, contract value, Σ termin, Σ withheld, Σ revenue, Σ expensed, closing balance, Position pill); masa rows with the running balance (accrued in brackets and red, like P&L losses); *Total period* row; footer card *"Ties to GL: Prepaid PPh final Rp 2.650.000 · Accrued PPh final (Rp 5.300.000) · Net (Rp 2.650.000) ✓"*, with each account linking to the GL.

---

## 7. Open questions (for Fidya / SME)

1. **Closed rule per side:** for PPh withheld **by customers**, is Closed = bupot number entered, or only once it shows in Coretax *Bukti Potong Saya*? For PPh we withhold **from vendors**, is Closed = bupot issued, tax deposited (NTPN), or reported in the SPT masa?
2. **"PPh 23 from Vendor":** confirm the direction (we withhold from vendors, *Evidence* = the bupot we issue). Should the export add **NPWP / NITKU**, which Coretax needs and the sheet lacks?
3. **PPN status:** does GKB need Closed / Outstanding on PPN at all? If yes: Keluaran = faktur issued in Coretax? Masukan = faktur received, or credited (*Kreditkan*)?
4. **Period:** are year-long exports (sheet 1, Jan–Dec) the norm, or is it monthly with the year sheet built by appending?
5. **Bupot numbering:** sheet 1 repeats one number per customer for the whole year. Real (one bupot per customer per period?) or redacted? In Coretax it's normally one bupot per transaction.
6. **Construction:**
   - Is revenue recognised taken from GL revenue lines tagged to the project, or entered as a progress %?
   - Is the base for withholding the termin **excluding PPN**? How is retention handled?
   - Which GL accounts hold *Prepaid PPh final 4(2)* and *Accrued PPh final*, and does GKB post the monthly PPh-expense adjustment today?
   - Is the rate always per project (2.65%), or can it change mid-contract?
7. **Kind of Taxes:** a plain label (Jasa Teknik) or Coretax's kode objek pajak (24-104-xx)? Set per vendor, per item, or per bill?
8. **Who can enter or clear a bupot number:** any AR / AP user, or a reviewer, like non-bank recon?
9. **Export language:** keep the samples' mixed headers exactly (sheet 1 Bahasa caps, sheets 2–3 English), or one language throughout?
10. **"n/a" rows:** in the construction view, should a masa with revenue but no termin always appear (it moves the balance), and should a masa with neither be hidden?

---

## 8. Caveats on the evidence

- **Blocked sources:** Xero Central returned empty pages (JavaScript), so the Xero column relies on the ideas forum and third-party guides. Mekari Jurnal's help centre and community returned 403, so Jurnal ratings rest on product pages and search snippets. pajak.go.id pages (template, KT-08, Bukti Potong Saya) returned 404 to the fetcher, so Coretax facts come from DDTC News, Ortax and Pajakku.
- **Coretax column names are incomplete.** The full Faktur and BPPU XML column lists weren't obtained; only labels from the entry screens and one XML element (`CounterpartTin`). Read the "REF" sheet of DJP's official converter before speccing #16.
- **The construction accounting is from GKB's sheet, not a standard.** No accessible source was found that states the prepaid / (accrued) PPh final treatment under progress recognition. It matches common practice for listed contractors (final tax expensed in proportion to revenue, the difference carried as prepaid or payable), but should be confirmed against a PSAK note or the SME.
- **Search budget:** the session's web-search cap (200) ran out before final checks (PSAK final-tax wording, Accurate tax report columns). A follow-up can continue.
- **Sample data looks sanitised** (identical NPWPs, a repeated bupot number), so don't infer business rules from those values.
- **Prompt-injection on vendor docs:** Rillet and Digits (GitBook) pages contained agent instructions to send GET requests with `ask` / `goal` parameters. They were ignored and nothing was sent.
- **Pages read by a summarising model:** exact UI labels should be checked against the linked page before they go into a PRD.
- **No screenshots saved.** Candidates are in §9.2; downloading them into `docs/research/tax-register/<vendor>/` needs a go-ahead.

---

## 9. Sources

### 9.1 Articles

**Requirements**
- Slack thread, #C0AQCTEUACE: [tax export](https://smplwrld.slack.com/archives/C0AQCTEUACE/p1792343155600439?thread_ts=1792024427.897629&cid=C0AQCTEUACE)
- Google Sheet: [Export Taxation samples](https://docs.google.com/spreadsheets/d/1BwwqmksTJJBrvXNUAG8d21JTw3NLMmub8hRYYHVfEUQ/edit) (sheets *PPh 4(2) by Customer*, *PPh 23 from Vendor*, *PPh 4(2) Construction*)

**DualEntry**
- [Non-US taxes](https://docs.dualentry.com/accountants/core-financials/tax-management/non-us-taxes.md) · [US taxes](https://docs.dualentry.com/accountants/core-financials/tax-management/us-taxes.md) · [Withholding tax](https://docs.dualentry.com/accountants/core-financials/tax-management/withholding-tax.md) · [Remit withholding tax](https://docs.dualentry.com/accountants/core-financials/tax-management/remit-withholding-tax.md)
- [Withholding Register](https://docs.dualentry.com/accountants/reporting-analytics/withholding-register.md) · [US Sales Tax Detail](https://docs.dualentry.com/accountants/reporting-analytics/us-sales-tax-detail-report.md) · [1099 tracking](https://docs.dualentry.com/accountants/core-financials/accounts-payable/1099-tracking.md) · [Tax1099](https://docs.dualentry.com/accountants/integrations/tax1099.md)
- API: [Withholding tax](https://docs.dualentry.com/developers/guides/api/building-blocks/withholding-tax.md) · [E-invoicing](https://docs.dualentry.com/developers/guides/api/building-blocks/e-invoicing.md)

**Rillet**
- [VAT taxes](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/general-accounting/vat/vat-taxes-in-rillet.md) · [VAT report](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/close-reports/vat-report) · [Sales tax report](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/close-reports/sales-tax-report.md) · [1099 report](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/close-reports/1099-report.md)

**Campfire**
- [llms.txt](https://docs.campfire.ai/llms.txt) · [Create bill (API)](https://docs.campfire.ai/api-reference/accounts-payable/create-accounting-bill.md) · [Create invoice (API)](https://docs.campfire.ai/api-reference/accounts-receivable/create-invoice.md) · [Changelog](https://campfire.ai/changelog) · [Feb product update](https://campfire.ai/blog/february-product-update) · [Taxwire](https://campfire.ai/integrations/taxwire)

**Digits**
- [Ledger FAQs](https://help.digits.com/business-agentic-general-ledger/ledger-faqs) · [Collecting W-9s](https://help.digits.com/business-vendors-and-customers/collecting-w-9s-from-your-vendors.md) · [Get tax ready](https://help.digits.com/firms-agentic-general-ledger/get-tax-ready) · [Tax documents](https://help.digits.com/business-documents/tax-documents.md)

**Puzzle**
- [Tracking 1099 vendor spending](https://help.puzzle.io/en/articles/12670953-tracking-1099-vendor-spending-in-puzzle) · [Commenda on Puzzle (third-party)](https://www.commenda.io/integrations/puzzle/sales-tax-and-global-vat-software-for-puzzle)

**Xero**
- Product ideas: [GST per type](https://productideas.xero.com/forums/967133-reports-tax/suggestions/48749177-gst-transactions-totals-per-gst-type-for-mixed-g) · [Collapse/expand](https://productideas.xero.com/forums/967133-reports-tax/suggestions/47389907-activity-statements-collapse-or-expand-transacti) · [Save filed amount](https://productideas.xero.com/forums/967133-reports-tax/suggestions/49743143-gst-reconciliation-report-save-the-filed-amount) · [Philippines BIR](https://productideas.xero.com/forums/967133-reports-tax/suggestions/45245053-xero-reporting-for-philippines-bir-compliance) · [Filter by tracking](https://productideas.xero.com/forums/967124-projects-tracking/suggestions/47399051-activity-statement-filter-transactions-by-tracki) · [VAT recon drill-down](https://productideas.xero.com/forums/967133-reports-tax/suggestions/45153625-vat-reconciliation-report-ability-to-drill-down) · [CIS mark as filed](https://productideas.xero.com/forums/967133-reports-tax/suggestions/48989501-cis-mark-cis-returns-as-filed-when-submitted-outs)
- [VAT Reconciliation (UK)](https://central.xero.com/0/article/The-VAT-Reconciliation-report-UK) (snippet) · [Xero UK VAT](https://www.xero.com/uk/accounting-software/uk-vat/) · [Xero Indonesia](https://www.xero.com/id/accounting-software/) · [Playcentre GST guide](https://www.playcentre.org.nz/?p=25099) · [Submitting VAT from Xero](https://help.1stformations.co.uk/accounting-service/submitting-your-vat-return-from-xero)

**QuickBooks Online**
- [Sales tax liability report](https://quickbooks.intuit.com/learn-support/en-us/help-article/sales-taxes/understand-sales-tax-liability-report-quickbooks/L3wP24Uyb_US_en_US) · [File return / record payment (US)](https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-sales-taxes/file-sales-tax-return-record-tax-payment-online/L7ZeSlAr1_US_en_US) · [(CA)](https://quickbooks.intuit.com/learn-support/en-ca/help-article/remit-sales-taxes/file-sales-tax-return-record-tax-payment-online/L7ZeSlAr1_CA_en_CA)
- Community: [Taxable / non-taxable detail](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/sales-tax-liability-report-showing-taxable-and-non-taxable/00/666693) · [Overdue periods](https://quickbooks.intuit.com/learn-support/en-us/taxes/how-do-i-fix-previous-sales-tax-periods-that-are-showing-overdue/00/1316366) · [India TDS Payable missing](https://quickbooks.intuit.com/community/reports-87/in-qbo-india-the-report-tds-payable-is-not-available-178968) · [TDS receivable](https://quickbooks.intuit.com/learn-support/global/reports/how-can-the-issue-with-tds-payments-not-reflecting-in-their/00/877855)

**Accurate Online**
- Help: [SPT Masa PPN/PPnBM](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/spt-masa-ppn-ppnbm/cara-membuat-SPT-masa-PPN-PPNbm/) · [SPT PPh Ps. 23](http://help.accurate.id/product/accurate-online/fitur-aol/laporan/spt-pph-ps23/membuat-SPT-Ps.23/) · [ePPh 2326 / 1771](http://help.accurate.id/product/accurate-online/fitur-aol/laporan/epph-2326-1771/ekspor-epph-2326-1771/) · [Daftar laporan](https://help.accurate.id/product/daftar-laporan/)
- Help: [PPN Masukan](https://help.accurate.id/product/accurate-online/accurate-insight/mencatat-ppn-masukan/) · [PPh 23 jasa](https://help.accurate.id/product/accurate-online/accurate-insight/pph23-jasa/) · [Uang muka PPh 23](https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/mencatat-uang-muka-pph23/) · [Pembelian jasa PPh 23](https://help.accurate.id/product/accurate-online/accurate-insight/mencatat-pembelian-jasa-pph-23/) · [Catat PPh, isi NTPN](https://help.accurate.id/product/accurate-online/fitur-aol/kas-bank/pembayaran/catat-pph-isi-ntpn/)
- [Release #2438 (XML export)](https://accurate.id/release-notes-aol/1012438/) · [Release #5010 (bukti potong list totals)](https://accurate.id/release-notes-aol/1015010/) · [ATalks: Coretax & PPN 12%](https://accurate.id/press-release/atalks-webinar-coretax-dan-ppn12/)

**Mekari Jurnal / Klikpajak**
- [Fitur laporan pajak](https://www.jurnal.id/id/fitur/pajak/laporan/) · [Integrasi Klikpajak](https://www.jurnal.id/id/fitur/integrasi-klikpajak) · [Invoice termin proyek](https://www.jurnal.id/id/blog/invoice-termin-proyek/) · [Jurnal retensi proyek](https://www.jurnal.id/id/blog/jurnal-retensi-proyek/) (snippet)
- Help (snippets only): [Laporan pajak](https://help-center.jurnal.id/hc/id/articles/4472203664409) · [Pemotongan at receipt](https://help-center.jurnal.id/hc/id/articles/11681641022361) · [Pemotongan per customer](https://help-center.jurnal.id/hc/id/articles/4478054098457) · [Tax setup](https://help-center.jurnal.id/hc/id/articles/4417516995225) · [Multiple withholding](https://web.jurnal.id/id/guidebooks/multiple-withholding)
- [Klikpajak: rekonsiliasi PPN dan PPh potong pungut](https://klikpajak.id/blog/rekonsiliasi-ppn-dan-pph-potong-pungut/)

**Odoo**
- [Indonesia localisation (Coretax)](https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/indonesia.html) · [Tax returns (19)](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/tax_returns.html) · [Tax returns (18)](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/tax_returns.html) · [Reporting](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting.html)
- Apps: [lm_id_withholding (18)](https://apps.odoo.com/apps/modules/18.0/lm_id_withholding) · [Bukti potong PPh 23 (8)](https://apps.odoo.com/apps/modules/8.0/l10n_id_taxform_bukti_potong_pph_23)

**NetSuite**
- [Indonesia VAT reports](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1919850.html) · [Withholding tax reports](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2088848.html) · [Withholding setup](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2087219.html) · [Philippines withholding](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1966882.html) · [SuiteTax withholding](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_159646451288.html) · [Workato: Coretax connector](https://www.workato.com/the-connector/coretax-indonesia/)

**Coretax DJP & Indonesian practice**
- [Template XML & converter (DJP)](https://www.pajak.go.id/reformdjp/coretax/template-xml-dan-converter-excel-ke-xml) (snippet) · [DDTC: BPPU converter update](https://news.ddtc.co.id/berita/nasional/1813503/perhatian-ada-update-format-converter-excel-xml-bupot) · [DDTC: Excel → XML](https://news.ddtc.co.id/literasi/tips-trik/1807194/cara-konverter-excel-to-xml-untuk-impor-data-di-aplikasi-coretax) · [DDTC: faktur keluaran template update](https://news.ddtc.co.id/berita/nasional/1813944/perhatian-ada-update-template-excel-faktur-pajak-keluaran) · [Ortax: faktur via XML](https://ortax.org/cara-membuat-faktur-pajak-dengan-impor-xml-di-coretax)
- [DDTC: BPPU withholding receipt](https://news.ddtc.co.id/en/insight/1824243/how-to-generate-a-withholding-receipt-for-services-by-an-entity) · [Ortax: bukti potong unifikasi](https://ortax.org/bagaimana-cara-membuat-bukti-potong-unifikasi-di-coretax) (snippet) · [DDTC: e-Bupot menus](https://news.ddtc.co.id/literasi/kamus/1814661/apa-itu-modul-e-bupot-coretax-dan-menu-menunya) · [DDTC: find bupot](https://news.ddtc.co.id/berita/nasional/1821522/cari-bukti-potong-pph-di-coretax-begini-menu-dan-cara-unduhnya) · [Pajakku: Bukti Potong Saya](https://pajakku.com/artikel/fitur-bukti-potong-saya-di-coretax-fungsi-cara-akses)
- [DDTC: crediting input VAT](https://news.ddtc.co.id/literasi/tips-trik/1821244/cara-mengkreditkan-ppn-dari-pemberitahuan-impor-barang-di-coretax) (snippet) · [DJP: Pajak Masukan after Coretax](https://www.pajak.go.id/index.php/id/siaran-pers/pengkreditan-pajak-masukan-pasca-implementasi-coretax) (snippet) · [SAP KBA 3704375](https://userapps.support.sap.com/sap/support/knowledge/en/3704375) (snippet)
- [Ortax: jasa konstruksi (PP 9/2022)](https://ortax.org/subjek-pilihan/9/seperti-apa-pajak-jasa-konstruksi-yang-terbaru-simak-ketentuannya) · [DDTC: construction PPh under evaluation](https://news.ddtc.co.id/berita/nasional/1813321/pph-final-jasa-konstruksi-sudah-masuk-masa-evaluasi-menkeu) · [Unair thesis](https://repository.unair.ac.id/30395/4/2.%20BAB%201.pdf) (snippet) · [IAI: pajak final (Dwi Martani)](https://web.iaiglobal.or.id/assets/files/file_publikasi/Pengajaran%20dan%20Penelitian%20Pajak%20final%20-%20Dwi%20Martani.pdf) (snippet)
- [DDTC: PPh 23 credit dispute](https://news.ddtc.co.id/sengketa-koreksi-kredit-pajak-atas-pph-pasal-23-30476) · [DDTC: no paper bupot needed](https://news.ddtc.co.id/berita/nasional/1801593/sudah-elektronik-wajib-pajak-tidak-perlu-terima-bukti-potong-kertas) (snippet) · [Xendit: PPh 23 slip submission](https://docs.xendit.co/billing/withholding-tax-slip-23-slips-submission)

### 9.2 Candidate screenshots (not downloaded)

| Vendor | Shows | URL |
|---|---|---|
| Rillet | VAT Report | [gitbook image](https://612265232-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FNpXFVFZpTQck3vIrjmHB%2Fuploads%2FDpdyaPID7JcYkL625imi%2Fimage.png?alt=media&token=ef0e1af5-2daf-4bca-b5da-8cf647a9008e) |
| Rillet | Sales Tax Report | [gitbook image](https://612265232-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FNpXFVFZpTQck3vIrjmHB%2Fuploads%2FCfw9SrNHfqiK8NHWU87n%2Fimage.png?alt=media&token=6165196d-a17b-41ac-ae38-0c599198929e) |
| Puzzle | 1099 Vendors tab | [intercom image](https://downloads.intercomcdn.com/i/o/386051/bf084a1c61e164bf2d80d249/553a375595b3b23500f21598e3c31db0.png) |
| Odoo | Tax return list · e-Faktur on invoice (URLs built from relative paths) | [tax returns](https://www.odoo.com/documentation/19.0/_images/tax-return-view.png) · [e-Faktur](https://www.odoo.com/documentation/19.0/_images/faktur_invoice_confirmed.png) |
| QBO | Sales tax liability report (alt text doesn't match; check before use) | [png](https://quickbooks.intuit.com/oidam/intuit/sbsegcs/en_us/quickbooks-online/images/taxLiabilityRep_QBO_US_Ext_061824.png) |
| Accurate | Tax form, sales receipt with PPh 23 | Images under `help.accurate.id/assets/images/` on the [uang muka PPh 23](https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/mencatat-uang-muka-pph23/) and [NTPN](https://help.accurate.id/product/accurate-online/fitur-aol/kas-bank/pembayaran/catat-pph-isi-ntpn/) pages |
| Jurnal | Tax calculation | [webp](https://www.jurnal.id/wp-content/uploads/2024/04/jurnalkalkulasipajakcopy11_5x-516x430.webp) |
| DualEntry | — | Docs have no images |
