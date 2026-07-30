/**
 * Page control for the admin listings, which were previously hard-capped
 * (100 products, 200 orders) with everything beyond that silently unreachable.
 */
export default function Pager({ page, pages, total, limit, label, onPage }) {
  if (!total) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="pager">
      <span className="pager-count">
        {from}–{to} of {total} {label}
      </span>
      {pages > 1 && (
        <div className="tools">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            ← Previous
          </button>
          <span className="pager-page">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
