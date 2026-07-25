import { describe, expect, it, vi } from "vitest";

const authenticateAdmin = vi.fn();

vi.mock("../app/shopify.server.js", () => ({
  getShopifyApp: () => ({
    authenticate: { admin: authenticateAdmin },
  }),
}));

describe("Shopify OAuth callback route", () => {
  it("registers /auth/* so Shopify's /auth/callback return is handled", async () => {
    const { default: routes } = await import("../app/routes.js");
    expect(routes).toContainEqual(expect.objectContaining({ path: "auth/*" }));
  });

  it("delegates callback requests to Shopify admin authentication", async () => {
    authenticateAdmin.mockResolvedValueOnce({});
    const { loader } = await import("../app/routes/auth.$.js");
    const request = new Request("https://checkoutwatch.example/auth/callback?shop=test.myshopify.com");

    await expect(loader({ request })).resolves.toBeNull();
    expect(authenticateAdmin).toHaveBeenCalledWith(request);
  });
});
