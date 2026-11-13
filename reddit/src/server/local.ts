import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { handleError, routeApi } from "./http.ts";
import {
  emptyState,
  makeChallenge,
  type StateStore,
  type StoredState,
} from "./state.ts";

const directory = resolve(".local/runs");
let pending: Promise<unknown> = Promise.resolve();

const fileFor = (key: string) =>
  resolve(directory, `${createHash("sha256").update(key).digest("hex")}.json`);

async function readState(key: string): Promise<StoredState> {
  try {
    return JSON.parse(await readFile(fileFor(key), "utf8")) as StoredState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return emptyState();
    throw error;
  }
}

const store: StateStore = {
  async read(key) {
    await pending;
    return readState(key);
  },
  update(key, change) {
    const operation = pending.then(async () => {
      const current = await readState(key);
      const result = change(current);
      if (result.ok && result.state !== current) {
        await mkdir(directory, { recursive: true });
        const path = fileFor(key);
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(result.state));
        await rename(temporary, path);
      }
      return result;
    });
    pending = operation.catch(() => undefined);
    return operation;
  },
};

createServer(async (request, response) => {
  try {
    const match = /(?:^|;\s*)sweeper_local=([a-f0-9-]{36})(?:;|$)/.exec(
      request.headers.cookie ?? ""
    );
    const userId = match?.[1] ?? randomUUID();
    if (!match)
      response.setHeader(
        "Set-Cookie",
        `sweeper_local=${userId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`
      );
    await routeApi(
      request,
      response,
      {
        mode: "local",
        challenge: makeChallenge(),
        user: { id: userId, username: "Local player" },
      },
      store
    );
  } catch (error) {
    handleError(error, response);
  }
}).listen(8787, "127.0.0.1", () =>
  console.log("Local SWEEPER API: http://127.0.0.1:8787")
);
