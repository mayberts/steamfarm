// Regenerates public/favicon.ico and the PNG icons in public/icons from icon.svg and icon-maskable.svg.
// Needs Playwright with Chromium (not a project dependency):
//   npx -y playwright@1 install chromium && node scripts/render-icons.js
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const dir = path.join(__dirname, '..', 'public', 'icons');

/** An .ico file whose entries are PNG images (supported by every current browser and Windows). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (size, source) => {
    await page.setViewportSize({ width: size, height: size });
    const svg = fs.readFileSync(path.join(dir, source)).toString('base64');
    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" style="display:block"></body>`,
    );
    await page.waitForTimeout(50);
    return page.screenshot({ omitBackground: true });
  };

  fs.writeFileSync(path.join(dir, 'icon-192.png'), await render(192, 'icon.svg'));
  fs.writeFileSync(path.join(dir, 'icon-512.png'), await render(512, 'icon.svg'));
  fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), await render(512, 'icon-maskable.svg'));
  // iOS rounds the corners itself and fills transparency with black, so use the full-bleed art.
  fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), await render(180, 'icon-maskable.svg'));

  const ico = [];
  for (const size of [16, 32, 48]) ico.push({ size, data: await render(size, 'icon.svg') });
  // Browsers ask for /favicon.ico by default, so it lives at the site root.
  fs.writeFileSync(path.join(dir, '..', 'favicon.ico'), buildIco(ico));

  await browser.close();
  console.log(`Icons written to ${dir}`);
})();
