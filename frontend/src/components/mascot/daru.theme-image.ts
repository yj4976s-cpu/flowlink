import type { DaruRhythm } from "./types";

const themedImageCache = new Map<string, Promise<string>>();

function waitForImage(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error(`Failed to load ${image.src}`)), { once: true });
  });
}

export async function loadThemedDaruImageSrc(src: string, theme: DaruRhythm) {
  if (theme !== "night") return src;
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
    for (let offset = 0; offset < data.length; offset += 4) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const scarfBlue = data[offset + 3] > 0 && blue > 105 && blue > red * 1.12 && blue > green * 1.08 && green < red * 1.4;
      if (scarfBlue) {
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
