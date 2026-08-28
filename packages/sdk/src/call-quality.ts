export interface CallQualityMetrics {
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPct: number | null;
  inboundBitrateKbps: number | null;
  outboundBitrateKbps: number | null;
  audioLevel: number | null;
  connectionState: string | null;
  iceState: string | null;
}

export type QualityLabel = "excellent" | "good" | "fair" | "poor";

export interface CallQualitySample {
  metrics: CallQualityMetrics;
  score: number;
  label: QualityLabel;
  at: number;
}

const prevSamples = new WeakMap<object, { inbound: number; outbound: number; ts: number }>();

export function scoreQuality(metrics: CallQualityMetrics): { score: number; label: QualityLabel } {
  let score = 100;

  if (metrics.packetLossPct != null) {
    if (metrics.packetLossPct > 5) score -= 40;
    else if (metrics.packetLossPct > 1) score -= 15;
  }
  if (metrics.rttMs != null) {
    if (metrics.rttMs > 300) score -= 25;
    else if (metrics.rttMs > 150) score -= 10;
  }
  if (metrics.jitterMs != null) {
    if (metrics.jitterMs > 50) score -= 15;
    else if (metrics.jitterMs > 30) score -= 8;
  }

  score = Math.max(0, Math.min(100, score));
  const label: QualityLabel =
    score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "fair" : "poor";
  return { score, label };
}

function bitrateKbps(currentBytes: number, prevBytes: number, currentTs: number, prevTs: number) {
  const deltaBytes = currentBytes - prevBytes;
  const deltaMs = currentTs - prevTs;
  if (deltaBytes <= 0 || deltaMs <= 0) return null;
  return Math.round((deltaBytes * 8) / deltaMs);
}

export async function collectPeerConnectionStats(
  pc: RTCPeerConnection
): Promise<CallQualityMetrics> {
  const stats = await pc.getStats();
  let rttMs: number | null = null;
  let jitterMs: number | null = null;
  let packetLossPct: number | null = null;
  let inboundBytes = 0;
  let outboundBytes = 0;
  let audioLevel: number | null = null;
  let ts = Date.now();

  for (const report of stats.values()) {
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      if (report.currentRoundTripTime != null) {
        rttMs = Math.round(report.currentRoundTripTime * 1000);
      }
    }
    if (report.type === "inbound-rtp" && (report as { kind?: string }).kind === "audio") {
      const inbound = report as {
        jitter?: number;
        packetsLost?: number;
        packetsReceived?: number;
        bytesReceived?: number;
        timestamp?: number;
        audioLevel?: number;
      };
      if (inbound.jitter != null) jitterMs = Math.round(inbound.jitter * 1000);
      if (inbound.packetsLost != null && inbound.packetsReceived != null) {
        const total = inbound.packetsLost + inbound.packetsReceived;
        packetLossPct = total > 0 ? Math.round((inbound.packetsLost / total) * 1000) / 10 : 0;
      }
      if (inbound.bytesReceived != null) inboundBytes += inbound.bytesReceived;
      if (inbound.timestamp != null) ts = inbound.timestamp;
      if (inbound.audioLevel != null) audioLevel = inbound.audioLevel;
    }
    if (report.type === "outbound-rtp" && (report as { kind?: string }).kind === "audio") {
      const outbound = report as { bytesSent?: number; timestamp?: number };
      if (outbound.bytesSent != null) outboundBytes += outbound.bytesSent;
      if (outbound.timestamp != null) ts = outbound.timestamp;
    }
  }

  const prev = prevSamples.get(pc);
  let inboundBitrateKbps: number | null = null;
  let outboundBitrateKbps: number | null = null;
  if (prev) {
    inboundBitrateKbps = bitrateKbps(inboundBytes, prev.inbound, ts, prev.ts);
    outboundBitrateKbps = bitrateKbps(outboundBytes, prev.outbound, ts, prev.ts);
  }
  prevSamples.set(pc, { inbound: inboundBytes, outbound: outboundBytes, ts });

  return {
    rttMs,
    jitterMs,
    packetLossPct,
    inboundBitrateKbps,
    outboundBitrateKbps,
    audioLevel,
    connectionState: pc.connectionState,
    iceState: pc.iceConnectionState,
  };
}

export class QualityMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastLabel: QualityLabel | null = null;

  constructor(
    private collect: () => Promise<CallQualityMetrics | null>,
    private onSample: (sample: CallQualitySample, degraded: boolean) => void
  ) {}

  start(intervalMs = 5000) {
    this.stop();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastLabel = null;
  }

  private async tick() {
    const metrics = await this.collect();
    if (!metrics) return;
    const { score, label } = scoreQuality(metrics);
    const degraded = label === "poor" && this.lastLabel !== "poor";
    this.lastLabel = label;
    this.onSample({ metrics, score, label, at: Date.now() }, degraded);
  }
}
