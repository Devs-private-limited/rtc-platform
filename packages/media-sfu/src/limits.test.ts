import test from "node:test";
import assert from "node:assert/strict";
import { SfuManager, CameraLimitError, cameraBitrate, cameraLimitReached, MAX_CAMERAS } from "./sfu.js";

test("camera bitrate gets smaller as more cameras are on", () => {
  assert.equal(cameraBitrate(2), 1_000_000);
  assert.equal(cameraBitrate(4), 600_000);
  assert.equal(cameraBitrate(8), 350_000);
  assert.equal(cameraLimitReached(["a", "b"], "c", 2), true);
  assert.equal(cameraLimitReached(["a", "b"], "a", 2), false, "replacing your own camera is fine");
});

const vp8 = (ssrc: number) => ({
  mid: String(ssrc),
  codecs: [{ mimeType: "video/VP8", payloadType: 101, clockRate: 90000, rtcpFeedback: [] }],
  headerExtensions: [],
  encodings: [{ ssrc }],
  rtcp: { cname: `c${ssrc}`, reducedSize: true },
});

test("a real media room allows 8 cameras, refuses the 9th, and frees a place when one stops", async (t) => {
  const sfu = new SfuManager("127.0.0.1");
  try { await sfu.start(); } catch (err) { t.skip(`mediasoup worker not available here: ${err}`); return; }
  t.after(() => sfu.stop());
  const calls: number[] = [];
  const cams: { peer: string; id: string }[] = [];
  for (let i = 1; i <= MAX_CAMERAS + 1; i++) {
    const peer = `user${i}`;
    const transport = await sfu.createTransport("room-1", peer);
    const original = transport.setMaxIncomingBitrate.bind(transport);
    transport.setMaxIncomingBitrate = async (b: number) => { calls.push(b); return original(b); };
    if (i <= MAX_CAMERAS) {
      const p = await sfu.produce("room-1", peer, transport.id, "video", vp8(1000 + i) as never, "camera");
      cams.push({ peer, id: p.id });
    } else {
      await assert.rejects(sfu.produce("room-1", peer, transport.id, "video", vp8(1000 + i) as never, "camera"), CameraLimitError);
      // Screen share is not a camera: still allowed.
      await sfu.produce("room-1", peer, transport.id, "video", vp8(5000) as never, "screen");
      assert.ok(sfu.closeProducer("room-1", cams[0].peer, cams[0].id));
      await sfu.produce("room-1", peer, transport.id, "video", vp8(2000 + i) as never, "camera");
    }
  }
  assert.ok(calls.includes(1_100_000), "two cameras: 1:1 quality");
  assert.ok(calls.includes(450_000), "eight cameras: small tiles");
  assert.ok(calls.includes(450_000 + 1_200_000), "screen sharer gets extra room");
  const room = sfu.getRoom("room-1")!;
  assert.equal(sfu.cameraPeers(room).length, MAX_CAMERAS);
  // Someone leaves: their media goes and the count drops.
  const leaver = room.peers.get("user2")!;
  sfu.dropTransport("room-1", "user2", [...leaver.transports.keys()][0]);
  assert.equal(room.peers.has("user2"), false);
  assert.equal(sfu.cameraPeers(room).length, MAX_CAMERAS - 1);
});
