/**
 * Minimal express-session stub for the offline test run.
 *
 * server.js only needs `session(options)` to return a middleware. The tests
 * never exercise a real session store; they hand routers a reqStub() that
 * already carries a `session` object.
 */
function session(options = {}) {
  return function sessionMiddleware(req, _res, next) {
    if (!req.session) req.session = {};
    if (typeof next === 'function') next();
  };
}

session.Store = class Store {};
session.MemoryStore = class MemoryStore {};

export default session;
export { session };
