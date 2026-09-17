import { createHash } from "node:crypto";
import { z } from "zod";
import { isSnapshot, VERSION, type Snapshot } from "../shared/engine.ts";

export type Challenge = { id: string; date: string; version: string };
export type RunResult = {
  runId: string;
  outcome: "won" | "lost";
  progress: number;
  finishedAt: string;
};
export type PlayerState = {
  revision: number;
  activeRun: { runId: string; snapshot: Snapshot } | null;
  latestResult: RunResult | null;
  bestProgress: number;
};
export type StoredState = PlayerState & { lastMutation?: string };
export type UpdateResult = { ok: boolean; state: StoredState };
export type StateStore = {
  read(key: string): Promise<StoredState>;
  update(
    key: string,
    change: (state: StoredState) => UpdateResult
  ): Promise<UpdateResult>;
};
export type RequestContext = {
  mode: "reddit" | "local";
  challenge: Challenge;
  user: { id: string; username: string | null } | null;
};

export const saveSchema = z.object({
  challengeId: z.string().max(100),
  runId: z.uuid(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  snapshot: z.custom<Snapshot>(isSnapshot, "Invalid run snapshot"),
});

export const emptyState = (): StoredState => ({
  revision: 0,
  activeRun: null,
  latestResult: null,
  bestProgress: 0,
});

export function makeChallenge(
  date = new Date().toISOString().slice(0, 10)
): Challenge {
  return { id: `sweeper:${VERSION}:${date}`, date, version: VERSION };
}

export function parseChallenge(value: unknown): Challenge | null {
  const parsed = z
    .object({ id: z.string(), date: z.iso.date(), version: z.literal(VERSION) })
    .safeParse(value);
  if (!parsed.success) return null;
  const expected = makeChallenge(parsed.data.date);
  return expected.id === parsed.data.id ? expected : null;
}

export function publicState(state: StoredState): PlayerState {
  return {
    revision: state.revision,
    activeRun: state.activeRun,
    latestResult: state.latestResult,
    bestProgress: state.bestProgress,
  };
}

export function playerKey(context: RequestContext): string {
  if (!context.user) throw new Error("Player identity required");
  return `sweeper:player:${context.user.id}:${context.challenge.id}`;
}

export function applySave(
  state: StoredState,
  input: z.infer<typeof saveSchema>
): UpdateResult {
  const mutation = createHash("sha256")
    .update(JSON.stringify({ runId: input.runId, snapshot: input.snapshot }))
    .digest("hex");
  if (state.lastMutation === mutation) return { ok: true, state };
  if (state.revision !== input.revision) return { ok: false, state };

  const { snapshot, runId } = input;
  const terminal = snapshot.phase === "won" || snapshot.phase === "lost";
  const progress =
    snapshot.phase === "won"
      ? 2
      : snapshot.stage === 1 || snapshot.phase === "shop"
      ? 1
      : 0;
  return {
    ok: true,
    state: {
      revision: state.revision + 1,
      activeRun: terminal ? null : { runId, snapshot },
      latestResult: terminal
        ? {
            runId,
            outcome: snapshot.phase as "won" | "lost",
            progress,
            finishedAt: new Date().toISOString(),
          }
        : state.latestResult,
      bestProgress: Math.max(state.bestProgress, progress),
      lastMutation: mutation,
    },
  };
}
