# CheckoutWatch compliance and traffic policy

## Merchant authorization and automated traffic

CheckoutWatch performs synthetic checkout checks only for a merchant who installed the app and only against that shop's configured storefront URL. Installation and explicit monitor enablement are the authorization basis. This is not general-purpose crawling. `app/uninstalled` immediately disables every monitor, clears run locks, removes the stored token, and cancels queued work for that shop.

The runner fetches and records `robots.txt`, but Shopify storefronts commonly disallow checkout paths. We do not claim that merchant consent overrides Shopify's platform terms. Before public launch, the operator must re-check the current Shopify Partner, storefront automated-traffic, and acceptable-use terms and obtain written clarification if necessary. If consented synthetic checkout traffic is prohibited, deployment must stop or pivot to a Shopify-approved allowlist/theme-token mechanism. The app never bypasses a CAPTCHA, bot challenge, rate limit, or access control. `BOT_CHALLENGE` is an engine-error/setup result and is not retried aggressively or presented as an outage.

Every request identifies itself as `CheckoutWatchBot/1.0 (+https://checkoutwatch.app/bot)`. Plan entitlements impose frequency floors. Production deployments must publish stable egress IPs and allowlisting instructions. Merchants should exclude the user agent and egress IPs from analytics where supported; synthetic visits and add-to-cart actions can affect conversion analytics.

## No payment or customer data

The runner stops after verifying that the payment step is visible. It never enters or submits an email address, shipping address, phone number, card data, payment token, or other checkout form value. It never clicks a pay/complete-order control. Tests enforce that no request reaches the fixture's completion endpoint and no checkout form data is submitted. This prevents real purchases and contactable abandoned checkouts, though analytics pollution remains possible as described above.

CheckoutWatch stores merchant configuration, synthetic run metadata, failure artifacts, incident history, and alert destinations. It does not intentionally collect Shopify customer personal data. Screenshots and console/network artifacts may nevertheless contain storefront information; they are private, access-controlled, excluded from public status pages, and deleted by plan-based retention unless linked to an incident.

## Mandatory Shopify privacy webhooks

Production app configuration must register and HMAC-verify these topics using the raw request body:

- `customers/data_request`: returns the categories of customer data held. CheckoutWatch reports none.
- `customers/redact`: acknowledges deletion; no customer record is stored.
- `shop/redact`: deletes the shop and all associated monitors, runs, incidents, status configuration, delivery logs, sessions, and credentials after Shopify's required delay.
- `app/uninstalled`: revokes consent immediately and stops synthetic traffic.

Webhook handlers must reject an unexpected topic or invalid signature. Resend webhook signatures include a five-minute replay window. Twilio callbacks use Twilio's URL-plus-sorted-parameters HMAC construction. Logs redact tokens, authorization/cookie headers, passwords, API keys, and secrets.

## Data lifecycle and incident taxonomy

Routine check runs are retained for 7 days on Free, 30 days on Growth, and 90 days on Pro. Runs that opened or resolved an incident are retained with the incident. The daily retention job removes expired unlinked runs and orphan artifact directories. An uninstall stops traffic immediately; a Shopify `shop/redact` request performs the final shop purge.

Availability counts only `passed` and merchant-impacting `failed` runs. Browser crashes, worker/network control failures, bot challenges, watchdog timeouts, and other `error` runs are no-signal: they do not open or resolve merchant incidents, do not trigger merchant alerts, and are excluded from public and private uptime. A merchant storefront that is unreachable while the independent control probe succeeds is `STORE_UNREACHABLE`, a real failure that is debounced and alerted.

This document is operational guidance, not legal advice. Record the date and outcome of the live Shopify policy review before launch.
