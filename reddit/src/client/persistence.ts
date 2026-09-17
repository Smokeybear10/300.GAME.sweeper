import { z } from "zod";
import { isSnapshot, type Snapshot } from "../shared/engine";

const resultSchema = z.object({
  runId: z.uuid(),
  outcome: z.enum(["won", "lost"]),
  progress: z.number().int().min(0).max(2),
  finishedAt: z.string(),
});
const activeSchema = z.object({
  runId: z.uuid(),
  snapshot: z.custom<Snapshot>(isSnapshot),
});
const stateSchema = z.object({
  revision: z.number().int().nonnegative(),
  activeRun: activeSchema.nullable(),
  latestResult: resultSchema.nullable(),
  bestProgress: z.number().int().min(0).max(2),
});
const bootstrapSchema = z.object({
  mode: z.enum(["reddit", "local"]),
  challenge: z.object({
    id: z.string(),
    date: z.iso.date(),
    version: z.string(),
  }),
  user: z
    .object({ id: z.string(), username: z.string().nullable() })
    .nullable(),
  state: stateSchema,
});
const mutationSchema = activeSchema.extend({
  revision: z.number().int().nonnegative(),
});
const cachedSchema = activeSchema.extend({
  revision: z.number().int().nonnegative(),
  dirty: z.boolean(),
  bestProgress: z.number().int().min(0).max(2),
  pending: z.array(activeSchema).default([]),
  inFlight: mutationSchema.nullable().default(null),
});
type Cached = z.infer<typeof cachedSchema>;
type ActiveRun = z.infer<typeof activeSchema>;
type Mutation = z.infer<typeof mutationSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type SaveStatus =
  "saved" | "saving" | "local" | "offline" | "conflict" | "unavailable";
const terminal = (item: ActiveRun) =>
  item.snapshot.phase === "won" || item.snapshot.phase === "lost";
const identical = (left: ActiveRun, right: ActiveRun) =>
  left.runId === right.runId &&
  JSON.stringify(left.snapshot) === JSON.stringify(right.snapshot);
const REQUEST_TIMEOUT = 10_000;
const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

