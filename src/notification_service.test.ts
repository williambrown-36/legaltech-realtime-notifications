import assert from "node:assert/strict";
import { deliverMatterNotification, InfraiClient, runExample, type MatterNotification } from "./notification_service.ts";

const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  calls.push({ path: String(input), body: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify({ ok: true, data: { id: "accepted" } }), { status: 200, headers: { "content-type": "application/json" } });
};

const offline: MatterNotification = { matterId: "m-1", userId: "u-1", event: "deadline.follow_up", text: "Deadline is tomorrow", online: false };
const route = await deliverMatterNotification(new InfraiClient("test-key", "https://example.test"), offline, "acct-1");
assert.equal(route, "queued");
assert.equal(calls[0].path, "https://example.test/v1/queue/publish");
assert.deepEqual(calls[0].body, { queue: "matter-notifications", payload: { matter_id: "m-1", user_id: "u-1", event: "deadline.follow_up", text: "Deadline is tomorrow" } });
globalThis.fetch = originalFetch;
console.log("offline matter notification is queued");

const originalKey = process.env.INFRAI_API_KEY;
process.env.INFRAI_API_KEY = "test-key";
try {
  for (const preexisting of [false, true]) {
    for (const publishFails of [false, true]) {
      let exists = preexisting;
      let deleted = false;
      globalThis.fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "GET") {
          assert.equal(path, "/v1/realtime/channel/get/matter%3Am-1");
          return new Response(JSON.stringify(exists
            ? { ok: true, data: { name: "matter:m-1" } }
            : { ok: false, error: { code: "REALTIME_CHANNEL_NOT_FOUND" } }), { status: exists ? 200 : 404 });
        }
        if (init?.method === "DELETE") {
          assert.equal(preexisting, false);
          assert.equal(path, "/v1/realtime/channel/delete/matter%3Am-1");
          exists = false;
          deleted = true;
          return new Response(JSON.stringify({ ok: true, data: {} }));
        }
        assert.equal(path, "/v1/realtime/publish");
        exists = true;
        return new Response(JSON.stringify(publishFails
          ? { ok: false, error: { code: "PUBLISH_FAILED" } }
          : { ok: true, data: {} }), { status: publishFails ? 400 : 200 });
      };
      const result = runExample({ ...offline, online: true });
      if (publishFails) await assert.rejects(result, { code: "PUBLISH_FAILED" });
      else assert.equal(await result, "realtime");
      assert.equal(exists, preexisting);
      assert.equal(deleted, !preexisting);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.INFRAI_API_KEY;
  else process.env.INFRAI_API_KEY = originalKey;
}
console.log("example cleans up its channels on success and failure and preserves existing channels");
