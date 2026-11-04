import { renderEnquiries } from "./enquiries";
import "./style.css";
import { api, adminLogin, getAdminSession, setAdminSession, type AppRecord } from "./api";
import { renderCustomerList, renderCustomerDetail, escapeHtml } from './customers';
import { renderOverviewPage } from './overview';
import { renderPaymentsPage } from './payments';
import { renderPlansPage } from './plans';
import { renderTeamPage } from './team';
import { renderHistoryPage } from './history';
import { me, ROLE_NAMES } from './me';
import { adminFetch } from './api';

const root = document.getElementById("app")!;
// The page area inside the admin shell; the developer-tool screens below draw into it.
let app: HTMLElement = root;
let selectedApp: AppRecord | null = null;
let activeTab: "overview" | "events" | "webhooks" | "deliveries" | "quality" | "billing" | "quickstart" = "overview";
let eventTypes: string[] = [];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function renderLogin() {
  app = root;
  document.body.classList.add("shell-on");
  root.innerHTML = `
    <div class="login-page">
      <section class="login-card">
        <div class="login-brand"><span aria-hidden="true">&#8767;</span>RTCExpress <em>Admin</em></div>
        <h1>Sign in to the admin panel</h1>
        <p class="muted">For the RTCExpress team only. Customers use the <a href="https://rtc.devsquarelabs.com/#/login" target="_blank" rel="noopener">console</a>.</p>
        <form id="login-form">
          <label>Email<input id="admin-email" type="email" autocomplete="username" required /></label>
          <label>Password<input id="admin-password" type="password" autocomplete="current-password" required /></label>
          <button id="login-btn" type="submit">Sign in</button>
        </form>
        <div id="login-error" class="error" role="alert"></div>
        <div class="login-help">
          <strong>How admin access works</strong>
          <ol>
            <li>Use the email and password of a normal RTCExpress console account. No console account yet? <a href="https://rtc.devsquarelabs.com/#/signup" target="_blank" rel="noopener">Sign up</a> first.</li>
            <li>That email must also be on the server’s admin list (<code>ADMIN_EMAILS</code> on the VM). Nobody can add themselves; only the owner can, on the server.</li>
            <li>Forgot the password? <a href="https://rtc.devsquarelabs.com/#/account" target="_blank" rel="noopener">Reset it here</a>.</li>
          </ol>
          <p class="muted">For security, a wrong password and an email that isn’t an admin both show the same message.</p>
        </div>
      </section>
    </div>
  `;

  const form = document.getElementById("login-form") as HTMLFormElement;
  const btn = document.getElementById("login-btn") as HTMLButtonElement;
  const err = document.getElementById("login-error")!;

  form.onsubmit = async (event) => {
    event.preventDefault();
    err.textContent = "";
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await adminLogin((document.getElementById("admin-email") as HTMLInputElement).value.trim(), (document.getElementById("admin-password") as HTMLInputElement).value);
      await loadEventTypes();
      if (!location.hash || location.hash === "#/") location.hash = "#/overview";
      await loadMe();
      renderShell();
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : "Sign-in failed";
      btn.disabled = false;
      btn.textContent = "Sign in";
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
    <header class="page-head"><div><h1>Projects</h1><p>Every RTC project on the server. Open one to see its events, call quality, plan and webhooks.</p></div></header>
    <section class="card">
      <h2>Projects</h2>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      <div class="app-list" id="app-list">
        ${apps.length ? apps.map((a) => `
          <button type="button" class="app-item" data-app="${escapeHtml(a.appId)}">
            <div>
              <strong>${escapeHtml(a.name)}</strong>
              <span>${escapeHtml(a.appId)}</span>
            </div>
            <span class="badge ${a.active ? "ok" : "off"}">${a.active ? "active" : "inactive"}</span>
          </button>
        `).join("") : `<div class="empty">No projects yet.</div>`}
      </div>
    </section>
  `;

  document.querySelectorAll(".app-item").forEach((el) => {
    el.addEventListener("click", () => {
      const appId = (el as HTMLElement).dataset.app!;
      selectedApp = apps.find((a) => a.appId === appId) || null;
      activeTab = "overview";
      renderAppDetail();
    });
  });

}

async function renderAppDetail() {
  if (!selectedApp) return;
  const appId = selectedApp.appId;

  app.innerHTML = `
    <header class="top">
      <div>
        <h1>${escapeHtml(selectedApp.name)}</h1>
        <p>${escapeHtml(appId)}</p>
      </div>
      <div class="row">
        <button class="secondary" id="back-btn">← Projects</button>
      </div>
    </header>
    <div class="tabs">
      ${(["overview", "events", "quality", "billing", "webhooks", "deliveries", "quickstart"] as const)
        .map((t) => `<button class="tab ${activeTab === t ? "active" : ""}" data-tab="${t}">${t}</button>`)
        .join("")}
    </div>
    <div id="tab-content"></div>
  `;

  document.getElementById("back-btn")!.onclick = () => {
    selectedApp = null;
    renderHome();
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
    else if (activeTab === "quality") await renderQuality(content, appId);
    else if (activeTab === "billing") await renderBilling(content, appId);
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

async function renderBilling(el: HTMLElement, appId: string) {
  const billing = await api.getBilling(appId);
  const metrics = [
    ["Voice minutes", "voiceMinutes"],
    ["Video minutes", "videoMinutes"],
    ["Messages", "messages"],
    ["Recordings", "recordings"],
    ["Transcription min", "transcriptionMinutes"],
    ["Quality reports", "qualityReports"],
  ] as const;
  const featureRows = [
    ["Chat", "chat"],
    ["Voice calls", "voice"],
    ["Video calls", "video"],
    ["Group voice", "groupVoice"],
    ["Group video", "groupVideo"],
    ["Recording", "recording"],
    ["Transcription", "transcription"],
    ["Screen share", "screenShare"],
  ] as const;

  el.innerHTML = `
    <section class="card">
      <h2>Billing — ${billing.planName} plan</h2>
      <p class="muted" style="margin-bottom:12px">${billing.planDescription || ""}</p>
      <div class="row" style="margin-bottom:16px">
        <label>Change plan
          <select id="plan-select">
            <option value="free" ${billing.plan === "free" ? "selected" : ""}>Free — chat + 1:1 voice</option>
            <option value="starter" ${billing.plan === "starter" ? "selected" : ""}>Starter — chat + voice</option>
            <option value="pro" ${billing.plan === "pro" ? "selected" : ""}>Pro — chat + voice + video</option>
          </select>
        </label>
        <button id="save-plan-btn">Update plan</button>
      </div>
      <div id="plan-error" class="error"></div>
    </section>
    <section class="card">
      <h2>Plan features</h2>
      <table>
        <thead><tr><th>Feature</th><th>Included</th></tr></thead>
        <tbody>
          ${featureRows.map(([label, key]) => {
            const enabled = billing.features?.[key];
            return `<tr>
              <td>${label}</td>
              <td><span class="badge ${enabled ? "ok" : "off"}">${enabled ? "yes" : "no"}</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>Usage vs limits</h2>
      <table>
        <thead><tr><th>Metric</th><th>Used</th><th>Limit</th><th>%</th><th>Status</th></tr></thead>
        <tbody>
          ${metrics.map(([label, key]) => {
            const s = billing.limitStatus[key];
            return `<tr>
              <td>${label}</td>
              <td>${s.used}</td>
              <td>${s.limit}</td>
              <td>${s.percent}%</td>
              <td><span class="badge ${s.exceeded ? "fail" : s.percent >= 80 ? "off" : "ok"}">${s.exceeded ? "exceeded" : s.percent >= 80 ? "warning" : "ok"}</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;

  document.getElementById("save-plan-btn")!.onclick = async () => {
    const plan = (document.getElementById("plan-select") as HTMLSelectElement).value;
    const errEl = document.getElementById("plan-error")!;
    errEl.textContent = "";
    try {
      await api.setPlan(appId, plan);
      renderBilling(el, appId);
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : "Failed to update plan";
    }
  };
}

async function renderQuality(el: HTMLElement, appId: string) {
  const [summary, { reports }] = await Promise.all([
    api.getQualitySummary(appId),
    api.listQualityReports(appId, 100),
  ]);

  el.innerHTML = `
    <section class="card">
      <h2>Call quality summary</h2>
      <div class="grid-2">
        <div class="stat"><div class="label">Avg score</div><div class="value">${summary.avgScore || "—"}</div></div>
        <div class="stat"><div class="label">Reports</div><div class="value">${summary.reportCount}</div></div>
        <div class="stat"><div class="label">Avg RTT</div><div class="value">${summary.avgRttMs != null ? `${summary.avgRttMs}ms` : "—"}</div></div>
        <div class="stat"><div class="label">Avg packet loss</div><div class="value">${summary.avgPacketLossPct != null ? `${summary.avgPacketLossPct}%` : "—"}</div></div>
        <div class="stat"><div class="label">Excellent</div><div class="value">${summary.excellentCount}</div></div>
        <div class="stat"><div class="label">Poor</div><div class="value">${summary.poorCount}</div></div>
      </div>
    </section>
    <section class="card">
      <h2>Recent quality reports</h2>
      <table>
        <thead><tr><th>Time</th><th>Score</th><th>Label</th><th>RTT</th><th>Loss</th><th>Room</th><th>User</th></tr></thead>
        <tbody>
          ${reports.length ? reports.map((r) => `
            <tr>
              <td>${fmtDate(r.createdAt)}</td>
              <td>${r.qualityScore}</td>
              <td>${r.qualityLabel}</td>
              <td>${r.rttMs != null ? `${r.rttMs}ms` : "—"}</td>
              <td>${r.packetLossPct != null ? `${r.packetLossPct}%` : "—"}</td>
              <td>${r.roomId}</td>
              <td>${r.userId}</td>
            </tr>`).join("") : `<tr><td colspan="7" class="empty">No quality reports yet.</td></tr>`}
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
            </tr>`).join("") : `<tr><td colspan="4" class="empty">No events yet.</td></tr>`}
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
const res = await fetch("${window.location.origin}/v1/token", {
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
import { RTCExpress } from "rtcexpress";

const rtc = new RTCExpress();
await rtc.init({
  serverUrl: "${window.location.origin}",
  appId: "${appId}",
  userId: "user_123",
  token,
  mediaMode: "auto",
});

await rtc.joinRoom("room-1");
rtc.sendMessage("Hello!");
await rtc.callUser("user_456");</pre>
    </section>
  `;
}

const NAV = [
  ["overview", "Overview"],
  ["customers", "Customers"],
  ["payments", "Payments"],
  ["enquiries", "Enquiries"],
  ["plans", "Plans & prices"],
  ["team", "Admin team"],
  ["history", "Change history"],
  ["projects", "Projects (dev tools)"],
] as const;

function signOut() {
  setAdminSession("");
  selectedApp = null;
  location.hash = "";
  renderLogin();
}

function renderShell() {
  document.body.classList.add("shell-on");
  root.innerHTML = `
    <div class="shell">
      <aside class="side">
        <a class="side-brand" href="#/overview"><span aria-hidden="true">&#8767;</span>RTCExpress<em>Admin</em></a>
        <nav>${NAV.map(([id, label]) => `<a href="#/${id}" data-nav="${id}">${label}</a>`).join("")}</nav>
        <div class="side-foot"><div class="side-user"><strong>${me.email.replace(/[<>&"']/g, "")}</strong><span>${ROLE_NAMES[me.role]}</span></div><button class="side-out" id="side-out">Sign out</button></div>
      </aside>
      <main id="view" class="view"></main>
    </div>`;
  app = root.querySelector<HTMLElement>("#view")!;
  root.querySelector<HTMLButtonElement>("#side-out")!.onclick = signOut;
  route();
}

function route() {
  const view = root.querySelector<HTMLElement>("#view");
  if (!view) return;
  app = view;
  const [section = "overview", id] = location.hash.replace(/^#\/?/, "").split("/");
  root.querySelectorAll<HTMLElement>("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === section));
  window.scrollTo(0, 0);
  if (section === "customers" && id) return void renderCustomerDetail(view, decodeURIComponent(id));
  if (section === "customers") return void renderCustomerList(view);
  if (section === "payments") return void renderPaymentsPage(view);
  if (section === "enquiries") return renderEnquiries(view);
  if (section === "plans") return void renderPlansPage(view);
  if (section === "team") return void renderTeamPage(view);
  if (section === "history") return void renderHistoryPage(view);
  if (section === "projects") { selectedApp = null; return void renderHome(); }
  return void renderOverviewPage(view);
}

window.addEventListener("hashchange", route);

async function loadMe() {
  Object.assign(me, await adminFetch<{ email: string; role: typeof me.role }>("/v1/admin/me"));
}

async function boot() {
  if (!getAdminSession()) {
    renderLogin();
    return;
  }
  try {
    await loadEventTypes();
    await loadMe();
    renderShell();
  } catch {
    renderLogin();
  }
}

boot();
