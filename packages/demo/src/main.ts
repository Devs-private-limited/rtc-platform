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

function createPanel(config: PanelConfig) {
  const root = document.createElement("section");
  root.className = "panel";
  root.innerHTML = `
    <h2>${config.title}</h2>
    <div class="status">Disconnected</div>
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
    <div class="messages"></div>
    <div class="row">
      <input class="chat-input" placeholder="Type a message..." disabled />
      <button class="send secondary" disabled>Send</button>
    </div>
    <div class="row">
      <input class="peer-id" placeholder="Peer user ID" disabled />
      <button class="call secondary" disabled>1:1 Call</button>
    </div>
    <div class="row">
      <button class="group-voice secondary" disabled>Join group voice</button>
      <button class="leave-voice secondary" disabled hidden>Leave voice</button>
    </div>
    <div class="call-bar">
      <button class="accept success" disabled hidden>Accept</button>
      <button class="reject danger" disabled hidden>Reject</button>
      <button class="end danger" disabled hidden>End call</button>
      <button class="mute secondary" disabled hidden>Mute</button>
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
  const acceptBtn = root.querySelector(".accept") as HTMLButtonElement;
  const rejectBtn = root.querySelector(".reject") as HTMLButtonElement;
  const endBtn = root.querySelector(".end") as HTMLButtonElement;
  const muteBtn = root.querySelector(".mute") as HTMLButtonElement;
  const mediaModeSelect = root.querySelector(".media-mode") as HTMLSelectElement;
  const groupVoiceBtn = root.querySelector(".group-voice") as HTMLButtonElement;
  const leaveVoiceBtn = root.querySelector(".leave-voice") as HTMLButtonElement;
  const logEl = root.querySelector(".log") as HTMLElement;

  let rtc: RTCExpress | null = null;
  let muted = false;
  let inCall = false;
  let inRoom = false;
  let inGroupVoice = false;

  function setConnected(connected: boolean) {
    joinBtn.disabled = !connected;
    chatInput.disabled = !connected || !inRoom;
    sendBtn.disabled = !connected || !inRoom;
    peerIdInput.disabled = !connected || !inRoom;
    callBtn.disabled = !connected || !inRoom || inCall;
    groupVoiceBtn.disabled = !connected || !inRoom || inCall || inGroupVoice;
    connectBtn.textContent = connected ? "Connected" : "Connect";
    connectBtn.disabled = connected;
    mediaModeSelect.disabled = connected;
    statusEl.textContent = connected
      ? `Connected as ${userIdInput.value}`
      : "Disconnected";
  }

  function setCallUi(ringing: boolean, active: boolean) {
    acceptBtn.hidden = !ringing;
    rejectBtn.hidden = !ringing;
    endBtn.hidden = !active;
    muteBtn.hidden = !active;
    acceptBtn.disabled = !ringing;
    rejectBtn.disabled = !ringing;
    endBtn.disabled = !active;
    muteBtn.disabled = !active;
    callBtn.disabled = ringing || active || !inRoom;
    inCall = ringing || active;
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
      rtc.on("callInvite", ({ fromUserId }) => {
        log(logEl, `Incoming call from ${fromUserId}`);
        setCallUi(true, false);
      });
      rtc.on("callState", ({ state, peerUserId, mediaMode }) => {
        log(logEl, `Call ${state} with ${peerUserId} (${mediaMode || "p2p"})`);
        setCallUi(state === "ringing", state === "connecting" || state === "connected");
        if (state === "ended" || state === "rejected") {
          setCallUi(false, false);
          inCall = false;
          callBtn.disabled = false;
        }
      });
      rtc.on("error", ({ message }) => log(logEl, message));
      rtc.on("voiceRoomJoined", () => {
        inGroupVoice = true;
        groupVoiceBtn.hidden = true;
        leaveVoiceBtn.hidden = false;
        leaveVoiceBtn.disabled = false;
        muteBtn.hidden = false;
        muteBtn.disabled = false;
        setConnected(true);
        log(logEl, "Joined group voice (SFU)");
      });
      rtc.on("voiceRoomLeft", () => {
        inGroupVoice = false;
        groupVoiceBtn.hidden = false;
        leaveVoiceBtn.hidden = true;
        muteBtn.hidden = true;
        muted = false;
        muteBtn.textContent = "Mute";
        setConnected(true);
        log(logEl, "Left group voice");
      });

      await rtc.init({
        serverUrl: SERVER_URL,
        appId: APP_ID,
        userId,
        token: tokenRes.token,
        mediaMode: mediaModeSelect.value as "auto" | "sfu" | "p2p",
      });
      setConnected(true);
      log(logEl, `Ready (${rtc.getMediaMode()} mode). Join room, chat, call, or group voice.`);
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
    await rtc.callUser(peer);
  };

  acceptBtn.onclick = async () => {
    await rtc?.acceptCall();
    setCallUi(false, true);
  };

  rejectBtn.onclick = () => rtc?.rejectCall();
  endBtn.onclick = () => rtc?.endCall();
  muteBtn.onclick = () => {
    muted = !muted;
    rtc?.muteMicrophone(muted);
    muteBtn.textContent = muted ? "Unmute" : "Mute";
  };

  groupVoiceBtn.onclick = async () => {
    try {
      await rtc?.joinVoiceRoom();
    } catch (err) {
      log(logEl, err instanceof Error ? err.message : "Group voice failed");
    }
  };

  leaveVoiceBtn.onclick = () => rtc?.leaveVoiceRoom();
}

const app = document.getElementById("app")!;
app.innerHTML = `
  <header>
    <h1>RTC SDK Demo</h1>
    <p>Open two tabs with different user IDs. Join the same room. Try 1:1 call (P2P or SFU) or <strong>Join group voice</strong> for multi-user audio.</p>
  </header>
  <div class="panels"></div>
`;

const panels = app.querySelector(".panels")!;
createPanel({ title: "User A", defaultUserId: "user_a", mount: panels });
createPanel({ title: "User B", defaultUserId: "user_b", mount: panels });
