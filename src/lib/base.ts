/**
 * Prefixes a site-relative path with the configured `base` (`/prd` on GitHub Pages).
 *
 *   withBase('/sample/')    → '/prd/sample/'
 *   withBase('/')           → '/prd/'
 *   withBase('/favicon.svg') → '/prd/favicon.svg'
 *
 * Trailing slashes on the base are stripped before joining, so a `base` of `'/'`
 * (custom domain) yields the path unchanged. Pass internal page hrefs with their
 * trailing slash so GitHub Pages serves them without a redirect.
 */
export function withBase(path: string, base: string = import.meta.env.BASE_URL): string {
  const prefix = base.replace(/\/+$/, '');
  return prefix + (path.startsWith('/') ? path : `/${path}`);
}
