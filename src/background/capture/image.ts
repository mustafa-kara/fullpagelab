import type { ScrollPlan, ScrollStep } from '../../shared/types/capture';
import type { Point } from '../../shared/types/primitives';

export function dataUrlToBlob(dataUrl: string): Blob {
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Capture returned an invalid data URL.');
  const header = dataUrl.slice(0, separator);
  const payload = dataUrl.slice(separator + 1);
  const mime = /^data:([^;,]+)/i.exec(header)?.[1] ?? 'application/octet-stream';
  if (!/;base64/i.test(header)) return new Blob([decodeURIComponent(payload)], { type: mime });
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export interface CaptureTile {
  dataUrl: string;
  actual: Point;
  step: ScrollStep;
}

export async function stitchVerticalTiles(tiles: CaptureTile[], plan: ScrollPlan): Promise<Blob> {
  if (tiles.length === 0) throw new Error('No capture tiles were produced.');
  const firstBitmap = await createImageBitmap(dataUrlToBlob(tiles[0]?.dataUrl ?? ''));
  const sourceScaleX = firstBitmap.width / Math.max(1, plan.viewport.width * plan.dpr);
  const sourceScaleY = firstBitmap.height / Math.max(1, plan.viewport.height * plan.dpr);
  const outputWidth = Math.max(1, Math.round(plan.content.width * plan.dpr));
  const outputHeight = Math.max(1, Math.round(plan.content.height * plan.dpr));
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    firstBitmap.close();
    throw new Error('Canvas rendering context is unavailable.');
  }

  for (const [index, tile] of tiles.entries()) {
    const bitmap = index === 0 ? firstBitmap : await createImageBitmap(dataUrlToBlob(tile.dataUrl));
    const crop = tile.step.cropFromViewport;
    const sourceX = Math.round(crop.x * sourceScaleX);
    const sourceY = Math.round(crop.y * sourceScaleY);
    const sourceWidth = Math.max(1, Math.min(bitmap.width - sourceX, Math.round(crop.width * sourceScaleX)));
    const sourceHeight = Math.max(1, Math.min(bitmap.height - sourceY, Math.round(crop.height * sourceScaleY)));
    const destinationX = Math.round(tile.step.placeAt.x);
    const destinationY = Math.round(tile.step.placeAt.y);
    const destinationWidth = Math.round(crop.width);
    const destinationHeight = Math.round(crop.height);
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, destinationWidth, destinationHeight);
    if (index !== 0) bitmap.close();
  }

  return canvas.convertToBlob({ type: 'image/png' });
}
