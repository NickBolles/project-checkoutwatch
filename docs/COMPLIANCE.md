# Synthetic storefront traffic and merchant consent

CheckoutWatch runs only for a merchant who installed the app, only against that shop's configured storefront URL, and stops all monitoring immediately when the app is uninstalled. This is merchant-authorized synthetic monitoring, not crawling. The runner fetches and logs `robots.txt`, but Shopify storefronts commonly disallow checkout there; merchant consent is the authorization basis for the checkout assertion.

Every request uses `CheckoutWatchBot/1.0 (+https://checkoutwatch.app/bot)` and fixed English language headers. Plan entitlements enforce frequency floors. Merchants should allowlist the published CheckoutWatch user agent and production egress IPs in bot-management tools. A CAPTCHA or challenge is classified as `BOT_CHALLENGE`, surfaced as a setup issue, never bypassed, and never retried aggressively.

The runner stops as soon as the payment step is visibly present. It never enters an email, address, card number, or any other checkout data and never submits the checkout form. Therefore it cannot create a contactable abandoned checkout or trigger recovery email. Synthetic add-to-cart traffic can still affect analytics; merchants should exclude the identified user agent and published egress IPs from GA and storefront analytics where supported.

Shopify automated-traffic policy and the production egress/allowlisting instructions must be reverified against current live documentation before launch.
