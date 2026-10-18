import { ChatChip } from "./AiChatDrawer";

// Short rupiah: "Rp 1,2 M" (miliar), "Rp 85 jt" (juta). Losses keep their sign.
function fmtRpShort(n) {
  if (n == null) return "—";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 1e9) return sign + "Rp " + (a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " M";
  if (a >= 1e6) return sign + "Rp " + (a / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 0 }) + " jt";
  return sign + "Rp " + a.toLocaleString("id-ID");
}

// ── Insights ──────────────────────────────────────────────────────────────
// netIncome / totalRev / totalExp come from lib/trialBalance.js →
// netProfitForPeriod, the same rule Profit & Loss uses, so the two agree.
// margin is null when the period has no revenue.

export function computeTbInsights({ balance, anomalies, netIncome, margin, period }) {
  const insights = [];
  const critical = anomalies.filter((a) => a.severity === "critical");
  const warn     = anomalies.filter((a) => a.severity === "warn");
  const info     = anomalies.filter((a) => a.severity === "info");

  // 1. Balance status
  if (balance.balanced) {
    insights.push({
      id: "balanced",
      node: (
        <>
          Trial Balance is <strong className="lg-ai-strong">in balance</strong> for{" "}
          <strong className="lg-ai-strong">{period}</strong> — ending debits = ending{" "}
          credits = <strong className="lg-ai-strong">{fmtRpShort(balance.dr)}</strong>.
        </>
      ),
      question: "What are total debits and credits this period?",
    });
  } else {
    insights.push({
      id: "unbalanced",
      node: (
        <>
          Trial Balance is <span className="lg-ai-danger">out of balance</span> by{" "}
          <span className="lg-ai-danger">{fmtRpShort(balance.variance)}</span>.
        </>
      ),
      question: "Why is the Trial Balance out of balance?",
    });
  }

  // 2. Net profit
  insights.push({
    id: "netIncome",
    node: (
      <>
        Net profit{" "}
        {netIncome >= 0 ? (
          <strong className="lg-ai-strong" style={{ color: "var(--color-success-text)" }}>{fmtRpShort(netIncome)}</strong>
        ) : (
          <span className="lg-ai-danger">{fmtRpShort(netIncome)}</span>
        )}
        {margin !== null && (
          <>
            {" "}— margin <strong className="lg-ai-strong">{margin}%</strong>
          </>
        )}
        {" "}for {period}.
      </>
    ),
    question: "Revenue & expense detail",
  });

  // 3. Critical anomalies
  if (critical.length > 0) {
    insights.push({
      id: "critical",
      node: (
        <>
          <strong className="lg-ai-strong">{critical.length} critical {critical.length === 1 ? "finding" : "findings"}</strong> —{" "}
          <span className="lg-ai-danger">{critical[0].name}</span>
          {critical.length > 1 && ` + ${critical.length - 1} more`}.
        </>
      ),
      question: "Show the critical findings",
    });
  }

  // 4. Warnings
  if (warn.length > 0) {
    insights.push({
      id: "warn",
      node: (
        <>
          <strong className="lg-ai-strong">{warn.length} {warn.length === 1 ? "warning" : "warnings"}</strong> to review:{" "}
          {warn[0].name}{warn.length > 1 && ` + ${warn.length - 1} more`}.
        </>
      ),
      question: "What warnings are there this period?",
    });
  }

  // 5. Info-level insights
  if (info.length > 0) {
    insights.push({
      id: "info",
      node: (
        <>
          <strong className="lg-ai-strong">{info.length} {info.length === 1 ? "note" : "notes"}</strong> from Klay AI on related accounts.
        </>
      ),
      question: "Show AI notes & recommendations",
    });
  }

  // No anomalies — happy path
  if (anomalies.length === 0) {
    insights.push({
      id: "clean",
      node: (
        <>
          <strong className="lg-ai-strong">No anomalies</strong> — every account is within normal range.
        </>
      ),
      question: "Why is this period clean?",
    });
  }

  return insights;
}

// ── AI chat context ──────────────────────────────────────────────────────

