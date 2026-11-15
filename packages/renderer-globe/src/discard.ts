import type { TileDiscardPolicy } from "cesium";

/**
 * Discards fully transparent tiles (e.g. GIBS "no data" PNGs bundled above a layer's real
 * coverage) so Cesium falls back to the nearest ancestor tile instead of punching a hole in the
 * layer. Check = draw into an 8×8 canvas and test alpha; ≈0.1 ms per tile, bundled tiles only.
 */
export function createTransparentTileDiscardPolicy(doc: Document): TileDiscardPolicy {
  const canvas = doc.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const policy: Pick<TileDiscardPolicy, "isReady" | "shouldDiscardImage"> = {
    isReady: () => true,
    shouldDiscardImage: (image: HTMLImageElement): boolean => {
      if (!ctx) return false;
      try {
        ctx.clearRect(0, 0, 8, 8);
        ctx.drawImage(image as CanvasImageSource, 0, 0, 8, 8);
        const d = ctx.getImageData(0, 0, 8, 8).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
        return true;
      } catch {
        return false;
      }
    },
  };
  return policy as TileDiscardPolicy;
}
