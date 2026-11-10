# Trial Balance — product discovery & competitor benchmark

**Status:** Draft for review · **Date:** 4 Nov 2026 · **Page:** Reports › Trial Balance (`/trial-balance`, `src/pages/TrialBalancePage.jsx`)

Benchmarked against DualEntry, Rillet, Campfire, Digits, Puzzle, Xero, QuickBooks Online, Accurate Online, Mekari Jurnal, Odoo and NetSuite. Everything is from public docs, help centres, release notes and vendor forums, read on 4 Nov 2026. See [§8 Caveats](#8-caveats-on-the-evidence) before quoting anything as fact.

---

## TL;DR

1. **Klay's TB is already ahead on close context.** Competitors don't put period status and unposted drafts/pending journals on the TB itself; Klay does, and also runs review checks (wrong-side balance, clearing not at zero, inactive with balance). Only Puzzle (anomaly detection) and NetSuite (AI "Generate Insight") have anything similar.
2. **The biggest functional gap is the adjusted TB.** DualEntry, Rillet, Puzzle and QBO Accountant all show adjusting entries apart from regular postings (as separate columns or a separate report). Indonesian auditors and textbooks expect it too: *neraca saldo setelah penyesuaian* and the *neraca lajur* worksheet. Klay has no "adjusting entry" flag on a JE, so this starts in the JE model.
3. **Layout should follow the Indonesian 6-column norm.** That means Saldo Awal Dr/Cr, Mutasi Dr/Cr and Saldo Akhir Dr/Cr, all footing. Accurate uses exactly this layout. When Odoo 19 collapsed opening and ending to net, a paid "restore Dr/Cr" add-on appeared. Klay's opening balance today is a single signed column.
4. **Excel is the real deliverable.** Auditors import the TB into audit software, and *koreksi fiskal* for SPT 1771 starts from it. Klay's TB exports CSV only, while the GL already exports XLSX. DualEntry writes live SUM formulas into subtotal rows.
5. **Slicing is the most common SMB complaint.** QBO can't filter the TB by class or location, and Xero can't split it by tracking. DualEntry, Campfire and Odoo can. Klay's GL already has dimensions; the TB doesn't use them.
6. **The COA hierarchy is unused.** Klay's chart has 25 groups across four levels, but the TB groups only by account type. Odoo's "Hierarchy and Subtotals" and Accurate's Induk/Anak akun are what local accountants expect.
7. **Variance (flux) analysis sits beside the TB, not on it, and it's tied to the close.** DualEntry, Rillet and Puzzle all have it: thresholds, AI-drafted explanations, approve status, and a "don't lock with unexplained variances" rule.

---

## Decisions since the benchmark (9–10 Nov 2026)

SME feedback from Fidya Ranita ([Slack thread](https://smplwrld.slack.com/archives/C0AQCTEUACE/p1794284892456209?thread_ts=1794237772.011189&cid=C0AQCTEUACE), 10 Nov), and what changed in the prototype:

| Topic | Decision | In the prototype |
|---|---|---|
| **Layout** | A net Opening / Ending column with credits in brackets reads as negative: Liabilities, Equity and Revenue looked "all negative". Split Opening and Ending into Debit and Credit on screen, as in the export. Answers §7 Q1. | Six columns on screen (Opening · Movement · Ending, each Dr/Cr). Compare shows each period's Ending Dr/Cr plus Change. Screen and Excel now match. |
| **Variance threshold** | Comparing with last month is right. Lower the percentage to **≥ 30%**. Use a **fixed amount set per company** (e.g. Rp 20M) rather than 1% of total debits, which came to ~Rp 900M on the sample data and let big moves through. Answers §7 Q4. | Settings › Accounting › General Settings › Preferences › **Trial Balance**: 30% and Rp 20.000.000 by default, editable; linked from the TB's Report settings menu. |
| **Adjusting entries** | The KAP (external auditor) proposes audit adjustments and the **client posts them in its own books**, so the ledger matches the audited report. Adjustments do go into Klay. Answers §7 Q3: the adjusted TB (§6 #11) moves up from P2. | An **Adjusting entry** flag on manual journals (form checkbox, "Adjusting" chip on the list and detail; a reversal keeps it). On the TB, **Adjustments: Included** (adjusted TB, default) · **Excluded** (unadjusted) · **As columns** (Unadjusted · Adjustments · Adjusted, each Dr/Cr). Four sample March 2025 adjusting journals are seeded. |

Earlier in the same review (9 Nov): no Summary/Detail tabs (the TB stays at account level, and journal lines live in the GL); the account name links to the GL for the same dates; the KPI bar was removed; only the variance and not-reconciled checks remain in Needs review; the ⓘ marker opens a popover instead of a side drawer.

**Still open:** should system period-end journals (Fixed Assets depreciation, recurring prepaid amortisation) count as adjusting entries automatically? Today only journals someone flags do. The JE PRD needs an amendment for the flag: who can set it, and whether it's limited to manual journals.

---

## 1. Who uses the TB and what for

| Who | When | Job to be done | What they need from the screen |
|---|---|---|---|
| **Staff accountant** (preparer) | Month-end close, before handing over to review | "Are the books in balance, and is anything obviously wrong before I close?" | Balance check, wrong-side/suspense flags, unposted items, drill to the offending journal |
| **Finance Manager** (reviewer) | Close sign-off | "Can I lock this month?" | Period status, what changed vs last month, explanations for big moves, sign-off |
| **External auditor / tax consultant** (KAP, konsultan pajak) | Year-end audit, SPT Tahunan | "Give me a TB I can load into my working papers." | Excel with opening / mutasi / ending, adjusted vs unadjusted, account hierarchy, company header |
| **Owner / director** | Rarely, mostly at year-end | "Sign the printed TB." | Clean print layout with signature blocks |
| **Implementer** | Onboarding | "Load opening balances from the old system and prove they tie." | TB import, then compare to the source TB at cutover |

**Key moments:** month-end close (most frequent), year-end close (closing entry to *laba ditahan*), audit fieldwork, fiscal reconciliation for SPT 1771, and migration cutover.

---

## 2. Klay today

| Area | What exists |
|---|---|
| Columns | Code, Account, **Opening** (one signed column), Period **Debit**, Period **Credit**, **Ending Dr**, **Ending Cr** |
| Period | Shared report presets plus a custom from–to range; defaults to **last month** (the month being closed) |
| Header KPIs | Total debits, Total credits, Difference (✓ In balance / Out of balance by Rp X), Needs review (count of flagged accounts) |
| Status banner | Closed / Open / Partly closed period, plus *"N drafts and N journals awaiting approval dated in this period aren't included"*, linking to the JE list |
| Review checks | Ending on the wrong side of the normal balance (equity excluded); clearing/suspense account not at zero; inactive account with a balance. Flagged rows stay visible even when zero rows are hidden. |
| Slicing | Type tabs (All / Assets / Liabilities / Equity / Revenue / Expenses), search, "Show zero balances" toggle (off by default), sort (7 options), group by Account Type or none, collapsible groups with subtotals |
| Drill-down | Row opens a drawer with **Detail · Transactions · Audit Trail · Review** tabs. Transactions link to the JE. There's a "View in General Ledger" icon per row and a button in the drawer. |
| Year-end | P&L accounts reset each fiscal year; prior years' profit is rolled into Retained Earnings' opening ("Prior-year result" row in the drawer) |
| Output | Export **CSV** (labelled "Excel (CSV)"); Print / PDF with company name, title, period and balance status |

**Internal gaps found while reading the code**

- The COA has a 4-level group hierarchy (`src/data/seed/coa.js`), but the TB groups only by `type`.
- The GL already has dimensions, FX (IDR + original amount + rate) and XLSX export (`src/lib/xlsxExport.js`). The TB has none of them, so the two reports look inconsistent side by side.
- There's no comparison period, no adjusted view, no per-account notes, no saved views, and no signature block on print.

---

## 3. Functionality benchmark

**Legend:** ✓ documented · ◐ partial / workaround / other screen · ✗ documented as missing · ? not found in public sources · *(i)* inferred

**Abbreviations:** DE = DualEntry · Ril = Rillet · Camp = Campfire · Dig = Digits · Puz = Puzzle · QBO = QuickBooks Online · Acc = Accurate Online · Jur = Mekari Jurnal · NS = NetSuite

### 3.1 Layout & period

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opening / movement / ending columns | ✓ | ◐ UI Dr/Cr; API has all | ✓ | ✓ API | ? | ? | ✗ YTD Dr/Cr | ✗ Dr/Cr only | ✓ | ✓ | ✓ | ✗ as-of |
| Dr/Cr split on opening **and** ending | ◐ ending only | ? | ? | ◐ ending net | ? | ? | — | — | ✓ 6 cols | ? | ✗ net (v19) | ✓ toggle Dr-Cr / Net |
| Date range + presets | ✓ | ✓ remembered per report | ✓ | ✓ | ✓ | ✓ | ◐ as-of; range since Jul 2026 | ✓ | ✓ | ✓ | ✓ | ◐ as-of / period |
| Comparison columns | ✗ | ◐ via custom builder | ? | ◐ cadence cols *(i)* | ? | ◐ via flux | ◐ net only, no Dr/Cr | ◐ by month; no month + YTD | ? | ? | ✓ prev period / prev year | ✗ |
| Adjusted vs unadjusted TB | ✗ | ✓ 4 modes | ✓ via adjustment books | ? | ? | ✓ separate report | ◐ Workpapers | ✓ Accountant edition | ✗ | ✗ | ✗ | ◐ post-closing TB |
| Account hierarchy + subtotals | ◐ type only | ◐ levels 1–5 in API | ? | ◐ parent field | ✓ parent roll-up (ledger) | ? | ◐ by class/type, sorted A–Z | ? | ◐ via Modifikasi | ? | ✓ Hierarchy & Subtotals | ? |
| Zero-balance toggle | ✓ hidden by default | ✓ hidden by default | ? | ✗ always omitted | ◐ activity only | ✓ (GL) | ✓ since Mar 2025 | ◐ not on Simple Start | ? | ? | ? | ✓ Show Zeroes |
| Prior-year result handling | ✓ rolled into RE opening | ✓ computed at run time | ? | ✓ synthetic row | ? | ? | ? | ? | ◐ RE bugs fixed Oct 2024 | ✓ via Tutup Buku | ✓ "Result Brought Forward" line | ✓ calculated RE |

### 3.2 Slicing

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dimension filter (dept / project / branch) | ✗ (GL has it) | ✓ classifications + pivot | ◐ entity | ✓ dept; group rows/cols by tag | ◐ ledger only | ◐ class (statements) | ◐ filter, no split (conflicting sources) | ✗ no class / location | ◐ branch (generic report filter) | ? | ✓ analytic | ◐ subsidiary / location |
| Multi-entity / consolidation | n/a V1 | ✓ elimination company | ✓ real-time | ✓ entity rollup | ? | ? | ✗ | ✗ | ◐ per branch | ◐ marketed | ◐ company | ✓ with CTA |
| Reporting currency / FX | ✗ IDR only, no FX detail | ✓ picker, stale-rate warnings | ✓ local + reporting | ✓ translated basis + warnings | ? | ? | ◐ base only | ? | ◐ currency filter | ◐ | ◐ | ✓ CTA |
| Cash / accrual basis | ✗ accrual | ? | ? | ✗ accrual only | ? | ✓ two ledgers | ✓ hidden under "More" | ✓ | ? | ? | ✓ | ? |

### 3.3 Review, drill-down & close

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Drill TB → ledger → JE → source | ✓ drawer + GL | ✓ Summary → Detail (column picker) → record in new tab | ◐ marketing claim | ✓ cell → Transactions *(i)* | ✓ | ✓ | ? | ◐ loses opening balance | ✓ | ? | ✓ + annotate | ✓ |
| Balance / footing check visible | ✓ Difference KPI + footer | ◐ docs say check it manually | ? | ✓ enforced by API | ? | ? | ? | ◐ staff advice only | ✗ "posting blocks it" | ✓ in Tutup Buku | ✓ by construction | ◐ CTA absorbs it |
| Balance-level anomaly flags | ✓ 3 checks | ✗ transactions only | ✗ | ? | ✗ | ✓ incl. clearing / suspense open | ✗ | ◐ Books review (Accountant) | ✗ | ✗ | ✗ | ✓ AI Generate Insight |
| Flux / variance with explanations | ✗ | ✓ separate report, AI drafts, required-explanation rule | ✓ AI draft → Approved | ◐ marketing | ✗ | ✓ 5% / $1k default, confidence | ✗ | ◐ Workpapers YoY | ◐ AI report analysis | ✗ | ✗ | ◐ AI narrative |
| Per-account notes / sign-off | ✗ | ◐ in flux drawer | ◐ in flux | ? | ✗ | ◐ close notes carry forward | ◐ Workpapers notes | ◐ Workpapers notes + files | ✗ | ✗ | ✓ annotate | ✗ |
| Period status on the TB | ✓ closed / open / partly + unposted count | ✗ locks elsewhere | ✗ | ? | ◐ lock + Propose Edit | ◐ locked → next open period | ◐ lock dates | ◐ closing date | ✗ | ✓ TB is step 2 of Tutup Buku | ◐ include-drafts toggle | ◐ close checklist |
| Recon status on the TB | ✗ | ✗ separate dashboard | ✗ | ✗ | ✗ | ◐ recon task per account | ✗ | ✗ | ✗ | ◐ pre-close check | ✗ | ✗ |

### 3.4 Output

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Excel (.xlsx) | ✗ CSV | ✓ live SUM formulas | ✓ | ✓ exact view | ✓ in package | ✓ | ✓ + Google Sheets | ✓ | ✓ | ✓ | ✓ | ◐ XLS |
| PDF / print | ✓ | ✓ | ? | ? | ✓ | ✓ | ✓ | ✓ | ✓ + signatures | ✓ | ✓ | ✓ |
| Saved views | ✗ | ✓ custom reports | ? | ✓ | ✗ | ✗ | ✓ custom reports | ✓ Save As | ✓ Memorize | ? | ✓ Save | ✓ |
| Scheduled / packaged | ✗ | ✓ Report Packages | ? | ? | ✓ Financial Package | ✗ | ? | ◐ email | ? | ? | ◐ store to Documents | ✓ |
| TB as import format | ? | ? | ? | ? | ✓ opening TB upload | ? | ? | ? | ? | ◐ opening balance equity | ? | ? |

---

## 4. Vendor notes (UX and the ideas worth taking)

### DualEntry — closest peer, deepest docs
- Reports › Report Center › Accounting, with **Summary** and **Detail** tabs on one report. Clicking an account in Summary opens Detail filtered to it. Detail has a column picker (FX rate, transaction-currency amount, classification, customer/vendor, running balance), and the record number opens the JE or bill in a new tab.
- **Adjusting entries have four modes** on every report: *Excluded* (default, i.e. unadjusted), *Mixed into period*, *Additional period* (a separate Adjusting column before the total) and *Only*. One flag on the JE gives you both an unadjusted and an adjusted TB.
- **Customize** turns the TB into a custom-report base with Date, Budget, Variance and Formula columns. That's how comparisons happen; the standard TB has none.
- Filters: company multi-select, account range, classifications (dimensions), search. Consolidation means selecting the parent, its children and an auto-created elimination company. A reporting-currency picker warns about stale rates.
- **Integrity is a documented practice, not a feature.** The docs say to check that debits equal credits and that the TB ties to the BS and IS under the same filters. Separate reports exist for date/period mismatch and a CTA audit.
- **Flux is a separate report** (IS: MoM / QoQ / YTD vs prior YTD; BS: MoM). Thresholds can be set by amount and/or %, with a "require explanation" option, AI-drafted explanations and a permanent activity log. Finishing it completes a close-checklist task: *"Do not lock the period with unexplained flagged variances outstanding."*
- Export to Excel / PDF / CSV runs as a background job, and Excel subtotals are live `SUM` formulas. Scheduling exists only through Report Packages (monthly close package includes a TB; audit package includes a detailed TB).
- **UX claims** (marketing): "<200ms response time", "one-click drill downs".
- **Not there:** period-lock status on the TB, balance-level anomaly scanning ("account balances are not scanned on their own"), recon status.

### Rillet
- Reporting › Close Reports › Trial Balance: Beginning, Debit, Credit, Ending; loads on date pick.
- **Adjustment-only books** (IFRS / statutory / tax / audit, up to 4). With a book selected, the TB becomes *Adjusted Beginning · Dr · Cr · Dr Adjustments · Cr Adjustments · Adjusted Ending*. It's the only report where adjustments get their own columns. This is the cleanest public layout for an adjusted TB.
- Flux lives under Close Management: Variance, % Change, Materiality, Explanation, Status (AI Draft → Approved), Assignee. Approved explanations carry into future periods.

### Campfire
- The help centre is behind a login, so the TB is known from the API only. It's a full rollforward (beginning, gross Dr/Cr activity, ending, net movement). **Footing is part of the contract:** beginning and ending each sum to zero, and period Dr equals Cr; the API refuses to return an unbalanced TB.
- A "Net Income (Prior Periods)" synthetic row appears when the P&L window is the period rather than fiscal YTD. That's a neat way to keep the TB balanced over any range.
- Other reports have saved views, Group Rows By (account / department / tag) and Group Columns By (entity / department / currency), plus cell-click to pre-filtered transactions. The TB likely has the same *(i)*.

### Digits
- There's no TB screen. It's a download inside the Financial Package (XLSX), and the on-screen equivalent is the Ledger category view (hierarchy, parent roll-ups, activity-only).
- **Locked periods with "Propose Edit"**: non-approvers and AI agents propose changes in a locked period, and approvers review a queue. Relevant to Klay's reviewer model.
- The TB is also the **migration format**: upload the old system's TB dated the day before the start date.

### Puzzle
- The TB is on the Downloads page in two types: **cumulative** and **adjusted**. Cash and accrual run as two parallel ledgers.
- **Anomaly detection** includes *suspense or clearing accounts still open at period end*, which matches Klay's clearing check. It also flags round-amount JEs over $5k with no reference, posts outside business hours, and reversals within 3 days.
- **Flux** defaults to a >5% or >$1,000 change, shows the transactions driving it and a confidence rating, and can be scheduled monthly.

### Xero
- The TB isn't a default report; users have to star it per organisation (37 votes, still "submitted"). It's as-at with YTD Dr/Cr; a date-range version only went global in Jul 2026.
- Comparison periods collapse to one net column. Grouping by account type sorts **alphabetically** (a complaint). Zero balances were hidden for 11 years before a toggle shipped (Mar 2025). Cash/accrual sits under "More".
- Opening / movement / closing columns are still an open request ("Gaining Support"), so auditors rebuild the TB in Excel.

### QuickBooks Online
- Reports › For my accountant. Dr/Cr only, with no opening or closing columns (confirmed by Intuit staff). Columns can be split by month, but not month + YTD.
- No class or location filter. Drill-down loses the opening balance.
- The **Accountant edition** has an Adjusted TB (before / adjustments / after, from an "Is Adjusting Journal Entry?" flag) and a Workpapers TB with YoY change, + to adjust, and per-account notes and attachments.

### Accurate Online — the local reference
- Daftar Laporan › Buku Besar › **Neraca Percobaan**. The columns are the **6-column Indonesian layout**: Saldo Awal Dr/Kr, Perubahan Dr/Kr, Saldo Akhir Dr/Kr.
- **Footer totals are off by default**; a partner tutorial explains how to add them via *Modifikasi*. **Memorize** saves report formats. Signatures on reports and e-Meterai (VIDA) are supported.
- Accurate argues a balance check is "largely unnecessary" because posting blocks unbalanced journals. That holds until opening balances or retained earnings break: Oct 2024 release notes fix wrong *laba ditahan* balances on the TB.

### Mekari Jurnal
- Laporan › Sekilas Bisnis › **Neraca Saldo**: saldo awal, pergerakan, saldo akhir, over a date range.
- **The TB is step 2 of the "Tutup Buku" wizard**: check pending recon, stock count and depreciation → review the TB → enter tax expense → choose the *laba ditahan* account → confirm and lock. This is the clearest local example of a TB built into the close.

### Odoo
- Accounting › Reporting › Trial Balance. Comparison (previous period, same period last year), analytic filters, include-drafts toggle, cash basis, **Hierarchy & Subtotals** (groups derived from code prefixes), units / thousands / millions, save filters, **annotate lines**.
- Odoo 19 changed opening and ending to a single net column, and a paid add-on to **restore the Dr/Cr split** appeared on the app store. That's evidence users want the split.
- Year-end: a dynamic **"Result Brought Forward"** line until the appropriation entry posts.

### NetSuite
- As-of TB with a **Column** switch between Debit/Credit and Total (net). The **Post-Closing TB** includes period-end journals and should sum to zero.
- Consolidated TBs add a CTA line. Role-restricted users can see an imbalance pushed into CTA, which is a cautionary tale about silent plugs.
- **Generate Insight**: an AI narrative on the TB that flags unusual postings.

---

## 5. Patterns across the market

1. **Rollforward columns are table stakes, except in the two biggest SMB tools.** QBO and Xero draw years of complaints for lacking them. Indonesian accountants expect all six columns split Dr/Cr and footing.
2. **Adjusted TB = one flag on the journal + a view mode.** No one models it as a separate set of books for SMEs (Rillet's books are for IFRS / tax / statutory). DualEntry's four modes and Rillet's column layout are the best references.
3. **Flux / variance is a close artefact, not a TB column.** It always has thresholds, explanations (often AI-drafted), approval status, and a link to the close checklist or lock.
4. **Drill-down must keep context.** Same period, same filters, same opening balance. QBO's lost opening balance is the anti-pattern.
5. **Silent plugs destroy trust.** NetSuite's CTA absorption and Accurate's retained-earnings bugs show it. A TB that names *why* it's out of balance (opening balances, FX, role restriction) is better than one that quietly forces balance.
6. **Close context on the TB is rare.** Only Jurnal (inside Tutup Buku) and Odoo (drafts toggle) come close. Klay's status banner and unposted count are a real differentiator worth keeping and extending. Nobody shows recon status on the TB.

---

## 6. Opportunities for Klay (draft priorities)

Ranked by value to the close and the audit hand-off, against effort. *Reuse* means the building block already exists elsewhere in Klay.

### P0 — small, high value, mostly reuse

| # | Opportunity | Why | Notes |
|---|---|---|---|
| 1 | **Real Excel (.xlsx) export** with live `SUM` subtotals, company header and period | Auditors and koreksi fiskal start from Excel; the GL already does XLSX | Reuse `src/lib/xlsxExport.js`. Keep CSV as a secondary option. |
| 2 | **6-column layout**: split Opening into Dr / Cr (Saldo Awal · Mutasi · Saldo Akhir) | Indonesian norm (Accurate); Odoo users paid to get it back | Optionally add NetSuite-style **Dr/Cr ↔ Net** toggle for a compact view |
| 3 | **Group by COA hierarchy** (in addition to Account Type) with level subtotals and expand/collapse all | The 4-level chart exists but isn't used; Odoo and Accurate show it | Add a "Group: COA hierarchy" option to the existing Group popover |
| 4 | **Dimension filter** | Top SMB complaint (QBO / Xero); the GL already has dimensions | Reuse GL's dimension data. Filtering only in V1; split-by-dimension columns later. |
| 5 | **Print sign-off block** (Disiapkan oleh / Diperiksa oleh / Disetujui oleh) | Owners and auditors sign printed TBs; Accurate supports signatures | Print CSS only |

### P1 — medium, strengthens the close

| # | Opportunity | Why | Notes |
|---|---|---|---|
| 6 | **Comparison period** (previous period / same period last year) with Δ and Δ% | Every reviewer asks "what moved?"; Odoo has it natively | Keep the Dr/Cr split on comparisons (Xero's net-only comparison draws complaints) |
| 7 | **Variance flag in Needs review**: account moved > X% **and** > Rp Y vs comparison | A light version of flux that fits Klay's existing review checks | Puzzle defaults to 5% / $1k; Klay needs IDR defaults (SME to set) |
| 8 | **Recon status per cash/bank account** ("Reconciled through Sep 2026" / "Not reconciled") | No competitor shows it on the TB; Klay has Bank and Non-Bank recon | Could also be a review check: GL balance ≠ last reconciled balance |
| 9 | **More footing checks**: TB ties to Balance Sheet and P&L for the same period, plus RE roll-forward check | DualEntry's documented practice; Accurate's RE bugs | Show as review checks with a plain-language cause |
| 10 | **Saved views** (period, grouping, filters, columns) | DualEntry, Campfire, Odoo, Accurate (Memorize), QBO | Per user |

### P2 — larger, needs a PRD decision first

| # | Opportunity | Why | Dependency |
|---|---|---|---|
| 11 | **Adjusted TB**: an "Adjusting entry" flag on manual JEs plus a view mode (Unadjusted / Adjustments as columns / Adjusted / Adjustments only) | Audit and tax use, local textbook stages, DualEntry and Rillet | Needs a JE field and a JE PRD amendment; decide who can flag |
| 12 | **Per-account notes and reviewer sign-off**, tied to the period close (block the lock while flagged accounts are unexplained) | DualEntry / Rillet flux plus close rules; Workpapers in Xero / QBO | Close checklist design; reviewer ≠ preparer, as in recon |
| 13 | **AI-drafted variance explanations** (draft → approve, carried forward) | DualEntry, Rillet, Puzzle | Klay AI isn't in MVP (JE decision 19) |
| 14 | **FX detail for foreign-currency accounts** (original-currency balance + rate beside IDR) | Matches the GL decision (Accurate-style) | Only accounts like *Bank — BCA USD* |
| 15 | **Neraca lajur (worksheet) export**: NS · Penyesuaian · NSSP · Laba Rugi · Neraca | Local auditors and textbooks | Depends on #11 |
| 16 | **Opening TB import** for migration, with a cutover tie-out | Digits; onboarding | Onboarding scope |

### Not now
- **Multi-entity consolidation, eliminations, CTA.** Klay V1 is single-entity.
- **Cash basis.** SAK EMKM and PSAK are accrual; there's no local demand signal.
- **Scheduled report packages.** Revisit once saved views exist.

---

## 7. Open questions (for Fidya / SME)

1. **Layout:** is the 6-column layout (opening split Dr/Cr) what auditors expect from Klay, or is a net opening column fine as long as Excel has the split?
2. **Labels:** English UI with Bahasa print/Excel headers, or Bahasa throughout? *Neraca Saldo* or *Neraca Percobaan*?
3. **Adjusting entries:** do Indonesian SMEs actually record audit adjustments (*jurnal penyesuaian*) in their own system, or does the KAP keep them in working papers? This decides whether #11 is P1 or P2.
4. **Variance thresholds:** what default materiality in IDR (and %) would a reviewer expect?
5. **Recon status:** useful on the TB, or only on the close checklist?
6. **Foreign-currency accounts:** should the TB show the original-currency balance, or only the GL?
7. **Signatures:** which roles go on the printed TB, and is e-Meterai ever needed for it?
8. **Default period:** keep "last month", or open on the current month once the previous one is closed?

---

## 8. Caveats on the evidence

- **Blocked sources:** Accurate's and Jurnal's help centres returned 403, and Xero Central showed a CAPTCHA (not bypassed). Claims for those three come from release notes, vendor blogs, partner tutorials, product-ideas forums and search snippets.
- **Campfire:** the help centre is behind a login; TB facts come from its API reference and an archived Income Statement article.
- **Rillet:** the main docs index returns 401; one space-scoped index loaded and has no dedicated TB page.
- **Reddit:** not searchable with the research tools, so pain points come from the Xero and Intuit forums.
- **Pages read by a summarising model:** exact UI labels should be checked against the linked page before they go into a PRD.
- **Prompt-injection on a Digits page:** one Digits help page (`firms-getting-started/parallel-close.md`) contained embedded "agent instructions". They were ignored and nothing from that page is used here.
- **No screenshots saved yet.** Candidate image URLs are listed in §9.2. Downloading them into `docs/research/trial-balance/<vendor>/`, like the JE research, needs a go-ahead.

---

## 9. Sources

### 9.1 Articles

**DualEntry**
- [Run financial statements](https://docs.dualentry.com/accountants/reporting-analytics/run-financial-statements.md) · [Standard financial statements](https://docs.dualentry.com/accountants/reporting-analytics/standard-financial-statements.md) · [Custom report builder](https://docs.dualentry.com/accountants/reporting-analytics/custom-report-builder.md)
- [Adjusting entries](https://docs.dualentry.com/accountants/core-financials/general-ledger/adjusting-entries.md) · [General ledger](https://docs.dualentry.com/accountants/core-financials/general-ledger/index.md)
- [Multi-entity consolidation](https://docs.dualentry.com/accountants/platform-configuration/multi-entity-consolidation.md) · [Multi-currency reporting](https://docs.dualentry.com/accountants/reporting-analytics/multi-currency-reporting.md)
- [Flux reporting](https://docs.dualentry.com/accountants/reporting-analytics/flux-reporting.md) · [Flux analysis (close)](https://docs.dualentry.com/accountants/core-financials/close-management/flux-analysis.md) · [Anomaly detection](https://docs.dualentry.com/accountants/ai-automation/anomaly-detection/anomaly-detection.md)
- [Period locking](https://docs.dualentry.com/accountants/core-financials/close-management/period-locking.md) · [Reconciliation](https://docs.dualentry.com/accountants/core-financials/close-management/reconciliation.md) · [Exporting & report groups](https://docs.dualentry.com/accountants/reporting-analytics/exporting-and-report-groups.md)
- API: [Trial balance facts](https://docs.dualentry.com/developers/api/resources-v2/reporting/list-trial-balance-facts.md) · [Account balances](https://docs.dualentry.com/developers/api/resources-v3-alpha/reporting/list-account-balances.md)
- Marketing: [General ledger software](https://www.dualentry.com/core-financials/general-ledger-software)

**Rillet**
- [Close reports](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/close-reports) · [Multi-book (adjustment-only)](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/multi-book-accounting-adjustment-only.md) · [Consolidated statements](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/multi-entity/consolidation/consolidated-financial-statements.md)
- [Flux analysis](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/close-management/flux-analysis/use-flux-analysis-to-review-account-variances.md) · [Close the books](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/general-accounting/close-the-books.md)

**Campfire**
- [Get trial balance (API)](https://docs.campfire.ai/api-reference/financial-statements/get-trial-balance.md) · [Apideck gotchas](https://developers.apideck.com/apis/accounting/campfire/gotchas) · [Income statement (archived help)](https://help.meetcampfire.com/articles/7558507962-income-statement) · [Changelog](https://campfire.ai/changelog)

**Digits**
- [Download financials](https://help.digits.com/firms-insights-and-reporting/download-financials.md) · [Navigating the ledger](https://help.digits.com/firms-agentic-general-ledger/navigating-ledger.md) · [Close date / locked periods](https://help.digits.com/firms-agentic-general-ledger/close-date.md) · [Migrate to Digits](https://help.digits.com/firms-getting-started/migrate-to-digits.md) · [Changelog](https://help.digits.com/changelog/changleog.md)

**Puzzle**
- [Trial balance types](https://help.puzzle.io/en/articles/14053364-overview-of-trial-balance-types-in-puzzle) · [General ledger](https://help.puzzle.io/en/articles/10246130-general-ledger-in-puzzle) · [Flux analysis](https://help.puzzle.io/en/articles/17631358-flux-analysis-in-puzzle) · [Anomaly & fraud detection](https://help.puzzle.io/en/articles/17631360-anomaly-and-fraud-detection-in-puzzle) · [AI Close](https://help.puzzle.io/en/articles/15138987-month-end-close-with-ai-close)

**Xero**
- [Trial Balance report (new)](https://central.xero.com/0/article/Trial-Balance-report-new-version) (snippet)
- Product ideas: [TB as default report](https://productideas.xero.com/forums/967133-reports-tax/suggestions/51679501-make-the-trial-balance-a-default-report-under-repo) · [Date range](https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/44960458-trial-balance-ability-to-run-for-a-date-range) · [Zero balances](https://productideas.xero.com/forums/967133-reports-tax/suggestions/47048140-reporting-option-to-include-zero-balance-account) · [Account type ordering](https://productideas.xero.com/forums/967133-reports-tax/suggestions/45507637-reporting-change-ordering-of-account-type-on-tri) · [Compare tracking](https://productideas.xero.com/forums/967133-reports-tax/suggestions/49631726-trial-balance-compare-tracking) · [Workpapers review](https://productideas.xero.com/forums/966648-new-xero-workpapers/suggestions/51227875-workpapers-working-trial-balance-enable-review)

**QuickBooks Online**
- [Run reports](https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/run-reports-quickbooks-online/L7aILHhbl_US_en_US) · [Adjusting journal entries](https://quickbooks.intuit.com/learn-support/en-us/help-article/accountant-reports/make-adjusting-journal-entries-quickbooks-online/L1IvjNses_US_en_US) · [Workpapers TB view](https://quickbooks.intuit.com/learn-support/en-ca/help-article/trial-balance/using-qboa-workpapers-trial-balance-view/L7az39QR4_CA_en_CA) · [Close books](https://quickbooks.intuit.com/learn-support/en-us/help-article/close-books/close-books-quickbooks-online/L59LelyPM_US_en_US)
- Community: [No opening/closing columns](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-do-i-get-detailed-trial-balance-with-opening-closing/00/788991) · [No class filter](https://quickbooks.intuit.com/learn-support/en-us/account-management/how-do-i-create-a-trial-balance-report-filtered-by-class/00/1387646) · [Drill-down loses opening](https://quickbooks.intuit.com/learn-support/en-uk/reports-and-accounting/when-drilling-down-to-a-category-form-the-trail-balance-report/00/1607821)

**Accurate Online**
- [Release note: TB added (2019)](https://accurate.id/release-notes-aol/1006411/) · [Release note: RE fixes (Oct 2024)](https://accurate.id/release-notes-aol/1012083/) · [Laporan keuangan features](https://accurate.id/online/fitur/laporan-keuangan/) · [Neraca percobaan (blog)](https://accurate.id/akuntansi/neraca-percobaan/)
- [Partner tutorial: TB totals](https://ultimasolusindo.com/menampilkan-nilai-total-pada-laporan-neraca-percobaan/) · [Modifikasi neraca](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/daftar-laporan/modif-neraca/)

**Mekari Jurnal**
- [Cara membuat neraca saldo](https://www.jurnal.id/id/blog/cara-membuat-neraca-saldo-dengan-mudah/) · [Help: Neraca Saldo](https://help-center.jurnal.id/hc/id/articles/5320366887449-Bagaimana-Cara-Membuat-Laporan-Neraca-Saldo) (snippet) · [Tutup buku](https://www.jurnal.id/id/blog/tutup-pembukuan-anda-buka-catatan-keuangan-baru/) · [Neraca lajur](https://www.jurnal.id/id/blog/neraca-lajur-beserta-contohnya/)

**Odoo**
- [Reporting (comparison, annotate)](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting.html) · [Year-end (v19)](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting/year_end.html) · [Chart of accounts / groups](https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/chart_of_accounts.html) · [TB Dr/Cr restore app](https://apps.odoo.com/apps/modules/19.0/trial_balance_restore) · [Cybrosys: TB in Odoo 19](https://www.cybrosys.com/blog/how-the-trial-balance-report-in-odoo-19-ensures-accurate-financial-records)

**NetSuite**
- [Trial Balance](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1520986.html) · [Post-closing TB](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531245926.html) · [Period end journals](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1531269686.html) · [Generate Insight](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0217075051.html)

**Indonesian practice**
- [Rekonsiliasi fiskal (Pajakku)](https://pajakku.com/artikel/isi-rekonsiliasi-fiskal-laporan-keuangan-badan) · [Working trial balance in audit (UMN thesis)](https://kc.umn.ac.id/3573/3/BAB%20III.pdf)

### 9.2 Candidate screenshots (not downloaded)

| Vendor | Shows | URL |
|---|---|---|
| Rillet | Trial Balance report | [gitbook image](https://612265232-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FNpXFVFZpTQck3vIrjmHB%2Fuploads%2FyDw1WwJJpVnl9WgRYe92%2Fimage.png?alt=media&token=50076002-8b69-452f-a801-328e0699a089) |
| DualEntry | Flux analysis (no public TB image) | [webflow image](https://cdn.prod.website-files.com/66bf861737ab5a556a15c52b/69f475e5bd2db2cbb464191e_5ee089451fd150b6aa9fa5d7bf15cde0_rep-tab-2.avif) |
| Digits | Ledger category view (nearest to a TB) | [gitbook image](https://931519193-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FuIztBwoMl2RW5oGzS0cZ%2Fuploads%2FzBWOMesUub3vrOudAjKj%2FCursor_and_Michelle_s_Demo_Clie%E2%80%A6___Ledger.png?alt=media&token=1e4ca909-fc20-4e13-88e8-b4c703a1ab66) |
| Puzzle | Downloads page | [intercom image](https://downloads.intercomcdn.com/i/o/abwgbkbf/1775907083/89a4a665cb8d32a4b88fa4aa678f/image.png) |
| Accurate | Neraca Percobaan report / parameters / Modifikasi (partner site) | [report](https://ultimasolusindo.com/wp-content/uploads/2022/07/Screenshot_2025-09-15-14-26-22-495_com.android.chrome-edit-800x408.jpg) · [parameters](https://ultimasolusindo.com/wp-content/uploads/2022/07/Screenshot_2025-09-15-14-31-15-106_com.android.chrome-edit-800x380.jpg) · [Modifikasi](https://ultimasolusindo.com/wp-content/uploads/2022/07/Screenshot_2025-09-15-14-35-26-699_com.android.chrome-edit-800x410.jpg) |
| Jurnal | Neraca saldo template thumbnail | [webp](https://www.jurnal.id/wp-content/uploads/2024/11/template-neraca-saldo-mekari-jurnal-392x211.webp) |
| Odoo | Comparison · annotate · Dr/Cr before/after | [comparison](https://www.odoo.com/documentation/18.0/_images/reporting-comparison.png) · [annotate](https://www.odoo.com/documentation/18.0/_images/reporting-annotate.png) · [Cybrosys v19 TB](https://www.images.cybrosys.com/images/odoo-books/odoo-19-accounting/financial-reporting/financial-reporting-9.png) |
