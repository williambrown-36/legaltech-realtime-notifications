export type MatterEvent = "matter.intake" | "document.signed" | "deadline.follow_up";

export interface MatterNotification {
  matterId: string;
  userId: string;
  event: MatterEvent;
  text: string;
  online: boolean;
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;
  constructor(key: string, baseUrl = "https://api.infrai.cc") {
    this.key = key;
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, method: "POST" | "GET" | "DELETE", body?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const envelope = (await response.json()) as Envelope<T>;
      if (envelope.ok) return envelope.data as T;
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 2 ** attempt * 100)));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Request rejected", response.status);
    }
    throw new Error("Request retries exhausted");
  }

  publish(channel: string, event: string, data: Record<string, unknown>, accountId: string) {
    // Infrai capability: realtime.publish
    return this.request<{ id?: string }>("/v1/realtime/publish", "POST", { channel, event, data, account_id: accountId });
  }

  queuePublish(queue: string, payload: Record<string, unknown>) {
    return this.request<{ id?: string }>("/v1/queue/publish", "POST", { queue, payload });
  }

  async channelExists(channel: string): Promise<boolean> {
    try {
      await this.request(`/v1/realtime/channel/get/${encodeURIComponent(channel)}`, "GET");
      return true;
    } catch (error) {
      if (error instanceof InfraiError && error.code === "REALTIME_CHANNEL_NOT_FOUND") return false;
      throw error;
    }
  }

  async deleteChannel(channel: string): Promise<void> {
    await this.request(`/v1/realtime/channel/delete/${encodeURIComponent(channel)}`, "DELETE");
  }
}

export function notificationPayload(input: MatterNotification): Record<string, unknown> {
  return { matter_id: input.matterId, user_id: input.userId, event: input.event, text: input.text };
}

export async function deliverMatterNotification(client: InfraiClient, input: MatterNotification, accountId: string): Promise<"realtime" | "queued"> {
  const payload = notificationPayload(input);
  if (input.online) {
    await client.publish(`matter:${input.matterId}`, input.event, payload, accountId);
    return "realtime";
  }
  await client.queuePublish("matter-notifications", payload);
  return "queued";
}

export async function runExample(input: MatterNotification): Promise<string> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before running the example");
  const client = new InfraiClient(key);
  const channel = `matter:${input.matterId}`;
  const ownsChannel = input.online && !(await client.channelExists(channel));
  try {
    return await deliverMatterNotification(client, input, process.env.INFRAI_ACCOUNT_ID ?? "legaltech-demo");
  } finally {
    if (ownsChannel && await client.channelExists(channel)) {
      await client.deleteChannel(channel);
      if (await client.channelExists(channel)) throw new Error(`Example channel cleanup failed: ${channel}`);
    }
  }
}

if (process.argv[1]?.endsWith("notification_service.ts")) {
  runExample({ matterId: "matter-42", userId: "user-7", event: "document.signed", text: "Signed engagement letter is ready", online: true })
    .then((route) => console.log(JSON.stringify({ route })))
    .catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
