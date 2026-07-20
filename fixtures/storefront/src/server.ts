import express from "express";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";

const productTemplate = readFileSync(new URL("../views/product.html", import.meta.url), "utf8");
const checkoutTemplate = readFileSync(new URL("../views/checkout.html", import.meta.url), "utf8");
const challengeTemplate = readFileSync(new URL("../views/challenge.html", import.meta.url), "utf8");

export type StorefrontMode =
  | "ok"
  | "add_to_cart_broken"
  | "checkout_500"
  | "payment_iframe_missing"
  | "slow_checkout"
  | "sold_out"
  | "bot_challenge"
  | "console_error"
  | "third_party_script_added";

const modes = new Set<StorefrontMode>([
  "ok",
  "add_to_cart_broken",
  "checkout_500",
  "payment_iframe_missing",
  "slow_checkout",
  "sold_out",
  "bot_challenge",
  "console_error",
  "third_party_script_added",
]);

export interface StorefrontFixture {
  storefrontUrl: string;
  paymentOrigin: string;
  controlUrl: string;
  setMode(mode: StorefrontMode): void;
  signals: { checkoutCompleteRequests: number; checkoutFieldPosts: number };
  stopStorefront(): Promise<void>;
  stopControl(): Promise<void>;
  close(): Promise<void>;
}

export async function startStorefrontFixture(
  options: {
    storefrontPort?: number;
    paymentPort?: number;
    controlPort?: number;
    host?: string;
    publicHost?: string;
  } = {},
): Promise<StorefrontFixture> {
  let mode: StorefrontMode = "ok";
  const signals = { checkoutCompleteRequests: 0, checkoutFieldPosts: 0 };
  const paymentApp = express();
  paymentApp.get("/card-fields", (_request, response) =>
    response.type("html").send("<!doctype html><title>Secure card fields</title>"),
  );
  paymentApp.get("/theme.js", (_request, response) =>
    response.type("js").send("window.fixtureThemeLoaded = true;"),
  );
  paymentApp.get("/new-app.js", (_request, response) =>
    response.type("js").send("window.newAppLoaded = true;"),
  );
  const paymentServer = await listen(paymentApp, options.paymentPort ?? 0, options.host);
  const paymentOrigin = origin(paymentServer, options.publicHost);

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use((request, _response, next) => {
    const candidate = request.query.__mode;
    if (typeof candidate === "string" && modes.has(candidate as StorefrontMode))
      mode = candidate as StorefrontMode;
    next();
  });
  app.get("/robots.txt", (_request, response) =>
    response.type("text").send("User-agent: *\nDisallow: /checkout\n"),
  );
  app.post("/__mode", (request, response) => {
    const body: unknown = request.body;
    const candidate =
      typeof body === "object" && body !== null && "mode" in body ? body.mode : undefined;
    if (typeof candidate !== "string" || !modes.has(candidate as StorefrontMode))
      return response.status(400).json({ error: "invalid mode" });
    mode = candidate as StorefrontMode;
    return response.json({ mode });
  });
  app.get("/__signals", (_request, response) => response.json(signals));
  app.get("/products/:handle.js", (request, response) => {
    if (request.params.handle === "missing")
      return response.status(404).json({ error: "not found" });
    return response.json({
      id: 1,
      handle: request.params.handle,
      variants: [{ id: 1001, available: mode !== "sold_out" }],
    });
  });
  app.get("/products/:handle", (request, response) => {
    if (request.params.handle === "missing") return response.status(404).send("Not found");
    if (mode === "bot_challenge") return response.status(403).type("html").send(challengePage());
    const consoleScript =
      mode === "console_error" ? "<script>console.error('fixture observation error')</script>" : "";
    const brokenScript =
      mode === "add_to_cart_broken"
        ? "<script>console.error('add to cart control missing')</script>"
        : "";
    const form =
      mode === "add_to_cart_broken"
        ? ""
        : '<form method="post" action="/cart/add"><input type="hidden" name="id" value="1001"><button name="add" type="submit">Add to cart</button></form>';
    return response.type("html").send(
      productTemplate
        .replace(
          "{{scripts}}",
          `<script src="${paymentOrigin}/theme.js"></script>${mode === "third_party_script_added" ? `<script src="${paymentOrigin}/new-app.js"></script>` : ""}`,
        )
        .replace("{{form}}", form)
        .replace("{{observations}}", `${consoleScript}${brokenScript}`),
    );
  });
  app.post(["/cart/add", "/cart/add.js"], (request, response) => {
    if (mode === "sold_out") return response.status(422).json({ description: "sold out" });
    response.cookie("fixture_cart", "1", { sameSite: "lax" });
    if (request.path.endsWith(".js")) return response.json({ id: 1001, quantity: 1 });
    return response.redirect(303, "/cart");
  });
  app.get("/cart", (_request, response) =>
    response.type("html").send("<!doctype html><h1>Cart</h1>"),
  );
  app.get("/cart.js", (request, response) =>
    response.json({ item_count: request.headers.cookie?.includes("fixture_cart=1") ? 1 : 0 }),
  );
  app.get("/checkout", async (_request, response) => {
    if (mode === "checkout_500")
      return response
        .status(500)
        .type("html")
        .send("<script>console.error('checkout 500')</script>Checkout unavailable");
    if (mode === "slow_checkout") await new Promise((resolve) => setTimeout(resolve, 1500));
    if (mode === "bot_challenge") return response.status(403).type("html").send(challengePage());
    const paymentMissing = mode === "payment_iframe_missing";
    const payment = paymentMissing
      ? "<script>console.error('payment iframe missing')</script>"
      : `<section aria-label="Payment" data-testid="payment-section"><iframe title="Secure payment" src="${paymentOrigin}/card-fields"></iframe></section>`;
    return response
      .type("html")
      .send(
        checkoutTemplate
          .replace("{{payment}}", payment)
          .replace("{{submit}}", paymentMissing ? "" : '<button type="submit">Pay now</button>'),
      );
  });
  app.post("/checkout/complete", (request, response) => {
    signals.checkoutCompleteRequests += 1;
    if (Object.keys(request.body as object).length > 0) signals.checkoutFieldPosts += 1;
    response.status(204).end();
  });
  const storefrontServer = await listen(app, options.storefrontPort ?? 0, options.host);

  const controlApp = express();
  controlApp.get("/health", (_request, response) => response.json({ ok: true }));
  const controlServer = await listen(controlApp, options.controlPort ?? 0, options.host);
  let storefrontClosed = false;
  let controlClosed = false;
  return {
    storefrontUrl: origin(storefrontServer, options.publicHost),
    paymentOrigin,
    controlUrl: `${origin(controlServer, options.publicHost)}/health`,
    signals,
    setMode(next) {
      mode = next;
    },
    async stopStorefront() {
      if (!storefrontClosed) {
        storefrontClosed = true;
        await close(storefrontServer);
      }
    },
    async stopControl() {
      if (!controlClosed) {
        controlClosed = true;
        await close(controlServer);
      }
    },
    async close() {
      await Promise.all([
        storefrontClosed ? Promise.resolve() : close(storefrontServer),
        controlClosed ? Promise.resolve() : close(controlServer),
        close(paymentServer),
      ]);
      storefrontClosed = true;
      controlClosed = true;
    },
  };
}

function challengePage(): string {
  return challengeTemplate;
}

function listen(
  app: ReturnType<typeof express>,
  port: number,
  host = "127.0.0.1",
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once("error", reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function origin(server: Server, publicHost?: string): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  return `http://${publicHost ?? address.address}:${address.port}`;
}
