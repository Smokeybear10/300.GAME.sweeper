# Contributing to Sweeper

Bug fixes, keyboard and touch improvements, and clearer instructions are welcome. Start with a [good first issue](https://github.com/Smokeybear10/300.GAME.sweeper/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22), or open an issue with steps to reproduce a problem. Discuss larger gameplay changes before implementing them.

## Run locally

Fork the repository on GitHub, then clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/300.GAME.sweeper.git
cd 300.GAME.sweeper
git switch -c fix/short-description
python3 -m http.server 2500
```

Replace `YOUR_USERNAME` with your GitHub username. Open http://localhost:2500. Python 3 serves the files; there is no package install, build, account, or API key. On Windows, use `py -3` if `python3` is unavailable. If the port is in use, choose another port and open that address.

Keep a separate browser profile for development. Saves live in localStorage and are tied to the address and port; switching ports starts with separate saves. Reload after editing `index.html`.

## Find the code

The browser game is in `index.html`. Search for these names:

| Area | Where to look |
| --- | --- |
| Layout, colors, responsive rules | `<style>` |
| Board generation and deduction | `sweeperGenerateBoard`, `sweeperInferMoves` |
| Rules, reveals, flags, utilities | `class Game` |
| Launcher, board, keyboard and touch input | `class GameUI`, `renderBoard` |
| Daily boards | `sweeperDailyDate`, `_startDaily`, `_recordDaily` |
| Saves and resume | `_snapshot`, `_validSave`, `_restoreSave` |
| Desktop menus and terminal | `_bindExeChrome`, `showTerminal` |

`cis1200/` is the original Java game, separate from the website. Browser changes belong in `index.html`; you do not need Java or Maven for them. Keep the Windows 98 appearance described in [DESIGN.md](DESIGN.md), and avoid unrelated formatting changes in the large HTML file.

## Check your change

With Python 3.9+ and Node.js 24 installed, run from the repository root:

```bash
python3 scripts/check_web.py
git diff --check
```

The web check validates inline JavaScript syntax and JSON-LD. It does not run the game or test its rules. GitHub Actions runs the same check on pull requests.

Check the affected behavior in a browser and record the result in your PR. For gameplay or input changes, also check:

- **Learn to play:** reveal, inspect, flag, and clear neighbors.
- **New run:** reveal a tile, pause, resume, reload, then resume the saved run.
- **Daily board:** open a daily link and check that its date is retained.
- **Inputs:** mouse, keyboard navigation with Enter/Space/F, and touch if affected.
- **Display:** a narrow phone-sized window and CRT effects switched off.
- **Console:** no new errors while repeating the reported problem and the fix.

For changes inside `cis1200/`, use JDK 17 and Maven:

```bash
mvn -B -f cis1200/pom.xml test
```

Those tests cover the Java version, not the browser game.

## Send a pull request

Keep each PR focused on one change. Link the issue, explain the before-and-after behavior, and list the checks you ran. Include a screenshot or short recording for a visible change. Reports of things you could not test are useful too.

Use a short, specific commit message such as `cancel pending start menu opening`. Preserve existing save formats and daily-board seeds unless the issue explicitly calls for changing them.

The original browser code and contribution tooling use the [MIT license](LICENSE). See [license scope](LICENSE-SCOPE.md) before reusing assets or the Java archive. Keep third-party license notices intact.
