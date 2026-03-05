/**
 * Wraps content in an aria-live region so screen readers
 * announce when async content finishes loading.
 */
export function LiveRegion({
  children,
  busy,
  label,
}: {
  children: React.ReactNode;
  busy: boolean;
  label?: string;
}) {
  return (
    <div aria-live="polite" aria-busy={busy} aria-label={label}>
      {busy ? (
        <span className="sr-only">Loading…</span>
      ) : null}
      {children}
    </div>
  );
}
