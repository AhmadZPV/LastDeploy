/**
 * Local test stub for express.
 *
 * Only what our routers touch: express(), express.Router(), and the
 * static/json/urlencoded middleware factories. Routers record their handlers
 * so tests can invoke a route directly with fake req/res objects instead of
 * opening a socket.
 */
function makeRouter() {
  const layers = [];
  const router = {
    layers,
    get(pathSpec, ...handlers) { layers.push({ method: 'get', path: pathSpec, handlers }); return router; },
    post(pathSpec, ...handlers) { layers.push({ method: 'post', path: pathSpec, handlers }); return router; },
    put(pathSpec, ...handlers) { layers.push({ method: 'put', path: pathSpec, handlers }); return router; },
    delete(pathSpec, ...handlers) { layers.push({ method: 'delete', path: pathSpec, handlers }); return router; },
    patch(pathSpec, ...handlers) { layers.push({ method: 'patch', path: pathSpec, handlers }); return router; },
    // express `all` registers one handler for every verb
    all(pathSpec, ...handlers) {
      for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
        layers.push({ method, path: pathSpec, handlers });
      }
      layers.push({ method: 'all', path: pathSpec, handlers });
      return router;
    },
    use(...args) { layers.push({ method: 'use', args }); return router; },
    /** test helper: find a registered handler */
    find(method, pathSpec) {
      const hit = layers.find((l) => l.method === method && l.path === pathSpec);
      return hit ? hit.handlers[hit.handlers.length - 1] : null;
    },
  };
  return router;
}

function express() {
  const app = makeRouter();
  app.set = () => app;
  app.listen = () => ({ close() {} });
  app.engine = () => app;
  return app;
}

express.Router = makeRouter;
express.static = () => (req, res, next) => next && next();
express.json = () => (req, res, next) => next && next();
express.urlencoded = () => (req, res, next) => next && next();

const Router = makeRouter;

export default express;
export { makeRouter, Router };
