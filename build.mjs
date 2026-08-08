import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, "icons"), { recursive: true });

const isWatch = process.argv.includes("--watch");
let _crcTable;

async function bundle(entry, outfile) {
  const opts = {
    entryPoints: [join(SRC, entry)],
    outfile: join(DIST, outfile),
    bundle: true,
    minify: false,
    format: "iife",
    platform: "browser",
    target: ["chrome112"],
    logLevel: "warning",
  };
  if (isWatch) {
    opts.watch = { onRebuild: () => console.log("[rebuild]", outfile) };
  }
  await build(opts);
}

await Promise.all([
  bundle("background.ts", "background.js"),
  bundle("content.ts", "content.js"),
  bundle("options.ts", "options.js"),
  bundle("popup.ts", "popup.js"),
]);

copyFileSync(join(SRC, "manifest.json"), join(DIST, "manifest.json"));
copyFileSync(join(SRC, "options.html"), join(DIST, "options.html"));
copyFileSync(join(SRC, "popup.html"), join(DIST, "popup.html"));

writeFileSync(
  join(DIST, "icons", "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d9488"/><path d="M12 22c4-9 12-14 20-14 10 0 19 6 21 16 1 6-2 10-4 12-3 4-7 6-7 6l-10-15-8 8c-6-2-9-7-12-14z" fill="#ffffff" opacity="0.95"/></svg>`,
);

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(DIST, "icons", `icon${size}.png`), pngTile(size));
}

console.log("build complete ->", DIST);

function pngTile(size) {
  const mkShape = mk(size);
  const raw = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (mkShape.bg(x, y)) {
        raw[i] = 13;
        raw[i + 1] = 148;
        raw[i + 2] = 136;
        raw[i + 3] = 255;
      } else {
        raw[i] = 255;
        raw[i + 1] = 255;
        raw[i + 2] = 255;
        raw[i + 3] = 255;
      }
    }
  }
  return pngEncodePNG(size, raw);
}

function mk(size) {
  const R = size * 0.22;
  return {
    bg(x, y) {
      const cx = size / 2;
      const cy = size / 2;
      return Math.hypot(x - cx, y - cy) <= R;
    },
  };
}

function crc32(buf) {
  let c = 0xffffffff;
  const table = crcTable();
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

if (!isWatch) process.exit(0);

function crcTable() {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  _crcTable = t;
  return t;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function pngEncodePNG(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (!isWatch) process.exit(0);