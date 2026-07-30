import { useCallback, useEffect, useState } from "react";

/**
 * Runs an async fetcher and tracks { data, error, loading }, exposing reload().
 *
 * Every page used to fetch with a bare `.then()`, so any rejection — a 404 slug,
 * a dropped connection — left the spinner on screen forever with no way out.
 * Routing fetches through here makes the failure path impossible to forget.
 *
 * `deps` behaves like a useEffect dependency list: the fetcher re-runs whenever
 * it changes, and a stale response is discarded rather than overwriting a newer one.
 */
export function useAsync(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    let cancelled = false;
    setState({ data: null, error: null, loading: true });

    fetcher()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ data: null, error: err?.message || "Something went wrong", loading: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, deps);

  useEffect(run, [run]);

  return { ...state, reload: run };
}
