#!/usr/bin/env python3
"""
Academic Almanac - build the published data.json from both data sources.

    python scripts/publish.py              # rebuild data.json
    python scripts/publish.py --dry-run    # report, write nothing

There are two sources, because the two kinds of listing arrive differently:

  data/manual.json     exported from content.xlsx by generate.py. The workbook
                       stays the master for hand-curated entries and stays in
                       OneDrive, where the team edits it.
  data/scraped.jsonl   listings that arrived from a scraper and were approved by
                       merging a pull request. Tracked in git so GitHub Actions
                       can publish them with no local step.

    content.xlsx --generate.py--> data/manual.json  --.
                                                       >-- publish.py --> data.json
    candidates/*.jsonl (approved) --> data/scraped.jsonl --'

data/scraped.jsonl is also the id registry. Ids there are assigned once and never
change, because the site stores a visitor's saved listings by id in their browser
(js/app.js, LOCAL_KEY) - a shifting id would silently move somebody's stars onto
a different listing. Scraped ids start at SCRAPED_ID_BASE so they can never
collide with the workbook's.

A candidate marked "skip": true is withdrawn: it is removed from the registry and
disappears from the site. That is how a reviewer rejects something, before or
after it was published.
"""

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate                                          # schema + validation

SCRAPED_ID_BASE = 100_000


def load_jsonl(path):
    """Records from a .jsonl, ignoring blanks and // comments."""
    if not path.exists():
        return []
    out = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError as e:
            print("WARN  " + path.name + " line " + str(n) + ": bad JSON - " +
                  str(e), file=sys.stderr)
    return out


def main():
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manual", type=Path, default=root / "data" / "manual.json",
                    help="workbook export (default: data/manual.json)")
    ap.add_argument("--registry", type=Path,
                    default=root / "data" / "scraped.jsonl",
                    help="approved scraped listings and their ids")
    ap.add_argument("--candidates", type=Path, default=root / "candidates",
                    help="directory of candidate .jsonl batches")
    ap.add_argument("--out", type=Path, default=root / "data.json",
                    help="published file (default: data.json)")
    ap.add_argument("--keep-expired", action="store_true",
                    help="include listings whose dates have all passed")
    ap.add_argument("--dry-run", action="store_true",
                    help="report only, write nothing")
    args = ap.parse_args()

    problems = []

    # ---- 1. the registry: link -> already-approved record, with a fixed id ----
    registry = {}
    for rec in load_jsonl(args.registry):
        link = rec.get("link") or rec.get("official_link", "")
        if link:
            registry[link] = rec
    next_id = max([r.get("id", 0) for r in registry.values()]
                  or [SCRAPED_ID_BASE - 1]) + 1
    next_id = max(next_id, SCRAPED_ID_BASE)

    # ---- 2. fold in the candidate batches ----
    approved, withdrawn, rejected = 0, 0, 0
    for batch in sorted(args.candidates.glob("*.jsonl")):
        for raw in load_jsonl(batch):
            link = raw.get("official_link") or raw.get("link", "")
            if not link:
                continue
            if raw.get("skip") or raw.get("approved") is False:
                if registry.pop(link, None) is not None:
                    withdrawn += 1
                continue
            if link in registry:
                continue                                  # already approved
            cat = generate.as_text(raw.get("category") or raw.get("cat"))
            if cat not in generate.CATEGORIES:
                problems.append(("error", batch.name,
                                 "category " + repr(cat) + " is unknown"))
                rejected += 1
                continue
            row = {k: v for k, v in raw.items()
                   if k not in ("skip", "approved", "source", "notes")}
            row.setdefault("author", "Automation")
            row.setdefault("posted_date", date.today().isoformat())
            row["verified"] = "no"
            row["verified_date"] = ""
            row["id"] = next_id

            before = len(problems)
            post = generate.build_post(row, cat, batch.name, None, problems,
                                       text_dates_ok=True)
            if any(p[0] == "error" for p in problems[before:]):
                rejected += 1
                continue
            registry[link] = post
            next_id += 1
            approved += 1

    # ---- 3. merge with the workbook export ----
    manual = []
    if args.manual.exists():
        manual = json.loads(args.manual.read_text(encoding="utf-8")).get("posts", [])
    else:
        problems.append(("warn", str(args.manual),
                         "not found - publishing scraped listings only"))

    manual_ids = {p.get("id") for p in manual}
    clashes = manual_ids & {r.get("id") for r in registry.values()}
    for i in sorted(x for x in clashes if x is not None):
        problems.append(("error", "data.json", "id " + str(i) +
                         " is used by both the workbook and a scraped listing"))

    posts = manual + list(registry.values())
    today = date.today().isoformat()
    live, expired = [], []
    for p in posts:
        exp = generate.expiry_of(p)
        (expired if (exp and exp < today and not args.keep_expired)
         else live).append(p)
    live.sort(key=lambda p: (p["subDeadline"] == "", p["subDeadline"], p["title"]))

    # ---- report ----
    errors = [p for p in problems if p[0] == "error"]
    for kind, where, msg in problems:
        print(kind.upper().ljust(5) + " " + where + ": " + msg, file=sys.stderr)
    print("\nmanual (workbook):   " + str(len(manual)))
    print("scraped (approved):  " + str(len(registry)) +
          "   (+" + str(approved) + " new, -" + str(withdrawn) + " withdrawn"
          + (", " + str(rejected) + " invalid" if rejected else "") + ")")
    print("published:           " + str(len(live)) +
          ("   (" + str(len(expired)) + " expired, dropped)" if expired else ""))
    print("errors:              " + str(len(errors)))

    if errors:
        print("\nNothing written - fix the errors above.", file=sys.stderr)
        return 1
    if args.dry_run:
        print("\nDry run - nothing written.")
        return 0

    # registry, ordered by id so the diff is readable
    args.registry.parent.mkdir(parents=True, exist_ok=True)
    with args.registry.open("w", encoding="utf-8") as fh:
        fh.write("// Approved scraped listings. Ids are permanent - visitors' "
                 "saved items are keyed by them. Rebuilt by scripts/publish.py.\n")
        for rec in sorted(registry.values(), key=lambda r: r.get("id", 0)):
            fh.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")

    args.out.write_text(json.dumps(
        {"generatedAt": datetime.now().replace(microsecond=0).isoformat(),
         "posts": live}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\nWrote " + str(args.out) + " and " + str(args.registry))
    return 0


if __name__ == "__main__":
    sys.exit(main())
