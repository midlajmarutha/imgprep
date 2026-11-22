# img-prep

Batch image preprocessing CLI for Next.js (or any web project). Point it at a file or a folder and it produces resized, compressed variants, tiny blur placeholders for `next/image`, and a manifest you can import.

Built on [sharp](https://sharp.pixelplumbing.com/) (the same library Next.js uses).

## Install

```bash
cd img-prep
npm install
npm link          # optional: makes the `img-prep` command available everywhere
```

Without `npm link`, run it as `node /path/to/img-prep/bin/img-prep.js ...`.
Requires Node 18.17+.

## Quick start

```bash
# one file, defaults (webp, quality 80, widths 400 / 800 / original)
img-prep sketch.png -o public/images

# a whole folder, including sub-folders
img-prep ./raw-photos -r -o public/images

# AVIF, custom widths
img-prep ./raw-photos -f avif -w 480,960,1920 -o public/images

# square thumbnails, grayscale, watermarked
img-prep ./raw-photos --preset thumbs --grayscale --watermark logo.png

# see what would happen without writing anything
img-prep ./raw-photos -r --dry-run
```

## What it does to each image

1. Auto-rotates from EXIF orientation and **strips all metadata** (smaller files, no GPS leaks).
2. Optional preprocessing: `--trim`, `--flatten`, `--grayscale`, `--aspect` crop.
3. Resizes to each requested width. It never upscales unless you pass `--upscale`.
4. Optional per-size steps: `--sharpen`, `--watermark`.
5. Encodes to WebP / AVIF / JPEG / PNG.
6. Generates a ~16px blurred `blurDataURL` and writes/merges a manifest.

Output files are named `<slug>-<width>.<ext>`, e.g. `my-sketch-800.webp`. Names are slugified (`My Sketch.PNG` becomes `my-sketch`) unless you pass `--keep-names`. Sub-folder structure is preserved with `-r`.

## Options

| Option | Default | Description |
|---|---|---|
| `-o, --output <dir>` | `./processed` | Output folder |
| `-f, --format <fmt>` | `webp` | `webp`, `avif`, `jpeg`, `png`, `original` |
| `-q, --quality <1-100>` | `80` (`60` for avif) | Encoder quality (ignored for png) |
| `-w, --widths <list>` | `400,800,full` | Comma-separated widths; `full` = original width |
| `--upscale` | off | Allow enlarging past the original size |
| `--aspect <ratio>` | none | Crop first, e.g. `1:1`, `4:5`, `16:9` |
| `--position <pos>` | `attention` | Crop focus: `attention`, `entropy`, `center`, `north`, `south`, ... |
| `--trim` | off | Trim uniform borders |
| `--grayscale` | off | Convert to grayscale |
| `--sharpen` | off | Light sharpening after resize |
| `--flatten <color>` | none | Replace transparency with a color (automatic white for JPEG) |
| `--watermark <image>` | none | Overlay a watermark (transparent PNG works best) |
| `--watermark-position <p>` | `southeast` | `center`, `north`, `northeast`, `east`, `southeast`, ... |
| `--watermark-opacity <0-1>` | `0.5` | Watermark opacity |
| `--watermark-scale <0-1>` | `0.2` | Watermark width as a fraction of image width |
| `--no-blur` | | Skip the blur placeholder |
| `--blur-size <px>` | `16` | Placeholder width |
| `--keep-names` | off | Don't slugify file names |
| `--manifest <name>` | `images.json` | Manifest file name, or `none` |
| `--manifest-format <f>` | `json` | `json` or `ts` |
| `--prefix <path>` | `/images` | URL prefix written into the manifest |
| `-r, --recursive` | off | Process sub-folders |
| `--skip-existing` | off | Reuse results already in the output folder and manifest |
| `--fresh` | off | Overwrite the manifest instead of merging into it |
| `--concurrency <n>` | `4` | Images processed in parallel |
| `--dry-run` | | Print the plan, write nothing |
| `--preset <name>` | `web` | `web`, `thumbs` (200/400, 1:1), `hero` (800/1600/2400) |
| `--config <file>` | | JSON config file |
| `--quiet` | | Only errors and the summary |

Supported input: jpg, png, webp, avif, gif (first frame), tiff.

## Config file

Put an `img-prep.config.json` in the folder you run the command from (or pass `--config`). Keys are the long option names. Priority is: defaults, then preset, then config file, then command-line flags. See `img-prep.config.example.json`.

```json
{
  "output": "public/images",
  "widths": "400,800,1600",
  "format": "webp",
  "recursive": true,
  "prefix": "/images"
}
```

With that file in place, `img-prep ./raw` is all you need to type.

## Manifest

Re-running **merges** new images into the existing manifest, so you can add photos one at a time. Use `--fresh` to start over. `--skip-existing` skips images whose output files and manifest entry already exist. It doesn't detect changed settings, so remove old outputs or omit it when you change options.

```json
{
  "my-sketch": {
    "src": "/images/my-sketch-1414.webp",
    "width": 1414,
    "height": 2000,
    "blurDataURL": "data:image/webp;base64,...",
    "srcSet": "/images/my-sketch-400.webp 400w, /images/my-sketch-800.webp 800w, ...",
    "variants": [{ "src": "...", "width": 400, "height": 566 }]
  }
}
```

Keys include the sub-folder when you use `-r` (e.g. `"portfolio/photo-two"`).

### Using it in Next.js

Copy the output folder's images into `public/images/` and the manifest somewhere importable (or write it directly there with `-o`).

```tsx
import Image from "next/image";
import images from "@/data/images.json"; // or: import { images } from "@/data/images"

const img = images["my-sketch"];

<Image
  src={img.src}
  width={img.width}
  height={img.height}
  placeholder="blur"
  blurDataURL={img.blurDataURL}
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="Pencil portrait"
/>
```

With `--manifest images.ts --manifest-format ts` you get a typed `images` object and an `ImageKey` type.

## Exit codes

`0` success, `1` one or more images failed (or none found), `2` invalid usage or options.
