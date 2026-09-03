export interface RecordingMixer {
  stream: MediaStream;
  cleanup: () => void;
}

/** Mix local + remote audio; composite multiple video tracks into one canvas stream. */
export function createMixedRecordingStream(inputs: MediaStream[]): RecordingMixer {
  const audioTracks: MediaStreamTrack[] = [];
  const videoTracks: MediaStreamTrack[] = [];

  for (const stream of inputs) {
    for (const track of stream.getTracks()) {
      if (track.readyState !== "live") continue;
      if (track.kind === "audio" && !audioTracks.some((t) => t.id === track.id)) {
        audioTracks.push(track);
      }
      if (track.kind === "video" && !videoTracks.some((t) => t.id === track.id)) {
        videoTracks.push(track);
      }
    }
  }

  if (!audioTracks.length && !videoTracks.length) {
    throw new Error("No media tracks available to record");
  }

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  for (const track of audioTracks) {
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    source.connect(destination);
  }

  const outputStream = new MediaStream();
  for (const track of destination.stream.getAudioTracks()) {
    outputStream.addTrack(track);
  }

  const videoElements: HTMLVideoElement[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let rafId = 0;

  if (videoTracks.length > 0) {
    for (const track of videoTracks) {
      const video = document.createElement("video");
      video.srcObject = new MediaStream([track]);
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      void video.play().catch(() => {});
      videoElements.push(video);
    }

    canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      if (!canvas) return;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const count = videoElements.length;
      const cols = count <= 1 ? 1 : 2;
      const rows = Math.ceil(count / cols);
      const cellW = canvas.width / cols;
      const cellH = canvas.height / rows;

      videoElements.forEach((video, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = col * cellW;
        const y = row * cellH;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          const aspect = video.videoWidth / video.videoHeight;
          let drawW = cellW;
          let drawH = drawW / aspect;
          if (drawH > cellH) {
            drawH = cellH;
            drawW = drawH * aspect;
          }
          const offsetX = x + (cellW - drawW) / 2;
          const offsetY = y + (cellH - drawH) / 2;
          ctx.drawImage(video, offsetX, offsetY, drawW, drawH);
        }
      });

      rafId = requestAnimationFrame(draw);
    };
    draw();

    const canvasTrack = canvas.captureStream(30).getVideoTracks()[0];
    if (canvasTrack) outputStream.addTrack(canvasTrack);
  }

  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    for (const video of videoElements) {
      video.srcObject = null;
    }
    void audioContext.close();
  };

  return { stream: outputStream, cleanup };
}

export class CallRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private mixerCleanup: (() => void) | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private mimeType = "audio/webm";

  isRecording() {
    return this.mediaRecorder?.state === "recording";
  }

  startRecording(streams: MediaStream[]) {
    if (this.isRecording()) throw new Error("Already recording");

    const { stream, cleanup } = createMixedRecordingStream(streams);
    this.mixerCleanup = cleanup;

    const hasVideo = stream.getVideoTracks().length > 0;
    const candidates = hasVideo
      ? ["video/webm;codecs=vp8,opus", "video/webm", "audio/webm"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
    this.mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";

    this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.mimeType });
    this.chunks = [];
    this.startedAt = Date.now();
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.mediaRecorder.start(1000);
  }

  stopRecording(): Promise<{ blob: Blob; durationMs: number; mimeType: string; sizeBytes: number }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("Not recording"));
        return;
      }
      const recorder = this.mediaRecorder;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType });
        this.mediaRecorder = null;
        this.chunks = [];
        this.mixerCleanup?.();
        this.mixerCleanup = null;
        resolve({
          blob,
          durationMs: Date.now() - this.startedAt,
          mimeType: this.mimeType,
          sizeBytes: blob.size,
        });
      };
      recorder.onerror = () => {
        this.mixerCleanup?.();
        this.mixerCleanup = null;
        reject(new Error("Recording failed"));
      };
      recorder.stop();
    });
  }
}
