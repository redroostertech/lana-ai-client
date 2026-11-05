/** Enough speech to count (tell the conversation the person is talking), or the turn is over. */
export type EndpointSignal = "turnStarted" | "turnEnded";

/**
 * Decides when the person has finished a turn, from voice-activity edges (Swift
 * `Endpointing`). A turn ends after `silence` seconds of quiet following at least
 * `minimumSpeech` seconds of speech. Short blips never start a turn, and resuming speech
 * within the silence window continues the same turn.
 */
export class Endpointing {
  silence = 0.7;
  minimumSpeech = 0.25;
  private speechStartedAt: number | undefined;
  private speechAccumulated = 0;
  private quietSince: number | undefined;
  private announced = false;

  /** True while a possible turn is being followed (speech heard and not yet forgotten or ended). */
  get isTracking(): boolean {
    return this.speechStartedAt !== undefined || this.quietSince !== undefined;
  }

  /** Voice detection heard speech begin at `time` (seconds since listening started). */
  speechStarted(time: number): void {
    this.speechStartedAt = time;
    this.quietSince = undefined;
  }

  /** Voice detection heard speech end at `time`. */
  speechEnded(time: number): EndpointSignal | undefined {
    if (this.speechStartedAt !== undefined) this.speechAccumulated += Math.max(0, time - this.speechStartedAt);
    this.speechStartedAt = undefined;
    this.quietSince = time;
    if (this.announced || this.speechAccumulated < this.minimumSpeech) return undefined;
    this.announced = true;
    return "turnStarted";
  }

  /** Called regularly (each audio chunk) so endings and long utterances are detected on time. */
  tick(time: number): EndpointSignal | undefined {
    if (this.speechStartedAt !== undefined && !this.announced && this.speechAccumulated + (time - this.speechStartedAt) >= this.minimumSpeech) {
      this.announced = true;
      return "turnStarted";
    }
    if (this.announced && this.quietSince !== undefined && time - this.quietSince >= this.silence) {
      this.reset();
      return "turnEnded";
    }
    if (!this.announced && this.speechStartedAt === undefined && this.quietSince !== undefined && time - this.quietSince >= this.silence) {
      // Too short to be a turn: forget it.
      this.reset();
    }
    return undefined;
  }

  private reset(): void {
    this.speechStartedAt = undefined;
    this.speechAccumulated = 0;
    this.quietSince = undefined;
    this.announced = false;
  }
}
