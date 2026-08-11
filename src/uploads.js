/**
 * File download / upload policy (port of getfile.php, getpdf.php and
 * mfhandler.php + getOptionsForMultiUpload()).
 *
 * Kept in src/ (not routes/) so it can be imported and tested without pulling
 * in server.js, which imports the file router right back.
 *
 * What the original did, and what we keep:
 *  - getfile.php picks the content type from the *filename extension*, not from
 *    the bytes, and always answers with `Content-Disposition: attachment` plus
 *    `Cache-Control: private`.
 *  - PHPRunner stored an uploaded file either as raw bytes in a BLOB column or
 *    as a JSON envelope describing files on disk. Both shapes have to round
 *    trip.
 *  - getOptionsForMultiUpload() derived the limits per field from the project
 *    settings: acceptFileTypes, maxNumberOfFiles, thumbnail size. The extracted
 *    metadata carries acceptFileTypes / maxNumberOfFiles / ShowThumbnail, but
 *    no size cap at all, so we apply a documented default instead of pretending
 *    the source had one.
 */

// getContentTypeByExtension() in include/commonfunctions.php, trimmed to the
// extensions this project actually stores.
const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.xml': 'text/xml',
  '.json': 'application/json',
  '.rtf': 'application/rtf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
  '.ics': 'text/calendar',
  '.vcf': 'text/x-vcard',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/x-wav',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.asf': 'video/x-ms-asf',
};

export const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_SIZE = 50 * 1024 * 1024;

/** getContentTypeByExtension(): extension in, mime out, octet-stream default. */
export function contentTypeByExtension(nameOrExt) {
  if (!nameOrExt) return 'application/octet-stream';
  const s = String(nameOrExt);
  const dot = s.lastIndexOf('.');
  const ext = (dot === -1 ? '.' + s : s.slice(dot)).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

/** SupposeImageType(): magic bytes for the formats the source recognised. */
export function supposeImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (buf.slice(0, 4).toString('hex') === '52494646'
      && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Choose the mime the way getfile.php did: extension first (that is what the
 * user asked for), magic bytes only as a fallback so a wrongly named BLOB is
 * still served as something a browser can open.
 */
export function resolveMime(fileName, buf) {
  const byExt = contentTypeByExtension(fileName);
  if (byExt !== 'application/octet-stream') return byExt;
  return supposeImageType(buf) || 'application/octet-stream';
}

/**
 * Content-Disposition. Non-ASCII names get the RFC 5987 form as well, because
 * every German file name here (Anhang Gebaeude.pdf with an umlaut) breaks the
 * plain header.
 */
export function contentDisposition(fileName, { inline = false } = {}) {
  const kind = inline ? 'inline' : 'attachment';
  const safe = sanitizeFileName(fileName) || 'download';
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  let header = kind + '; filename="' + ascii + '"';
  if (ascii !== safe) header += "; filename*=UTF-8''" + encodeURIComponent(safe);
  return header;
}

/** Strip directory traversal; the original trusted the client, we do not. */
export function sanitizeFileName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/^\.+/, '')
    .replace(/[\x00-\x1f]/g, '')
    .trim();
}

/** Find a field descriptor in an extracted entity metadata document. */
export function findField(meta, fieldName) {
  const fields = Array.isArray(meta?.fields) ? meta.fields : [];
  return fields.find((f) => f?.name === fieldName) || null;
}

/**
 * getOptionsForMultiUpload(). acceptFileTypes is a PHP regex tested against the
 * file name; the extraction shows every field carrying the permissive `.+$`,
 * so a stricter value only ever appears where the original really set one.
 */
