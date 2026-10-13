// Playwright's `test` for this suite: a test fails if its pages broke the Content Security
// Policy the server sends. A style or script the policy doesn't allow would otherwise go
// unnoticed until it misbehaved in production.
import { expect, test as base } from "@playwright/test";

export * from "@playwright/test";

export const test = base.extend<{ policy: void }>({
  policy: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("Content Security Policy")) {
          violations.push(message.text());
        }
      });
      await use();
      expect(violations, "Content Security Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});
