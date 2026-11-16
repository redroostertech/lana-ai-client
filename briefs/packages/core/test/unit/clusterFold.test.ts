import { describe, expect, it } from "vitest";
import { foldSmallClusters, SAME_VOICE_SIMILARITY, smallClusterLimit, type SpeakerTurn } from "../../src/recording/diarizationMerge.js";

// Synthetic turns and embeddings only.
const turn = (start: number, end: number, speaker: number): SpeakerTurn => ({ start, end, speaker });

describe("folding small diarizer clusters", () => {
  it("sets the floor at 8 s whatever the meeting length", () => {
    expect(smallClusterLimit([turn(0, 100, 0)])).toBe(8);
    expect(smallClusterLimit([turn(0, 1000, 0)])).toBe(8);
  });

  it("folds a cluster of 8 s or more only into a bigger one with the same voice (similarity at or above the cutoff)", () => {
    // Cluster 2 talks 20 s: a real person who spoke briefly. Cluster 3 talks 20 s and is the same voice as 0.
    const turns = [turn(0, 300, 0), turn(300, 600, 1), turn(600, 620, 2), turn(620, 640, 3)];
    const embeddings = new Map([
      [0, new Float32Array([1, 0, 0])],
      [1, new Float32Array([0, 1, 0])],
      [2, new Float32Array([0.6, 0.6, 0.53])],
      [3, new Float32Array([0.97, 0.05, 0.24])],
    ]);
    expect(foldSmallClusters(turns, (cluster) => embeddings.get(cluster) ?? null).map((item) => item.speaker)).toEqual([0, 1, 2, 0]);
    expect(SAME_VOICE_SIMILARITY).toBeGreaterThan(0.87);
  });

  it("never folds a cluster of 8 s or more without embeddings", () => {
    const turns = [turn(0, 300, 0), turn(300, 320, 1)];
    expect(foldSmallClusters(turns, () => null)).toEqual(turns);
  });

  it("folds a cluster under the limit into the most similar big cluster", () => {
    const turns = [turn(0, 120, 0), turn(120, 240, 1), turn(240, 244, 2), turn(244, 300, 0)];
    const embeddings = new Map([
      [0, new Float32Array([1, 0, 0])],
      [1, new Float32Array([0, 1, 0])],
      [2, new Float32Array([0.1, 0.95, 0.05])],
    ]);
    const folded = foldSmallClusters(turns, (cluster) => embeddings.get(cluster) ?? null);
    expect(folded.map((item) => item.speaker)).toEqual([0, 1, 1, 0]);
  });

  it("folds into the cluster nearest in time when no embedding is known, and keeps big clusters as they are", () => {
    const turns = [turn(0, 120, 0), turn(120, 124, 3), turn(124, 300, 1)];
    expect(foldSmallClusters(turns, () => null).map((item) => item.speaker)).toEqual([0, 0, 1]);
    const big = [turn(0, 50, 0), turn(50, 100, 1)];
    expect(foldSmallClusters(big, () => null)).toEqual(big);
  });

  it("keeps everything when every cluster is small (a very short recording)", () => {
    const turns = [turn(0, 3, 0), turn(3, 6, 1)];
    expect(foldSmallClusters(turns, () => null)).toEqual(turns);
  });
});

describe("folding, more cases (synthetic)", () => {
  it("does not change its input, sends small clusters to different voices, and keeps sides apart when told to", () => {
    const turns = [turn(0, 100, 0), turn(100, 200, 1), turn(200, 203, 2), turn(203, 206, 3)];
    const copy = turns.map((item) => ({ ...item }));
    const embeddings = new Map([[0, new Float32Array([1, 0])], [1, new Float32Array([0, 1])], [2, new Float32Array([0.9, 0.1])], [3, new Float32Array([0.1, 0.9])]]);
    expect(foldSmallClusters(turns, (cluster) => embeddings.get(cluster) ?? null).map((item) => item.speaker)).toEqual([0, 1, 0, 1]);
    expect(turns).toEqual(copy);
    // Cluster 2 sounds like 0, but 0 is on the other side (mic vs meeting audio): it goes to 1 instead.
    const sides = new Map([[0, "mic"], [1, "system"], [2, "system"], [3, "system"]]);
    expect(foldSmallClusters(turns, (cluster) => embeddings.get(cluster) ?? null, (small, big) => sides.get(small) === sides.get(big)).map((item) => item.speaker)).toEqual([0, 1, 1, 1]);
  });
});

describe("cluster embeddings from the meeting audio (fake extractor)", () => {
  it("uses up to 30 s of a cluster's longest turns, skips clusters under half a second, and survives a failing extractor", async () => {
    const { clusterEmbeddings } = await import("../../src/recording/transcriber.js");
    const seen: number[] = [];
    let fail = false;
    class Extractor {
      createStream() {
        const stream = { length: 0, acceptWaveform: (audio: { samples: Float32Array }) => { stream.length += audio.samples.length; }, inputFinished: () => undefined };
        return stream;
      }
      isReady() { return true; }
      compute(stream: { length: number }) {
        if (fail) throw new Error("native");
        seen.push(stream.length);
        return new Float32Array([stream.length]);
      }
    }
    const sherpa = { SpeakerEmbeddingExtractor: Extractor } as never;
    const models = { vad: "", parakeet: "", segmentation: "", embedding: "e" };
    const mixed = new Float32Array(16_000 * 100);
    const turns = [turn(0, 20, 0), turn(20, 40, 0), turn(40, 40.2, 1), turn(50, 55, 2)];
    const embedding = clusterEmbeddings(sherpa, models, mixed, turns, 1);
    expect(embedding(0)?.[0]).toBe(16_000 * 30);
    expect(embedding(1)).toBeNull();
    fail = true;
    expect(embedding(2)).toBeNull();
    expect(embedding(0)?.[0]).toBe(16_000 * 30);
    expect(seen).toEqual([16_000 * 30]);
  });
});
