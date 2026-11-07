import type { TalkHearing, TalkListener } from "@lana/core/talk";

/**
 * Lets the person mute the microphone mid-conversation (Swift `TalkMuteGate`). While muted
 * nothing heard reaches the conversation; muting mid-sentence drops that turn.
 */
export class MuteGate implements TalkListener {
  private muted = false;
  private handler: ((hearing: TalkHearing) => void) | null = null;

  constructor(private readonly inner: TalkListener) {}

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    // An empty turn is too short to count: the conversation goes back to listening.
    if (value) this.handler?.({ kind: "endOfTurn", text: "" });
  }

  start(onHearing: (hearing: TalkHearing) => void): Promise<void> {
    this.handler = onHearing;
    return this.inner.start((hearing) => {
      if (!this.muted) onHearing(hearing);
    });
  }

  async stop(): Promise<void> {
    this.handler = null;
    await this.inner.stop();
  }
}
