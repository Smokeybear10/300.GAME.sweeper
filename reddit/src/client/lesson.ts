import "./lesson.css";

type Step = 0 | 1 | 2 | 3;

const mine = 1;
const start = 3;
const initialOpen = [0, 4, 6, 7, 8];
const names = ["Reveal", "Deduce & flag", "Use ROOTKIT"];
const flagIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18M3 21h8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 3v11l11-6z" fill="currentColor"/></svg>';

function adjacent(a: number, b: number): boolean {
  return (
    a !== b &&
    Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) <= 1 &&
    Math.abs((a % 3) - (b % 3)) <= 1
  );
}

function label(index: number): string {
  return `${String.fromCharCode(65 + (index % 3))}${Math.floor(index / 3) + 1}`;
}

export function openLesson(): void {
  const existing = document.querySelector<HTMLDialogElement>(".lesson-dialog");
  if (existing) {
    existing.querySelector<HTMLElement>(".lesson-heading")?.focus();
    return;
  }

  const returnFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const dialog = document.createElement("dialog");
  dialog.className = "lesson-dialog";
  dialog.setAttribute("aria-labelledby", "lesson-title");
  dialog.setAttribute("aria-describedby", "lesson-summary");
  dialog.innerHTML = `<header class="titlebar lesson-titlebar"><span class="lesson-app-mark" aria-hidden="true">?</span><h2 id="lesson-title">SWEEPER.HLP</h2><button class="win-button lesson-close" data-lesson-action="close" aria-label="Close practice lesson">×</button></header>
    <div class="lesson-body"><p class="lesson-eyebrow">Untimed practice</p><p id="lesson-summary" class="lesson-summary">Three steps. Your recovery stays untouched.</p><ol class="lesson-progress" aria-label="Lesson progress"></ol><p class="lesson-feedback" role="status" aria-live="polite" aria-atomic="true"></p><div class="lesson-content"></div></div>
    <footer class="lesson-footer"><div class="lesson-command"></div><div class="lesson-actions"><button class="win-button" data-lesson-action="restart">Restart lesson</button><button class="win-button" data-lesson-action="close">Close lesson</button></div></footer>`;

  const content = dialog.querySelector<HTMLElement>(".lesson-content")!;
  const progress = dialog.querySelector<HTMLOListElement>(".lesson-progress")!;
  const command = dialog.querySelector<HTMLElement>(".lesson-command")!;
  const feedback = dialog.querySelector<HTMLElement>(".lesson-feedback")!;
  let step: Step = 0;
  let opened = new Set(initialOpen);
  let flagged: number | null = null;
  let message = "";
  let error = false;

  function render(focus = false): void {
    const titles = [
      "1. Reveal the safe start",
      "2. Find the one mine",
      "3. Run ROOTKIT",
      "Practice complete",
    ];
    const instructions = [
      "Open START at A2. A number counts mines in the eight tiles touching it.",
      "A2 shows 1. Its outlined neighbors contain just one covered tile. Tap that tile to flag it.",
      "Dashed links show covered neighbors in range, not confirmed safe tiles. Tap your flag again to change it.",
      "You recovered all eight safe tiles. The flag at B1 was correct: it was A2’s only covered neighbor.",
    ];
    progress.innerHTML = names
      .map(
        (name, index) =>
          `<li class="${
            index < step
              ? "lesson-step-done"
              : index === step
                ? "lesson-step-current"
                : ""
          }" ${
            index === step ? 'aria-current="step"' : ""
          }><span aria-hidden="true">${
            index < step ? "✓" : index + 1
          }</span>${name}<span class="lesson-sr-only">${
            index < step
              ? ", completed"
              : index === step
                ? ", current step"
                : ", upcoming"
          }</span></li>`,
      )
      .join("");

    const cells = Array.from({ length: 9 }, (_, index) => {
      const isOpen = opened.has(index);
      const isFlagged = flagged === index;
      const count = adjacent(index, mine) ? 1 : 0;
      const inRange =
        step === 2 &&
        flagged !== null &&
        !isOpen &&
        !isFlagged &&
        adjacent(index, flagged);
      const classes = [
        "lesson-cell",
        isOpen ? "lesson-open" : "lesson-covered",
      ];
      if (step === 0 && index === start) classes.push("lesson-start");
      if (step === 1 && index === start) classes.push("lesson-clue");
      if (step === 1 && adjacent(index, start)) classes.push("lesson-neighbor");
      if (isFlagged) classes.push("lesson-flagged");
      if (inRange) classes.push("lesson-in-range");
      const state = isFlagged
        ? step === 3
          ? "correctly flagged mine"
          : "flagged tile; activate to remove the flag"
        : isOpen
          ? `revealed safe tile, ${count} neighboring mines`
          : step === 0 && index === start
            ? "START, safe tile; activate to reveal"
            : step === 0
              ? "covered tile; begin at START"
              : "covered tile; activate to place your flag";
      return `<button type="button" class="${classes.join(
        " ",
      )}" data-lesson-cell="${index}" aria-label="${label(index)}, ${state}" ${
        isOpen || step === 3 ? "disabled" : ""
      }>${
        isFlagged
          ? flagIcon
          : isOpen
            ? count || ""
            : step === 0 && index === start
              ? '<span class="lesson-start-label">START</span>'
              : ""
      }</button>`;
    }).join("");
    const lines =
      step === 2 && flagged !== null
        ? Array.from({ length: 9 }, (_, index) => index)
            .filter((index) => !opened.has(index) && adjacent(index, flagged!))
            .map(
              (index) =>
                `<line x1="${(flagged! % 3) * 100 + 50}" y1="${
                  Math.floor(flagged! / 3) * 100 + 50
                }" x2="${(index % 3) * 100 + 50}" y2="${
                  Math.floor(index / 3) * 100 + 50
                }"/>`,
            )
            .join("")
        : "";
    content.innerHTML = `<h3 class="lesson-heading" tabindex="-1" aria-describedby="lesson-instruction">${
      titles[step]
    }</h3><p id="lesson-instruction" class="lesson-instruction">${
      instructions[step]
    }</p>
      <div class="lesson-board-frame"><div class="lesson-columns" aria-hidden="true"><span>A</span><span>B</span><span>C</span></div><div class="lesson-rows" aria-hidden="true"><span>1</span><span>2</span><span>3</span></div><div class="lesson-board" role="group" aria-label="Practice minefield, three rows by three columns, one mine">${cells}<svg class="lesson-links" viewBox="0 0 300 300" aria-hidden="true">${lines}</svg></div></div>
      <p class="lesson-board-status">${
        opened.size
      }/8 safe · 1 mine · ROOTKIT ×${step === 3 ? 0 : 1}</p>
      ${
        step === 3
          ? '<div class="lesson-takeaway"><p><strong>A chord is free:</strong> in Reveal mode, tap a revealed number with the matching number of flags to open its other neighbors. A matching count does not prove the flags correct.</p><p><strong>ROOTKIT spends a charge:</strong> it opens safe neighbors of <em>all</em> your flags, without needing a matching numbered clue. Any wrong flag anywhere ends the run, even with FIREWALL.</p><p>You could also finish this practice with a free chord on B2. Tools are optional; save a charge when ordinary deduction is enough.</p></div>'
          : ""
      }`;
    command.innerHTML =
      step === 2
        ? '<p class="lesson-risk"><strong>A wrong flag ends a real run—even with FIREWALL.</strong></p><button class="win-button lesson-execute" data-lesson-action="execute">Execute ROOTKIT · 1 charge</button>'
        : step === 3
          ? '<button class="win-button primary lesson-finish" data-lesson-action="close">Back to recovery</button>'
          : '<p class="lesson-command-hint">Use the board to continue. There is no clock.</p>';
    feedback.textContent = message;
    feedback.classList.toggle("lesson-feedback-error", error);
    if (focus) content.querySelector<HTMLElement>(".lesson-heading")?.focus();
  }

  dialog.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    const action = button.dataset.lessonAction;
    if (action === "close") {
      dialog.close();
      return;
    }
    if (action === "restart") {
      step = 0;
      opened = new Set(initialOpen);
      flagged = null;
      message = "Lesson restarted. Your recovery is unchanged.";
      error = false;
      render(true);
      return;
    }
    if (action === "execute" && step === 2) {
      if (flagged !== mine) {
        step = 1;
        flagged = null;
        message =
          "That flag was wrong. ROOTKIT would end the real run. Try again: A2’s 1 belongs to its only covered neighbor.";
        error = true;
      } else {
        opened = new Set([0, 2, 3, 4, 5, 6, 7, 8]);
        step = 3;
        message = "ROOTKIT opened C1 and C2. One charge spent.";
        error = false;
      }
      render(true);
      return;
    }
    if (button.dataset.lessonCell === undefined || step === 3) return;
    const index = Number(button.dataset.lessonCell);
    if (step === 0) {
      if (index !== start) {
        message = "Start with A2, the tile marked START. It is safe to open.";
        error = false;
        feedback.textContent = message;
        feedback.classList.remove("lesson-feedback-error");
        return;
      }
      opened.add(start);
      step = 1;
      message = "";
    } else {
      flagged = flagged === index ? null : index;
      step = flagged === null ? 1 : 2;
      message = "";
    }
    error = false;
    render(true);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const buttons = dialog.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    },
    { once: true },
  );
  render();
  document.body.appendChild(dialog);
  dialog.showModal();
  content.querySelector<HTMLElement>(".lesson-heading")?.focus();
}
