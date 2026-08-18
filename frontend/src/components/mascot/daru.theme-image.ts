import type { DaruRhythm } from "./types";

const themedImageCache = new Map<string, Promise<string>>();

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum) return [0, 0, lightness] as const;
  const delta = maximum - minimum;
  const saturation = lightness > 0.5
    ? delta / (2 - maximum - minimum)
    : delta / (maximum + minimum);
  let hue: number;
  if (maximum === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (maximum === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [(hue / 6) * 360, saturation, lightness] as const;
}

function isPreGeneratedThemeSprite(src: string, theme: DaruRhythm) {
  return src.startsWith(`/mascot/sprites/${theme}/`);
}

function isScarfBlue(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (alpha === 0) return false;
  const insideScarfRegion = x >= width * 0.28
    && x <= width * 0.84
    && y >= height * 0.35
    && y <= height * 0.68;
  if (!insideScarfRegion) return false;
  const [hue, saturation] = rgbToHsl(red, green, blue);
  return hue >= 195
    && hue <= 250
    && saturation >= 0.22
    && blue >= 90
    && blue > red * 1.08
    && blue > green * 1.03;
}

function waitForImage(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error(`Failed to load ${image.src}`)), { once: true });
  });
}

export async function loadThemedDaruImageSrc(src: string, theme: DaruRhythm) {
  if (theme !== "night" || isPreGeneratedThemeSprite(src, theme)) return src;
  const key = `${theme}:${src}`;
  const cached = themedImageCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const image = new Image();
    image.src = src;
    await waitForImage(image);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return src;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = pixels;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        if (!isScarfBlue(red, green, blue, data[offset + 3], x, y, canvas.width, canvas.height)) continue;
        data[offset] = Math.min(255, Math.round(blue * 0.68));
        data[offset + 1] = Math.round(green * 0.55);
      }
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  })();
  themedImageCache.set(key, promise);
  return promise;
}
