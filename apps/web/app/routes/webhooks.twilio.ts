import { providerWebhook } from "../services/provider-webhook.server.js";
export function action({ request }: { request: Request }) {
  return providerWebhook(request, "sms");
}
