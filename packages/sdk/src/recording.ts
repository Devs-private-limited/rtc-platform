export class CallRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private mimeType = "audio/webm";

  isRecording() {
    return this.mediaRecorder?.state === "recording";
  }

  startRecording(streams: MediaStream[]) {
    if (this.isRecording()) throw new Error("Already recording");

    const combined = new MediaStream();
    for (const stream of streams) {
      for (const track of stream.getTracks()) {
        if (!combined.getTracks().some((t) => t.id === track.id)) {
          combined.addTrack(track);
        }
      }
    }

    if (!combined.getTracks().length) {
      throw new Error("No media tracks available to record");
    }

    const hasVideo = combined.getVideoTracks().length > 0;
    const candidates = hasVideo
      ? ["video/webm;codecs=vp8,opus", "video/webm", "audio/webm"]
      : ["audio/webm", "audio/ogg"];
    this.mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "audio/webm";

    this.mediaRecorder = new MediaRecorder(combined, { mimeType: this.mimeType });
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
        resolve({
          blob,
          durationMs: Date.now() - this.startedAt,
          mimeType: this.mimeType,
          sizeBytes: blob.size,
        });
      };
      recorder.onerror = () => reject(new Error("Recording failed"));
      recorder.stop();
    });
  }
}
