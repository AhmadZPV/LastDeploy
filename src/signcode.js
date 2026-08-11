/**
 * Signature-to-image and Code 39 barcodes, ported from the source.
 *
 * signature-to-image.php (Thomas J. Bradley's sigJsonToImage) draws the
 * Signature Pad JSON strokes with a GD context: the signature is rendered on
 * an enlarged canvas and shrunk for anti-aliasing. Here the same strokes
 * become an SVG in the enlarged coordinate space — the browser does the
 * downscaling, which is the same anti-aliasing trick for free. Defaults are
 * the source's: 198x55, white background, pen #145394, width 4, multiplier 5.
 *
 * barcodemaker.php (nitro23456) generates Code 3 of 9 — the only symbology
 * the source supports — with narrow/wide/quiet ratios 20/55/35, the value
 * uppercased and wrapped in '*' start/stop, bars and spaces alternating from
 * black, and the text printed underneath. The charset below is the exact
 * table from the source, including its quirk that '|' and '-' share one
 * pattern and every unknown character becomes a space.
 */

/** The exact Code39() table from barcodemaker.php. */
export const CODE39_TABLE = {
  ' ': '011000100', '$': '010101000', '%': '000101010', '*': '010010100',
  '+': '010001010', '|': '010000101', '.': '110000100', '/': '010100010',
  '-': '010000101',
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100',
  A: '100001001', B: '001001001', C: '101001000', D: '000011001',
  E: '100011000', F: '001011000', G: '000001101', H: '100001100',
  I: '001001100', J: '000011100', K: '100000011', L: '001000011',
  M: '101000010', N: '000010011', O: '100010010', P: '001010010',
  Q: '000000111', R: '100000110', S: '001000110', T: '000010110',
  U: '110000001', V: '011000001', W: '111000000', X: '010010001',
  Y: '110010000', Z: '011010000',
};

/** barcodemaker.php ratios: narrow bar, wide bar, quiet zone per character. */
export const CODE39_RATIOS = { narrow: 20, wide: 55, quiet: 35 };

export const SIGNATURE_DEFAULTS = {
  imageSize: [198, 55],
  bgColour: '#ffffff',
  penWidth: 4,
  penColour: '#145394',
  drawMultiplier: 5,
};

function escAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Parses the signature JSON (string or array), tolerating slashes-escapes. */
export function parseSignatureJson(json) {
  if (Array.isArray(json)) return json;
  if (typeof json !== 'string') return [];
  try {
    const parsed = JSON.parse(json.replace(/\\(.)/g, '$1')); // stripslashes
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Signature Pad JSON -> SVG string. Every stroke is {lx, ly, mx, my}.
 * The viewBox carries the enlarged coordinate space; the element itself is
 * the target size, so the browser performs the source's shrink step.
 */
export function signatureToSvg(json, options = {}) {
  const opts = { ...SIGNATURE_DEFAULTS, ...options };
  const [width, height] = opts.imageSize;
  const mult = opts.drawMultiplier;
  const strokes = parseSignatureJson(json);

  const vbW = width * mult;
  const vbH = height * mult;
  const pen = opts.penWidth * (mult / 2);

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${vbW} ${vbH}" role="img">`
  );
  if (opts.bgColour !== 'transparent') {
    parts.push(`<rect width="${vbW}" height="${vbH}" fill="${escAttr(opts.bgColour)}"/>`);
  }
  for (const s of strokes) {
    const nums = [s && s.lx, s && s.ly, s && s.mx, s && s.my].map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    parts.push(
      `<line x1="${nums[0] * mult}" y1="${nums[1] * mult}" x2="${nums[2] * mult}" y2="${nums[3] * mult}" ` +
      `stroke="${escAttr(opts.penColour)}" stroke-width="${pen}" stroke-linecap="round"/>`
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

/** The 9-element pattern of one character (unknown -> space, like the PHP). */
export function code39Pattern(char) {
  return CODE39_TABLE[char] || CODE39_TABLE[' '];
}

/**
 * The full stripe sequence for a value: '*' wrapped, uppercased, every
 * stripe { width: 'narrow'|'wide'|'quiet', black: boolean } in draw order.
 */
export function code39Stripes(value) {
  const full = '*' + String(value == null ? '' : value).toUpperCase() + '*';
  const stripes = [];
  for (const ch of full) {
    const pattern = code39Pattern(ch);
    let black = true; // bars and spaces alternate, starting with a bar
    for (const bit of pattern) {
      stripes.push({ width: bit === '1' ? 'wide' : 'narrow', black });
      black = !black;
    }
    stripes.push({ width: 'quiet', black: false });
  }
  return { text: full, stripes };
}

/**
 * barcodemaker.php geometry, faithfully: the requested width is divided by
 * the total ratio count; if any bar degenerates to zero (or collapses into
 * another), the source prints "Image is too small!" — here the SVG carries
 * that same message.
 */
export function barcode39Svg(value, options = {}) {
  const width = Number(options.width) || 160;
  const height = Number(options.height) || 80;
  const showText = options.text !== 0 && options.text !== false;

  const { text, stripes } = code39Stripes(value);
  const ratios = CODE39_RATIOS;
  const totalRatio = (text.length) * (6 * ratios.narrow + 3 * ratios.wide + ratios.quiet);
  const pixels = width / totalRatio;
  const narrowBar = Math.floor(ratios.narrow * pixels);
  const wideBar = Math.floor(ratios.wide * pixels);
  const quietBar = Math.floor(ratios.quiet * pixels);

  const degenerate =
    narrowBar === 0 || narrowBar === wideBar || narrowBar === quietBar ||
    wideBar === 0 || wideBar === quietBar || quietBar === 0;

  if (degenerate) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img">` +
      `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
      `<text x="0" y="10" font-size="10" fill="#000000">Image is too small!</text></svg>`;
  }

  const widths = { narrow: narrowBar, wide: wideBar, quiet: quietBar };
  const actualWidth = stripes.reduce((sum, s) => sum + widths[s.width], 0);
  const fontHeight = showText ? 13 : -2; // GD font 3 is 13px tall
  let x = Math.floor((width - actualWidth) / 2);
  const barBottom = height - 1 - Math.max(fontHeight, 0) - 2;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${escAttr(text)}">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  for (const stripe of stripes) {
    const w = widths[stripe.width];
    if (stripe.black) {
      parts.push(`<rect x="${x}" y="0" width="${w}" height="${barBottom}" fill="#000000"/>`);
    }
    x += w;
  }
  if (showText) {
    parts.push(
      `<text x="${Math.floor(width / 2)}" y="${height - 2}" font-size="12" ` +
      `font-family="monospace" text-anchor="middle" fill="#000000">${escAttr(text)}</text>`
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

export default {
  CODE39_TABLE,
  CODE39_RATIOS,
  SIGNATURE_DEFAULTS,
  parseSignatureJson,
  signatureToSvg,
  code39Pattern,
  code39Stripes,
  barcode39Svg,
};
