import { useState } from "react";
import { CategoryCodes } from "./ItemAccountTables";
import { ASSET_ACCOUNT_ROWS, ASSET_ACCOUNT_ROWS_BY_TYPE } from "../data/seed/fixedAssets";
import {
  BOOK_STATUS_LABELS, BOOK_STATUS_BY_TYPE, BOOK_STATUS_ACCOUNTS_IN_USE, bookStatusesForType,
  JOURNAL_SOURCES, JOURNAL_WHEN, TYPE_LABELS,
} from "../lib/fixedAssets";
import { useAccountingSettings } from "../state/AccountingSettingsContext";
import { useModuleSettings } from "../state/ModuleSettingsContext";
import { useSettingsAudit } from "../state/SettingsAuditContext";
import "./item-account-tables.css";

// Settings → Fixed Assets → <type>: that type's book status journal, from the
// Journal Assets Register spec — each type moves through its own statuses (a
// prepaid is never built or held for sale, an intangible is never held for
// sale) and posts its own lines. Every account is one of the asset
// category's (picked per line here, the number set on the category); the
// bill's payable and a disposal's cash or receivable are fixed. The tables read
// the live registries in lib/fixedAssets.js through AccountingSettingsContext,
// so they show what the next event will post.

const roleLabel = Object.fromEntries(ASSET_ACCOUNT_ROWS);
const statusLabel = (type, status) => BOOK_STATUS_BY_TYPE[type]?.[status] || BOOK_STATUS_LABELS[status];

// What the schedule is doing in each status, in each type's words.
const CHARGE_HEAD = { fixed_asset: "Depreciation", prepaid: "Release", intangible: "Amortisation" };
const chargeText = (type, status) => ({
  under_construction: "Not started",
  in_service: "Running",
  fully_depreciated: statusLabel(type, "fully_depreciated"),
  held_for_sale: "Stopped",
  disposed: "Stopped",
}[status]);

// Notes the spec's table can't hold in a cell.
const STATUS_NOTES = {
  fixed_asset: {
    under_construction: "Posted by the bill — this only shows where the cost sits.",
    in_service: "The Accumulated / Expense pair has no amount defined in the spec yet, so it posts nothing.",
    fully_depreciated: "Reached when the schedule has charged everything above salvage — no one moves an asset here.",
    held_for_sale: "Held at the lower of carrying amount and fair value less costs to sell. A gain waits for the sale.",
    disposed: "From Held for Sale it credits Held for Sale for the held amount instead of Asset and Accumulated.",
  },
  prepaid: {
    in_service: "The bill already put the cost in the prepaid account; each period then releases part of it.",
    fully_depreciated: "Reached when the last period has released.",
    disposed: "Expenses what is left of the prepaid, less any refund.",
  },
  intangible: {
    under_construction: "Posted by the bill — this only shows where the cost sits.",
    in_service: "The Accumulated / Expense pair has no amount defined in the spec yet, so it posts nothing.",
    fully_depreciated: "Reached when the schedule has charged everything above salvage.",
  },
};

