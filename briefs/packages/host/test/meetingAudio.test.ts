import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { MeetingAudioService, parseRange } from "../src/main/services/meetingAudio.js";
import { openRealRig, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";

let rig: RealRig;
beforeEach(async () => {
  rig = await openRealRig();
});
afterEach(() => rig.cleanup());

describe("MeetingAudioService (replay audio decrypted in main)", () => {
  it("grants one URL per stored part and serves the decrypted audio with byte ranges", async () => {
    const opened = await receiveGoldenMeeting(rig);
    const audio = new MeetingAudioService(rig.store, rig.log);
    const granted = await audio.audio(opened.meeting.id);
    if (!granted.ok) throw new Error("no grant");
    expect(granted.value.parts).toHaveLength(opened.audio.length);
    const first = granted.value.parts[0]?.url ?? "";
    expect(first).toMatch(/^lana-audio:\/\/meeting\/[0-9a-f]{48}\/0$/);

    const whole = await audio.handle(first, null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Content-Type")).toBe("audio/mp4");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(opened.audio[0]?.data);

    const ranged = await audio.handle(first, "bytes=10-19");
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("Content-Range")).toBe(`bytes 10-19/${opened.audio[0]?.data.length}`);
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(opened.audio[0]?.data.slice(10, 20));
    expect((await audio.handle(first, "bytes=999999-")).status).toBe(416);
  });

  it("refuses unknown grants, other hosts, missing parts and everything after sign-out", async () => {
    const opened = await receiveGoldenMeeting(rig);
    const audio = new MeetingAudioService(rig.store, rig.log);
    const granted = await audio.audio(opened.meeting.id);
    const url = granted.ok ? (granted.value.parts[0]?.url ?? "") : "";
    expect((await audio.handle(url.replace(/[0-9a-f]{48}/, "0".repeat(48)), null)).status).toBe(403);
    expect((await audio.handle(url.replace("://meeting/", "://other/"), null)).status).toBe(403);
    expect((await audio.handle(url.replace(/\/0$/, "/9"), null)).status).toBe(404);
    audio.revokeAll();
    expect((await audio.handle(url, null)).status).toBe(403);
  });

  it("expires grants and says noAudio once retention removed the audio", async () => {
    const opened = await receiveGoldenMeeting(rig);
    let now = 0;
    const audio = new MeetingAudioService(rig.store, rig.log, () => now);
    const granted = await audio.audio(opened.meeting.id);
    now = 7 * 3_600_000;
    expect((await audio.handle(granted.ok ? (granted.value.parts[0]?.url ?? "") : "", null)).status).toBe(403);
    rig.clock.advance(2 * 86_400);
    rig.store.meetings.purgeAudio(1);
    expect(await audio.audio(opened.meeting.id)).toMatchObject({ ok: false, error: { code: "noAudio" } });
    expect(await audio.audio("nonsense")).toMatchObject({ ok: false, error: { code: "noAudio" } });
  });

  it("parses byte ranges", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
  });
});
