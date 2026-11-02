import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Button, ButtonSize } from "../../src/ui/button.tsx";
import { DataTable } from "../../src/ui/data-table.tsx";
import { rgb, styleOf, token } from "../support/style.ts";
import "../../src/styles.css";

const ROW_HEIGHT = 36;
const ROWS = [
  { id: "l1", name: "fpv-shop: Source One V5", landed: "€44.40", stock: "In stock" },
  { id: "l2", name: "quadparts: TBS Source One V5", landed: "€45.90", stock: "Out of stock" },
] as const;

const table = async (actions = true) => render(
  <DataTable
    caption="Listings"
    rows={ROWS}
    rowKey={({ id }) => id}
    rowHeader={{ header: "Listing", cell: ({ name }) => name }}
    columns={[
      { header: "Landed cost", numeric: true, cell: ({ landed }) => landed },
      { header: "Stock", cell: ({ stock }) => stock },
    ]}
    actions={actions
      ? ({ name }) => <Button size={ButtonSize.Small} aria-label={`Remove ${name}`}>Remove</Button>
      : undefined}
  />,
);

describe("Data table", () => {
  it("is a captioned table whose rows are named by their first cell", async () => {
    const screen = await table();
    const grid = screen.getByRole("table", { name: "Listings" });
    await expect.element(grid.getByRole("rowheader", { name: "fpv-shop: Source One V5" })).toBeVisible();
    await expect.element(grid.getByRole("columnheader", { name: "Landed cost" })).toBeVisible();
    await expect.element(grid.getByRole("cell", { name: "€45.90" })).toBeVisible();
  });

  it("right-aligns numbers in the readout face and keeps words left in sans", async () => {
    const screen = await table();
    const money = styleOf(screen.getByRole("cell", { name: "€44.40" }));
    expect(money.textAlign).toBe("right");
    expect(money.fontFamily).toContain("Martian Mono");
    const words = styleOf(screen.getByRole("cell", { name: "In stock" }));
    expect(words.textAlign).toBe("left");
    expect(words.fontFamily).toContain("IBM Plex Sans");
  });

  it("puts uppercase label headers over a strong rule, rows at least 36px", async () => {
    const screen = await table();
    const header = styleOf(screen.getByRole("columnheader", { name: "Stock" }));
    expect(header.textTransform).toBe("uppercase");
    expect(header.borderBottomColor).toBe(rgb(token("--color-line-strong")));
    expect(Number.parseFloat(styleOf(screen.getByRole("row").nth(1)).height)).toBeGreaterThanOrEqual(ROW_HEIGHT);
  });

  it("ends each row with its actions under a header only screen readers see", async () => {
    const screen = await table();
    await expect.element(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Remove quadparts: TBS Source One V5" })).toBeVisible();
  });

  it("has no actions column when rows have no actions", async () => {
    const screen = await table(false);
    await expect.element(screen.getByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
  });
});
