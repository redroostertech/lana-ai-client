#!/usr/bin/env node
/**
 * Lana AI Client app-icon generator. Verbatim port of brainchild/scripts/
 * generate-icons.js (renamed to avoid clashing with this repo's existing
 * scripts/generate-icons.js, which builds the Lex Lucide SVG bundle).
 *
 * Reads the master PNG at `build/icons/icon.png` and emits the platform
 * artifacts electron-builder needs:
 *
 *   build/icons/
 *     icon.png              ← master (unchanged)
 *     icon-16.png … icon-1024.png    ← sized PNGs (Linux + intermediates)
 *     icon.icns             ← macOS bundle icon (built via `iconutil` if available)
 *     icon.ico              ← Windows multi-resolution ICO (built via png-to-ico)
 *
 * Optional deps:
 *   - `sharp` (preferred) for high-quality PNG resizing. If absent, we fall
 *     back to copying the master PNG into every sized slot — visually the
 *     same image at every size, which keeps electron-builder happy but is
 *     not crisp. Install `sharp` for production builds.
 *   - `png-to-ico` for the Windows ICO. Listed as a devDependency in
 *     package.json; if missing we copy the master PNG as `icon.ico` with a
 *     loud warning so the build still completes.
 *   - macOS `iconutil` (system binary) for the .icns. If we are not on
 *     macOS, or `iconutil` is missing, we copy the master PNG as `icon.icns`
 *     with a loud warning. The PNG-as-icns fallback lets electron-builder
 *     finish the build on non-mac hosts (e.g. CI); the resulting app on Mac
 *     will display the generic Electron icon, which is fine for internal
 *     builds but must be replaced before shipping.
 *
 * Usage:
 *   node scripts/generate-icons.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'app-icon-manifest.json');

function loadManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

function log(msg) {
  process.stdout.write(`[generate-icons] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[generate-icons] WARN: ${msg}\n`);
}

function tryRequire(name) {
  try {
    return require(name);
  } catch (_err) {
    return null;
  }
}

async function resizePng(sharp, masterBuf, size, outPath) {
  await sharp(masterBuf)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
}

async function generateSizedPngs(manifest) {
  const sharp = tryRequire('sharp');
  const masterPath = path.join(ROOT, manifest.master);
  const outDir = path.join(ROOT, manifest.outputDir);
  const masterBuf = fs.readFileSync(masterPath);

  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  for (const size of manifest.sizes) {
    const out = path.join(outDir, `icon-${size}.png`);
    if (sharp) {
      // eslint-disable-next-line no-await-in-loop
      await resizePng(sharp, masterBuf, size, out);
    } else {
      // Fallback: write the master at every slot. Visually identical
      // regardless of size, but electron-builder gets the files it expects.
      fs.copyFileSync(masterPath, out);
    }
    written.push(out);
  }

  if (!sharp) {
    warn('`sharp` not installed; sized PNGs are copies of the master. Install `sharp` for crisp downscales.');
  }

  return written;
}

async function generateIco(manifest) {
  const outPath = path.join(ROOT, manifest.outputDir, manifest.icoName);
  const pngToIco = tryRequire('png-to-ico');
  if (!pngToIco) {
    warn('`png-to-ico` not installed; copying master PNG as icon.ico. Run `npm install` to pull the devDependency.');
    fs.copyFileSync(path.join(ROOT, manifest.master), outPath);
    return outPath;
  }

  const icoSizes = manifest.icoSizes || [16, 32, 48, 64, 128, 256];
  const inputs = icoSizes
    .map((s) => path.join(ROOT, manifest.outputDir, `icon-${s}.png`))
    .filter((p) => fs.existsSync(p));

  if (inputs.length === 0) {
    warn('No sized PNGs found for ICO; falling back to master PNG.');
    fs.copyFileSync(path.join(ROOT, manifest.master), outPath);
    return outPath;
  }

  const buf = await pngToIco(inputs);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

function hasIconutil() {
  // iconutil exits 1 on --help, which fools naive exec checks. Use
  // `command -v` via the shell as the existence probe; we're already
  // gated on darwin so /bin/sh is guaranteed.
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('/bin/sh', ['-c', 'command -v iconutil'], { stdio: 'ignore' });
    return true;
  } catch (_err) {
    return false;
  }
}

function generateIcns(manifest) {
  const outPath = path.join(ROOT, manifest.outputDir, manifest.icnsName);

  if (process.platform !== 'darwin' || !hasIconutil()) {
    warn('`iconutil` unavailable (need macOS); copying master PNG as icon.icns. Replace before shipping a Mac build.');
    fs.copyFileSync(path.join(ROOT, manifest.master), outPath);
    return outPath;
  }

  // Build a temporary .iconset directory and feed it to iconutil.
  // Naming follows Apple's iconset convention:
  //   icon_16x16.png, icon_16x16@2x.png, icon_32x32.png, icon_32x32@2x.png,
  //   icon_128x128.png, icon_128x128@2x.png, icon_256x256.png,
  //   icon_256x256@2x.png, icon_512x512.png, icon_512x512@2x.png.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brainchild-icns-'));
  const iconset = path.join(tmpRoot, 'icon.iconset');
  fs.mkdirSync(iconset, { recursive: true });

  const slots = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];

  for (const [name, size] of slots) {
    const src = path.join(ROOT, manifest.outputDir, `icon-${size}.png`);
    const dst = path.join(iconset, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    } else {
      fs.copyFileSync(path.join(ROOT, manifest.master), dst);
    }
  }

  try {
    execFileSync('iconutil', ['-c', 'icns', '-o', outPath, iconset], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // iconutil enforces strict per-slot pixel dimensions. Without `sharp`
    // installed we ship the same master PNG into every slot, which fails
    // validation. Surface a clear warning and fall back to a PNG-as-icns
    // so electron-builder still finds an `icon.icns` and can complete the
    // build; on Mac the resulting app will show the generic Electron icon
    // until `sharp` is installed and the script is re-run.
    warn(`iconutil rejected the iconset (likely missing \`sharp\` for resize). Falling back to master PNG as icon.icns. Details: ${err && err.message ? err.message.split('\n')[0] : err}`);
    fs.copyFileSync(path.join(ROOT, manifest.master), outPath);
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_err) {
      /* ignore */
    }
  }

  return outPath;
}

async function main() {
  const manifest = loadManifest();
  const masterPath = path.join(ROOT, manifest.master);

  if (!fs.existsSync(masterPath)) {
    process.stderr.write(`[generate-icons] master icon missing: ${masterPath}\n`);
    process.exit(1);
  }

  log(`master: ${manifest.master}`);
  log(`output: ${manifest.outputDir}`);

  const pngs = await generateSizedPngs(manifest);
  log(`wrote ${pngs.length} sized PNGs`);

  const ico = await generateIco(manifest);
  log(`wrote ${path.relative(ROOT, ico)}`);

  const icns = generateIcns(manifest);
  log(`wrote ${path.relative(ROOT, icns)}`);

  log('done.');
}

main().catch((err) => {
  process.stderr.write(`[generate-icons] failed: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