export function uploadPolicy(meta, fieldName) {
  const field = findField(meta, fieldName);
  const edit = field?.edit || {};
  const view = field?.view || {};
  const maxFiles = Number(edit.maxNumberOfFiles);
  return {
    field: fieldName,
    exists: Boolean(field),
    acceptFileTypes: edit.acceptFileTypes || '.+$',
    maxNumberOfFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : 1,
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    maxTotalFileSize: DEFAULT_MAX_TOTAL_SIZE,
    createThumbnail: view.ShowThumbnail != null,
    thumbnailSize: Number(view.ShowThumbnail) > 0 ? Number(view.ShowThumbnail) : 150,
  };
}

/** Does the name pass acceptFileTypes? Invalid patterns must not lock uploads out. */
export function acceptsFileName(policy, fileName) {
  const pattern = policy?.acceptFileTypes;
  if (!pattern || pattern === '.+$') return true;
  try {
    return new RegExp(pattern, 'i').test(String(fileName || ''));
  } catch {
    return true;
  }
}

/**
 * Validate a batch before anything is written. Returns
 * { ok, accepted, rejected: [{ name, error }] } using the blueimp error codes
 * the original front-end already knew how to display.
 */
export function validateUpload(files, policy) {
  const list = Array.isArray(files) ? files : (files ? [files] : []);
  const accepted = [];
  const rejected = [];
  let total = 0;

  for (const f of list) {
    const name = sanitizeFileName(f?.originalname || f?.name);
    const size = Number(f?.size ?? f?.buffer?.length ?? 0);
    if (!name) {
      rejected.push({ name: '', error: 'emptyName' });
      continue;
    }
    if (!acceptsFileName(policy, name)) {
      rejected.push({ name, error: 'acceptFileTypes' });
      continue;
    }
    if (size > policy.maxFileSize) {
      rejected.push({ name, error: 'maxFileSize' });
      continue;
    }
    if (accepted.length >= policy.maxNumberOfFiles) {
      rejected.push({ name, error: 'maxNumberOfFiles' });
      continue;
    }
    if (total + size > policy.maxTotalFileSize) {
      rejected.push({ name, error: 'maxTotalFileSize' });
      continue;
    }
    total += size;
    accepted.push({ ...f, name, size });
  }

  return { ok: rejected.length === 0, accepted, rejected, totalSize: total };
}

/** The JSON envelope PHPRunner wrote into a text column. */
export function fileObject(file) {
  const name = sanitizeFileName(file?.originalname || file?.name);
  const size = Number(file?.size ?? file?.buffer?.length ?? 0);
  return {
    name,
    usrName: name,
    size,
    type: file?.mimetype || resolveMime(name, file?.buffer),
  };
}

/** Read a stored value back into a list of file objects. */
export function parseStoredFiles(value) {
  if (value == null || value === '') return [];
  let text = null;
  if (Buffer.isBuffer(value)) {
    const head = value.slice(0, 1).toString('ascii');
    if (head !== '[' && head !== '{') return [];
    text = value.toString('utf8');
  } else if (typeof value === 'string') {
    const t = value.trim();
    if (!t.startsWith('[') && !t.startsWith('{')) return [];
    text = t;
  } else if (typeof value === 'object') {
    const arr = Array.isArray(value) ? value : [value];
    return arr.filter((f) => f && f.name);
  } else {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.filter((f) => f && f.name);
  } catch {
    return [];
  }
}

export function serializeStoredFiles(list) {
  const arr = (list || []).filter(Boolean);
  return arr.length ? JSON.stringify(arr) : '';
}

/** Remove one file by its user-visible name; used by the DELETE branch. */
export function removeStoredFile(value, fileName) {
  const wanted = sanitizeFileName(fileName);
  const kept = parseStoredFiles(value)
    .filter((f) => (f.usrName || f.name) !== wanted);
  return serializeStoredFiles(kept);
}

export default {
  contentTypeByExtension, supposeImageType, resolveMime, contentDisposition,
  sanitizeFileName, findField, uploadPolicy, acceptsFileName, validateUpload,
  fileObject, parseStoredFiles, serializeStoredFiles, removeStoredFile,
  DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_TOTAL_SIZE,
};
