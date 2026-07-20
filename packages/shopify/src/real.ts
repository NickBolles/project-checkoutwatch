import type {
  AdminGraphqlClient,
  MainTheme,
  ShopifyAdmin,
  ShopifyProduct,
  ShopifyShop,
} from "./types.js";

export class GraphqlShopifyAdmin implements ShopifyAdmin {
  constructor(private readonly client: AdminGraphqlClient) {}

  async listProducts(_shopDomain: string): Promise<ShopifyProduct[]> {
    const result = await this.client.graphql<ProductsResponse>(PRODUCTS_QUERY);
    return result.products.nodes.map((product) => ({
      id: product.id,
      handle: product.handle,
      title: product.title,
      variants: product.variants.nodes.map((variant) => ({
        id: variant.id,
        title: variant.title,
        available: variant.availableForSale,
      })),
    }));
  }

  async getShop(_shopDomain: string): Promise<ShopifyShop> {
    const result = await this.client.graphql<{ shop: { myshopifyDomain: string; name: string } }>(
      SHOP_QUERY,
    );
    return { domain: result.shop.myshopifyDomain, name: result.shop.name };
  }

  async getMainTheme(_shopDomain: string): Promise<MainTheme> {
    const result = await this.client.graphql<ThemesResponse>(THEMES_QUERY);
    const theme = result.themes.nodes.find((candidate) => candidate.role === "MAIN");
    if (!theme) throw new Error("Shop has no main theme");
    return { id: theme.id, name: theme.name, updatedAt: theme.updatedAt };
  }
}

export const PRODUCTS_QUERY = `#graphql
  query CheckoutWatchProducts {
    products(first: 50, sortKey: UPDATED_AT, reverse: true) {
      nodes { id handle title variants(first: 50) { nodes { id title availableForSale } } }
    }
  }
`;

export const SHOP_QUERY = `#graphql
  query CheckoutWatchShop { shop { myshopifyDomain name } }
`;

export const THEMES_QUERY = `#graphql
  query CheckoutWatchThemes { themes(first: 20) { nodes { id name role updatedAt } } }
`;

interface ProductsResponse {
  products: {
    nodes: Array<{
      id: string;
      handle: string;
      title: string;
      variants: { nodes: Array<{ id: string; title: string; availableForSale: boolean }> };
    }>;
  };
}

interface ThemesResponse {
  themes: { nodes: Array<{ id: string; name: string; role: string; updatedAt: string }> };
}
