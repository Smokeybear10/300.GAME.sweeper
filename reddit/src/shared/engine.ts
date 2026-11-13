export const VERSION = "1";
export const BOARD = {
  rows: 8,
  cols: 8,
  mines: 10,
  time: 150,
  startRow: 3,
  startCol: 3,
} as const;
export const TOOLS = {
  backup: {
    name: "BACKUP",
    price: 30,
    description: "Add up to 20 seconds. Kept if the clock is full.",
  },
  firewall: {
    name: "FIREWALL",
    price: 46,
    description: "Absorb one mine hit. Its tile stays covered and known safe.",
  },
  rootkit: {
    name: "ROOTKIT",
    price: 48,
    description:
      "Open safe tiles around every flag. One wrong flag ends the run.",
  },
} as const;

export type Tool = keyof typeof TOOLS;
export type Coordinate = { r: number; c: number };
export type Phase = "ready" | "playing" | "paused" | "shop" | "won" | "lost";
export type LossReason = "mine" | "wrongFlag" | "timeout";
export type Cell = {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number;
  firewallSafe: boolean;
};
export type Snapshot = {
  version: string;
  date: string;
  stage: 0 | 1;
  phase: Phase;
  board: Cell[][];
  keys: number;
  tools: Tool[];
  timeRemaining: number;
  maxTime: number;
  clockRemainder: number;
  firstClick: boolean;
  mineCount: number;
  revealedCount: number;
  shopBought: Tool[];
  completionBonus: number | null;
  lossReason: LossReason | null;
  hitCell: Coordinate | null;
};
export type Effect =
  | ({ type: "reveal" | "firewall" } & Coordinate)
  | ({ type: "flag"; flagged: boolean } & Coordinate)
  | { type: "rootkit"; revealed: number }
  | { type: "backup"; seconds: number }
  | { type: "clear"; stage: 0 | 1; bonus: number }
  | { type: "buy"; tool: Tool }
  | { type: "refund"; tool: Tool }
  | { type: "stage"; stage: 0 | 1 }
  | { type: "pause" | "resume" | "won" }
  | { type: "lost"; reason: LossReason; r?: number; c?: number };

const neighbors = Array.from({ length: BOARD.rows * BOARD.cols }, (_, id) => {
  const adjacent: number[] = [];
  const r = Math.floor(id / BOARD.cols),
    c = id % BOARD.cols;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      if (
        r + dr >= 0 &&
        r + dr < BOARD.rows &&
        c + dc >= 0 &&
        c + dc < BOARD.cols
      ) {
        adjacent.push((r + dr) * BOARD.cols + c + dc);
      }
    }
  return adjacent;
});
const coordinate = (id: number): Coordinate => ({
  r: Math.floor(id / BOARD.cols),
  c: id % BOARD.cols,
});
const inside = (r: number, c: number) =>
  Number.isInteger(r) &&
  Number.isInteger(c) &&
  r >= 0 &&
  r < BOARD.rows &&
  c >= 0 &&
  c < BOARD.cols;
const blankBoard = (): Cell[][] =>
  Array.from({ length: BOARD.rows }, () =>
    Array.from({ length: BOARD.cols }, () => ({
      mine: false,
      revealed: false,
      flagged: false,
      adjacent: 0,
      firewallSafe: false,
    })),
  );

export function isDailyDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function dailySeed(date: string, stage: number): number {
  let seed = 2166136261;
  for (const character of `sweeper-reddit-v${VERSION}:${date}:${stage}`)
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}

