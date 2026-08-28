import "./style.css";
import { RTCExpress } from "@rtc/sdk";

const SERVER_URL = window.location.origin;
const APP_ID = "demo-app";
const APP_SECRET = "demo-secret";
const DEFAULT_ROOM = "room-1";

interface PanelConfig {
  title: string;
  defaultUserId: string;
  mount: HTMLElement;
}

function log(el: HTMLElement, text: string) {
  el.textContent = text;
}

function appendMessage(
  container: HTMLElement,
  from: string,
  text: string,
  self: boolean
) {
  const div = document.createElement("div");
  div.className = `msg ${self ? "self" : ""}`;
  div.textContent = `${from}: ${text}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function attachStream(video: HTMLVideoElement, stream: MediaStream) {
  video.srcObject = stream;
  void video.play().catch(() => {});
}

function createPanel(config: PanelConfig) {
  const root = document.createElement("section");
  root.className = "panel";
  root.innerHTML = `
    <h2>${config.title}</h2>
    <div class="status">Disconnected</div>
    <div class="quality-badge" hidden>Quality: —</div>
    <div class="row">
      <input class="user-id" value="${config.defaultUserId}" placeholder="User ID" />
      <input class="room-id" value="${DEFAULT_ROOM}" placeholder="Room ID" />
    </div>
    <div class="row">
      <label class="mode-label">
        Media
        <select class="media-mode">
          <option value="auto" selected>Auto (SFU if available)</option>
          <option value="sfu">SFU</option>
          <option value="p2p">P2P</option>
        </select>
      </label>
    </div>
    <div class="row">
      <button class="connect">Connect</button>
      <button class="join secondary" disabled>Join room</button>
    </div>
    <div class="video-area" hidden>
      <div class="video-box">
        <video class="local-video" autoplay playsinline muted></video>
        <span class="video-label">You</span>
      </div>
      <div class="remote-videos"></div>
    </div>
    <div class="messages"></div>
    <div class="row">
      <input class="chat-input" placeholder="Type a message..." disabled />
      <button class="send secondary" disabled>Send</button>
    </div>
    <div class="row">
      <input class="peer-id" placeholder="Peer user ID" disabled />
      <button class="call secondary" disabled>Voice call</button>
      <button class="video-call secondary" disabled>Video call</button>
    </div>
    <div class="row">
      <button class="group-voice secondary" disabled>Group voice</button>
      <button class="group-video secondary" disabled>Group video</button>
      <button class="leave-media secondary" disabled hidden>Leave media</button>
    </div>
    <div class="call-bar">
      <button class="accept success" disabled hidden>Accept</button>
      <button class="reject danger" disabled hidden>Reject</button>
      <button class="end danger" disabled hidden>End call</button>
      <button class="mute secondary" disabled hidden>Mute</button>
      <button class="cam secondary" disabled hidden>Cam off</button>
      <button class="screen secondary" disabled hidden>Share screen</button>
      <button class="record danger" disabled hidden>Record</button>
      <button class="stop-record danger" disabled hidden>Stop &amp; save</button>
    </div>
    <div class="log"></div>
  `;
  config.mount.appendChild(root);

  const statusEl = root.querySelector(".status") as HTMLElement;
  const userIdInput = root.querySelector(".user-id") as HTMLInputElement;
  const roomIdInput = root.querySelector(".room-id") as HTMLInputElement;
  const connectBtn = root.querySelector(".connect") as HTMLButtonElement;
  const joinBtn = root.querySelector(".join") as HTMLButtonElement;
  const messagesEl = root.querySelector(".messages") as HTMLElement;
  const chatInput = root.querySelector(".chat-input") as HTMLInputElement;
  const sendBtn = root.querySelector(".send") as HTMLButtonElement;
  const peerIdInput = root.querySelector(".peer-id") as HTMLInputElement;
  const callBtn = root.querySelector(".call") as HTMLButtonElement;
  const videoCallBtn = root.querySelector(".video-call") as HTMLButtonElement;
  const acceptBtn = root.querySelector(".accept") as HTMLButtonElement;
  const rejectBtn = root.querySelector(".reject") as HTMLButtonElement;
  const endBtn = root.querySelector(".end") as HTMLButtonElement;
  const muteBtn = root.querySelector(".mute") as HTMLButtonElement;
  const camBtn = root.querySelector(".cam") as HTMLButtonElement;
  const screenBtn = root.querySelector(".screen") as HTMLButtonElement;
  const recordBtn = root.querySelector(".record") as HTMLButtonElement;
  const stopRecordBtn = root.querySelector(".stop-record") as HTMLButtonElement;
  const mediaModeSelect = root.querySelector(".media-mode") as HTMLSelectElement;
  const groupVoiceBtn = root.querySelector(".group-voice") as HTMLButtonElement;
  const groupVideoBtn = root.querySelector(".group-video") as HTMLButtonElement;
  const leaveMediaBtn = root.querySelector(".leave-media") as HTMLButtonElement;
  const videoArea = root.querySelector(".video-area") as HTMLElement;
  const localVideo = root.querySelector(".local-video") as HTMLVideoElement;
  const remoteVideos = root.querySelector(".remote-videos") as HTMLElement;
  const logEl = root.querySelector(".log") as HTMLElement;
  const qualityBadge = root.querySelector(".quality-badge") as HTMLElement;

  let rtc: RTCExpress | null = null;
  let muted = false;
  let camOff = false;
  let inCall = false;
  let inRoom = false;
  let inGroupMedia = false;
  let isVideoSession = false;
  const remoteVideoEls = new Map<string, HTMLVideoElement>();

  function setConnected(connected: boolean) {
    joinBtn.disabled = !connected;
    chatInput.disabled = !connected || !inRoom;
    sendBtn.disabled = !connected || !inRoom;
    peerIdInput.disabled = !connected || !inRoom;
    callBtn.disabled = !connected || !inRoom || inCall || inGroupMedia;
    videoCallBtn.disabled = !connected || !inRoom || inCall || inGroupMedia;
    groupVoiceBtn.disabled = !connected || !inRoom || inCall || inGroupMedia;
    groupVideoBtn.disabled = !connected || !inRoom || inCall || inGroupMedia;
    connectBtn.textContent = connected ? "Connected" : "Connect";
    connectBtn.disabled = connected;
    mediaModeSelect.disabled = connected;
    statusEl.textContent = connected
      ? `Connected as ${userIdInput.value}`
      : "Disconnected";
  }

  function setCallUi(ringing: boolean, active: boolean, video = false) {
    acceptBtn.hidden = !ringing;
    rejectBtn.hidden = !ringing;
    endBtn.hidden = !active;
    muteBtn.hidden = !active;
    camBtn.hidden = !active || !video;
    screenBtn.hidden = !active;
    recordBtn.hidden = !active;
    stopRecordBtn.hidden = !active;
    acceptBtn.disabled = !ringing;
    rejectBtn.disabled = !ringing;
    endBtn.disabled = !active;
    muteBtn.disabled = !active;
    camBtn.disabled = !active;
    screenBtn.disabled = !active;
    recordBtn.disabled = !active;
    stopRecordBtn.disabled = !active;
    callBtn.disabled = ringing || active || !inRoom || inGroupMedia;
    videoCallBtn.disabled = ringing || active || !inRoom || inGroupMedia;
    inCall = ringing || active;
    isVideoSession = video;
    videoArea.hidden = !video && !inGroupMedia;
  }

  function clearRemoteVideos() {
    remoteVideoEls.forEach((v) => {
      v.srcObject = null;
      v.remove();
    });
    remoteVideoEls.clear();
    remoteVideos.innerHTML = "";
  }

  function wireRtc(rtcInstance: RTCExpress) {
    rtcInstance.on("localStream", ({ stream }) => {
      if (stream) attachStream(localVideo, stream);
      else localVideo.srcObject = null;
    });

    rtcInstance.on("remoteTrack", ({ producerId, userId, kind, stream, source }) => {
      if (kind !== "video") return;
      let video = remoteVideoEls.get(producerId);
      if (!video) {
        const box = document.createElement("div");
        box.className = "video-box";
        video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        const label = document.createElement("span");
        label.className = "video-label";
        label.textContent = `${userId} (${source || "cam"})`;
        box.appendChild(video);
        box.appendChild(label);
        remoteVideos.appendChild(box);
        remoteVideoEls.set(producerId, video);
      }
      attachStream(video, stream);
      videoArea.hidden = false;
    });
  }

  connectBtn.onclick = async () => {
    try {
      const userId = userIdInput.value.trim();
      if (!userId) return;
      log(logEl, "Fetching token...");
      const tokenRes = await RTCExpress.fetchToken(SERVER_URL, {
        appId: APP_ID,
        appSecret: APP_SECRET,
        userId,
        roomId: roomIdInput.value.trim(),
      });
      rtc = new RTCExpress();
      wireRtc(rtc);

      rtc.on("roomJoined", () => {
        inRoom = true;
        setConnected(true);
      });
      rtc.on("message", (msg) => {
        appendMessage(messagesEl, msg.fromUserId, msg.text, false);
      });
      rtc.on("userJoined", ({ userId: joined }) => {
        log(logEl, `${joined} joined the room`);
      });
      rtc.on("callInvite", ({ fromUserId, callType }) => {
        log(logEl, `Incoming ${callType || "voice"} call from ${fromUserId}`);
        setCallUi(true, false, callType === "video");
      });
      rtc.on("callState", ({ state, peerUserId, mediaMode, callType }) => {
        log(logEl, `Call ${state} with ${peerUserId} (${callType || "voice"}, ${mediaMode || "p2p"})`);
        const video = callType === "video";
        setCallUi(state === "ringing", state === "connecting" || state === "connected", video);
        if (state === "ended" || state === "rejected") {
          setCallUi(false, false);
          inCall = false;
          isVideoSession = false;
          qualityBadge.hidden = true;
          clearRemoteVideos();
          videoArea.hidden = !inGroupMedia;
          setConnected(true);
        }
      });
      rtc.on("recordingStarted", () => log(logEl, "Recording started..."));
      rtc.on("recordingReady", ({ durationMs, sizeBytes, url, recordingId }) => {
        log(logEl, `Recording ready (${Math.round(durationMs / 1000)}s, ${Math.round(sizeBytes / 1024)} KB)`);
        if (recordingId) log(logEl, `Recording ID: ${recordingId} — processing transcript...`);
        const a = document.createElement("a");
        a.href = url;
        a.download = `rtc-recording-${Date.now()}.webm`;
        a.textContent = "Download recording";
        a.style.color = "#93c5fd";
        a.style.display = "block";
        a.style.marginTop = "8px";
        logEl.appendChild(a);
      });
      rtc.on("transcriptReady", ({ transcript }) => {
        log(logEl, `Transcript: ${transcript}`);
      });
      rtc.on("summaryReady", ({ summary }) => {
        log(logEl, `AI Summary: ${summary}`);
      });
      rtc.on("callQuality", ({ score, label, metrics }) => {
        qualityBadge.hidden = false;
        qualityBadge.className = `quality-badge ${label}`;
        const parts = [`Quality: ${label} (${score})`];
        if (metrics.rttMs != null) parts.push(`RTT ${metrics.rttMs}ms`);
        if (metrics.packetLossPct != null) parts.push(`loss ${metrics.packetLossPct}%`);
        qualityBadge.textContent = parts.join(" · ");
      });
      rtc.on("error", ({ message }) => log(logEl, message));
      rtc.on("voiceRoomJoined", () => {
        inGroupMedia = true;
        groupVoiceBtn.hidden = true;
        groupVideoBtn.hidden = true;
        leaveMediaBtn.hidden = false;
        leaveMediaBtn.disabled = false;
        muteBtn.hidden = false;
        muteBtn.disabled = false;
        setConnected(true);
        log(logEl, "Joined group voice");
      });
      rtc.on("videoRoomJoined", () => {
        inGroupMedia = true;
        isVideoSession = true;
        groupVoiceBtn.hidden = true;
        groupVideoBtn.hidden = true;
        leaveMediaBtn.hidden = false;
        leaveMediaBtn.disabled = false;
        muteBtn.hidden = false;
        camBtn.hidden = false;
        screenBtn.hidden = false;
        recordBtn.hidden = false;
        stopRecordBtn.hidden = false;
        videoArea.hidden = false;
        setConnected(true);
        log(logEl, "Joined group video");
      });
      rtc.on("voiceRoomLeft", () => {
        inGroupMedia = false;
        groupVoiceBtn.hidden = false;
        groupVideoBtn.hidden = false;
        leaveMediaBtn.hidden = true;
        muteBtn.hidden = true;
        muted = false;
        muteBtn.textContent = "Mute";
        clearRemoteVideos();
        videoArea.hidden = true;
        localVideo.srcObject = null;
        setConnected(true);
        log(logEl, "Left group voice");
      });
      rtc.on("videoRoomLeft", () => {
        inGroupMedia = false;
        isVideoSession = false;
        groupVoiceBtn.hidden = false;
        groupVideoBtn.hidden = false;
        leaveMediaBtn.hidden = true;
        muteBtn.hidden = true;
        camBtn.hidden = true;
        screenBtn.hidden = true;
        muted = false;
        camOff = false;
        muteBtn.textContent = "Mute";
        camBtn.textContent = "Cam off";
        clearRemoteVideos();
        videoArea.hidden = true;
        localVideo.srcObject = null;
        setConnected(true);
        log(logEl, "Left group video");
      });

      await rtc.init({
        serverUrl: SERVER_URL,
        appId: APP_ID,
        userId,
        token: tokenRes.token,
        mediaMode: mediaModeSelect.value as "auto" | "sfu" | "p2p",
      });
      setConnected(true);
      log(logEl, `Ready (${rtc.getMediaMode()}). Voice/video calls and group media supported.`);
    } catch (err) {
      log(logEl, err instanceof Error ? err.message : "Connection failed");
    }
  };

  joinBtn.onclick = () => {
    rtc?.joinRoom(roomIdInput.value.trim());
    log(logEl, `Joined ${roomIdInput.value.trim()}`);
  };

  sendBtn.onclick = () => {
    const text = chatInput.value.trim();
    if (!text || !rtc) return;
    rtc.sendMessage(text);
    appendMessage(messagesEl, "you", text, true);
    chatInput.value = "";
  };

  chatInput.onkeydown = (e) => {
    if (e.key === "Enter") sendBtn.click();
  };

  callBtn.onclick = async () => {
    const peer = peerIdInput.value.trim();
    if (!peer || !rtc) return;
    await rtc.callUser(peer, { callType: "voice" });
  };

  videoCallBtn.onclick = async () => {
    const peer = peerIdInput.value.trim();
    if (!peer || !rtc) return;
    await rtc.videoCallUser(peer);
  };

  acceptBtn.onclick = async () => {
    await rtc?.acceptCall();
    setCallUi(false, true, isVideoSession);
  };

  rejectBtn.onclick = () => rtc?.rejectCall();
  endBtn.onclick = () => rtc?.endCall();

  muteBtn.onclick = () => {
    muted = !muted;
    rtc?.muteMicrophone(muted);
    muteBtn.textContent = muted ? "Unmute" : "Mute";
  };

  camBtn.onclick = () => {
    camOff = !camOff;
    rtc?.muteCamera(camOff);
    camBtn.textContent = camOff ? "Cam on" : "Cam off";
  };

  screenBtn.onclick = async () => {
    try {
      await rtc?.shareScreen();
      log(logEl, "Screen sharing");
    } catch (err) {
      log(logEl, err instanceof Error ? err.message : "Screen share failed");
    }
  };

  recordBtn.onclick = () => {
    try {
      rtc?.startRecording();
      recordBtn.disabled = true;
      stopRecordBtn.disabled = false;
      log(logEl, "Recording...");
    } catch (err) {
      log(logEl, err instanceof Error ? err.message : "Record failed");
    }
  };

  stopRecordBtn.onclick = async () => {
    try {
      await rtc?.stopRecording();
      recordBtn.disabled = false;
      stopRecordBtn.disabled = true;
    } catch (err) {
      log(logEl, err instanceof Error ? err.message : "Stop recording failed");
    }
  };

  groupVoiceBtn.onclick = async () => {
    try {
      await rtc?.joinVoiceRoom();
    } catch (err) {
      log(logEl, err instanceof Error ? err.message : "Group voice failed");
    }
  };

  groupVideoBtn.onclick = async () => {
    try {
      await rtc?.joinVideoRoom();
    } catch (err) {
      log(logEl, err instanceof Error ? err.message : "Group video failed");
    }
  };

  leaveMediaBtn.onclick = () => {
    if (isVideoSession) rtc?.leaveVideoRoom();
    else rtc?.leaveVoiceRoom();
  };
}

const app = document.getElementById("app")!;
app.innerHTML = `
  <header>
    <h1>RTC SDK Demo</h1>
    <p>Open two tabs with different user IDs. Join the same room. Try <strong>video call</strong>, <strong>group video</strong>, or <strong>screen share</strong>.</p>
  </header>
  <div class="panels"></div>
`;

const panels = app.querySelector(".panels")!;
createPanel({ title: "User A", defaultUserId: "user_a", mount: panels });
createPanel({ title: "User B", defaultUserId: "user_b", mount: panels });
