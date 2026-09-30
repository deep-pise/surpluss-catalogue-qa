
import { test, expect } from "@playwright/test";

test("buyer submits a product enquiry and admin sees it in Leads", async ({
  page,
}) => {
  // 1. Open the seeded published catalogue
  await page.goto("/catalogue/premium-corporate-essentials");

  // 2. Verify the seeded product is visible
  await expect(
    page.getByRole("heading", { name: "Atlas cabin trolley" }),
  ).toBeVisible();

  // 3. Open the product
  await page
    .getByRole("link", { name: "Atlas cabin trolley" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Atlas cabin trolley" }),
  ).toBeVisible();

  // 4. Open the enquiry dialog
  await page
    .getByRole("button", { name: /Contact Us|Price on enquiry/i })
    .click();

  // 5. Wait for the actual dialog
  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();

  // The application contains two "Contact supplier" headings.
  // Target the actual dialog title to avoid Playwright strict-mode errors.
  await expect(
    dialog.locator('[data-slot="dialog-title"]'),
  ).toHaveText("Contact supplier");

  // 6. Fill buyer details
  await dialog
    .locator("#contact-name")
    .fill("Test Buyer");

  await dialog
    .locator("#contact-phone")
    .fill("9876543210");

  // 7. Verify the seeded product MOQ
  // Atlas cabin trolley MOQ = 20
  await expect(
    dialog.locator("#contact-quantity"),
  ).toHaveValue("20");

  // 8. Submit the enquiry
  await dialog
    .getByRole("button", { name: "Send enquiry" })
    .click();

  // 9. Verify successful submission
  await expect(
    dialog.getByText("Enquiry sent"),
  ).toBeVisible();

  // 10. Capture the generated enquiry reference
  const reference = await dialog
    .getByText(/^ENQ-\d{7}$/)
    .textContent();

  expect(reference).toMatch(/^ENQ-\d{7}$/);

  // 11. Open Admin Leads
  await page.goto("/admin/leads");

  // 12. Login if the application redirects to login
  if (page.url().includes("/login")) {
    await page
      .locator("#email")
      .fill("admin@catalogue.test");

    await page
      .locator("#password")
      .fill("Admin#2026");

    await page
      .getByRole("button", { name: "Sign in" })
      .click();

    await page.waitForURL(/\/admin/);

    await page.goto("/admin/leads");
  }

  // 13. Search for the generated enquiry
  const searchBox = page.getByPlaceholder(
    "Search buyer, reference or contact",
  );

  await searchBox.fill(reference!);

  // 14. Verify the enquiry is visible in the Leads Inbox
  await expect(
    page.getByText(reference!),
  ).toBeVisible();

  await expect(
    page.getByText("Test Buyer"),
  ).toBeVisible();
});
