import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve("public/mascot/sprites");
const FRAME_NAMES = Array.from({ length: 8 }, (_, index) => `walk-${String(index + 1).padStart(2, "0")}.png`);
const THEMES = {
  dawn: { color: "#FF7A45", lightnessBias: 0 },
  night: { color: "#6D28D9", lightnessBias: -0.07 },
};
const DAY_SCARF_HSL = hexToHsl("#2F61F5");

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum) return [0, 0, lightness];
  const delta = maximum - minimum;
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
  let hue;
  if (maximum === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (maximum === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [(hue / 6) * 360, saturation, lightness];
}

function hueToRgb(p, q, rawT) {
  let t = rawT;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(hue, saturation, lightness) {
  if (saturation === 0) {
    const value = Math.round(lightness * 255);
    return [value, value, value];
  }
  const h = hue / 360;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)].map((value) => Math.round(value * 255));
}

function hexToHsl(hex) {
  return rgbToHsl(...hex.match(/[\da-f]{2}/gi).map((part) => Number.parseInt(part, 16)));
}

function isScarfBlue(red, green, blue, alpha, x, y, width, height) {
  if (alpha === 0) return false;
  const insideScarfRegion = x >= width * 0.28 && x <= width * 0.84 && y >= height * 0.35 && y <= height * 0.68;
  if (!insideScarfRegion) return false;
  const [hue, saturation] = rgbToHsl(red, green, blue);
  return hue >= 195 && hue <= 250 && saturation >= 0.22 && blue >= 90 && blue > red * 1.08 && blue > green * 1.03;
}

async function loadRgba(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

for (const outputTheme of Object.keys(THEMES)) await mkdir(path.join(ROOT, outputTheme, "walk"), { recursive: true });

const results = [];
for (const frameName of FRAME_NAMES) {
  const sourcePath = path.join(ROOT, "day", "walk", frameName);
  const source = await loadRgba(sourcePath);

  for (const [theme, themeConfig] of Object.entries(THEMES)) {
    const output = Buffer.from(source.data);
    const [targetHue, targetSaturation, targetLightness] = hexToHsl(themeConfig.color);
    let changedPixels = 0;

    for (let y = 0; y < source.info.height; y += 1) {
      for (let x = 0; x < source.info.width; x += 1) {
        const offset = (y * source.info.width + x) * 4;
        const red = source.data[offset];
        const green = source.data[offset + 1];
        const blue = source.data[offset + 2];
        const alpha = source.data[offset + 3];
        if (!isScarfBlue(red, green, blue, alpha, x, y, source.info.width, source.info.height)) continue;
        const [, sourceSaturation, sourceLightness] = rgbToHsl(red, green, blue);
        const saturation = Math.min(1, targetSaturation * (sourceSaturation / DAY_SCARF_HSL[1]));
        const lightness = Math.min(1, Math.max(0, targetLightness + sourceLightness - DAY_SCARF_HSL[2] + themeConfig.lightnessBias));
        const [nextRed, nextGreen, nextBlue] = hslToRgb(targetHue, saturation, lightness);
        output[offset] = nextRed;
        output[offset + 1] = nextGreen;
        output[offset + 2] = nextBlue;
        changedPixels += 1;
      }
    }

    const outputPath = path.join(ROOT, theme, "walk", frameName);
    await sharp(output, { raw: source.info }).png().toFile(outputPath);
    const generated = await loadRgba(outputPath);
    let alphaDifferences = 0;
    let unexpectedRgbDifferences = 0;
    let preservedBluePixels = 0;

    for (let y = 0; y < source.info.height; y += 1) {
      for (let x = 0; x < source.info.width; x += 1) {
        const offset = (y * source.info.width + x) * 4;
        const masked = isScarfBlue(source.data[offset], source.data[offset + 1], source.data[offset + 2], source.data[offset + 3], x, y, source.info.width, source.info.height);
        if (source.data[offset + 3] !== generated.data[offset + 3]) alphaDifferences += 1;
        const rgbChanged = source.data[offset] !== generated.data[offset] || source.data[offset + 1] !== generated.data[offset + 1] || source.data[offset + 2] !== generated.data[offset + 2];
        if (rgbChanged && !masked) unexpectedRgbDifferences += 1;
        const [hue, saturation] = rgbToHsl(source.data[offset], source.data[offset + 1], source.data[offset + 2]);
        if (!masked && source.data[offset + 3] > 0 && hue >= 195 && hue <= 250 && saturation >= 0.22) {
          preservedBluePixels += 1;
          if (rgbChanged) unexpectedRgbDifferences += 1;
        }
      }
    }

    if (generated.info.width !== source.info.width || generated.info.height !== source.info.height || alphaDifferences || unexpectedRgbDifferences || changedPixels === 0 || preservedBluePixels === 0) {
      throw new Error(`Validation failed for ${theme}/${frameName}`);
    }
    results.push({ theme, frameName, dimensions: `${source.info.width}x${source.info.height}`, changedPixels, alphaDifferences, unexpectedRgbDifferences, preservedBluePixels });
  }
}

console.table(results);
