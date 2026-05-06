/**
 * Renders the "meet Henri" stamp ring (Variant X) at 3 sizes and saves
 * them to the user's desktop, plus a master SVG. Self-contained — uses
 * Playwright's bundled Chromium and loads Fraunces from Google Fonts.
 *
 * Run: pnpm exec node scripts/_export-meet-logo.mjs
 *
 * Outputs (all on `~/Desktop/`):
 *   henri-meet-logo.svg          — vector master (Fraunces via @import)
 *   henri-meet-logo-256.png      — medium (general use, social avatar)
 *   henri-meet-logo-512.png      — large (web hero, deck cover)
 *   henri-meet-logo-1024.png     — print / OG card / high-DPI hero
 *
 * The PNG renders go through a real Chromium with Google Fonts loaded
 * and `document.fonts.ready` awaited, so the rasterized output matches
 * what the dev server renders byte-for-byte. The SVG references the
 * font via @import — works in any modern browser, Inkscape, Illustrator,
 * Figma. For complete font independence the user can outline the type
 * in any vector editor (Object > Path > Object to Path).
 */

// The project ships @playwright/test (which re-exports the chromium
// driver). Plain `playwright` isn't a direct dep, so reach through the
// test package.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const DESKTOP = path.join(homedir(), "Desktop");
const PNG_SIZES = [256, 512, 1024];
const SVG_BASE_SIZE = 512;

/**
 * Pure-string SVG generator — same geometry as the WordmarkX React
 * component. Kept as raw string so it works inside `page.setContent`
 * (Playwright) and as a standalone .svg file.
 */
function logoSvg(size, { embedFontImport = false } = {}) {
  const stroke = size * 0.05;
  const ringRadius = size / 2 - stroke / 2;
  const meetArcRadius = (size / 2 - stroke) * 0.82;
  const arcLeftX = size / 2 - meetArcRadius;
  const arcRightX = size / 2 + meetArcRadius;
  const arcY = size / 2;

  const fontImport = embedFontImport
    ? `<style>@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;1,500&amp;display=swap'); text { font-family: 'Fraunces', 'Cormorant Garamond', Georgia, serif; }</style>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    ${fontImport}
    <path id="meet-arc" d="M ${arcLeftX} ${arcY} A ${meetArcRadius} ${meetArcRadius} 0 0 1 ${arcRightX} ${arcY}" fill="none"/>
  </defs>
  <circle cx="${size / 2}" cy="${size / 2}" r="${ringRadius}" fill="none" stroke="#D4886A" stroke-width="${stroke}"/>
  <text font-family="Fraunces, serif" font-weight="500" font-style="italic" font-size="${size * 0.085}" fill="#D4886A" letter-spacing="${size * 0.018}">
    <textPath href="#meet-arc" startOffset="50%" text-anchor="middle">meet</textPath>
  </text>
  <text x="${size / 2}" y="${size * 0.625}" text-anchor="middle" font-family="Fraunces, serif" font-weight="500" font-size="${size * 0.28}" fill="#D4886A" letter-spacing="${-size * 0.005}">Henri.</text>
</svg>`;
}

async function main() {
  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    // Render each PNG size via setContent + fonts.ready
    for (const size of PNG_SIZES) {
      const svg = logoSvg(size);
      const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;1,500&display=swap" rel="stylesheet">
  <style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { display: inline-block; }
    svg { display: block; }
  </style>
</head>
<body>${svg}</body>
</html>`;

      await page.setViewportSize({ width: size + 40, height: size + 40 });
      await page.setContent(html, { waitUntil: "networkidle" });
      // Belt + suspenders — wait for the actual font to be ready
      await page.evaluate(() => document.fonts.ready);
      // Tiny extra delay so any CSS-applied metric resolves before rasterizing
      await page.waitForTimeout(200);

      const buffer = await page
        .locator("svg")
        .screenshot({ omitBackground: true });

      const outPath = path.join(DESKTOP, `henri-meet-logo-${size}.png`);
      await writeFile(outPath, buffer);
      console.log(`✓ ${outPath} (${buffer.length} bytes)`);
    }

    // Master SVG — embeds the Fraunces @import so it renders in any
    // modern browser without requiring the font to be installed locally
    const svgMaster = logoSvg(SVG_BASE_SIZE, { embedFontImport: true });
    const svgPath = path.join(DESKTOP, `henri-meet-logo.svg`);
    await writeFile(svgPath, svgMaster);
    console.log(`✓ ${svgPath} (${svgMaster.length} bytes)`);
  } finally {
    await browser.close();
  }
  console.log("\nAll files written to:", DESKTOP);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
