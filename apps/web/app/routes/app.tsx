import { Frame, Navigation } from "@shopify/polaris";
import { Outlet, useLocation, useNavigate } from "react-router";

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <Frame
      navigation={
        <Navigation location={location.pathname}>
          <Navigation.Section
            items={[
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
}
