#!/usr/bin/env python3
"""
Academic Almanac - append reviewed candidate listings to content.xlsx.

    python scripts/ingest.py candidates.jsonl              # review (writes nothing)
    python scripts/ingest.py candidates.jsonl --write      # actually append
    python scripts/ingest.py a.jsonl b.csv --author "Dejan Z."

This is the "integrate" step: scrapers and the email pipeline produce candidate
records, a human reads the review output, and only then does --write touch the
workbook. Nothing is ever written without --write, and --write always takes a
timestamped backup first.

Candidate records may use the Excel header names (title, organiser,
submission_deadline, ...) or the data.json names (title, org, subDeadline, ...).
Accepted files: .jsonl (one object per line), .json (array of objects), .csv.

Every candidate is validated with exactly the rules generate.py enforces, so a
row that ingests here will not break the build later. Rows with errors are
skipped; rows that look like something already in the workbook are skipped as
duplicates. Both are reported.

Defaults applied to every candidate:
    id            next unused id across the whole workbook
    posted_date   today
    verified      no          (scraped data is unverified until a human checks it)
    author        --author, default "Automation"

Set "skip": true (or "approved": false) on a record to exclude it without
deleting the line.
"""

import argparse
import csv
import json
import re
import shutil
import sys
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import generate
except ImportError:
    sys.exit("generate.py must sit next to ingest.py - it holds the schema.")

try:
    import openpyxl
    from copy import copy as _copy
except ImportError:
    sys.exit("openpyxl is required:  pip install openpyxl")


TITLE_MATCH = 0.90          # SequenceMatcher ratio above which titles count as the same

# data.json key -> Excel header, so candidates may speak either dialect.
ALIASES = {v: k for k, v in generate.FIELDS.items()}
ALIASES.update({"ratings": "ratings", "skip": "skip", "approved": "approved",
                "source": "source", "notes": "notes"})
META_KEYS = {"skip", "approved", "source", "notes", "ratings"}


# --------------------------------------------------------------------------
# Reading candidates
# --------------------------------------------------------------------------
def read_candidates(path):
    """Yield (record, human-readable origin) pairs."""
    suffix = path.suffix.lower()
    if suffix == ".jsonl":
        with path.open(encoding="utf-8") as fh:
            for n, line in enumerate(fh, start=1):
                line = line.strip()
                if not line or line.startswith("//"):
                    continue
                try:
                    yield json.loads(line), path.name + " line " + str(n)
                except json.JSONDecodeError as e:
                    yield None, path.name + " line " + str(n) + ": bad JSON - " + str(e)
    elif suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("candidates") or data.get("posts") or [data]
        for n, rec in enumerate(data, start=1):
            yield rec, path.name + " item " + str(n)
    elif suffix == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as fh:
            for n, rec in enumerate(csv.DictReader(fh), start=2):
                yield rec, path.name + " row " + str(n)
    else:
        sys.exit("Unsupported file type: " + str(path) + " (use .jsonl, .json or .csv)")


def normalise_keys(rec, origin, problems):
    """Map whatever dialect the record uses onto Excel header names."""
    out = {}
    for k, v in rec.items():
        key = k.strip()
        if key in generate.FIELDS or key in generate.RATING_COLS:
            out[key] = v
        elif key in ALIASES:
            out[ALIASES[key]] = v
        elif key in META_KEYS:
            out[key] = v
        else:
            problems.append(("warn", origin, "unknown field " + repr(key) + " - ignored"))
    # ratings may arrive nested: {"ABS": "4", "ABDC": "A"}
    nested = out.pop("ratings", None)
    if isinstance(nested, dict):
        for system, grade in nested.items():
            col = "rating_" + str(system).upper().replace("RATING_", "")
            if col in generate.RATING_COLS:
                out.setdefault(col, grade)
            else:
                problems.append(("warn", origin,
                                 "unknown rating system " + repr(system) + " - ignored"))
    return out


