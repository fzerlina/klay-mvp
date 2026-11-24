# Statement of Changes in Equity (Perubahan Modal) — product discovery & competitor benchmark

**Status:** Draft for review · **Date:** 24 Nov 2026 · **Page:** not built yet. Proposed: Reports › Changes in Equity (`/reports/changes-in-equity`, `src/pages/ChangesInEquityPage.jsx`, `src/lib/changesInEquity.js`)

Benchmarked against DualEntry, Rillet, Campfire, Digits, Puzzle, Xero, QuickBooks Online, Accurate Online, Mekari Jurnal, Odoo and NetSuite, plus the Indonesian standards (SAK EP, SAK ETAP, PSAK 201 (formerly PSAK 1), SAK EMKM) and the Company Law (UU PT). Everything comes from public docs, help centres, vendor forums and SME input in Slack, read on 24 Nov 2026. See [§8 Caveats](#8-caveats-on-the-evidence) before quoting anything as fact. Companion to the [Trial Balance](../trial-balance/README.md) and [Profit & Loss](../profit-loss/README.md) research.

**Names.** *Laporan Perubahan Ekuitas* is the SAK / PSAK term. *Laporan Perubahan Modal* is what SMEs, textbooks and Jurnal call it. The Jurnal blog says the two are the same report: "ekuitas" is used for incorporated entities (PT) and "modal" for small businesses. Fidya corrected "Pengajuan Modal" to **"Perubahan Modal"** in the timeline deck (Slack, 24 Nov).

---

## TL;DR

1. **DualEntry has no equity statement.** Its standard reports are the income statement, balance sheet, cash flow, trial balance, budget views and flux. The custom report builder has no opening, activity or ending row or column types, so you can't build an equity rollforward in it. The only equity rollforward in its docs is a **manual retained-earnings tie-out** in the migration guide. There's no DualEntry layout to copy for this report: copy DualEntry's report shell (and Klay's Balance Sheet, which already mimics it) and fill it with the Indonesian matrix.
2. **The US AI-native ERPs don't have one either.** Rillet, Campfire, Digits and Puzzle show no equity statement in their docs. QBO US says it "does not offer a specific report" and tells users to run the Balance Sheet by quarter. QBO International lists one, but not on Essentials, and a 2024 thread reports it failing to open. Xero has one in the UK only. NetSuite and Odoo need a custom report or a third-party app.
3. **The local reference is Mekari Jurnal.** It has *Laporan › Sekilas Bisnis › Perubahan Modal*, with a date range, period filter, period comparison, and PDF / Excel / CSV export. The screenshot Fidya shared on 23 Nov looks like this report (likely Jurnal; see §8). It isn't the PSAK matrix: it's a **list of equity accounts** with *Permulaan · Debit · Kredit · Saldo akhir*, a Total, and a *Pergerakan* (net movement) row. Accountants still have to retype it into the auditor's format.
4. **Indonesian convention is a matrix.** Each equity component is a column (*modal saham*, *tambahan modal disetor*, *saldo laba ditentukan / belum ditentukan penggunaannya*, OCI, *jumlah*). Each movement is a row (*saldo awal*, *laba tahun berjalan*, *dividen*, *setoran modal*, *pembentukan cadangan*, *saldo akhir*). Two years are stacked, prior year first. SAK EP Bab 6 and PSAK 201 require a reconciliation per component and two periods. UU PT Pasal 70 (mandatory reserve up to 20% of paid-up capital) is why retained earnings splits into two columns.
5. **Not every customer needs it.** SAK EMKM's minimum set has no equity statement. SAK EP §3.18 lets an entity whose only equity changes are profit, dividends, error corrections and policy changes present a combined *laporan laba rugi dan saldo laba* instead.
6. **Klay already has most of the parts.** `computeBalanceSheet` computes *Laba (rugi) tahun berjalan* and rolls earlier years into retained earnings, with no closing journal. `TransactionsPanel` drills to journal lines and already shows the year-end roll as a synthetic line. `ReportControls`, `xlsxExport` (live formulas), Bahasa print labels and the signature block are all reusable. The new work is **(a) mapping accounts to columns, (b) classifying each equity posting into a movement row, and (c) the proofs.**
7. **The differentiator is the proof.** No vendor shows on screen that the statement ties out. DualEntry's docs tell the user to check it by hand, and Xero only flags a retained-earnings mismatch when the equity statement is included. Klay can show that each column's closing balance equals the Balance Sheet equity line, and that the profit row equals the P&L, the way the BS page already proves A = L + E.

---

## Decision since the benchmark (24 Nov 2026)

The user chose to follow the SME's current tool (Fidya's Jurnal screenshot) more closely, so §6 #13 moves from V1.1 to **V1 and becomes the default view**:

| View | Layout | Why |
|---|---|---|
| **By account** (default) | Equity accounts by code under *Modal* × **Permulaan · Debit · Kredit · Saldo akhir**, then **Total** and **Pergerakan**. There's a computed *Laba (rugi) tahun berjalan* row (no closing journal in Klay), and a fiscal year-end roll into retained earnings shown as a closing journal would post it. | It's what the SME and clients' accountants work with today, and it reads like the Trial Balance (Dr/Cr, per the TB decision of 10 Nov). |
| **Statement (SAK EP)** | The matrix from §6 #1–#7, with the prior year stacked above. | It's the version that goes into audited financials and to the directors. |

Both views prove they tie to Balance Sheet equity, and both open the transactions panel on click. Compare applies only to the Statement view.

## SME input so far (Slack #all-smplwrld, 22–24 Nov 2026)

