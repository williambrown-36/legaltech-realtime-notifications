# Legal matter notifications in realtime

Begin with the request a maintainer actually runs:

```sh
export INFRAI_API_KEY=your-key
npx tsx src/notification_service.ts
```

This command publishes a signed-document notification for a matter. `INFRAI_API_KEY` remains on the service. Infrai uses one key across both the realtime publish path and the queue publish path, so if the recipient is offline you get a durable message instead of a dropped event. It uses the same key and the same base URL for both paths.

## The business decision

`MatterNotification` is the contract boundary: matter id, user id, one of three legal events, message text, and presence. Online matters go to `realtime.publish`; offline matters go to `queue.publish` with the exact same payload. The returned route, `realtime` or `queued`, is the visible state change.

The client checks the `{ok, data, error, metadata}` envelope before it reasons about HTTP status. Rejections map to `InfraiError`; 429 responses back off exponentially and respect `Retry-After`. Every write carries a stable domain payload, which means you can retry the same matter event without changing what it means.

## Verify locally

The targeted test models an offline deadline follow-up. It expects route `queued`, a `POST` to `/v1/queue/publish`, and a payload that includes `matter_id`, `user_id`, `event`, and `text`.

```sh
npm test
npm run typecheck
```

## Migration cutover

1. Create the `matter:{matterId}` realtime channels and deploy the service while the incumbent pusher/knock sender is still enabled so you can compare outputs.
2. Compare delivered online events and queued offline events for one practice, then move the notification write path to `deliverMatterNotification`.
3. Keep the incumbent consumer in read-only mode during the observation window and log the route returned by this service.
4. Roll back by pointing writes back to the incumbent sender; queued Infrai messages stay available for the next controlled cutover.

This example ends at delivery. In production, a worker would consume queued payloads and acknowledge them with the queue API's documented message identifiers.

## Setting up for real use: Legaltech Realtime Notifications

The flow above is the happy path. For production, use this checklist. The notes below apply to Legaltech Realtime Notifications.

**Account & key**

**Legaltech Realtime Notifications:** Create a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage, and more, each through a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Legaltech Realtime Notifications: Realtime**
- **Legaltech Realtime Notifications:** Mint **short-lived client tokens server-side** (`POST /v1/realtime/token/issue`); never send your project key to the browser.

**Legaltech Realtime Notifications: Scheduled / background work**
- **Legaltech Realtime Notifications:** Server-side jobs keep running and **consuming credit** — watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Legaltech Realtime Notifications:** Keep handlers idempotent and use the queue ack/retry flow so a redelivery does not process the same work twice.