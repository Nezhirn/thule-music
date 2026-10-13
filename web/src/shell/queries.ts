import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";
import { unwrap } from "../api/errors";

export const playlistsQuery = queryOptions({
  queryKey: ["playlists"],
  queryFn: () => unwrap(api.GET("/api/v1/playlists")),
});