| Date | Who | What | Bearing on this report |
|---|---|---|---|
| 23 Nov | vinaze → Fidya, Roni | Asked for the Perubahan Modal screenshots again, plus a short description of the data the report needs ([thread](https://smplwrld.slack.com/archives/C0AQCTEUACE/p1795442501484209)) | — |
| 23 Nov | Fidya | Replied with **one screenshot and no text** (file `F0CM2MHDQ0Y`). The data-needs description is still outstanding. | Screenshot below |
| 24 Nov | Fidya | Timeline deck: "'Pengajuan Modal' harusnya 'Perubahan Modal'" | Menu name |
| 24 Nov | Elis, vinaze, Michael (Pak Hadi validation of TB / P&L / BS) | Drill-down should stay inside the report, without jumping to the GL ("lets add the drill down to journal level inside the TB"). Pak Hadi wants opening–movement–ending views on the BS. | SoCE drill uses the side panel. The SoCE *is* the opening–movement–ending view for equity. |

**What the screenshot shows** (amounts blurred):
- **Title:** "Perubahan Modal (dalam IDR)".
- **Controls:** *Tanggal Mulai*, *Tanggal Selesai*, *Filter sesuai periode* (set to *Hari ini*), a **Filter** button, *Filter lebih lanjut*, and an **Ekspor** menu.
- **Columns:** *Kode Akun · Nama Akun · Permulaan · Debit · Kredit · Saldo akhir*.
- **Rows:** grouped under "Periode: 17/11/2026". Header account *3101 MODAL*, then *3101.01.001 Modal Dasar*, *.002 Tambahan Modal Disetor*, *.003 Laba Ditahan*, *.004 Dividen*. Then a **Total** row and a **Pergerakan** row.
- **Reading:** rows = accounts and columns = opening / Dr / Cr / ending. This is a trial balance filtered to equity, not the PSAK matrix. There's no profit line: current-year profit isn't shown unless it has been closed to *Laba Ditahan*.

---

## 1. Who uses it and what for

| Who | When | Job to be done | What they need from the screen |
|---|---|---|---|
| **Finance manager / chief accountant** (preparer) | Year-end, sometimes quarterly | "Produce the 3rd statement of the set so the package is complete." | Matrix in SAK/PSAK format, prior-year comparative, Bahasa labels, Excel that matches the auditor's template |
| **External auditor (KAP)** | Audit fieldwork | "Does equity roll from last year's audited closing to this year's, and does every movement have support?" | Opening = last year's audited closing; each movement traced to a journal (RUPS dividend resolution, *setoran modal* deed); ties to the BS and P&L |
| **Owner / director, *RUPS*** | Annual GMS, dividend decision | "How much profit can we distribute, and have we met the 20% mandatory reserve?" | Retained earnings split into appropriated / unappropriated; dividends and reserve formation as their own rows |
| **Bank / lender** | Credit review, covenants | "Did equity grow, or did the owners take cash out?" | Clean signed PDF; capital injections vs dividends visible |
| **Tax consultant** | SPT Tahunan PPh Badan | "Attach the full financial statements to the SPT." | PDF / Excel of the full set, including this report |
| **Implementer** | Migration cutover | "Prove the opening equity matches the old system." | Opening balances per component; a migration journal that doesn't show up as a "movement" |

**Key moments:** the year-end close and audit (most of the use), the *RUPS tahunan* (dividends, reserve), capital injections, and migration. It's much less frequent than the TB / P&L / BS. Most SMEs look at it once a year.

---

## 2. Klay today

There's no equity statement page and no card on the Reports hub (`src/pages/ReportsPage.jsx`). What can be reused:

| Area | What exists | Reuse for this report |
|---|---|---|
| **Equity accounts** (`src/data/seed/coa.js`) | Group `g-equity` with **3-1100 Share Capital**, **3-1200 Additional Paid-in Capital**, **3-1300 Retained Earnings**, **3-1400 Current Year Earnings**, **3-1500 Dividends Distributed** (debit-normal). Seed opening: Share capital Rp 500M, RE Rp 103M (`openingBalances.js`). | Column mapping. There's **no reserve (*cadangan*) account and no OCI account**, so the "ditentukan penggunaannya" and OCI columns would always be empty with the seed chart. |
| **Equity computation** (`src/lib/balanceSheet.js`) | `computeBalanceSheet(entries, asOf)` returns `byCode` for every BS account, **`currentYearProfit`** (P&L from fiscal-year start to `asOf`, computed, not posted) and **`rolledProfit`** (earlier years, folded into RE). `CURRENT_YEAR_PROFIT` carries the label *"Laba (rugi) tahun berjalan"*. `fiscalYearStartFor`, `byAccountCode`, `change`. | Opening = BS at the day before the start, closing = BS at the end date, per component. The profit row = `currentYearProfit`, or `computeProfitLoss` for a range that doesn't start on the fiscal-year start. |
| **Balance Sheet page** (`src/pages/BalanceSheetPage.jsx`) | Computed profit row styled `bs-computed-row`. RE has every earlier year rolled in. **Two on-screen proofs** (A = L + E, and current-year profit = P&L YTD). Abnormal-balance pill (RE and 3-1400 exempt). Prior-FY-end comparative by default. Settings: exclude zero, units (Rp / ribuan / jutaan), **labels in print and Excel: Bahasa / English** (`Lbl`, `pl-lbl-print`). Print sign-off (*Disiapkan / Diperiksa / Disetujui oleh*). Excel with live formulas plus a difference row. No dimension filter. | Page shell, settings popover, proof banner, units, Bahasa print, sign-off, and the export patterns, almost as they are. |
| **Drill panel** (`src/components/TransactionsPanel.jsx`) | Side panel with one account's posted lines for one period: opening → lines → closing, running balance, a **"✓ Matches the amount on the report"** tie check, period chips, JE links opening in a new tab, an "Open in General Ledger" link. The BS already adds a synthetic **"Fiscal year to …: profit/(loss) rolled in at year-end — calculated, not a posting"** line for RE. | Cell drill (component × movement). Needs a small extension: filter lines by movement type, not only by account. |
| **Report controls** (`src/components/ReportControls.jsx`) | `PeriodPopover` (presets + custom range), `AsOfPopover`, `ComparePopover`, `ViewsPopover`, `ExportPopover` (Excel with formulas / CSV / Print-PDF), `ChoicePopover`. | Period picker, export menu, saved views. |
| **Export** (`src/lib/xlsxExport.js`, `src/lib/reportExport.js`) | `.xlsx` without a library, with formulas and styles. CSV with a company header. `printReport`. | Matrix Excel with `SUM` down each column and across each row. |
| **P&L** (`src/lib/profitLoss.js`) | `computeProfitLoss(entries, {from, to})`, `unpostedInPeriod`. SME decisions: "profit/(loss)" labels, losses in red. | The profit row, the unposted-drafts banner, and the loss styling. |
| **JE flag** | Manual journals carry `is_adjusting` (`journalForm.js`, `journalLifecycle.js`). | A possible input for a later "restatement / koreksi" row. |

**Gaps found while reading the code**

- **No movement type on journals.** Nothing tells a capital injection from a dividend or a reclassification except the account and direction. The MVP has to classify by rule (§6 #5).
- **3-1400 and 3-1500 are never closed.** Klay posts no year-end closing entry, so Dividends Distributed accumulates across years and 3-1400 sits beside the computed profit line. If the SoCE gave each account its own column, it would never match a printed statement. Both have to fold into the *Saldo laba* column.
- **The migration journal would read as a movement.** `ledgerBackfill.js` posts *"Opening balances — brought forward from the previous system"*, crediting RE as "Opening equity". The SoCE must fold it into *Saldo awal*, or the first year shows a large unexplained RE movement. It needs a marker (e.g. `reference_type: "opening"`); today it's `"manual"`.
- **The seed data has no equity events.** There's no *setoran modal*, dividend or reserve journal, so the demo statement would show only profit. Seed at least one of each for the prototype.

---

## 3. Functionality benchmark

**Legend:** ✓ documented · ◐ partial / workaround / other screen · ✗ documented as missing (or no such report) · ? not found in public sources · *(i)* inferred · — not applicable (no report)

**Abbreviations:** DE = DualEntry · Ril = Rillet · Camp = Campfire · Dig = Digits · Puz = Puzzle · QBO = QuickBooks Online · Acc = Accurate Online · Jur = Mekari Jurnal · NS = NetSuite

### 3.1 What Indonesian standards and auditors expect

| Source | Requirement |
|---|---|
| **SAK EP** (effective 1 Jan 2025, replaces SAK ETAP), Bab 6 | Per **component of equity**: total comprehensive income; the effect of retrospective restatement; and a **reconciliation of opening to closing** showing separately profit or loss, OCI, and investments by, dividends and other distributions to owners. §3.20: at least **two periods**. |
| **SAK EP §3.18** (also in SAK ETAP) | If the only equity changes are profit, dividends, prior-period error corrections and policy changes, an entity may present a combined **Laporan Laba Rugi dan Saldo Laba**: opening RE, dividends declared, restatements, closing RE. |
| **PSAK 201** (formerly PSAK 1, entities with public accountability) | Same reconciliation per component; the SoCE is one of the five statements in a complete set. |
| **SAK EMKM** (micro / small) | Minimum set = financial position, profit or loss, notes. **No equity statement required.** |
| **UU PT 40/2007 Pasal 70–71** | A PT must set aside part of net profit as a **mandatory reserve** until it reaches **20% of issued and paid-up capital**. Profit use (reserve, dividends) is decided by the **RUPS**. Dividends only when RE is positive. That's why audited statements split *saldo laba* into **telah ditentukan penggunaannya** (appropriated) and **belum ditentukan penggunaannya** (unappropriated). |

**The layout auditors and banks receive.** This is the shape of audited Indonesian statements, from general practice; SAK EP's own illustration is an image that wasn't readable (see §8):

| *(Dinyatakan dalam Rupiah)* | Catatan | Modal saham | Tambahan modal disetor | Saldo laba — ditentukan penggunaannya | Saldo laba — belum ditentukan penggunaannya | Penghasilan komprehensif lain | Jumlah ekuitas |
|---|---|---|---|---|---|---|---|
| **Saldo 1 Januari 2024** | | x | x | x | x | x | x |
| Laba tahun berjalan | | | | | x | | x |
| Penghasilan komprehensif lain | | | | | | x | x |
| Pembentukan cadangan umum | 15 | | | x | (x) | | — |
| Dividen tunai | 16 | | | | (x) | | (x) |
| Setoran modal / penerbitan saham | 14 | x | x | | | | x |
| **Saldo 31 Desember 2024** | | x | x | x | x | x | x |
| *(the same movement rows for 2025)* | | | | | | | |
| **Saldo 31 Desember 2025** | | x | x | x | x | x | x |

Conventions:
- Negatives in parentheses.
- A *Catatan* column points to the notes.
- Columns appear only for components the company has. A CV or perorangan shows *Modal* and *Prive* instead of shares.
- The closing row equals the equity section of the balance sheet, column by column.

### 3.2 Availability & layout

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Native equity statement | ✗ | ? | ✗ no API endpoint | ✗ not in statements list | ? | ◐ UK only | ◐ International editions, not US; not Essentials | ? blog claims it, no help page | ✓ Perubahan Modal (Pro / Enterprise) | ✗ core; 3rd-party app | ✗ standard; custom via Financial Report Builder |
| PSAK / IFRS matrix (components as columns) | ✗ | ? | ✗ | ✗ | ? | ? | ? | ? | ✗ account rows *(i, from SME screenshot)* | ◐ 3rd-party | ◐ custom build |
| Account rollforward (opening / Dr / Cr / ending per equity account) | ◐ TB with account filter | ◐ TB | ◐ TB API | ✗ | ◐ TB | ✗ TB has no opening / movement | ✗ | ◐ 6-column Neraca Percobaan | ✓ that *is* its Perubahan Modal | ◐ TB | ✗ as-of TB |
| Current-year profit computed into equity (no closing JE needed) | ✓ start date decides NI vs RE | ? | ✓ synthetic row (TB) | ? | ? | ✓ *(i)* | ✓ Net Income line on BS *(i)* | ◐ RE fixes Oct 2024 | ◐ *Tutup Buku* posts to *laba ditahan* | ✓ "Result Brought Forward" | ✓ calculated RE / NI |
| Prior-year comparative | ◐ Date column (custom) | ? | ? | ? | ? | ? | ◐ BS by quarter (workaround) | ? | ✓ compare periods | ✓ (BS) | ◐ custom |
| Period: range vs as-of | — | — | — | — | — | ◐ "over the financial year" | ? | ? | ✓ start / end date + period preset | — | — |

### 3.3 Tie-out, drill-down & classification

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Shows that equity ties to BS / P&L | ◐ docs: check TB ↔ BS by hand; manual RE rollforward at migration | ? | ◐ TB API refuses unbalanced | ? | ? | ◐ RE-mismatch flag only when SoCE included | ✗ | ✗ | ? | ◐ 3rd-party "tie-outs" in list views | ✗ CTA plugs muddy rollforwards |
| Drill from an equity amount to journals | ◐ BS Detail; **RE drill opens GL with direct postings only, which won't match** | ? | ✓ cell → transactions *(i)* | ? | ? | ? | ✓ (BS) | ? | ? | ✓ (BS) | ✓ (BS) |
| How movements are classified | — | — | — | — | — | ? | ? | ? | by account (rows = accounts) | preparer enters share issues, dividends, OCI; profit and opening derived from GL | by account rows in the custom report |
| Restatement / prior-period correction row | — | — | — | — | — | ? | ? | ? | ✗ *(i)* | ✓ 3rd-party | ◐ custom |
| NCI / owner attribution | ◐ Ownership & NCI reports (pro-rata NI share, no movements) | ? | ? | ? | ? | ? | ? | ✗ | ✗ | ✓ 3rd-party | ◐ OneWorld consolidation |

### 3.4 Output

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Excel / PDF of the equity statement | — (BS: ✓ Excel / PDF / CSV, live `SUM`) | — | — | — | — | ✓ *(i)* | ◐ International only | ? | ✓ PDF / Excel / CSV | ✗ 3rd-party app has no PDF / XLSX | ◐ custom report export |
| Bahasa Indonesia labels | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ◐ translation | ✗ |
| Report pack (BS + P&L + SoCE + CF) | ◐ packages, no SoCE | ? | ? | ◐ Financial Package, no SoCE | ◐ Tax Package | ◐ report templates (UK) *(i)* | ✗ | ? | ? | ✗ | ✓ custom |

---

## 4. Vendor notes (UX and the ideas worth taking)

### DualEntry — closest peer, deepest docs (deep dive)
- **There's no Statement of Changes in Equity**, Stockholders' Equity or Retained Earnings statement in the standard report list. The list covers:
  - income statement (Summary / Detail)
  - balance sheet (Summary / Detail)
  - cash flow (Summary only)
  - TB Summary / Detail
  - Income Statement Budget and Balance Sheet Budget
  - flux IS / BS
  - Date/Period Mismatch, CTA Balance Audit, General Ledger
- **The custom report builder can't fill the gap.** It starts only from IS / BS / CF / TB (Summary tab). Columns: Date, Budget, Formula, and Pivot by year / quarter / month; Note and Variance are listed but unavailable. Rows: Account, Account Type, Group, Formula; Multiple Accounts isn't available yet. There's **no opening, activity or ending row or column type**. The closest you can get is account rows with two Date columns (two balances, not a reconciliation).
- **The equity rollforward exists only as a manual procedure.** The migration guide says to "take opening retained earnings from the source system", "add net income per the DualEntry income statement", subtract distributions, and compare to DualEntry's closing RE. It calls this the check most likely to expose a systematic mapping error.
- **Ownership & NCI reports.** Ownership Allocation, Effective Ownership & NCI, and Owner Portfolio show each owner's % and share of **fiscal-YTD net income** and **BS equity**. There are no opening, contribution, distribution or closing rows, and the docs say "there is no income statement by owner."
- **How equity shows on the BS** (this is the shell to copy):
  - Balances run to the end date. **The start date only decides which fiscal year is current, which decides what's "Net Income" and what's "Retained Earnings".**
  - The header has a date-range picker with presets ("Last Month", "Year to Date"; first open is YTD, and each report remembers its last preset), a company button, a currency picker, a book filter, and **Summary | Detail** tabs.
  - The toolbar has **Expand one level / Collapse one level**, **Pivot** (IS only), and a **gear → Report Format → Exclude zero balance** toggle.
  - **Drill:** clicking an amount or account opens Detail filtered to that account and column. Expanding a row lists *Record No · Posting Date · Amount* plus an account total, and the Record No opens the source in a new tab.
  - **The pain point:** RE's drill opens the GL with direct postings only, and the docs warn that the GL total "won't match" the BS because the BS includes prior years' net income. Klay's panel already fixes this with the synthetic roll line.
  - **Export:** Excel / PDF / CSV from the report header, run as a background job, with live `SUM` formulas in Excel. Saved reports can go into **Report Packages** for scheduled delivery.
- **Integrity is a documented practice, not a feature.** The docs list checks for the user to do: TB Dr = Cr; TB ties to BS and IS under the same filters; A = L + E; BS and IS use the same end date.
- **What to take:** the shell, Expand / Collapse one level, the gear with report format, the export menu in the header, and the "remembers the last preset" behaviour. **What to do better:** a statement that exists at all, an RE drill that ties, and automatic proofs.

### Rillet
- The Close Reports list (TB, revenue waterfall, deferred revenue, prepaid, GL, 1099, sales tax, VAT, cash recon, depreciation, deletion logs) has no equity report. The financial-statements docs weren't reachable (§8), so this stays **?**.

### Campfire
- The API's financial statements cover balance sheet (incl. comparative), income statement (accrual and cash), cash flow, TB, GL, and custom reports. **There's no equity endpoint.** The TB's synthetic "Net Income (Prior Periods)" row (see TB research) is the same idea as Klay's computed profit line.

### Digits
- The statements are P&L, Balance Sheet, Cash Flow, AR / AP Aging, and a Financial Package. There's no equity statement.

### Puzzle
- The downloads are cumulative TB, adjusted TB and Tax Package. No equity statement was found; the "Financial Statements in Puzzle" article wasn't read.

### Xero
- **The UK has a "Statement of Changes in Equity" report.** The Xero Central slug is `Movements-in-Equity-New-UK`, and the snippet reads "see the change in your organisation's net worth over the financial year". The article body was blocked (§8), so its layout is unknown.
- A product idea (21 Nov 2024, 3 votes, "submitted") asks for a flag when P&L + brought-forward RE doesn't equal reported RE. It notes the flag "only seems to flag if you opt to include a statement of changes to equity". **Evidence that the equity statement is where RE errors surface**, and that users want the check shown up front.

### QuickBooks Online
- **US:** staff said in Mar 2024 that QBO "does not offer a specific report" for owner's equity. The workaround is to run the Balance Sheet with columns by quarter and compare the equity lines.
- **International:** a "Statement of Changes in Equity" exists, but staff said (Feb 2022) it's "currently unavailable in QuickBooks Online Essentials". In Sep 2024 users couldn't open it, and staff cited "ongoing investigation (INV-111140)". Staff suggested exporting the BS to Excel and comparing as a workaround.

### Accurate Online
- Accurate's blog says the software produces a *laporan perubahan modal* automatically, "and 200+ other reports". No help-centre article or release note was found (the help centre returns 403). The menu name and layout are unverified.

### Mekari Jurnal — the local reference
- **Laporan › tab Sekilas Bisnis › "Perubahan Modal".** It has a start / end date and a period filter, *bandingkan periode* (compare periods), and **Ekspor → PDF, Excel or CSV**. Jurnal's UKM guide says it's on the **Pro and Enterprise** plans.
- The likely in-app layout (from Fidya's screenshot, *(i)*):
  - equity accounts as rows, in COA hierarchy (*3101 MODAL › 3101.01.00x*)
  - *Permulaan · Debit · Kredit · Saldo akhir* columns
  - a Total row and a *Pergerakan* (net movement) row
- It's effectively the TB restricted to equity. There's **no profit row and no component-by-movement matrix**: the accountant still builds the PSAK statement in Excel *(i)*.
- **Tutup Buku** posts the closing entry to *laba ditahan* (TB research). After a close, profit shows up as an RE movement; before it, it doesn't show at all.

### Odoo
- **Core has no SoCE.** The reporting docs list the Balance Sheet, P&L and Cash Flow, and a forum thread asking for one goes back to v8.
- **The third-party app "eh_account_statements"** (ERP Heritage, v16–19) covers an IAS 1 SoCE with OCI and NCI attribution:
  - The **preparer enters** OCI, share issues, dividends and the owners / NCI split.
  - **Profit and opening equity are derived** from posted items.
  - The listing says it produces **no formatted PDF or spreadsheet**; figures and tie-outs appear in list views.
- Year-end: a dynamic "Result Brought Forward" line until the appropriation entry posts (TB research).

### NetSuite
- **There's no standard equity statement.** The community asks for an "Equity Change Report" as a standard report. Users build rollforwards with the **Financial Report Builder** or saved searches and get stuck on where the **CTA** line goes, since it's a balance-sheet plug with no income-statement source. The BS RE line combines "Net Income Balance Forward" with manual RE postings, which confuses users comparing it to the detail report.

---

## 5. Patterns across the market

1. **The equity statement is the most neglected of the four core statements.** Out of 11 vendors, only Jurnal (locally) and Xero UK / QBO International have one. US-first products treat it as something the auditor or an Excel workbook produces. That's a gap for Indonesian PTs, which need it for the audited set.
2. **When it exists in SME tools, it's an account list, not a matrix.** Jurnal's version is a TB slice. The PSAK matrix (component × movement) is left to Excel.
3. **Movement classification is the hard problem, and nobody automates it well.** Products either show accounts and not movements (Jurnal), ask the preparer to type movements in (Odoo app), or leave it to a custom report (NetSuite). A rule-based classifier with an honest "other movements" row would already beat the market.
4. **Retained earnings is where trust breaks.** DualEntry's RE drill doesn't match, NetSuite's RE mixes balance-forward with postings, Accurate fixed RE bugs in Oct 2024, and Xero users ask for a mismatch flag. A computed profit line and roll, with the reconciliation shown, is the fix.
5. **The check users want is "does it tie?"** Every vendor documents it as a manual step (DualEntry migration, QBO workaround, Xero idea). Showing it on screen is cheap for Klay because the BS already does.

---

## 6. Proposed scope for Klay

Linear design scope (2 days): equity accounts as columns, movements as rows; current vs prior year; ties to BS equity; drill-down; Bahasa labels; Excel / PDF export. Items 1–10 fit that scope.

| # | Item | When | Why (one line) |
|---|---|---|---|
| 1 | **Matrix layout**: equity components as columns (*Modal saham · Tambahan modal disetor · Saldo laba · Jumlah ekuitas*), movements as rows, accounts in code order | **V1 (MVP)** | It's the SAK EP / PSAK format auditors and banks receive, and the Linear scope. |
| 2 | **Column mapping from the COA**: 3-1100 → Modal saham; 3-1200 → Tambahan modal disetor; **3-1300 + 3-1400 + 3-1500 + computed current-year profit → Saldo laba**; a column hides when it's zero in both years | **V1 (MVP)** | Klay never closes 3-1400 / 3-1500, so one column per account wouldn't match a printed statement or the BS total. |
| 3 | **Two stacked year blocks**: *Saldo awal* prior FY → movements → *Saldo akhir* prior FY → current movements → *Saldo akhir* at the end date | **V1 (MVP)** | SAK EP §3.20 needs two periods, and every audited statement stacks them this way. |
| 4 | **Period**: current fiscal year to an end date (default: last month-end, like the BS), presets *This FY to date / Last FY / Custom end date*; the start is pinned to the FY start | **V1 (MVP)** | A statement that starts mid-year confuses the RE roll; reuses `AsOfPopover` and the BS defaults. |
| 5 | **Rule-based movement rows**: *Laba (rugi) tahun berjalan* (computed) · *Setoran modal* (credits to 3-1100 / 3-1200) · *Dividen* (postings to 3-1500, or RE debits against dividend payable) · *Mutasi lainnya* (everything else, highlighted when not zero); the migration journal folds into *Saldo awal* | **V1 (MVP)** | No JE tagging is needed for the MVP, and "Mutasi lainnya" keeps it honest instead of silently forcing a balance. |
| 6 | **Three on-screen proofs**: each column's *Saldo akhir* = BS equity at the end date; *Saldo awal* = BS at the day before the start; the profit row = P&L net profit for the period | **V1 (MVP)** | The Linear scope says "ties to BS". No vendor shows it, and the BS proof pattern already exists. |
| 7 | **Drill on every cell** into `TransactionsPanel` (component × movement × year), with the synthetic year-end roll line; the profit cell links to the P&L for the same range | **V1 (MVP)** | 24 Nov decision: investigate inside the report, without jumping to the GL. Fixes DualEntry's non-matching RE drill. |
| 8 | **Bahasa labels in print and Excel** (*Laporan Perubahan Ekuitas*, *Saldo 1 Januari 20X1*, *Laba tahun berjalan*, *Dividen tunai*, *Jumlah ekuitas*), English on screen; units Rp / ribuan / jutaan; negatives in parentheses, losses red | **V1 (MVP)** | Reuses the BS / P&L `lang` and `unit` settings and the SME's 11 Nov profit/(loss) and red-loss decisions. |
| 9 | **Excel (.xlsx) with live formulas** (`SUM` down to *Saldo akhir*, `SUM` across to *Jumlah*, a difference row vs the BS), plus CSV and **Print / PDF with a signature block** | **V1 (MVP)** | Auditors rework it in Excel; reuses `xlsxExport` and the BS sign-off; Jurnal exports PDF / Excel / CSV. |
| 10 | **Unposted-drafts banner** (drafts and journals awaiting approval that touch equity in the period) | **V1 (MVP)** | The same close context as the TB / P&L / BS, and cheap with `unpostedInPeriod`. |
| 11 | **Card on the Reports hub** + "Perubahan Modal" as the Bahasa name | **V1 (MVP)** | Discoverability; Fidya's naming correction (24 Nov). |
| 12 | **Saldo laba split**: *Ditentukan penggunaannya* (reserve account) vs *Belum ditentukan*, plus a *Pembentukan cadangan* row (RE → reserve transfers) | **V1.1** | UU PT Pasal 70 mandatory reserve, but the seed COA has no reserve account. Confirm with the SME that clients book it separately. |
| 13 | **Account view toggle** (Jurnal-style: equity accounts × *Saldo awal · Debit · Kredit · Saldo akhir*), or a link to the TB filtered to 3-xxxx | **V1.1** | It's what the SME's current tool shows; the TB already has the 6 columns, so it's cheap. |
| 14 | **Equity movement tag** on manual JE lines that hit equity (Setoran modal / Dividen / Cadangan / Koreksi / Lainnya), overriding the rule | **V1.1** | For when the item #5 rules misclassify; keeps "Mutasi lainnya" near zero. |
| 15 | **Restatement row** (*Penyesuaian / koreksi kesalahan periode lalu*) | **V1.1** | Required separately by SAK EP Bab 6 (b); needs a prior-period flag (could reuse `is_adjusting` plus a date rule). |
| 16 | **Combined *Laporan Laba Rugi dan Saldo Laba*** layout for companies with only profit / dividend movements | **Later** | Allowed by SAK EP §3.18 and simpler for small PTs; an option, not a need. |
| 17 | **CV / persekutuan / perorangan layout**: capital per partner, *Prive*, *Modal sekutu* columns | **Later** | Common Indonesian SME legal forms with a different equity model; needs partner accounts in the COA. |
| 18 | **OCI column** (*Penghasilan komprehensif lain*: revaluation, actuarial) | **Later** | Rare for Klay's SME customers; needs OCI accounts and an OCI section on the P&L (P&L research §7 Q7). |
| 19 | **Report pack** (BS + P&L + SoCE + CF + Director's Summary) as one PDF / Excel with a cover | **Later** | The Director's Summary is planned last in the Reports block (timeline, 24 Nov); DualEntry and Digits have packages. |
| 20 | **Treasury shares, NCI, consolidation, FX translation reserve** | **Not now** | Klay V1 is single-entity IDR; NetSuite's CTA mess shows the cost. |
| 21 | **Dimension filter** | **Not now** | Same as the BS decision: equity isn't tagged, so a filtered statement can't tie. |
| 22 | **Variance flags / review notes on equity movements** | **Not now** | Movements are rare and deliberate (RUPS, deeds); the BS already flags equity balances. |
| 23 | **Monthly columns / multi-period trend** | **Not now** | An annual statement by nature; the BS compare covers month-ends. |

**Effort note:** #1–#11 are mostly composition. Build `changesInEquity.js` on `computeBalanceSheet` (opening and closing) plus a classifier over posted equity lines (#5), then reuse the BS page shell, settings, panel and exports. The real design work in the 2 days is the matrix table (sticky first column, two year blocks, proof banner) and the drill-panel variant for a single cell.

---

## 7. Open SME questions (Fidya, Roni)

1. **Which layout do clients and auditors want on screen?** The PSAK matrix (components as columns), the Jurnal-style account list from your screenshot, or both, with the matrix for print? Which tool is the screenshot from?
2. **Columns:** which components do typical Klay customers (PT) have: *modal saham*, *tambahan modal disetor / agio*, *saldo laba ditentukan / belum ditentukan penggunaannya*, OCI, *saham treasuri*? Do they keep the **mandatory reserve (cadangan wajib, Pasal 70)** in its own account, or only in the notes?
3. **Rows and wording:** which movements appear in a normal year, and what are the exact Bahasa labels: *Laba tahun berjalan* / *Laba bersih tahun berjalan*, *Dividen tunai*, *Setoran modal* / *Penambahan modal disetor*, *Pembentukan cadangan umum*, *Koreksi saldo laba*, *Prive*?
4. **Dividends:** are dividends recorded at the RUPS declaration date (Dr Saldo laba / Cr Utang dividen) or at payment? Is a *Dividends Distributed* account that's never closed (Klay's 3-1500) acceptable, or do auditors expect it closed to *laba ditahan* at year-end?
5. **No closing journal:** Klay computes *Laba tahun berjalan* and rolls it into *laba ditahan* without posting (like the BS). Is that acceptable for auditors, or do they expect a posted closing entry, like Jurnal's *Tutup Buku*?
6. **Period:** is the statement only ever run for a full fiscal year, or also year-to-date (e.g. a bank asking mid-year)? What should it open on?
7. **Comparative:** always show the prior-year block, or let the user turn it off?
8. **Who needs it:** should SAK EMKM clients (no equity statement required) still see it? Are there CV / UD clients who need *modal per sekutu* and *prive*?
9. **Print and Excel:** is a *Catatan* (note reference) column expected? Signatures: the same three as the BS (*Disiapkan / Diperiksa / Disetujui oleh*) or *Direksi* only? Is there a KAP Excel template we should match?
10. **Data needs:** the short description of the report's data needs from 23 Nov is still outstanding. Anything beyond equity accounts, profit, dividends and capital injections (e.g. the share register or number of shares)?

---

## 8. Caveats on the evidence

- **DualEntry's absence is from its own docs index.** The Accountants index (263 pages) has no page mentioning equity statements, dividends, distributions or capital. The standard-statements, custom-builder, run-statements, ownership and migration pages were read in full. The product could still have something undocumented.
- **Blocked sources:** Accurate's help centre returned 403, the Xero Central article body came back empty (the TB research hit a CAPTCHA there too), and Rillet's financial-statements docs and Puzzle's statements article weren't reached. Claims for those come from search snippets, blogs and forums.
- **Jurnal:** the menu path, filters, export formats and plan tier come from Jurnal's own blog and guidebook snippets; `web.jurnal.id` didn't resolve. **The account-list layout is inferred from Fidya's screenshot.** The screenshot has no product name; it's attributed to Jurnal because its title format ("(dalam IDR)") and control labels match Jurnal's reports. Confirm with Fidya (Q1).
- **QBO International** facts come from community threads dated 2022 and 2024. Current availability and the INV-111140 bug status are unknown.
- **Indonesian layout:** the SAK EP and PSAK requirements are from secondary sources (IAI exposure draft, KJA and Gustani summaries) because the final IAI texts are paywalled. The example matrix in §3.1 reflects the general practice of audited Indonesian statements, not a fetched illustration. The SAK EP illustration on Gustani is an image that wasn't readable.
- **Odoo third-party app and NetSuite:** these come from listings and community threads, not hands-on use.
- **Slack content was treated as data.** The only SME artefact is the one screenshot (Slack file `F0CM2MHDQ0Y`, 23 Nov). It isn't copied into this folder.
- **No screenshots saved.** Downloading vendor images needs a go-ahead, as in the TB research.

---

## 9. Sources

### 9.1 Articles

**DualEntry**
- [Standard financial statements](https://docs.dualentry.com/accountants/reporting-analytics/standard-financial-statements.md) · [Run financial statements](https://docs.dualentry.com/accountants/reporting-analytics/run-financial-statements.md) · [Custom report builder](https://docs.dualentry.com/accountants/reporting-analytics/custom-report-builder.md)
- [Ownership and NCI reporting](https://docs.dualentry.com/accountants/reporting-analytics/ownership-and-nci-reporting.md) · [Validate a migration (RE roll-forward)](https://docs.dualentry.com/accountants/get-started/validate-a-migration.md)
- [Exporting & report groups](https://docs.dualentry.com/accountants/reporting-analytics/exporting-and-report-groups.md) · [Report packages](https://docs.dualentry.com/accountants/reporting-analytics/report-packages.md) · [Accountants docs index](https://docs.dualentry.com/_llms/accountants.txt)

**Rillet**
- [Close reports](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/close-reports)

**Campfire**
- [Docs index (API financial statements)](https://docs.campfire.ai/llms.txt) · [Get trial balance](https://docs.campfire.ai/api-reference/financial-statements/get-trial-balance.md)

**Digits**
- [Statements overview](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/financials.md) · [Help index](https://help.digits.com/llms.txt)

**Puzzle**
- [Trial balance types / downloads](https://help.puzzle.io/en/articles/14053364-overview-of-trial-balance-types-in-puzzle)

**Xero**
- [Statement of Changes in Equity (UK)](https://central.xero.com/0/article/Movements-in-Equity-New-UK) (snippet only) · [Product idea: flag RE mismatch](https://productideas.xero.com/forums/967133-reports-tax/suggestions/49118294-reporting-flag-when-actual-retained-earnings-doe) · [Owner's equity guide](https://www.xero.com/uk/guides/what-is-owners-equity/)

**QuickBooks Online**
- [Statement of owner's equity: no specific report (US, Mar 2024)](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-do-i-run-a-statement-of-owner-s-equity-our-accountant-says/00/1418643)
- [SoCE unavailable in Essentials (Feb 2022)](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/in-essential-quickbooks-online-subscription-why-cannot-i/00/1036108)
- [SoCE error, INV-111140 (Sep 2024)](https://quickbooks.intuit.com/learn-support/global/reports/why-can-t-i-get-the-quickbooks-statement-of-changes-in-equity/00/1490783) · [Something went wrong thread](https://quickbooks.intuit.com/learn-support/global/reports/how-can-i-access-my-statement-of-changes-in-equity-report-says/00/1491965)

**Accurate Online**
- [Laporan perubahan ekuitas (blog)](https://accurate.id/akuntansi/laporan-perubahan-ekuitas/) · [Laporan perubahan modal (blog)](https://accurate.id/akuntansi/pengertian-laporan-perubahan-modal/) · [Release notes v1.0.1#4776](https://accurate.id/release-notes-aol/1014776/)

**Mekari Jurnal**
- [Contoh laporan perubahan modal (menu path, export)](https://www.jurnal.id/id/blog/laporan-perubahan-modal/) · [Guidebook: laporan perubahan modal](https://www.jurnal.id/en/guidebooks/laporan-perubahan-modal) · [Format laporan keuangan menurut PSAK 201](https://www.jurnal.id/id/blog/format-laporan-keuangan-menurut-psak-201/) · [Hubungan laba rugi, perubahan modal dan neraca](https://www.jurnal.id/id/blog/hubungan-antara-laporan-laba-rugi-perubahan-modal-dan-neraca-keseimbangan/)

**Odoo**
- [eh_account_statements (third-party SoCE)](https://apps.odoo.com/apps/modules/18.0/eh_account_statements) · [Forum: SoCE report](https://www.odoo.com/forum/help-1/accounting-report-of-statement-of-changes-in-equity-104200) · [Reporting docs](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting.html)

**NetSuite**
- [Balance Sheet report](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2098310.html) · [Community: CTA and equity rollforward](https://community.oracle.com/netsuite/english/discussion/4478040/cta-and-equity-rollforward-issue) · [Community: RE in customized BS](https://community.oracle.com/netsuite/english/discussion/4481585/why-does-retained-earnings-is-different-in-a-customized-balance-sheet-report-and-the-detailed-report) · [Community: move prior NI to RE](https://community.oracle.com/netsuite/english/discussion/4473479/nsc-customize-balance-sheet-how-to-move-net-income-from-prior-periods-to-retained-earnings)

**Indonesian standards and law**
- [SAK Entitas Privat exposure draft (IAI)](https://web.iaiglobal.or.id/assets/files/file_berita/1%20DE%20SAK%20ENTITAS%20PRIVAT.pdf) · [Format laporan keuangan SAK EP (Gustani)](https://www.gustani.id/2021/07/format-laporan-keuangan-berdasarkan-sak-entitas-privat.html) · [SAK EP vs SAK ETAP (KJA Riana Sitawati)](https://www.kja-rianasitawati.com/mengenal-sak-ep-dan-perbedaannya-dengan-sak-etap/) · [Laporan laba ditahan (Wikipedia ID)](https://id.wikipedia.org/wiki/Laporan_laba_ditahan)
- [ED SAK EMKM (IAI)](https://www.iaiglobal.or.id/v03/files/draft_ed_sak_emkm_kompilasi.pdf) · [SAK EMKM (Jurnal blog)](https://www.jurnal.id/id/blog/sak-akuntansi-emkm/)
- [UU 40/2007 Perseroan Terbatas](https://peraturan.go.id/files/uu40-2007.pdf) · [Dana cadangan & dividen PT (Hukumonline)](https://www.hukumonline.com/klinik/a/rumus-menghitung-dana-cadangan-dan-pembagian-dividen-pt-lt5fae4c52e9b4c/)
- [OJK PAPSI BPRS: Laporan Perubahan Ekuitas](https://ojk.go.id/id/regulasi/Documents/Pages/SEOJK-tentang-Pedoman-Akuntansi-Perbankan-Syariah-Indonesia-bagi-Bank-Pembiayaan-Rakyat-Syariah/PAPSI%20BPRS%20-%2013%20Laporan%20Perubahan%20Ekuitas%20(131).pdf) (sector example of the format)

**Internal (Slack #all-smplwrld)**
- [23 Nov: request for Perubahan Modal screenshots + Fidya's reply](https://smplwrld.slack.com/archives/C0AQCTEUACE/p1795442501484209)
- [24 Nov: Reports (TB, P&L, BS) UI validation with Pak Hadi](https://smplwrld.slack.com/archives/C0AQCTEUACE/p1795531317716239)
- [24 Nov: Fidya on "Perubahan Modal" naming](https://smplwrld.slack.com/archives/C0AQCTEUACE/p1795493056041239?thread_ts=1795458972.907109&cid=C0AQCTEUACE)

### 9.2 Candidate screenshots (not downloaded)

| Source | Shows | Where |
|---|---|---|
| SME (Fidya, 23 Nov) | Perubahan Modal report, account-list layout (likely Jurnal) | Slack file `F0CM2MHDQ0Y` in the 23 Nov thread |
| Mekari Jurnal | Example PDF / Excel of laporan perubahan modal (images in the blog) | [jurnal.id blog](https://www.jurnal.id/id/blog/laporan-perubahan-modal/) |
| SAK EP | Laporan perubahan ekuitas and laba rugi & saldo laba illustrations (Alternatif 1 & 2) | [Gustani](https://www.gustani.id/2021/07/format-laporan-keuangan-berdasarkan-sak-entitas-privat.html) |
| DualEntry | No equity statement; the BS shell is the reference | See the TB research §9.2 |
