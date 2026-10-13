import { QueryClient } from "@tanstack/react-query";
import { ApiFailure } from "./api/errors";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry network failures only: an error response won't change by asking again.
        retry: (failures, error) => !(error instanceof ApiFailure) && failures < 2,
      },
    },
  });
}
