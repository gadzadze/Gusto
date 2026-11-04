import { describe, expect, it } from "vitest";
import { alphaBounds, logitsToAlpha, maskCoverage, placeInSquare, rgbaToModelInput } from "@/lib/image/background-removal/math";

describe("background removal maths", () => {
  it("normalises RGBA into planar CHW with the ImageNet mean and std", () => {
    const size = 2;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255); // white, opaque
    const out = rgbaToModelInput(rgba, size);
    expect(out).toHaveLength(3 * size * size);
    expect(out[0]).toBeCloseTo((1 - 0.485) / 0.229, 5); // R plane first
    expect(out[size * size]).toBeCloseTo((1 - 0.456) / 0.224, 5); // then G
    expect(out[2 * size * size]).toBeCloseTo((1 - 0.406) / 0.225, 5); // then B
  });

  it("turns logits into alpha with a sigmoid", () => {
    const alpha = logitsToAlpha([-20, 0, 20]);
    expect(Array.from(alpha)).toEqual([0, 128, 255]);
  });

  it("finds the bounding box of the subject, or null for an empty mask", () => {
    const w = 5;
    const h = 4;
    const alpha = new Uint8Array(w * h);
    alpha[1 * w + 2] = 255;
    alpha[2 * w + 3] = 255;
    expect(alphaBounds(alpha, w, h)).toEqual({ x: 2, y: 1, width: 2, height: 2 });
    expect(alphaBounds(new Uint8Array(w * h), w, h)).toBeNull();
  });

  it("centres a subject in a square with a margin and caps upscaling", () => {
    expect(placeInSquare({ width: 400, height: 200 }, 1000)).toEqual({ x: 80, y: 290, width: 840, height: 420 });
    // A tiny subject is not blown up past 3x.
    const tiny = placeInSquare({ width: 10, height: 10 }, 1000);
    expect(tiny.width).toBe(30);
    expect(tiny.x).toBe(485);
  });

  it("reports how much of the picture the mask kept", () => {
    expect(maskCoverage(new Uint8Array([255, 255, 0, 0]))).toBe(0.5);
    expect(maskCoverage(new Uint8Array(0))).toBe(0);
  });
});
