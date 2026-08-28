import "./style.css";
import { api, getAdminKey, setAdminKey, type AppRecord } from "./api";

const app = document.getElementById("app")!;
let selectedApp: AppRecord | null = null;
let activeTab: "overview" | "events" | "webhooks" | "deliveries" | "quickstart" = "overview";
let eventTypes: string[] = [];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function renderLogin() {
  app.innerHTML = `
    <header class="top">
      <div>
        <h1>RTC Developer Dashboard</h1>
        <p>Manage projects, webhooks, events and usage</p>
      </div>
    </header>
    <section class="card">
      <h2>Sign in</h2>
      <p class="muted" style="margin-bottom:12px">Enter your admin API key (default dev: <code>dev-admin-key</code>)</p>
      <div class="row">
        <input id="admin-key" type="password" placeholder="Admin API key" value="${getAdminKey()}" />
        <button id="login-btn">Continue</button>
      </div>
      <div id="login-error" class="error"></div>
    </section>
  `;

  const btn = document.getElementById("login-btn")!;
  const input = document.getElementById("admin-key") as HTMLInputElement;
  const err = document.getElementById("login-error")!;

  btn.onclick = async () => {
    err.textContent = "";
    setAdminKey(input.value.trim());
    try {
      await api.listApps();
      await loadEventTypes();
      renderHome();
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : "Login failed";
    }
  };
}

async function loadEventTypes() {
  try {
    const res = await api.eventTypes();
    eventTypes = res.eventTypes;
  } catch {
    eventTypes = [
      "user.joined",
      "user.left",
      "message.sent",
      "call.ringing",
      "call.connected",
      "call.failed",
      "call.ended",
    ];
  }
}

async function renderHome() {
  let apps: AppRecord[] = [];
  let error = "";

  try {
    const res = await api.listApps();
    apps = res.apps;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load apps";
  }

  if (selectedApp) {
    renderAppDetail();
    return;
  }

  app.innerHTML = `
    <header class="top">
      <div>
        <h1>RTC Developer Dashboard</h1>
        <p>Projects & developer tools</p>
      </div>
      <button class="secondary" id="logout-btn">Sign out</button>
    </header>
    <section class="card">
      <h2>Projects</h2>
      ${error ? `<div class="error">${error}</div>` : ""}
      <div class="app-list" id="app-list">
        ${apps.length ? apps.map((a) => `
          <div class="app-item" data-app="${a.appId}">
            <div>
              <strong>${a.name}</strong>
              <span>${a.appId}</span>
            </div>
            <span class="badge ${a.active ? "ok" : "off"}">${a.active ? "active" : "inactive"}</span>
          </div>
        `).join("") : `<div class="empty">No projects yet. Create one below.</div>`}
      </div>
    </section>
    <section class="card">
      <h2>Create project</h2>
      <div class="row">
        <input id="new-app-name" placeholder="My Product" />
        <button id="create-app-btn">Create</button>
      </div>
      <div id="create-result"></div>
      <div id="create-error" class="error"></div>
    </section>
    <section class="card">
      <h2>Links</h2>
      <p class="muted">RTC demo: <a href="http://localhost:5180" target="_blank">localhost:5180</a> · Signaling: localhost:4000</p>
    </section>
  `;

  document.getElementById("logout-btn")!.onclick = () => {
    setAdminKey("");
    selectedApp = null;
    renderLogin();
  };

  document.querySelectorAll(".app-item").forEach((el) => {
    el.addEventListener("click", () => {
      const appId = (el as HTMLElement).dataset.app!;
      selectedApp = apps.find((a) => a.appId === appId) || null;
      activeTab = "overview";
      renderAppDetail();
    });
  });

  document.getElementById("create-app-btn")!.onclick = async () => {
    const name = (document.getElementById("new-app-name") as HTMLInputElement).value.trim();
    const errEl = document.getElementById("create-error")!;
    const resEl = document.getElementById("create-result")!;
    errEl.textContent = "";
    resEl.innerHTML = "";
    if (!name) return;
    try {
      const created = await api.createApp(name);
      resEl.innerHTML = `
        <div class="secret-box">
          <strong>App created — save these credentials now</strong><br><br>
          App ID: ${created.appId}<br>
          App Secret: ${created.appSecret}<br><br>
          <span class="muted">${created.note || ""}</span>
        </div>`;
      renderHome();
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : "Create failed";
    }
  };
}

