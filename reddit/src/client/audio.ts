export class GameAudio {
  muted = false;
  private context: AudioContext | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem("sweeper:recovery:muted") === "true";
    } catch {
      /* Browser storage can be unavailable in embedded views. */
    }
  }

  unlock(): void {
    if (this.muted || !("AudioContext" in window)) return;
    this.context ??= new AudioContext();
    if (this.context.state === "suspended")
      void this.context.resume().catch(() => {});
  }

  toggle(): void {
    this.muted = !this.muted;
    try {
      localStorage.setItem("sweeper:recovery:muted", String(this.muted));
    } catch {
      /* Sound still works without persistence. */
    }
    if (!this.muted) {
      this.unlock();
      this.play("flag");
    }
  }

  play(
    kind: "reveal" | "flag" | "rootkit" | "firewall" | "buy" | "clear" | "lost"
  ): void {
    if (this.muted || !this.context || this.context.state !== "running") return;
    const notes = {
      reveal: [520],
      flag: [330, 440],
      rootkit: [130, 260, 390, 520, 780],
      firewall: [210, 420, 315],
      buy: [660, 880],
      clear: [330, 440, 550, 660],
      lost: [180, 110, 65],
    }[kind];
    notes.forEach((frequency, index) => {
      const ctx = this.context!;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.055;
      oscillator.type =
        kind === "rootkit" || kind === "lost" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.055, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.12);
    });
  }
}
