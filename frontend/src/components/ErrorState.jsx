/**
 * Shown when a fetch fails, in place of a spinner that would otherwise never
 * resolve. Always offers a way forward — retry, or a link out.
 */
export default function ErrorState({
  title = "We couldn't load this",
  message,
  onRetry,
  children,
}) {
  return (
    <div className="empty" role="alert">
      <h2>{title}</h2>
      {message && <p style={{ marginBottom: 24 }}>{message}</p>}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
