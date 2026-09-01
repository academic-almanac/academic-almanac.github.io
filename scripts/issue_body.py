#!/usr/bin/env python3
"""
Render the review issue that .github/workflows/weekly-scrape.yml opens.

    python scripts/issue_body.py candidates/emerald-2026-09-01.jsonl > body.md

Kept as a script rather than inline shell in the workflow so it can be run and
checked locally.
"""

import json
import sys
from pathlib import Path


def cell(value):
    """Table-cell safe: escape pipes, keep it short enough to read."""
    text = str(value or "").replace("|", "\\|").replace("\n", " ").strip()
    return text[:110]


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: issue_body.py <candidates.jsonl>")
    path = Path(sys.argv[1])
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    records.sort(key=lambda r: r.get("submission_deadline") or "9999")

    out = []
    out.append("The weekly scrape found **" + str(len(records)) +
               "** call(s) that are not already listed.")
    out.append("")
    out.append("| Closes | Journal | Title |")
    out.append("|---|---|---|")
    for r in records:
        out.append("| " + cell(r.get("submission_deadline")) +
                   " | " + cell(r.get("organiser")) +
                   " | [" + cell(r.get("title")) + "](" +
                   str(r.get("official_link", "")) + ") |")
    out.append("")
    out.append("### To integrate")
    out.append("")
    out.append("```")
    out.append("git pull")
    out.append("python scripts/ingest.py " + str(path) +
               "          # review, writes nothing")
    out.append("python scripts/ingest.py " + str(path) +
               " --write   # append to content.xlsx")
    out.append("python scripts/generate.py")
    out.append('git commit -am "Publish new listings" && git push')
    out.append("```")
    out.append("")
    out.append("Out of scope? Add `\"skip\": true` to that line in `" + str(path) +
               "` and commit it. Skipped lines are remembered, so a rejected "
               "call will not come back next week.")
    out.append("")
    out.append("Everything ingested is marked `verified = no` until someone "
               "checks it against the source.")
    print("\n".join(out))


if __name__ == "__main__":
    main()
