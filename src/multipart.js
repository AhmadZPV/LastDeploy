import Busboy from 'busboy';

export function multipartParser(options = {}) {
  const limits = {
    files: options.files ?? 20,
    fileSize: options.fileSize ?? 30 * 1024 * 1024,
    fields: options.fields ?? 500,
    parts: options.parts ?? 520,
  };
  return function parseMultipart(req, res, next) {
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) return next();
    let busboy;
    try { busboy = Busboy({ headers: req.headers, limits }); }
    catch (error) { return res.status(400).send(error.message); }

    const files = [];
    const pending = [];
    req.body = req.body || {};
    busboy.on('field', (name, value) => {
      if (Object.prototype.hasOwnProperty.call(req.body, name)) {
        req.body[name] = Array.isArray(req.body[name]) ? [...req.body[name], value] : [req.body[name], value];
      } else req.body[name] = value;
    });
    busboy.on('file', (fieldname, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('limit', () => { truncated = true; });
      const done = new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          files.push({ fieldname, originalname: info.filename, encoding: info.encoding, mimetype: info.mimeType, size: buffer.length, buffer, truncated });
          resolve();
        });
      });
      pending.push(done);
    });
    busboy.on('filesLimit', () => { req.multipartLimitError = 'Zu viele Dateien'; });
    busboy.on('fieldsLimit', () => { req.multipartLimitError = 'Zu viele Formularfelder'; });
    busboy.on('partsLimit', () => { req.multipartLimitError = 'Zu viele Formulardaten'; });
    busboy.on('error', next);
    busboy.on('finish', async () => {
      try {
        await Promise.all(pending);
        if (req.multipartLimitError || files.some((file) => file.truncated)) {
          return res.status(413).send(req.multipartLimitError || 'Datei ist zu groß');
        }
        req.files = files;
        next();
      } catch (error) { next(error); }
    });
    req.pipe(busboy);
  };
}

export default multipartParser;
