/** The phone's format: AAC LC, 48 kHz mono, 64 kbps. */
export const AAC_RATE = 48_000;
const AAC_BITRATE = 64_000;

/**
 * WebCodecs' AAC encoder for the mixed track. Frames come out in order; `take` hands over
 * what is ready (and the decoder config once, with the first frames).
 */
export class AacEncoder {
  private readonly encoder: AudioEncoder;
  private ready: Uint8Array[] = [];
  private config: Uint8Array | null = null;
  private configSent = false;
  private samples = 0;
  failed = false;

  constructor() {
    this.encoder = new AudioEncoder({
      output: (chunk, metadata) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.ready.push(bytes);
        const description = metadata?.decoderConfig?.description;
        if (this.config === null && description !== undefined) {
          this.config = description instanceof ArrayBuffer ? new Uint8Array(description.slice(0)) : new Uint8Array((description as ArrayBufferView).buffer.slice(0));
        }
      },
      error: () => {
        this.failed = true;
      },
    });
    this.encoder.configure({ codec: "mp4a.40.2", sampleRate: AAC_RATE, numberOfChannels: 1, bitrate: AAC_BITRATE });
  }

  static async isSupported(): Promise<boolean> {
    if (typeof AudioEncoder === "undefined") return false;
    try {
      return (await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: AAC_RATE, numberOfChannels: 1, bitrate: AAC_BITRATE })).supported === true;
    } catch {
      return false;
    }
  }

  encode(samples: Float32Array<ArrayBuffer>): void {
    if (this.failed || samples.length === 0) return;
    const data = new AudioData({ format: "f32-planar", sampleRate: AAC_RATE, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: Math.round((this.samples / AAC_RATE) * 1_000_000), data: samples });
    this.samples += samples.length;
    this.encoder.encode(data);
    data.close();
  }

  /** Frames ready so far, and the decoder config the first time it is known. */
  take(): { aac: Uint8Array[]; config?: Uint8Array } {
    const aac = this.ready;
    this.ready = [];
    if (!this.configSent && this.config !== null) {
      this.configSent = true;
      return { aac, config: this.config };
    }
    return { aac };
  }

  async flush(): Promise<void> {
    if (this.failed || this.encoder.state !== "configured") return;
    try {
      await this.encoder.flush();
    } catch {
      this.failed = true;
    }
  }

  close(): void {
    if (this.encoder.state !== "closed") this.encoder.close();
  }
}
