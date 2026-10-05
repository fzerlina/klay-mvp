// Export a bulk-transfer file for internet banking from the selected bills.
//
// Writing the file is the whole job: nothing is recorded and no status moves
// (see lib/bankFiles.js). The dialog shows exactly what goes in the file — and
// what was left out, and why — before anything is downloaded.

import { useMemo, useState } from "react";
import { accountsForMethod, maskOf } from "../data/seed/bankAccounts";
import { buildBankFile, buildTransfers, downloadTextFile, formatForAccount } from "../lib/bankFiles";
import { useVendors } from "../state/VendorsContext";
import { formatRupiahExact } from "../lib/format";
import { TODAY } from "../lib/clock";
import "../pages/ap-aging.css";
import "../pages/payments.css";

export default function BankFileExportModal({ lines, onClose }) {
  const { vendorById } = useVendors();

  // Only IDR accounts at a bank with a file format can produce one.
  const sources = useMemo(
    () => accountsForMethod("bank").filter((a) => a.currency === "IDR" && formatForAccount(a)),
    [],
  );
  const [sourceId, setSourceId] = useState(sources[0]?.id || "");
  const source = sources.find((a) => a.id === sourceId) || null;

  const { transfers, excluded } = useMemo(
    () => buildTransfers(lines, { vendorById, source }),
    [lines, vendorById, source],
  );
  const total = transfers.reduce((s, t) => s + t.amount, 0);
  const withheld = transfers.reduce((s, t) => s + t.withheld, 0);
  const date = TODAY.toISOString().slice(0, 10);
  const fmt = formatForAccount(source);

  const download = () => {
    const file = buildBankFile(transfers, { source, date });
    if (file) downloadTextFile(file.filename, file.content);
    onClose();
  };

  return (
    <div className="apa-modal-scrim" onClick={onClose}>
      <div className="apa-modal pm-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="apa-modal-head">
          <h3>Export bank file</h3>
          <button type="button" className="apa-modal-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="apa-modal-body">
          <div className="pm-sec" style={{ marginTop: 0 }}>
            <div className="pm-sec-lbl">Pay from</div>
            <select className="pm-select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              {sources.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {maskOf(a)}</option>
              ))}
            </select>
            {fmt && (
              <div className="pm-sec-hint">
                File format: <strong>{fmt.label}</strong>. Layout not yet checked against the bank's own template — compare before the first upload.
              </div>
            )}
          </div>

          <div className="pm-sec">
            <div className="pm-sec-lbl">In the file · {transfers.length} transfer{transfers.length === 1 ? "" : "s"}</div>
            {transfers.length === 0 ? (
              <div className="pm-acct-empty">None of the selected bills can go in a bank file.</div>
            ) : (
              <div className="pm-snap pm-export-list">
                <div className="pm-snap-row head pm-export-row">
                  <span>Vendor · account</span>
                  <span className="num">Transfer</span>
                </div>
                {transfers.map((t) => (
                  <div key={t.billId} className="pm-snap-row pm-export-row">
                    <span className="pm-snap-item">
                      <span className="pm-snap-desc">{t.holder}</span>
                      <span className="pm-snap-sub">
                        {t.bank} · {t.accountDisplay} · {t.remark}
                        {!t.sameBank && <span className="pm-snap-tag">Interbank</span>}
                      </span>
                    </span>
                    <span className="num">
                      {formatRupiahExact(t.amount)}
                      {t.withheld > 0 && <span className="pm-export-wht">PPh {formatRupiahExact(t.withheld)} kept back</span>}
                    </span>
                  </div>
                ))}
                <div className="pm-snap-sum">
                  <div className="strong"><span>Total to transfer</span><strong>{formatRupiahExact(total)}</strong></div>
                  {withheld > 0 && <div><span>PPh kept back for the tax office</span><strong>{formatRupiahExact(withheld)}</strong></div>}
                </div>
              </div>
            )}
          </div>

          {excluded.length > 0 && (
            <div className="pm-sec">
              <div className="pm-sec-lbl">Left out · {excluded.length}</div>
              <div className="pm-export-excluded">
                {excluded.map(({ line, reason }) => (
                  <div key={line.id}><strong>{line.id}</strong> {line.vendorName} — {reason}</div>
                ))}
              </div>
            </div>
          )}

          <div className="apa-modal-note">
            Exporting does not record anything. Once the bank has made the transfers, record each payment as usual.
          </div>
        </div>

        <div className="apa-modal-foot">
          <button type="button" className="apa-modal-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="apa-modal-btn primary" disabled={!transfers.length || !fmt} onClick={download}>
            Download file
          </button>
        </div>
      </div>
    </div>
  );
}
