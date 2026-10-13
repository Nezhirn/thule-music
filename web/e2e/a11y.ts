import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "./test";

/** axe-core finds nothing against WCAG 2.2 AA and its best practices on the page as it is. */
export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}
