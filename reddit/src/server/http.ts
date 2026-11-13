import type { IncomingMessage, ServerResponse } from "node:http";
import {
  applySave,
  emptyState,
  playerKey,
  publicState,
  saveSchema,
  type RequestContext,
  type StateStore,
} from "./state.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(json);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new HttpError(415, "Send JSON content.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64_000) throw new HttpError(413, "Run snapshot is too large.");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

export async function routeApi(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
  store: StateStore
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/api/bootstrap" && request.method === "GET") {
    const state = context.user
      ? await store.read(playerKey(context))
      : emptyState();
    writeJson(response, 200, { ...context, state: publicState(state) });
    return;
  }
  if (
    (path !== "/api/save" && path !== "/api/result") ||
    request.method !== "POST"
  ) {
    throw new HttpError(404, "Not found.");
  }
  if (!context.user)
    throw new HttpError(
      401,
      "Sign in to save progress to your Reddit account."
    );
  const parsed = saveSchema.safeParse(await readJson(request));
  if (!parsed.success)
    throw new HttpError(400, "This run could not be validated.");
  const input = parsed.data;
  if (
    input.challengeId !== context.challenge.id ||
    input.snapshot.date !== context.challenge.date ||
    input.snapshot.version !== context.challenge.version
  ) {
    throw new HttpError(409, "This run belongs to a different challenge.");
  }
  const terminal =
    input.snapshot.phase === "won" || input.snapshot.phase === "lost";
  if ((path === "/api/result") !== terminal) {
    throw new HttpError(
      400,
      terminal
        ? "Send a finished run to the result endpoint."
        : "This run is still active."
    );
  }
  const result = await store.update(playerKey(context), (state) =>
    applySave(state, input)
  );
  writeJson(response, result.ok ? 200 : 409, {
    ok: result.ok,
    revision: result.state.revision,
    state: publicState(result.state),
    ...(!result.ok
      ? { error: "A newer save exists. Reload it before continuing." }
      : {}),
  });
}

export function handleError(error: unknown, response: ServerResponse): void {
  if (response.writableEnded) return;
  if (error instanceof HttpError) {
    writeJson(response, error.status, { error: error.message });
    return;
  }
  console.error(
    error instanceof Error ? error.message : "Server request failed"
  );
  writeJson(response, 503, {
    error: "Saving is unavailable right now. Your game can continue locally.",
  });
}
