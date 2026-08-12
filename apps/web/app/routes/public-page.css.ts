/**
 * Shared styling for the unauthenticated pages (/bot, /legal/privacy). These are
 * served outside the Shopify admin iframe, so they carry no Polaris and no App
 * Bridge -- self-contained CSS only, same approach as the public status page.
 */
export const publicPageStyles = `
.cw-public { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1c1d; line-height: 1.6; }
.cw-public .brand { font-size: 0.75rem; letter-spacing: 0.14em; color: #5c5f62; margin: 0 0 0.5rem; }
.cw-public h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 0.5rem; }
.cw-public h2 { font-size: 1.15rem; margin: 2.25rem 0 0.5rem; }
.cw-public h3 { font-size: 1rem; margin: 1.5rem 0 0.35rem; }
.cw-public p, .cw-public li { font-size: 0.95rem; }
.cw-public ul { padding-left: 1.15rem; }
.cw-public li { margin-bottom: 0.35rem; }
.cw-public code { background: #f1f2f3; border-radius: 3px; padding: 0.1rem 0.35rem; font-size: 0.85rem; }
.cw-public pre { background: #f1f2f3; border-radius: 6px; padding: 0.85rem 1rem; overflow-x: auto; font-size: 0.85rem; }
.cw-public .lede { font-size: 1.05rem; color: #42474b; }
.cw-public .meta { font-size: 0.8rem; color: #5c5f62; }
.cw-public .callout { border-left: 3px solid #007f5f; background: #f0f8f5; padding: 0.85rem 1rem; border-radius: 0 6px 6px 0; margin: 1.25rem 0; }
.cw-public .callout.warn { border-left-color: #b98900; background: #fdf7e8; }
.cw-public table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.9rem; }
.cw-public th, .cw-public td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #e3e5e7; vertical-align: top; }
.cw-public th { color: #5c5f62; font-weight: 600; }
.cw-public footer { margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid #e3e5e7; }
.cw-public a { color: #005bd3; }
@media (prefers-color-scheme: dark) {
  .cw-public { color: #e3e5e7; }
  .cw-public .lede { color: #b5b8bb; }
  .cw-public code, .cw-public pre { background: #2a2d2f; }
  .cw-public th, .cw-public td, .cw-public footer { border-color: #3a3d40; }
  .cw-public .callout { background: #16241f; }
  .cw-public .callout.warn { background: #2a2416; }
  .cw-public a { color: #8ab4f8; }
}
`;
