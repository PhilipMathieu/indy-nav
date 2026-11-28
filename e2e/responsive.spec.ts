import { expect, test, type Page } from "@playwright/test";

// Tailwind's `sm` breakpoint: below it rows render as a card list.
const SM = 640;

function isSmall(page: Page) {
  return (page.viewportSize()?.width ?? 0) < SM;
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, "page scrolls horizontally").toBeLessThanOrEqual(innerWidth);
  // On mobile emulation an overflowing page widens the layout viewport instead
  // of scrolling, so also check against the device width.
  expect(innerWidth).toBe(page.viewportSize()!.width);
}

async function expectWithinViewportWidth(page: Page, selector: string) {
  const width = page.viewportSize()!.width;
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, text: el.textContent?.trim() };
      })
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.left, `${box.text} starts off-screen`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${box.text} ends off-screen`).toBeLessThanOrEqual(width);
  }
}

/** The visible list of mountains: cards on phones, table rows otherwise. */
function rows(page: Page) {
  return isSmall(page)
    ? page.getByTestId("mountain-list").locator("> li")
    : page.getByTestId("mountain-table").locator("tbody tr");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Indy Nav" })).toBeVisible();
  // MapLibre adds this class from a useEffect, so once it is present React has
  // hydrated and the filters respond to clicks.
  await expect(page.getByTestId("resort-map")).toHaveClass(/maplibregl-map/);
});

test("has no horizontal page overflow", async ({ page }) => {
  await expectNoHorizontalOverflow(page);
});

test("map and mountain list are visible and fit the viewport", async ({ page }) => {
  const width = page.viewportSize()!.width;
  const map = page.getByTestId("resort-map");
  await expect(map).toBeVisible();
  const mapBox = (await map.boundingBox())!;
  expect(mapBox.height).toBeGreaterThanOrEqual(250);
  expect(mapBox.x).toBeGreaterThanOrEqual(0);
  expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(width);

  if (isSmall(page)) {
    await expect(page.getByTestId("mountain-list")).toBeVisible();
    await expect(page.getByTestId("mountain-table")).toBeHidden();
  } else {
    await expect(page.getByTestId("mountain-table")).toBeVisible();
    await expect(page.getByTestId("mountain-list")).toBeHidden();
  }
  await expect(rows(page).first()).toBeVisible();
  expect(await rows(page).count()).toBeGreaterThan(10);

  const list = isSmall(page) ? page.getByTestId("mountain-list") : page.getByTestId("mountain-table");
  const listBox = (await list.boundingBox())!;
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(width);
});

test("filters fit on screen and have usable tap targets", async ({ page }) => {
  await expectWithinViewportWidth(page, '[data-slot="toggle-group-item"]');
  await expectWithinViewportWidth(page, '[data-slot="popover-trigger"]:has-text("Today")');

  if (isSmall(page)) {
    const heights = await page
      .locator('[data-slot="toggle-group-item"]')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(36);
  }
});

test("region filter narrows the list", async ({ page }) => {
  const total = await rows(page).count();
  await page.getByRole("button", { name: "Japan", exact: true }).click();
  await expect(page.getByText(new RegExp(`^\\d+ of ${total} mountains`))).toBeVisible();
  const filtered = await rows(page).count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total);
  await expectNoHorizontalOverflow(page);
});

test("date filter opens a calendar that fits on screen", async ({ page }) => {
  await page.getByRole("button", { name: "Today" }).click();
  const calendar = page.locator('[data-slot="popover-content"]').filter({ has: page.getByRole("grid") });
  await expect(calendar).toBeVisible();
  const box = (await calendar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("date source popover fits on screen", async ({ page }) => {
  await rows(page).first().getByRole("button", { name: "View source info" }).first().click();
  const popover = page.locator('[data-slot="popover-content"]').filter({ hasText: "confidence" });
  await expect(popover).toBeVisible();
  const box = (await popover.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("mountain list can be sorted by name on every screen size", async ({ page }) => {
  if (isSmall(page)) {
    await page.getByLabel("Sort by:").selectOption({ label: "Mountain (A–Z)" });
  } else {
    await page.getByRole("button", { name: "Mountain" }).click();
  }
  const nameSelector = isSmall(page) ? "a" : "td:first-child a";
  const names = await rows(page).locator(nameSelector).allTextContents();
  const firstFive = names.slice(0, 5);
  expect(firstFive).toEqual([...firstFive].sort((a, b) => a.localeCompare(b)));
});
