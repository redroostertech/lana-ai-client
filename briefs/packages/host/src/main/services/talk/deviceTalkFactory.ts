import type { MeetingAskService } from "@lana/core/ask";
import { AskEngineAnswerer, KokoroSpeaker, SherpaListener, speechModelPaths, type TalkSpeaker } from "@lana/core/talk";
import type { AskScope, TalkDownloads, VoiceOption } from "../../../shared/api.js";
import type { MainLog } from "../../log.js";
import { coreScope } from "../ask/askService.js";
import type { ModelService } from "../models/modelService.js";
import type { RendererAudio } from "./rendererAudio.js";
import type { TalkParts, TalkPartsFactory } from "./talkService.js";

const SILENT_SPEAKER: TalkSpeaker = { speak: async () => undefined, stop: async () => undefined };

export interface DeviceTalkFactoryOptions {
  readonly models: ModelService;
  readonly audio: RendererAudio;
  readonly asking: MeetingAskService;
  /** The OS microphone permission (macOS asks once; Windows reports the privacy switch). */
  readonly requestMicrophone: () => Promise<boolean>;
  readonly log: MainLog;
}

/**
 * Talk on this computer (Swift `DeviceTalkSessionFactory`): the window's microphone with
 * echo cancellation, LANA listening (voice detection and speech to text), the LANA voice or
 * none when the voice is off, and `AskEngine` over the same passages Ask searches. Nothing leaves the
 * computer. When memory is tight the LANA model is unloaded before the speech models load.
 */
export class DeviceTalkFactory implements TalkPartsFactory {
  constructor(private readonly options: DeviceTalkFactoryOptions) {}

  requestMicrophone(): Promise<boolean> {
    return this.options.requestMicrophone();
  }

  listenerReady(): boolean {
    return this.options.models.isReady("listener");
  }

  prepareListener(progress: (fraction: number) => void): Promise<void> {
    return this.options.models.ensure("listener", progress);
  }

  voiceReady(): boolean {
    return this.options.models.isReady("voice");
  }

  prepareVoice(progress: (fraction: number) => void): Promise<void> {
    return this.options.models.ensure("voice", progress);
  }

  downloadSizeText(needs: TalkDownloads): string {
    return this.options.models.downloadSizeText([...(needs.listener ? (["listener"] as const) : []), ...(needs.voice ? (["voice"] as const) : [])]);
  }

  async makeParts(scope: AskScope, voice: VoiceOption): Promise<TalkParts> {
    const { models, audio, asking, log } = this.options;
    const paths = speechModelPaths(models.speech.directory);
    const listener = new SherpaListener({ vadModel: paths.vad, parakeet: paths.parakeet, input: audio.input(), log });
    await listener.prepare();
    // Voice off: nothing is spoken, so the answer shows as text in Talk.
    let speaker: TalkSpeaker = SILENT_SPEAKER;
    if (voice === "lana") {
      const kokoro = new KokoroSpeaker({ directory: paths.kokoro, output: audio.output() });
      await kokoro.prepare();
      speaker = kokoro;
    }
    const engine = await asking.engine(coreScope(scope));
    return {
      listener,
      speaker,
      answerer: new AskEngineAnswerer(engine),
      setMicrophoneMuted: (muted) => audio.setMuted(muted),
      onLevel: (listener) => audio.onLevel(listener),
      // The recognizer and voice are dropped with these references; the next talk loads them again.
      release: () => audio.onLevel(null),
    };
  }
}