async function renderAppDetail() {
  if (!selectedApp) return;
  const appId = selectedApp.appId;

  app.innerHTML = `
    <header class="top">
      <div>
        <h1>${selectedApp.name}</h1>
        <p>${appId}</p>
      </div>
      <div class="row">
        <button class="secondary" id="back-btn">← Projects</button>
        <button class="secondary" id="logout-btn">Sign out</button>
      </div>
    </header>
    <div class="tabs">
      ${(["overview", "events", "webhooks", "deliveries", "quickstart"] as const)
        .map((t) => `<button class="tab ${activeTab === t ? "active" : ""}" data-tab="${t}">${t}</button>`)
        .join("")}
    </div>
    <div id="tab-content"></div>
  `;

  document.getElementById("back-btn")!.onclick = () => {
    selectedApp = null;
    renderHome();
  };
  document.getElementById("logout-btn")!.onclick = () => {
    setAdminKey("");
    selectedApp = null;
    renderLogin();
  };
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = (btn as HTMLElement).dataset.tab as typeof activeTab;
      renderAppDetail();
    });
  });

  const content = document.getElementById("tab-content")!;

  try {
    if (activeTab === "overview") await renderOverview(content, appId);
    else if (activeTab === "events") await renderEvents(content, appId);
    else if (activeTab === "webhooks") await renderWebhooks(content, appId);
    else if (activeTab === "deliveries") await renderDeliveries(content, appId);
    else await renderQuickstart(content, appId);
  } catch (e) {
    content.innerHTML = `<div class="card error">${e instanceof Error ? e.message : "Failed to load"}</div>`;
  }
}

async function renderOverview(el: HTMLElement, appId: string) {
  const [metering, usage] = await Promise.all([api.getMetering(appId), api.getUsage(appId)]);

  el.innerHTML = `
    <section class="card">
      <h2>Usage metering</h2>
      <div class="grid-2">
        <div class="stat"><div class="label">Messages sent</div><div class="value">${metering.messagesSent}</div></div>
        <div class="stat"><div class="label">Calls connected</div><div class="value">${metering.callsConnected}</div></div>
        <div class="stat"><div class="label">Call minutes</div><div class="value">${metering.callMinutes}</div></div>
        <div class="stat"><div class="label">Total events</div><div class="value">${metering.totalEvents}</div></div>
      </div>
    </section>
    <section class="card">
      <h2>Events by type</h2>
      <table>
        <thead><tr><th>Type</th><th>Count</th></tr></thead>
        <tbody>
          ${usage.byType.length ? usage.byType.map((r) => `<tr><td>${r.type}</td><td>${r.count}</td></tr>`).join("") : `<tr><td colspan="2" class="muted">No events yet</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

async function renderEvents(el: HTMLElement, appId: string) {
  const { events } = await api.listEvents(appId, 100);
  el.innerHTML = `
    <section class="card">
      <h2>Event log</h2>
      <table>
        <thead><tr><th>Time</th><th>Type</th><th>Room</th><th>User</th></tr></thead>
        <tbody>
          ${events.length ? events.map((e) => `
            <tr>
              <td>${fmtDate(e.createdAt)}</td>
              <td>${e.type}</td>
              <td>${e.roomId || "—"}</td>
              <td>${e.userId || "—"}</td>
            </tr>`).join("") : `<tr><td colspan="4" class="empty">No events yet. Join a room in the demo to generate events.</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

async function renderWebhooks(el: HTMLElement, appId: string) {
  const { webhooks } = await api.listWebhooks(appId);

  el.innerHTML = `
    <section class="card">
      <h2>Webhooks</h2>
      <table>
        <thead><tr><th>URL</th><th>Events</th><th>Status</th><th></th></tr></thead>
        <tbody id="webhook-rows">
          ${webhooks.length ? webhooks.map((w) => `
            <tr>
              <td style="max-width:200px;word-break:break-all">${w.url}</td>
              <td>${w.eventTypes.join(", ")}</td>
              <td><span class="badge ${w.active ? "ok" : "off"}">${w.active ? "active" : "paused"}</span></td>
              <td>
                <button class="secondary toggle-wh" data-id="${w.id}" data-active="${w.active}">${w.active ? "Pause" : "Enable"}</button>
                <button class="danger delete-wh" data-id="${w.id}">Delete</button>
              </td>
            </tr>`).join("") : `<tr><td colspan="4" class="empty">No webhooks registered</td></tr>`}
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>Add webhook</h2>
      <input id="wh-url" placeholder="https://your-server.com/webhooks/rtc" style="width:100%;margin-bottom:10px" />
      <div class="checkbox-grid" id="wh-events">
        ${eventTypes.map((t) => `<label><input type="checkbox" value="${t}" checked /> ${t}</label>`).join("")}
      </div>
      <button id="add-wh-btn">Register webhook</button>
      <div id="wh-secret" class="secret-box" style="display:none"></div>
      <div id="wh-error" class="error"></div>
    </section>
  `;

  document.getElementById("add-wh-btn")!.onclick = async () => {
    const url = (document.getElementById("wh-url") as HTMLInputElement).value.trim();
    const events = [...document.querySelectorAll<HTMLInputElement>("#wh-events input:checked")].map((c) => c.value);
    const errEl = document.getElementById("wh-error")!;
    const secretEl = document.getElementById("wh-secret")!;
    errEl.textContent = "";
    try {
      const created = await api.createWebhook(appId, url, events);
      secretEl.style.display = "block";
      secretEl.innerHTML = `<strong>Webhook secret (save now):</strong><br>${created.secret}`;
      renderWebhooks(el, appId);
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : "Failed";
    }
  };

  el.querySelectorAll(".toggle-wh").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).dataset.id!;
      const active = (btn as HTMLElement).dataset.active === "true";
      await api.toggleWebhook(appId, id, !active);
      renderWebhooks(el, appId);
    });
  });

  el.querySelectorAll(".delete-wh").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).dataset.id!;
      if (!confirm("Delete this webhook?")) return;
      await api.deleteWebhook(appId, id);
      renderWebhooks(el, appId);
    });
  });
}

