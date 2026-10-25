import { ChatChip } from "./AiChatDrawer";

function fmtRpShort(n) {
  if (n == null) return "—";
  if (n >= 1e9) return "Rp " + (n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " M";
  if (n >= 1e6) return "Rp " + (n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 0 }) + " jt";
  return "Rp " + n.toLocaleString("id-ID");
}

function entryDebit(je) {
  return je.lines.reduce((s, l) => s + (l.debit || 0), 0);
}
function entryCredit(je) {
  return je.lines.reduce((s, l) => s + (l.credit || 0), 0);
}

// ── Insights ──────────────────────────────────────────────────────────────

export function computeJournalInsights(entries) {
  const total = entries.length;
  const draft = entries.filter((e) => e.status === "draft");
  const pending = entries.filter((e) => e.status === "pending");
  const posted = entries.filter((e) => e.status === "posted");
  const voids = entries.filter((e) => e.status === "void");

  const draftValue = draft.reduce((s, e) => s + entryDebit(e), 0);
  const pendingValue = pending.reduce((s, e) => s + entryDebit(e), 0);

  const totalDebit = entries.reduce((s, e) => s + entryDebit(e), 0);
  const totalCredit = entries.reduce((s, e) => s + entryCredit(e), 0);
  const variance = totalDebit - totalCredit;
  const isBalanced = Math.abs(variance) < 1;

  // Largest pending entry
  const largestPending = pending
    .map((e) => ({ je: e, amount: entryDebit(e) }))
    .sort((a, b) => b.amount - a.amount)[0];

  const insights = [];

  if (draft.length > 0) {
    insights.push({
      id: "draftBacklog",
      node: (
        <>
          <strong className="lg-ai-strong">{draft.length} draft journals</strong> not yet posted —
          worth <span className="lg-ai-danger">{fmtRpShort(draftValue)}</span>.
        </>
      ),
      question: "Show draft journals that need posting",
    });
  }

  if (pending.length > 0) {
    insights.push({
      id: "pendingApproval",
      node: (
        <>
          <strong className="lg-ai-strong">{pending.length} journals</strong> awaiting approval —
          total value <span className="lg-ai-danger">{fmtRpShort(pendingValue)}</span>.
        </>
      ),
      question: "Journal which that awaiting approval?",
    });
  }

  if (isBalanced && total > 0) {
    insights.push({
      id: "balanced",
      node: (
        <>
          Book journals <strong className="lg-ai-strong">balanced</strong> — total debit ={" "}
          credit <strong className="lg-ai-strong">{fmtRpShort(totalDebit)}</strong> di seluruh{" "}
          {total} entri.
        </>
      ),
      question: "What total debit and credit this month?",
    });
  } else if (!isBalanced) {
    insights.push({
      id: "unbalanced",
      node: (
        <>
          <strong className="lg-ai-strong">GL unbalanced</strong> — variance{" "}
          <span className="lg-ai-danger">{fmtRpShort(Math.abs(variance))}</span>{" "}
          {variance > 0 ? "debit more besar" : "credit more besar"}.
        </>
      ),
      question: "Why is total debit not equal to credit?",
    });
  }

  if (largestPending) {
    insights.push({
      id: "largestPending",
      node: (
        <>
          Journal pending largest:{" "}
          <strong className="lg-ai-strong">{largestPending.je.je_number}</strong> ({largestPending.je.memo}) worth{" "}
          <span className="lg-ai-danger">{fmtRpShort(largestPending.amount)}</span>.
        </>
      ),
      question: "Journal detail pending largest",
    });
  }

  if (voids.length > 0) {
    insights.push({
      id: "voids",
      node: (
        <>
          <strong className="lg-ai-strong">{voids.length} voided journals</strong> this month —{" "}
          pastikan there is audit trail for semua pembatalan.
        </>
      ),
      question: "Show voided journals",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "empty",
      node: <>None journals for this period.</>,
      question: "General journal summary",
    });
  }

  return insights;
}