# --------------------------------------------------------------------------
# Duplicate detection
# --------------------------------------------------------------------------
def norm_title(s):
    s = re.sub(r"\(.*?\)", " ", (s or "").lower())
    s = re.sub(r"\b(the|a|an|of|on|for|and|in|at|to)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def norm_link(s):
    s = (s or "").strip().lower()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = re.sub(r"[/?#].*$", "", s) if s.count("/") == 1 and s.endswith("/") else s
    return s.rstrip("/")


def duplicate_of(post, existing):
    """Return the existing post this duplicates, or None. Same category only."""
    for other in existing:
        if other["cat"] != post["cat"]:
            continue
        if post["link"] and norm_link(post["link"]) == norm_link(other["link"]):
            return other, "same official_link"
        if post["acronym"] and post["subDeadline"] \
                and post["acronym"].lower() == other["acronym"].lower() \
                and post["subDeadline"] == other["subDeadline"]:
            return other, "same acronym and submission_deadline"
        a, b = norm_title(post["title"]), norm_title(other["title"])
        if a and b:
            if a == b:
                return other, "same title"
            if SequenceMatcher(None, a, b).ratio() >= TITLE_MATCH:
                return other, "title looks the same"
    return None


# --------------------------------------------------------------------------
# Reading what is already in the workbook
# --------------------------------------------------------------------------
def load_existing(excel):
    """All rows currently in the workbook, as posts. Expired ones included."""
    wb = openpyxl.load_workbook(excel, data_only=True, read_only=True)
    posts, sink = [], []
    for sheet in wb.sheetnames:
        if sheet not in generate.CATEGORIES:
            continue
        rows = wb[sheet].iter_rows(values_only=True)
        try:
            header = [generate.as_text(h) for h in next(rows)]
        except StopIteration:
            continue
        for excel_row, row in enumerate(rows, start=2):
            if not any(generate.as_text(c) for c in row):
                continue
            post = generate.build_post(dict(zip(header, row)), sheet, sheet,
                                       excel_row, sink)
            post["_where"] = sheet + " row " + str(excel_row)
            posts.append(post)
    wb.close()
    return posts


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------
def append_rows(excel, additions, backup=True):
    """additions: list of (sheet, {header: value}). Returns the backup path."""
    backup_path = None
    if backup:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = excel.with_name(excel.stem + ".backup-" + stamp + excel.suffix)
        shutil.copy2(excel, backup_path)

    wb = openpyxl.load_workbook(excel)
    by_sheet = {}
    for sheet, values in additions:
        by_sheet.setdefault(sheet, []).append(values)

    for sheet, rows in by_sheet.items():
        ws = wb[sheet]
        header = [generate.as_text(c.value) for c in ws[1]]
        # last row that actually holds data (max_row can overcount blank rows)
        last = 1
        for r in range(ws.max_row, 1, -1):
            if any(generate.as_text(c.value) for c in ws[r]):
                last = r
                break
        template = last if last > 1 else None

        for values in rows:
            last += 1
            for col_idx, name in enumerate(header, start=1):
                if not name:
                    continue
                cell = ws.cell(row=last, column=col_idx)
                if template:                      # keep the sheet's own formatting
                    cell._style = _copy(ws.cell(row=template, column=col_idx)._style)
                v = values.get(name, "")
                if name in generate.DATE_COLS:
                    cell.value = datetime.strptime(v, "%Y-%m-%d") if v else None
                    if not cell.number_format or cell.number_format == "General":
                        cell.number_format = "yyyy\\-mm\\-dd"
                elif name in generate.NUM_COLS or name == "id":
                    cell.value = v if v != "" else None
                else:
                    cell.value = v if v != "" else None
    wb.save(excel)
    return backup_path


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path,
                    help="candidate files (.jsonl, .json, .csv)")
    ap.add_argument("--excel", type=Path,
                    default=root.parent / "Excel4GitHub" / "content.xlsx",
                    help="master workbook (default: ../Excel4GitHub/content.xlsx)")
    ap.add_argument("--write", action="store_true",
                    help="actually append to the workbook (default: review only)")
    ap.add_argument("--author", default="Automation",
                    help='value for the author column (default: "Automation")')
    ap.add_argument("--verified", action="store_true",
                    help="mark appended rows verified = yes (only if you checked them)")
    ap.add_argument("--allow-duplicates", action="store_true",
                    help="append rows that look like existing listings")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the timestamped backup (not recommended)")
    args = ap.parse_args()

    if not args.excel.exists():
        sys.exit("Workbook not found: " + str(args.excel))
    lock = args.excel.with_name("~$" + args.excel.name)
    if args.write and lock.exists():
        sys.exit("The workbook looks open in Excel (" + lock.name + " exists).\n"
                 "Close it first - Excel would block the save or overwrite the "
                 "appended rows.")

    problems = []
    existing = load_existing(args.excel)
    next_id = max([p["id"] for p in existing if isinstance(p["id"], int)] or [0]) + 1
    today = date.today().isoformat()

    accepted = []        # (sheet, {header: value}, post)
    skipped, dupes, failed = [], [], []

    for path in args.files:
        if not path.exists():
            problems.append(("error", str(path), "file not found"))
            continue
        for rec, origin in read_candidates(path):
            if rec is None:
                problems.append(("error", origin, "could not be read"))
                failed.append(origin)
                continue
            if not isinstance(rec, dict):
                problems.append(("error", origin, "expected an object, found " +
                                 type(rec).__name__))
                failed.append(origin)
                continue

            raw = normalise_keys(rec, origin, problems)
            if raw.pop("skip", False) or raw.pop("approved", True) is False:
                skipped.append((origin, generate.as_text(raw.get("title"))))
                continue
            source = raw.pop("source", "")
            raw.pop("notes", None)

            cat = generate.as_text(raw.get("category"))
            if cat not in generate.CATEGORIES:
                problems.append(("error", origin, "category " + repr(cat) +
                                 " is not one of the workbook's sheets"))
                failed.append(origin)
                continue

            # defaults
            raw.setdefault("author", args.author)
            raw.setdefault("posted_date", today)
            raw["verified"] = "yes" if args.verified else "no"
            if not args.verified:
                raw["verified_date"] = ""
            elif not generate.as_text(raw.get("verified_date")):
                raw["verified_date"] = today
            raw["id"] = next_id

            before = len(problems)
            post = generate.build_post(raw, cat, origin, None, problems,
                                       text_dates_ok=True)
            row_errors = [p for p in problems[before:] if p[0] == "error"]
            if row_errors:
                failed.append(origin)
                continue

            dup = duplicate_of(post, existing)
            if dup and not args.allow_duplicates:
                other, why = dup
                dupes.append((origin, post["title"], other["_where"], why))
                continue

            # NUM_COLS holds Excel header names, so test col (fee_max) and not
            # the data.json key (feeMax) - otherwise numbers land as text.
            values = {col: post[key] if col in generate.NUM_COLS
                      else generate.as_text(post[key])
                      for col, key in generate.FIELDS.items()}
            values["id"] = post["id"]
            values["verified"] = "yes" if post["verified"] else "no"
            for col in generate.RATING_COLS:
                values[col] = post["ratings"].get(col.replace("rating_", ""), "")

            post["_where"] = origin + (" (" + source + ")" if source else "")
            accepted.append((cat, values, post))
            existing.append(post)          # so later candidates dedupe against it
            next_id += 1

    # ---- report ----
    for kind, where, msg in sorted(problems, key=lambda p: p[0] != "error"):
        print(kind.upper().ljust(5) + " " + where + ": " + msg, file=sys.stderr)

    if dupes:
        print("\nAlready in the workbook - skipped as duplicates:")
        for origin, title, where, why in dupes:
            print("  " + origin + ": " + title[:62])
            print("      matches " + where + " (" + why + ")")
    if skipped:
        print("\nMarked skip/not approved - left alone:")
        for origin, title in skipped:
            print("  " + origin + ": " + title[:62])
    if failed:
        print("\nSkipped because of the errors above: " + str(len(failed)) + " record(s)")

    if accepted:
        print("\nWould append " + str(len(accepted)) + " listing(s):"
              if not args.write else "\nAppending " + str(len(accepted)) + " listing(s):")
        for cat, values, post in accepted:
            print("  id " + str(values["id"]).rjust(4) + "  " + cat)
            print("        " + post["title"][:70])
            print("        deadline " + (post["subDeadline"] or "-") +
                  "   " + post["_where"])
    else:
        print("\nNothing to append.")

    print("\n" + str(len(accepted)) + " to append, " + str(len(dupes)) +
          " duplicate(s), " + str(len(skipped)) + " skipped, " +
          str(len(failed)) + " rejected")

    if not accepted:
        return 1 if failed or any(p[0] == "error" for p in problems) else 0
    if not args.write:
        print("\nReview only - nothing written. Re-run with --write to append.")
        return 0

    backup = append_rows(args.excel, [(c, v) for c, v, _ in accepted],
                         backup=not args.no_backup)
    print("\nAppended to " + str(args.excel))
    if backup:
        print("Backup: " + backup.name)
    print("Next: python scripts/generate.py   then commit and push data.json.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
