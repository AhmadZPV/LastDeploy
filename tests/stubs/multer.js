/**
 * Minimal multer stub for the offline test run.
 *
 * routes/crud.js builds an upload middleware at import time. The tests never
 * post a real multipart body, so each middleware just forwards the request.
 */
const passthrough = (req, _res, next) => {
  if (!req.files) req.files = [];
  if (typeof next === 'function') next();
};

function multer(_options = {}) {
  return {
    any: () => passthrough,
    none: () => passthrough,
    single: () => passthrough,
    array: () => passthrough,
    fields: () => passthrough,
  };
}

multer.memoryStorage = () => ({});
multer.diskStorage = () => ({});

export default multer;
