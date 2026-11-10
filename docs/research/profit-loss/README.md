# Profit & Loss — product discovery & competitor benchmark

**Status:** Draft for review · **Date:** 4 Nov 2026 · **Page:** Reports › Profit & Loss (`/reports/profit-loss`, `src/pages/ProfitLossPage.jsx`, `src/lib/profitLoss.js`)

Benchmarked against DualEntry, Rillet, Campfire, Digits, Puzzle, Xero, QuickBooks Online, Accurate Online, Mekari Jurnal, Odoo and NetSuite. Everything comes from public docs, help centres, release notes and vendor forums, read on 4 Nov 2026. See [§8 Caveats](#8-caveats-on-the-evidence) before quoting anything as fact. Companion to the [Trial Balance research](../trial-balance/README.md).

> **Updated 10 Nov 2026 after the TB SME review** (see the TB doc's *Decisions since the benchmark*):
> - The variance rule is now **≥ 30% and ≥ a fixed Rp amount set per company** (default Rp 20.000.000, `varianceThreshold` in Accounting settings). It replaces ≥50% and ≥1% of total debits in §6 #7 and §7 Q8.
> - Manual journals now carry an **Adjusting entry** flag, so the P&L could offer the same *Adjustments: Included / Excluded / As columns* choice as the TB (§6 #10a).
> - The TB dropped its KPI bar; the P&L keeps its margin KPIs for now (§7 Q10).
>
> Nothing on the P&L page itself has changed since 4 Nov.

---

## TL;DR

1. **Klay's statement shape is already right for Indonesia.** It's a multi-step P&L (Net revenue → Gross profit → Operating profit → Profit before tax → Net profit) with margin KPIs, % of revenue, Final/Preliminary status and an unposted-journal count. That matches Accurate's *Laba/Rugi Standar* and beats Digits and Puzzle on close context.
2. **The biggest gap is columns, not rows.** Every serious competitor puts more than one number per line:
   - **monthly trend columns:** Accurate *Multi Periode*, Jurnal *This year (monthly)* with up to 11 prior periods, Digits up to 36 months, QBO by month or quarter
   - **same period last year** (all but Puzzle)
   - **budget vs actual** (all the local tools, DualEntry, Rillet, Xero, QBO, Odoo, NetSuite)

   Klay offers only "previous period".
3. **P&L by department / project / branch is expected locally.** Accurate ships department and project P&Ls with a *Non-Departemen* bucket, so the columns always add up to the total. Jurnal filters by up to 5 tags. Klay already has dimensions on every line (the GL and TB use them), but the P&L ignores them.
4. **Fiscal correction is an open gap nobody fills.** Under Coretax (PER-11/PJ/2025), SPT 1771 Lampiran 1A–1L needs positive and negative corrections **per P&L account**, with codes FPO-01..12 (positive) and FNE-01..04 (negative). None of the 11 tools does this in the product; Jurnal only links out to Klikpajak. Commercial · Correction (+) · Correction (−) · Fiscal columns on Klay's P&L would be a real differentiator.
5. **Variance review is moving onto the statement itself.** Examples:
   - QBO puts an insights count in the header and a sparkle on each flagged line.
   - Digits has a hover card with top vendors and top transactions.
   - DualEntry and Rillet have flux with thresholds, AI-drafted explanations, an approval status, and a "don't lock with unexplained variances" rule.

   Klay shows a change column only.
6. **Excel with live formulas and saved layouts are table stakes.** DualEntry and Rillet keep formulas in the export. Xero, Accurate (*Memorize*) and Jurnal (templates) all save layouts. Klay exports CSV and saves nothing. Both were just built for the TB, so they can be reused.
7. **Report packs come next.** Digits (Draft → Final versions, cover page, scheduled email), DualEntry (packages emailed to the board or investors) and QBO (management reports) bundle the P&L with other statements. Indonesian SMEs send these to owners and banks.

---

## 1. Who uses the P&L and what for

| Who | When | Job to be done | What they need from the screen |
|---|---|---|---|
| **Owner / director** | Monthly, and before bank or investor meetings | "Are we making money, and is it better than last month and last year?" | Net profit and margins at a glance, trend by month, same period last year, a clean PDF |
| **Finance Manager** | Month-end close, management report | "Explain what moved and whether we're on budget." | Comparison and budget columns, variance flags with explanations, by department/project, Final vs Preliminary |
| **Staff accountant** | Before close | "Is anything misposted, missing or doubled?" | Drill from a line to its journals, unusual moves, unposted drafts and pending journals |
| **Department / project head** | Monthly | "What did my unit spend and earn?" | P&L filtered or split by department, project or branch, with untagged items visible |
| **Tax consultant** (konsultan pajak) | Year-end SPT 1771, monthly PPh | "Turn the commercial P&L into taxable income." | Excel by account, a fiscal correction per account with Coretax codes, revenue for PPh final |
| **Bank / investor** (external) | Loan reviews, annual statements | "Show me audited-style figures." | Comparative prior-year column, SAK EP / EMKM presentation, signed print |

**Key moments:** month-end close and the management report (most frequent), budget reviews, year-end statements (with comparatives), SPT 1771 fiscal reconciliation, and loan applications.

---

## 2. Klay today

| Area | What exists |
|---|---|
| Structure | Revenue · Less returns & discounts · **Net revenue** · COGS · **Gross profit** (margin) · Selling + G&A · **Operating profit** · Other income · Other expenses · **Profit before tax** · Income tax · **Net profit**. Built from each account's `section` and `type`, not the COA tree. |
| KPIs | Net revenue, Gross profit, Operating profit, Net profit, each with a margin or vs-prior subtitle |
| Period | Shared presets plus custom from–to; **defaults to year to date** (the TB defaults to last month) |
| Columns | Amount · optional **% of revenue** · optional comparison (**previous period only**) with Change Rp and Change % |
| Rows | Sections expand to their accounts; "Show zero balances" toggle |
| Drill-down | Clicking an amount opens the General Ledger for that account and month. There's no in-page transaction view. |
| Status | Final / Preliminary pill (from the close lock), plus "N draft or pending journals dated in the period are not included", linking to the JE list |
| Integrity | Net profit is checked against the sum of all P&L accounts, the same rule the TB uses; a banner shows if they differ |
| Output | CSV (labelled Excel) with the comparison columns; Print / PDF with company header and Final/Preliminary |

**Gaps found in the code:**
- No same-period-last-year compare and no multi-period columns.
- No budget data anywhere in the app.
- No dimension filter or columns, even though every journal line carries dimensions.
- CSV only, no saved views, no line notes, no variance flags, no signature block.

---

## 3. Functionality benchmark

**Legend:** ✓ documented · ◐ partial / workaround / other screen · ✗ documented as missing · ? not found in public sources · *(i)* inferred

**Abbreviations:** DE = DualEntry · Ril = Rillet · Camp = Campfire · Dig = Digits · Puz = Puzzle · QBO = QuickBooks Online · Acc = Accurate Online · Jur = Mekari Jurnal · NS = NetSuite

### 3.1 Structure, period & columns

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Multi-step statement (gross, operating, PBT, net) | ✓ | ✓ from account types | ◐ default R/C/E/NI; Executive P&L multi-step | ✓ | ? | ◐ Rev/COR/OpEx/NI | ◐ by account type | ◐ fixed by COA order | ✓ Laba/Rugi Standar | ✓ | ✓ | ✓ formula rows |
| Layout customisation (groups, formula rows) | ✗ | ◐ builder (Beta) | ✓ layout editor | ✗ | ✗ | ✗ | ✓ layout editor, % rows (Sep 2025) | ✗ no custom subtotals | ✓ Modifikasi + Memorize | ✓ templates, set default | ✓ report engine (dev mode) | ✓ Financial Report Builder |
| EBITDA view | ✗ | ✓ via account tags | ◐ formula rows | ? | ? | ? | ◐ formula rows | ? | ? | ◐ EBIT margin in email | ? | ? |
| Monthly / quarterly trend columns | ✗ | ◐ date pivot | ✓ M / Q / Y | ✓ fiscal or calendar | ✓ up to 36 months | ? | ◐ previous periods | ✓ days → quarters | ✓ Multi Periode | ✓ "This year (monthly)" | ✓ up to 12 comparisons | ✓ column by period |
| Previous period compare | ✓ | ✓ | ◐ Total column only | ◐ API | ✓ MoM | ? | ✓ | ✓ | ✓ Perbandingan Periode | ✓ up to 11 | ✓ | ✓ Comparative IS |
| Same period last year | ✗ | ✓ PY month / PY YTD (Nov 2026) | ✓ | ? | ✓ YoY | ? | ✓ | ✓ | ? | ✓ | ✓ | ✓ default comparative |
| Budget vs actual | ✗ no budgets | ✓ Budget view, $/% variance | ✓ BvA, 2 versions, favourable colour | ◐ API `budget_id` | ✗ via integration | ? | ◐ separate report; layout mismatch | ✓ Plus/Advanced, one budget | ✓ Perbandingan Anggaran | ✓ Laporan Anggaran Laba Rugi | ✓ Budget button in report | ✓ BvA, % of budget |
| % of revenue / margins | ✓ % toggle + margin KPIs | ◐ formula column | ◐ % format rows | ? | ✓ % of income | ? | ✓ GP% / NP% rows | ✓ % of income | ? | ◐ Ringkasan Bisnis | ? | ✓ % of income |

### 3.2 Slicing

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dimension filter | ✗ (lines carry dims) | ✓ classifications | ✓ | ✓ chips | ✓ department | ◐ Complete plan | ✓ tracking | ✓ class / location | ✓ dept, project, branch, category | ✓ up to 5 tags (Pro) | ✓ analytic | ✓ |
| Dimensions as columns (P&L by dept) | ✗ | ✓ pivot, 3 levels *(i)* | ✓ breakdown columns | ✓ Group Columns By | ◐ up to 6 | ? | ◐ up to 200, not with periods | ✓ P&L by Class | ✓ Laba/Rugi Departemen / Proyek + Non-Departemen | ? | ◐ horizontal groups | ✓ column by dept / class / location |
| Multi-entity / consolidation | n/a V1 | ✓ elimination company | ✓ real-time | ✓ entity rollup | ? | ? | ✗ | ✗ | ✗ | ◐ marketed | ✓ horizontal groups | ✓ weighted average |
| Reporting currency / FX | ✗ IDR only | ✓ average rate, dual-currency view | ✓ local + reporting | ✓ entity currency | ? | ? | ? | ? | ◐ currency filter | ◐ realised / unrealised FX reports | ✓ average rate | ✓ |
| Cash / accrual basis | ✗ accrual | ✗ | ? | ✓ separate cash-basis IS | ◐ follows method | ✓ two ledgers | ✓ | ✓ toggle | ? | ? | ✓ | ? |

### 3.3 Review, drill-down & close

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Drill line → transactions → source | ◐ amount → GL | ✓ Detail view keeps filters → record in new tab | ◐ marketing claim | ✓ cell → Transactions with all filters | ✓ hover card → View Details | ✓ | ✓ (tracking drill lost in new P&L) | ✓ keeps customisations | ✓ | ? | ✓ + annotate | ✓ detail report with Split |
| Integrity check visible | ✓ net profit = Σ P&L accounts | ◐ documented practice | ? | ? | ? | ? | ? | ? | ? | ? | ? | ◐ warns consolidated NI may differ |
| Variance flags / AI insights on lines | ✗ change column only | ✓ flux IS: thresholds, AI draft, re-flag on change | ✓ flux + AI confidence → Approved | ◐ marketing | ◐ Quick Insights (top movers) | ◐ AI Close flux on TB | ◐ JAX | ✓ insights count + sparkle per line (Plus) | ◐ AI report analysis | ◐ Ask Airene summary | ✗ | ? |
| Line commentary / notes | ✗ | ✓ per flux line | ✓ | ? | ✓ comments + @mention in reports | ? | ✓ report notes | ◐ commentary pages | ✓ account notes (Feb 2026) | ? | ✓ annotate | ? |
| Preliminary vs final | ✓ pill + unposted count | ✗ (open-period warning on consolidation) | ? | ? | ✓ Draft → Publish Final, versions | ◐ checklist lock | ◐ finalised read-only | ◐ closing date + exceptions report | ✗ | ◐ via Tutup Buku | ◐ include-drafts toggle | ◐ lock before close |
| Tied to close checklist | ✗ | ✓ flux task auto-completes | ◐ close management | ? | ✗ | ✓ "review P&L" step | ✗ | ◐ Books review | ✗ | ✓ Tutup Buku worksheet | ✗ | ◐ period close checklist |

### 3.4 Output

| Capability | Klay | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Excel (.xlsx) | ✗ CSV | ✓ SUM formulas on subtotals + variance % | ✓ retained formulas | ✓ exact view | ✓ | ✓ | ✓ + Google Sheets | ✓ (Sheets on Advanced) | ✓ | ✓ | ✓ | ◐ XLS |
| PDF / print | ✓ header + Final/Preliminary | ✓ | ✗ not documented | ? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Saved views / layouts | ✗ | ✓ saved configuration | ✓ Save As, pin 5 | ✓ saved views | ✓ custom reports | ? | ✓ default custom layout | ✓ | ✓ Memorize | ✓ default template | ✓ | ✓ |
| Report packs / schedule / external share | ✗ | ✓ packages: cover, schedule, external email | ◐ Reporting Agent (marketing) | ? | ✓ packs, Draft/Final, schedule, no-login PDF | ◐ tax package | ✓ management reports (no schedule) | ✓ management reports; schedule + AI narrative on Advanced | ? | ◐ monthly KPI email | ◐ store to Documents | ✓ schedule + email |

### 3.5 Indonesia-specific

| Capability | Klay | Acc | Jur | Odoo | NS | International tools (DE, Ril, Camp, Dig, Puz, Xero, QBO) |
|---|---|---|---|---|---|---|
| Fiscal correction (koreksi fiskal) per account, Coretax codes | ✗ | ✗ (Coretax XML export only) | ◐ Klikpajak integration, blog only | ✗ (l10n_id has no reports) | ✗ (no Indonesia localisation) | ✗ |
| PPh final on gross revenue view | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| OCI / SAK EP presentation | ✗ | ? | ◐ via template (Money Changer case) | ? | ? | n/a |
| Untagged bucket so dimension columns tie to total | ✗ | ✓ Non-Departemen / Non-Proyek | ? | ? | ◐ inactive segments kept "to avoid unbalanced totals" | ◐ Campfire "Other" department |

---

## 4. Vendor notes (UX and the ideas worth taking)

### DualEntry — closest peer, deepest docs
- Report Center › Financial Statements has **Income Statement Summary / Detail**, an **EBITDA Income Statement**, an **Income Statement Budget** view, and a separate **Flux Income Statement**.
- Subtotals follow account-type configuration. **EBITDA** comes from tagging Cost of Sales and Expense accounts with an EBITDA category (Interest, Taxes, Depreciation, Amortization), and can show Net Income → EBITDA or the reverse.
- **Customize (Beta):**
  - Rows can be a Group with subtotal, an Account, an Account Type or a Formula.
  - Columns can be a Date (prior month or year), Budget, Variance ($ or %) or a Formula (% of revenue, gross margin).
  - Saved reports store the configuration, not a snapshot. Oct–Nov 2026 added Prior Year Month, YTD and Prior Year YTD column presets.
- **Budgets:**
  - Entered monthly per account, optionally per classification, then posted from draft.
  - CSV or API upload.
  - No versions; a reforecast is just another named budget.
- **Slicing:**
  - Classifications go on rows or columns, up to three levels deep (Pivot).
  - Company multi-select with "Include children" and an elimination company.
  - P&L translated at the period-average rate, with a dual-currency view showing the rate per line.
- **Drill:** clicking an amount opens Detail filtered to that account and that column's period, with filters kept. The record number opens the source in a new tab.
- **Flux (Beta):**
  - Comparisons are MoM, QoQ and YTD vs prior YTD.
  - Thresholds by amount and/or %, with "require explanation".
  - A review badge ("11 of 33 rows reviewed").
  - A side drawer with trend chart, explanation and activity log.
  - Per-line AI drafts (largest transactions, new vendors, unusual postings).
  - A row is re-flagged if its balance changes after it was explained.
  - A close-checklist task auto-completes, with the warning *"Do not lock the period with unexplained flagged variances outstanding."*
- **Export and packages:**
  - Excel subtotals and variance % are live formulas.
  - Report packages have a cover page, a combined PDF or workbook, and a daily, weekly or monthly schedule.
  - External recipients (board, investors, auditors), with separate run / schedule / edit / archive permissions.
- **Not there:** a Preliminary/Final badge on the P&L, cash basis, and line sign-off (beyond flux commentary).

### Rillet
- The default income statement is Revenue / Costs / Expenses / Net Income. A separate **Executive P&L** maps Operating Expenses to R&D, S&M and G&A through a field.
- **Layout editor:**
  - Sections built by account type, code range, account or metadata (AND/OR).
  - Groups break down by up to three custom fields, each with its own sign setting.
  - Formula and text rows.
  - Number, currency, % or basis-point formats.
  - Undo/redo and audit history.
- **Columns:**
  - Monthly, quarterly, yearly or total.
  - Department, location or subsidiary breakdowns.
  - Variance only on the Total column (previous year, preceding period or budget).
  - Columns can't be reordered.
- **Budget vs actual** is its own report with one or two budget versions. **Favourable/unfavourable colour follows account type**: under-spending an expense is green, a revenue shortfall is red.
- Flux lives under Close Management. The Aura AI panel gives a summary, a confidence indicator and links to the source transactions, and status moves from AI Draft → Approved.
- .xlsx export keeps formulas, filters and groups. Up to 5 reports can be pinned to the home screen.

### Campfire
- Revenue → COGS → Gross Profit → OpEx → Operating Income → Other → Net Income.
- Periods are always whole months (a mid-month end is extended to month-end with an info icon).
- **Columns:** monthly, quarterly or yearly, each with a **fiscal or calendar** variant. **Group Columns By** splits each period by vendor, department, entity, tag or currency. **Group Rows By** offers account, department, parent department or tag.
- Filter chips include a **Department "Other" bucket for untagged rows**. "All Entities" gives a consolidated view, and with one entity the Entity Currency checkbox shows its own currency.
- **Drill:** clicking a cell opens Transactions pre-filtered to the account, the period, and every active grouping and filter. That's the strongest context-keeping drill in the set.
- Saved views (date range, cadence, groupings, filters) can be renamed and reordered.
- The API also has a comparative income statement (difference, %, `budget_id`) and a separate cash-basis income statement.

### Digits
- **Columns:**
  - Quick toggle for 1 / 3 / 6 / 12 months; **Monthly Breakdown** gives up to 36 columns.
  - Delta, MoM and YoY comparisons.
  - Side-by-side views limited to 6 locations or departments.
- **Hover card on any line:** overview, YTD, top vendors and top transactions, then "View Details". It's the lightest way to answer "what's in this number?" without leaving the page.
- **Quick Insights** above the P&L shows the biggest increases and decreases by vendor or category, plus revenue movers.
- **Custom reports:**
  - % of income or % of total columns, YTD totals, department filter.
  - An AI summary block (written from your notes; it doesn't pull figures itself).
  - **Draft → Publish Final → New Version** history.
  - Cover page, comments and @mentions per section, an activity log.
  - Scheduled auto-draft on the 1st, or auto-publish; PDF by email with no login needed.

### Puzzle
- Revenue → Cost of Revenue → Operating Expenses → Net Income, using fixed account-number series. Cash and accrual books run in parallel, with a one-click switch.
- Class and segment filtering needs the Complete plan. Comparison and budget columns aren't documented.
- The month-end checklist includes "review outputs (P&L and balance sheet) for consistency" and "Finalize & lock the month". The AI Close step flags anomalies tied to the account and source transaction.

### Xero
- The layout editor changes groups, adds formulas and custom columns, and can save a custom default layout. **% formula rows (GP%, NP%)** shipped in Sep 2025 after a 98-vote idea open since 2022.
- "Compare with" covers previous periods and previous year. Budget Variance is a **separate report**.
- **Complaints:**
  - The budget layout doesn't follow the custom P&L layout (230 votes; still not end-to-end in Oct 2026).
  - Periods and tracking categories can't be combined in one report.
  - No percentages when filtering by tracking.
  - Comparison columns run newest → oldest and reset when the date changes.
  - The new P&L lost tracking drill-down, and its Excel export lost the transaction tab.
- Management report packs can be saved; notes can be hidden on export; finalised reports are read-only.

### QuickBooks Online
- **Layout:** the account order follows the chart, custom subtotals are "unavailable", and collapse is all-or-nothing.
- **Columns:** compare with previous period, previous year or YTD, with $ and % change. Columns by day, week, month or quarter. % of Income (P&L only). Cash/accrual toggle on the report. Amounts in thousands. Chart view.
- Budget vs Actuals adds % of Budget and Remaining columns, on Plus/Advanced only, one budget at a time.
- **AI insights:** an insights count in the header and a sparkle on each line with a detected trend or anomaly. Each opens a card with the change, a headline, a 12-month chart, and the drivers by customer, vendor, product or class, linked to transactions. It runs nightly and on load.
- Management Reports have a cover, table of contents, commentary pages and end notes. Advanced adds AI narratives, KPI scorecards and scheduled delivery.
- **Complaints:** the modern view is slower, its totals differ from classic, Excel exports look worse, and menu labels keep changing.

### Accurate Online — the local reference
- Laporan › Daftar Laporan › Keuangan › **Laba/Rugi Standar**. It ends Laba Sebelum Pajak → Beban Pajak Penghasilan → **Laba Setelah Pajak**, with the PPh Badan account mapped in preferences. Since Feb 2026 it can show account notes.
- **Modifikasi** row types are Label, Daftar Akun (account list), Perhitungan (calculation), Total and Baris Kosong (blank), with indent. **Memorize** saves the format.
- **Report variants** (release notes 2018–2020):
  - *Laba/Rugi Departemen* and *Proyek*, each in **Multi Periode**, **Perbandingan Periode** and **Perbandingan Anggaran** (budget) versions.
  - A **Non-Departemen / Non-Proyek** option for untagged transactions.
  - Cross-dimension filters (department × category × project) added Feb 2026.
- Branch (*cabang*) is an add-on that can restrict users to branches. **Monitor Anggaran** tracks budgets by account, month and branch.
- *Laba Tahun Ini* is a computed system account shown only on the balance sheet. No year-end closing journal was found.

### Mekari Jurnal
- Laporan › **Laba Rugi**, with a "Tampilkan Akun" (show accounts) toggle. **Templates** (Tambah template, Jadikan default) rename categories, set expense sign, move accounts and reposition totals. They're used to move FX differences into **other comprehensive income**.
- **Periods:** presets (weekly → yearly), **compare up to 11 prior periods** (either direction), and a **"Laporan Tahun Ini (Bulanan)"** preset showing this year by month with % change.
- Tags give a P&L per project, salesperson or department, combining up to 5 tags with *all* or *any* (Pro/Enterprise).
- A separate **Laporan Anggaran Laba Rugi** (redesigned Q4 2025). **Ringkasan Bisnis** shows gross, operating and net margins. "Ask Airene" writes an AI summary of a filtered P&L.
- Tutup Buku has a worksheet step (TB, P&L, Neraca) before the closing entry; Kunci Periode locks without one.

### Odoo
- A generic Profit and Loss in every country (the Indonesian localisation adds e-Faktur / Coretax XML, not reports). The report engine (developer mode) supports domain, tax-tag, code-prefix, aggregation and external lines.
- **Columns:**
  - Comparison up to 12 prior periods or same period last year.
  - Analytic filters.
  - Posted vs **draft** entries, and accrual vs **cash** basis.
  - Hide zero lines; whole, K or M amounts.
- The **Budget button in the report** adds a budget column and a % column next to Balance, with several budgets as scenarios. It's the lightest-weight budget vs actual in the set.
- Consolidation via horizontal groups (P&L at the average rate). Annotate any line.

### NetSuite
- Ordinary Income/Expense (Income, Cost of Sales, **Gross Profit**, Expense) → Net Ordinary Income → Other Income and Expenses → **Net Income**. Optional % of income and % of expense columns.
- The **Financial Report Builder** separates **layouts** (row definitions) from **reports** (columns and filters), so one layout serves the standard, comparative, budget and by-department views.
- The Comparative Income Statement's comparison range moves with the date filter. **Budget vs. Actual** has Amount Over Budget and % of Budget formula columns. Inactive segments stay as filters "to avoid unbalanced totals".
- **Year-end:** the automatic close posts nothing. Prior years show in Retained Earnings and the current year in Net Income, so past P&Ls stay viewable.

---

## 5. Patterns across the market

1. **The statement shape is settled; the columns are where products differ.** Trend columns, same period last year and budget vs actual are everywhere except Puzzle and Klay.
2. **Dimension columns must add up.** Accurate's *Non-Departemen*, Campfire's "Other" department and NetSuite's kept-inactive segments all exist so the per-dimension columns sum to the company total. Xero's inability to combine periods with tracking is its most-voted P&L complaint after budgets.
3. **Budget vs actual should reuse the P&L layout.** Xero's 230-vote complaint is exactly this mismatch. Odoo (a budget column inside the report) and NetSuite (one layout, many reports) avoid it.
4. **"What's in this number?" is answered in place.** Digits' hover card, QBO's insight cards and Campfire's fully filtered drill all keep the reviewer on the statement, unlike QBO classic and Xero's new P&L, which lose context.
5. **Variance review becomes part of the close.** Thresholds plus explanations plus approval plus a lock rule (DualEntry, Rillet), or lighter flags on the line (QBO), or top movers (Digits). Commentary needs to survive a re-run (DualEntry re-flags when a balance changes).
6. **Reports get versions once they're shared.** Digits' Draft/Final, Xero's finalised read-only reports and DualEntry's scheduled packages all draw a line between a live report and the copy someone signed off on. Klay's Final/Preliminary pill is the start of that.
7. **Indonesian tax is unserved.** No tool turns the commercial P&L into fiscal income per account, even though Coretax now asks for exactly that.

---

## 6. Opportunities for Klay (draft priorities)

### P0 — small, high value, mostly reuse from the TB build

| # | Opportunity | Why | Notes |
|---|---|---|---|
| 1 | **Excel (.xlsx) with formulas** for subtotals, margins and change % | Every competitor; reviewers and consultants work in Excel | Reuse `src/lib/xlsxExport.js` and the TB export pattern; keep CSV |
| 2 | **Same period last year** plus **"This year by month"** trend columns | Universal; Jurnal, Accurate, Digits and QBO all have monthly columns | Extend Compare to *Previous period / Same period last year*. Add a Columns choice: *Single / Monthly / Quarterly*. Keep % of revenue per column. |
| 3 | **Dimension filter** | Lines already carry dimensions; the TB and GL use them | Reuse the TB's dimension popover and `lineDimensions` |
| 4 | **Saved views** | Accurate Memorize, Jurnal templates, Xero, DualEntry | Reuse the TB pattern (per user) |
| 5 | **Print header and sign-off**: "For the period ended …", "In Rupiah", Prepared / Reviewed / Approved | Owners and banks receive signed PDFs | Print CSS only; Bahasa wording is an open question |

### P1 — medium, strengthens review and the close

| # | Opportunity | Why | Notes |
|---|---|---|---|
| 6 | **P&L by department / project / location as columns**, with an **Untagged** column so the row total ties | Accurate's Laba/Rugi Departemen; QBO by class; Xero's top complaint | Can't combine with trend columns in V1; say so in the UI rather than silently dropping |
| 7 | **Variance flags on lines**, the same materiality rule as the TB (≥ 30% and ≥ the company's fixed amount, default Rp 20M) vs the comparison period, with a header count | QBO insights, DualEntry and Rillet flux | Reuse the TB's `varianceThreshold` setting; open question 8 is whether the P&L needs its own threshold |
| 8 | **Line drawer**: top vendors / customers, top transactions, monthly sparkline, link to GL and JE, keeping period and filters | Digits' hover card, Campfire's filtered drill | Replaces "click amount → GL" as the first step |
| 9 | **Line commentary** per account per period, carried into print and Excel | DualEntry flux commentary, Xero notes, Accurate account notes | The explanation half of flux, without AI or approval yet |
| 10 | **Budget vs actual**, in the same layout: budget column, variance Rp and %, favourable/unfavourable colour by account type | All local tools have it; Xero shows what happens when the layout differs | Needs budget entry; the Odoo-style in-report budget per account per month is the smallest version. Decide scope with the SME first (open question 4). |
| 10a | **Adjusted / unadjusted P&L**: *Adjustments: Included* (default) · *Excluded* · *As columns* (Unadjusted · Adjustments · Adjusted) | KAP proposes audit adjustments and the client posts them in its own books (Fidya, 10 Nov), so owners and banks may ask what changed net profit | Reuse the JE `is_adjusting` flag and the TB toggle; disable while Compare is on, as the TB does |

### P2 — larger, needs a PRD or SME decision first

| # | Opportunity | Why | Dependency |
|---|---|---|---|
| 11 | **Fiscal correction view**: Commercial · Correction (+) · Correction (−) · Fiscal per account, with Coretax codes (FPO-01..12 / FNE-01..04) and an Excel export shaped like Lampiran 1A–1L | No competitor does it; SPT 1771 now needs it per account | Tax SME to confirm codes and workflow; PRD |
| 12 | **Flux workflow**: thresholds, required explanations, approval, re-flag on change, close-checklist task, lock warning | DualEntry, Rillet | Shared with TB P2; close checklist design |
| 13 | **Layout templates**: custom groups, formula and % rows, EBITDA tags; reused by budget and dimension views | Xero, Accurate, Jurnal, NetSuite, DualEntry | Design of a layout editor |
| 14 | **Report packs**: P&L + TB + Balance Sheet, cover page, Draft → Final versions, scheduled email | Digits, DualEntry, QBO, Xero | Balance Sheet report doesn't exist yet |
| 15 | **AI narrative summary** of the period | Jurnal Airene, QBO, Rillet, Digits | Klay AI not in MVP |
| 16 | **PPh final view** (0.5% of gross revenue by month) | UMKM taxpayers | The regime changed under PP 20/2026 (to verify); may not apply to PT/CV customers |

### Not now
- **Multi-entity consolidation and FX translation:** V1 is single-entity in IDR.
- **Cash basis:** SAK EP / EMKM are accrual.
- **Forecasting.**

---

## 7. Open questions (for Fidya / SME)

1. **Labels:** Bahasa line names on screen or only in print/Excel? *Pendapatan, HPP / Beban Pokok Penjualan, Laba Kotor, Beban Usaha, Laba Usaha, Pendapatan & Beban Lain-lain, Laba Sebelum Pajak, Beban Pajak, Laba Bersih*?
2. **Default period:** the P&L opens on year to date and the TB on last month. Should they match, and on which?
3. **Dimensions:** which ones matter on a P&L (department, project, branch/location)? What should the untagged column be called?
4. **Budgets:** are budgets in scope for V1 customers at all? If so, monthly per account, or per account × department? Who enters them?
5. **Fiscal correction:** do SME tax consultants prepare koreksi fiskal from Klay or in their own spreadsheets? Would per-account codes in Klay be used? Who's allowed to edit them?
6. **PPh final:** are target customers still on the 0.5% final regime after PP 20/2026 (perseroan perorangan / koperasi only)? Is a revenue-by-month view for it useful?
7. **SAK EP:** does the P&L need an *other comprehensive income* section for Klay's customers, or is it rare enough to skip?
8. **Variance materiality:** is the TB rule (≥ 30% and ≥ Rp 20M, a company setting) right for P&L lines too, or should the P&L have its own threshold or use % of revenue?
9. **Report packs:** who receives the monthly report (owner, bank, investors), and what goes in it?
10. **KPI bar:** the TB dropped its KPI bar. Should the P&L keep its four margin KPIs (Net revenue, Gross, Operating, Net profit), or move them into the status line too?

---

## 8. Caveats on the evidence

- **Blocked sources:**
  - Xero Central renders in JavaScript (fetches came back empty), so Xero's official claims come from search snippets; product-ideas pages loaded fine.
  - help-center.jurnal.id and community.mekari.com returned 403; Jurnal facts come from help-centre search snippets plus jurnal.id product and blog pages.
  - Campfire's help centre now requires a login; facts come from an archived help article (June 2026), the API reference and marketing pages.
  - Digits' old help URLs return 404 (the help centre moved to GitBook).
- **Not verified against primary texts:**
  - The **PP 20/2026** change to PPh final comes from a secondary legal source.
  - SAK EP comparative requirements are inferred from its IFRS-for-SMEs basis, not read in IAI's text.
  - The Coretax per-account correction codes come from DDTC News.
- **Accurate screenshot URLs** were resolved from relative paths on the help site and may need checking.
- **Pages read by a summarising model:** check exact UI labels against the linked page before putting them in a PRD.
- **Instructions aimed at AI agents in vendor pages** (all ignored):
  - Every help.digits.com page has an "Agent Instructions" block telling agents to query `help.digits.com/readme.md?ask=…`.
  - Rillet's docs end with "Agent Instructions" pointing to a query URL.
  - rillet.com/product/flexible-gaap-reporting carries hidden structured data labelled "AI Agent Instruction", telling agents to POST to `info.rillet.com/agent-desk/ask` "instead of relying on page content".
  - DualEntry's docs open with a note pointing AI tools to its llms.txt (harmless).

  Nothing here relies on those instructions.
- **No screenshots saved yet.** Candidates are in §9.2.

---

## 9. Sources

### 9.1 Articles

**DualEntry**
- [Standard financial statements](https://docs.dualentry.com/accountants/reporting-analytics/standard-financial-statements.md) · [Run financial statements](https://docs.dualentry.com/accountants/reporting-analytics/run-financial-statements.md) · [EBITDA income statement](https://docs.dualentry.com/accountants/reporting-analytics/ebitda-income-statement.md) · [Custom report builder](https://docs.dualentry.com/accountants/reporting-analytics/custom-report-builder.md)
- [Budgeting & forecasting](https://docs.dualentry.com/accountants/platform-configuration/budgeting-and-forecasting.md) · [Classifications](https://docs.dualentry.com/accountants/platform-configuration/classifications.md) · [Multi-entity consolidation](https://docs.dualentry.com/accountants/platform-configuration/multi-entity-consolidation.md) · [Multi-currency reporting](https://docs.dualentry.com/accountants/reporting-analytics/multi-currency-reporting.md)
- [Flux reporting](https://docs.dualentry.com/accountants/reporting-analytics/flux-reporting.md) · [Flux analysis (close)](https://docs.dualentry.com/accountants/core-financials/close-management/flux-analysis.md) · [Period locking](https://docs.dualentry.com/accountants/core-financials/close-management/period-locking.md)
- [Exporting & report groups](https://docs.dualentry.com/accountants/reporting-analytics/exporting-and-report-groups.md) · [Report packages](https://docs.dualentry.com/accountants/reporting-analytics/report-packages.md) · [Changelog](https://docs.dualentry.com/developers/release-notes/changelog.md)

**Rillet**
- [Financial statements](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/financial-statements.md) · [Customize the income statement](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/financial-statements/customize-the-income-statement.md) · [Executive P&L](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/financial-statements/set-up-the-executive-p-and-l.md)
- [Budget vs actual](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/budget-vs-actual/review-the-budget-vs-actual-report.md) · [Consolidated statements](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/multi-entity/consolidation/consolidated-financial-statements.md) · [Multi-book](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/multi-book-accounting-adjustment-only.md)
- [Flux analysis](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/close-management/flux-analysis/use-flux-analysis-to-review-account-variances.md) · [AI flux](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/close-management/flux-analysis/ai-powered-flux-analysis.md) · [Approve explanations](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/close-management/flux-analysis/edit-and-approve-flux-analysis-explanations.md) · [Marketing: flexible GAAP reporting](https://rillet.com/product/flexible-gaap-reporting)

**Campfire**
- [Income statement (archived help)](https://help.meetcampfire.com/articles/7558507962-income-statement) · [API: income statement](https://docs.campfire.ai/api-reference/financial-statements/get-income-statement.md) · [API: comparative](https://docs.campfire.ai/api-reference/financial-statements/get-comparative-income-statement.md) · [API: cash basis](https://docs.campfire.ai/api-reference/financial-statements/get-cash-basis-income-statement.md) · [Ember AI](https://llms.campfire.ai/ember-ai) · [Core accounting](https://campfire.ai/core-accounting)

**Digits**
- [Financials](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/financials) · [Monthly reporting & exports](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/monthly-reporting-and-exports-p-and-l-balance-sheet-cash-flow) · [Custom reports](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/custom-reports) · [Sharing reports](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/sharing-reports) · [Schedule reports](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/schedule-reports)

**Puzzle**
- [What reports Puzzle provides](https://help.puzzle.io/en/articles/8441346-what-reports-does-puzzle-provide) · [Financial statements](http://help.puzzle.io/en/articles/11385709-financial-statements-in-puzzle) · [Summary by page](https://help.puzzle.io/en/articles/6987040-summary-of-puzzle-by-page) · [Classifications FAQ](https://help.puzzle.io/en/articles/9118843-faq-classifications) · [Monthly checklist](https://help.puzzle.io/en/articles/8646694-the-monthly-checklist) · [Month-end close](https://puzzle.io/wip/features/month-end-close)

**Xero**
- [Profit and Loss (new)](https://central.xero.com/0/article/Profit-and-Loss-New) (snippet) · [Edit layout](https://central.xero.com/0/article/Edit-layout-of-a-new-financial-report) (snippet) · [Budget Variance](https://central.xero.com/0/article/Budget-Variance-report) (snippet) · [Management reports](https://central.xero.com/0/article/Management-reports) (snippet)
- Product ideas: [% formula rows](https://productideas.xero.com/forums/967133-reports-tax/suggestions/45290509-custom-report-add-formula-rows-for-percentages) · [Budget layout](https://productideas.xero.com/forums/967133-reports-tax/suggestions/44988625-reporting-budget-manager-customise-report-layo?page=6) · [Periods + tracking](https://productideas.xero.com/forums/967133-reports-tax/suggestions/46845046-profit-loss-report-compare-200-tracking-cate) · [Comparison order](https://productideas.xero.com/forums/967133-reports-tax/suggestions/51450445-allow-financial-report-comparison-periods-to-displ) · [Tracking drill-down](https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/46712989-profit-loss-tracking-ability-to-drill-down)

**QuickBooks Online**
- [Compare time periods](https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/compare-time-periods-reports/L1YclAy6H_US_en_US) · [Custom reports (Advanced)](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-reports/create-custom-reports-quickbooks-online-advanced/L1LHo5Ti2_US_en_US) · [Budgets](https://quickbooks.intuit.com/learn-support/en-us/help-article/taxation/create-import-budgets-quickbooks-online/L7SvmSAsU_US_en_US) · [AI report insights](https://quickbooks.intuit.com/learn-support/en-us/help-article/business-reports/ai-powered-report-insights/L2jZq6tfM_US_en_US) · [Management reports](https://quickbooks.intuit.com/learn-support/en-uk/help-article/report-management/view-edit-management-reports-quickbooks-online/L90RAh2XZ_GB_en_GB)
- Community: [No custom subtotals](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/is-there-a-way-to-subtotal-certain-expenses-on-the-profit-and/00/1444544) · [Modern view complaints](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/re-bring-back-classic-view-reports/01/1355812/highlight/true)

**Accurate Online**
- [Laba setelah pajak](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/daftar-laporan/cara-melihat-laba-setelah-pajak/) · [Modifikasi laporan](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/daftar-laporan/modif-neraca/) · [Cara membuat laporan keuangan](https://accurate.id/akuntansi/cara-membuat-laporan-keuangan/) · [Laba Tahun Ini](https://help.accurate.id/product/accurate-online/fitur-aol/laporan/daftar-laporan/laba-tahun-ini/)
- Release notes: [Multi Periode (Oct 2020)](https://accurate.id/release-notes-aol/1008755/) · [Perbandingan (Dec 2020)](https://accurate.id/release-notes-aol/1009030/) · [Anggaran (2018)](https://accurate.id/release-notes-aol/1004980/) · [Account notes (Feb 2026)](https://accurate.id/release-notes-aol/1013774/)
- [Cabang](https://help.accurate.id/product/accurate-online/fitur-aol/perusahaan/cabang/mengenal-fitur-cabang/) · [Kategori keuangan](https://help.accurate.id/product/accurate-online/fitur-aol/pengaturan/preferensi/fitur-kategori-keuangan/) · [Monitor anggaran](https://help.accurate.id/product/accurate-online/fitur-aol/buku-besar/monitor-anggaran/)

**Mekari Jurnal**
- [Help: Laporan Laba Rugi](https://help-center.jurnal.id/hc/id/articles/7120531654169-Bagaimana-Cara-Membuat-Laporan-Laba-Rugi) (snippet) · [Updates Q4 2025](https://help-center.jurnal.id/hc/id/articles/52575585526937-Jurnal-Updates-Q4-Oktober-Desember-2025) (snippet) · [Panduan laporan keuangan UKM](https://www.jurnal.id/id/blog/panduan-lengkap-mengelola-laporan-keuangan-bagi-ukm/) · [Biaya & anggaran](https://www.jurnal.id/id/fitur/biaya-anggaran/) · [Tutup buku](https://www.jurnal.id/id/blog/tutup-pembukuan-anda-buka-catatan-keuangan-baru/) · [Rekonsiliasi fiskal](https://www.jurnal.id/id/blog/rekonsiliasi-fiskal-adalah/) · [SAK EP](https://www.jurnal.id/id/blog/sak-ep/)

**Odoo**
- [Reporting (v18)](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting.html) · [Reporting (v19)](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting.html) · [Customize reports](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/customize.html) · [Budget](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/budget.html) · [Consolidation](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/consolidation.html) · [Indonesia localisation](https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations/indonesia.html)

**NetSuite**
- [Income Statement](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2093552.html) · [Comparative IS](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2095037.html) · [Budget vs Actual](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2097218.html) · [Report layouts](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2110511.html) · [IS Detail](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2094110.html) · [Year-end close](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1457773.html)

**Indonesian practice**
- [Koreksi fiskal per akun in Coretax (DDTC)](https://news.ddtc.co.id/berita/nasional/1811241/spt-tahunan-era-coretax-koreksi-fiskal-diperinci-per-akun-lapkeu) · [PPh final UMKM revised (secondary)](https://smartlegal.id/legal-check-up/2026/06/09/pph-final-umkm-direvisi-pt-cv-dicoret-dari-fasilitas-05/) · [SAK EMKM (Accurate blog)](https://accurate.id/akuntansi/sak-emkm/) · [Rekonsiliasi fiskal (Pajakku)](https://pajakku.com/artikel/isi-rekonsiliasi-fiskal-laporan-keuangan-badan)

### 9.2 Candidate screenshots (not downloaded)

| Vendor | Shows | URL |
|---|---|---|
| DualEntry | Flux income statement with AI explanation · income statement with pivot panel · pivot by year/month/account (marketing) | [rep-tab-2](https://cdn.prod.website-files.com/66bf861737ab5a556a15c52b/69f475e5bd2db2cbb464191e_5ee089451fd150b6aa9fa5d7bf15cde0_rep-tab-2.avif) · [rep-tab-3](https://cdn.prod.website-files.com/66bf861737ab5a556a15c52b/69f475e55ee198d50b246be4_430f1f980874f72c787860eae32752ae_rep-tab-3.avif) · [tablet-3](https://cdn.prod.website-files.com/66bf861737ab5a556a15c52b/6a0c6a4850e85160ae45edd4_rep-tab-tablet-3.avif) |
| Rillet | Income statement · layout controls · Executive P&L | [income statement](https://612265232-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FNpXFVFZpTQck3vIrjmHB%2Fuploads%2FAhSektIsTBU0scAJooKr%2Fimage.png?alt=media&token=1af90f16-47cf-4219-a43a-0338a214679e) · [layout](https://612265232-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FNpXFVFZpTQck3vIrjmHB%2Fuploads%2FZ3tViHK82jrdkiA4BweR%2Fimage.png?alt=media&token=9e28f1cd-6635-4555-a4df-a0eb1af732be) · [executive P&L](https://612265232-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FNpXFVFZpTQck3vIrjmHB%2Fuploads%2FG67UELwmq6HYr78dfl46%2Fimage.png?alt=media&token=4ea48261-e0de-474d-a4a5-f4b6b3c9a5a5) |
| Campfire | Reports (marketing) | [reports](https://cdn.sanity.io/images/zu7n19wi/production/deb5fc0fb88822c31b2f443748ae5b5828a44a5e-2412x1640.png) |
| Digits | P&L overview · Quick Insights · options menu · hover card | [overview](https://3494946449-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FQp6kVxx1FJYsPtDHusNl%2Fuploads%2F4OUUAH0uxJvd20P0iH6U%2FCursor_and_Michelle_s_Demo_Clie%E2%80%A6___Financials_and_QuickBooks_Desktop.png?alt=media&token=37bca396-0b40-4fdb-b1a6-3198620bd6a5) · [insights](https://3494946449-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FQp6kVxx1FJYsPtDHusNl%2Fuploads%2FbinfDLa8KZRI5DjQUZ4U%2FCursor_and_Michelle_s_Demo_Clie%E2%80%A6___Financials.png?alt=media&token=e48b8aae-7639-4a50-9f4d-f4b0878a643c) · [options](https://3494946449-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FQp6kVxx1FJYsPtDHusNl%2Fuploads%2FArg62Hbwj0Op8bTjF7A8%2FCursor_and_Michelle_s_Demo_Clie%E2%80%A6___Financials.png?alt=media&token=bf52c3ef-1482-48b2-95d9-b3aea98c6ded) · [hover card](https://3494946449-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FQp6kVxx1FJYsPtDHusNl%2Fuploads%2FCtZy3gAyEG1ZXHICU7lL%2FCursor_and_Michelle_s_Demo_Clie%E2%80%A6___Financials.png?alt=media&token=eb5ddedd-651c-4428-ad21-cc688ff5da42) |
| Puzzle | Report screenshot (nearest to a P&L) | [screenshot](https://downloads.intercomcdn.com/i/o/845039889/5dc20752e8962f92c5162a78/Screenshot+2023-10-03+at+3.01.07+PM.png) |
| Xero | Budget vs actual analytics card (marketing) | [card](https://www.xero.com/sg/content/dam/xero/pilot-images/features/analytics/analytics-card-standard.1646877479891.png) |
| Accurate | Laba/Rugi with Laba Setelah Pajak (help centre; path resolved by inference) | [P&L](https://help.accurate.id/assets/images/7%20Menampilkan%20Laba%20Setelah%20Pajak%20Pada%20Laporan%20LabaRugi-1763006756318-86-976b79f20a16cacd81ea3b959001cae5.webp) |
| Jurnal | Tutup Buku header image (no P&L screenshot found) | [tutup buku](https://www.jurnal.id/wp-content/uploads/2023/01/Mekari-Jurnal-Cara-Melakukan-Tutup-Buku-720x405.webp) |
| Odoo | Comparison · filters (v19) · horizontal groups · budget column | [comparison](https://www.odoo.com/documentation/18.0/_images/reporting-comparison.png) · [filters](https://www.odoo.com/documentation/19.0/_images/report-filters.png) · [horizontal groups](https://www.odoo.com/documentation/18.0/_images/horizontal_groups.png) · [budget](https://www.odoo.com/documentation/18.0/_images/budget.png) |
| QBO, NetSuite | No public P&L screenshots found | — |
