export const DEFAULT_SERVER_URL = "https://api.devsquarelabs.com";

export type RoomRole = "host" | "publisher" | "subscriber" | "audience";

export interface RTCExpressServerOptions {
  appId: string;
  /** Keep this on your server. Never send it to a browser or mobile app. */
  appSecret: string;
  serverUrl?: string;
  /** Request timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
}

export interface CreateTokenOptions {
  userId: string;
  /** Limit the token to one room. Recommended. */
  roomId?: string;
  role?: RoomRole;
}

export interface TokenResponse {
  token: string;
  /** Seconds until the token expires. */
  expiresIn: number;
}

export class RTCExpressError extends Error {
  /** HTTP status from the API, or 0 when the request never got a response. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RTCExpressError";
    this.status = status;
  }
}

export class RTCExpressServer {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly serverUrl: string;
  private readonly timeoutMs: number;

  constructor(options: RTCExpressServerOptions) {
    if (!options?.appId) throw new TypeError("appId is required");
    if (!options.appSecret) throw new TypeError("appSecret is required");
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.serverUrl = (options.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Requests a short-lived user token to pass to a client SDK's init(). */
  async createToken(options: CreateTokenOptions): Promise<TokenResponse> {
    if (!options?.userId) throw new TypeError("userId is required");

    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/v1/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: this.appId,
          appSecret: this.appSecret,
          userId: options.userId,
          roomId: options.roomId,
          role: options.role,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new RTCExpressError(`Could not reach RTCExpress: ${reason}`, 0);
    }

    const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string };
    if (!res.ok) {
      throw new RTCExpressError(body.error || `RTCExpress returned HTTP ${res.status}`, res.status);
    }
    if (typeof body.token !== "string" || typeof body.expiresIn !== "number") {
      throw new RTCExpressError("Unexpected response from RTCExpress", res.status);
    }
    return { token: body.token, expiresIn: body.expiresIn };
  }
}

export default RTCExpressServer;
