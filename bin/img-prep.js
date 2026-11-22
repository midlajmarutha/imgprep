#!/usr/bin/env node
// img-prep: batch image preprocessing for web apps (Next.js friendly).
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const VERSION = '1.0.0';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tif', '.tiff']);
const FORMATS = ['webp', 'avif', 'jpeg', 'png', 'original'];
const POSITIONS = [
  'attention', 'entropy', 'center', 'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest', 'top', 'right top', 'right', 'right bottom',
  'bottom', 'left bottom', 'left', 'left top',
];
const GRAVITIES = ['center', 'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

const DEFAULTS = {
  output: './processed',
  widths: '400,800,full',
  format: 'webp',
  recursive: false,
  position: 'attention',
  blur: true,
  'blur-size': 16,
  'watermark-position': 'southeast',
  'watermark-opacity': 0.5,
  'watermark-scale': 0.2,
  manifest: 'images.json',
  'manifest-format': 'json',
  prefix: '/images',
  concurrency: Math.max(1, Math.min(4, os.cpus().length)),
};

const PRESETS = {
  web: {},
  thumbs: { widths: '200,400', aspect: '1:1', quality: 75 },
  hero: { widths: '800,1600,2400', quality: 75 },
};

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  widths: { type: 'string', short: 'w' },
  format: { type: 'string', short: 'f' },
  quality: { type: 'string', short: 'q' },
  recursive: { type: 'boolean', short: 'r' },
  preset: { type: 'string' },
  aspect: { type: 'string' },
  position: { type: 'string' },
  trim: { type: 'boolean' },
  grayscale: { type: 'boolean' },
  sharpen: { type: 'boolean' },
  flatten: { type: 'string' },
  upscale: { type: 'boolean' },
  'no-blur': { type: 'boolean' },
  'blur-size': { type: 'string' },
  watermark: { type: 'string' },
  'watermark-position': { type: 'string' },
  'watermark-opacity': { type: 'string' },
  'watermark-scale': { type: 'string' },
  'keep-names': { type: 'boolean' },
  manifest: { type: 'string' },
  'manifest-format': { type: 'string' },
  prefix: { type: 'string' },
  'skip-existing': { type: 'boolean' },
  fresh: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  concurrency: { type: 'string' },
  config: { type: 'string' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = paint(2);
const green = paint(32);
const red = paint(31);
const yellow = paint(33);
const bold = paint(1);

const HELP = `
${bold('img-prep')} v${VERSION} - preprocess images for the web (resize, convert, blur placeholders, manifest)

${bold('Usage')}
  img-prep <file|folder> [more files/folders...] [options]

${bold('Output')}
  -o, --output <dir>          Output folder                          (default: ./processed)
  -f, --format <fmt>          webp | avif | jpeg | png | original    (default: webp)
  -q, --quality <1-100>       Encoder quality                        (default: 80, avif: 60)
      --manifest <name>       Manifest file name, or "none"          (default: images.json)
      --manifest-format <f>   json | ts                              (default: json)
      --prefix <url-path>     URL prefix used in the manifest        (default: /images)
      --keep-names            Keep original file names instead of slugifying them

${bold('Sizes')}
  -w, --widths <list>         Comma-separated widths; "full" = original width
                              (default: 400,800,full). Never upscales unless --upscale.
      --upscale               Allow enlarging beyond the original size
      --aspect <ratio>        Crop to an aspect ratio first, e.g. 1:1, 4:5, 16:9
      --position <pos>        Crop focus: attention (default), entropy, center,
                              north, south, east, west, ...

${bold('Preprocessing')}
      --trim                  Trim uniform borders around the image
      --grayscale             Convert to grayscale
      --sharpen               Light sharpening after resizing
      --flatten <color>       Replace transparency with a color (e.g. "#ffffff").
                              Done automatically (white) for jpeg output.
      --watermark <image>     Overlay a watermark image (PNG with transparency works best)
      --watermark-position <p>  center, north, northeast, east, southeast (default), ...
      --watermark-opacity <n>   0-1 (default: 0.5)
      --watermark-scale <n>     Watermark width as a fraction of image width (default: 0.2)
      --no-blur               Skip the tiny blurDataURL placeholder
      --blur-size <px>        Placeholder width in px (default: 16)

${bold('Batch & behavior')}
  -r, --recursive             Walk sub-folders (structure is preserved in the output)
      --skip-existing         Reuse results already in the output folder + manifest
      --fresh                 Overwrite the manifest instead of merging into it
      --concurrency <n>       Images processed in parallel (default: ${DEFAULTS.concurrency})
      --dry-run               Show what would be created without writing anything
      --preset <name>         web (default) | thumbs | hero
      --config <file>         JSON config file (img-prep.config.json is auto-loaded from cwd)
      --quiet                 Only print errors and the final summary
  -h, --help                  Show this help
  -v, --version               Show version

${bold('Examples')}
  img-prep ./raw-photos -o public/images -r
  img-prep sketch.png -w 480,960,1920 -f avif
  img-prep ./gallery --aspect 4:5 --grayscale --watermark logo.png
  img-prep ./gallery --manifest images.ts --manifest-format ts --prefix /gallery
`;

function die(msg, code = 2) {
  console.error(red(`error: ${msg}`));
  process.exit(code);
}

// ---------- settings ----------

function toNumber(v, name, { min = -Infinity, max = Infinity, int = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    die(`Invalid value for ${name}: "${v}"`);
  }
  return n;
}

function parseWidths(v) {
  const arr = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (!arr.length) die('No widths given.');
  return arr.map((x) => (x === 'full' ? 'full' : toNumber(x, 'widths', { min: 1, int: true })));
}

function parseAspect(v) {
  const m = String(v).match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/i);
  if (m) return Number(m[1]) / Number(m[2]);
  return toNumber(v, 'aspect', { min: 0.01 });
}

function resolveSettings(cli, config) {
  const presetName = cli.preset ?? config.preset ?? 'web';
  const preset = PRESETS[presetName];
  if (!preset) die(`Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(', ')}`);

  const cliValues = { ...cli };
  if (cliValues['no-blur']) cliValues.blur = false;
  delete cliValues['no-blur'];
  for (const k of ['config', 'help', 'version', 'preset']) delete cliValues[k];

  const m = { ...DEFAULTS, ...preset, ...config, ...cliValues };

  const format = String(m.format).toLowerCase() === 'jpg' ? 'jpeg' : String(m.format).toLowerCase();
  if (!FORMATS.includes(format)) die(`Invalid format "${m.format}". Use: ${FORMATS.join(', ')}`);

  const position = String(m.position).toLowerCase();
  if (!POSITIONS.includes(position)) die(`Invalid position "${m.position}".`);

  const wmPosition = String(m['watermark-position']).toLowerCase();
  if (!GRAVITIES.includes(wmPosition)) die(`Invalid watermark position "${wmPosition}". Use: ${GRAVITIES.join(', ')}`);

  const manifestFormat = String(m['manifest-format']).toLowerCase();
  if (!['json', 'ts'].includes(manifestFormat)) die('manifest-format must be "json" or "ts".');

  let manifest = String(m.manifest);
  if (manifest !== 'none') {
    const wantExt = manifestFormat === 'ts' ? '.ts' : '.json';
    if (m.manifest === DEFAULTS.manifest && manifestFormat === 'ts') manifest = 'images.ts';
    if (path.extname(manifest) !== wantExt) {
      die(`Manifest file "${manifest}" should end in ${wantExt} for --manifest-format ${manifestFormat}.`);
    }
  }

  const watermark = m.watermark ? path.resolve(String(m.watermark)) : null;
  if (watermark && !existsSync(watermark)) die(`Watermark file not found: ${watermark}`);

  const quality = m.quality !== undefined
    ? toNumber(m.quality, 'quality', { min: 1, max: 100, int: true })
    : format === 'avif' ? 60 : 80;

  return {
    output: path.resolve(String(m.output)),
    widths: parseWidths(m.widths),
    format,
    quality,
    recursive: !!m.recursive,
    aspect: m.aspect ? parseAspect(m.aspect) : null,
    position,
    trim: !!m.trim,
    grayscale: !!m.grayscale,
    sharpen: !!m.sharpen,
    flatten: m.flatten ? String(m.flatten) : null,
    upscale: !!m.upscale,
    blur: m.blur !== false,
    blurSize: toNumber(m['blur-size'], 'blur-size', { min: 2, max: 128, int: true }),
    watermark,
    watermarkPosition: wmPosition,
    watermarkOpacity: toNumber(m['watermark-opacity'], 'watermark-opacity', { min: 0, max: 1 }),
    watermarkScale: toNumber(m['watermark-scale'], 'watermark-scale', { min: 0.01, max: 1 }),
    keepNames: !!m['keep-names'],
    manifest,
    manifestFormat,
    prefix: String(m.prefix).replace(/\/+$/, ''),
    skipExisting: !!m['skip-existing'],
    fresh: !!m.fresh,
    dryRun: !!m['dry-run'],
    concurrency: toNumber(m.concurrency, 'concurrency', { min: 1, max: 64, int: true }),
    quiet: !!m.quiet,
  };
}

// ---------- discovery ----------

const slugify = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'image';

async function walk(dir, recursive, outDir, rel = []) {
  const found = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive && path.resolve(full) !== outDir) found.push(...(await walk(full, recursive, outDir, [...rel, e.name])));
    } else if (e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
      found.push({ file: full, relSegments: rel });
    }
  }
  return found;
}

