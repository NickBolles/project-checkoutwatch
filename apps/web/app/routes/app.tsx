import { Frame, Navigation } from "@shopify/polaris";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { Outlet, useLoaderData, useLocation, useNavigate, useRouteError } from "react-router";
import { getConfig } from "@checkoutwatch/core/server";
import { getShopifyApp } from "../shopify.server.js";

export async function loader({ request }: { request: Request }) {
  const config = getConfig();
  if (config.shopifyAuth === "real") {
    await getShopifyApp().authenticate.admin(request);
  }
  return {
    apiKey: config.shopifyApiKey ?? "",
    authMode: config.shopifyAuth,
  };
}

export default function AppLayout() {
  const data = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const content = (
    <Frame
      navigation={
        <Navigation location={location.pathname}>
          <Navigation.Section
            items={[
              {
                label: "Status page",
                selected: location.pathname.startsWith("/settings/status-page"),
                onClick: () => void navigate("/settings/status-page"),
              },
              {
                label: "Dashboard",
                selected: location.pathname === "/",
                onClick: () => void navigate("/"),
              },
              {
                label: "Alert settings",
                selected: location.pathname.startsWith("/settings/alerts"),
                onClick: () => void navigate("/settings/alerts"),
              },
              {
                label: "Billing",
                selected: location.pathname === "/billing",
                onClick: () => void navigate("/billing"),
              },
              {
                label: "Settings",
                selected: location.pathname === "/settings",
                onClick: () => void navigate("/settings"),
              },
            ]}
          />
        </Navigation>
      }
    >
      <Outlet />
    </Frame>
  );

  if (data.authMode !== "real") return content;
  return <ShopifyAppProvider embedded apiKey={data.apiKey}>{content}</ShopifyAppProvider>;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
