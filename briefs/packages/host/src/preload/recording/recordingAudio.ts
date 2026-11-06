import type { LanaBridge, RecordingAudioCommand } from "../../shared/api.js";
import { AacEncoder, AAC_RATE } from "./aacEncoder.js";
import { Downsampler, meterLevel, mix } from "./mixer.js";

/** Samples per capture callback at 48 kHz (about 85 ms). */
const CAPTURE_BUFFER = 4096;

export interface RecordingLevels {
  mic: number;
  meeting: number;
}

interface Capture {
  context: AudioContext;
  streams: MediaStream[];
  processor: ScriptProcessorNode;
  encoder: AacEncoder;
  paused: boolean;
}

/**
 * The capture window's side of recording a meeting (the Briefs host opens a hidden client
 * window while a recording is live, so capture outlives page changes in the client): opens the microphone and the meeting audio
 * (display-media loopback; the screen's video track is stopped at once), mixes them in one
 * Web Audio graph at 48 kHz, AAC encodes the mix, and sends main the AAC frames plus 16 kHz
 * copies of each side for transcription. Nothing is kept or logged here.
 */
export function startRecordingAudio(bridge: Pick<LanaBridge, "onEvent" | "recording" | "sendRecordingFrame">, publishLevels: (levels: RecordingLevels) => void): () => void {
  let capture: Capture | null = null;
  let generation = 0;

  const stopTracks = (streams: readonly MediaStream[]): void => {
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
  };

  let opening = false;
  const start = async (): Promise<void> => {
    // The start command and the state check can both ask; capture opens once.
    if (opening || capture !== null) return;
    opening = true;
    try {
      await open();
    } finally {
      opening = false;
    }
  };

  const open = async (): Promise<void> => {
    const mine = ++generation;
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    } catch (error) {
      const denied = error instanceof Error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      void bridge.recording.captureFailed(denied ? "denied" : "unavailable");
      return;
    }
    let meeting: MediaStream | null = null;
    try {
      meeting = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      for (const track of meeting.getVideoTracks()) track.stop();
      if (meeting.getAudioTracks().length === 0) {
        stopTracks([meeting]);
        meeting = null;
      }
    } catch {
      meeting = null;
    }
    if (mine !== generation) {
      stopTracks(meeting === null ? [mic] : [mic, meeting]);
      return;
    }
    try {
      if (!(await AacEncoder.isSupported())) throw new Error("aac");
      const context = new AudioContext({ sampleRate: AAC_RATE, latencyHint: "interactive" });
      const merger = context.createChannelMerger(2);
      context.createMediaStreamSource(mic).connect(merger, 0, 0);
      if (meeting !== null) context.createMediaStreamSource(new MediaStream(meeting.getAudioTracks())).connect(merger, 0, 1);
      const processor = context.createScriptProcessor(CAPTURE_BUFFER, 2, 1);
      const encoder = new AacEncoder();
      const micDown = new Downsampler(context.sampleRate);
      const meetingDown = new Downsampler(context.sampleRate);
      const hasMeeting = meeting !== null;
      const current: Capture = { context, streams: meeting === null ? [mic] : [mic, meeting], processor, encoder, paused: false };
      processor.onaudioprocess = (event) => {
        const micSamples = event.inputBuffer.getChannelData(0);
        const meetingSamples = hasMeeting ? event.inputBuffer.getChannelData(1) : null;
        publishLevels({ mic: current.paused ? 0 : meterLevel(micSamples), meeting: current.paused || meetingSamples === null ? 0 : meterLevel(meetingSamples) });
        if (current.paused) return;
        encoder.encode(mix(micSamples, meetingSamples));
        const mic16 = micDown.push(micSamples);
        const meeting16 = meetingSamples === null ? new Float32Array(mic16.length) : meetingDown.push(meetingSamples);
        const length = Math.min(mic16.length, meeting16.length);
        bridge.sendRecordingFrame({ mic: mic16.subarray(0, length).slice(), system: meeting16.subarray(0, length).slice(), ...encoder.take() });
      };
      merger.connect(processor);
      // The processor only runs while connected; it writes silence.
      processor.connect(context.destination);
      if (context.state === "suspended") await context.resume();
      capture = current;
      void bridge.recording.captureStarted(hasMeeting);
    } catch {
      stopTracks(meeting === null ? [mic] : [mic, meeting]);
      void bridge.recording.captureFailed("unavailable");
    }
  };

  const stop = async (): Promise<void> => {
    generation += 1;
    const current = capture;
    capture = null;
    if (current === null) {
      void bridge.recording.captureStopped();
      return;
    }
    current.processor.onaudioprocess = null;
    current.processor.disconnect();
    stopTracks(current.streams);
    await current.encoder.flush();
    const rest = current.encoder.take();
    if (rest.aac.length > 0) bridge.sendRecordingFrame({ mic: new Float32Array(0), system: new Float32Array(0), ...rest });
    current.encoder.close();
    void current.context.close().catch(() => undefined);
    publishLevels({ mic: 0, meeting: 0 });
    void bridge.recording.captureStopped();
  };

  const handle = (command: RecordingAudioCommand): void => {
    switch (command.kind) {
      case "start":
        void start();
        return;
      case "pause":
        if (capture !== null) capture.paused = true;
        return;
      case "resume":
        if (capture !== null) capture.paused = false;
        return;
      case "stop":
        void stop();
        return;
    }
  };

  const unsubscribe = bridge.onEvent((event) => {
    if (event.type === "recordingAudio") handle(event.command);
  });
  // The window opens when a recording starts, after the start command went out: pick it up.
  void bridge.recording.state().then(
    (view) => {
      if (view.phase === "starting" && capture === null) void start();
    },
    () => undefined,
  );
  return () => {
    unsubscribe();
    void stop();
  };
}
