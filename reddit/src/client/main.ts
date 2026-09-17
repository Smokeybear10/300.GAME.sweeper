import "./styles.css";
import { getWebViewMode, requestExpandedMode } from "@devvit/web/client";
import {
  BOARD,
  DailyRun,
  TOOLS,
  type Cell,
  type Coordinate,
  type Effect,
  type Tool,
} from "../shared/engine";
import { ProgressStore } from "./persistence";
import { GameAudio } from "./audio";
import { openLesson } from "./lesson";

const app = document.querySelector<HTMLElement>("#app")!;
const sound = new GameAudio();
const flagIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18M3 21h8" stroke="#26382b" stroke-width="2"/><path d="M7 3v11l11-6z" fill="#a62926"/></svg>';
const mineIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#18271d" stroke-width="2"><path d="M12 2v20M2 12h20M5 5l14 14M5 19L19 5"/><circle cx="12" cy="12" r="5" fill="#18271d"/></g><circle cx="10" cy="10" r="1.5" fill="#eef1df"/></svg>';
const icons: Record<Tool, string> = {
  backup: "↻",
  firewall: "⎔",
  rootkit: "☢",
};
const toolSymbols: Record<Tool, string> = {
  rootkit:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8H8zM12 2v6m0 8v6M2 12h6m8 0h6M5 5l3 3m8 8 3 3M19 5l-3 3M8 16l-3 3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 10h4v4h-4z" fill="currentColor"/></svg>',
  backup:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8a8 8 0 1 1-1 7M5 3v5h5m2 0v5l3 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  firewall:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5zM8 12l3 3 5-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
let store: ProgressStore;
let run: DailyRun;
let runId: string = crypto.randomUUID();
let mode: "reveal" | "flag" | "inspect" = "reveal";
let preview = true;
let largeTiles = false;
let review = false;
let focusCell: Coordinate = { r: BOARD.startRow, c: BOARD.startCol };
let inspection: Coordinate | null = null;
let lastClock = performance.now();
let lastCheckpoint = performance.now();
let lastEffects: Effect[] = [];
let noticeTimer: ReturnType<typeof setTimeout>;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let ignoreClickUntil = 0;
let touch: { x: number; y: number; id: number; cell: Coordinate } | null = null;
let eventLog: string[] = [];
let outcomeTimer: ReturnType<typeof setTimeout> | null = null;
let deferOutcome = false;
let feedback = "Recovery loaded. The clock starts on your first reveal.";
let feedbackKind = "ready";
let hostMode: "inline" | "expanded" = "expanded";
let playInline = false;
let expanding = false;
let refreshing = false;
let refreshTask: Promise<boolean> | null = null;
let needsRefresh = false;
let refreshFailed = false;
let wasAway = false;
let expansionFallback = false;

function toolCount(tool: Tool): number {
  return run.tools.filter((item) => item === tool).length;
}
function disabled(condition: boolean): string {
  return condition ? "disabled" : "";
}
function coordinateLabel(r: number, c: number): string {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}
function log(message: string): void {
  eventLog = [...eventLog.slice(-4), message];
}
function notice(message: string): void {
  feedback = message;
  clearTimeout(noticeTimer);
  const element = document.querySelector("#operation-status");
  if (element) {
    element.textContent = message;
    element.classList.add("status-flash");
    noticeTimer = setTimeout(
      () => element.classList.remove("status-flash"),
      1200,
    );
  }
}
function syncLabel(): string {
  const labels = {
    saved:
      store.bootstrap.mode === "local"
        ? "Saved on this computer"
        : "Saved to your account",
    saving: "Saving…",
    local: "Saved in this browser",
    offline: "Saved here · sync pending",
    conflict: "Newer save found",
    unavailable: "Save unavailable · keep this open",
  };
  return labels[store.status];
}
function cellMarkup(
  cell: Cell,
  r: number,
  c: number,
  linked: Set<string>,
): string {
  const id = `${r},${c}`,
    classes = ["cell"];
  const terminal = run.phase === "lost" && (review || deferOutcome);
  const hit = run.hitCell?.r === r && run.hitCell?.c === c;
  const revealedEffect = lastEffects.findIndex(
    (effect) => effect.type === "reveal" && effect.r === r && effect.c === c,
  );
  let content = "",
    label = "Covered tile";
  if (terminal && cell.flagged && !cell.mine) {
    classes.push("wrong-flag");
    content = "×";
    label = "Incorrect flag on a safe tile";
  } else if ((terminal || cell.revealed) && cell.mine) {
    classes.push(hit ? "mine-hit" : "review-mine");
    content = mineIcon;
    label = hit ? "Mine that ended the run" : "Mine";
  } else if (cell.revealed || terminal) {
    classes.push("revealed");
    if (terminal && !cell.revealed) classes.push("review-safe");
    content = cell.adjacent ? String(cell.adjacent) : "";
    label = cell.adjacent ? `${cell.adjacent} adjacent mines` : "Empty";
  } else if (cell.flagged) {
    classes.push("flagged");
    content = flagIcon;
    label = "Flagged tile";
  } else {
    classes.push("unrevealed");
    if (cell.firewallSafe) {
      classes.push("known-safe");
      label = "Known safe after FIREWALL; reveal to open";
    }
    if (run.firstClick && r === BOARD.startRow && c === BOARD.startCol) {
      classes.push("daily-start");
      content = '<span class="start-label">START</span>';
      label = "Start here; safe opening";
    }
  }
  if (preview && run.phase === "playing" && toolCount("rootkit")) {
    if (linked.has(id)) classes.push("linked");
    if (cell.flagged) classes.push("anchor");
  }
  if (revealedEffect >= 0)
    classes.push(
      lastEffects.some((effect) => effect.type === "rootkit")
        ? "rootkit-reveal"
        : "just-revealed",
    );
  if (
    lastEffects.some(
      (effect) =>
        effect.type === "flag" &&
        effect.r === r &&
        effect.c === c &&
        effect.flagged,
    )
  )
    classes.push("flag-pop");
  if (inspection) {
    if (r === inspection.r && c === inspection.c)
      classes.push("inspect-source");
    else if (Math.abs(r - inspection.r) <= 1 && Math.abs(c - inspection.c) <= 1)
      classes.push("inspect-neighbor");
  }
  return `<button class="${classes.join(
    " ",
  )}" role="gridcell" aria-label="${coordinateLabel(
    r,
    c,
  )}: ${label}" aria-rowindex="${r + 1}" aria-colindex="${
    c + 1
  }" data-r="${r}" data-c="${c}" data-number="${
    cell.revealed || terminal ? cell.adjacent : ""
  }" tabindex="${
    r === focusCell.r && c === focusCell.c ? 0 : -1
  }" style="--reveal-delay:${
    Math.max(0, Math.min(revealedEffect, 16)) * 12
  }ms">${content}</button>`;
}
function networkMarkup(): string {
  if (!preview || run.phase !== "playing" || !toolCount("rootkit")) return "";
  const lines: string[] = [];
  run.board.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell.flagged) return;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const next = run.board[r + dr]?.[c + dc];
          if (!next || next.revealed || next.flagged || (!dr && !dc)) continue;
          lines.push(
            `<line x1="${c * 10 + 5}" y1="${r * 10 + 5}" x2="${
              (c + dc) * 10 + 5
            }" y2="${(r + dr) * 10 + 5}"/>`,
          );
        }
    }),
  );
  return `<svg class="network-lines" aria-hidden="true" viewBox="0 0 80 80">${lines.join(
    "",
  )}</svg>`;
}
function boardHint(): string {
  if (review)
    return "Board review. × marks an incorrect flag. Your result is unchanged.";
  if (run.firstClick) return "Open D4 to begin. The first opening is safe.";
  if (inspection) {
    const cell = run.board[inspection.r]![inspection.c]!;
    if (cell.revealed && !cell.mine) {
      let flags = 0;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (
            (dr || dc) &&
            run.board[inspection.r + dr]?.[inspection.c + dc]?.flagged
          )
            flags++;
      return `${coordinateLabel(inspection.r, inspection.c)}: ${
        cell.adjacent
      } nearby mines · ${flags} flags. ${
        flags === cell.adjacent && cell.adjacent
          ? "Reveal this number to clear its unflagged neighbors."
          : "A flag is your estimate, not a confirmed mine."
      }`;
    }
  }
  if (mode === "flag")
    return "Flag mines you can deduce. Each flag becomes a ROOTKIT anchor.";
  if (mode === "inspect")
    return "Tap a number to inspect its neighbors without opening a tile.";
  return run.flagCount
    ? "Tap a number with matching flags to clear its neighbors for free."
    : "Numbers count nearby mines. Right-click or choose Flag to mark one.";
}
function journeyMarkup(): string {
  const atShop = run.phase === "shop";
  const finished = run.phase === "won";
  return `<nav class="journey" aria-label="Recovery progress"><span class="${run.stage || atShop || finished ? "complete" : "current"}"><b>${run.stage || atShop || finished ? "✓" : "01"}</b> Boot sector</span><i aria-hidden="true"></i><span class="${atShop ? "current" : run.stage ? "complete" : ""}"><b>+</b> Supply</span><i aria-hidden="true"></i><span class="${finished ? "complete" : run.stage ? "current" : ""}"><b>${finished ? "✓" : "02"}</b> Deep sector</span></nav>`;
}
function launcherMarkup(): string {
  const ongoing = ["playing", "paused", "shop"].includes(run.phase);
  const action =
    run.phase === "shop"
      ? "Return to the shop"
      : ongoing
        ? "Resume recovery"
        : ["won", "lost"].includes(run.phase)
          ? "View recovery"
          : "Open this recovery";
  const latest = store.bootstrap.state.latestResult;
  const summary = ongoing
    ? `Sector ${run.stage + 1} · ${run.keys} keys · ${formatTime(run.timeRemaining)} held`
    : latest
      ? `Last run ${latest.progress}/2 · Best ${store.bestProgress}/2 sectors`
      : "Two fields. One shop. A fresh recovery every day.";
  const tiles = run.board
    .flatMap((row, r) =>
      row.map(
        (cell, c) =>
          `<span class="preview-cell ${cell.revealed && !cell.mine ? "open" : cell.flagged ? "marked" : ""}" data-number="${cell.revealed && !cell.mine ? cell.adjacent : ""}">${cell.flagged ? flagIcon : cell.revealed && !cell.mine ? cell.adjacent || "" : r === 3 && c === 3 && run.firstClick ? "+" : ""}</span>`,
      ),
    )
    .join("");
  return `<section class="launcher"><div class="launcher-heading"><span class="recovery-label">RECOVERED SOFTWARE / VOL. 047</span><span class="launcher-date">${run.date} UTC</span></div><div class="launcher-main"><div class="launcher-copy"><div class="disk-mark" aria-hidden="true"><span>S</span><i></i></div><h1>SWEEPER<span>.EXE</span></h1><h2>Some things should<br>stay buried.</h2><p>Minesweeper with a loadout.<br>Flag mines. Build a network.<br>Recover both sectors.</p></div><div class="launcher-preview" aria-hidden="true"><div class="preview-title">${run.stage ? "DEEP" : "BOOT"}_SECTOR</div><div class="preview-board">${tiles}</div><div class="preview-module">${toolSymbols.rootkit}<span>ROOTKIT.DLL<strong>Every flag is an instruction.</strong></span></div></div></div><div class="launcher-bottom"><div class="launcher-summary"><span class="ready-indicator"></span>${summary}</div><button class="win-button primary launch-button" data-action="launch" ${disabled(expanding || refreshing)}>${refreshing ? "Checking saved recovery…" : expanding ? "Opening recovery…" : action}<span aria-hidden="true">↗</span></button><div class="launcher-secondary"><button data-action="lesson">Learn by playing</button>${refreshFailed ? '<button data-action="reload">Reload saved recovery</button>' : expansionFallback ? '<button data-action="play-inline">Play in this post</button>' : `<span>${ongoing ? "Your progress is saved." : "Safe start · Deduction-solvable · Free retries"}</span>`}</div></div></section>`;
}
function fieldMarkup(): string {
  const linked = new Set(run.rootkitFootprint.map(({ r, c }) => `${r},${c}`));
  const paused = run.phase === "paused" || store.status === "conflict";
  const active = run.phase === "playing";
  const charges = toolCount("rootkit");
  const hasReserve = run.tools.some((tool) => tool !== "rootkit");
  const recovered = Math.max(
    0,
    run.revealedCount - (run.lossReason === "mine" ? 1 : 0),
  );
  return `<section class="field-layout ${hasReserve ? "has-reserve" : ""} ${charges ? "" : "rootkit-empty"}"><div class="field-primary"><div class="field-heading"><h2><span>0${run.stage + 1}</span> ${run.stage ? "DEEP SECTOR" : "BOOT SECTOR"}</h2><button class="grid-size" data-action="size" aria-pressed="${largeTiles}">${largeTiles ? "Fit grid" : "Larger tiles"}</button></div>
<div class="instrument-panel"><div class="readout"><span title="Total mines minus your flags">To flag</span><strong id="mines-val">${String(run.mineCount - run.flagCount).padStart(2, "0")}</strong></div><div class="readout timer ${run.timeRemaining <= 15 ? "low" : ""}" id="clock"><span>${paused ? "Clock paused" : "Time left"}</span><strong id="timer-val">${formatTime(run.timeRemaining)}</strong></div><div class="readout"><span>Keys</span><strong id="keys-val">${String(run.keys).padStart(2, "0")}</strong></div><button class="win-button pause" data-action="pause" aria-label="${paused ? "Resume game" : "Pause game"}" ${disabled(!active && !paused)}>${paused ? "▶" : "Ⅱ"}</button></div>
<div class="time-track" id="time-track"><div id="timer-bar" style="width:${Math.min(100, (run.timeRemaining / run.maxTime) * 100)}%"></div></div>
<div class="board-wrap ${paused ? "paused" : ""}"><div class="board-scroll"><div id="grid" class="board ${largeTiles ? "large" : ""}" role="grid" aria-label="Sector ${run.stage + 1} minefield. Arrow keys move; Enter reveals; F flags." aria-rowcount="8" aria-colcount="8" ${paused ? "inert" : ""}>${run.board.map((row, r) => `<div role="row" class="board-row">${row.map((cell, c) => cellMarkup(cell, r, c, linked)).join("")}</div>`).join("")}${networkMarkup()}</div></div>
${paused ? `<div class="overlay"><div class="overlay-card"><span class="pause-symbol" aria-hidden="true">Ⅱ</span><p class="eyebrow">RECOVERY SUSPENDED</p><h2>The process waited.</h2><p>Your clock is stopped.<br>Your loadout is intact.</p><button class="win-button primary" data-action="resume">Resume recovery <span aria-hidden="true">▶</span></button><button class="text-button" data-action="lesson">Practice without a timer</button></div></div>` : ""}</div>
<div class="board-legend"><span><b>${recovered}</b> / ${64 - run.mineCount} recovered</span><div class="recovery-track" aria-hidden="true"><i style="width:${(100 * recovered) / (64 - run.mineCount)}%"></i></div><span>${run.firstClick ? "SAFE START" : mode.toUpperCase()}</span></div>
${review ? '<button class="win-button wide" data-action="results">Back to result</button>' : `<div class="mode-switch" aria-label="Tile action"><button class="win-button" data-mode="reveal" aria-pressed="${mode === "reveal"}" ${disabled(paused)}><span aria-hidden="true">↖</span> Reveal</button><button class="win-button" data-mode="flag" aria-pressed="${mode === "flag"}" ${disabled(paused)}>${flagIcon} Flag</button><button class="win-button" data-mode="inspect" aria-pressed="${mode === "inspect"}" ${disabled(paused)}><span aria-hidden="true">⌕</span> Inspect</button></div>`}
<p class="board-hint ${run.firstClick ? "start-hint" : ""}" id="board-hint">${boardHint()}</p></div>
<aside class="field-tools" aria-label="Installed tools"><div class="tools-heading"><span>INSTALLED MODULES</span><span>${run.tools.length.toString().padStart(2, "0")}</span></div>
${review ? `<div class="review-explanation"><h3>Read the failure.</h3><p>× marks a wrong flag. Mines and unopened safe tiles are shown so you can work backward from the mistake.</p></div>` : charges ? `<section class="network-panel" aria-label="ROOTKIT tool"><div class="network-title"><span class="module-icon">${toolSymbols.rootkit}</span><div><strong>ROOTKIT<span>.DLL</span></strong><span class="charge">${charges} charge${charges === 1 ? "" : "s"} installed</span></div></div><div class="network-info"><div><strong>${run.flagCount}</strong><span>anchors</span></div><div><strong>${linked.size}</strong><span>in range</span></div><button class="preview-button" data-action="preview" aria-pressed="${preview}" aria-label="Show ROOTKIT range" ${disabled(paused)}>${preview ? "Range on" : "Range off"}<span class="range-count">${linked.size} tiles</span></button></div><div class="network-guidance">${run.flagCount ? "Range only. Flags are unverified." : "Flag a mine you can deduce to build your network."}</div><button class="win-button execute" data-action="rootkit" ${disabled(!active || !run.flagCount)}>Execute ROOTKIT <span aria-hidden="true">↵</span></button><p class="network-warning"><span>Opens safe neighbors of every flag.</span><strong>Wrong flag = run lost. <br>Even with FIREWALL.</strong></p></section>` : `<section class="spent-module"><span class="module-icon">${toolSymbols.rootkit}</span><div><strong>ROOTKIT · SPENT</strong><span>${run.stage ? "No charges remaining" : "Reload at the supply checkpoint"}</span></div></section>`}
${hasReserve && !review ? `<div class="tool-rack">${toolCount("backup") ? `<button class="win-button reserve-tool" data-action="backup" ${disabled(paused || !["ready", "playing"].includes(run.phase))}>${toolSymbols.backup}<span><strong>BACKUP ×${toolCount("backup")}</strong><small>Restore up to 20s</small></span></button>` : ""}${toolCount("firewall") ? `<div class="reserve-tool passive">${toolSymbols.firewall}<span><strong>FIREWALL</strong><small>1 mine hit protected</small></span><i class="armed-light"></i></div>` : ""}</div>` : ""}
<div class="field-context"><div class="checkpoint-mini"><span>${run.stage ? "FINAL SECTOR" : "NEXT / SUPPLY CHECKPOINT"}</span><p>${run.stage ? "Recover every safe tile to finish the run." : "Every safe tile earns a key. Spend them after this field."}</p></div><button class="text-button" data-action="lesson">Learn by playing <span aria-hidden="true">↗</span></button>${store.bestProgress ? `<span class="best-note">BEST THIS RECOVERY · ${store.bestProgress}/2 SECTORS</span>` : ""}</div></aside></section>`;
}
function loadoutMarkup(): string {
  return (
    (Object.keys(TOOLS) as Tool[])
      .filter((tool) => toolCount(tool))
      .map((tool) => `${TOOLS[tool].name} ×${toolCount(tool)}`)
      .join(" · ") || "No tools installed"
  );
}
function shopMarkup(): string {
  const carry = Math.floor(run.timeRemaining * 0.3);
  return `<section class="shop-view"><header class="phase-header"><div><p class="eyebrow">SECTOR 01 RECOVERED / CLOCK STOPPED</p><h2 tabindex="-1" id="phase-heading">Build your next move.</h2><p>Install tools for the deep sector. You can change your mind here.</p></div><div class="shop-budget"><span>AVAILABLE KEYS</span><strong>${run.keys}<small>◈</small></strong></div></header><div class="shop-body"><aside class="next-preview"><span class="terminal-label">NEXT / DEEP_SECTOR</span><div class="next-sector-number">02<span>/ 02</span></div><div class="next-specs"><span>8 × 8 field</span><span>10 mines</span><span>54 safe files</span></div><div class="clock-transfer"><span>STARTING CLOCK</span><strong>${formatTime(BOARD.time + carry)}</strong><small>${formatTime(BOARD.time)} base + ${carry}s carried</small></div><p class="receipt-line">Sector clear bonus <strong>+${run.completionBonus} keys</strong></p><p class="checkpoint-note">Unused tools carry forward.<br>This is the only shop.</p></aside><div class="shop-offers">${(
    Object.keys(TOOLS) as Tool[]
  )
    .map((tool) => {
      const item = TOOLS[tool];
      const bought = run.shopBought.includes(tool);
      const shortage = item.price - run.keys;
      const detail =
        tool === "rootkit"
          ? "Open safe neighbors around every flag. One wrong flag ends the run."
          : tool === "backup"
            ? "A little more breathing room. Activate when you need up to 20 extra seconds."
            : "Absorb one mine hit. That tile becomes safe and nearby numbers change.";
      return `<article class="shop-item ${bought ? "installed" : ""}" data-tool="${tool}"><span class="tool-icon">${toolSymbols[tool]}</span><div class="shop-item-copy"><h3>${item.name}<span>${tool === "rootkit" ? "REACH" : tool === "backup" ? "TIME" : "PROTECTION"}</span></h3><p>${detail}</p></div><button class="win-button ${bought ? "remove-tool" : ""}" data-buy="${tool}" aria-label="${bought ? `Remove ${item.name} and refund ${item.price} keys` : `Install ${item.name} for ${item.price} keys`}" ${disabled(!bought && shortage > 0)}>${bought ? "✓ Installed<small>Remove</small>" : shortage > 0 ? `${item.price} keys<small>Need ${shortage} more</small>` : `Install<small>${item.price} keys</small>`}</button></article>`;
    })
    .join(
      "",
    )}</div></div><footer class="shop-checkout"><div class="loadout"><strong>ENTER WITH</strong><span id="next-loadout">${loadoutMarkup()}</span></div><button class="win-button primary next-sector" data-action="next">Enter sector 02 <span aria-hidden="true">→</span></button></footer></section>`;
}
function resultMarkup(): string {
  const won = run.phase === "won";
  const coordinate = run.hitCell
    ? coordinateLabel(run.hitCell.r, run.hitCell.c)
    : "";
  const reason =
    run.lossReason === "wrongFlag"
      ? `The flag at ${coordinate} covered a safe tile. ROOTKIT checks every flag; FIREWALL cannot protect a bad instruction.`
      : run.lossReason === "timeout"
        ? "The clock ran out. Pause whenever you need to think, or use BACKUP before the last second."
        : `A mine at ${coordinate} stopped the recovery. Inspect the field and work backward from the hit.`;
  const title = won
    ? "All files accounted for."
    : run.lossReason === "wrongFlag"
      ? `Invalid flag. ${coordinate}.`
      : run.lossReason === "timeout"
        ? "Time ran out."
        : `Mine hit. ${coordinate}.`;
  const progress = won ? 2 : run.stage;
  const safeRecovered = run.revealedCount - (run.lossReason === "mine" ? 1 : 0);
  const files = run.stage * 54 + safeRecovered;
  return `<section class="result-view ${won ? "" : "failed"}"><header class="receipt-head"><span class="result-emblem" aria-hidden="true">${won ? "✓" : "!"}</span><div><p class="eyebrow">RECOVERY ${won ? "COMPLETE" : "INTERRUPTED"}</p><h2 tabindex="-1" id="phase-heading">${title}</h2><p>${won ? "Both sectors recovered. The machine is quiet. For now." : reason}</p></div></header><div class="result-body"><div class="recovery-receipt"><div class="receipt-title"><span>RECOVERY RECEIPT</span><span>${run.date}</span></div><div class="receipt-sectors"><div class="${progress > 0 ? "recovered" : "interrupted"}"><b>${progress > 0 ? "✓" : "01"}</b><span>BOOT SECTOR<small>${progress > 0 ? "Recovered" : `${safeRecovered}/54 files`}</small></span></div><i></i><div class="${won ? "recovered" : run.stage ? "interrupted" : "locked"}"><b>${won ? "✓" : "02"}</b><span>DEEP SECTOR<small>${won ? "Recovered" : run.stage ? `${safeRecovered}/${64 - run.mineCount} files` : "Not reached"}</small></span></div></div><dl class="result-stats"><div><dt>Files recovered</dt><dd>${files}</dd></div><div><dt>Keys remaining</dt><dd>${run.keys}</dd></div><div><dt>Clock remaining</dt><dd>${formatTime(run.timeRemaining)}</dd></div></dl><div class="loadout"><strong>TOOLS STILL HELD</strong>${loadoutMarkup()}</div><div class="receipt-best"><span>BEST THIS RECOVERY</span><strong>${store.bestProgress} / 2 sectors</strong></div></div><div class="result-actions"><p>${won ? "Same field. Different decisions." : "The clues are still there."}</p>${!won ? '<button class="win-button primary" data-action="review">Inspect the failure <span aria-hidden="true">⌕</span></button>' : ""}<button class="win-button ${won ? "primary" : ""}" data-action="retry">${won ? "Run it again" : "Restart from sector 1"} <span aria-hidden="true">↻</span></button><button class="win-button" data-action="copy">Copy recovery report</button><span class="result-note">Retries are free.<br>Your best recovery stays recorded.</span></div></div></section>`;
}
function render(): void {
  if (holdTimer) clearTimeout(holdTimer);
  const focused = document.activeElement;
  const gridFocused =
    focused instanceof HTMLElement && focused.classList.contains("cell");
  const focusIdentity =
    focused instanceof HTMLButtonElement
      ? ["action", "mode", "buy"].flatMap((key) =>
          focused.dataset[key] ? [{ key, value: focused.dataset[key] }] : [],
        )[0]
      : undefined;
  const scroll = app.querySelector(".board-scroll");
  const scrollLeft = scroll?.scrollLeft ?? 0;
  const scrollTop = scroll?.scrollTop ?? 0;
  const launcher =
    hostMode === "inline" && !playInline && store.status !== "conflict";
  const content =
    store.status === "conflict"
      ? '<section class="conflict-view"><p class="eyebrow">RECOVERY PAUSED</p><h2>A newer save exists.</h2><p>This recovery changed in another view. Load the newer save before continuing.</p><button class="win-button primary wide" data-action="reload">Load newer save</button></section>'
      : launcher
        ? launcherMarkup()
        : deferOutcome || review || !["shop", "won", "lost"].includes(run.phase)
          ? fieldMarkup()
          : run.phase === "shop"
            ? shopMarkup()
            : resultMarkup();
  app.innerHTML = `<div class="desktop ${launcher ? "cover-desktop" : ""}"><article class="monitor bevel ${launcher ? "launcher-window" : ""}" aria-label="SWEEPER recovery" data-phase="${run.phase}"><header class="titlebar"><span class="app-icon" aria-hidden="true">S</span><h1>SWEEPER.EXE <span>/ DAILY RECOVERY</span>${!launcher ? `<small class="mobile-sector">${run.stage + 1}/2</small>` : ""}</h1>${!launcher && (review || !["shop", "won", "lost"].includes(run.phase)) ? `<button class="win-button grid-zoom" data-action="size" aria-label="${largeTiles ? "Fit grid" : "Larger tiles"}" aria-pressed="${largeTiles}">${largeTiles ? "−" : "+"}</button>` : ""}<button class="win-button audio-button" data-action="sound" aria-label="${sound.muted ? "Enable sound" : "Mute sound"}" aria-pressed="${!sound.muted}">${sound.muted ? "OFF" : "SND"}</button><button class="win-button help-button" data-action="help" aria-label="How to play">?</button></header>${launcher ? "" : `<div class="menubar">${journeyMarkup()}<span class="date">${run.date} / UTC</span>${store.bootstrap.mode === "reddit" && hostMode === "inline" && store.bootstrap.user ? '<button class="win-button small" data-action="expand">Expand ↗</button>' : ""}</div>`}<div class="content">${content}</div><footer class="footer-status"><span class="status-light ${feedbackKind}" aria-hidden="true"></span><span id="operation-status" role="status" aria-live="polite">${escape(feedback)}</span><span class="sync-status" id="sync-status" title="${syncLabel()}">${syncLabel()}</span></footer></article>${!launcher ? '<div class="desktop-caption"><span>RECOVERED SOFTWARE / VOL. 047</span><span>THOMAS OU</span></div>' : ""}</div>`;
  app.setAttribute("aria-busy", "false");
  const nextScroll = app.querySelector(".board-scroll");
  if (nextScroll) {
    nextScroll.scrollLeft = scrollLeft;
    nextScroll.scrollTop = scrollTop;
  }
  if (gridFocused) {
    const nextFocus =
      run.phase === "paused"
        ? '[data-action="resume"]'
        : `.cell[data-r="${focusCell.r}"][data-c="${focusCell.c}"]`;
    app.querySelector<HTMLElement>(nextFocus)?.focus({ preventScroll: true });
  } else if (focusIdentity) {
    app
      .querySelector<HTMLElement>(
        `button[data-${focusIdentity.key}="${focusIdentity.value}"]:not(:disabled)`,
      )
      ?.focus({ preventScroll: true });
  }
  lastEffects = [];
  updateClock();
}
function checkpoint(): void {
  lastCheckpoint = performance.now();
  store.save(runId, run.snapshot());
}
function updateClock(): void {
  const clock = document.querySelector("#timer-val");
  if (clock) clock.textContent = formatTime(run.timeRemaining);
  document
    .querySelector("#clock")
    ?.classList.toggle("low", run.timeRemaining <= 15);
  document
    .querySelector("#time-track")
    ?.classList.toggle("low", run.timeRemaining <= 15);
  const bar = document.querySelector<HTMLElement>("#timer-bar");
  if (bar)
    bar.style.width = `${Math.min(
      100,
      (run.timeRemaining / run.maxTime) * 100,
    )}%`;
}
function advanceClock(): boolean {
  const now = performance.now();
  const elapsed = (now - lastClock) / 1000;
  lastClock = now;
  if (run.phase === "playing" && elapsed > 2.5) {
    handleEffects(run.pause());
    notice("Recovery paused while the window was away. No time was lost.");
    return false;
  }
  const effects = run.elapse(elapsed);
  if (effects.length) {
    handleEffects(effects);
    return false;
  }
  updateClock();
  return true;
}
function handleEffects(effects: Effect[]): void {
  if (!effects.length) return;
  lastEffects = effects;
  const terminal = effects.some(
    (effect) => effect.type === "lost" || effect.type === "clear",
  );
  const rootkit = effects.find((effect) => effect.type === "rootkit");
  const lost = effects.find((effect) => effect.type === "lost");
  const purchased = effects.find((effect) => effect.type === "buy");
  const refunded = effects.find((effect) => effect.type === "refund");
  const backup = effects.find((effect) => effect.type === "backup");
  const firewall = effects.find((effect) => effect.type === "firewall");
  const revealed = effects.filter((effect) => effect.type === "reveal").length;
  feedbackKind = lost ? "lost" : "ready";
  if (lost) {
    sound.play("lost");
    feedback =
      lost.reason === "timeout"
        ? "Time expired. Inspect the recovery or try again."
        : lost.reason === "wrongFlag"
          ? `ROOTKIT stopped: ${coordinateLabel(lost.r!, lost.c!)} was a wrong flag.`
          : `Mine hit at ${coordinateLabel(lost.r!, lost.c!)}. The field can be reviewed.`;
    log(
      lost.reason === "wrongFlag"
        ? "ROOTKIT: invalid flag. Process terminated."
        : lost.reason === "timeout"
          ? "Time budget exhausted."
          : `Mine at ${coordinateLabel(lost.r!, lost.c!)}. Recovery interrupted.`,
    );
  } else if (rootkit) {
    sound.play("rootkit");
    log(`ROOTKIT opened ${rootkit.revealed} tiles.`);
    notice(`ROOTKIT spent. ${rootkit.revealed} safe tiles opened.`);
  } else if (effects.some((effect) => effect.type === "clear")) {
    sound.play("clear");
    log(`Sector 0${run.stage + 1} recovered.`);
    feedback = `Sector 0${run.stage + 1} recovered. +${run.completionBonus} clear bonus.`;
  } else if (firewall && firewall.type === "firewall") {
    sound.play("firewall");
    notice(
      `FIREWALL absorbed the mine at ${coordinateLabel(
        firewall.r,
        firewall.c,
      )}. Tile safe; nearby clues changed. Choose Reveal to open it.`,
    );
    log("FIREWALL absorbed one mine.");
  } else if (purchased) {
    sound.play("buy");
    log(`${TOOLS[purchased.tool].name} installed.`);
    feedback = `${TOOLS[purchased.tool].name} installed. You can remove it before leaving the shop.`;
  } else if (refunded) {
    sound.play("buy");
    feedback = `${TOOLS[refunded.tool].name} removed. ${TOOLS[refunded.tool].price} keys refunded.`;
  } else if (backup) {
    sound.play("buy");
    notice(`BACKUP restored ${backup.seconds} seconds.`);
    log(`BACKUP: +${backup.seconds}s.`);
  } else if (effects.some((effect) => effect.type === "flag")) {
    sound.play("flag");
    const flag = effects.find((effect) => effect.type === "flag")!;
    feedback = `${coordinateLabel(flag.r, flag.c)} ${flag.flagged ? "flagged" : "unflagged"}. ${run.flagCount} anchors; ${run.rootkitFootprint.length} covered neighbors in range.`;
  } else if (revealed) {
    sound.play("reveal");
    feedback = `${revealed} safe tile${revealed === 1 ? "" : "s"} recovered. +${revealed} key${revealed === 1 ? "" : "s"}.`;
  }
  if (effects.some((effect) => effect.type === "stage")) {
    inspection = null;
    mode = "reveal";
    focusCell = { r: BOARD.startRow, c: BOARD.startCol };
    log(`Sector 02 loaded. ${loadoutMarkup()}.`);
    feedback = `Deep sector ready. ${loadoutMarkup()}.`;
  }
  if (effects.some((effect) => effect.type === "resume")) {
    lastClock = performance.now();
    log("Recovery resumed.");
    feedback = "Recovery resumed. Your clock is running.";
  }
  if (effects.some((effect) => effect.type === "pause"))
    feedback = "Recovery paused. Your clock and loadout are held.";
  if (terminal) {
    deferOutcome = true;
    if (outcomeTimer) clearTimeout(outcomeTimer);
    outcomeTimer = setTimeout(
      () => {
        deferOutcome = false;
        render();
        window.scrollTo({ top: 0 });
        app
          .querySelector<HTMLElement>("#phase-heading")
          ?.focus({ preventScroll: true });
      },
      lost ? 850 : 650,
    );
  }
  checkpoint();
  render();
  if (effects.some((effect) => effect.type === "stage"))
    window.scrollTo({ top: 0 });
  if (
    effects.some(
      (effect) => effect.type === "resume" || effect.type === "stage",
    )
  )
    app
      .querySelector<HTMLElement>(
        `.cell[data-r="${focusCell.r}"][data-c="${focusCell.c}"]`,
      )
      ?.focus({ preventScroll: true });
  if (effects.some((effect) => effect.type === "pause"))
    app
      .querySelector<HTMLElement>('[data-action="resume"]')
      ?.focus({ preventScroll: true });
  if (rootkit)
    app.querySelector(".board-scroll")?.classList.add("rootkit-fired");
  if (lost) app.querySelector(".monitor")?.classList.add("mine-shake");
}
function perform(action: () => Effect[]): void {
  if (store.status === "conflict" || deferOutcome) return;
  sound.unlock();
  if (!advanceClock()) return;
  handleEffects(action());
}
function inspect(r: number, c: number): void {
  inspection = { r, c };
  focusCell = { r, c };
  app
    .querySelectorAll(".inspect-source,.inspect-neighbor")
    .forEach((element) =>
      element.classList.remove("inspect-source", "inspect-neighbor"),
    );
  const cell = run.board[r]![c]!;
  if (!cell.revealed && !review) {
    inspection = null;
    return;
  }
  app
    .querySelector(`.cell[data-r="${r}"][data-c="${c}"]`)
    ?.classList.add("inspect-source");
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr || dc)
        app
          .querySelector(`.cell[data-r="${r + dr}"][data-c="${c + dc}"]`)
          ?.classList.add("inspect-neighbor");
    }
  const hint = app.querySelector("#board-hint");
  if (hint) hint.textContent = boardHint();
}
function openCell(r: number, c: number, flag = false): void {
  if (run.phase === "paused" || store.status === "conflict") return;
  focusCell = { r, c };
  if ((mode === "inspect" && !flag) || review) {
    inspect(r, c);
    return;
  }
  inspection = null;
  if (
    run.firstClick &&
    (r !== BOARD.startRow || c !== BOARD.startCol || flag || mode === "flag")
  ) {
    notice("Reveal the marked START tile first. Its opening is safe.");
    return;
  }
  perform(() =>
    flag || mode === "flag"
      ? run.flag(r, c)
      : run.board[r]![c]!.revealed
        ? run.chord(r, c)
        : run.reveal(r, c),
  );
}
function pause(): void {
  if (!run || run.phase !== "playing") return;
  if (!advanceClock()) return;
  handleEffects(run.pause());
}
function help(): void {
  pause();
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<header class="titlebar"><span class="app-icon">?</span><h1>SWEEPER.HLP</h1></header><div class="help-body"><h2>A recovery, in two acts.</h2><p>Clear every safe tile in both sectors. Your clock starts with your first reveal, and stops whenever you pause.</p><button class="win-button primary wide" id="practice-help">Learn by playing · no timer</button><h3>01 / READ THE FIELD</h3><p>A number counts mines in its eight neighboring tiles. Reveal safe tiles; use Flag to mark a suspected mine. Tapping a revealed number opens its remaining neighbors when the flag count matches. Wrong flags can hit a mine.</p><h3>02 / BUILD YOUR NETWORK</h3><p>Each flag is a ROOTKIT anchor. The amber range preview shows covered neighbors linked to your flags. It does not tell you which tiles are safe or whether your flags are right.</p><p class="warning">Execute ROOTKIT to open safe tiles around all flags. <strong>Any wrong flag ends the run, even with FIREWALL.</strong> You start with one charge. Save it for later or spend it now.</p><h3>03 / BUY YOUR WAY THROUGH</h3><p>Every safe tile earns a key. Clearing sector 1 pays a bonus and opens the shop. Buy time, mine protection or another ROOTKIT. Unused tools and 30% of the remaining clock carry into sector 2.</p><p>Right-click, long-press or <kbd>F</kbd> to flag. Arrow keys move; <kbd>Enter</kbd> reveals. <kbd>Esc</kbd> pauses. Larger tiles lets you scroll a roomier board.</p><button class="win-button primary wide" id="close-help">Got it</button></div>`;
  document.body.appendChild(dialog);
  dialog.querySelector("#practice-help")!.addEventListener("click", () => {
    dialog.close();
    lesson();
  });
  dialog
    .querySelector("#close-help")!
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  const heading = dialog.querySelector("h2")!;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  dialog.scrollTop = 0;
}
async function copyReport(): Promise<void> {
  const report = `SWEEPER.EXE · ${run.date}\n${
    run.phase === "won"
      ? "Recovery complete: 2/2"
      : `Recovery interrupted: ${run.stage}/2`
  }\nHeld: ${loadoutMarkup()}\nSame field. Different decisions.`;
  try {
    await navigator.clipboard.writeText(report);
    notice("Recovery report copied.");
  } catch {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<div class="help-body"><h2>Recovery report</h2><p>Copy this report to share your run.</p><textarea readonly rows="6" style="width:100%">${escape(
      report,
    )}</textarea><button class="win-button wide">Close</button></div>`;
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector("textarea")!.select();
    dialog
      .querySelector("button")!
      .addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
  }
}
function lesson(): void {
  pause();
  app
    .querySelector<HTMLElement>('[data-action="lesson"], [data-action="help"]')
    ?.focus({ preventScroll: true });
  openLesson();
}
async function refreshInlineRecovery(): Promise<boolean> {
  if (refreshTask) return refreshTask;
  if (hostMode !== "inline") return false;
  refreshing = true;
  refreshTask = (async () => {
    const accepted = await store.refresh();
    refreshing = false;
    if (accepted) {
      needsRefresh = false;
      refreshFailed = false;
      const restored = store.active
        ? DailyRun.restore(store.active.snapshot)
        : null;
      run = restored ?? new DailyRun(store.bootstrap.challenge.date);
      runId = store.active?.runId ?? crypto.randomUUID();
      review = false;
      deferOutcome = false;
      inspection = null;
      feedback = restored
        ? "Latest recovery loaded. Your progress is intact."
        : `Best this recovery: ${store.bestProgress}/2 sectors. Ready for a fresh attempt.`;
      lastClock = performance.now();
    } else {
      refreshFailed = true;
      feedback =
        "Your latest save is not available yet. Reload to recover pending progress.";
    }
    render();
    return accepted;
  })().finally(() => {
    refreshTask = null;
  });
  return refreshTask;
}
async function enterInline(): Promise<void> {
  if ((refreshing || needsRefresh) && !(await refreshInlineRecovery())) return;
  playInline = true;
  render();
}
function syncHostMode(): void {
  if (!store || store.bootstrap.mode !== "reddit") return;
  const next = getWebViewMode();
  if (next === hostMode) return;
  if (next === "inline") pause();
  hostMode = next;
  expanding = false;
  if (next === "expanded") {
    playInline = false;
    expansionFallback = false;
  } else {
    needsRefresh = true;
    void refreshInlineRecovery();
  }
  render();
}
async function expand(event: MouseEvent): Promise<void> {
  if (expanding) return;
  if (store.bootstrap.mode !== "reddit" || !store.bootstrap.user) {
    playInline = true;
    render();
    return;
  }
  if ((refreshing || needsRefresh) && !(await refreshInlineRecovery())) return;
  if (expanding) return;
  pause();
  checkpoint();
  expanding = true;
  render();
  for (let attempt = 0; attempt < 150 && store.status === "saving"; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 40));
  if (store.status !== "saved") {
    expanding = false;
    feedback =
      "Your save is still syncing. Try opening the recovery again shortly.";
    render();
    return;
  }
  try {
    requestExpandedMode(event, "game");
    setTimeout(() => {
      if (hostMode !== "inline") return;
      expanding = false;
      if (!document.hidden && document.hasFocus()) {
        expansionFallback = true;
        feedback = "Expanded view did not open. Retry or play in this post.";
      }
      render();
    }, 4000);
  } catch {
    expanding = false;
    playInline = true;
    feedback = "Expanded view is unavailable. You can play here.";
    render();
  }
}
app.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("button");
  if (!button || button.disabled) return;
  if (button.dataset.action === "reload") {
    location.reload();
    return;
  }
  if (!run) return;
  if (button.classList.contains("cell")) {
    if (performance.now() < ignoreClickUntil) return;
    openCell(Number(button.dataset.r), Number(button.dataset.c));
    return;
  }
  if (button.dataset.mode) {
    const selected = button.dataset.mode;
    if (
      selected === "reveal" ||
      selected === "flag" ||
      selected === "inspect"
    ) {
      mode = selected;
      inspection = null;
      render();
    }
    return;
  }
  if (button.dataset.buy) {
    const tool = button.dataset.buy;
    if (tool === "rootkit" || tool === "firewall" || tool === "backup")
      perform(() =>
        run.shopBought.includes(tool) ? run.refund(tool) : run.buy(tool),
      );
    return;
  }
  switch (button.dataset.action) {
    case "lesson":
      lesson();
      break;
    case "help":
      help();
      break;
    case "sound":
      sound.toggle();
      render();
      break;
    case "pause":
      run.phase === "paused" ? perform(() => run.resume()) : pause();
      break;
    case "resume":
      perform(() => run.resume());
      break;
    case "preview":
      preview = !preview;
      render();
      break;
    case "rootkit":
      perform(() => {
        const effects = run.useRootkit();
        if (!effects.length)
          notice("No new tiles opened. Your charge is kept.");
        return effects;
      });
      break;
    case "backup":
      perform(() => run.useBackup());
      break;
    case "next":
      perform(() => run.nextStage());
      break;
    case "size":
      largeTiles = !largeTiles;
      render();
      break;
    case "retry":
      if (outcomeTimer) clearTimeout(outcomeTimer);
      deferOutcome = false;
      review = false;
      inspection = null;
      mode = "reveal";
      run = new DailyRun(store.bootstrap.challenge.date);
      runId = crypto.randomUUID();
      focusCell = { r: BOARD.startRow, c: BOARD.startCol };
      lastClock = performance.now();
      eventLog = ["Same recovery. New attempt."];
      feedback = "A fresh attempt. Your best recovery is still recorded.";
      feedbackKind = "ready";
      checkpoint();
      render();
      break;
    case "review":
      review = true;
      inspection = null;
      render();
      break;
    case "results":
      review = false;
      render();
      break;
    case "copy":
      void copyReport();
      break;
    case "play-inline":
      void enterInline();
      break;
    case "launch":
    case "expand":
      void expand(event);
      break;
  }
});
app.addEventListener("contextmenu", (event) => {
  if (!(event.target instanceof Element)) return;
  const cell = event.target.closest<HTMLElement>(".cell");
  if (!cell) return;
  event.preventDefault();
  if (performance.now() >= ignoreClickUntil)
    openCell(Number(cell.dataset.r), Number(cell.dataset.c), true);
});
app.addEventListener(
  "pointerdown",
  (event) => {
    if (
      event.pointerType !== "touch" ||
      !(event.target instanceof Element) ||
      !run ||
      run.phase === "paused"
    )
      return;
    const cell = event.target.closest<HTMLElement>(".cell");
    if (!cell || mode === "inspect" || review) return;
    if (touch) {
      cancelTouch(true);
      return;
    }
    touch = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      cell: { r: Number(cell.dataset.r), c: Number(cell.dataset.c) },
    };
    holdTimer = setTimeout(() => {
      if (!touch) return;
      const point = touch.cell;
      cancelTouch(true);
      openCell(point.r, point.c, true);
    }, 450);
  },
  { passive: true },
);
function cancelTouch(suppress = false): void {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
  touch = null;
  if (suppress) ignoreClickUntil = performance.now() + 700;
}
app.addEventListener(
  "pointermove",
  (event) => {
    if (
      touch &&
      (event.pointerId !== touch.id ||
        Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8)
    )
      cancelTouch(true);
  },
  { passive: true },
);
app.addEventListener("pointerup", () => cancelTouch(), { passive: true });
app.addEventListener("pointercancel", () => cancelTouch(true), {
  passive: true,
});
app.addEventListener("focusin", (event) => {
  if (
    !(event.target instanceof HTMLElement) ||
    !event.target.classList.contains("cell")
  )
    return;
  focusCell = {
    r: Number(event.target.dataset.r),
    c: Number(event.target.dataset.c),
  };
  app
    .querySelectorAll<HTMLElement>(".cell")
    .forEach((cell) => (cell.tabIndex = cell === event.target ? 0 : -1));
});
app.addEventListener("keydown", (event) => {
  if (
    !(event.target instanceof HTMLElement) ||
    !event.target.classList.contains("cell")
  )
    return;
  const r = Number(event.target.dataset.r),
    c = Number(event.target.dataset.c);
  let nr = r,
    nc = c;
  if (event.key === "ArrowUp") nr = Math.max(0, r - 1);
  else if (event.key === "ArrowDown") nr = Math.min(7, r + 1);
  else if (event.key === "ArrowLeft") nc = Math.max(0, c - 1);
  else if (event.key === "ArrowRight") nc = Math.min(7, c + 1);
  else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    openCell(r, c, true);
    return;
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    openCell(r, c);
    return;
  } else return;
  event.preventDefault();
  app
    .querySelector<HTMLElement>(`.cell[data-r="${nr}"][data-c="${nc}"]`)
    ?.focus();
  if (mode === "inspect") inspect(nr, nc);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("dialog[open]"))
    pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
  else lastClock = performance.now();
});
window.addEventListener("pagehide", () => {
  if (run) pause();
});
window.addEventListener("blur", () => {
  wasAway = true;
  pause();
});
window.addEventListener("focus", () => {
  syncHostMode();
  if (
    wasAway &&
    store?.bootstrap.mode === "reddit" &&
    hostMode === "inline" &&
    !playInline
  ) {
    needsRefresh = true;
    expanding = false;
  }
  wasAway = false;
});
window.addEventListener("online", () => {
  if (store) void store.flush();
});