async function renderDeliveries(el: HTMLElement, appId: string) {
  const { deliveries } = await api.listDeliveries(appId, 100);
  el.innerHTML = `
    <section class="card">
      <h2>Webhook deliveries</h2>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>Status</th><th>Attempt</th><th>Error</th></tr></thead>
        <tbody>
          ${deliveries.length ? deliveries.map((d) => `
            <tr>
              <td>${fmtDate(d.createdAt)}</td>
              <td>${d.eventType || "—"}</td>
              <td><span class="badge ${d.success ? "ok" : "fail"}">${d.success ? d.statusCode : "failed"}</span></td>
              <td>${d.attempt}</td>
              <td>${d.error || "—"}</td>
            </tr>`).join("") : `<tr><td colspan="5" class="empty">No deliveries yet</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

async function renderQuickstart(el: HTMLElement, appId: string) {
  el.innerHTML = `
    <section class="card">
      <h2>Quick start — first call in 5 minutes</h2>
      <ol class="muted" style="padding-left:20px;line-height:1.8;margin-bottom:16px">
        <li>Get a token from your backend using App ID + Secret</li>
        <li>Initialize the SDK and join a room</li>
        <li>Start a voice call or group voice session</li>
        <li>Watch events and webhooks appear in this dashboard</li>
      </ol>
      <pre class="code">// 1. Server-side — issue token
const res = await fetch("http://localhost:4000/v1/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    appId: "${appId}",
    appSecret: "YOUR_APP_SECRET",
    userId: "user_123",
  }),
});
const { token } = await res.json();

// 2. Client-side
import { RTCExpress } from "@rtc/sdk";

const rtc = new RTCExpress();
await rtc.init({
  serverUrl: "http://localhost:4000",
  appId: "${appId}",
  userId: "user_123",
  token,
  mediaMode: "auto",
});

await rtc.joinRoom("room-1");
rtc.sendMessage("Hello!");
await rtc.callUser("user_456");</pre>
      <p class="muted" style="margin-top:12px">Demo app: <a href="http://localhost:5180" target="_blank">http://localhost:5180</a></p>
    </section>
  `;
}

async function boot() {
  if (!getAdminKey()) {
    renderLogin();
    return;
  }
  try {
    await loadEventTypes();
    await api.listApps();
    renderHome();
  } catch {
    renderLogin();
  }
}

boot();
