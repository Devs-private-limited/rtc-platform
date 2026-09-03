import { spawn, type ChildProcess } from "child_process";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import type { SfuManager } from "./sfu.js";

export interface CdnStreamSession {
  sessionId: string;
  roomId: string;
  streamKey: string;
  startedAt: string;
  producerIds: string[];
  mode: "webrtc_bridge" | "rtmp_push";
}

const sessions = new Map<string, CdnStreamSession>();
const activeByRoom = new Map<string, string>();
const ffmpegByRoom = new Map<string, ChildProcess>();
const plainByRoom = new Map<
  string,
  Awaited<ReturnType<SfuManager["createPlainConsumers"]>>
>();

function buildVideoSdp(ip: string, port: number, payloadType: number, codec: string) {
  return `v=0
o=- 0 0 IN IP4 ${ip}
s=rtc-cdn
c=IN IP4 ${ip}
t=0 0
m=video ${port} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codec}/90000
a=recvonly
`;
}

function buildAudioSdp(ip: string, port: number, payloadType: number) {
  return `v=0
o=- 0 0 IN IP4 ${ip}
s=rtc-cdn
c=IN IP4 ${ip}
t=0 0
m=audio ${port} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} opus/48000/2
a=recvonly
`;
}

export class CdnStreamManager {
  constructor(
    private sfu: SfuManager,
    private workDir: string
  ) {}

  getSession(roomId: string) {
    const id = activeByRoom.get(roomId);
    return id ? sessions.get(id) ?? null : null;
  }

  async start(roomId: string, streamKey: string, rtmpPushUrl: string, sessionId: string) {
    if (activeByRoom.has(roomId)) throw new Error("CDN stream already active for this room");

    const producers = this.sfu.listProducers(roomId);
    const videoProducer = producers.find((p) => p.kind === "video");
    const audioProducer = producers.find((p) => p.kind === "audio");

    const session: CdnStreamSession = {
      sessionId,
      roomId,
      streamKey,
      startedAt: new Date().toISOString(),
      producerIds: producers.map((p) => p.producerId),
      mode: videoProducer ? "webrtc_bridge" : "rtmp_push",
    };

    sessions.set(sessionId, session);
    activeByRoom.set(roomId, sessionId);

    if (videoProducer) {
      await this.startFfmpegBridge(roomId, rtmpPushUrl, videoProducer.producerId, audioProducer?.producerId);
    }

    return session;
  }

  private async startFfmpegBridge(
    roomId: string,
    rtmpPushUrl: string,
    videoProducerId: string,
    audioProducerId?: string
  ) {
    const bridge = await this.sfu.createPlainConsumers(roomId, {
      videoProducerId,
      audioProducerId,
    });
    if (!bridge) throw new Error("Could not create RTP bridge");

    plainByRoom.set(roomId, bridge);
    const sessionDir = path.join(this.workDir, roomId);
    await mkdir(sessionDir, { recursive: true });

    const videoCodec =
      bridge.videoConsumer.rtpParameters.codecs[0]?.mimeType.toLowerCase().includes("h264")
        ? "H264"
        : "VP8";
    const videoPt = bridge.videoConsumer.rtpParameters.codecs[0]?.payloadType ?? 96;
    const videoPort = bridge.videoTransport.tuple.localPort;
    const videoIp = bridge.videoTransport.tuple.localIp;

    const videoSdpPath = path.join(sessionDir, "video.sdp");
    await writeFile(videoSdpPath, buildVideoSdp(videoIp, videoPort, videoPt, videoCodec));

    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-protocol_whitelist",
      "file,udp,rtp",
      "-i",
      videoSdpPath,
    ];

    if (bridge.audioConsumer && bridge.audioTransport) {
      const audioPt = bridge.audioConsumer.rtpParameters.codecs[0]?.payloadType ?? 111;
      const audioPort = bridge.audioTransport.tuple.localPort;
      const audioIp = bridge.audioTransport.tuple.localIp;
      const audioSdpPath = path.join(sessionDir, "audio.sdp");
      await writeFile(audioSdpPath, buildAudioSdp(audioIp, audioPort, audioPt));
      args.push("-protocol_whitelist", "file,udp,rtp", "-i", audioSdpPath);
    }

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-tune",
      "zerolatency",
      "-g",
      "60",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-f",
      "flv",
      rtmpPushUrl
    );

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    ffmpegByRoom.set(roomId, proc);
    proc.on("exit", () => {
      ffmpegByRoom.delete(roomId);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.warn(`[cdn-stream ${roomId}] ${line}`);
    });
  }

  async stop(roomId: string) {
    const sessionId = activeByRoom.get(roomId);
    if (!sessionId) throw new Error("No active CDN stream for this room");

    ffmpegByRoom.get(roomId)?.kill("SIGTERM");
    ffmpegByRoom.delete(roomId);

    const plain = plainByRoom.get(roomId);
    if (plain) {
      for (const consumer of plain.consumers) consumer.close();
      plain.videoTransport.close();
      plain.audioTransport?.close();
      plainByRoom.delete(roomId);
    }

    await rm(path.join(this.workDir, roomId), { recursive: true, force: true });

    activeByRoom.delete(roomId);
    const session = sessions.get(sessionId);
    if (session) sessions.delete(sessionId);
    return session;
  }
}
