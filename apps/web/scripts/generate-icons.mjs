// Regenerates the PWA icons from assets-src/*.svg. Run manually: `pnpm --filter @rumble-realms/web icons`.
// Not part of the build; the PNGs in public/ are committed.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const src = (name) => fileURLToPath(new URL(`assets-src/${name}`, root));
const out = (name) => fileURLToPath(new URL(`public/${name}`, root));

const icon = await readFile(src('icon.svg'));
const maskable = await readFile(src('icon-maskable.svg'));

const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

await writeFile(out('pwa-192.png'), await png(icon, 192));
await writeFile(out('pwa-512.png'), await png(icon, 512));
await writeFile(out('pwa-maskable-512.png'), await png(maskable, 512));
// iOS fills transparency with black, so the touch icon is flattened onto the icon background.
await writeFile(
  out('apple-touch-icon.png'),
  await sharp(await png(icon, 180))
    .flatten({ background: '#2a56c6' })
    .png()
    .toBuffer(),
);
await copyFile(src('icon.svg'), out('favicon.svg'));
console.log('Icons written to apps/web/public');