// Adapted from the owned game's public-clue subset solver and certified generator.
function inferMoves(
  clues: Int8Array,
  knownMines: Uint8Array,
  totalMines: number,
): { safe: number[]; mines: number[] } {
  const safe = new Set<number>(),
    mines = new Set<number>(),
    seen = new Set<string>();
  const constraints: {
    cells: number[];
    count: number;
    members: Set<number>;
  }[] = [];
  const unknown: number[] = [];
  let inferredCount = 0;
  for (let id = 0; id < clues.length; id++) {
    if (knownMines[id]) inferredCount++;
    else if (clues[id]! < 0) unknown.push(id);
  }
  const remaining = totalMines - inferredCount;
  if (remaining === 0) return { safe: unknown, mines: [] };
  if (remaining === unknown.length) return { safe: [], mines: unknown };
  const add = (cells: number[], count: number) => {
    if (!cells.length) return;
    if (count === 0) {
      cells.forEach((id) => safe.add(id));
      return;
    }
    if (count === cells.length) {
      cells.forEach((id) => mines.add(id));
      return;
    }
    const key = cells.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    constraints.push({ cells, count, members: new Set(cells) });
  };
  for (let id = 0; id < clues.length; id++) {
    if (clues[id]! < 0) continue;
    const cells: number[] = [];
    let count = clues[id]!;
    for (const neighbor of neighbors[id]!) {
      if (knownMines[neighbor]) count--;
      else if (clues[neighbor]! < 0) cells.push(neighbor);
    }
    add(cells, count);
  }
  if (safe.size || mines.size) return { safe: [...safe], mines: [...mines] };
  for (let i = 0; i < constraints.length; i++) {
    for (let j = 0; j < i; j++) {
      let small = constraints[j]!,
        big = constraints[i]!;
      if (small.cells.length > big.cells.length) [small, big] = [big, small];
      if (
        small.cells.length === big.cells.length ||
        !small.cells.every((id) => big.members.has(id))
      )
        continue;
      add(
        big.cells.filter((id) => !small.members.has(id)),
        big.count - small.count,
      );
    }
    if (safe.size || mines.size) return { safe: [...safe], mines: [...mines] };
  }
  return { safe: [], mines: [] };
}

function solveBoard(
  board: Uint8Array,
  mineCount: number,
  start: number,
): { solved: boolean; steps: number; opening: number } {
  const clues = new Int8Array(board.length).fill(-1),
    knownMines = new Uint8Array(board.length);
  let revealed = 0,
    steps = 0;
  const reveal = (id: number): boolean => {
    const queue = [id];
    while (queue.length) {
      const next = queue.pop()!;
      if (clues[next]! >= 0) continue;
      if (board[next]) return false;
      const clue = neighbors[next]!.reduce(
        (count, neighbor) => count + board[neighbor]!,
        0,
      );
      clues[next] = clue;
      revealed++;
      if (clue === 0)
        for (const neighbor of neighbors[next]!)
          if (clues[neighbor]! < 0) queue.push(neighbor);
    }
    return true;
  };
  if (!reveal(start)) return { solved: false, steps, opening: revealed };
  const opening = revealed;
  while (revealed < board.length - mineCount) {
    const moves = inferMoves(clues, knownMines, mineCount);
    if (!moves.safe.length && !moves.mines.length)
      return { solved: false, steps, opening };
    for (const id of moves.mines) knownMines[id] = 1;
    for (const id of moves.safe)
      if (!reveal(id)) return { solved: false, steps, opening };
    steps++;
  }
  return { solved: true, steps, opening };
}

