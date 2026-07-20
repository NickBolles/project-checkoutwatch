import type { ShopifyAdminFactory, ShopifyAdminShop } from "../shopify-admin-factory.js";

export interface StoreChangePollRepository {
  shopsForPolling(): Promise<Array<{ id: string } & ShopifyAdminShop>>;
  recordThemeObservation(
    shopId: string,
    theme: { id: string; name: string; updatedAt: string },
    detectedAt?: Date,
  ): Promise<boolean>;
}

export function createPollStoreChangesHandler(
  repository: StoreChangePollRepository,
  shopify: ShopifyAdminFactory,
  now: () => Date = () => new Date(),
) {
  return async (): Promise<number> => {
    const shops = await repository.shopsForPolling();
    let emitted = 0;
    for (const shop of shops) {
      const theme = await shopify.forShop(shop).getMainTheme(shop.shopDomain);
      if (await repository.recordThemeObservation(shop.id, theme, now())) emitted += 1;
    }
    return emitted;
  };
}
