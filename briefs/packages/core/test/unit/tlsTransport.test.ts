import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "../../src/crypto/index.js";
import { connectHandoff, encodeFrame, HandoffListener, type Frame, type SocketFrameChannel } from "../../src/handoff/index.js";

const phoneID = "dev_01JCQ8ZZZZZZZZZZZZZZZZZZZZ";
const phoneKey = randomBytes(32);
const pairKey = randomBytes(32);
const listeners: HandoffListener[] = [];

async function listen(): Promise<{ port: number; accepted: Promise<SocketFrameChannel> }> {
  const listener = new HandoffListener({ host: "127.0.0.1", psks: (identity) => (identity === phoneID ? phoneKey : identity === "pair" ? pairKey : undefined) });
  listeners.push(listener);
  let accept: (channel: SocketFrameChannel) => void = () => undefined;
  const accepted = new Promise<SocketFrameChannel>((resolve) => (accept = resolve));
  const port = await listener.start((channel) => accept(channel));
  return { port, accepted };
}

afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.stop()));
});

describe("TLS-PSK transport", () => {
  it("negotiates TLS 1.2 ECDHE-PSK-CHACHA20-POLY1305, agrees on the binding and reports the PSK identity", async () => {
    const { port, accepted } = await listen();
    const client = await connectHandoff({ host: "127.0.0.1", port, identity: phoneID, key: phoneKey });
    const server = await accepted;
    expect(server.peerIdentity).toBe(phoneID);
    expect(client.peerIdentity).toBeUndefined();
    expect(server.channelBinding).toHaveLength(32);
    expect(server.channelBinding).toEqual(client.channelBinding);
    const socket = (server as unknown as { socket: import("node:tls").TLSSocket }).socket;
    expect(socket.getProtocol()).toBe("TLSv1.2");
    expect(socket.getCipher().name).toBe("ECDHE-PSK-CHACHA20-POLY1305");

    const frame: Frame = { message: { type: "part", payload: { bundleID: "bdl_01JCQ8ZZZZZZZZZZZZZZZZZZZZ" as never, index: 2 } }, body: randomBytes(300_000) };
    await client.send(frame);
    const received = await server.receive(2_000);
    expect(encodeFrame(received)).toEqual(encodeFrame(frame));
    await server.send({ message: { type: "done" }, body: new Uint8Array() });
    expect((await client.receive(2_000)).message).toEqual({ type: "done" });
    client.close();
    await expect(server.receive(2_000)).rejects.toMatchObject({ code: "channel_closed" });
  });

  it("gives every connection its own binding", async () => {
    const { port, accepted } = await listen();
    const first = await connectHandoff({ host: "127.0.0.1", port, identity: phoneID, key: phoneKey });
    await accepted;
    const second = await connectHandoff({ host: "127.0.0.1", port, identity: "pair", key: pairKey });
    expect(first.channelBinding).not.toEqual(second.channelBinding);
    first.close();
    second.close();
  });

  it("refuses unknown identities and wrong keys", async () => {
    const { port } = await listen();
    await expect(connectHandoff({ host: "127.0.0.1", port, identity: "dev_unknown", key: phoneKey })).rejects.toMatchObject({ code: "transport" });
    await expect(connectHandoff({ host: "127.0.0.1", port, identity: phoneID, key: randomBytes(32) })).rejects.toMatchObject({ code: "transport" });
  });

  it("times out a receive and still delivers the next frame", async () => {
    const { port, accepted } = await listen();
    const client = await connectHandoff({ host: "127.0.0.1", port, identity: phoneID, key: phoneKey });
    const server = await accepted;
    await expect(server.receive(20)).rejects.toMatchObject({ code: "timed_out" });
    await client.send({ message: { type: "done" }, body: new Uint8Array() });
    expect((await server.receive(2_000)).message.type).toBe("done");
    client.close();
  });
});
