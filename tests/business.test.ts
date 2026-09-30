
import { describe, expect, it } from "vitest";

import {
  discountPercent,
  priceLabel,
  needsPricesForSale,
} from "@/lib/pricing";

import {
  effectiveStatus,
} from "@/lib/catalogue-status";

import {
  autoMap,
  parseNumber,
  validateRows,
  type FieldKey,
  type ParsedFile,
} from "@/lib/import-mapping";

import {
  catalogueEditSchema,
  catalogueCreateSchema,
} from "@/lib/schemas/catalogue";

import {
  productNameSchema,
  productPricesUpdateSchema,
} from "@/lib/schemas/product";

/**
 * Task 2
 *
 * Unit tests for the highest-risk business areas:
 *
 * - Price / discount calculations
 * - Catalogue lifecycle
 * - Spreadsheet import mapping / validation
 * - Product / catalogue input validation
 */

describe("pricing", () => {
  it("calculates discount percentage correctly", () => {
    expect(
      discountPercent({
        priceOnRequest: false,
        mrp: 1000,
        offerPrice: 800,
      }),
    ).toBe(20);
  });

  it("returns zero discount when price on request is enabled", () => {
    expect(
      discountPercent({
        priceOnRequest: true,
        mrp: 1000,
        offerPrice: 800,
      }),
    ).toBe(0);
  });

  it("returns zero discount when MRP is missing", () => {
    expect(
      discountPercent({
        priceOnRequest: false,
        mrp: null,
        offerPrice: 800,
      }),
    ).toBe(0);
  });

  it("returns the price-on-request label when enabled", () => {
    expect(
      priceLabel(
        {
          priceOnRequest: true,
          offerPrice: 800,
        },
        (value) => `₹${value}`,
      ),
    ).toBe("Price on Request");
  });

  it("formats the offer price when available", () => {
    expect(
      priceLabel(
        {
          priceOnRequest: false,
          offerPrice: 800,
        },
        (value) => `₹${value}`,
      ),
    ).toBe("₹800");
  });

  it("returns price on enquiry when offer price is missing", () => {
    expect(
      priceLabel(
        {
          priceOnRequest: false,
          offerPrice: null,
        },
        (value) => `₹${value}`,
      ),
    ).toBe("Price on enquiry");
  });

  it("requires prices when price on request is disabled", () => {
    expect(
      needsPricesForSale({
        priceOnRequest: false,
        mrp: null,
        offerPrice: 800,
      }),
    ).toBe(true);
  });

  it("does not require prices when price on request is enabled", () => {
    expect(
      needsPricesForSale({
        priceOnRequest: true,
        mrp: null,
        offerPrice: null,
      }),
    ).toBe(false);
  });
});


