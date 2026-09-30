import { beforeEach, describe, expect, it, vi } from "vitest";

const IDS = {
  catalogue: "550e8400-e29b-41d4-a716-446655440000",
  otherCatalogue: "550e8400-e29b-41d4-a716-446655440001",
  listing: "550e8400-e29b-41d4-a716-446655440002",
  product: "550e8400-e29b-41d4-a716-446655440003",
};

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  currentActor: vi.fn(),
  getPrisma: vi.fn(),
  findIncompleteProducts: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/auth-guards", () => ({
  currentActor: mocks.currentActor,
  isAdmin: (actor: { role?: string } | null) => actor?.role === "admin",
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/incomplete", () => ({
  findIncompleteProducts: mocks.findIncompleteProducts,
  incompleteMessage: (count: number) =>
    count === 1
      ? "1 product needs prices and stock before this catalogue can go live."
      : `${count} products need prices and stock before this catalogue can go live.`,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { deleteCatalogue, setCatalogueStatus } from "@/app/admin/actions";
import { PATCH as patchCatalogue } from "@/app/api/admin/catalogues/[id]/route";
import {
  PATCH as patchListing,
  DELETE as deleteListing,
} from "@/app/api/admin/catalogues/[id]/listings/[listingId]/route";
import { POST as postEnquiry } from "@/app/api/enquiries/route";
import { getPublishedCatalogue } from "@/lib/catalogue-queries";

function staffSession() {
  return {
    user: {
      id: "staff-1",
      email: "staff@catalogue.test",
      role: "staff",
    },
  };
}

function adminSession() {
  return {
    user: {
      id: "admin-1",
      email: "admin@catalogue.test",
      role: "admin",
    },
  };
}

function catalogueEditBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Catalogue",
    slug: "test-catalogue",
    description: "Test catalogue",
    category: "Office",
    notifyNumber: "919876543210",
    status: "draft",
    validUntil: null,
    banners: [],
    ...overrides,
  };
}

