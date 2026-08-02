import { describe, expect, it } from "vitest";
import { float32ToWavBlob } from "@/lib/audio/float32ToWav";

describe("float32ToWavBlob", () => {
  it("encodes 16 kHz mono PCM with clipped signed samples", async () => {
    const blob = float32ToWavBlob(new Float32Array([-2, -0.5, 0, 0.5, 2]));
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (offset: number, length: number) => Array.from(
      { length },
      (_, index) => String.fromCharCode(view.getUint8(offset + index)),
    ).join("");

    expect(blob.type).toBe("audio/wav");
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(-16_384);
    expect(view.getInt16(50, true)).toBe(16_384);
    expect(view.getInt16(52, true)).toBe(32_767);
  });
});
