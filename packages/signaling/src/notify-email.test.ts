import test from 'node:test';
import assert from 'node:assert/strict';
import { sendExtraMinutesEmail, sendNewSignupAlert, sendPlanChangedEmail, ownerAlertRecipients } from './notify-email.js';

test('customer notices and the new sign-up alert go to the right people with clear wording', async t => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  delete process.env.RESEND_API_KEY;
  assert.equal(await sendExtraMinutesEmail('c@example.test', 500, '2026-11', 2500), 'not-configured');

  Object.assign(process.env, { RESEND_API_KEY: 'k', EMAIL_FROM: 'RTCExpress <noreply@x.test>', PUBLIC_WEBSITE_URL: 'https://rtc.example.test', SIGNUP_ALERT_TO: 'boss@example.test' });
  const sent: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); });

  assert.equal(await sendExtraMinutesEmail('c@example.test', 1000, '2026-11', 3000), 'sent');
  assert.deepEqual(sent[0].to, ['c@example.test']);
  assert.match(sent[0].subject, /1,000 complimentary minutes/);
  assert.match(sent[0].text, /November 2026/); assert.match(sent[0].text, /3,000 minutes/);
  assert.match(sent[0].html, /https:\/\/rtc\.example\.test\/#\/portal/);

  await sendPlanChangedEmail('c@example.test', 'Pro', true);
  assert.match(sent[1].subject, /now on the Pro plan/); assert.match(sent[1].text, /complimentary/);

  await sendNewSignupAlert({ accountId: 'id-1', email: 'new<b>@example.test', name: null, company: 'Acme', source: 'from google.com' });
  assert.deepEqual(sent[2].to, ['boss@example.test']);
  assert.equal(sent[2].reply_to, 'new<b>@example.test');
  assert.match(sent[2].text, /from google\.com/); assert.match(sent[2].text, /#\/customers\/id-1/);
  assert.ok(!sent[2].html.includes('new<b>'), 'customer input is escaped in HTML');

  delete process.env.SIGNUP_ALERT_TO; process.env.ENQUIRY_ALERT_TO = 'enq@example.test';
  assert.deepEqual(ownerAlertRecipients(), ['enq@example.test']);

  t.mock.method(globalThis, 'fetch', async () => { throw new Error('down'); });
  assert.equal(await sendPlanChangedEmail('c@example.test', 'Free', false), 'failed', 'never throws');
});
