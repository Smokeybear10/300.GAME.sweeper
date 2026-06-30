# Design System — SWEEPER.EXE

## Product Context
- **What this is:** Arcade-pressure minesweeper disguised as recovered shareware from 1997
- **Who it's for:** People who want minesweeper with stakes and a creepy atmosphere
- **Space/industry:** Browser puzzle games meets analog horror ARG
- **Project type:** Web app (single-page game)

## Aesthetic Direction
- **Direction:** Found Footage / Analog Horror
- **Core concept:** You found an old hard drive. There's one program on it: SWEEPER.EXE. The trial expired 25 years ago. The tape is still recording. Something is wrong with session 00047.
- **Decoration level:** Restrained CRT scanlines and VHS artifacts around a readable game window. The taskbar CRT switch turns the effects off; reduced-motion preferences default to off.
- **Mood:** Uncanny, eerie, something-is-wrong. A 90s computer that shouldn't still be running. Not jump-scare horror — slow-burn wrongness. The kind of video you'd find on a cursed VHS tape.
- **Reference:** Windows 95/98 desktop, VHS camcorder recordings, analog horror YouTube (Local 58, Backrooms, Mandela Catalogue), cursed shareware

## Visual Layers (inside to outside)
1. **Desktop** — Windows 98 teal desktop with icons, Win98 chrome windows
2. **CRT glass** — Scanlines, vignette, tracking line, chromatic aberration
3. **VHS recording** — REC indicator, timestamp, tape counter, screen tearing, horizontal hold artifacts
4. **Monitor bezel** — Dark plastic CRT bezel with brand stamp and LED
5. **Film grain** — Subtle noise overlay on everything

## Typography
- **Win98 UI:** 'Tahoma', 'Geneva', 'MS Sans Serif', sans-serif — authentic Windows 98
- **Data/Terminals:** 'JetBrains Mono', monospace — BIOS text, code, system info
- **VHS overlays:** 'VT323', monospace — pixel-perfect camcorder timestamp font
- **Display/Hero:** 'Space Grotesk' (700) — SWEEPER branding in boot splash
- **Loading:** Google Fonts CDN (JetBrains Mono, Space Grotesk, VT323)

## Color
- **Approach:** Authentic Win98 palette + found footage degradation
- **Room (behind CRT):** #000 pure black
- **CRT desktop:** #0C4846 (teal — classic Win98 Active Desktop)
- **Win98 face:** #BCBCBC (standard Win98 gray)
- **Win98 highlight:** #EFEFEF / #D4D4D4
- **Win98 shadow:** #404040 / #6E6E6E
- **Titlebar gradient:** #0A1163 → #1070B8 (Win98 active)
- **Danger/blood:** #7A1414 / #B02020 (error dialogs, warnings, analog horror red)
- **Selection:** #08106A (Win98 highlight blue)
- **VHS overlays:** White at 30-70% opacity, red for REC
- **Number colors:** Dark blue, green, red, purple, brown, teal, and charcoal on light gray tiles, with stronger contrast than the original muted palette
- **Dark mode:** Everything is dark. The CRT is the only light source.

## Spacing
- **Base unit:** Win98 standard pixel sizes (2px borders, 3px padding on titlebars)
- **Density:** Tight — Win98 was pixel-efficient
- **CRT bezel padding:** 22px on desktop; removed on small screens to give the board room

## Layout
- **Approach:** CRT monitor centered on black void
- **CRT screen content:** Win98 desktop with floating windows
- **Taskbar:** Fixed at bottom of CRT screen — Start button, app buttons, system tray with clock
- **Desktop icons:** Draggable, Win98-authentic (32x32 icon + label)
- **Windows:** Draggable, stackable, closable — full Win98 window chrome

## Motion / Effects
- **CRT scanlines:** Repeating 3px horizontal lines with a low-opacity overlay
- **CRT vignette:** Radial gradient darkening edges, plus subtle curved glass highlight
- **Tracking line:** Single bright line sweeping top to bottom (7s loop)
- **Chromatic aberration:** Red/cyan fringing at screen edges
- **VHS tear:** Intermittent horizontal displacement (4.5s cycle, appears ~4% of time)
- **Horizontal hold:** Occasional frame shift band (18s cycle)
- **Glitch bar:** White flash band (11s cycle)
- **Film grain:** Animated noise texture at 14% overlay blend
- **Screen flicker:** Subtle opacity dips (8s cycle)
- **Boot sequence:** Optional BIOS POST and Win98 splash through Start → Restart. The page opens directly to the game launcher.
- **Window jitter:** Error modals have subtle position jitter

## Key Design Decisions

### Safe (what users expect)
- Grid-based minesweeper cells
- Color-coded numbers
- Right-click to flag

### Risks (what makes SWEEPER.EXE its own thing)
- Entire game wrapped in a CRT monitor running Win98
- Found footage overlays make you feel like you're watching a tape
- Session counter that started at 47 (of 3 allowed) — something already happened
- Trial-expired references remain in optional boot and desktop files
- Optional boot sequence with BIOS POST and "TRIAL EXPIRED" warning
- VHS timestamp frozen in January 1998
- System messages that feel slightly wrong

## Playability
- Start a run or resume directly from the launcher. Module descriptions explain the rule changes.
- The first reveal starts the clock; Pause, Escape, closing the game window, or switching tabs pauses it.
- The board uses one keyboard tab stop and visible Reveal/Flag/Inspect controls for touch. Clue inspection highlights neighbors and explains the current flag count.
- On phones, large boards scroll inside the game window instead of shrinking into tiny cells.
- Automatic and manual saves remain local to the browser.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-04 | Initial design system created | Arcade pressure theme based on competitive research |
| 2026-04-05 | Consolidated to found footage / analog horror | Too many variant themes. One strong identity: a cursed VHS recording of a 90s shareware program. Win98 desktop + CRT bezel + VHS overlays as the singular aesthetic. |
| 2026-04-05 | Added Win98 taskbar | More authentic 90s computer feel — Start button, system tray, clock frozen in 1998 |
| 2026-04-05 | Added VHS found footage overlays | REC indicator, timestamp, tape counter, screen tearing — sells the "you're watching a recording" concept |
| 2026-04-05 | Removed base arcade theme | Stripped the dark neon arcade CSS/HTML. EXE mode is now the only mode. |