// ── "Your Tasks" rail (mirrors computeBillsInsights / computeInvoiceTasks) ──
// `rows` are the derived JE rows (debit/credit
// pre-summed). `role` scopes the queue, same contract as the other ledgers:
//   "operator" — FM/Admin: approval + supervisory queue
//   "preparer" — Bookkeeper: their prep queue (drafts to post)
//   "viewer"   — view-only roles: read-only GL analytics, no action framing
// Each task: { id, node (JSX), cta (button label), question (chat seed) }.
export function computeJournalTasks(rows, role = "operator") {
  const amt = (r) => (r.debit != null ? r.debit : entryDebit(r));
  const amtC = (r) => (r.credit != null ? r.credit : entryCredit(r));
  const sum = (list) => list.reduce((s, r) => s + amt(r), 0);

  const drafts = rows.filter((r) => r.status === "draft");
  const pending = rows.filter((r) => r.status === "pending");
  const posted = rows.filter((r) => r.status === "posted");
  const voids = rows.filter((r) => r.status === "void");

  const draftValue = sum(drafts);
  const pendingValue = sum(pending);

  const totalDebit = rows.reduce((s, r) => s + amt(r), 0);
  const totalCredit = rows.reduce((s, r) => s + amtC(r), 0);
  const variance = totalDebit - totalCredit;
  const isBalanced = Math.abs(variance) < 1;

  const largestPending = pending
    .map((r) => ({ je: r, amount: amt(r) }))
    .sort((a, b) => b.amount - a.amount)[0];
  const largestPosted = posted
    .map((r) => ({ je: r, amount: amt(r) }))
    .sort((a, b) => b.amount - a.amount)[0];

  // ── Reusable task/insight builders ──────────────────────────────────────

  const draftTask = drafts.length > 0 ? {
    id: "drafts",
    node: (
      <>
        <strong className="lg-ai-strong">{drafts.length} draft journal{drafts.length === 1 ? "" : "s"}</strong> worth{" "}
        <strong className="lg-ai-strong">{fmtRpShort(draftValue)}</strong> not yet posted to the GL.
      </>
    ),
    cta: "View",
    question: "Which journals are drafted but not yet posted?",
  } : null;

  const pendingTask = pending.length > 0 ? {
    id: "pending",
    node: (
      <>
        <strong className="lg-ai-strong">{pending.length} journal{pending.length === 1 ? "" : "s"}</strong> worth{" "}
        <span className="lg-ai-danger">{fmtRpShort(pendingValue)}</span> awaiting your approval.
      </>
    ),
    cta: "Review",
    question: "Which journals are awaiting approval?",
  } : null;

  const balanceInsight = rows.length > 0 ? (isBalanced ? {
    id: "balanced",
    node: (
      <>
        Books <strong className="lg-ai-strong">balanced</strong> — debit = credit{" "}
        <strong className="lg-ai-strong">{fmtRpShort(totalDebit)}</strong> across {rows.length} entries.
      </>
    ),
    cta: "View",
    question: "What is the total debit and credit this period?",
  } : {
    id: "unbalanced",
    node: (
      <>
        <strong className="lg-ai-strong">GL unbalanced</strong> — variance{" "}
        <span className="lg-ai-danger">{fmtRpShort(Math.abs(variance))}</span>{" "}
        ({variance > 0 ? "debit heavier" : "credit heavier"}).
      </>
    ),
    cta: "View",
    question: "Why is total debit not equal to credit?",
  }) : null;

  const largestPendingInsight = largestPending ? {
    id: "largestPending",
    node: (
      <>
        Largest pending journal:{" "}
        <strong className="lg-ai-strong">{largestPending.je.je_number}</strong>{" "}
        ({largestPending.je.memo}) worth{" "}
        <span className="lg-ai-danger">{fmtRpShort(largestPending.amount)}</span>.
      </>
    ),
    cta: "Review",
    question: "Show the largest pending journal",
  } : null;

  const largestPostedInsight = largestPosted ? {
    id: "largestPosted",
    node: (
      <>
        Largest posted journal:{" "}
        <strong className="lg-ai-strong">{largestPosted.je.je_number}</strong>{" "}
        ({largestPosted.je.memo}) worth{" "}
        <strong className="lg-ai-strong">{fmtRpShort(largestPosted.amount)}</strong>.
      </>
    ),
    cta: "View",
    question: "Show the largest posted journal this period",
  } : null;

  const voidsInsight = voids.length > 0 ? {
    id: "voids",
    node: (
      <>
        <strong className="lg-ai-strong">{voids.length} voided journal{voids.length === 1 ? "" : "s"}</strong>{" "}
        this period — confirm each has an audit trail.
      </>
    ),
    cta: "View",
    question: "Show voided journals",
  } : null;

  // ── Bookkeeper (preparer): their prep queue ─────────────────────────────
  if (role === "preparer") {
    const prep = [draftTask].filter(Boolean);
    if (prep.length === 0) {
      prep.push({
        id: "empty",
        node: <>Your journal queue is clear — no unposted drafts waiting.</>,
        cta: "View",
        question: "What's in my journal queue right now?",
      });
    }
    return prep;
  }

  // ── View-only roles (viewer): read-only GL analytics ────────────────────
  if (role === "viewer") {
    const ro = [balanceInsight, largestPostedInsight, voidsInsight].filter(Boolean);
    if (ro.length === 0) {
      ro.push({
        id: "empty",
        node: <>No journals for this period yet.</>,
        cta: "View",
        question: "General journal summary",
      });
    }
    return ro;
  }

  // ── FM/Admin (operator): approval + supervisory queue (default) ─────────
  const tasks = [
    pendingTask,
    draftTask,
    balanceInsight,
    largestPendingInsight,
    voidsInsight,
  ].filter(Boolean);
  if (tasks.length === 0) {
    tasks.push({
      id: "empty",
      node: <>Nothing needs your attention in the GL right now.</>,
      cta: "View",
      question: "General journal summary",
    });
  }
  return tasks;
}

