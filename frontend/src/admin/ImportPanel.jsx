import { useState } from "react";
import { api } from "../api";

/**
 * Load the shop's own stock from a spreadsheet. The file is checked first
 * (nothing written) so the owner sees what will be created and updated, and
 * every problem with its row number, before confirming.
 */
export default function ImportPanel({ onDone, onClose }) {
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(dry) {
    setError("");
    setBusy(true);
    try {
      const r = await api.admin.importCatalogue(file, { dry });
      setReport(r);
      if (r.written) onDone(`Imported: ${r.created} new, ${r.updated} updated.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    try {
      const url = URL.createObjectURL(await api.admin.importTemplate());
      const a = document.createElement("a");
      a.href = url;
      a.download = "catalogue-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="drawer form-grid" role="region" aria-labelledby="import-title">
      <h3 id="import-title">Import products from a spreadsheet</h3>
      <p className="hint">
        One row per size and colour, as CSV or Excel (.xlsx). Products are matched by handle (or name), so importing an
        edited sheet again updates them instead of adding copies. Prices are in the shop's currency, e.g. 175000.{" "}
        <button type="button" className="link-btn" onClick={template}>
          Download the template
        </button>
      </p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="tools">
        <label htmlFor="import-file" className="sr-only">
          Spreadsheet file
        </label>
        <input
          id="import-file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setReport(null);
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!file || busy} onClick={() => run(true)}>
          {busy && !report ? "Checking…" : "Check file"}
        </button>
        <button type="button" className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>

      {report && (
        <div aria-live="polite">
          {report.errors.length > 0 ? (
            <div className="alert alert-error" role="alert">
              <strong>
                {report.errors.length} problem{report.errors.length === 1 ? "" : "s"}. Nothing was imported; fix the file
                and check it again.
              </strong>
              <ul className="import-errors">
                {report.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {report.errors.length > 50 && <p>…and {report.errors.length - 50} more.</p>}
            </div>
          ) : report.written ? (
            <div className="alert alert-ok" role="status">
              Done: {report.created} new, {report.updated} updated.
            </div>
          ) : (
            <>
              <p>
                Ready to import: <strong>{report.created}</strong> new and <strong>{report.updated}</strong> updated
                product{report.updated === 1 ? "" : "s"}.
              </p>
              <div className="table-scroll import-preview">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Action</th>
                      <th className="num">Variants</th>
                      <th className="num">Units</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.products.map((p) => (
                      <tr key={p.slug}>
                        <td>{p.name}</td>
                        <td>{p.action === "create" ? "New" : "Update"}</td>
                        <td className="num">{p.variants}</td>
                        <td className="num">{p.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(false)}>
                {busy ? "Importing…" : `Import ${report.products.length} product${report.products.length === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