export function makeTbAiContext({ balance, anomalies, netIncome, totalRev, totalExp, margin, period, userName, accountCount, topAssets = [], topLiabilities = [] }) {
  const critical = anomalies.filter((a) => a.severity === "critical");
  const warn     = anomalies.filter((a) => a.severity === "warn");
  const firstName = (userName || "").split(" ")[0];

  const welcome = (
    <p>Hi{firstName ? ` ${firstName}` : ""} — I have reviewed the Trial Balance for {period}. How can I help?</p>
  );

  const suggestions = [
    "What are the most important findings this period?",
    "Revenue & expense detail",
    "What are total debits and credits this period?",
    "Which accounts have the largest balances?",
  ];

  function anomalyList(list, max = 5) {
    return (
      <div className="ai-mini-table">
        {list.slice(0, max).map((a, i) => (
          <div className="ai-mini-row" key={a.code + i}>
            <div className="ai-mini-av" style={{ background: a.severity === "critical" ? "var(--color-danger-text)" : a.severity === "warn" ? "var(--color-warning-text)" : "var(--color-action)" }}>
              {a.severity === "critical" ? "!" : a.severity === "warn" ? "△" : "i"}
            </div>
            <div className="ai-mini-body">
              <div className="ai-mini-name">{a.code} · {a.name}</div>
              <div className="ai-mini-meta">{a.title}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function makeBalanceResponse() {
    return {
      role: "ai",
      content: (
        <>
          <p>Trial Balance summary for {period}:</p>
          <ul style={{ paddingLeft: 16, margin: "8px 0", fontSize: 12 }}>
            <li>Accounts with balances: <strong>{accountCount}</strong></li>
            <li>Total ending debits: <strong>{fmtRpShort(balance.dr)}</strong></li>
            <li>Total ending credits: <strong>{fmtRpShort(balance.cr)}</strong></li>
            <li>Status: {balance.balanced ? <strong style={{ color: "var(--color-success-text)" }}>in balance ✓</strong> : <strong style={{ color: "var(--color-danger-text)" }}>out of balance by {fmtRpShort(balance.variance)}</strong>}</li>
          </ul>
        </>
      ),
    };
  }

  function makeIncomeResponse() {
    return {
      role: "ai",
      content: (
        <>
          <p>Profit &amp; loss for {period}, from posted journals — the same figures as the Profit &amp; Loss report:</p>
          <ul style={{ paddingLeft: 16, margin: "8px 0", fontSize: 12 }}>
            <li>Revenue: <strong>{fmtRpShort(totalRev)}</strong></li>
            <li>Expenses: <strong>{fmtRpShort(totalExp)}</strong></li>
            <li>Net profit: {netIncome >= 0
              ? <strong style={{ color: "var(--color-success-text)" }}>{fmtRpShort(netIncome)}</strong>
              : <strong style={{ color: "var(--color-danger-text)" }}>{fmtRpShort(netIncome)}</strong>}
            </li>
            {margin !== null && <li>Margin: <strong>{margin}%</strong></li>}
          </ul>
          <div className="chat-chips">
            <ChatChip primary>Revenue by product</ChatChip>
            <ChatChip>Expenses by category</ChatChip>
          </div>
        </>
      ),
    };
  }

  function makeCriticalResponse() {
    if (critical.length === 0) return { role: "ai", content: <p>No critical findings this period.</p> };
    return {
      role: "ai",
      content: (
        <>
          <p><strong>{critical.length} critical {critical.length === 1 ? "finding" : "findings"}</strong>:</p>
          {anomalyList(critical)}
          <div className="chat-chips">
            <ChatChip primary>Review one by one</ChatChip>
            <ChatChip>Mark all as valid</ChatChip>
          </div>
        </>
      ),
    };
  }

  function makeWarnResponse() {
    if (warn.length === 0) return { role: "ai", content: <p>No warnings this period.</p> };
    return {
      role: "ai",
      content: (
        <>
          <p><strong>{warn.length} {warn.length === 1 ? "warning" : "warnings"}</strong>:</p>
          {anomalyList(warn)}
        </>
      ),
    };
  }

  function makeTopAccountsResponse() {
    return {
      role: "ai",
      content: (
        <>
          <p>Accounts with the largest balances this period:</p>
          {topAssets.length > 0 && (
            <>
              <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "8px 0 4px" }}>Assets</p>
              <div className="ai-mini-table">
                {topAssets.slice(0, 3).map((a) => (
                  <div className="ai-mini-row" key={a.code}>
                    <div className="ai-mini-av">{a.code.slice(0, 3)}</div>
                    <div className="ai-mini-body">
                      <div className="ai-mini-name">{a.code} · {a.name}</div>
                    </div>
                    <div className="ai-mini-amt">{fmtRpShort(a.closing_balance)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {topLiabilities.length > 0 && (
            <>
              <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "8px 0 4px" }}>Liabilities</p>
              <div className="ai-mini-table">
                {topLiabilities.slice(0, 3).map((a) => (
                  <div className="ai-mini-row" key={a.code}>
                    <div className="ai-mini-av">{a.code.slice(0, 3)}</div>
                    <div className="ai-mini-body">
                      <div className="ai-mini-name">{a.code} · {a.name}</div>
                    </div>
                    <div className="ai-mini-amt">{fmtRpShort(a.closing_balance)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ),
    };
  }

  function makeDefaultResponse(text) {
    return {
      role: "ai",
      content: (
        <>
          <p>I can't answer "{text}" in this prototype, but I can help with:</p>
          <div className="chat-chips">
            <ChatChip>Critical findings</ChatChip>
            <ChatChip>Warnings</ChatChip>
            <ChatChip>Profit &amp; expenses</ChatChip>
            <ChatChip>Largest accounts</ChatChip>
            <ChatChip>Balance status</ChatChip>
          </div>
        </>
      ),
    };
  }

  function respond(text) {
    const t = text.toLowerCase();
    // Indonesian keywords too — users ask both ways.
    if (t.includes("kritis") || t.includes("critical") || t.includes("finding")) return makeCriticalResponse();
    if (t.includes("peringatan") || t.includes("warn")) return makeWarnResponse();
    if (t.includes("pendapatan") || t.includes("beban") || t.includes("laba") || t.includes("rugi") || t.includes("income") || t.includes("profit") || t.includes("revenue") || t.includes("expense")) return makeIncomeResponse();
    // Before the balance check: "largest balances" is about accounts, not the totals.
    if (t.includes("largest") || t.includes("terbesar") || t.includes("top")) return makeTopAccountsResponse();
    if (t.includes("debit") || t.includes("credit") || t.includes("balance") || t.includes("total")) return makeBalanceResponse();
    return makeDefaultResponse(text);
  }

  return { welcome, suggestions, respond };
}