// ── AI chat context ──────────────────────────────────────────────────────

export function makeJournalAiContext(entries) {
  const draft = entries.filter((e) => e.status === "draft");
  const pending = entries.filter((e) => e.status === "pending");
  const posted = entries.filter((e) => e.status === "posted");
  const voids = entries.filter((e) => e.status === "void");

  const totalDebit = entries.reduce((s, e) => s + entryDebit(e), 0);
  const totalCredit = entries.reduce((s, e) => s + entryCredit(e), 0);

  const welcome = (
    <p>Hi Sside — I have reviewed your journals. How can I help?</p>
  );

  const suggestions = [
    "Show draft journals that need posting",
    "Journal which that awaiting approval?",
    "What total debit and credit this month?",
    "Show voided journals",
  ];

  function rowList(list, limit = 5) {
    return (
      <div className="ai-mini-table">
        {list.slice(0, limit).map((e) => (
          <div className="ai-mini-row" key={e.je_number}>
            <div className="ai-mini-av" style={{ fontSize: 9 }}>{e.je_number.slice(-3)}</div>
            <div className="ai-mini-body">
              <div className="ai-mini-name">{e.je_number}</div>
              <div className="ai-mini-meta">{e.memo}</div>
            </div>
            <div className="ai-mini-amt">{fmtRpShort(entryDebit(e))}</div>
          </div>
        ))}
      </div>
    );
  }

  function makeDraftResponse(send) {
    if (draft.length === 0) return { role: "ai", content: <p>None draft journals saat ini.</p> };
    return {
      role: "ai",
      content: (
        <>
          <p><strong>{draft.length} draft journals</strong> not yet posted:</p>
          {rowList(draft)}
          <div className="chat-chips">
            <ChatChip primary onClick={() => send("Post semua draft sekaligus")}>Post semua sekaligus</ChatChip>
            <ChatChip onClick={() => send("Review drafts one by one")}>Review one by one</ChatChip>
          </div>
        </>
      ),
    };
  }

  function makePendingResponse() {
    if (pending.length === 0) return { role: "ai", content: <p>None journals that awaiting approval.</p> };
    return {
      role: "ai",
      content: (
        <>
          <p><strong>{pending.length} journals</strong> awaiting approval:</p>
          {rowList(pending)}
          <div className="chat-chips">
            <ChatChip primary>Approve all</ChatChip>
            <ChatChip>View detail breakdown</ChatChip>
          </div>
        </>
      ),
    };
  }

  function makeBalanceResponse() {
    const variance = totalDebit - totalCredit;
    const balanced = Math.abs(variance) < 1;
    return {
      role: "ai",
      content: (
        <>
          <p>Summary total journals this period:</p>
          <ul style={{ paddingLeft: 16, margin: "8px 0", fontSize: 12 }}>
            <li>Total entri: <strong>{entries.length}</strong></li>
            <li>Total debit: <strong>{fmtRpShort(totalDebit)}</strong></li>
            <li>Total credit: <strong>{fmtRpShort(totalCredit)}</strong></li>
            <li>Status: {balanced ? <strong style={{ color: "var(--color-success-text)" }}>balanced ✓</strong> : <strong style={{ color: "var(--color-danger-text)" }}>unbalanced (variance {fmtRpShort(Math.abs(variance))})</strong>}</li>
          </ul>
        </>
      ),
    };
  }

  function makeVoidResponse() {
    if (voids.length === 0) return { role: "ai", content: <p>None voided journals this month.</p> };
    return {
      role: "ai",
      content: (
        <>
          <p><strong>{voids.length} journals</strong> voided this month:</p>
          {rowList(voids)}
          <div className="chat-chips">
            <ChatChip>Audit trail as of void</ChatChip>
            <ChatChip>Export laporan void</ChatChip>
          </div>
        </>
      ),
    };
  }

  function makeBreakdownResponse() {
    return {
      role: "ai",
      content: (
        <>
          <p>Breakdown journals this period:</p>
          <ul style={{ paddingLeft: 16, margin: "8px 0", fontSize: 12 }}>
            <li><strong>{posted.length}</strong> posted</li>
            <li><strong>{pending.length}</strong> pending approval</li>
            <li><strong>{draft.length}</strong> draft</li>
            <li><strong>{voids.length}</strong> void</li>
          </ul>
        </>
      ),
    };
  }

  function makeDefaultResponse(text) {
    return {
      role: "ai",
      content: (
        <>
          <p>I not yet can answer "{text}" di prototype ini, tapi I can help:</p>
          <div className="chat-chips">
            <ChatChip>Draft that need posting</ChatChip>
            <ChatChip>Journal pending approval</ChatChip>
            <ChatChip>Total debit & credit</ChatChip>
            <ChatChip>Breakdown status</ChatChip>
          </div>
        </>
      ),
    };
  }

  // ── Filter-intent detection + preview ──────────────────────────────────
  const FILTER_LEAD_RE = /^(show me|show|list|find|which|open|filter|all the|give me)\b/i;
  const FILTER_KEYWORD_RE = /\b(auto|flagged|drafts?|pending|posted|voided?|inventory|payroll|this\s+(week|month))\b/i;
  const AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*[mb]\b/i;
  function looksLikeFilterRequest(t) {
    return FILTER_LEAD_RE.test(t) || (FILTER_KEYWORD_RE.test(t) && /^(show|list|find|which|open|filter|all|give)/i.test(t.trim())) || AMOUNT_RE.test(t);
  }

  function pickMatching(t) {
    const lower = t.toLowerCase();
    let list = entries;
    if (/\bdrafts?\b/.test(lower)) list = list.filter(e => e.status === "draft");
    else if (/\bpending\b/.test(lower)) list = list.filter(e => e.status === "pending");
    else if (/\bposted\b/.test(lower)) list = list.filter(e => e.status === "posted");
    else if (/\bvoided?\b/.test(lower)) list = list.filter(e => e.status === "void");
    if (/\binventory\b/.test(lower)) {
      list = list.filter(e => /inventor/i.test(e.memo) || e.lines.some(l => /inventor/i.test(l.account_name || "")));
    } else if (/\bpayroll\b/.test(lower)) {
      list = list.filter(e => /payroll|salar|wage/i.test(e.memo) || e.lines.some(l => /payroll|salar|wage/i.test(l.account_name || "")));
    }
    const amt = lower.match(/(\d+(?:[.,]\d+)?)\s*([mb])\b/);
    if (amt) {
      const n = parseFloat(amt[1].replace(",", ".")) * (amt[2] === "b" ? 1e9 : 1e6);
      list = list.filter(e => entryDebit(e) >= n);
    }
    return list;
  }

  function makeFilterResponse(originalText) {
    const matches = pickMatching(originalText);
    if (matches.length === 0) {
      return {
        role: "ai",
        content: (
          <>
            <p>None journals matching <em>"{originalText}"</em>.</p>
            <p>Coba lebih spesifik — misalnya "show pending inventory" atau "list drafts above 50M".</p>
          </>
        ),
      };
    }
    return {
      role: "ai",
      content: (
        <>
          <p>
            Found <strong>{matches.length}</strong> {matches.length === 1 ? "journal" : "journals"} matching.{" "}
            {matches.length > 3 && "Top three:"}
          </p>
          {rowList(matches, 3)}
          <button
            type="button"
            className="chat-chip primary klay-open-in-table"
            onClick={() => window.dispatchEvent(new CustomEvent("klay:apply-filters", { detail: { query: originalText, count: matches.length } }))}
          >
            ✦ Open {matches.length} {matches.length === 1 ? "result" : "results"} in table →
          </button>
        </>
      ),
    };
  }

  function respond(text, helpers) {
    const t = text.toLowerCase();
    if (looksLikeFilterRequest(text)) return makeFilterResponse(text);
    if (t.includes("draft") || t.includes("post")) return makeDraftResponse(helpers.send);
    if (t.includes("pending") || t.includes("approval") || t.includes("awaiting")) return makePendingResponse();
    if (t.includes("debit") || t.includes("credit") || t.includes("balanced") || t.includes("balance") || t.includes("total")) return makeBalanceResponse();
    if (t.includes("void") || t.includes("batal")) return makeVoidResponse();
    if (t.includes("breakdown") || t.includes("ringcashan") || t.includes("status")) return makeBreakdownResponse();
    return makeDefaultResponse(text);
  }

  return { welcome, suggestions, respond };
}
