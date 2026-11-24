# Cash Flow Statement (Laporan Arus Kas) — product discovery & competitor benchmark

**Status:** Draft for review · **Date:** 24 Nov 2026 · **Page:** Reports › Cash Flow Statement (not built yet; proposed route `/reports/cash-flow-statement`, since `/reports/cashflow` is already the *Cash Position & Aging* report)

Benchmarked against DualEntry, Rillet, Campfire, Digits, Puzzle, Xero, QuickBooks Online, Accurate Online, Mekari Jurnal, Odoo and NetSuite. Everything comes from public docs, help centres, release notes, API references and vendor forums, read on 24 Nov 2026. See [§8 Caveats](#8-caveats-on-the-evidence) before quoting anything as fact. This is a companion to the [Trial Balance](../trial-balance/README.md) and [Profit & Loss](../profit-loss/README.md) research. The benchmark tables have no Klay column because Klay has no cash flow statement yet.

**Scope already set in Linear for design (3 days):**
- indirect method (to confirm with SMEs)
- operating / investing / financing sections
- each account mapped to a cash flow activity
- a check that net cash flow ties to the change in cash on the Balance Sheet
- drill-down, Bahasa labels, Excel/PDF export

This document tests that scope against the market and turns it into §6.

---

## TL;DR

1. **The indirect method is the right default, but get the method confirmed.**
   - DualEntry, Rillet, Campfire and NetSuite all start from net income, and QBO probably does too *(i)*. None of them lets the user switch method.
   - In Indonesia, **SAK ETAP (2011–2024) required the indirect method for private entities**. Most SME accountants and their KAP learned and file indirect statements, and Accurate's own blog calls indirect the common choice.
   - PSAK 2 / PSAK 207 *encourages* direct, and SAK EP (from 2025) allows either.
   - The counter-signal is **Mekari Jurnal, which offers both and opens on "Default Direct"**. Xero has only a direct statement, and its request for an indirect one (142 votes) has gone unanswered since 2019.
2. **The real design question is where the mapping lives.** The market splits three ways:
   - **Fixed by account type, no override:** DualEntry ("no per-account cash flow category to configure"), QBO, Xero, Digits. Classification complaints are the main pain point in the QBO, Xero and Digits forums.
   - **By account subtype, so changing it means changing the account:** Rillet.
   - **A per-account field the user can edit:** Campfire (`account_cashflow_classification`), Odoo (account tags), NetSuite (report builder).

   For Klay, **default every account from its COA group, so nothing has to be set up, and allow a per-account override in Settings › Chart of accounts.**
3. **Nobody proves the tie on screen.**
   - DualEntry ends with beginning → ending cash, but nothing checks it against the Balance Sheet.
   - Rillet's FAQ says ending cash "should match".
   - Campfire refuses to return a statement with a plug (HTTP 422) and lists the journals whose accounts need a class. That's the strictest rule, but it's API-only.

   Klay's BS already shows two proofs on screen. A third, *Ending cash = Balance Sheet cash and cash equivalents*, is in the same style and would differentiate Klay.
4. **Unmapped movement must be visible, not plugged.** Odoo shows a "Cash flows from unclassified activities" section, while Rillet buries leftovers in "Other change in working capital". If Klay defaults every account, unclassified should be rare. When it does happen (a new account, a cash-equivalent edge case), show it as its own line with a review flag.
5. **The two most-reported errors are depreciation and fixed assets bought on credit.** Digits users reported accumulated depreciation landing in investing, gains on asset sales left in operating, and capex funded through AP inflating operating cash. Xero users reported non-cash journals leaking in. Those are the cases to test the Klay design against.
6. **Columns and drill follow the P&L.** DualEntry opens by month, with Year / Quarter / Total in a Columns picker. It has **no detail view**: an account-backed line jumps to the GL and Net income jumps to the IS detail. Klay's shared Transactions side panel already does better than that, and is the drill to reuse.
7. **Klay already has most of the parts.** `computeBalanceSheet` (balances on any date, `g-cash` group, Bahasa group names), `computeProfitLoss` (net profit for any range), the BS proof pattern, `TransactionsPanel`, `ReportControls` and `xlsxExport`. What's missing is the cash flow classification on the account and the statement itself.

---

## 1. Who uses the cash flow statement and what for

| Who | When | Job to be done | What they need from the screen |
|---|---|---|---|
| **Owner / director** | Monthly; before bank meetings | "We made a profit, so where is the cash?" | Net profit reconciled to cash in plain words, the big movers (receivables, stock, capex, loan repayments), monthly trend |
| **Finance Manager** (preparer of the LK) | Year-end statements; quarterly bank reports | "Produce the *laporan arus kas* for the audited statements without rebuilding it in Excel." | SAK-style layout, prior-year comparative, Bahasa labels, Excel the auditor can tick, a proof that it ties to the Neraca |
| **External auditor** (KAP) | Year-end fieldwork | "Does the statement tie to the Neraca and the P&L, and is classification consistent?" | Beginning and ending cash agreeing to *kas dan setara kas* on both balance sheets, the mapping of each account, non-cash items stripped out |
| **Bank / lender** | Credit applications, covenant reviews | "Can operating cash service the debt?" | Cash from operations, capex and debt movements by year, signed print |
| **Staff accountant** | Month-end, after the BS is closed | "Why doesn't it tie?" | Unclassified movements flagged, drill from a line to its journals, the account-to-activity mapping in one place |

**Key moments:**
- Year-end statements: the cash flow statement is part of a full SAK EP set, and auditors and banks read it.
- Loan applications and covenant reporting.
- Monthly management packs, less often than the P&L.
- **SAK EMKM entities don't have to prepare one** (minimum set: Neraca, Laba Rugi, CaLK). Micro clients may never open it.

---

## 2. Klay today

**There is no cash flow statement.** Close neighbours already exist:

| Area | What exists | Reusable for the cash flow statement? |
|---|---|---|
| **Cash Position & Aging** (`/reports/cashflow`, `src/pages/CashflowReportPage.jsx`) | Book balance per bank/cash account as of a date, split into *available* vs *not available* (time deposits, restricted, tax account), "Reconciled through" per account, AR/AP aging with ledger tie, "cash in 30 days" | **No.** It shows balances and aging, not flows. Its balances come from `lib/cashPosition.js` (bank master opening + attributed movements), **not the GL**. The comment notes that bank-recon fees and interest post to `11110 Bank IDR` and are left out. A cash flow statement must use GL balances, so the two pages can show different "cash" figures. **The route and card name (`cashflow`) will clash with a real cash flow statement.** |
| **Balance Sheet** (`src/lib/balanceSheet.js`, `BalanceSheetPage.jsx`) | Debit-positive balance per account on any date; COA tree in SAK EP order; Bahasa group names (`g-cash` → *Kas dan setara kas*); computed *Laba (rugi) tahun berjalan*; two on-screen proofs (Assets = L + E; current-year profit = P&L YTD); compare N previous periods; Excel with live formulas; signed print in Bahasa | **Yes, the engine.** Indirect method = Δ of each BS account between two dates. Beginning cash = `g-cash` total the day before the period starts; ending cash = `g-cash` total at period end. The proof banner pattern (`tb-foot ok/off`) carries straight over. |
| **Profit & Loss** (`src/lib/profitLoss.js`) | `computeProfitLoss(entries, { from, to })` gives net profit for any range; buckets by `section`/`type`; Bahasa labels; Final/Preliminary + unposted count | **Yes.** Net profit is the indirect method's first line, and it must equal the P&L for the same range. |
| **Shared report controls** (`src/components/ReportControls.jsx`) | `PeriodPopover` (presets + custom range), `ComparePopover` (N periods, order), `ChoicePopover`, `ViewsPopover` (saved per user), `ExportPopover` (XLSX / CSV / Print) | **Yes**, as is. |
| **Transactions panel** (`src/components/TransactionsPanel.jsx`) | Right-hand panel with one account's posted journal lines for one period, opening → running total → the number clicked, step between periods, links to source document and GL | **Yes, the drill.** A cash flow line is a Δ of one or more accounts, so the panel can show that account's movement for the period. A multi-account line needs a list of accounts first. |
| **Chart of accounts** (`src/data/seed/coa.js`, `ChartOfAccountsPage.jsx`) | 4-level group tree, `type` (asset / liability / equity / revenue / expense / contra_asset / contra_revenue), `section` (Current Asset, Non-Current Asset, Current Liability, Non-Current Liability, Equity, Revenue, COGS, OpEx, Other, Tax), `fs` (BS / PL). The settings page lists Code / Account name / Type / Dimensions; the edit dialog allows a rename and "settle through Payment"; code and type are locked. Edits are audited (`SettingsAuditContext`). | **No cash flow field.** The **group tree is enough for a default mapping** (table below). The settings page is the natural home for an override: a "Cash flow" column plus a field in the edit dialog. |

**A default mapping the chart already supports.** The groups are clean enough that almost every account gets its activity from its parent group:

| COA group / account | Default activity | Line on the statement (EN / ID) | Exceptions to flag |
|---|---|---|---|
| `g-cash` (Cash and Cash Equivalents) | **Cash**: excluded from activities, makes up beginning/ending cash | *Kas dan setara kas* | **Time Deposit — BCA/Mandiri (1-1510/1520)** and **Restricted Cash — BCA (1-1530)** sit in `g-cash`, but under PSAK 2 deposits over 3 months and restricted cash aren't cash equivalents. **Cash in Transit (1-1240)** is a judgment call. **11110 / 11120** (bank-recon postings) duplicate bank codes. |
| `g-ar`, `g-inventory`, `g-prepaid`, `g-other-current` | Operating: working-capital change | Change in trade receivables / inventories / prepaid / other current assets (*Kenaikan/penurunan piutang usaha*, …) | **Assets Held for Sale (1-5400)** is investing. **Allowance for doubtful accounts (1-2200)** nets into receivables. |
| `g-ppe`, `g-intangible`, `g-other-nc` | Investing | Purchase / sale of fixed assets and intangibles (*Perolehan aset tetap*) | **Accumulated depreciation / amortisation (contra_asset)** is a non-cash add-back in operating, not investing (the Digits bug). **Fixed Asset Clearing (1-6900)**: investing *(i)*. |
| `g-trade-payable`, `g-tax-payable`, `g-other-current-liab` | Operating: working-capital change | Change in trade payables / accrued expenses / taxes payable (*Kenaikan/penurunan utang usaha*, …) | **Dividends Payable (2-4500)** is financing (or a non-cash declaration). **Customer Deposits / Deferred Revenue** stay operating. |
| `g-short-debt`, `g-nc-liab` | Financing | Proceeds from / repayment of bank loans; lease payments (*Penerimaan/pembayaran pinjaman bank*) | **Deferred Tax Liability (2-5300)** is operating (non-cash). **Current Portion of LTD (2-3200)** stays financing. |
| `g-equity` | Financing | Capital contributions; dividends paid (*Setoran modal*, *Pembayaran dividen*) | **Retained Earnings (3-1300)** and **Current Year Earnings (3-1400)** are covered by net profit and must not be counted twice. |
| P&L accounts (`fs: "PL"`) | Not mapped: they reach the statement through net profit | — | **Depreciation Expense (6-3400)** and **Gain/Loss on Asset Disposal (4-2400 / 7-1300)** need adjusting lines. **FX gain/loss (4-2200 / 7-1200)**: unrealised portion, later. |

Fixed-asset depreciation journals already carry `source: "fixedassets"` (the Transactions panel labels them "Depreciation"), which helps for the depreciation add-back.

---

## 3. Functionality benchmark

**Legend:** ✓ documented · ◐ partial / workaround / other screen · ✗ documented as missing · ? not found in public sources · *(i)* inferred · — not applicable

**Abbreviations:** DE = DualEntry · Ril = Rillet · Camp = Campfire · Dig = Digits · Puz = Puzzle · QBO = QuickBooks Online · Acc = Accurate Online · Jur = Mekari Jurnal · NS = NetSuite

### 3.1 Method & structure

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Has a cash flow statement | ✓ Cash Flow Summary | ✓ | ✓ API (UI ?) | ◐ cash in/out in UI; formal statement in API | ✗ "does not provide"; Cash Activity report instead | ✓ since Dec 2015 | ✓ | ✓ Laporan Arus Kas | ✓ Arus Kas | ✓ | ✓ |
| Indirect method (from net income) | ✓ | ✓ | ✓ stated | ◐ API sections imply it *(i)* | — | ✗ 142-vote idea, unanswered since 2019 | ✓ *(i)* | ? | ✓ selectable | ✗ | ✓ |
| Direct method (receipts / payments) | ✗ | ✗ | ✗ | ◐ Gross Income / Gross Burn view | ◐ Cash Activity | ✓ (only method) | ✗ | ◐ kas masuk / keluar totals (partner tutorial) | ✓ "Default Direct" | ◐ direct-style from cash moves | ✗ |
| User chooses the method | ✗ | ✗ | ✗ | ✗ | — | ✗ | ✗ | ? | ✓ | ✗ | ◐ via report builder |
| Depreciation as a non-cash add-back | ✓ "depreciation on fixed assets" | ✓ D&A, stock comp | ✓ non-cash adjustments | ◐ users reported it in investing | — | ✗ non-cash journals leak in | ◐ by account | ? | ? | — | ◐ nets into investing via Fixed Asset type *(i)* |
| Working-capital change lines | ✓ AR, other current assets, AP, credit card | ✓ named lines + "Other change in WC" | ✓ | ? | — | — | ✓ per account *(i)* | ? | ? | — | ✓ per account type |
| FX effect on cash line | ◐ consolidated translation by month | ✓ FX impact | ✓ | ? | — | ? | ? | ? | ? | ? | ✓ Effect of Exchange Rate (OneWorld) |
| Non-cash transactions disclosure | ? | ◐ restricted cash disclosed apart | ✓ separate section | ? | — | ✗ | ✗ | ? | ? | ✗ | ? |

### 3.2 Account-to-activity mapping

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Default mapping from account type / subtype | ✓ fixed set of categories | ✓ by subtype | ? | ✓ automatic | — | ✓ *(i)* | ✓ e.g. long-term liabilities → financing | ? | ◐ account category *(i)* | ✗ needs tags; untagged = unclassified | ✓ by account type |
| User can override per account | ✗ "no per-account cash flow category" | ◐ only by changing the subtype; future periods only | ✓ `account_cashflow_classification` (API) | ✗ | — | ✗ requested Jul 2026 | ✗ ("Classify Cash" is Desktop only) | ◐ tutorials say "check the mapped accounts"; where is ? | ? | ✓ account tags on the COA | ✓ Financial Report Builder sections |
| Edit the statement layout (rows / sections) | ◐ Customize (Beta) supports the cash flow statement | ✗ | ? | ✗ | — | ✓ layout editor | ◐ Advanced builder | ◐ *Desain Laporan* *(i)* | ? | ◐ developer mode | ✓ |
| Visible unclassified / "other" bucket | ? | ◐ "Other change in WC" catch-all | ✓ refuses with 422, names the JEs | ? | — | ✗ | ✗ | ? | ? | ✓ "Cash flows from unclassified activities" | ✗ |
| Defines what counts as cash | ◐ bank-type accounts *(i)* | ✓ cash + equivalents + restricted (restricted disclosed) | ◐ BANK subtype *(i)* | ? | — | ◐ Bank type incl. credit cards (complaint) | ◐ bank accounts *(i)* | ◐ Kas & Bank *(i)* | ◐ Kas & Bank *(i)* | ✓ bank and cash journals | ✓ Cash Statement: bank + undeposited funds |
| Classification complaints on record | — | ? | — | ✓ depreciation, asset gains, AP-funded capex | — | ✓ non-cash journals, credit cards | ✓ deferred tax, lease liabilities | ? | ? | ◐ tax portion lands in unclassified | ◐ income / expense accounts can't be classed |

### 3.3 Integrity: proving the tie to cash

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Beginning cash + net change = ending cash | ✓ | ✓ + FX + RE adjustments | ✓ + FX | ✓ API | — | ✓ *(i)* | ✓ *(i)* | ✓ kas awal / kas akhir (tutorial) | ? | ✓ | ✓ + FX |
| Ending cash checked against Balance Sheet cash | ✗ (practice: TB ties to statements) | ◐ FAQ: "should match" | ✓ zero-plug enforced (API) | ✗ | — | ✗ | ✗ users report mismatches | ? | ? | ◐ by construction | ◐ FX row offsets CTA so ending = BS |
| Net income on the statement = P&L | ✓ links to IS detail | ✓ system row | ✓ | ✓ | — | — | ✓ *(i)* | ? | ? | — | ✓ |
| Preliminary / unposted context | ✗ (drafts excluded silently) | ? | ? | ? | — | ? | ? | ? | ? | ◐ include-drafts toggle *(i)* | ? |

### 3.4 Columns, drill-down & output

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Monthly columns | ✓ default; Year / Quarter / Total | ✓ Columns grouping | ✓ daily → yearly cadence | ✓ 1 / 3 / 6 / 12 months | — | ? | ✓ *(i)* | ✓ bulanan / kuartal / tahunan | ? | ✓ *(i)* | ✓ (custom format: month-by-month complaint) |
| Prior-period / prior-year comparison | ◐ via Customize date column | ? | ? | ✓ MoM / YoY | — | ? | ◐ | ✓ compare periods | ◐ generic report claim | ✓ *(i)* | ✓ *(i)* |
| Drill line → transactions | ◐ amount → GL filtered; net income → IS Detail; **no detail view** | ✓ line → accounts → transactions | ? | ✓ hover top transactions → View Details | — | ? | ✓ *(i)* | ✓ (tutorial) | ? | ✓ *(i)* | ✓ *(i)* |
| Dimension filter | ◐ classification filter | ✓ entity | ✓ entity rollup | ✓ department (API) | — | ? | ? | ✓ branch / project / department | ? | ✓ analytic *(i)* | ✓ class / dept / location |
| Excel / PDF | ✓ Excel / PDF / CSV; "Export to Excel as seen" | ✓ Excel | ✓ xlsx | ✓ | ✓ (Cash Activity) | ✓ *(i)* | ✓ *(i)* | ✓ PDF / Excel | ✓ PDF / Excel / CSV | ✓ *(i)* | ✓ (CSV ~20k rows) |
| Saved views / report packages | ✓ custom report; packages ("quarterly board deck") | ? | ? | ✓ Financial Package | — | ? | ✓ | ✓ save as template | ? | ✓ *(i)* | ✓ schedule / email |
| Forecast next to actuals | ✗ "history, not a forecast" (Float integration) | ? | ◐ projected-transactions endpoint *(i)* | ◐ runway (narrative only) | ✓ burn + runway | ✓ short-term cash flow (Analytics) *(i)* | ◐ Cash flow planner *(i)* | ? | ? | ✗ | ◐ |

### 3.5 Indonesian standards

| Standard | Who | Cash flow statement required? | Method | Notes |
|---|---|---|---|---|
| **PSAK 2 → PSAK 207** *Laporan Arus Kas* (IAS 7) | Public-accountability entities; large private ones that opt in | ✓ | Direct **or** indirect; direct is *dianjurkan* (encouraged) | Interest and dividends received/paid shown separately and classified consistently; income tax paid in operating unless specifically linked to another activity; components of *kas dan setara kas* disclosed and reconciled to the Neraca |
| **SAK EP** (effective 1 Jan 2025, replaces SAK ETAP) | Private entities without public accountability, i.e. most Klay customers | ✓ | Direct **or** indirect | Follows IFRS for SMEs Section 7 *(i)*: interest/dividends may be operating, investing or financing |
| **SAK ETAP** (2011–2024) | Same population, until 2024 | ✓ | **Indirect only** | Why Indonesian SME accountants and KAP default to indirect |
| **SAK EMKM** | Micro and small | ✗ minimum set is Neraca, Laba Rugi, CaLK | — | Micro clients may never use the report |

**Setara kas:** short-term (usually ≤ 3 months), highly liquid, insignificant risk of a change in value. A deposito longer than 3 months and restricted cash fall outside it *(i, from the definition)*.

---

## 4. Vendor notes (UX and the ideas worth taking)

### DualEntry: closest peer (deep dive)

**Where and how:**
- Reports › Report Center › Financial Statements › **Cash Flow Summary**. It needs the financial-statements permission (Admin, Controller, Accountant, Finance, View-Only).
- It opens on **year to date** the first time and remembers the last preset per report, but not typed dates.

**Method:** indirect. *"Starts from net income and adjusts for non-cash items and working capital movements to arrive at cash from operations, then presents investing and financing activity and reconciles beginning to ending cash."* There is no direct option.

**Mapping:**
- The lines come from **a fixed set of categories derived from account type**: *depreciation on fixed assets, accounts receivable, other current assets, accounts payable, credit card, purchase of property and equipment, investments, long-term liabilities*.
- *"Because the mapping follows account type, there is no per-account cash flow category to configure and no mapping step to maintain."* So the only way to move an account is to change its type.
- DualEntry's types are bank, AR, unbilled AR, fixed asset, other asset (with subtypes), AP, credit card, long-term liability, other liability, equity, and income / COGS / expense / other.

**Layout:**
- **Header:** title, date-range picker, **Company** (building icon, multi-select + Apply), reporting-currency picker, **Book** (Primary Book unless Multi-Book).
- **Toolbar:** search, full screen, **Columns** (pivot icon: Year / Quarter / Month; Total/Monthly toggle), gear (*Open report settings* › *Report Format*: *Exclude zero balance*, adjusting entries *exclude* or *mix into periods* only), export.
- **Rows:** Operating (Net income → adjustments → working-capital lines) → Investing → Financing → beginning-to-ending cash reconciliation.
- **Columns:** **one column per month by default** (Aug 2026 change, "matching the Income Statement and Balance Sheet"). Splitting by month across a year is pitched as *"the quickest way to see seasonality in operating cash flow"*.

**Drill:**
- **Summary-only, no Detail tab**, *"because its lines are derived category totals rather than direct account balances"*.
- An account-backed amount opens the **General Ledger** filtered to the accounts and period behind it (added in 2026). Later fixes scoped the drill to the run window, not the calendar period, and kept elimination-company lines so the drill ties to the cell.
- **Net income** opens **Income Statement Detail**.
- For lines with no link: *"run General Ledger or Trial Balance Detail for the accounts in that cash flow category"*.

**Customize (Beta):**
- Works on the cash flow statement: Group / Account / Account Type / Formula rows, Date / Budget / Formula columns, saved as a custom report (configuration, not a snapshot).
- Combined with Date columns, this is how you'd get a prior-year comparative.

**Integrity:** the statement reconciles beginning to ending cash, but **nothing on the page checks ending cash against the Balance Sheet**. The documented practice is that the TB ties to the statements under the same filters.

**Output:**
- Excel / PDF / CSV as background jobs, plus **"Export to Excel as seen"** (keeps collapsed rows; Q4 2026).
- A report-export bug for some date ranges was fixed in Q3.
- Report packages list the cash flow statement in the "quarterly board deck" example.

**Not there:**
- direct method
- per-account mapping
- flux or budget on the cash flow
- a forecast (*"the cash flow statement reports history rather than a forecast"*; forecasting is pushed to the Float integration)
- an on-screen tie to the BS

**Copilot:** Q3 release notes fixed the copilot "incorrectly tell[ing] you that the cash flow statement doesn't exist" and now run the report directly. The cash flow statement is a natural question for an assistant.

### Rillet
- Generated automatically; operating *"start[s] from Net Income and adjust[s] for non-cash items and changes in working capital"*.
- **Mapping is by account subtype, one line per subtype**:
  - Operating: Stock comp, D&A, Change in AR, Change in Deferred Revenue, Change in AP, Other Change in WC.
  - Investing: Capex.
  - Financing: Long-term debt, Equity financing.
- To reclassify, you change the account's subtype in the COA, and it applies to future periods only.
- Closing = Opening + Net Change + **FX Impact** + **Retained Earnings adjustments**, as system rows.
- Cash includes restricted cash, which is also disclosed on its own line.
- Every line and subtotal drills to accounts → transactions, exportable to Excel. Filters: Period, Consolidation, Entity, Columns, Currency.

### Campfire
- An indirect statement in the API. **Per-account field `account_cashflow_classification` = NONE / OPERATING / INVESTING / FINANCING**, writable through Update Chart Account.
- **The statement "must reconcile (zero plug)"**. Otherwise the API returns **HTTP 422** with the plug by period and the journal entries whose accounts need a classification. This is the clearest model for "unmapped = blocking, and tell me which journals".
- A separate non-cash disclosures section and an FX-on-cash line. Cadence ranges from daily to yearly, plus `export=xlsx`.
- An undocumented "cash operating transactions with projected transactions" endpoint hints at forecasting.

### Digits
- The help centre shows a **cash-basis "Cash Flow"** view: Gross Income (in) vs Gross Burn (out) → Net Cash, with monthly columns (1/3/6/12), MoM / YoY, a hover card with top transactions, and View Details.
- The API has a formal indirect-style statement (CashFlowNetIncome, AdjustmentsToReconcileNetIncome, Investing, Financing, CashAtBeginning / NetCashIncrease / CashAtEnd).
- **A cautionary tale:** a community thread (now deleted; search snippet only) reported:
  - accumulated depreciation landing in investing instead of being added back in operating
  - gains on asset sales left in operating
  - fixed assets bought through AP inflating operating cash

  Digits said the allocation "can be improved".

### Puzzle
- **No cash flow statement.** *"Puzzle does not provide a cashflow statement"*. It offers a **Cash Activity Report** (cash in / cash out) as the friendlier substitute, plus burn and runway on the dashboard and in AI chat (3-month average burn).
- The cash and accrual ledgers run in parallel.

### Xero
- **Statement of Cash Flows, direct method only**, since Dec 2015. It comes with a layout editor (move sections, split debits/credits). The older **Cash Summary** shows cash in and out for selected accounts.
- **Indirect method** is the top request: 142 votes, first raised Dec 2019, still "submitted" in Jul 2026. One commenter says only Xero HQ (practice tool) has it.
- Complaints:
  - Mapping follows account type and can't be fixed per account (a request for a per-account cash flow setting, Jul 2026).
  - **Non-cash manual journals** (depreciation, accruals, payroll) leak in unless "Show journal on cash basis reports" is unticked one journal at a time.
  - Credit-card accounts count as cash ("Gaining Support", Aug 2026).

### QuickBooks Online
- Reports › Statement of Cash Flows, accrual-based. The method isn't named, but it reconciles net income to cash *(i)*.
- **Mapping is fixed by account type** (e.g. any Long-term Liability → Financing). **No reclassification in QBO.** "Classify Cash" exists only in QuickBooks Desktop, and users who look for it in QBO are told it's gone.
- Complaints: deferred tax and lease liabilities land in the wrong section, and invoices/payments show as confusing AR swings.
- Customisation: period, display columns (by month etc.) and non-zero filtering. The Custom Report Builder is Advanced only.

### Accurate Online: the local reference (thin evidence)
- **Laporan › Daftar Laporan › Keuangan › Laporan Arus Kas** (partner tutorials; the help centre isn't readable).
- The tutorial's output lines: *kas awal periode · total penerimaan kas · total pengeluaran kas · kas akhir periode*, grouped into operating / investing / financing. That reads like **direct-style totals** *(i)*.
- One partner says Accurate shows direct **and** indirect "depending on the transactions recorded". This is unverified.
- Parameters: period (monthly / quarterly / yearly), branch / project / department, "monthly figures or summary only". Clicking a section shows the transactions. PDF / Excel export; the format can be saved as a template.
- A tutorial tells users to *check "akun-akun yang dipetakan ke aktivitas arus kas"*, which implies a mapping exists, but **where it's set isn't documented publicly**.
- Accurate's blog explains indirect as the common method: add back depreciation and amortisation, subtract increases in receivables and inventory, add increases in payables.

### Mekari Jurnal
- **Laporan › Sekilas Bisnis › Arus Kas.** The **settings button lets the user pick the method**. The blog names **"Default Direct"**, and blog screenshots show both a direct and an indirect report from the app.
- Export via **Expor** to PDF / Excel / CSV.
- The mapping is most likely Jurnal's fixed account categories (Kas & Bank, Piutang, Aset Tetap, Depresiasi & Amortisasi, …) *(i)*. No per-account cash flow field was found.
- "Cash Mapping" in Jurnal is a bank-reconciliation feature, **not** cash flow mapping.

### Odoo
- A **direct-style statement**: it takes every entry touching a bank or cash journal and classes the *other* side by **account tag**: *Operating Activities*, *Financing Activities*, *Investing & Extraordinary Activities*, set on each account in the COA.
- Lines include *Advance payments received from customers*, *Cash received from operating activities*, *Cash paid for operating activities*, and cash in / cash out per section.
- **Untagged movements appear under "Cash flows from unclassified activities"**, e.g. the tax portion of a payment or bank suspense lines.
- Opening cash + section totals = closing cash.
- There are no depreciation or working-capital lines, because only cash moves are read.

### NetSuite
- **Indirect, US (FASB) layout**: Net Income → *Adjustments to Net Income* (one row per account type: AR, Inventory, Other Current Asset, AP, …) → Investing (Fixed Asset, Other Asset) → Financing (Long Term Liabilities, Equity).
- Any other country has to customise it in the **Financial Report Builder**, which can regroup by account, class, department, location or subsidiary.
- **Proof block:** Net Change in Cash → Cash at Beginning of Period (from the Cash Statement: bank + undeposited funds) → *Effect of Exchange Rate on Cash* → Cash at End of Period. The FX row offsets CTA so that ending cash equals the BS. Custom sections break beginning cash unless the Cash Statement is customised to match.
- Depreciation isn't added back on its own: accumulated depreciation is a Fixed Asset type, so it nets into investing *(i)*.
- A column picker gives periods, class, department, location and subsidiary.

---

## 5. Patterns across the market

1. **Indirect is the accountant's statement; direct is the owner's.** Every close-focused tool (DualEntry, Rillet, Campfire, NetSuite) is indirect. Owner-focused tools go direct or cash in/out: Xero, Odoo, Puzzle's Cash Activity, Digits' UI. Jurnal is the only one offering both. Klay's buyers are finance teams preparing SAK EP statements, which points to indirect first.
2. **Mapping by type without an override produces the complaints.** QBO, Xero and Digits users can't fix a misclassified account. DualEntry chose the same "no mapping step" trade-off. Odoo and Campfire put the class on the account, and NetSuite puts it in a report builder. A **default from type or group plus a per-account override** gives zero setup with an escape hatch.
3. **The proof is either hidden or enforced, never shown.** DualEntry and Rillet compute beginning → ending, while Campfire refuses to return a statement that doesn't tie. Nobody shows the reviewer "✓ Ending cash = BS cash" with a link to the cause when it fails. Klay's BS already does this for two identities.
4. **Unclassified movement needs a name.** Odoo's explicit section and Campfire's list of offending journals are honest. Rillet's "Other change in WC" and NetSuite's CTA absorption hide the problem.
5. **Depreciation, disposals and capex on credit are where statements go wrong.** The Digits thread and the Xero non-cash-journal idea are the evidence. A correct design adds back depreciation from the expense (or the depreciation journals), moves gain/loss on disposal out of operating, and treats asset purchases through AP as a non-cash investing item.
6. **Cash flow is history, forecast is separate.** DualEntry says so explicitly, and Puzzle and Digits put runway elsewhere. Klay's *Cash Position & Aging* page already covers the forward look ("cash in 30 days").
7. **Drill on a derived statement is weak everywhere.** DualEntry has no detail view and jumps to the GL, and only Rillet drills line → accounts → transactions. Klay's side panel is a chance to do better without leaving the report.

---

## 6. Proposed scope for Klay

The Linear design scope (3 days) holds up against the market. The table adds the edges that come out of the benchmark.

| # | Item | Release | Why |
|---|---|---|---|
| 1 | **Indirect method**: Net profit/(loss) → adjustments for non-cash items → changes in working capital → *Kas bersih dari aktivitas operasi*; then investing and financing | **V1 (MVP)** | SAK ETAP trained every local SME accountant and KAP on indirect; all close-focused peers use it; it reuses `computeBalanceSheet` + `computeProfitLoss` with no new data. |
| 2 | **Three sections + summary block**: Net increase/(decrease) in cash · Cash at beginning · Cash at end (*Kenaikan (penurunan) bersih kas dan setara kas · Kas dan setara kas awal/akhir periode*) | **V1 (MVP)** | Required by PSAK 2 / SAK EP; every vendor ends this way. |
| 3 | **Default mapping from the COA group** (see §2 table), with the exceptions pre-set: accumulated depreciation → non-cash add-back; RE / current-year earnings → excluded; deferred tax → operating; dividends payable / assets held for sale → financing / investing | **V1 (MVP)** | Zero setup, like DualEntry, without its "no override" trap; the Klay chart's groups already line up with the three activities. |
| 4 | **Per-account "Cash flow" field on Settings › Chart of accounts**: a column on the list ("Operating · default") and a select in the edit dialog (Cash & cash equivalent / Operating / Investing / Financing / Non-cash, excluded), gated by `coa.manage`, written to the settings audit log | **V1 (MVP)** | Mapping belongs on the account, where Odoo and Campfire put it, not inside the report. QBO and Xero users complain because they can't do this. Keeping it next to the account's type and dimensions makes it one place to look. |
| 5 | **"Cash & cash equivalent" flag** defaulted from `g-cash`, with Time deposits and Restricted cash **off** by default (SME to confirm) | **V1 (MVP)** | PSAK 2's definition of *setara kas*; otherwise beginning/ending cash won't match what the auditor expects. |
| 6 | **On-screen proofs**, BS-style banner: ✓ *Ending cash = Balance Sheet cash and cash equivalents at {date}* · ✓ *Net profit ties to the P&L* · ✕ *N accounts moved but aren't mapped* (link to them) | **V1 (MVP)** | No vendor shows the tie; it's the Linear acceptance check; the pattern exists on the BS page. |
| 7 | **"Unclassified" line** inside operating, shown only when non-zero, with a warning pill and the accounts behind it (never a silent plug) | **V1 (MVP)** | Odoo's honest bucket plus Campfire's "tell me which accounts"; keeps the proof truthful. |
| 8 | **Depreciation & amortisation add-back from the depreciation journals / expense**, with gain/loss on disposal moved to investing | **V1 (MVP)** | The most-reported error (Digits); without it, operating and investing are both wrong on every company with fixed assets. |
| 9 | **Lines expand to accounts; amount opens the Transactions panel** (account movement for the period); Net profit links to the P&L for the same range | **V1 (MVP)** | Beats DualEntry's "no detail view, go to GL"; reuses `TransactionsPanel`; CFO feedback (16 Nov) asked for drill without leaving the report. |
| 10 | **Period picker** (shared presets + custom), default **year to date** like the P&L; **Final / Preliminary** pill + unposted count | **V1 (MVP)** | Same controls as the P&L; preliminary context is a Klay differentiator no peer has. |
| 11 | **Compare with the same period last year** (the statutory comparative), one comparison at a time like BS/P&L | **V1 (MVP)** | SAK EP statements are always comparative; auditors and banks read two years side by side. |
| 12 | **Bahasa labels in print and Excel** (SAK EP wording), English on screen, same `lang` setting as BS/P&L | **V1 (MVP)** | Linear scope; LK is filed in Bahasa. |
| 13 | **Excel with live formulas + CSV + Print/PDF** with company header and signature block | **V1 (MVP)** | Linear scope; reuses `xlsxExport` and the BS print layout; auditors tick the Excel. |
| 14 | **Monthly columns** (months of the period, oldest → newest, with Total) | **V1.1** | DualEntry's default and good for seasonality, but the year-end comparative matters more for SMEs; the BS/P&L column modes can be reused. |
| 15 | **Separate interest paid, income tax paid, dividends paid lines** (expense ± Δ payable) and a company policy for interest classification (operating vs financing) | **V1.1** | PSAK 2 / SAK EP disclosure; needs an SME call on policy. |
| 16 | **Non-cash investing & financing note** (asset bought through a bill, loan-funded asset, dividend declared not paid) | **V1.1** | Needed for a correct investing line when capex is on credit; needs journal-level detection (bill line to a PPE account). |
| 17 | **Saved views** | **V1.1** | Same `ViewsPopover` as the other reports; low effort, low urgency. |
| 18 | **Direct method** (receipts from customers, payments to suppliers / employees / taxes) as a second view, built from cash-account journals classed by counterparty (Odoo-style) | **Later** | Jurnal defaults to it and owners read it more easily; PSAK encourages it. Klay's payments and invoices carry the source, so it's feasible, but it doubles the design and QA. Waiting on SME Q1. |
| 19 | **Effect of exchange-rate changes on cash** line | **Later** | Required once foreign-currency bank accounts are revalued; the prototype has no revaluation yet (BCA USD/SGD/EUR held at IDR book value). |
| 20 | **Report packages** (BS + P&L + Cash flow, one PDF/Excel) | **Later** | DualEntry's board deck; revisit with P&L/BS packs. |
| 21 | **Rename the existing *Cash Position & Aging* route/card** away from `cashflow` | **V1 (MVP)**, housekeeping | Two "cash flow" entries on the Reports hub will confuse users and links. |
| 22 | Dimension filter | **Not now** | A dimension-filtered cash flow doesn't tie (same reason the BS left it out). |
| 23 | Cash forecast / runway / 13-week cash | **Not now** | History vs forecast are separate jobs (DualEntry, Puzzle); *Cash Position & Aging* already covers "cash in 30 days". |
| 24 | User-editable statement layout (custom rows / formula rows) | **Not now** | Only NetSuite and Xero do it well; the per-account field covers the real need. |
| 25 | Adjusting-entries control, variance flags, review notes | **Not now** | The P&L dropped its Adjustments control (11 Nov); flux on a derived statement adds little before the BS/P&L reviews are used. |
| 26 | Multi-entity consolidation | **Not now** | Klay V1 is single-entity. |

**Rough computation, for the design hand-off:**
- **Operating:** P&L net profit for [from, to] + depreciation & amortisation − gain + loss on disposal ± Δ of every account mapped Operating (assets: increase = outflow; liabilities: increase = inflow) ± Unclassified.
- **Investing:** − Δ of accounts mapped Investing, at cost, with depreciation excluded.
- **Financing:** Δ of accounts mapped Financing, with dividends declared netted.
- **Cash:** beginning = Σ cash & cash-equivalent accounts at `from − 1`; ending = the same at `to`.
- **The proof is an identity:** if the ledger balances and every BS account has a class, beginning + net change = ending by construction. The check therefore catches unbalanced opening balances, unmapped accounts and a wrong cash definition, which is exactly what a reviewer needs to know.

---

## 7. Open SME questions (for Fidya / SME)

1. **Method:** do Klay's target clients and their KAP expect **indirect** (the SAK ETAP habit), or do owners want **direct** (Jurnal's default, "uang masuk dari pelanggan")? Is indirect alone acceptable for V1?
2. **Cash and cash equivalents:** should *Deposito* (time deposits), *Kas yang dibatasi penggunaannya* (restricted cash) and *Kas dalam perjalanan* (cash in transit) count as cash on the statement? Does the auditor want deposits ≤ 3 months in and longer ones out?
3. **Interest and dividends:** which classification do clients use? Interest paid: operating or financing. Interest received: operating or investing. Should it be a company setting?
4. **Income tax paid:** a separate line in operating (*Pembayaran pajak penghasilan*), or left inside the working-capital changes?
5. **Mapping:** is a per-account "Cash flow" field on the chart of accounts the right place? Who should be allowed to change it: Finance Manager only, or anyone with `coa.manage`? Does a change apply to past periods? Rillet applies it to future periods only.
6. **Unclassified:** should an unmapped movement **block** a Final statement (Campfire-style) or just show a warning line?
7. **Columns:** is "this year vs last year" enough for V1, or do clients need monthly columns for banks or owners?
8. **Labels:** which Bahasa wording do auditors expect? For example, *Kas bersih diperoleh dari (digunakan untuk) aktivitas operasi* vs *Arus kas bersih dari aktivitas operasi*, and *Laporan Arus Kas* vs *Laporan Arus Kas (Metode Tidak Langsung)* as the title.
9. **Non-cash transactions:** do auditors ask for the note on non-cash investing/financing (asset bought on credit, leases under PSAK 73)?
10. **Naming on the Reports hub:** rename *Cash Position & Aging* so there is only one "Cash flow"?

---

## 8. Caveats on the evidence

- **Accurate and Jurnal are thinly sourced.** Both help centres returned 403 or showed only their home page. The Accurate facts come from partner tutorials (trainingaccurate.com, acisindonesia.com) and Accurate's own blog. The Jurnal facts come from its blog, whose screenshots aren't readable as text. Neither vendor's mapping mechanism is confirmed; a trial account or screen walkthrough is needed before the PRD.
- **Xero Central** returned an empty page or CAPTCHA (not bypassed). Xero facts come from Product Ideas, the API description and press.
- **Campfire** is known from its API reference only; the help centre is behind a login.
- **Digits:** the classification-bug thread is deleted, so it's known from search snippets. Treat it as a historical report, not current behaviour.
- **Prompt-injection text:** Rillet and Digits help pages carry "Agent Instructions" blocks aimed at AI tools, and a Campfire page has an index prompt. They were ignored.
- **Standards:** PSAK 2 / 207 and SAK EP points come from university and practitioner summaries (BINUS, UI, UGM), not the IAI text. The SAK EP interest/dividend options are inferred from IFRS for SMEs Section 7. Check against the IAI text before quoting.
- **Pages were read by a summarising model.** Check exact UI labels against the linked page before putting them in a PRD.
- **No screenshots saved.** DualEntry has no public image of its cash flow statement.

---

## 9. Sources

### 9.1 Articles

**DualEntry**
- [Standard financial statements reference](https://docs.dualentry.com/accountants/reporting-analytics/standard-financial-statements.md) · [Run financial statements (incl. *Trace a cash flow line*)](https://docs.dualentry.com/accountants/reporting-analytics/run-financial-statements.md) · [Custom report builder](https://docs.dualentry.com/accountants/reporting-analytics/custom-report-builder.md)
- [Chart of accounts](https://docs.dualentry.com/accountants/core-financials/general-ledger/chart-of-accounts.md) · [Exporting & report groups](https://docs.dualentry.com/accountants/reporting-analytics/exporting-and-report-groups.md) · [Report packages](https://docs.dualentry.com/accountants/reporting-analytics/report-packages.md) · [Float integration](https://docs.dualentry.com/accountants/integrations/spend-and-accounts-payable/float.md)
- Release notes: [17 Aug 2026 (monthly cash flow by default)](https://docs.dualentry.com/developers/release-notes/2026-08-17) · [Changelog Q3 2026 (column picker, drill-down, export fix, copilot)](https://docs.dualentry.com/developers/release-notes/changelog-2026-q3)

**Rillet**
- [Understand the cash flow statement](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/financial-statements/understand-the-cash-flow-statement) · [API: cash flow statement report](https://docs.api.rillet.com/reference/retrieve-cash-flow-statement-report) · [API changelog](https://docs.api.rillet.com/changelog/cash-flow-statement-report)

**Campfire**
- [Get cash flow statement (API)](https://docs.campfire.ai/api-reference/financial-statements/get-cash-flow-statement.md) · [Get cash flow (v1)](https://docs.campfire.ai/api-reference/financial-statements/get-cash-flow.md) · [Update chart account](https://docs.campfire.ai/api-reference/company-objects/update-chart-account.md) · [Projected transactions](https://docs.campfire.ai/api-reference/financial-statements/get-cash-operating-transactions-with-projected-transactions.md)

**Digits**
- [Financials (help)](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/financials) · [API: cash flow](https://developer.digits.com/reference/ledgerstatementsservice_cashflow) · [Community: issues with the cash flow report](https://community.digits.com/general-45/issues-with-the-cash-flow-report-444) (deleted)

**Puzzle**
- [What reports does Puzzle provide](https://help.puzzle.io/en/articles/8441346-what-reports-does-puzzle-provide) · [Reports feature page](https://puzzle.io/wip/features/reports)

**Xero**
- [Accounting Today: Xero adds Statement of Cash Flows (2015)](https://www.accountingtoday.com/news/xero-adds-statement-of-cash-flows-report) · [Idea: indirect method](https://productideas.xero.com/forums/967133-reports-tax/suggestions/44961463-reporting-statement-of-cash-flow-indirect-metho) · [Idea: exclude non-cash journals](https://productideas.xero.com/forums/967133-reports-tax/suggestions/44961184-reporting-statement-of-cashflows-exclude-non-ca) · [Idea: exclude credit cards](https://productideas.xero.com/forums/967133-reports-tax/suggestions/51583337-excluding-credit-card-balances-from-statement-of-c) · [Finance API (method)](https://cdn.jsdelivr.net/npm/xero-node@17.0.0/dist/gen/api/financeApi.d.ts) · [Cash Summary](https://maestrano.atlassian.net/wiki/spaces/UKB/pages/42598495/Cash+Summary)

**QuickBooks Online**
- [Run a statement of cash flows](https://quickbooks.intuit.com/learn-support/en-us/help-article/financial-reports/run-statement-cash-flows/L7f72hT6Q_US_en_US) · [Community: classification](https://quickbooks.intuit.com/community/reports-and-accounting-5/statement-of-cash-flows-classification-48445) · [Community: non-cash transactions](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/statement-of-cash-flows-shows-non-cash-transactions/00/1461351) · [Community: can't reclassify](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/can-i-reclassify-the-account-in-the-statement-of-cash-flow-ex/01/726739) · [Advanced custom cash flow](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-reports/quickbooks-online-advanced-cash-flow-chart-custom/L73lP5pEb_US_en_US) · [Lutz: understanding QBO cash flow](https://www.lutz.us/blog/understanding-the-cash-flow-statement-in-quickbooks)

**Accurate Online**
- [Fitur laporan keuangan](https://accurate.id/online/fitur/laporan-keuangan/) · [Blog: arus kas metode tidak langsung](https://accurate.id/akuntansi/arus-kas-metode-tidak-langsung/) · [Blog: mengenal laporan arus kas](https://accurate.id/akuntansi/mengenal-laporan-arus-kas/)
- Partner tutorials: [Training Accurate](https://trainingaccurate.com/blog/buat-laporan-arus-kas-di-accurate-online/) · [ACIS Indonesia](https://www.acisindonesia.com/cara-membuat-dan-menganalisis-laporan-arus-kas-di-accurate-online/)

**Mekari Jurnal**
- [Laporan dan contoh arus kas (Default Direct, Expor)](https://www.jurnal.id/id/blog/laporan-dan-contoh-arus-kas/) · [Direct vs indirect](https://www.jurnal.id/id/blog/perbedaan-laporan-arus-kas-metode-langsung-dan-tidak-langsung/) · [Metode tidak langsung (PSAK 207)](https://www.jurnal.id/id/blog/metode-tidak-langsung-arus-kas/) · [Report features](https://www.jurnal.id/en/features/business-financial-reports) · [Cash Mapping (bank recon, not cash flow)](https://www.jurnal.id/id/blog/pelajari-lebih-lengkap-tentang-fitur-cash-mapping-dari-jurnal/)

**Odoo**
- [Forum: how Odoo 16 generates the cash flow statement](https://www.odoo.com/forum/help-1/v16-how-does-odoo-generate-cash-flow-statement-operating-financing-investing-activities-235233) · [Forum: tags on accounts](https://www.odoo.com/forum/help-1/seting-up-cashflow-statement-in-odoo-using-tags-in-accounts-209172) · [Cybrosys: Odoo 18 cash flow](https://www.cybrosys.com/blog/an-overview-of-cash-flow-statement-in-odoo-18-accounting) · [Cybrosys: Odoo 16 cash flow](https://www.cybrosys.com/blog/what-is-cash-flow-statement-in-odoo-16-accounting) · [Braincuber: Odoo 18 guide](https://www.braincuber.com/tutorial/cash-flow-statement-odoo-18-guide)

**NetSuite**
- [Statement of Cash Flows](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2103273.html) · [Standard cash flow layout](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1537569297.html) · [Cash Statement](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2104490.html) · Community: [direct method](https://community.oracle.com/netsuite/english/discussion/4473524/direct-method-statement-of-cash-flows) · [cash flow classes](https://community.oracle.com/netsuite/english/discussion/4240504/cash-flow) · [report writer format](https://community.oracle.com/netsuite/english/discussion/4334027/netsuite-financial-report-writer-cash-flow-statement-format)

**Indonesian standards & practice**
- [BINUS: PSAK 2 (penyesuaian 2014)](https://accounting.binus.ac.id/2017/08/30/psak-2-penyesuaian-2014-laporan-arus-kas/) · [UI OCW: PSAK 2](https://ocw.ui.ac.id/mod/resource/view.php?id=72) · [UGM: SAK ETAP diganti SAK EP](https://imagama.feb.ugm.ac.id/dianggap-terlalu-sederhana-untuk-entitas-privat-sak-etap-diganti) · [OJK PAPSI BPRS: arus kas (indirect)](https://ojk.go.id/id/regulasi/Documents/Pages/SEOJK-tentang-Pedoman-Akuntansi-Perbankan-Syariah-Indonesia-bagi-Bank-Pembiayaan-Rakyat-Syariah/PAPSI%20BPRS%20-%2014%20Laporan%20Arus%20Kas%20(132-135).pdf)
- SAK EMKM minimum set: [Jurnal: urutan laporan keuangan](https://www.jurnal.id/id/blog/urutan-laporan-keuangan/) · [Jurnal: laporan keuangan UMKM](https://www.jurnal.id/id/blog/contoh-cara-membuat-laporan-keuangan-sederhana-untuk-umkm/)
- Other local tools: [Kledo financial reports](https://kledo.com/financial-report/) · [Zahir: direct vs indirect](https://zahiraccounting.com/id/blog/direct-atau-indirect-membuat-laporan-arus-kas/)

### 9.2 Candidate screenshots (not downloaded)

None found that show a vendor's cash flow statement UI with readable labels. The Jurnal blog posts above embed screenshots of its direct and indirect reports. Saving them into `docs/research/cash-flow/<vendor>/` needs a go-ahead.
