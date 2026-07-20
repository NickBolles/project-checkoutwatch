import type { ShopifyAdmin } from "@checkoutwatch/shopify";

export interface StoreChangePollRepository {
  shopsForPolling(): Promise<Array<{ id: string; shopDomain: string }>>;
  recordThemeObservation(
    shopId: string,
    theme: { id: string; name: string; updatedAt: string },
    detectedAt?: Date,
  ): Promise<boolean>;
}

export function createPollStoreChangesHandler(
  repository: StoreChangePollRepository,
  shopify: Pick<ShopifyAdmin, "getMainTheme">,
  now: () => Date = () => new Date(),
) {
  return async (): Promise<number> => {
    const shops = await repository.shopsForPolling();
    let emitted = 0;
    for (const shop of shops) {
      const theme = await shopify.getMainTheme(shop.shopDomain);
      if (await repository.recordThemeObservation(shop.id, theme, now())) emitted += 1;
    }
    return emitted;
  };
}