function generateMines(date: string, stage: number): Uint8Array {
  const start = BOARD.startRow * BOARD.cols + BOARD.startCol;
  // Keep the already-issued November 12 and 13 fields unchanged.
  const screenOpening = date >= "2026-11-14";
  const acceptable = (result: ReturnType<typeof solveBoard>) =>
    result.solved &&
    result.steps > 0 &&
    (!screenOpening || (result.opening >= 18 && result.opening <= 34));
  const candidates = Array.from(
    { length: BOARD.rows * BOARD.cols },
    (_, id) => id,
  ).filter(
    (id) =>
      Math.abs(Math.floor(id / BOARD.cols) - BOARD.startRow) > 1 ||
      Math.abs((id % BOARD.cols) - BOARD.startCol) > 1,
  );
  const candidate = (random: () => number): Uint8Array => {
    const positions = [...candidates],
      board = new Uint8Array(BOARD.rows * BOARD.cols);
    for (let i = 0; i < BOARD.mines; i++) {
      const j = i + Math.floor(random() * (positions.length - i));
      [positions[i], positions[j]] = [positions[j]!, positions[i]!];
      board[positions[i]!] = 1;
    }
    return board;
  };
  const random = seededRandom(dailySeed(date, stage));
  for (let attempt = 0; attempt < 64; attempt++) {
    const board = candidate(random),
      result = solveBoard(board, BOARD.mines, start);
    if (acceptable(result)) return board;
  }
  const fallback = seededRandom(
    BOARD.rows * 100000 + BOARD.mines * 1000 + start,
  );
  for (let attempt = 0; attempt < 64; attempt++) {
    const board = candidate(fallback),
      result = solveBoard(board, BOARD.mines, start);
    if (acceptable(result)) return board;
  }
  if (screenOpening) {
    // Fixed, solver-certified field with a 19-tile opening at D4.
    const board = new Uint8Array(BOARD.rows * BOARD.cols);
    for (const id of [5, 10, 15, 17, 39, 43, 44, 46, 58, 60]) board[id] = 1;
    return board;
  }
  const board = new Uint8Array(BOARD.rows * BOARD.cols);
  let placed = 0;
  for (let r = BOARD.rows - 1; r >= 0 && placed < BOARD.mines; r--) {
    for (let c = BOARD.cols - 1; c >= 0 && placed < BOARD.mines; c--) {
      if (
        Math.abs(r - BOARD.startRow) <= 1 &&
        Math.abs(c - BOARD.startCol) <= 1
      )
        continue;
      board[r * BOARD.cols + c] = 1;
      placed++;
    }
  }
  return board;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;
const isTool = (value: unknown): value is Tool =>
  value === "backup" || value === "firewall" || value === "rootkit";
const isCoordinate = (value: unknown): value is Coordinate =>
  isRecord(value) && integer(value.r, 0, 7) && integer(value.c, 0, 7);
function isCell(value: unknown): value is Cell {
  return (
    isRecord(value) &&
    typeof value.mine === "boolean" &&
    typeof value.revealed === "boolean" &&
    typeof value.flagged === "boolean" &&
    typeof value.firewallSafe === "boolean" &&
    integer(value.adjacent, 0, 8) &&
    !(value.revealed && value.flagged) &&
    !(value.firewallSafe && value.mine)
  );
}

export function isSnapshot(value: unknown): value is Snapshot {
  if (
    !isRecord(value) ||
    value.version !== VERSION ||
    !isDailyDate(value.date) ||
    !integer(value.stage, 0, 1)
  )
    return false;
  if (
    typeof value.phase !== "string" ||
    !["ready", "playing", "paused", "shop", "won", "lost"].includes(value.phase)
  )
    return false;
  if (
    !Array.isArray(value.board) ||
    value.board.length !== BOARD.rows ||
    !value.board.every(
      (row: unknown) =>
        Array.isArray(row) && row.length === BOARD.cols && row.every(isCell),
    )
  )
    return false;
  if (
    !integer(value.keys, 0, 512) ||
    !integer(value.mineCount, 9, 10) ||
    !integer(value.revealedCount, 0, 64)
  )
    return false;
  if (
    !integer(value.maxTime, 150, 195) ||
    !integer(value.timeRemaining, 0, value.maxTime + 20)
  )
    return false;
  if (
    typeof value.clockRemainder !== "number" ||
    !Number.isFinite(value.clockRemainder) ||
    value.clockRemainder < 0 ||
    value.clockRemainder >= 1
  )
    return false;
  if (
    typeof value.firstClick !== "boolean" ||
    !Array.isArray(value.tools) ||
    value.tools.length > 4 ||
    !value.tools.every(isTool)
  )
    return false;
  if (
    !Array.isArray(value.shopBought) ||
    value.shopBought.length > 3 ||
    !value.shopBought.every(isTool) ||
    new Set(value.shopBought).size !== value.shopBought.length
  )
    return false;
  if (
    value.tools.filter((tool) => tool === "rootkit").length > 2 ||
    value.tools.filter((tool) => tool === "backup").length > 1 ||
    value.tools.filter((tool) => tool === "firewall").length > 1
  )
    return false;
  if (value.completionBonus !== null && !integer(value.completionBonus, 10, 63))
    return false;
  if (
    value.lossReason !== null &&
    (typeof value.lossReason !== "string" ||
      !["mine", "wrongFlag", "timeout"].includes(value.lossReason))
  )
    return false;
  if (value.hitCell !== null && !isCoordinate(value.hitCell)) return false;
  const board = value.board as Cell[][],
    cells = board.flat();
  if (cells.filter((cell) => cell.revealed).length !== value.revealedCount)
    return false;
  if (cells.filter((cell) => cell.firewallSafe).length !== 10 - value.mineCount)
    return false;
  if (value.firstClick) {
    if (
      value.phase !== "ready" ||
      value.revealedCount !== 0 ||
      cells.some(
        (cell) =>
          cell.mine || cell.flagged || cell.adjacent || cell.firewallSafe,
      )
    )
      return false;
  } else {
    if (
      value.phase === "ready" ||
      cells.filter((cell) => cell.mine).length !== value.mineCount
    )
      return false;
    for (const [id, cell] of cells.entries()) {
      if (
        !cell.mine &&
        cell.adjacent !==
          neighbors[id]!.filter((next) => cells[next]!.mine).length
      )
        return false;
    }
  }
  if (value.stage === 0 && value.maxTime !== BOARD.time) return false;
  const cleared =
    cells.filter((cell) => !cell.mine && cell.revealed).length ===
    64 - value.mineCount;
  if (value.phase === "shop" && (value.stage !== 0 || !cleared)) return false;
  if (value.phase === "won" && (value.stage !== 1 || !cleared)) return false;
  if (
    (value.phase === "shop" || value.phase === "won") !==
    (value.completionBonus !== null)
  )
    return false;
  if (
    value.phase !== "lost" &&
    (value.lossReason !== null ||
      value.hitCell !== null ||
      value.timeRemaining === 0)
  )
    return false;
  if (value.phase === "lost" && value.lossReason === null) return false;
  if (
    value.lossReason === "timeout" &&
    (value.timeRemaining !== 0 || value.hitCell !== null)
  )
    return false;
  if (
    (value.lossReason === "mine" || value.lossReason === "wrongFlag") &&
    value.hitCell === null
  )
    return false;
  if (
    (value.phase === "playing" || value.phase === "paused") &&
    (cleared || cells.some((cell) => cell.mine && cell.revealed))
  )
    return false;
  return true;
}

export class DailyRun {
  private state: Snapshot;

  constructor(date: string) {
    if (!isDailyDate(date))
      throw new RangeError("A valid challenge date is required.");
    this.state = {
      version: VERSION,
      date,
      stage: 0,
      phase: "ready",
      board: blankBoard(),
      keys: 0,
      tools: ["rootkit"],
      timeRemaining: BOARD.time,
      maxTime: BOARD.time,
      clockRemainder: 0,
      firstClick: true,
      mineCount: BOARD.mines,
      revealedCount: 0,
      shopBought: [],
      completionBonus: null,
      lossReason: null,
      hitCell: null,
    };
  }

  static restore(value: unknown): DailyRun | null {
    if (!isSnapshot(value)) return null;
    const run = new DailyRun(value.date);
    run.state = structuredClone(value);
    if (run.state.phase === "playing") run.state.phase = "paused";
    return run;
  }

  snapshot(): Snapshot {
    return structuredClone(this.state);
  }
  get date() {
    return this.state.date;
  }
  get board() {
    return this.state.board;
  }
  get stage() {
    return this.state.stage;
  }
  get phase() {
    return this.state.phase;
  }
  get rows() {
    return BOARD.rows;
  }
  get cols() {
    return BOARD.cols;
  }
  get keys() {
    return this.state.keys;
  }
  get tools() {
    return this.state.tools;
  }
  get timeRemaining() {
    return this.state.timeRemaining;
  }
  get maxTime() {
    return this.state.maxTime;
  }
  get firstClick() {
    return this.state.firstClick;
  }
  get mineCount() {
    return this.state.mineCount;
  }
  get revealedCount() {
    return this.state.revealedCount;
  }
  get shopBought() {
    return this.state.shopBought;
  }
  get completionBonus() {
    return this.state.completionBonus;
  }
  get lossReason() {
    return this.state.lossReason;
  }
  get hitCell() {
    return this.state.hitCell;
  }
  get flagCount() {
    return this.board.flat().filter((cell) => cell.flagged).length;
  }

  get rootkitFootprint(): Coordinate[] {
    const cells = this.board.flat(),
      linked = new Set<number>();
    for (const [id, cell] of cells.entries()) {
      if (!cell.flagged) continue;
      for (const next of neighbors[id]!)
        if (!cells[next]!.revealed && !cells[next]!.flagged) linked.add(next);
    }
    return [...linked].map(coordinate);
  }

  reveal(r: number, c: number): Effect[] {
    if (!inside(r, c) || !["ready", "playing"].includes(this.phase)) return [];
    if (this.firstClick) {
      if (r !== BOARD.startRow || c !== BOARD.startCol) return [];
      const mines = generateMines(this.date, this.stage);
      for (let id = 0; id < mines.length; id++) {
        const point = coordinate(id);
        this.cellAt(point.r, point.c).mine = Boolean(mines[id]);
      }
      this.recalculateClues();
      this.state.firstClick = false;
      this.state.phase = "playing";
    }
    return this.revealCell(r, c);
  }

  flag(r: number, c: number): Effect[] {
    if (this.phase !== "playing" || !inside(r, c) || this.cellAt(r, c).revealed)
      return [];
    const cell = this.cellAt(r, c);
    cell.flagged = !cell.flagged;
    return [{ type: "flag", r, c, flagged: cell.flagged }];
  }

  chord(r: number, c: number): Effect[] {
    if (this.phase !== "playing" || !inside(r, c)) return [];
    const cell = this.cellAt(r, c);
    if (!cell.revealed || cell.mine || cell.adjacent === 0) return [];
    const points = neighbors[r * BOARD.cols + c]!.map(coordinate);
    if (
      points.filter((point) => this.cellAt(point.r, point.c).flagged).length !==
      cell.adjacent
    )
      return [];
    return points.flatMap((point) => this.revealCell(point.r, point.c));
  }

  useRootkit(): Effect[] {
    if (this.phase !== "playing" || !this.tools.includes("rootkit")) return [];
    const flags = this.board.flatMap((row, r) =>
      row.flatMap((cell, c) => (cell.flagged ? [{ r, c }] : [])),
    );
    if (!flags.length) return [];
    const badFlag = flags.find((point) => !this.cellAt(point.r, point.c).mine);
    if (badFlag) {
      this.consume("rootkit");
      return this.lose("wrongFlag", badFlag);
    }
    const targets = this.rootkitFootprint.filter(
      (point) => !this.cellAt(point.r, point.c).mine,
    );
    if (!targets.length) return [];
    this.consume("rootkit");
    const effects = targets.flatMap((point) =>
      this.revealCell(point.r, point.c),
    );
    return [
      {
        type: "rootkit",
        revealed: effects.filter((effect) => effect.type === "reveal").length,
      },
      ...effects,
    ];
  }

  useBackup(): Effect[] {
    if (
      !["ready", "playing"].includes(this.phase) ||
      !this.tools.includes("backup")
    )
      return [];
    const seconds = Math.min(20, this.maxTime + 20 - this.timeRemaining);
    if (seconds <= 0) return [];
    this.consume("backup");
    this.state.timeRemaining += seconds;
    return [{ type: "backup", seconds }];
  }

  buy(tool: Tool): Effect[] {
    if (
      this.phase !== "shop" ||
      !isTool(tool) ||
      this.shopBought.includes(tool) ||
      this.keys < TOOLS[tool].price
    )
      return [];
    this.state.keys -= TOOLS[tool].price;
    this.state.tools.push(tool);
    this.state.shopBought.push(tool);
    return [{ type: "buy", tool }];
  }

  refund(tool: Tool): Effect[] {
    if (
      this.phase !== "shop" ||
      !isTool(tool) ||
      !this.shopBought.includes(tool)
    )
      return [];
    const index = this.tools.lastIndexOf(tool);
    if (index === -1) return [];
    this.state.tools.splice(index, 1);
    this.state.shopBought.splice(this.shopBought.indexOf(tool), 1);
    this.state.keys += TOOLS[tool].price;
    return [{ type: "refund", tool }];
  }

  nextStage(): Effect[] {
    if (this.phase !== "shop") return [];
    const time = BOARD.time + Math.floor(this.timeRemaining * 0.3);
    this.state = {
      ...this.state,
      stage: 1,
      phase: "ready",
      board: blankBoard(),
      firstClick: true,
      mineCount: BOARD.mines,
      revealedCount: 0,
      timeRemaining: time,
      maxTime: time,
      clockRemainder: 0,
      completionBonus: null,
      lossReason: null,
      hitCell: null,
    };
    return [{ type: "stage", stage: 1 }];
  }

  pause(): Effect[] {
    if (this.phase !== "playing") return [];
    this.state.phase = "paused";
    return [{ type: "pause" }];
  }

  resume(): Effect[] {
    if (this.phase !== "paused") return [];
    this.state.phase = "playing";
    return [{ type: "resume" }];
  }

  elapse(seconds: number): Effect[] {
    if (this.phase !== "playing" || !Number.isFinite(seconds) || seconds <= 0)
      return [];
    const elapsed = this.state.clockRemainder + seconds;
    const whole = Math.floor(elapsed + 1e-9);
    this.state.clockRemainder = Math.max(0, elapsed - whole);
    this.state.timeRemaining = Math.max(0, this.timeRemaining - whole);
    if (this.timeRemaining === 0) return this.lose("timeout");
    return [];
  }

  private consume(tool: Tool): void {
    this.state.tools.splice(this.tools.indexOf(tool), 1);
  }
  private cellAt(r: number, c: number): Cell {
    return this.board[r]![c]!;
  }

  private recalculateClues(): void {
    const cells = this.board.flat();
    for (const [id, cell] of cells.entries())
      if (!cell.mine)
        cell.adjacent = neighbors[id]!.filter(
          (next) => cells[next]!.mine,
        ).length;
  }

  private revealCell(r: number, c: number): Effect[] {
    const cell = this.cellAt(r, c);
    if (this.phase !== "playing" || cell.revealed || cell.flagged) return [];
    cell.revealed = true;
    this.state.revealedCount++;
    if (cell.mine) {
      if (this.tools.includes("firewall")) {
        this.consume("firewall");
        cell.revealed = false;
        cell.mine = false;
        cell.firewallSafe = true;
        this.state.revealedCount--;
        this.state.mineCount--;
        this.recalculateClues();
        return [{ type: "firewall", r, c }];
      }
      return this.lose("mine", { r, c });
    }
    this.state.keys++;
    const effects: Effect[] = [{ type: "reveal", r, c }];
    if (cell.adjacent === 0)
      for (const id of neighbors[r * BOARD.cols + c]!) {
        const point = coordinate(id);
        effects.push(...this.revealCell(point.r, point.c));
      }
    if (
      this.phase === "playing" &&
      this.revealedCount === BOARD.rows * BOARD.cols - this.mineCount
    ) {
      const bonus = 10 * (this.stage + 1) + Math.floor(this.timeRemaining / 5);
      this.state.keys += bonus;
      this.state.completionBonus = bonus;
      effects.push({ type: "clear", stage: this.stage, bonus });
      this.state.phase = this.stage === 0 ? "shop" : "won";
      if (this.stage === 1) effects.push({ type: "won" });
    }
    return effects;
  }

  private lose(reason: LossReason, point: Coordinate | null = null): Effect[] {
    this.state.phase = "lost";
    this.state.lossReason = reason;
    this.state.hitCell = point;
    return [{ type: "lost", reason, ...(point ?? {}) }];
  }
}
