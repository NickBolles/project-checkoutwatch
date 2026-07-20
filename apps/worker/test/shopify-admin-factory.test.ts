import { describe, expect, it } from "vitest";
import { encrypt, generateEncryptionKey } from "@checkoutwatch/core/server";
import { createShopifyAdminFactory } from "../src/shopify-admin-factory.js";

describe("worker ShopifyAdminFactory", () => {
  it("decrypts the offline token and fetches the real main theme per shop", async () => {
    const encryptionKey = generateEncryptionKey();
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = (input, init) => {
      requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requestInit = init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              themes: {
                nodes: [
                  {
                    id: "gid://shopify/Theme/42",
                    name: "Production theme",
                    role: "MAIN",
                    updatedAt: "2026-07-20T12:00:00Z",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };
    const factory = createShopifyAdminFactory(
      {
        shopifyAuth: "real",
        encryptionKey,
        fixtureStorefrontUrl: "http://localhost:4600",
      },
      fetchImpl,
    );

    const theme = await factory
      .forShop({
        shopDomain: "merchant.myshopify.com",
        accessToken: encrypt("offline-token", encryptionKey),
      })
      .getMainTheme("merchant.myshopify.com");

    expect(theme).toEqual({
      id: "gid://shopify/Theme/42",
      name: "Production theme",
      updatedAt: "2026-07-20T12:00:00Z",
    });
    expect(requestUrl).toBe("https://merchant.myshopify.com/admin/api/2026-07/graphql.json");
    expect(new Headers(requestInit?.headers).get("x-shopify-access-token")).toBe("offline-token");
    expect(requestInit?.body).toEqual(expect.any(String));
    expect(requestInit?.body as string).toContain("CheckoutWatchThemes");
  });

  it("fails closed when a real shop has no stored offline token", () => {
    const factory = createShopifyAdminFactory({
      shopifyAuth: "real",
      encryptionKey: generateEncryptionKey(),
      fixtureStorefrontUrl: "http://localhost:4600",
    });

    expect(() =>
      factory.forShop({ shopDomain: "merchant.myshopify.com", accessToken: null }),
    ).toThrow(/offline access token/);
  });
});