async function collectJobs(inputs, S) {
  const raw = [];
  for (const input of inputs) {
    let st;
    try {
      st = await fs.stat(input);
    } catch {
      die(`Not found: ${input}`);
    }
    if (st.isDirectory()) {
      raw.push(...(await walk(path.resolve(input), S.recursive, S.output)));
    } else if (IMAGE_EXTS.has(path.extname(input).toLowerCase())) {
      raw.push({ file: path.resolve(input), relSegments: [] });
    } else {
      console.error(yellow(`skipping (unsupported type): ${input}`));
    }
  }

  const used = new Set();
  return raw
    .filter((j) => !j.file.startsWith(S.output + path.sep))
    .map((j) => {
      const base = path.basename(j.file, path.extname(j.file));
      const segs = S.keepNames ? j.relSegments : j.relSegments.map(slugify);
      const name = S.keepNames ? base : slugify(base);
      let slug = name;
      let n = 2;
      while (used.has([...segs, slug].join('/'))) slug = `${name}-${n++}`;
      used.add([...segs, slug].join('/'));
      return { file: j.file, relDir: segs.join('/'), slug, key: [...segs, slug].join('/') };
    });
}

// ---------- processing ----------

function resolveFormat(S, meta) {
  if (S.format !== 'original') return S.format;
  const f = meta.format === 'jpg' ? 'jpeg' : meta.format;
  return ['jpeg', 'png', 'webp', 'avif'].includes(f) ? f : 'webp';
}

