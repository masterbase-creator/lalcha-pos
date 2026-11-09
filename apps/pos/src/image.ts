const MAX_SIDE = 800;

function toBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
}

/** Shrinks a photo on the device, so a 5 MB camera shot uploads as a small file on mobile data. */
export async function prepareProductImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const webp = await toBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;

  // Some browsers, including Safari, can't create WebP. JPEG has no transparency, so fill it white.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jpeg = await toBlob(canvas, "image/jpeg");
  if (!jpeg) throw new Error("could not encode image");
  return jpeg;
}
