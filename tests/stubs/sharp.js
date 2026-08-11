/**
 * Local test stub for sharp.
 *
 * routes/media.js only chains rotate/resize/jpeg/toBuffer. The stub records the
 * chain so tests can assert the requested geometry, and returns a JPEG magic
 * header so mime sniffing downstream still sees an image.
 */
export default function sharp(input) {
  const chain = { input, ops: [] };
  const api = {
    chain,
    rotate(...a) { chain.ops.push(['rotate', a]); return api; },
    resize(...a) { chain.ops.push(['resize', a]); return api; },
    jpeg(...a) { chain.ops.push(['jpeg', a]); return api; },
    png(...a) { chain.ops.push(['png', a]); return api; },
    webp(...a) { chain.ops.push(['webp', a]); return api; },
    async toBuffer() {
      return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    },
    async metadata() { return { width: 100, height: 100, format: 'jpeg' }; },
  };
  return api;
}