const extFor = (fmt) => (fmt === 'jpeg' ? 'jpg' : fmt);

function encode(p, fmt, quality) {
  switch (fmt) {
    case 'webp': return p.webp({ quality, effort: 5 });
    case 'avif': return p.avif({ quality, effort: 4 });
    case 'jpeg': return p.jpeg({ quality, mozjpeg: true });
    case 'png': return p.png({ compressionLevel: 9 });
    default: throw new Error(`Unsupported format ${fmt}`);
  }
}

async function buildWatermark(S, targetWidth) {
  const w = Math.max(8, Math.round(targetWidth * S.watermarkScale));
  const margin = Math.max(2, Math.round(targetWidth * 0.02));
  const resized = await sharp(S.watermark).resize({ width: w }).ensureAlpha().png().toBuffer();
  // Multiply the watermark's alpha by the requested opacity (dest-in with a 1x1 tiled alpha mask).
  return sharp(resized)
    .composite([{
      input: Buffer.from([0, 0, 0, Math.round(255 * S.watermarkOpacity)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in',
    }])
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function processJob(job, S, existingManifest) {
  const stat = await fs.stat(job.file);
  const meta = await sharp(job.file, { failOn: 'none' }).metadata();
  const fmt = resolveFormat(S, meta);
  const ext = extFor(fmt);
  const outDir = path.join(S.output, job.relDir);

  // Reuse previous results when asked.
  if (S.skipExisting && existingManifest[job.key]) {
    const prev = existingManifest[job.key];
    const allThere = prev.variants.every((v) => existsSync(path.join(outDir, path.basename(v.src))));
    if (allThere) return { job, entry: prev, skipped: true, inBytes: stat.size, outBytes: 0 };
  }

  // Stage 1: orient, trim, flatten, grayscale into a lossless working buffer.
  let p = sharp(job.file, { failOn: 'none' }).rotate();
  if (S.trim) p = p.trim();
  const flattenBg = S.flatten ?? (fmt === 'jpeg' && meta.hasAlpha ? '#ffffff' : null);
  if (flattenBg) p = p.flatten({ background: flattenBg });
  if (S.grayscale) p = p.grayscale();
  let { data, info } = await p.png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true });

  // Stage 2: crop to aspect ratio.
  if (S.aspect) {
    const cur = info.width / info.height;
    const cw = cur > S.aspect ? Math.round(info.height * S.aspect) : info.width;
    const ch = cur > S.aspect ? info.height : Math.round(info.width / S.aspect);
    ({ data, info } = await sharp(data)
      .resize({ width: cw, height: ch, fit: 'cover', position: S.position })
      .png({ compressionLevel: 1 })
      .toBuffer({ resolveWithObject: true }));
  }

  // Resolve target widths.
  const targets = [...new Set(
    S.widths.map((w) => {
      const t = w === 'full' ? info.width : w;
      return S.upscale ? t : Math.min(t, info.width);
    }),
  )].sort((a, b) => a - b);

  await fs.mkdir(outDir, { recursive: true });

  const variants = [];
  let outBytes = 0;
  for (const w of targets) {
    let img = sharp(data).resize({ width: w, withoutEnlargement: !S.upscale });
    if (S.sharpen) img = img.sharpen();
    if (S.watermark) img = img.composite([{ input: await buildWatermark(S, w), gravity: S.watermarkPosition }]);
    const file = `${job.slug}-${w}.${ext}`;
    const out = await encode(img, fmt, S.quality).toFile(path.join(outDir, file));
    outBytes += out.size;
    variants.push({ src: [S.prefix, job.relDir, file].filter(Boolean).join('/'), width: out.width, height: out.height });
  }

  const largest = variants[variants.length - 1];
  const entry = {
    src: largest.src,
    width: largest.width,
    height: largest.height,
    ...(S.blur
      ? {
          blurDataURL: `data:image/webp;base64,${(
            await sharp(data).resize({ width: S.blurSize }).webp({ quality: 40 }).toBuffer()
          ).toString('base64')}`,
        }
      : {}),
    srcSet: variants.map((v) => `${v.src} ${v.width}w`).join(', '),
    variants,
  };
  return { job, entry, skipped: false, inBytes: stat.size, outBytes };
}

// ---------- manifest ----------

function readManifest(file, format) {
  if (!existsSync(file)) return {};
  try {
    const text = readFileSync(file, 'utf8');
    if (format === 'json') return JSON.parse(text);
    const m = text.match(/export const images = ([\s\S]*?) as const;/);
    return m ? JSON.parse(m[1]) : {};
  } catch {
    console.error(yellow(`warning: could not parse existing manifest ${file}; starting fresh`));
    return {};
  }
}

function manifestText(data, format) {
  const json = JSON.stringify(data, null, 2);
  if (format === 'json') return json + '\n';
  return `// Generated by img-prep. Re-running merges new images into this object.\nexport const images = ${json} as const;\n\nexport type ImageKey = keyof typeof images;\n`;
}

// ---------- main ----------

const shortPath = (p) => {
  const rel = path.relative(process.cwd(), p);
  return rel.startsWith('..') || path.isAbsolute(rel) ? p : rel;
};

const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    die(`${e.message}\nRun "img-prep --help" for usage.`);
  }
  const { values, positionals } = parsed;

  if (values.help) return console.log(HELP);
  if (values.version) return console.log(VERSION);
  if (!positionals.length) {
    console.log(HELP);
    process.exit(2);
  }

  let config = {};
  const configPath = values.config ?? (existsSync('img-prep.config.json') ? 'img-prep.config.json' : null);
  if (configPath) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (e) {
      die(`Could not read config ${configPath}: ${e.message}`);
    }
  }

  const S = resolveSettings(values, config);
  const log = (...a) => { if (!S.quiet) console.log(...a); };

  const jobs = await collectJobs(positionals, S);
  if (!jobs.length) die('No supported images found (jpg, png, webp, avif, gif, tiff). Use -r to include sub-folders.', 1);

  log(`${bold('img-prep')} ${dim(`${jobs.length} image${jobs.length === 1 ? '' : 's'} -> ${S.output}`)}`);

  if (S.dryRun) {
    for (const j of jobs) {
      const meta = await sharp(j.file, { failOn: 'none' }).metadata();
      const fmt = resolveFormat(S, meta);
      const natural = (meta.orientation ?? 1) >= 5 ? meta.height : meta.width;
      const widths = [...new Set(S.widths.map((w) => (w === 'full' ? natural : S.upscale ? w : Math.min(w, natural))))].sort((a, b) => a - b);
      console.log(`${shortPath(j.file)} ${dim('->')} ${widths.map((w) => path.join(j.relDir, `${j.slug}-${w}.${extFor(fmt)}`)).join(', ')}`);
    }
    console.log(dim('dry run: nothing written'));
    return;
  }

  const manifestPath = S.manifest === 'none' ? null : path.join(S.output, S.manifest);
  const existing = manifestPath && !S.fresh ? readManifest(manifestPath, S.manifestFormat) : {};

  await fs.mkdir(S.output, { recursive: true });

  const results = [];
  const failures = [];
  await pool(jobs, S.concurrency, async (job) => {
    const label = shortPath(job.file);
    try {
      const r = await processJob(job, S, existing);
      results.push(r);
      if (r.skipped) log(`${dim('-')} ${label} ${dim('(skipped, already processed)')}`);
      else log(`${green('✔')} ${label} ${dim('->')} ${job.key} ${dim(`(${fmtBytes(r.inBytes)} -> ${fmtBytes(r.outBytes)}, ${r.entry.variants.length} sizes)`)}`);
    } catch (e) {
      failures.push({ label, message: e.message });
      console.error(`${red('✖')} ${label}: ${e.message}`);
    }
  });

  if (manifestPath && results.length) {
    const merged = { ...existing };
    for (const r of results.sort((a, b) => a.job.key.localeCompare(b.job.key))) merged[r.job.key] = r.entry;
    const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
    await fs.writeFile(manifestPath, manifestText(sorted, S.manifestFormat));
  }

  const done = results.filter((r) => !r.skipped);
  const inTotal = done.reduce((s, r) => s + r.inBytes, 0);
  const outTotal = done.reduce((s, r) => s + r.outBytes, 0);
  console.log(
    `\n${bold('Done:')} ${done.length} processed, ${results.length - done.length} skipped, ${failures.length} failed` +
      (done.length ? ` ${dim(`(${fmtBytes(inTotal)} originals -> ${fmtBytes(outTotal)} output)`)}` : '') +
      (manifestPath && results.length ? `\nManifest: ${shortPath(manifestPath)}` : ''),
  );
  if (failures.length) process.exit(1);
}

main().catch((e) => die(e.stack || e.message, 1));