async function fetchBootstrap(): Promise<Bootstrap> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch("/api/bootstrap", {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("The recovery could not be opened. Please try again.");
    return bootstrapSchema.parse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export class ProgressStore {
  readonly bootstrap: Bootstrap;
  active: ActiveRun | null;
  bestProgress: number;
  status: SaveStatus;
  onChange = () => {};
  private revision: number;
  private pending: ActiveRun[] = [];
  private inFlight: Mutation | null = null;
  private saving = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private changeVersion = 0;
  private readonly key: string;
  private storageAvailable = true;

  private constructor(bootstrap: Bootstrap) {
    this.bootstrap = bootstrap;
    this.revision = bootstrap.state.revision;
    this.bestProgress = bootstrap.state.bestProgress;
    this.active = bootstrap.state.activeRun;
    this.status = bootstrap.user ? "saved" : "local";
    this.key = `sweeper:recovery:${bootstrap.user?.id ?? "guest"}:${
      bootstrap.challenge.id
    }`;
    const cached = this.readCache();
    if (cached && cached.snapshot.date === bootstrap.challenge.date) {
      const sameBase = cached.revision === this.revision;
      const latest = bootstrap.state.latestResult?.runId === cached.runId;
      if (
        (sameBase && cached.dirty) ||
        cached.inFlight ||
        (sameBase && terminal(cached) && latest) ||
        !bootstrap.user
      ) {
        this.active = { runId: cached.runId, snapshot: cached.snapshot };
        this.bestProgress = Math.max(this.bestProgress, cached.bestProgress);
        if (cached.dirty && bootstrap.user) {
          this.revision = cached.revision;
          this.inFlight = cached.inFlight;
          this.pending = cached.pending;
          if (!this.inFlight && !this.pending.length)
            this.pending.push(this.active);
          this.status = "offline";
        }
      }
    }
  }

  static async open(): Promise<ProgressStore> {
    const store = new ProgressStore(await fetchBootstrap());
    void store.flush();
    return store;
  }

  async refresh(): Promise<boolean> {
    if (!this.canRefresh()) return false;
    const revision = this.revision;
    const changeVersion = this.changeVersion;
    let canonical: Bootstrap;
    try {
      canonical = await fetchBootstrap();
    } catch {
      return false;
    }
    if (
      !this.canRefresh() ||
      this.revision !== revision ||
      this.changeVersion !== changeVersion ||
      canonical.mode !== this.bootstrap.mode ||
      canonical.user?.id !== this.bootstrap.user?.id ||
      canonical.challenge.id !== this.bootstrap.challenge.id ||
      canonical.challenge.date !== this.bootstrap.challenge.date ||
      canonical.challenge.version !== this.bootstrap.challenge.version ||
      canonical.state.revision < revision
    )
      return false;

    const cached = this.readCache();
    if (cached?.dirty || cached?.inFlight || cached?.pending.length)
      return false;
    let active = canonical.state.activeRun;
    const latest = canonical.state.latestResult;
    if (
      !active &&
      cached &&
      terminal(cached) &&
      cached.revision === canonical.state.revision &&
      cached.snapshot.date === canonical.challenge.date &&
      cached.snapshot.version === canonical.challenge.version &&
      cached.runId === latest?.runId &&
      cached.snapshot.phase === latest.outcome &&
      (cached.snapshot.phase === "won" ? 2 : cached.snapshot.stage) ===
        latest.progress
    )
      active = { runId: cached.runId, snapshot: cached.snapshot };

    this.bootstrap.state = canonical.state;
    this.revision = canonical.state.revision;
    this.active = active;
    this.bestProgress = canonical.state.bestProgress;
    this.changeVersion++;
    if (active) this.persistCache();
    else this.clearCache();
    this.setStatus("saved");
    return true;
  }

  save(runId: string, snapshot: Snapshot): void {
    if (this.status === "conflict") return;
    this.changeVersion++;
    const progress =
      snapshot.phase === "won"
        ? 2
        : snapshot.stage === 1 || snapshot.phase === "shop"
          ? 1
          : 0;
    this.bestProgress = Math.max(this.bestProgress, progress);
    this.active = { runId, snapshot: structuredClone(snapshot) };
    if (!this.bootstrap.user) {
      this.persistCache();
      this.setStatus(this.storageAvailable ? "local" : "unavailable");
      return;
    }
    const tail = this.pending.at(-1);
    if (tail && !terminal(tail) && tail.runId === runId)
      this.pending[this.pending.length - 1] = this.active;
    else {
      const newest = tail ?? this.inFlight;
      if (!newest || !identical(newest, this.active))
        this.pending.push(this.active);
    }
    this.persistCache();
    if (!this.retryTimer) void this.flush();
  }

  async flush(retrying = false): Promise<void> {
    if (
      this.saving ||
      (!this.inFlight && !this.pending.length) ||
      !this.bootstrap.user ||
      this.status === "conflict"
    )
      return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (!retrying) this.retryAttempt = 0;
    this.saving = true;
    this.setStatus("saving");
    while (this.inFlight || this.pending.length) {
      if (!this.inFlight) {
        this.inFlight = { ...this.pending.shift()!, revision: this.revision };
        this.persistCache();
      }
      const item = this.inFlight;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      try {
        const response = await fetch(
          terminal(item) ? "/api/result" : "/api/save",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            signal: controller.signal,
            body: JSON.stringify({
              challengeId: this.bootstrap.challenge.id,
              ...item,
            }),
          },
        );
        if (response.status === 409) {
          this.inFlight = null;
          this.pending = [];
          this.clearCache();
          this.setStatus("conflict");
          this.saving = false;
          return;
        }
        if (!response.ok) throw new Error("Save unavailable");
        const saved = z
          .object({
            revision: z.number().int().nonnegative(),
            state: stateSchema,
          })
          .parse(await response.json());
        this.bootstrap.state = saved.state;
        this.revision = saved.revision;
        this.bestProgress = Math.max(
          this.bestProgress,
          saved.state.bestProgress,
        );
        this.inFlight = null;
        this.retryAttempt = 0;
        this.persistCache();
      } catch {
        this.setStatus(this.storageAvailable ? "offline" : "unavailable");
        this.saving = false;
        this.scheduleRetry();
        return;
      } finally {
        clearTimeout(timeout);
      }
    }
    this.saving = false;
    this.setStatus("saved");
  }

  private canRefresh(): boolean {
    return (
      Boolean(this.bootstrap.user) &&
      !this.saving &&
      !this.inFlight &&
      !this.pending.length &&
      this.status !== "conflict"
    );
  }

  private scheduleRetry(): void {
    const delay = RETRY_DELAYS[this.retryAttempt];
    if (delay === undefined) return;
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush(true);
    }, delay);
  }

  private setStatus(status: SaveStatus): void {
    this.status = status;
    this.onChange();
  }
  private persistCache(): void {
    if (!this.active) return;
    this.writeCache({
      ...this.active,
      revision: this.revision,
      dirty: this.inFlight !== null || this.pending.length > 0,
      bestProgress: this.bestProgress,
      pending: this.pending,
      inFlight: this.inFlight,
    });
  }
  private readCache(): Cached | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = cachedSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      this.storageAvailable = false;
      return null;
    }
  }
  private clearCache(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      this.storageAvailable = false;
    }
  }
  private writeCache(value: Cached): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(value));
    } catch {
      this.storageAvailable = false;
    }
  }
}
