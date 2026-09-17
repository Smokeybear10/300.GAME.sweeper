import { redis } from "@devvit/web/server";
import { emptyState, type StateStore, type StoredState } from "./state.ts";

function decode(raw: string | undefined): StoredState {
  return raw ? (JSON.parse(raw) as StoredState) : emptyState();
}

export const redisStore: StateStore = {
  async read(key) {
    return decode(await redis.get(key));
  },
  async update(key, change) {
    const transaction = await redis.watch(key);
    let queued = false;
    let finished = false;
    try {
      const current = decode(await redis.get(key));
      const result = change(current);
      if (!result.ok || result.state === current) {
        await transaction.unwatch();
        finished = true;
        return result;
      }
      await transaction.multi();
      queued = true;
      await transaction.set(key, JSON.stringify(result.state));
      const replies: unknown[] = await transaction.exec();
      finished = true;
      if (replies.length === 1 && replies[0] === "OK") return result;
      return { ok: false, state: decode(await redis.get(key)) };
    } finally {
      if (!finished) {
        const cleanup = queued ? transaction.discard() : transaction.unwatch();
        await cleanup.catch(() =>
          console.warn("Could not release Redis transaction.")
        );
      }
    }
  },
};
