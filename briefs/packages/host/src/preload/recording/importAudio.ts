import type { LanaBridge, RecordingStart, Result } from "../../shared/api.js";
import { AacEncoder, AAC_RATE } from "./aacEncoder.js";

/** Audio files "Import a recording" takes. */
export const IMPORT_ACCEPT = ".m4a,.mp3,.wav,.caf,.aac,audio/mp4,audio/mpeg,audio/wav,audio/x-caf,audio/aac";
const TRANSCRIPTION_RATE = 16_000;
/** Sent to main a second at a time. */
const STEP_SECONDS = 1;

/** One mono track from every channel of the decoded file. */
export function monoOf(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const length = Math.min(...channels.map((channel) => channel.length));
  const out = new Float32Array(length);
  for (const channel of channels) for (let index = 0; index < length; index += 1) out[index]! += channel[index]! / channels.length;
  return out;
}

/**
 * "Import a recording": decodes the picked file's bytes (the page reads the file) in the window (Web Audio reads m4a, mp3,
 * wav and caf), re-encodes it as the phone's AAC for storage, and sends it to main like a
 * recording, with no meeting audio channel (a file has one mixed track, so the speakers are
 * told apart by voice alone). Main stores and transcribes it as it does after Stop. The file
 * is read in memory only; nothing is written here.
 */
export async function importRecording(bridge: Pick<LanaBridge, "recording" | "sendRecordingFrame">, bytes: ArrayBuffer, request: RecordingStart): Promise<Result<null>> {
  const opened = await bridge.recording.beginImport(request);
  if (!opened.ok) return opened;
  let full: Float32Array;
  let low: Float32Array;
  try {
    const decoder = new OfflineAudioContext(1, 1, AAC_RATE);
    const decoded = await decoder.decodeAudioData(bytes);
    full = monoOf(Array.from({ length: decoded.numberOfChannels }, (_unused, index) => decoded.getChannelData(index)));
    const resampler = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * TRANSCRIPTION_RATE)), TRANSCRIPTION_RATE);
    const source = resampler.createBufferSource();
    source.buffer = decoded;
    source.connect(resampler.destination);
    source.start();
    low = (await resampler.startRendering()).getChannelData(0);
    if (!(await AacEncoder.isSupported())) throw new Error("aac");
  } catch {
    await bridge.recording.cancelImport("unreadable");
    return { ok: false, error: { code: "unreadable", message: "LANA could not read that file. Pick an audio recording: m4a, mp3, wav or caf." } };
  }
  const encoder = new AacEncoder();
  const steps = Math.ceil(low.length / (TRANSCRIPTION_RATE * STEP_SECONDS));
  for (let step = 0; step < steps; step += 1) {
    const lowStart = step * TRANSCRIPTION_RATE * STEP_SECONDS;
    const fullStart = step * AAC_RATE * STEP_SECONDS;
    encoder.encode(full.subarray(fullStart, Math.min(full.length, fullStart + AAC_RATE * STEP_SECONDS)).slice());
    const mic = low.slice(lowStart, lowStart + TRANSCRIPTION_RATE * STEP_SECONDS);
    bridge.sendRecordingFrame({ mic, system: new Float32Array(mic.length), ...encoder.take() });
    if (step % 30 === 0) {
      void bridge.recording.importProgress(step / steps);
      // Lets the encoder hand back frames and keeps the window responsive.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  await encoder.flush();
  const rest = encoder.take();
  encoder.close();
  if (rest.aac.length > 0 || rest.config !== undefined) bridge.sendRecordingFrame({ mic: new Float32Array(0), system: new Float32Array(0), ...rest });
  if (encoder.failed) {
    await bridge.recording.cancelImport("unreadable");
    return { ok: false, error: { code: "unreadable", message: "LANA could not convert that file. Try another recording." } };
  }
  await bridge.recording.finishImport();
  return { ok: true, value: null };
}
