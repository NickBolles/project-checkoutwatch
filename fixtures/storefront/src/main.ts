import { startStorefrontFixture } from "./server.js";

const fixture = await startStorefrontFixture({ storefrontPort: Number(process.env.FIXTURE_PORT ?? 4600), paymentPort: Number(process.env.FIXTURE_PAYMENT_PORT ?? 4601), controlPort: Number(process.env.FIXTURE_CONTROL_PORT ?? 4602) });
console.log(`Storefront fixture: ${fixture.storefrontUrl}`);
console.log(`Payment fixture: ${fixture.paymentOrigin}`);
console.log(`Control probe: ${fixture.controlUrl}`);
