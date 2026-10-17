import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { filtersFrom, type Facet, type Filters } from "./filters";

/** A list's filters, kept in the address: going back undoes the last change, and a link
 * (a genre on the home page) opens the list filtered. */
export function useFilters(facets: readonly Facet[]): {
  filters: Filters;
  set(facet: Facet, value: string | null): void;
  clear(): void;
} {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (facet: Facet, value: string | null) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(facet, value);
        else next.delete(facet);
        return next;
      }),
    [setParams],
  );
  const clear = useCallback(
    () =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const facet of facets) next.delete(facet);
        return next;
      }),
    [setParams, facets],
  );
  return { filters: filtersFrom(params, facets), set, clear };
}
