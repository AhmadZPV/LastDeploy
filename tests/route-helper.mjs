/** Resolve a route handler from either the project stub or Express Router. */
export function routeHandler(router, method, routePath) {
  if (typeof router.find === 'function') return router.find(method, routePath);
  const layer = router.stack?.find((entry) =>
    entry.route?.path === routePath && entry.route?.methods?.[method]);
  return layer?.route?.stack?.at(-1)?.handle || null;
}