function requestWithJson(url: string, body: unknown) {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Task 3 - API and server-side access control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(null);
    mocks.currentActor.mockResolvedValue(null);
    mocks.findIncompleteProducts.mockResolvedValue([]);

    mocks.getPrisma.mockReturnValue({
      catalogue: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({
          slug: "test-catalogue",
          name: "Test Catalogue",
        }),
        delete: vi.fn().mockResolvedValue({
          slug: "test-catalogue",
          name: "Test Catalogue",
        }),
      },
      catalogueListing: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn(),
      },
      enquiry: {
        create: vi.fn(),
      },
    });
  });

  describe("authentication", () => {
    it("rejects an anonymous request to the admin catalogue API", async () => {
      mocks.auth.mockResolvedValue(null);

      const response = await patchCatalogue(
        requestWithJson(
          `http://localhost:3001/api/admin/catalogues/${IDS.catalogue}`,
          catalogueEditBody(),
        ),
        { params: Promise.resolve({ id: IDS.catalogue }) },
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });

    it("rejects an anonymous request to the catalogue delete server action", async () => {
      mocks.currentActor.mockResolvedValue(null);

      const result = await deleteCatalogue(IDS.catalogue);

      expect(result).toEqual({ error: "You need to sign in again." });
    });
  });

  describe("Staff vs Admin", () => {
    it("blocks staff from publishing through the server action", async () => {
      mocks.currentActor.mockResolvedValue({
        id: "staff-1",
        email: "staff@catalogue.test",
        role: "staff",
      });

      const result = await setCatalogueStatus(IDS.catalogue, "published");

      expect(result).toEqual({
        error: "Only an admin can change what is published.",
      });
    });

    it("allows an admin to publish through the server action", async () => {
      mocks.currentActor.mockResolvedValue({
        id: "admin-1",
        email: "admin@catalogue.test",
        role: "admin",
      });

      const result = await setCatalogueStatus(IDS.catalogue, "published");

      expect(result).toEqual({
        ok: true,
        name: "Test Catalogue",
      });
    });

    it.fails("blocks staff from deleting a catalogue", async () => {
      mocks.currentActor.mockResolvedValue({
        id: "staff-1",
        email: "staff@catalogue.test",
        role: "staff",
      });

      const result = await deleteCatalogue(IDS.catalogue);

      expect(result).toEqual({
        error: "Only an admin can delete a catalogue.",
      });
    });

    it.fails("blocks staff from publishing through the admin catalogue API", async () => {
      mocks.auth.mockResolvedValue(staffSession());
      const prisma = mocks.getPrisma();
      prisma.catalogue.findUnique.mockResolvedValue({
        slug: "test-catalogue",
        status: "draft",
      });

      const response = await patchCatalogue(
        requestWithJson(
          `http://localhost:3001/api/admin/catalogues/${IDS.catalogue}`,
          catalogueEditBody({ status: "published" }),
        ),
        { params: Promise.resolve({ id: IDS.catalogue }) },
      );

      expect(response.status).toBe(403);
      expect(prisma.catalogue.update).not.toHaveBeenCalled();
    });
  });

  describe("server-side payload validation", () => {
    it("rejects a valid catalogue ID with a tampered/invalid payload", async () => {
      mocks.auth.mockResolvedValue(adminSession());

      const response = await patchCatalogue(
        requestWithJson(
          `http://localhost:3001/api/admin/catalogues/${IDS.catalogue}`,
          catalogueEditBody({
            status: "published",
            slug: "NOT A VALID SLUG",
            notifyNumber: "not-a-phone-number",
          }),
        ),
        { params: Promise.resolve({ id: IDS.catalogue }) },
      );

      expect(response.status).toBe(400);
      expect(mocks.getPrisma().catalogue.update).not.toHaveBeenCalled();
    });

    it("rejects a malformed catalogue ID before touching the database", async () => {
      mocks.auth.mockResolvedValue(adminSession());

      const response = await patchCatalogue(
        requestWithJson(
          "http://localhost:3001/api/admin/catalogues/not-a-uuid",
          catalogueEditBody(),
        ),
        { params: Promise.resolve({ id: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expect(mocks.getPrisma().catalogue.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("ID tampering / object ownership", () => {
    it.fails("does not allow a listing from another catalogue to be updated", async () => {
      mocks.auth.mockResolvedValue(adminSession());
      const prisma = mocks.getPrisma();
      prisma.catalogue.findUnique.mockResolvedValue({ slug: "test-catalogue" });
      prisma.catalogueListing.updateMany.mockResolvedValue({ count: 1 });

      const response = await patchListing(
        requestWithJson(
          `http://localhost:3001/api/admin/catalogues/${IDS.catalogue}/listings/${IDS.listing}`,
          { isVisible: false },
        ),
        {
          params: Promise.resolve({
            id: IDS.catalogue,
            listingId: IDS.listing,
          }),
        },
      );

      // Expected secure behavior: updateMany must scope the listing to the
      // catalogue as well as the listing ID. The current implementation only
      // filters by listing ID, so this test exposes the IDOR defect.
      expect(response.status).toBe(404);
      expect(prisma.catalogueListing.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: IDS.listing,
            catalogueId: IDS.catalogue,
          },
        }),
      );
    });

    it.fails("does not allow a listing from another catalogue to be deleted", async () => {
      mocks.auth.mockResolvedValue(adminSession());
      const prisma = mocks.getPrisma();
      prisma.catalogue.findUnique.mockResolvedValue({ slug: "test-catalogue" });
      prisma.catalogueListing.deleteMany.mockResolvedValue({ count: 1 });

      const response = await deleteListing(
        new Request("http://localhost:3001/api/admin/catalogues/x/listings/y", {
          method: "DELETE",
        }),
        {
          params: Promise.resolve({
            id: IDS.catalogue,
            listingId: IDS.listing,
          }),
        },
      );

      expect(response.status).toBe(404);
      expect(prisma.catalogueListing.deleteMany).toHaveBeenCalledWith({
        where: {
          id: IDS.listing,
          catalogueId: IDS.catalogue,
        },
      });
    });
  });

  describe("public catalogue access", () => {
    it("does not expose a draft catalogue through the public catalogue query", async () => {
      const prisma = mocks.getPrisma();
      prisma.catalogue.findUnique.mockResolvedValue({
        id: IDS.catalogue,
        name: "Confidential Draft",
        slug: "festive-overstock-2026",
        status: "draft",
        expiresAt: null,
        listings: [],
      });

      const result = await getPublishedCatalogue("festive-overstock-2026");

      expect(result).toBeNull();
    });

    it("returns an expired result instead of exposing expired catalogue products", async () => {
      const prisma = mocks.getPrisma();
      prisma.catalogue.findUnique.mockResolvedValue({
        id: IDS.catalogue,
        name: "Expired Catalogue",
        slug: "monsoon-clearance-2026",
        status: "published",
        expiresAt: new Date(Date.now() - 60_000),
        notifyNumber: null,
        listings: [
          {
            productId: IDS.product,
            isVisible: true,
            displayOrder: 0,
            product: {
              id: IDS.product,
              sku: "SKU-1",
              name: "Secret product",
              brand: "Brand",
              category: "Other",
              description: "Expired product",
              imageUrls: [],
              mrp: null,
              offerPrice: 100,
              priceOnRequest: false,
              quantity: 10,
              moq: 1,
              attributes: {},
            },
            badges: [],
          },
        ],
      });

      const result = await getPublishedCatalogue("monsoon-clearance-2026");

      expect(result).toEqual({
        expired: true,
        title: "Expired Catalogue",
        whatsappNumber: null,
      });
    });
  });

  describe("enquiry payload tampering", () => {
    it("rejects a valid catalogue ID with a product ID that is not listed in that catalogue", async () => {
      const prisma = mocks.getPrisma();
      prisma.catalogueListing.findMany.mockResolvedValue([]);
      prisma.catalogue.findUnique.mockResolvedValue({ notifyNumber: null });

      const response = await postEnquiry(
        new Request("http://localhost:3001/api/enquiries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            catalogueId: IDS.catalogue,
            name: "Test Buyer",
            phone: "9876543210",
            items: [
              {
                productId: IDS.product,
                quantity: 20,
              },
            ],
          }),
        }),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "One or more products are unavailable.",
      });
      expect(prisma.enquiry.create).not.toHaveBeenCalled();
    });

    it("rejects an enquiry quantity below the product MOQ", async () => {
      const prisma = mocks.getPrisma();
      prisma.catalogueListing.findMany.mockResolvedValue([
        {
          id: IDS.listing,
          productId: IDS.product,
          product: {
            name: "Atlas cabin trolley",
            sku: "ATLAS-1",
            brand: "Atlas",
            offerPrice: 100,
            priceOnRequest: false,
            moq: 20,
            quantity: 100,
          },
        },
      ]);
      prisma.catalogue.findUnique.mockResolvedValue({ notifyNumber: null });

      const response = await postEnquiry(
        new Request("http://localhost:3001/api/enquiries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            catalogueId: IDS.catalogue,
            name: "Test Buyer",
            phone: "9876543210",
            items: [{ productId: IDS.product, quantity: 19 }],
          }),
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "A requested quantity is outside the allowed range.",
      });
      expect(prisma.enquiry.create).not.toHaveBeenCalled();
    });
  });
});
