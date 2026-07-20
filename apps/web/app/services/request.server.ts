import { requireShop } from "../auth.server.js";
import { getWebRuntime } from "./runtime.server.js";
import { WebAppService } from "./web-app.server.js";

export async function requestContext(request: Request) {
  const [auth, runtime] = await Promise.all([requireShop(request), getWebRuntime()]);
  return {
    ...auth,
    runtime,
    service: new WebAppService(runtime.client, runtime.queue, runtime.adapters),
  };
}
