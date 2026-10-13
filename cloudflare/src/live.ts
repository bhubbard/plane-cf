import { Env } from "./types";

export class LiveRoomDO {
  private state: DurableObjectState;
  private env: Env;
  private roomDocState: Uint8Array | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Load initial room state from Durable Object storage if present
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Uint8Array>("doc_state");
      if (stored) {
        this.roomDocState = stored;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // REST inspect or health check on room
    if (request.headers.get("Upgrade") !== "websocket") {
      const activeSockets = this.state.getWebSockets().length;
      return new Response(
        JSON.stringify({
          status: "active",
          clients: activeSockets,
          hasDocState: !!this.roomDocState,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Handle WebSocket upgrade
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const clientProtocol = request.headers.get("Sec-WebSocket-Protocol") || undefined;
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";

    // Accept WebSocket with hibernatable support
    this.state.acceptWebSocket(server, [clientIp]);

    // If we have stored doc state, send it as initial sync to the connecting client
    if (this.roomDocState) {
      try {
        server.send(this.roomDocState);
      } catch {
        // Ignored if client is not ready
      }
    }

    const responseHeaders: Record<string, string> = {};
    if (clientProtocol) {
      responseHeaders["Sec-WebSocket-Protocol"] = clientProtocol;
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: responseHeaders,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // If binary message (e.g. Yjs update), store latest state and broadcast to peers
    if (message instanceof ArrayBuffer) {
      this.roomDocState = new Uint8Array(message);
      // Persist to Durable Object storage asynchronously
      this.state.storage.put("doc_state", this.roomDocState);
    }

    // Broadcast message to all other connected peers in this room
    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      if (socket !== ws) {
        try {
          socket.send(message);
        } catch {
          // Socket might be closed or closing
        }
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    ws.close(code, "Durable Object live connection closed");
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    ws.close(1011, "WebSocket internal error");
  }
}