async function start(): Promise<void> {
  try {
    store = await ProgressStore.open();
    const restored = store.active
      ? DailyRun.restore(store.active.snapshot)
      : null;
    run = restored ?? new DailyRun(store.bootstrap.challenge.date);
    if (restored && store.active) runId = store.active.runId;
    log(
      restored
        ? "Recovery restored. No time lost while away."
        : "Recovery loaded. Awaiting first reveal.",
    );
    store.onChange = () => {
      if (store.status === "conflict") {
        run.pause();
        render();
        return;
      }
      const status = document.querySelector("#sync-status");
      if (status) {
        status.textContent = syncLabel();
        status.setAttribute("title", syncLabel());
      }
      if (
        needsRefresh &&
        !refreshing &&
        hostMode === "inline" &&
        store.status === "saved"
      )
        void refreshInlineRecovery();
    };
    const latest = store.bootstrap.state.latestResult;
    feedback = restored
      ? "Recovery restored. Your clock waited for you."
      : latest
        ? `Last recovery: ${latest.progress}/2 sectors. Best this recovery: ${store.bestProgress}/2. Start another attempt when ready.`
        : "Recovery loaded. The clock starts on your first reveal.";
    hostMode =
      store.bootstrap.mode === "reddit"
        ? getWebViewMode()
        : import.meta.env.DEV &&
            new URLSearchParams(location.search).has("cover")
          ? "inline"
          : "expanded";
    lastClock = performance.now();
    render();
    setInterval(() => {
      syncHostMode();
      if (!run || document.hidden || run.phase !== "playing") return;
      advanceClock();
      if (performance.now() - lastCheckpoint > 5000) checkpoint();
    }, 100);
  } catch {
    app.innerHTML =
      '<div class="boot-card"><span class="app-icon">S</span><h1>Recovery unavailable.</h1><p>The challenge could not be loaded. Your existing save has not been replaced.</p><button class="win-button primary" data-action="reload">Try again</button></div>';
    app.setAttribute("aria-busy", "false");
  }
}
void start();
