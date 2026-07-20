import { startStorefrontFixture, type StorefrontMode } from "@checkoutwatch/storefront-fixture";
import { CheckoutRunner, LocalArtifactStore } from "./index.js";

const modeArgument = process.argv.findIndex((value) => value === "--mode");
const mode = (modeArgument >= 0 ? process.argv[modeArgument + 1] : "ok") as StorefrontMode;
const fixture = await startStorefrontFixture();
try {
  fixture.setMode(mode);
  const result = await new CheckoutRunner({
    artifactStore: new LocalArtifactStore("var/artifacts"), controlProbeUrl: fixture.controlUrl,
    knownPaymentOrigins: [fixture.paymentOrigin],
  }).run({ storeUrl: fixture.storefrontUrl, productHandle: "test-product", variantId: "1001", timeoutMs: 1000 });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await fixture.close();
}
