import { randomUUID } from "node:crypto";
import {
  context,
  createServer,
  getServerPort,
  reddit,
  redis,
  settings,
} from "@devvit/web/server";
import { redisStore } from "./db.ts";
import { handleError, HttpError, routeApi, writeJson } from "./http.ts";
import { makeChallenge, parseChallenge, type Challenge } from "./state.ts";

async function postChallenge(): Promise<Challenge> {
  if (!context.postId)
    throw new HttpError(400, "Open SWEEPER from its challenge post.");
  if (context.postData?.challenge) {
    const challenge = parseChallenge(context.postData.challenge);
    if (!challenge)
      throw new HttpError(
        409,
        "This challenge uses an unsupported game version."
      );
    return challenge;
  }
  const key = `sweeper:post:${context.postId}`;
  const stored = await redis.get(key);
  if (stored) {
    const challenge = parseChallenge(JSON.parse(stored));
    if (!challenge)
      throw new HttpError(
        409,
        "This challenge uses an unsupported game version."
      );
    return challenge;
  }
  const post = await reddit.getPostById(context.postId);
  const challenge = makeChallenge(post.createdAt.toISOString().slice(0, 10));
  await redis.set(key, JSON.stringify(challenge), { nx: true });
  const saved = parseChallenge(JSON.parse((await redis.get(key)) ?? "null"));
  if (!saved)
    throw new HttpError(503, "The challenge could not be loaded. Try again.");
  return saved;
}

async function createDailyPost(): Promise<{ id: string; url: string }> {
  const challenge = makeChallenge();
  const key = `sweeper:daily-post:${challenge.id}`;
  const existing = await redis.get(key);
  if (existing) return JSON.parse(existing) as { id: string; url: string };
  const lockKey = `${key}:creating`;
  const lock = randomUUID();
  const acquired = await redis.set(lockKey, lock, {
    nx: true,
    expiration: new Date(Date.now() + 120_000),
  });
  if (acquired !== "OK")
    throw new HttpError(
      409,
      "Today’s post is being created. Try again shortly."
    );
  try {
    const ready = await redis.get(key);
    if (ready) return JSON.parse(ready) as { id: string; url: string };
    const post = await reddit.submitCustomPost({
      title: `SWEEPER.EXE · ${challenge.date} · Two sectors. One shared challenge.`,
      entry: "default",
      postData: { challenge },
      textFallback: {
        text: "Clear two minefields, spend your keys between sectors, and choose when to use ROOTKIT. Everyone gets the same challenge. Unlimited retries. Open this post in the Reddit app or on reddit.com to play.",
      },
    });
    const created = { id: post.id, url: post.url };
    await redis.set(key, JSON.stringify(created));
    await redis.set(`sweeper:post:${post.id}`, JSON.stringify(challenge));
    return created;
  } finally {
    if ((await redis.get(lockKey)) === lock) await redis.del(lockKey);
  }
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path.startsWith("/api/")) {
      await routeApi(
        request,
        response,
        {
          mode: "reddit",
          challenge: await postChallenge(),
          user: context.userId
            ? { id: context.userId, username: context.username ?? null }
            : null,
        },
        redisStore
      );
      return;
    }
    if (request.method !== "POST") throw new HttpError(404, "Not found.");
    if (path === "/internal/menu/daily-post") {
      const post = await createDailyPost();
      writeJson(response, 200, {
        navigateTo: post.url,
        showToast: { text: "Today’s SWEEPER is ready.", appearance: "success" },
      });
      return;
    }
    if (path === "/internal/install") {
      await createDailyPost();
      writeJson(response, 200, {});
      return;
    }
    if (path === "/internal/scheduler/daily-post") {
      if (await settings.get<boolean>("daily-posts")) await createDailyPost();
      writeJson(response, 200, {});
      return;
    }
    throw new HttpError(404, "Not found.");
  } catch (error) {
    handleError(error, response);
  }
});

server.on("error", (error) => console.error(error.message));
server.listen(getServerPort());