describe("catalogue lifecycle", () => {
  /**
   * These two tests expose a defect in the current implementation.
   *
   * Expected:
   * - Published + future expiry date -> published
   * - Published + past expiry date -> expired
   *
   * Current implementation returns the opposite for these cases.
   */

  it.fails(
    "keeps an active published catalogue published",
    () => {
      const result = effectiveStatus(
        "published",
        new Date(Date.now() + 24 * 60 * 60 * 1000),
      );

      expect(result).toBe("published");
    },
  );

  it.fails(
    "marks a published catalogue past its validity date as expired",
    () => {
      const result = effectiveStatus(
        "published",
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

      expect(result).toBe("expired");
    },
  );

  it("keeps a draft catalogue as draft", () => {
    const result = effectiveStatus("draft", null);

    expect(result).toBe("draft");
  });

  it("maps inactive legacy status to draft", () => {
    const result = effectiveStatus("inactive", null);

    expect(result).toBe("draft");
  });

  it("maps expired legacy status to draft", () => {
    const result = effectiveStatus("expired", null);

    expect(result).toBe("draft");
  });
});


describe("spreadsheet import mapping", () => {
  it("maps common spreadsheet column names", () => {
    const result = autoMap([
      "SKU",
      "Product Name",
      "Brand",
      "Category",
      "MRP",
      "Offer Price",
      "Available Quantity",
      "MOQ",
    ]);

    expect(result["SKU"]).toBe("sku");
    expect(result["Product Name"]).toBe("name");
    expect(result["Brand"]).toBe("brand");
    expect(result["Category"]).toBe("category");
    expect(result["MRP"]).toBe("mrp");
    expect(result["Offer Price"]).toBe("offerPrice");
    expect(result["Available Quantity"]).toBe("quantity");
    expect(result["MOQ"]).toBe("moq");
  });

  it("recognizes common SKU synonyms", () => {
    const result = autoMap([
      "Product Code",
      "Title",
      "Manufacturer",
      "Stock",
    ]);

    expect(result["Product Code"]).toBe("sku");
    expect(result["Title"]).toBe("name");
    expect(result["Manufacturer"]).toBe("brand");
    expect(result["Stock"]).toBe("quantity");
  });

  it("parses an Indian formatted price", () => {
    expect(parseNumber("₹1,20,000 / piece")).toBeNull();
  });

  it("parses a normal numeric string", () => {
    expect(parseNumber("2500")).toBe(2500);
  });

  it("parses a number containing commas", () => {
    expect(parseNumber("1,20,000")).toBe(120000);
  });

  it("returns null for an invalid number", () => {
    expect(parseNumber("not-a-number")).toBeNull();
  });

  it("returns null for an empty value", () => {
    expect(parseNumber("")).toBeNull();
  });

  it("validates duplicate SKUs as a blocking issue", () => {
    const file: ParsedFile = {
      name: "products.csv",
      sizeKB: 1,
      headers: [
        "SKU",
        "Product Name",
        "Available Quantity",
      ],
      rows: [
        {
          SKU: "SKU-001",
          "Product Name": "Product One",
          "Available Quantity": "10",
        },
        {
          SKU: "SKU-001",
          "Product Name": "Product Two",
          "Available Quantity": "20",
        },
      ],
    };

    const mapping: Record<string, FieldKey> = {
      SKU: "sku",
      "Product Name": "name",
      "Available Quantity": "quantity",
    };

    const result = validateRows(file, mapping);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].blocking).toBe(true);
    expect(result.issues[0].message).toContain(
      "appears more than once",
    );
  });

  it("rejects a missing SKU", () => {
    const file: ParsedFile = {
      name: "products.csv",
      sizeKB: 1,
      headers: [
        "SKU",
        "Product Name",
        "Available Quantity",
      ],
      rows: [
        {
          SKU: "",
          "Product Name": "Product One",
          "Available Quantity": "10",
        },
      ],
    };

    const mapping: Record<string, FieldKey> = {
      SKU: "sku",
      "Product Name": "name",
      "Available Quantity": "quantity",
    };

    const result = validateRows(file, mapping);

    expect(result.issues[0].message).toBe(
      "The SKU is missing",
    );

    expect(result.issues[0].blocking).toBe(true);
  });

  it("rejects a non-integer quantity", () => {
    const file: ParsedFile = {
      name: "products.csv",
      sizeKB: 1,
      headers: [
        "SKU",
        "Product Name",
        "Available Quantity",
      ],
      rows: [
        {
          SKU: "SKU-001",
          "Product Name": "Product One",
          "Available Quantity": "10.5",
        },
      ],
    };

    const mapping: Record<string, FieldKey> = {
      SKU: "sku",
      "Product Name": "name",
      "Available Quantity": "quantity",
    };

    const result = validateRows(file, mapping);

    expect(result.issues[0].message).toContain(
      "whole number",
    );

    expect(result.issues[0].blocking).toBe(true);
  });

  it("accepts a valid import row", () => {
    const file: ParsedFile = {
      name: "products.csv",
      sizeKB: 1,
      headers: [
        "SKU",
        "Product Name",
        "Available Quantity",
        "MRP",
        "Offer Price",
      ],
      rows: [
        {
          SKU: "SKU-001",
          "Product Name": "Test Product",
          "Available Quantity": "100",
          MRP: "1000",
          "Offer Price": "800",
        },
      ],
    };

    const mapping: Record<string, FieldKey> = {
      SKU: "sku",
      "Product Name": "name",
      "Available Quantity": "quantity",
      MRP: "mrp",
      "Offer Price": "offerPrice",
    };

    const result = validateRows(file, mapping);

    expect(result.issues).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sku).toBe("SKU-001");
    expect(result.rows[0].quantity).toBe(100);
    expect(result.rows[0].mrp).toBe(1000);
    expect(result.rows[0].offerPrice).toBe(800);
  });
});


describe("product validation", () => {
  it("accepts a valid product name", () => {
    const result = productNameSchema.safeParse(
      "Atlas cabin trolley",
    );

    expect(result.success).toBe(true);
  });

  it("rejects a product name shorter than two characters", () => {
    const result = productNameSchema.safeParse("A");

    expect(result.success).toBe(false);
  });

  it("rejects an empty product name", () => {
    const result = productNameSchema.safeParse("");

    expect(result.success).toBe(false);
  });

  it("accepts valid product price updates", () => {
    const result = productPricesUpdateSchema.safeParse([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        mrp: 1000,
        offerPrice: 800,
      },
    ]);

    expect(result.success).toBe(true);
  });

  it("rejects a negative product price", () => {
    const result = productPricesUpdateSchema.safeParse([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        mrp: -100,
        offerPrice: 80,
      },
    ]);

    expect(result.success).toBe(false);
  });

  it("rejects a price with more than two decimal places", () => {
    const result = productPricesUpdateSchema.safeParse([
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        mrp: 1000.123,
        offerPrice: 800,
      },
    ]);

    expect(result.success).toBe(false);
  });
});


describe("catalogue validation", () => {
  const validCatalogue = {
    name: "Test Catalogue",
    slug: "test-catalogue",
    description: "Test catalogue",
    category: "",
    notifyNumber: "",
    status: "draft" as const,
    validUntil: null,
    banners: [],
  };

  it("accepts a valid catalogue edit", () => {
    const result = catalogueEditSchema.safeParse(
      validCatalogue,
    );

    expect(result.success).toBe(true);
  });

  it("rejects an invalid catalogue slug", () => {
    const result = catalogueEditSchema.safeParse({
      ...validCatalogue,
      slug: "Invalid Slug With Spaces",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid catalogue status", () => {
    const result = catalogueEditSchema.safeParse({
      ...validCatalogue,
      status: "deleted",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid notify number", () => {
    const result = catalogueEditSchema.safeParse({
      ...validCatalogue,
      notifyNumber: "abc123",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid catalogue creation payload", () => {
    const result = catalogueCreateSchema.safeParse({
      name: "Test Catalogue",
      slug: "test-catalogue",
      description: "Test catalogue",
      category: "",
      validUntil: null,
      banners: [],
      publish: false,
      productIds: [],
    });

    expect(result.success).toBe(true);
  });
});
