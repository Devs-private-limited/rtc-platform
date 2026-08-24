import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { SfuManager } from "./sfu.js";

const PORT = Number(process.env.PORT || 4100);
const sfu = new SfuManager();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, service: "rtc-media-sfu" }));

app.post<{ Params: { roomId: string }; Body: { peerId?: string } }>(
  "/v1/rooms/:roomId/join",
  async (req, reply) => {
    const peerId = req.body?.peerId?.trim();
    if (!peerId) return reply.status(400).send({ error: "peerId is required" });

    const room = await sfu.getOrCreateRoom(req.params.roomId);
    return {
      roomId: req.params.roomId,
      peerId,
      rtpCapabilities: room.router.rtpCapabilities,
    };
  }
);

app.post<{
  Params: { roomId: string };
  Body: { peerId?: string };
}>("/v1/rooms/:roomId/transports", async (req, reply) => {
  const peerId = req.body?.peerId?.trim();
  if (!peerId) return reply.status(400).send({ error: "peerId is required" });

  const transport = await sfu.createTransport(req.params.roomId, peerId);
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
});

app.post<{
  Params: { roomId: string; transportId: string };
  Body: { peerId?: string; dtlsParameters?: unknown };
}>("/v1/rooms/:roomId/transports/:transportId/connect", async (req, reply) => {
  const peerId = req.body?.peerId?.trim();
  if (!peerId || !req.body?.dtlsParameters) {
    return reply.status(400).send({ error: "peerId and dtlsParameters are required" });
  }
  const transport = sfu.getTransport(req.params.roomId, peerId, req.params.transportId);
  if (!transport) return reply.status(404).send({ error: "Transport not found" });
  await transport.connect({ dtlsParameters: req.body.dtlsParameters as never });
  return { connected: true };
});

app.post<{
  Params: { roomId: string; transportId: string };
  Body: { peerId?: string; kind?: string; rtpParameters?: unknown };
}>("/v1/rooms/:roomId/transports/:transportId/produce", async (req, reply) => {
  const peerId = req.body?.peerId?.trim();
  const kind = req.body?.kind;
  if (!peerId || kind !== "audio" || !req.body?.rtpParameters) {
    return reply.status(400).send({ error: "peerId, kind=audio, rtpParameters required" });
  }
  const producer = await sfu.produce(
    req.params.roomId,
    peerId,
    req.params.transportId,
    "audio",
    req.body.rtpParameters as never
  );
  return { producerId: producer.id };
});

app.get<{ Params: { roomId: string }; Querystring: { peerId?: string } }>(
  "/v1/rooms/:roomId/producers",
  async (req) => ({
    producers: sfu.listProducers(req.params.roomId, req.query.peerId),
  })
);

app.post<{
  Params: { roomId: string; transportId: string };
  Body: {
    peerId?: string;
    producerId?: string;
    rtpCapabilities?: unknown;
  };
}>("/v1/rooms/:roomId/transports/:transportId/consume", async (req, reply) => {
  const peerId = req.body?.peerId?.trim();
  const producerId = req.body?.producerId?.trim();
  if (!peerId || !producerId || !req.body?.rtpCapabilities) {
    return reply.status(400).send({ error: "peerId, producerId, rtpCapabilities required" });
  }
  const consumer = await sfu.consume(
    req.params.roomId,
    peerId,
    req.params.transportId,
    producerId,
    req.body.rtpCapabilities as never
  );
  return {
    consumerId: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
});

await sfu.start();
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`RTC media SFU on http://localhost:${PORT}`);
