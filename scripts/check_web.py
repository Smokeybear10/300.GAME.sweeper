import json
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path


class Scripts(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.blocks = []
        self.current = None

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == "script":
            self.current = (dict(attrs), self.getpos()[0], [])

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        self.handle_starttag(tag, attrs)

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.current[2].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.current is not None:
            self.blocks.append(self.current)
            self.current = None


def main() -> int:
    node = shutil.which("node")
    if node is None:
        print("Install Node.js 24, then rerun: python3 scripts/check_web.py", file=sys.stderr)
        return 1

    page = Path(__file__).resolve().parents[1] / "index.html"
    parser = Scripts()
    parser.feed(page.read_text(encoding="utf-8"))
    parser.close()
    if parser.current is not None or not parser.blocks:
        print("index.html: missing or unclosed script block", file=sys.stderr)
        return 1

    javascript = 0
    structured_data = 0
    for attrs, line, chunks in parser.blocks:
        source = "".join(chunks)
        script_type = (attrs.get("type") or "").strip().lower()
        if "src" in attrs or script_type not in (
            "", "text/javascript", "application/javascript", "application/ld+json"
        ):
            print(f"index.html:{line}: update this check to support the new script type or source", file=sys.stderr)
            return 1
        if script_type == "application/ld+json":
            try:
                json.loads(source)
            except json.JSONDecodeError as error:
                print(f"index.html:{line}: invalid JSON-LD: {error}", file=sys.stderr)
                return 1
            structured_data += 1
            continue

        result = subprocess.run(
            [node, "--check"], input="\n" * (line - 1) + source, text=True,
            capture_output=True,
        )
        if result.returncode:
            print(result.stderr.replace("[stdin]", "index.html"), file=sys.stderr)
            return result.returncode
        javascript += 1

    if not javascript:
        print("index.html: no game JavaScript found", file=sys.stderr)
        return 1
    print(f"Syntax OK: {javascript} JavaScript block(s), {structured_data} JSON-LD block(s).")
    print("Browser behavior still needs a manual check; see CONTRIBUTING.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
