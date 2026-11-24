# Director's Summary — product discovery & competitor benchmark

**Status:** Draft for review · **Date:** 24 Nov 2026 · **Page:** Reports › Director's Summary (proposed `/reports/directors-summary`; not built yet). CEO name: "Executive Summary".

Benchmarked against DualEntry, Rillet, Campfire, Digits, Puzzle, Xero, QuickBooks Online, Accurate Online, Mekari Jurnal, Odoo and NetSuite, with Fathom, Spotlight Reporting and Syft as reference for KPI choice, commentary and board-pack layout. Everything comes from public docs, help centres, release notes, marketing pages and vendor forums, read on 24 Nov 2026. See [§8 Caveats](#8-caveats-on-the-evidence) before quoting anything as fact. Companion to the [Trial Balance](../trial-balance/README.md) and [Profit & Loss](../profit-loss/README.md) research.

**Brief.** A one-page summary for the company's directors (*Direksi*, and the *Dewan Komisaris* that oversees them). It takes headline numbers from the P&L, Balance Sheet, Cash Flow (*Arus Kas*) and Changes in Equity (*Perubahan Modal*), compares the current period with the prior one, carries short commentary, and prints or saves as PDF. Michael (Slack, 24 Nov): the Executive Summary goes with the other reports "since that's what we really want to show to the directors".

---

## TL;DR

1. **Nobody ships a one-page summary of all four statements.** There are two kinds of product.
   - **A fixed "Executive Summary" report:** Xero and Odoo. Odoo's metric list is close to a copy of Xero's: cash, profitability, balance sheet, performance ratios, and position.
   - **A configurable pack or dashboard:** DualEntry Packages, QBO Management reports, Digits Custom Reports, and Fathom, Spotlight and Syft.
   - **No one puts Changes in Equity on the summary.** Xero shows "net assets" and stops there. Klay is about to have all four statements tying to each other (`cashFlow.js` and `changesInEquity.js` are in progress), so it can be the first summary whose numbers provably agree.
2. **DualEntry has no executive summary in the product.**
   - Its dashboards are screen-only widget boards with no comparison.
   - Its Report Packages are a PDF or Excel bundle (cover page, then statements) with no narrative.
   - The best DualEntry reference is its free **board-report template**: a *Board Summary* sheet with headline tiles, a "What the board should know" table (area / what changed / recommendation), then decisions.
   - **Digits' Executive Summary page** is the closest product analogue: KPI tiles, a commentary box that AI can draft, a cover page, and Draft → Final.
3. **The KPIs converge.** The ones that appear by default most often are revenue, gross profit and margin, net profit and margin, and closing cash, followed by receivables and payables, the current ratio, and AR/AP days.
   - Burn and runway are a US-startup set: Digits, Puzzle, Campfire, Rillet, and DualEntry's template.
   - Debt-to-equity is in KPI libraries (QBO, Fathom) and in the Indonesian *ikhtisar keuangan*, but not on Xero's or Odoo's summary.
4. **Comparison defaults to this period vs the previous one, with a variance %.** That's Xero, Odoo, NetSuite, QBO and Spotlight.
   - Same period last year and YTD are the next things users ask for.
   - Xero users complain that the comparison choice isn't remembered.
   - Indonesian annual reports compare **years** (3-year *ikhtisar*).
5. **Commentary is moving to "AI drafts, a human edits".** QBO Finance AI, Digits, Fathom Commentary Writer, Spotlight AI Suggestions, Syft, and DualEntry (flux only) all keep a person in the loop.
   - Xero and Odoo offer only manual notes.
   - NetSuite's AI narrative has no edit step.
   - The Indonesian tools (Accurate Ailita, Jurnal Airene) put AI in a chat or side tab, and Airene answers in English.
   - Klay AI isn't in the MVP, so V1 is a **manual note plus rule-based highlights**, built so an AI draft can drop in later.
6. **Screen and PDF together is the norm.** The pack needs a cover (logo, company, period, prepared by) and, in Digits, a Draft/Final freeze.
   - Drill-down goes from the summary to the statement (Xero, QBO, Odoo, Digits).
   - Drill-down to transactions happens inside that statement.
7. **Neither Indonesian competitor has a director-ready one-pager.** Accurate has a dashboard, a *Rasio Keuangan* report and Ailita chat. Jurnal has a dashboard, a "Ringkasan bisnis" report and Airene. A Bahasa-printing, four-statement summary with sign-off is open ground.

---

## 1. Who uses it and what for

| Who | When | Job to be done | What they need from the page |
|---|---|---|---|
| **Director / Direktur Utama / owner** (reader) | Monthly or quarterly direksi meeting; before a bank or investor meeting | "Are we making money, do we have cash, and is anything getting worse?" | A handful of numbers, each against last period, in plain words; red for losses; one page |
| **Commissioner** (*Dewan Komisaris*, reader) | Quarterly or at year-end, often on paper | "Is management running the company safely?" | Profit, cash, leverage (DER) and liquidity (current ratio), year on year; a signed, printed page |
| **Finance Manager / Controller** (preparer) | After the month is closed | "Turn the closed books into something the board will read, and explain the big moves." | Numbers that match the statements exactly, a place to write the explanation, period status, a clean PDF |
| **CEO (Michael's framing)** | Demo, sales | "Show directors the value of the books in one screen." | A polished hero layout, like Klay Impact |
| **Bank / investor** (occasional reader) | Loan covenant review, fundraising | "Are the ratios within covenant?" | DER, current ratio, and the statements behind them |

**Key moments:** right after the monthly close, quarterly board meetings, the year-end RUPS pack, and bank covenant reporting.

---

## 2. Klay today

There's no Director's Summary page yet, but most of the building blocks exist.

| Area | What exists | Reuse for the summary |
|---|---|---|
| **Reports hub** (`src/pages/ReportsPage.jsx`) | A card grid driven by a `REPORTS` array. Order: Klay Impact, GL, TB, P&L, BS, Cash Position & Aging, Tax Register. There are no Cash Flow or Changes in Equity cards and no routes for them in `App.jsx` yet. | Add one card. It probably belongs first or second, since it's the report the CEO wants directors to see. |
| **Hero layout** (`KlayImpactPage.jsx` + `klay-impact.css`) | **Hero band** (`.ki-band`) with a tinted wash and 20px radius. It holds a back link, a pill segmented period control (`.ki-seg`), an uppercase eyebrow ("Klay Impact · range"), a 28px display title, a lede, and two **summary boxes** (`.ki-box`). Each box has a 4px hue stripe, an icon, a 40px figure, its top 4 contributors with amounts, and "See all ↓". Below the band is a tabbed table card and a footnote. | Directly reusable for the summary's top: an eyebrow with "Director's Summary · Oct 2026", a title with the company name, then the KPI tiles. The 4-box variant needs a smaller figure (about 28px). |
| **Insights pattern** (`CommandCenterPage.jsx`, `src/lib/homeInsights.js`) | A provider registry `(ctx) => Insight[]`. The insight shape is `{ headline, label, detail, tone: neutral/positive/warning, to, cta }`. It's deterministic, rule-based text such as "62% of 60+ day overdue AP sits with the top 3 vendors". Command Center also has a `ki-home` strip that teases Klay Impact from the home page. | The same shape can produce the **auto Highlights**, rule-based with no AI (e.g. "Revenue up 12% vs Sep", "Cash down Rp 1,2 M, mostly investing"). A `ki-home`-style strip could link the summary from Command Center for directors. |
| **P&L** (`src/lib/profitLoss.js`) | `computeProfitLoss` gives `totals` (revenue, contra, netRevenue, cogs, grossProfit, opex, operatingProfit, otherIncome/Expense, profitBeforeTax, tax, netProfit) and `margins` (gross, operating, net). Also `change(current, prior)` returning `{ diff, pct }`, `unpostedInPeriod`, and Bahasa labels on every line. Losses are labelled "profit/(loss)" and shown in red (SME, 11 Nov). | Every P&L number the summary needs. Margins are shown as **rows** under their profit line, matching the P&L decision ("margin rows not KPIs"). |
| **Balance Sheet** (`src/lib/balanceSheet.js`) | `computeBalanceSheet(asOf)` gives `totals` (current and non-current assets, total assets, current and non-current liabilities, total liabilities, total equity, working capital), `byNode` (e.g. `g-ar` trade receivables, `g-trade-payable`, `g-cash`), `difference` and `balanced`. `bsRatios()` returns **currentRatio, debtToEquity, workingCapital**. The BS page already prints them as ratio rows (*Modal kerja*, *Rasio lancar*, *Rasio utang terhadap ekuitas*) with live Excel formulas. | Position card and ratio rows. Use the same ratio definitions and labels so the summary and the BS can't disagree. |
| **Cash Flow** (`src/lib/cashFlow.js`, untracked, work in progress) | Indirect method. `computeCashFlow` gives `sections` (operating, investing, financing), `netChange`, `cashStart`, `cashEnd`, and `ties` (start + change = end, proved against the BS). Bahasa section labels. | Cash card: start, the three activities, end. |
| **Changes in Equity** (`src/lib/changesInEquity.js` + `ChangesInEquityPage.jsx`, untracked, work in progress) | `computeChangesInEquity` gives opening and closing equity by component, movement rows (profit, capital, dividends…), `ties` and `bsTotal`. The page isn't routed yet. | Equity card: opening, profit/(loss), owner movements, closing. |
| **Cash position** (`src/lib/cashPosition.js`) | **Book bank balance** per bank account, split into available vs unavailable (time deposit, tax account, restricted). It deliberately differs from GL cash: the demo chart has two codes for some banks (1-1500 vs 11110). | Optional "of which available" sub-line on the cash tile. **Pick one cash definition for the tile** (see §7 Q5). |
| **Aging** (`arAging.js`, `apAging.js`) | AR/AP outstanding, overdue and due-in-7-days. `dsoDays` / `dpoDays` are a **remaining-weighted average age**, *not* DSO/DPO (the code comments say so). | Receivables and payables rows are V1. True AR/AP days need revenue and purchases as the base (V1.1). |
| **Periods** (`src/lib/reportPeriods.js`) | Presets (this month, last month, this quarter, YTD, last fiscal year), `previousPeriod`, `sameDayLastYear`, `splitPeriod`, `recentMonthEnds`. | Compare with the previous period or the same period last year; 6-month trend later. |
| **Statement kit** (`src/components/StatementKit.jsx` + `src/pages/statements.css`, untracked, work in progress) | Shared by the "Phase 2 statements — Changes in Equity, Cash Flow, Director's Summary": `rp` / `rpShort` / `pct`, `Lbl` (English on screen, Bahasa in print), `PrintHead`, `SignOff` (Disiapkan / Diperiksa / Disetujui), and `UNITS`. `statements.css` **already sketches a `.ds-*` layout**: 4-up tiles with up/down deltas and red losses, a 2-column grid of compact table cards linking to their statements, a commentary card (textarea, highlight bullets with good/warn dots, author meta), and print rules (tiles stay 4-up, cards 2-up, textarea swapped for printed text). | The skeleton's in place; this benchmark mostly confirms it. The open choices are where commentary sits and which KPIs go in the tiles. |
| **Close context** | `periodCloseState` (`trialBalance.js`), `useClosePeriod`, and the unposted-journals banner on the TB, P&L and BS. | Show **Closed / Open** and "N journals not posted" on the summary and in the print header. A director should know whether the numbers are final. |
| **Audience role** (`src/data/seed/roles.js`) | `view_only`: "Read-only oversight — owner, director, external auditor, investor… writes nothing." | Directors can read the summary but can't write commentary. Commentary needs a finance role. |

**Gaps found while reading the code**
- No **budget** anywhere, so nothing can be compared against budget.
- No stored **commentary per period**. Notes and the Review log exist for variances only.
- No AI. Per the JE research, Klay AI isn't in the MVP.
- No report pack, scheduling or email delivery.
- No true DSO/DPO.
- Two "cash" figures: GL cash and equivalents on the BS and CF vs the bank book balance in Cash Position.

---

## 3. Functionality benchmark

**Legend:** ✓ documented · ◐ partial / workaround / other screen · ✗ documented as missing · ? not found in public sources · *(i)* inferred · *(M)* marketing only

**Abbreviations:** DE = DualEntry · Ril = Rillet · Camp = Campfire · Dig = Digits · Puz = Puzzle · QBO = QuickBooks Online · Acc = Accurate Online · Jur = Mekari Jurnal · NS = NetSuite · Fat = Fathom · Spot = Spotlight Reporting · Syft = Syft Analytics

### 3.1 Format & placement

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS | Fat | Spot | Syft |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fixed one-page executive summary report | ✗ (Excel board template only) | ◐ Executive P&L | ◐ CFO dashboard template (M) | ✓ Executive Summary page in Custom Reports | ◐ dashboard cards | ✓ Executive Summary | ◐ Business snapshot; exec-summary text page in Management reports | ✗ | ◐ "Ringkasan bisnis" (M) | ✓ Executive Summary | ✗ | ✓ Summary Reports / KPI Summary | ✓ Executive Summary page | ✓ templates (M) |
| KPI dashboard (screen) | ✓ widgets | ? | ✓ (M, Nov 2026) | ✓ Overview + custom | ✓ | ✓ Business snapshot | ✓ KPIs / Performance center (Advanced) | ✓ (M) | ✓ Dasbor Performa Bisnis | ✓ spreadsheet dashboards | ✓ KPI portlets | ✓ | ✓ | ✓ |
| Report pack (bundled PDF/Excel) | ✓ Packages | ? | ? | ✓ | ✗ | ✓ report packs | ✓ Management reports | ? | ? | ✗ | ◐ EPM Narrative Reporting (paid add-on) | ✓ | ✓ | ✓ |
| P&L + BS + CF on the summary | ◐ any reports in a package | ◐ | ? | ◐ P&L/BS/CF pages | ✗ no CF (help) | ◐ cash, P&L, net assets | ◐ any reports in a pack | ✗ | ✗ | ◐ as Xero | ✗ | ◐ | ◐ | ? |
| Changes in equity on the summary | ✗ (not in docs) | ✗ | ? | ✗ | ✗ | ✗ net assets only | ◐ if added to pack *(i)* | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ? |

### 3.2 KPIs shown by default

| KPI | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS | Fat | Spot | Syft |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Revenue | ◐ template | ✓ | ✓ (M) | ✓ | ✓ | ✓ income | ✓ | ? | ✓ | ✓ *(i)* | ◐ configurable | ✓ | ✓ | ? |
| Gross profit / margin | ◐ template | ✓ metric | ✓ (M) | ? | ◐ "Margin" (M) | ✓ both | ✓ both | ◐ ratio report | ✓ margin | ✓ margin | ◐ | ✓ GP% | ✓ | ? |
| Net profit / margin | ◐ | ✓ net income | ✓ (M) | ? | ? | ✓ both | ✓ both | ◐ | ? | ✓ margin | ◐ | ✓ NPAT% | ✓ | ? |
| Closing cash | ◐ template; Bank Accounts widget | ? | ✓ (M) | ✓ Total Cash | ✓ | ✓ closing bank balance | ◐ chart | ? | ◐ | ✓ (v12 blog) | ◐ | ✓ cash on hand | ✓ bank tag | ? |
| Cash in / out / net movement | ? | ? | ✓ cash-flow chart (M) | ✓ | ✓ | ✓ received, spent, surplus | ◐ chart | ? | ◐ | ✓ (v12 blog) | ? | ✓ OCF / FCF | ? | ? |
| Burn / runway | ◐ template; "Runway Insight" (M) | ✓ defs | ✓ (M) | ✓ Live Runway | ✓ | ✗ (short-term cash forecast instead) | ◐ burn rate in library | ? | ? | ✗ | ? | ✓ in CFO template | ? | ? |
| Receivables / payables balance | ? | ? | ? | ? | ? | ✓ debtors, creditors | ◐ AR / AP charts | ? | ◐ | ✓ | ◐ | ✓ | ? | ? |
| AR / AP days | ? | ? | ? | ? | ? | ✓ avg debtors / creditors days | ◐ library | ? | ? | ✓ | ? | ✓ | ? | ? |
| Current ratio | ? | ? | ? | ? | ? | ✓ "current assets to liabilities" | ◐ library / chart | ◐ *(i)* | ? | ✓ | ? | ✓ | ? | ? |
| Debt to equity | ? | ? | ? | ? | ? | ◐ "term assets to liabilities" | ◐ library | ◐ *(i)* | ? | ✗ | ? | ✓ gearing | ? | ? |
| Net assets / equity | ? | ? | ? | ? | ? | ✓ net assets | ? | ? | ? | ? | ? | ◐ | ? | ? |
| ROI / ROE / ROA | ? | ? | ? | ? | ? | ✓ ROI p.a. | ◐ library | ◐ Ailita | ◐ Airene ROI | ✓ ROI | ? | ✓ ROE, ROA, ROCE | ? | ? |
| vs budget | ✓ template | ✓ BvA | ✓ API | ✓ BvA report | ? | ◐ | ✓ budget / goal | ? | ✓ anggaran | ? | ? | ✓ | ✓ | ✓ |
| SaaS (ARR, NRR, CAC) | ✓ Revenue dashboard | ✓ 14 metrics | ? | ? | ? | ✗ | ✗ | ✗ | ✗ | ✗ | ? | ◐ | ? | ? |
| Custom KPIs | ✓ widgets | ? | ✓ prompt-built (M) | ✓ manual KPI tile | ? | ✗ 15-vote idea since 2023 | ✓ 80+ library | ? | ◐ add metrics | ◐ spreadsheet | ✓ saved searches | ✓ ~50 + custom | ✓ | ✓ |

**Frequency (default or template, ✓ or ◐):**
- revenue ≈ 12
- gross profit / margin ≈ 11
- closing cash ≈ 10
- net profit / margin ≈ 9
- vs budget ≈ 9
- cash movement ≈ 8
- burn / runway ≈ 7 (startup tools)
- AR/AP balance ≈ 6
- current ratio ≈ 5
- AR/AP days ≈ 4
- ROI/ROE ≈ 6, mostly in libraries
- debt-to-equity ≈ 4, mostly in libraries

The Indonesian *ikhtisar keuangan* (OJK annual report) leads with revenue, gross profit and profit (loss), then ratios including liabilities to total assets or equity.

### 3.3 Period comparison

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS | Fat | Spot | Syft |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| vs previous period (default) | ✓ flux MoM; custom Date column | ✓ flux (M) | ✓ API comparative | ◐ "compare periods" on BS / CF | ? | ✓ this vs last month | ✓ "Compare with" | ◐ | ✓ via filters | ✓ Comparison menu | ✓ Compare Range | ✓ | ✓ "This month v Last month" | ✓ |
| vs same period last year | ◐ YoY "coming soon"; Date column | ✓ YoY (M) | ? | ? | ? | ◐ "more comparative periods" (new) | ✓ | ✓ vs previous year (ratio report) | ? | ✓ *(i)* | ✓ alternate periods | ✓ | ◐ | ✓ multi-period |
| YTD | ✓ YTD vs prior YTD (flux) | ? | ✓ YTD revenue (M) | ✓ on P&L | ? | ✓ snapshot | ✓ | ? | ? | ? | ✓ | ✓ MTD / QTD / YTD | ✓ YTD v FY budget | ? |
| Variance Rp and % | ✓ flux | ✓ | ✓ API | ? | ? | ✓ variance % | ✓ | ? | ? | ◐ | ✓ % or absolute; "Less is More" flips colour | ✓ | ? | ✓ |
| Trend chart / sparkline | ✓ bar / area widgets | ? | ✓ (M) | ✓ trendlines | ✓ card charts | ✓ snapshot | ✓ Performance center | ✓ ratio chart | ✓ | ◐ dashboards | ✓ Trend Graph | ✓ spark charts | ✓ | ✓ |
| Comparison choice remembered | ? | ? | ? | ? | ? | ✗ resets (forum) | ? | ? | ? | ◐ saved filters | ✓ portlet setting | ? | ? | ✓ live view rolls forward |

### 3.4 Commentary

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS | Fat | Spot | Syft |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Manual narrative on the summary | ◐ flux rows only | ◐ edit AI draft | ◐ edit AI draft | ✓ rich-text box | ✗ | ✓ text + cell notes | ✓ preliminary pages, end notes | ✗ | ✗ | ✓ line annotations | ◐ EPM add-on | ✓ 300-char box / Pro text | ✓ Highlights + Recommendations | ✓ |
| AI-drafted narrative | ◐ flux "AI generate"; "AI Narratives" (M) | ✓ Aura (M) | ✓ Ember (M) | ✓ drafts from your bullets | ◐ AI chat | ◐ Scorecards elsewhere | ✓ Finance AI Review Summary (Advanced / IES) | ◐ Ailita chat | ◐ Airene tab (English) | ✗ | ✓ Generate Insight | ✓ Commentary Writer | ✓ AI Suggestions | ✓ Syft Assist |
| Human review before it's shared | ✓ Accept / Discard | ✓ review → approve (M) | ✓ editable (M) | ✓ | — | — | ✓ editable before PDF | ✗ chat only | ✗ | — | ✗ no edit step | ✓ Add to report, then edit | ✓ Add / Add all / Regenerate | ✓ *(i)* |
| Live figures inside the text | ? | ✓ source links kept (M) | ? | ✗ AI doesn't pull data | — | ? | ✓ @KPI and /period chips | — | — | — | — | ◐ hover shows source | ✓ Auto-Text tags | ? |
| Commentary on page 1 | ✓ template "What the board should know" | ? | ? | ✓ | — | ✓ | ✓ | — | — | ◐ | — | ◐ exec summary yes; variance detail later (guidance) | ✓ | ✓ exec summary first |

### 3.5 Output & drill-down

| Capability | DE | Ril | Camp | Dig | Puz | Xero | QBO | Acc | Jur | Odoo | NS | Fat | Spot | Syft |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PDF | ✓ packages (dashboards ✗) | ? | ? | ✓ | ✓ statements | ✓ | ✓ + DOCX | ✓ | ✓ | ✓ | ◐ | ✓ | ? | ◐ |
| Excel | ✓ workbook, cover tab | ? | ◐ via Coefficient | ✓ XLS | ✓ | ✓ values, not formulas | ◐ | ✓ | ✓ | ✓ | ✓ | ? | ? | ? |
| Cover page | ✓ logo, org, period end, prepared by, timestamp | ? | ? | ✓ title, prepared by, image | — | ◐ title / date / prepared by only; "no plans" (89 votes) | ✓ style, logo, title, disclaimer | ✗ | ✗ | ✗ | ◐ | ✓ logo, disclaimer | ? | ? |
| Draft → Final (frozen numbers) | ✗ *(i)* | ? | ? | ✓ Final freezes data; versions | — | ✗ | ✗ *(i)* | ✗ | ✗ | ✗ | ✗ | ? | ? | ◐ rolling live link |
| Schedule / email | ✓ daily / weekly / monthly, external emails | ? | ✓ agents on schedule (M) | ✓ auto-draft on the 1st | ✗ | ✗ asked for | ◐ Advanced / IES | ? | ◐ Airene via email / WA | ✗ | ? | ✓ (M) | ? | ✓ |
| Shareable live link | ✗ | ? | ? | ✓ (login needed) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ web | ✓ | ✓ Live View, password |
| Drill KPI → statement | ✓ widget title → rows | ? | ✓ chart → accounts (M) | ✓ | ? | ✓ to P&L / BS | ✓ "Go to report" | ? | ? | ✓ | ✓ | ◐ formula + trend | ? | ✓ |
| Drill → transactions | ✓ via statement Detail | ? | ✓ "two clicks" (M) | ✓ rows | ? | ◐ via the report | ◐ via Insights | ? | ? | ✓ expand to JE | ✓ | ✗ | ? | ◐ |
| Bahasa Indonesia output | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ (Airene in English) | ◐ translations | ◐ | ✗ | ✗ | ✗ |

---

## 4. Vendor notes (UX and the ideas worth taking)

### DualEntry: deep dive (the prototype mimics its look)
- **Dashboards** are their own nav item (not in Report Center), one tab per dashboard.
  - Widgets: KPI (one headline figure), Bar, Area, Pie, Waterfall, Table, Transactions, Bank Accounts, multi-currency widgets, and Subsidiary Navigator.
  - The only named prebuilt dashboard is **Revenue** (MRR/ARR), shown when revenue recognition is on.
  - **No comparison:** the docs suggest duplicating a dashboard with different filters.
  - Screen-only with a full-screen Display Mode. Posted data only; no auto-refresh.
  - Clicking a widget title opens its rows as a full-page table.
- **Report Packages** (Report Center › Packages) bundle reports into one **PDF** (cover, then a page per report) or an **Excel** workbook (cover tab plus a tab per report).
  - Cover: logo, organisation, package name, period end, "Prepared by" (or "DualEntry System" when scheduled), generation timestamp.
  - Reports are ordered by dragging. Periods can be relative, rolling or specific.
  - Schedules run daily, weekly or monthly, to internal users or external emails (attachment ≤ 9 MB, otherwise a 24-hour link).
  - Package roles: Full Access / Editor / Scheduler / Viewer.
  - **No narrative section.**
- **Board-report template** (free Excel download, not product). This is the most useful layout reference:
  - Tabs: *Board Summary* → Financials → Balance Sheet → Cash & Forecast → SaaS KPIs.
  - Board Summary has 8 headline tiles: Revenue, Ending ARR, Closing cash, Runway, Vs. budget, Gross margin, NRR, Burn multiple.
  - Then a **"What the board should know"** table (Area / What changed / Recommendation, for Growth, Efficiency and Liquidity), then "Decisions requiring attention".
- **Commentary exists only in flux.**
  - A drawer per row: type it, or press **AI generate**, then Accept or Discard.
  - The AI cites up to 8 counterparties behind the move, single postings over 25% of the variance, new counterparties, materiality, and favourable/unfavourable.
  - "Require explanation" gates export. The activity log can't be deleted.
  - Exports can include or hide explanations.
- **Statements:**
  - Comparison comes from custom report Date / Budget / Formula columns ("Variance" and "Note" columns are listed but not available yet).
  - There's a standard **EBITDA income statement** from tagged accounts.
  - No statement of changes in equity in the docs (marketing lists one).
- **Marketing only:** "AI Narratives", "board-ready narratives/slides", and a "Runway Insight" notification.
- **Takeaway:** copy the *look* (cards, quiet tables) and the package's cover fields. The page structure itself has to come from the template and from Digits and Xero.

### Rillet
- Reporting holds Financial Statements (including an **Executive P&L**: Revenue, COGS, Gross Profit, Opex by S&M / R&D / G&A, Net Operating Income, Net Income), 14 **Metrics** reports (ARR, NRR, burn multiple, gross margin, runway definitions) and Budget vs Actual.
- No dashboard or pack in the docs.
- Marketing: Aura Flows "automatically draft financial summaries" (ARR, burn, runway) for the board, and the finance lead "reviews, edits, and approves".

### Campfire
- **Custom Dashboards** (announced 17 Nov 2026): you describe a dashboard in plain language and Campfire builds it.
  - Role templates: Controller, CFO, Collections, Payables, Month-end close, Cash.
  - The CFO overview shows cash, runway, net burn, YTD revenue, gross profit and net income, with revenue and cash-flow charts.
  - Drill-down: chart → accounts → transactions, "two clicks away".
- Ember's flux agent writes commentary that is "editable, saveable, and export-ready for board decks".
- The help centre is behind a login; only the API (comparative income statement with difference and % columns) is public.

### Digits: the closest product analogue
- Financials › **Custom Reports**: pick any of **Executive Summary**, P&L, Balance Sheet and Cash Flow; you get one page per statement.
  - The Executive Summary page has **KPI tiles** (Cash Flow, Total Cash, Net Burn, revenue breakdowns, custom graphs) and a **rich-text commentary box**.
  - Clicking the Digits logo drafts the text from *your* bullets, notes or tone; the AI "does not automatically pull financial data".
  - Commentary pages can be added; comments take @mentions.
- **Cover page** (title, prepared by, footer, optional image).
- **Draft vs Final**: drafts stay live, Final freezes the numbers, and New Version keeps history.
- PDF or XLS, email or link (link needs a login).
- Schedules can auto-create a draft on the 1st, or auto-publish.
- Home dashboard: Total Cash, Net Burn, Gross Burn, **Live Runway** (cash ÷ 3-month average net burn). Expense and revenue rows drill to transactions.

### Puzzle
- Dashboard cards: **Cash, Net Burn, Runway, Revenue**, each with a trend chart, plus spend split into salaries vs other. A "custom burn" what-if changes runway.
- No board pack, no commentary, no scheduling. The help centre says there's no cash flow statement; a Sept 2026 blog says there is one.

### Xero: the canonical fixed summary
- **Executive Summary** sections: Cash, Profitability, Balance Sheet, Income, Performance, Position.
  - Every row shows **this month, last month, variance %**.
  - **Metrics:** cash received, cash spent, cash surplus (deficit), closing bank balance; income, direct costs, gross profit, other income, expenses, profit; debtors, creditors, net assets; number of invoices issued, average invoice value; GP margin, NP margin, ROI p.a.; average debtors days, average creditors days, short-term cash forecast, current assets to liabilities, term assets to liabilities.
- The new version adds flexible date ranges, more comparative periods, a variance column, saved versions, row filtering, commentary text and cell notes. **Drill-down** goes from amounts to the P&L or BS.
- **Business snapshot** (Analytics): income and expense trends, profitability, cash and account balances, compared with last month, quarter, financial year or YTD.
- **Report packs** have a cover and contents page. The cover is editable only for title, date and prepared by. Xero says "no plans" to change this (89 votes; users want a logo and company number).
- Other complaints:
  - Custom KPIs on the Executive Summary (15 votes, open since 2023).
  - The comparison resets when the date changes.
  - No automatic email.
  - A 2013 bug produced wrong GP margin, NP margin and debtor days. Ratios need tests.

### QuickBooks Online
- **Business snapshot**: income and expenses by account, plus previous-year comparisons; "Go to report" opens the P&L.
- **KPIs** (Advanced):
  - Default Growth and Profitability scorecard: revenue, COGS, total expenses, gross profit, GP margin, net profit, NP margin, operating expense, net operating income, operating margin.
  - The library has 80+ KPIs, including current and quick ratio, working capital, AR/AP days, debt/equity, burn and EBITDA.
  - "Period" and "Compare with" dropdowns; a row expands to its definition, formula and trend.
- **Performance center**: up to 25 charts; previous period, same period last year, or budget; industry benchmarks.
- **Management reports**:
  - Cover (style, logo, title, disclaimer, prepared by), contents, **preliminary pages** for an executive summary, reports and charts, then end notes.
  - Inside the text, **@ inserts a KPI chip and / inserts a period chip**.
  - PDF or DOCX, email; recurring delivery on Advanced.
- **Finance AI "Review Summary"** (Advanced / IES): performance highlights, income and expenses, cash flow, balance sheet and budget, **editable before the PDF**.
- AI Report Insights add sparkle icons on P&L and BS lines.

### Accurate Online
- A customisable widget **Dashboard** (the widget list isn't public).
- A **Rasio Keuangan** report under Daftar Laporan › Keuangan, yearly or monthly or as a chart, compared with the previous year. The ratio list isn't public.
- **Ailita** (AI, since Nov 2024) is a chat opened from the AI icon on a report. It calculates and interprets ratios and trends. Its output is a conversation, not a report section.
- No executive summary, cover page or scheduling found. Reports export to PDF, Excel and CSV, and support signatures.

### Mekari Jurnal
- **Dasbor Performa Bisnis**: income vs expenses, links to P&L, cash flow, AR, AP and inventory; metrics can be added.
- The "Laporan manajemen" group has **Ringkasan bisnis**: margin, revenue and operating costs in one view (marketing). A report named "Ringkasan Eksekutif" couldn't be confirmed.
- **Airene** (OpenAI-based) has Summary, In-depth analysis and Strategy recommendations tabs over the P&L and cash flow. It **answers in English** even on Bahasa reports, and can send by email or WhatsApp.

### Odoo
- Accounting › Reporting › **Executive Summary**, one of the nine generic reports.
  - Performance: GP margin, NP margin, ROI.
  - Position: average debtors and creditors days, short-term cash forecast, current assets to liabilities.
  - Older versions had a Cash section.
  - It's essentially Xero's layout.
- Generic Comparison menu, **line annotations** (manual), PDF and XLSX. No cover, no AI, no scheduling.
- Spreadsheet dashboards: clicking a value opens the records.

### NetSuite
- No summary report. Dashboard **KPI portlets**:
  - KPI, Meter, Scorecard, Trend Graph.
  - 75+ KPIs plus custom KPIs from saved searches.
  - Range plus Compare Range with % change.
  - A "Less is More" setting flips the colours.
- **Generate Insight** writes an AI narrative on the IS, BS, CF and TB, with no edit or save step. It differs each run and carries a disclaimer.
- Board books need the separate EPM Narrative Reporting product.

### Fathom (management-reporting specialist)
- About 50 default KPIs in groups:
  - Profitability: GP%, OP%, NPAT%
  - Activity: AR, AP and inventory days, cash conversion cycle
  - Liquidity: current, quick and cash ratio
  - Gearing: D/E
  - Cash: OCF, FCF, cash on hand
  - Growth, plus ROE, ROA and ROCE
- KPIs compare with target, prior period, same period last year, or a benchmark. Clicking a KPI shows its formula and trend.
- **Layer by reading time:**
  - Page 1 is "what you'd read in 5 minutes".
  - Statements and KPIs are the 30-minute read.
  - Variance commentary is the 1-hour read and **not on page 1**.
- CFO board report order: exec summary → KPI spark charts → runway forecast → revenue by stream → gross margin → expenses vs budget → budget recap → BS and CF appendix → actions from the last meeting.
- **Commentary Writer** (Pro):
  - Pick up to 6 components; style Simple or Technical; length Concise or Detailed.
  - "Add to report", then edit. Hovering a number shows its source.
  - Summary Reports have a 300-character manual box per page.

### Spotlight Reporting
- An **Executive Summary page** sits at the front of a pack, with a **Highlights** column and a **"Recommendations for action"** column, pre-headed Revenue, Profit, Margins.
- **Auto-Text tags** put live figures (Revenue, Bank) inside the text.
- **AI Suggestions:**
  - Pick up to 5 topics and a comparator ("This Month v Last Month", "YTD v Full Year (Budget)", "Projection v Full Year").
  - Add one, Add all, or Regenerate.
  - The text is **static** once added.

### Syft
- Templates: business overview and management pack, multi-period overview, cash management, funding pack.
- Recommended order: Executive Summary → KPIs → Analysis → Insights → Recommendations → Appendices.
- **Live View** is a password-protected interactive link that rolls forward monthly, with viewer comments in a side panel.
- Syft Assist AI explains any card down to transactions and drafts the exec summary and an email.

---

## 5. Patterns across the market

1. **Two archetypes.** A fixed summary (Xero, Odoo) is instant and consistent but rigid: no custom KPIs, a fixed cover. A configurable pack (DE, QBO, Digits, Fathom, Spotlight) is flexible but takes setup. For an SME director audience and an MVP, the **fixed page with a small set of switches** wins. Customisation is the thing users ask for next.
2. **The page-1 recipe:** headline tiles → a short narrative ("what changed, why, what to do") → the statements behind it.
   - DE's template, Digits, Spotlight, Syft and Fathom all lead with tiles plus narrative.
   - Variance detail goes later (Fathom's guidance).
3. **Each tile shows the current value plus a delta against one comparator**, and usually a sparkline. Previous period is the default. Same period last year, YTD and budget are the alternatives. Indonesian statutory practice compares years.
4. **AI commentary is always a draft.** Every serious tool keeps an accept / edit / regenerate step, and Spotlight explicitly makes the text static after insertion. Grounding matters: Fathom shows the source on hover, and QBO and Spotlight embed live-figure chips.
5. **Screen plus PDF**, with a cover (logo, company, period, prepared by). Digits adds Draft → Final so a published report doesn't change underneath the board. Scheduling is common in packs, absent in fixed summaries.
6. **Drill-down goes summary → statement → transactions**, keeping the period and comparison. Nobody drills a summary tile straight to journal lines.
7. **No one ties the four statements together on the summary.** Changes in equity is absent everywhere, and no vendor shows that the numbers reconcile. Klay's statements already prove each other (BS balance check, CF cash tie, CIE ↔ BS equity tie), so a small "Statements agree ✓" line is a credible differentiator for a board.
8. **Local tools stop at dashboards and AI chat.** No Bahasa one-pager with sign-off exists in Accurate or Jurnal.

---

## 6. Proposed scope for Klay

Ranked by value to the director reader against effort. *Reuse* means the building block exists in the prototype (§2).

| # | Item | Release | Why (one line) |
|---|---|---|---|
| 1 | **Hero header**: eyebrow "Director's Summary · {period}", company name, period picker (month / quarter / YTD / fiscal year), Compare picker, Closed / Open status and unposted count | **V1 (MVP)** | Klay Impact's band is the look Michael liked; directors must know if the numbers are final |
| 2 | **4 KPI tiles**: Revenue · Net profit/(loss) (net margin as the sub-line) · Cash & cash equivalents at period end · Total equity. Each shows Δ Rp and Δ% vs the comparator, green or red by meaning (not by sign), and red when it's a loss | **V1 (MVP)** | The four most common headline numbers, one from each statement |
| 3 | **Commentary under the tiles**: auto **Highlights** (3–5 rule-based bullets in `homeInsights` style), then a **manual note** by Finance, saved per period with author and time, printed as typed | **V1 (MVP)** | Page 1 is narrative in every board pack; no AI in the MVP, but the slot is ready for it |
| 4 | **Four summary cards, 2 × 2**, each with **Current · Prior · Δ · Δ%** columns and a "Open statement →" link: **Profit & loss** (net revenue, gross profit, GM% row, opex, operating profit, net profit, NM% row) · **Financial position** (current assets, total assets, trade receivables, current liabilities, trade payables, total liabilities, equity, working capital, current ratio, DER rows) · **Cash flow** (cash at start, operating, investing, financing, cash at end) · **Changes in equity** (opening, profit/(loss), capital in/out, dividends, closing) | **V1 (MVP)** | Covers the four statements the brief names; ratio and margin rows follow the P&L and BS decisions |
| 5 | **Compare: Previous period (default) / Same period last year**, one at a time; BS columns as-of each period end | **V1 (MVP)** | The universal default plus the Indonesian year-on-year habit; P&L already compares one at a time |
| 6 | **"Statements agree" line**: BS balances, CF cash ties to BS, CIE closing equals BS equity, CIE profit equals P&L | **V1 (MVP)** | No competitor shows it; the libs already return `balanced` / `ties` |
| 7 | **Drill**: tile or card line opens its statement with the same period and comparison | **V1 (MVP)** | Standard (Xero, QBO, Odoo, Digits); statements already drill to journals |
| 8 | **Print / PDF on one A4 page**: English on screen, Bahasa in print (*Ringkasan Eksekutif* or per Q1), PrintHead, "Period not closed" warning line when open, SignOff (Disiapkan / Diperiksa / Disetujui) | **V1 (MVP)** | The brief; StatementKit and statements.css already have print rules and sign-off |
| 9 | **6-month trend sparkline** on each tile | V1.1 | Almost everyone has trends; `recentMonthEnds` makes it cheap |
| 10 | **True AR / AP days** (DSO / DPO from revenue and purchases), quick ratio, ROE / ROA | V1.1 | Common in Xero, Odoo and Fathom, and in the OJK ikhtisar; today's "days" are weighted ages |
| 11 | **YTD alongside the month** (Month · YTD · Prior YTD) | V1.1 | Third most common comparator; directors read YTD at quarter-ends |
| 12 | **Excel export** of the summary (values plus live formulas for ratio rows, as on the BS) | V1.1 | Some boards rework numbers; reuse `xlsxExport.js` |
| 13 | **Report pack**: cover page (logo, company, period, prepared by, timestamp) + summary + full statements in one PDF | V1.1 | DE / QBO / Digits pattern; the natural next step once the four statements exist |
| 14 | **Draft → Final**: freeze the numbers and note at publish; version history | Later | Digits; protects the board from numbers moving after the meeting |
| 15 | **AI-drafted commentary** (draft → edit → accept; grounded figures; Bahasa output) | Later | Market direction; needs Klay AI, and Airene's English-only output is the gap to beat |
| 16 | **Schedule and email to directors** (or a View Only login link) | Later | DE and Digits have it; depends on #13 and #14 |
| 17 | **vs Budget** | Later | Second most common comparator in packs, but Klay has no budgets |
| 18 | **Custom KPI choice** (pick tiles from a small library) | Later | Xero's top complaint; wait until the default set is validated |
| 19 | **Cash runway / burn** (shown only when operating cash flow is negative) | Later | Startup metric; most Indonesian SME clients are profitable, so ask first (Q6) |
| 20 | **EBITDA** | Later | Needs D&A account tagging; DE has it as a separate statement |
| 21 | **SaaS metrics** (ARR, NRR, CAC) | Not now | Not Klay's market |
| 22 | **Dimension or branch filter** | Not now | BS decision: dimensions break the BS; the summary must tie |
| 23 | **Multi-entity / consolidated summary** | Not now | Klay V1 is single-entity |
| 24 | **Industry benchmarks, invoice counts / average invoice value** | Not now | Low value for a board; no local benchmark data |
| 25 | **Free-form dashboard builder** | Not now | DE and Campfire territory; the brief is one fixed page |

---

## 7. Open questions (for Michael / SME)

1. **Name and print title.** Screen: "Director's Summary" or "Executive Summary"? Print: *Ringkasan Eksekutif*, *Ikhtisar Keuangan* or *Laporan untuk Direksi*?
2. **Cadence and default.** Do directors meet monthly or quarterly? Should the default be **last closed month vs previous month**, or **vs the same month last year**? Is YTD needed on page 1?
3. **The four tiles.** Revenue, Net profit/(loss), Cash, Equity? Or swap Equity for **DER** or the **current ratio**, which commissioners and banks watch?
4. **Commentary ownership.** Who writes it: the Finance Manager or the Director? Does it need a reviewer before printing, as non-bank recon does? Is one note per period enough, or one per card?
5. **Which cash?** GL cash and equivalents (ties to the BS and CF) or the bank **book balance** (Cash Position, with restricted, deposit and tax money split out)? The recommendation is GL cash on the tile, with "of which available" as a sub-line.
6. **Runway / burn.** Is it useful for any target client (loss-making or start-up), or should it stay out?
7. **Ratios and thresholds.** Is the current ratio + DER set enough, or should ROE, ROA and NPM go in like the OJK *ikhtisar*? Should any ratio turn red at a threshold (e.g. DER > 2, current ratio < 1)?
8. **Open periods.** May the summary be printed for an unclosed month (with a warning), or only for closed periods?
9. **Sign-off and branding.** Must the printed page carry Direksi signatures, a company logo, or e-Meterai?
10. **Pack vs page.** Is the one page enough, or do directors expect the full statements attached (§6 #13)?
11. **Access.** Do directors log in (View Only role), or does Finance send the PDF? This decides whether scheduling and email matter.
12. **Budget.** Is budgeting on the Klay roadmap? Without it, "vs budget" stays out.

---

## 8. Caveats on the evidence

- **Blocked or partial sources:**
  - Xero Central rendered blank or returned 503, so Xero's metric list comes from Xero's own blog, a third-party re-documentation of the Reports API (`ExecutiveSummary` endpoint) and Product Ideas. No CAPTCHA was hit or bypassed.
  - NetSuite's Narrative Reporting page returned 403.
  - An Odoo partner blog had a redirect loop.
  - The OJK SEOJK 16/2021 PDF couldn't be rendered, so the *ikhtisar* item list comes from a search snippet.
  - Accurate and Jurnal images are lazy-loaded with no usable URLs.
  - The Campfire help centre is behind a login.
  - Rillet's docs index returns 401.
  - Spotlight's AI exec-summary blog post returns 404.
- **Marketing vs docs:**
  - Campfire's dashboards (announced 17 Nov 2026), Rillet's Aura Flows, DualEntry's "AI Narratives" and "Runway Insight", and Jurnal's "Ringkasan bisnis" come from marketing only.
  - DualEntry's 8-tile board layout is a downloadable Excel **template**, not a product feature.
- **Inferences:**
  - Odoo's Profitability and Balance Sheet sections are inferred from its Xero-like layout.
  - Accurate's ratio list (current ratio, DER) is inferred; the list isn't published.
- **Embedded agent instructions:** Rillet pages (JSON-LD asking for a POST to an external endpoint) and every Digits GitBook page ("Agent Instructions" asking for a GET to a query endpoint) contained instructions aimed at AI agents. They were ignored, and nothing from them is used here.
- **Pages read by a summarising model:** check exact UI labels against the linked page before they go into a PRD.
- **Prototype state:** `cashFlow.js`, `changesInEquity.js`, `ChangesInEquityPage.jsx`, `StatementKit.jsx` and `statements.css` are **untracked work in progress** as of 24 Nov and may change. Neither page is routed yet.
- **No screenshots saved.** Candidate image URLs are in §9.2. Downloading them into `docs/research/directors-summary/<vendor>/` needs a go-ahead.

---

## 9. Sources

### 9.1 Articles

**DualEntry**
- [Dashboards](https://docs.dualentry.com/accountants/reporting-analytics/dashboards.md) · [Report packages](https://docs.dualentry.com/accountants/reporting-analytics/report-packages.md) · [Exporting & report groups](https://docs.dualentry.com/accountants/reporting-analytics/exporting-and-report-groups.md)
- [Run financial statements](https://docs.dualentry.com/accountants/reporting-analytics/run-financial-statements.md) · [Standard financial statements](https://docs.dualentry.com/accountants/reporting-analytics/standard-financial-statements.md) · [Custom report builder](https://docs.dualentry.com/accountants/reporting-analytics/custom-report-builder.md) · [EBITDA income statement](https://docs.dualentry.com/accountants/reporting-analytics/ebitda-income-statement.md) · [Flux reporting](https://docs.dualentry.com/accountants/reporting-analytics/flux-reporting.md)
- Marketing: [Board report template](https://www.dualentry.com/templates/board-report) · [Dashboards](https://www.dualentry.com/scale/dashboards) · [Reporting & analytics](https://dualentry.com/scale/reporting-analytics)

**Rillet**
- [Reporting](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting) · [Metric reports](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/metrics/metric-reports.md) · [Executive P&L](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/financial-statements/set-up-the-executive-p-and-l.md) · [Financial statements](https://docs.rillet.com/EjmEP4KZ9BVp9j2ho4Mh/reporting/financial-statements)
- Marketing: [January 2026 product update](https://rillet.com/blog/january-2026-product-update) · [Aura Flows](https://info.rillet.com/aura-flows-automated-financial-workflows)

**Campfire**
- [Introducing custom dashboards](https://campfire.ai/blog/introducing-custom-dashboards) · [Ember](https://campfire.ai/ember) · [August product update](https://campfire.ai/blog/august-product-update) · [Comparative income statement (API)](https://docs.campfire.ai/api-reference/financial-statements/get-comparative-income-statement.md)

**Digits**
- [Home dashboard](https://help.digits.com/business-home/your-home-dashboard-built-in-views-and-metrics.md) · [Customize dashboards](https://help.digits.com/business-home/customize-dashboards.md)
- [Custom reports](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/custom-reports.md) · [Sharing reports](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/sharing-reports.md) · [Schedule reports](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/schedule-reports.md) · [Download financials](https://help.digits.com/business-insights-and-reporting/business-insights-reportings/download-financials.md)

**Puzzle**
- [What reports does Puzzle provide](https://help.puzzle.io/en/articles/8441346-what-reports-does-puzzle-provide) · [Projections](https://help.puzzle.io/en/articles/8471491-can-i-do-projections-in-puzzle) · [New dashboard (blog)](https://puzzle.io/blog/introducing-the-new-puzzle-dashboard) · [Pricing](https://puzzle.io/pricing) · [What's new (bookkeeper edition)](https://puzzle.io/blog/whats-new-at-puzzle-bookkeeper-edition)

**Xero**
- [New reporting features (blog)](https://blog.xero.com/product-updates/new-xero-reporting-features/) · [Business snapshot](https://www.xero.com/nz/accounting-software/analytics/snapshot/) · [Financial reporting](https://xero.com/accounting-software/financial-reporting/) · [Business Health Scorecards (ITBrief)](https://itbrief.com.au/story/xero-unveils-ai-business-health-scorecards-for-users)
- Executive Summary metrics via API re-documentation: [OData Link](https://help.odatalink.com/index.php?mobileaction=toggle_view_desktop&title=Xero_Accounting_Endpoint%3A_ExecutiveSummary) · [CData](https://cdn.cdata.com/help/DXM/py/pg_accountingtable-executivesummary.htm) · [2013 ratio bug (Blake Oliver)](http://www.blakeoliver.com/blog/xero-bug-causes-incorrect-values-in-executive-summary-report)
- Product ideas: [Custom KPIs on Executive Summary](https://productideas.xero.com/forums/967133-reports-tax/suggestions/46298650-reports-ability-to-add-custom-kpis-to-executive) · [Customisable cover / contents](https://productideas.xero.com/forums/967133-reports-tax/suggestions/44961097-reporting-customisable-contents-cover-pages-in) · [Remember comparison periods](https://productideas.xero.com/forums/967133-reports-tax/suggestions/46684432-report-preferences-ability-to-set-comparison-per) · [Automatic emailing of reports](https://productideas.xero.com/forums/939198-for-small-businesses/suggestions/44960653-reporting-automatic-generation-and-emailing-of-r)

**QuickBooks Online**
- [Management reports](https://quickbooks.intuit.com/learn-support/en-us/help-article/report-management/view-edit-management-reports-quickbooks-online/L90RAh2XZ_US_en_US) · [KPIs](https://quickbooks.intuit.com/learn-support/en-us/help-article/revenue/view-key-performance-indicators-business/L26L6M0ki_US_en_US) · [KPI glossary](https://quickbooks.intuit.com/learn-support/en-us/help-article/revenue/kpi-scorecard-glossary/L7H1MbTKL_US_en_US) · [Performance center](https://quickbooks.intuit.com/learn-support/en-us/help-article/financial-reports/create-charts-see-business-performance/L8m11b5qY_US_en_US)
- [Finance AI / Review Summary](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-finance-agent/L6cf6dDFm_US_en_US) · [AI report insights](https://quickbooks.intuit.com/learn-support/en-us/help-article/business-reports/ai-powered-report-insights/L2jZq6tfM_US_en_US) · Community: [Business snapshot](https://quickbooks.intuit.com/learn-support/global/reports/could-the-business-snapshot-report-be-extended-to-include/00/384089)

**Accurate Online**
- [Cara hitung rasio keuangan di Accurate](https://accurate.id/tips-tutorial/cara-hitung-rasio-keuangan-di-accurate/) · [Ailita](https://accurate.id/featured/ailita-asisten-ai-accurate/) · [Ailita launch (Investor Trust)](https://investortrust.id/financial/46617/accurate-indonesia-luncurkan-ailita-asisten-ai-untuk-analisis-keuangan) · [Laporan keuangan features](https://accurate.id/fitur/laporan-keuangan/) · [Trial page (dashboard)](https://accurate.id/trial/aol/)

**Mekari Jurnal**
- [Dasbor Performa Bisnis](https://www.jurnal.id/id/fitur/laporan-keuangan-bisnis/dasbor-performa-bisnis/) · [Laporan keuangan bisnis (catalogue)](https://www.jurnal.id/id/fitur/laporan-keuangan-bisnis/) · [Airene](https://www.jurnal.id/en/features/airene-ai-based-financial-report-analysis) · [Blog: Airene ROI / EBITDA](https://www.jurnal.id/id/blog/strategi-mengoptimalkan-aktivitas-bisnis-dengan-mekari-jurnal/)

**Odoo**
- [Reporting (v19)](https://www.odoo.com/documentation/19.0/applications/finance/accounting/reporting.html) · [Reporting (v18, executive summary ratios, comparison, annotate)](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting.html) · [Spreadsheet dashboards](https://www.odoo.com/documentation/master/applications/productivity/dashboards.html) · [Finance dashboard app (third party)](https://apps.odoo.com/apps/modules/17.0/viin_spreadsheet_dashboard_finance)

**NetSuite**
- [KPI portlets](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N595760.html) · [KPI compare range](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N597713.html) · [KPI scorecard](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N612785.html) · [Financial Report Builder](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2095037.html) · [Alternate periods](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N739328.html) · [Narrative insights](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_135342304.html) · [EPM Narrative Reporting](https://www.netsuite.com/portal/products/erp/epm/narrative-reporting.shtml) (403)

**Fathom**
- [Summary reports](https://support.fathomhq.com/en/articles/10443833-summary-reports) · [KPI summary](https://support.fathomhq.com/en/articles/999159-kpi-summary) · [Default financial KPIs](https://support.fathomhq.com/en/articles/2330939-list-of-default-financial-kpis) · [Commentary Writer](https://support.fathomhq.com/en/articles/13654481-use-the-commentary-writer)
- [Management reporting](https://www.fathomhq.com/features/management-reporting) · [CFO board report example](https://www.fathomhq.com/report-library/john-miller-cfo-board-report) · [Designing reports executives use](https://www.fathomhq.com/blog/design-reports-executives-actually-use)

**Spotlight Reporting**
- [Executive summary page (blog)](https://www.spotlightreporting.com/blog-posts/executive-summary) · [Getting started with templates](https://www.spotlightreporting.com/blog-posts/getting-started-with-templates) · [AI suggestions (help)](https://help.spotlightreporting.com/help-articles/ai-suggestions) · [Pages (help index)](https://help.spotlightreporting.com/spotlight-reporting/pages) · [Spotlight AI](https://www.spotlightreporting.com/product/ai)

**Syft Analytics**
- [Simplest way to build a report](https://blog.syftanalytics.com/en/articles/13904218-your-new-simplest-way-to-build-a-report) · [Management reporting best practices](https://blog.syftanalytics.com/en/articles/9413097-mastering-management-reporting-key-concepts-and-best-practices) · [Syft Assist AI](https://blog.syftanalytics.com/en/articles/10456881-3-ways-to-enhance-your-reporting-with-syft-assist-ai) · [Syft Assist with GPT-5](https://blog.syftanalytics.com/en/articles/12841702-syft-assist-ai-supercharged-with-gpt-5-smarter-deeper-faster-insights) · [Live View (ITBrief)](https://itbrief.com.au/story/syft-updates-analytics-platform-with-live-client-reports)

**Indonesian practice**
- [SEOJK 16/SEOJK.04/2021 (annual report content, ikhtisar data keuangan penting)](https://data.sbfnetwork.org/sites/default/files/survey-attachments/2025-07/SEOJK%20-%2016%20-%202021.pdf) (snippet only) · [Example ikhtisar keuangan (Bank Mega 2021)](https://www.bankmega.com/media/filer_public/ef/32/ef32c048-29d4-4934-a7a9-33fb57821677/ikhtisar_2021_id.pdf)

### 9.2 Candidate screenshots (not downloaded)

| Vendor | Shows | URL |
|---|---|---|
| DualEntry | Cash balance trend · AI variance explanation · Runway Insight | [rep-tab-1](https://cdn.prod.website-files.com/66bf861737ab5a556a15c52b/69f475e56cd6593fbe459c25_d8f2a0358cb53f4c657e4fe20c978ad5_rep-tab-1.avif) · [rep-tab-tablet-2](https://cdn.prod.website-files.com/66bf861737ab5a556a15c52b/6a0c6a48d8dd9314069c6bb9_rep-tab-tablet-2.avif) · [lp-ai-rep](https://cdn.prod.website-files.com/66bf861737ab5a556a15c52b/6a885c8f55f0cb34a3aaf812_69f471807507e6f3c0b5e3be_9840ab6450fa9a854d1805cb194066c6_lp-ai-rep.avif) |
| Rillet | Executive P&L · Investor metrics | [exec P&L](https://cdn.prod.website-files.com/6aa921dd3e974958ae9421ef/6ad9ecbd67d92abc034e9268_2-Executive%20P%26L.png) · [investor metrics](https://cdn.prod.website-files.com/6aa921dd3e974958ae9421ef/6ad9ecc8e378a55200abae8b_3-Investor%20metrics.png) |
| Campfire | CFO overview dashboard · drill-down | [CFO overview](https://cdn.sanity.io/images/zu7n19wi/production/8b5a71e9bfe77e81df6e410557513df502354afb-1680x820.jpg) · [drill-down](https://cdn.sanity.io/images/zu7n19wi/production/d5b71e5083d5ea5d2e4a46de51282bb8fc3680f0-1770x830.jpg) |
| Digits | Report cover · Executive Summary tiles · KPI cards | [cover](https://3494946449-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FQp6kVxx1FJYsPtDHusNl%2Fuploads%2F4tmusfzgOYn5yRcWjto1%2FCursor_and_Michelle_s%E2%80%A6___October_2025___Month_End_Report.png?alt=media&token=8ba7698e-598d-4e37-a0b0-d94c47a697c7) · [exec summary](https://3494946449-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FQp6kVxx1FJYsPtDHusNl%2Fuploads%2FPJYB8r3hSEdv11VOg3nH%2FCursor_and_Michelle_s%E2%80%A6___October_2025___Month_End_Report.png?alt=media&token=39dcf441-1778-4f0a-9232-de9bc675cc40) · [KPI cards](https://ram.digitscpu.com/_astro-assets/kpi.BnaBxfTl_Z1fmiP8.png) |
| Puzzle | Dashboard | [dashboard](https://cdn.prod.website-files.com/62ac2ab60d1097363942959d/6a8a9749ceae318c2ea400e6_oUYOPZ-WnQKgHP_ouxUbP.png) |
| Xero | Executive Summary (new) · old version (2013) | [new](https://blog.xero.com/wp-content/uploads/2023/10/2022_Executive-summary-report-blog-header_517123_V2_Large-Blog.png) · [old](https://images.squarespace-cdn.com/content/v1/5437534fe4b063c91fba5659/1412912157350-SEQ6QE4VMBGZL8JXLGJB/Screen-Shot-2013-04-15-at-7.31.59-AM.png) |
| Odoo | Comparison menu · annotate | [comparison](https://www.odoo.com/documentation/18.0/_images/reporting-comparison.png) · [annotate](https://www.odoo.com/documentation/18.0/_images/reporting-annotate.png) |
| Mekari Jurnal | Airene · mobile dashboard | [Airene](https://www.jurnal.id/wp-content/uploads/2024/04/jurnalnewpageairene11x-516x430.webp) · [dashboard](https://www.jurnal.id/wp-content/uploads/2020/11/img-dashboard-mobile-1-530x430.png) |
| Fathom | Reporting · CFO board report thumbnail | [reporting](https://cdn.prod.website-files.com/5fbe9eea37575d6196a6d157/6035abcb6007135ff822ae7f_reporting%402x.png) · [CFO report](https://cdn.prod.website-files.com/6033bddd9c483f54829c6af5/69fadf6551b5d4323ff781c3_John%20Miller%20Report%20Library%20Thumbnail.png) |
| Spotlight | Executive summary page · report | [exec summary](https://cdn.prod.website-files.com/5efc103e2e61950acc612aca/5f73d89ad0fb737dcf9e51e7_exec_summary_2x.png) · [report](https://cdn.prod.website-files.com/5efc103e2e61950acc612aca/605a9cfacc4be74893e3c05c_Report%20Screenshot.jpeg) |
| Syft | Dashboard (signed URL, may expire) | [dashboard](https://downloads.intercomcdn.com/i/o/ku6b8b8i/1356342581/9b17b90ee517078ba701b248f2ef/Dashboard.png) |
