# Android call push — configuration required

The signaling server can send Android call invitations through [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api). Delivery uses short-lived OAuth credentials. Firebase authorization and device behavior must be tested separately.

**Customers normally upload their Firebase service-account key themselves** in the portal (Service management → In-app chat). That key is encrypted with `PUSH_CREDENTIALS_KEY` and takes priority. See [PUSH.md](PUSH.md) for the customer setup steps. The file below is an **operator-only fallback**, used only for App IDs with no uploaded key.

Set `FCM_CONFIG_FILE` to a server-only JSON file mapping each RTC App ID to that customer's Firebase service-account JSON:

```json
{
  "app_example": {
    "project_id": "customer-firebase-project",
    "client_email": "service-account@customer-firebase-project.iam.gserviceaccount.com",
    "private_key": "SERVICE_ACCOUNT_PRIVATE_KEY"
  }
}
```

Provision this fallback file securely; never put it in an APK or commit it. Set file permissions appropriately and mount it read-only into the signaling container. A project's credentials are never used for another App ID. Unconfigured projects continue to use the existing customer-webhook approach.

After app login and whenever FCM rotates its token, call:

```text
POST /v1/push/devices
Authorization: Bearer <RTC user token>
Content-Type: application/json

{"installationId":"stable-random-device-uuid","token":"FCM-registration-token"}
```

Unregister on logout with `DELETE /v1/push/devices/<installationId>`, using the current RTC user token. Generate installation IDs randomly and persist them on the device. Do not use portal tokens. Re-register when switching users on a shared device.

The Android app must receive the data message, check `expiresAt`, show the permitted incoming-call UI, and reconnect using an authenticated RTC user token. The server replays a still-pending invitation on reconnect. Push reception and ringing UI are not automatically installed by this server change; the customer app must integrate Firebase Messaging and the platform's notification permissions/lifecycle handling.

Push attempts are visible in Portal → Diagnostics. FCM acceptance does not prove phone delivery. Tokens explicitly reported as `UNREGISTERED` are removed. Requests have a timeout and no automatic push retry; calls expire after 60 seconds. A failed push must not block normal signaling.

Current scope: pending calls do not survive a signaling restart. iOS APNs/PushKit sending is covered in [OFFLINE-NOTIFICATIONS.md](OFFLINE-NOTIFICATIONS.md). A missed-call inbox and device-verified background/terminated-app behavior are not implemented here.
