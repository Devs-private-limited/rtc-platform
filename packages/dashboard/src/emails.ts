import { adminFetch } from './api';
import { canEdit } from './me';
import { esc, num, pageHeader, when } from './ui';

// Emails page: the welcome email sent automatically after a customer verifies their email.
export async function renderEmailsPage(view: HTMLElement) {
  view.innerHTML = pageHeader('Emails', 'Emails sent to customers automatically. Write them the way you would write to a person: short, friendly, and easy to reply to.') + '<div class="loading">Loading…</div>';
  let data: any;
  try { data = await adminFetch<any>('/v1/admin/emails/welcome'); }
  catch (e) {
    view.querySelector('.loading')!.outerHTML = `<div class="error">${esc(e instanceof Error ? e.message : 'Could not load the email settings')}</div>`;
    return;
  }
  const t = data.template, edit = canEdit(), dis = edit ? '' : 'disabled';
  view.querySelector('.loading')!.outerHTML = `
    <section class="panel">
      <h2>Welcome email ${t.enabled ? '<span class="pill good">On</span>' : '<span class="pill warn">Off</span>'}</h2>
      <p class="note">Sent once to each customer, automatically, right after they verify their email address. Replies go to the reply-to address below, so you can talk with them directly.</p>
      ${data.emailConfigured ? '' : '<p class="warn-box">Email sending is not set up on the server (<code>RESEND_API_KEY</code> / <code>EMAIL_FROM</code>), so nothing will be sent until it is.</p>'}
      <p class="note">Sent so far: <strong>${num(data.stats.sentTotal)}</strong> · last 7 days: <strong>${num(data.stats.sent7d)}</strong> (${num(data.stats.verified7d)} customers verified in that time).
        ${data.isDefault ? 'Using the built-in text.' : `Last edited by ${esc(data.updatedBy || '—')}, ${when(data.updatedAt)}.`}
        Customers who verified before this existed: open their page under Customers and use <strong>Send welcome email</strong>.</p>
      ${edit ? '' : '<p class="note">Your access is view-only, so you can look and preview but not change this email.</p>'}
      <form id="welcome-form" class="manage-card email-form">
        <label class="check"><input type="checkbox" name="enabled" ${t.enabled ? 'checked' : ''} ${dis}> Send this email automatically when a customer verifies their email</label>
        <label>Subject<input name="subject" required maxlength="${data.limits.subject}" value="${esc(t.subject)}" ${dis}></label>
        <label><span>Email text <span class="sub">(leave an empty line between paragraphs)</span></span>
          <textarea name="body" required rows="16" maxlength="${data.limits.body}" ${dis}>${esc(t.body)}</textarea></label>
        <div class="email-row">
          <label><span>Button text <span class="sub">(empty = no button)</span></span><input name="buttonText" maxlength="${data.limits.buttonText}" value="${esc(t.buttonText)}" ${dis}></label>
          <label>Button link<input name="buttonLink" maxlength="${data.limits.buttonLink}" value="${esc(t.buttonLink)}" placeholder="{console_link}" ${dis}></label>
        </div>
        <label><span>Reply-to address <span class="sub">(where their replies arrive; use an inbox you check)</span></span><input name="replyTo" type="email" maxlength="${data.limits.replyTo}" value="${esc(t.replyTo)}" ${dis}></label>
        <div class="note"><strong>You can use:</strong> ${data.placeholders.map(([k, d]: [string, string]) => `<code>${esc(k)}</code> ${esc(d)}`).join(' · ')}</div>
        <div class="email-actions">
          ${edit ? '<button type="submit">Save</button>' : ''}
          <button type="button" class="secondary" id="w-preview">Preview</button>
          ${edit ? '<button type="button" class="secondary" id="w-test">Send a test to me</button>' : ''}
          ${edit && !data.isDefault ? '<button type="button" class="secondary" id="w-reset">Go back to the built-in text</button>' : ''}
        </div>
        <div class="m-msg" id="w-msg" role="status"></div>
      </form>
    </section>
    <section class="panel" id="w-preview-panel" hidden>
      <h2>Preview <span class="sub">(with a sample customer, Priya Sharma)</span></h2>
      <p class="note" id="w-preview-subject"></p>
      <iframe id="w-frame" title="Email preview" sandbox="" style="width:100%;height:720px;border:1px solid var(--rx-line);border-radius:12px;background:#fff"></iframe>
    </section>`;

  const form = view.querySelector<HTMLFormElement>('#welcome-form')!, msg = view.querySelector<HTMLElement>('#w-msg')!;
  const draft = () => ({
    enabled: (form.elements.namedItem('enabled') as HTMLInputElement).checked,
    subject: (form.elements.namedItem('subject') as HTMLInputElement).value,
    body: (form.elements.namedItem('body') as HTMLTextAreaElement).value,
    buttonText: (form.elements.namedItem('buttonText') as HTMLInputElement).value,
    buttonLink: (form.elements.namedItem('buttonLink') as HTMLInputElement).value,
    replyTo: (form.elements.namedItem('replyTo') as HTMLInputElement).value,
  });
  const say = (text: string, error = false) => { msg.className = `m-msg${error ? ' error' : ''}`; msg.textContent = text; };
  const run = async (btn: HTMLButtonElement | null, busy: string, task: () => Promise<string | void>) => {
    if (btn) btn.disabled = true;
    say(busy);
    try { say((await task()) || ''); }
    catch (err) { say(err instanceof Error ? err.message : 'Something went wrong', true); }
    finally { if (btn) btn.disabled = false; }
  };

  const previewBtn = view.querySelector<HTMLButtonElement>('#w-preview')!;
  previewBtn.onclick = () => void run(previewBtn, 'Making the preview…', async () => {
    const p = await adminFetch<any>('/v1/admin/emails/welcome/preview', { method: 'POST', body: JSON.stringify(draft()) });
    const panel = view.querySelector<HTMLElement>('#w-preview-panel')!;
    panel.hidden = false;
    view.querySelector('#w-preview-subject')!.innerHTML = `<strong>Subject:</strong> ${esc(p.subject)}${p.replyTo ? ` · <strong>Replies go to:</strong> ${esc(p.replyTo)}` : ''}`;
    view.querySelector<HTMLIFrameElement>('#w-frame')!.srcdoc = p.html;
    panel.scrollIntoView({ behavior: 'smooth' });
  });

  if (!edit) return;
  form.onsubmit = (e) => {
    e.preventDefault();
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]');
    const d = draft();
    if (!d.enabled && !confirm('Turn the welcome email off? New customers will not get it until you turn it back on.')) return;
    void run(btn, 'Saving…', async () => {
      await adminFetch('/v1/admin/emails/welcome', { method: 'PUT', body: JSON.stringify(d) });
      await renderEmailsPage(view);
      const again = view.querySelector<HTMLElement>('#w-msg');
      if (again) { again.className = 'm-msg'; again.textContent = d.enabled ? 'Saved. New customers get this email after they verify.' : 'Saved. The welcome email is off.'; }
    });
  };
  const testBtn = view.querySelector<HTMLButtonElement>('#w-test');
  if (testBtn) testBtn.onclick = () => void run(testBtn, 'Sending…', async () => {
    const r = await adminFetch<any>('/v1/admin/emails/welcome/test', { method: 'POST', body: JSON.stringify(draft()) });
    return `Test sent to ${r.sentTo}. It uses this text even if you haven't saved it yet. Check spam if you don't see it.`;
  });
  const resetBtn = view.querySelector<HTMLButtonElement>('#w-reset');
  if (resetBtn) resetBtn.onclick = () => {
    if (!confirm('Replace your text with the built-in welcome email?')) return;
    void run(resetBtn, 'Resetting…', async () => { await adminFetch('/v1/admin/emails/welcome', { method: 'DELETE' }); await renderEmailsPage(view); });
  };
}
