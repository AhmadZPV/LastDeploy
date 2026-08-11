import sanitizeHtmlLibrary from 'sanitize-html';
import { loadMeta, fieldOf } from './meta-store.js';

const options = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'a', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], span: ['class'], table: ['class'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtmlLibrary.simpleTransform('a', { rel: 'noopener noreferrer' }, true) },
};

export function isRichTextField(entity, field) {
  const meta = loadMeta(entity);
  const spec = fieldOf(meta, field);
  return spec?.view?.ViewFormat === 'HTML' || spec?.edit?.EditFormat === 'HTML';
}

export function sanitizeRichText(value) {
  return sanitizeHtmlLibrary(String(value ?? ''), options);
}

export default { isRichTextField, sanitizeRichText };
