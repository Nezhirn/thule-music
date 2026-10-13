import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppProviders } from "../AppProviders";
import { AppRoutes } from "../routes";
import { FakeAudio } from "./audio";

/** The whole app at `path`, with a fresh query cache; `audio` stands in for the player's
 * <audio> element. */
export function renderApp(path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  const audio = new FakeAudio();
  const view = render(
    <AppProviders queryClient={queryClient} audio={audio.asAudio()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return { user, queryClient, audio, ...view };
}