export function TypeBookStatus({ type, canEdit }) {
  const [changed, setChanged] = useState(() => new Set());
  const mark = (key) => setChanged((x) => new Set(x).add(key));
  const { bookJournals, setBookJournalRole, depreciationJournals, setDepreciationRole } = useAccountingSettings();
  const { assetCategories } = useModuleSettings();
  const { log } = useSettingsAudit();
  const categories = assetCategories.filter((c) => c.type === type);
  const roles = ASSET_ACCOUNT_ROWS_BY_TYPE[type];
  const journals = bookJournals[type] || {};
  const charge = depreciationJournals[type];

  const setLine = (status, line, role) => {
    log("Fixed Assets", "Book status", `${TYPE_LABELS[type]} — ${statusLabel(type, status)}: ${line.side === "debit" ? "Dr" : "Cr"} ${roleLabel[line.role]} → ${roleLabel[role]}`);
    setBookJournalRole(type, status, line.id, role);
    mark(`${type}-${status}`);
  };
  const setCharge = (side, role) => {
    log("Fixed Assets", "Book status", `${TYPE_LABELS[type]} — each period: ${side === "debit" ? "Dr" : "Cr"} ${roleLabel[charge[side]]} → ${roleLabel[role]}`);
    setDepreciationRole(type, side, role);
    mark(`${type}-charge`);
  };

  const rolePicker = (value, label, onChange) => (canEdit ? (
    <select className="ia-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {roles.map(([k, l]) => <option key={k} value={k}>Category's {l}</option>)}
    </select>
  ) : <b>Category's {roleLabel[value]}</b>);
  const codes = (role) => <CategoryCodes role={role} categories={categories} none="No category names this account." differs="Differs by category" />;

  const lineCell = (line, onRole, label) => (
    <div key={line.id || line.side} className="ia-jline">
      <span className="ia-side">{line.side === "debit" ? "Dr" : "Cr"}</span>
      <div className="ia-jacct">
        {line.source ? (
          <><b>{JOURNAL_SOURCES[line.source].label}</b><span className="mr-sub">{JOURNAL_SOURCES[line.source].hint}</span></>
        ) : (
          <>{rolePicker(line.role, label, onRole)}{codes(line.role)}</>
        )}
        {line.when && <span className="mr-sub">{JOURNAL_WHEN[line.when]}</span>}
        {line.amount === null && <span className="mr-sub ia-none">No amount defined — not posted.</span>}
      </div>
    </div>
  );
  const changedNote = (key) => changed.has(key) && <span className="mr-sub ia-changed">Changed — applies to events booked from now on</span>;

  return (
    <section className="mr-section">
      <div className="mr-head">
        <div>
          <div className="mr-title">Book status journal</div>
          <p className="mr-intro">
            What the journal posts when an asset enters each book status, and what each period posts while it
            runs. Each line uses one of the category's accounts — the number is set on the category, above.
          </p>
        </div>
      </div>
      {canEdit && (
        <p className="coa-warn ia-warn">
          Changing an account here changes what book status changes post to <b>from now on</b>. Journals already
          booked keep the accounts they were made with — nothing moves.
        </p>
      )}
      <div className="mr-table">
        <div className="mr-tr mr-th ia-bs">
          <div>Book status</div><div>Accounts in use</div><div>Journal when entering this status</div><div>{CHARGE_HEAD[type]}</div>
        </div>
        {bookStatusesForType(type).map((status) => {
          const lines = journals[status] || [];
          const inUse = BOOK_STATUS_ACCOUNTS_IN_USE[status].filter((r) => roles.some(([k]) => k === r));
          return (
            <div key={status} className="mr-tr ia-bs">
              <div className="mr-td"><b>{statusLabel(type, status)}</b>{changedNote(`${type}-${status}`)}</div>
              <div className="mr-td">{inUse.length ? inUse.map((r) => roleLabel[r]).join(", ") : <span className="mr-muted">None</span>}</div>
              <div className="mr-td">
                {lines.length
                  ? lines.map((l) => lineCell(l, (role) => setLine(status, l, role), `${statusLabel(type, status)} ${l.side} account`))
                  : <span className="mr-muted">No journal</span>}
                {STATUS_NOTES[type]?.[status] && <span className="mr-sub ia-jnote">{STATUS_NOTES[type][status]}</span>}
              </div>
              <div className="mr-td">{chargeText(type, status)}</div>
            </div>
          );
        })}
        {/* The spec's Depre/Amortization Journal: what each period posts while running. */}
        <div className="mr-tr ia-bs ia-period">
          <div className="mr-td"><b>Each period</b><span className="mr-sub">While {statusLabel(type, "in_service").toLowerCase()}</span>{changedNote(`${type}-charge`)}</div>
          <div className="mr-td"><span className="mr-muted">—</span></div>
          <div className="mr-td">
            {["debit", "credit"].map((side) => lineCell({ side, role: charge[side] }, (role) => setCharge(side, role), `${TYPE_LABELS[type]} periodic ${side} account`))}
          </div>
          <div className="mr-td">{CHARGE_HEAD[type]} charge</div>
        </div>
      </div>
    </section>
  );
}
