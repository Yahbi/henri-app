/**
 * Renders the Z lockup (W stamp + "meet Henri." wordmark, vertically
 * aligned) at three sizes and saves them to the user's desktop, plus a
 * master SVG. Mirrors the WordmarkZ React component byte-for-byte for
 * the PNG renders by going through real Chromium with Fraunces loaded.
 *
 * Run: pnpm exec node scripts/_export-z-lockup.mjs
 *
 * Outputs (all on `~/Desktop/`):
 *   henri-lockup.svg          — vector master (Fraunces via @import)
 *   henri-lockup-256.png      — small (avatar / business card)
 *   henri-lockup-512.png      — medium (web hero / sign-on screen)
 *   henri-lockup-1024.png     — large (print / OG card / high-DPI hero)
 *
 * The PNG sizes refer to the STAMP diameter. Final image dimensions
 * are wider/taller because the lockup includes the tagline beneath
 * (tagline height ≈ 25% of stamp diameter).
 */

import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const DESKTOP = path.join(homedir(), "Desktop");
const PNG_SIZES = [256, 512, 1024];
const SVG_BASE_SIZE = 512;

/**
 * HTML representation that mirrors WordmarkZ exactly. Fed into
 * Playwright's setContent + element-screenshot so the PNG output is
 * pixel-identical to what the React component renders.
 */
function lockupHtml(size) {
  const stroke = size * 0.05;
  const innerH = size * 0.55;
  const innerMargin = innerH * 0.05;
  const tagline = size * 0.18;
  const gap = size * 0.12;

  return `<!DOCTYPE html>
<html>
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;1,500&display=swap" rel="stylesheet">
  <style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { display: inline-block; }
    .lockup {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      color: #D4886A;
    }
    .stamp {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      border: ${stroke}px solid currentColor;
      box-sizing: border-box;
    }
    .stamp-inner { position: relative; display: inline-block; }
    .stamp-h {
      font-family: 'Fraunces', serif;
      font-weight: 500;
      font-size: ${innerH}px;
      line-height: 1;
      letter-spacing: -0.025em;
    }
    .stamp-dot {
      position: absolute;
      left: 100%;
      bottom: 0;
      font-family: 'Fraunces', serif;
      font-weight: 500;
      font-size: ${innerH}px;
      line-height: 1;
      margin-left: ${innerMargin}px;
    }
    .tagline {
      margin-top: ${gap}px;
      font-family: 'Fraunces', serif;
      font-weight: 500;
      font-size: ${tagline}px;
      line-height: 1;
      letter-spacing: -0.025em;
    }
    .tagline-italic { font-style: italic; }
  </style>
</head>
<body>
  <div class="lockup">
    <span class="stamp">
      <span class="stamp-inner">
        <span class="stamp-h">H</span>
        <span class="stamp-dot">.</span>
      </span>
    </span>
    <span class="tagline">
      <span class="tagline-italic">meet</span> Henri.
    </span>
  </div>
</body>
</html>`;
}

/**
 * Self-contained SVG version. Geometry is approximated from the HTML
 * via standard Fraunces metrics — H cap height ~0.69 of em, H glyph
 * width ~0.54 of em. Embeds @import for Fraunces so it renders in any
 * modern browser.
 */
function lockupSvg(size) {
  const stroke = size * 0.05;
  const ringRadius = size / 2 - stroke / 2;
  const innerH = size * 0.55;
  const taglineSize = size * 0.18;
  const gap = size * 0.12;
  const totalHeight = Math.ceil(size + gap + taglineSize * 1.5);

  // H baseline: cap-height visual midpoint aligns with circle center.
  const hBaseline = size * 0.69;
  // H glyph half-width (Fraunces 500 H ~0.54 em → half ~0.27 em)
  const hHalfWidth = innerH * 0.27;
  const dotX = size / 2 + hHalfWidth + innerH * 0.06;
  const taglineBaseline = size + gap + taglineSize * 0.85;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${totalHeight}" width="${size}" height="${totalHeight}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,500;1,500&amp;display=swap');
      text { font-family: 'Fraunces', 'Cormorant Garamond', Georgia, serif; font-weight: 500; fill: #D4886A; }
    </style>
  </defs>
  <circle cx="${size / 2}" cy="${size / 2}" r="${ringRadius}" fill="none" stroke="#D4886A" stroke-width="${stroke}"/>
  <text x="${size / 2}" y="${hBaseline}" text-anchor="middle" font-size="${innerH}" letter-spacing="${-innerH * 0.025}">H</text>
  <text x="${dotX}" y="${hBaseline}" text-anchor="start" font-size="${innerH}">.</text>
  <text x="${size / 2}" y="${taglineBaseline}" text-anchor="middle" font-size="${taglineSize}" letter-spacing="${-taglineSize * 0.025}"><tspan font-style="italic">meet</tspan> Henri.</text>
</svg>`;
}

async function main() {
  console.log("Launching Chromium…");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    for (const size of PNG_SIZES) {
      const html = lockupHtml(size);
      const tagline = size * 0.18;
      const gap = size * 0.12;
      const totalHeight = size + gap + tagline * 1.5;

      await page.setViewportSize({
        width: Math.max(Math.ceil(size) + 80, 1280),
        height: Math.max(Math.ceil(totalHeight) + 80, 800),
      });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);

      const buffer = await page
        .locator(".lockup")
        .screenshot({ omitBackground: true });

      const outPath = path.join(DESKTOP, `henri-lockup-${size}.png`);
      await writeFile(outPath, buffer);
      console.log(`✓ ${outPath} (${buffer.length} bytes)`);
    }

    const svgMaster = lockupSvg(SVG_BASE_SIZE);
    const svgPath = path.join(DESKTOP, `henri-lockup.svg`);
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
