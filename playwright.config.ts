import { defineConfig, devices } from "@playwright/test";

// Serves the static export in out/ (run `npx next build` first, or use
// `npm run test:e2e`, which builds). Set E2E_PORT if 4173 is taken.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    timezoneId: "America/New_York",
  },
  // Every project runs in Chromium so CI only needs one browser; the named
  // devices still set viewport, touch, and mobile emulation.
  projects: [
    { name: "iphone-14", use: { ...devices["iPhone 14"], browserName: "chromium" } },
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
    { name: "small-phone", use: { ...devices["iPhone SE"], browserName: "chromium" } },
    { name: "ipad-mini", use: { ...devices["iPad Mini"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `node e2e/static-server.mjs ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
