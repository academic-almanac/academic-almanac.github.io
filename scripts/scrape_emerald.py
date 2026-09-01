#!/usr/bin/env python3
"""
Scrape Emerald Publishing's calls for papers into candidate records.

    python scripts/scrape_emerald.py                      # 5 pages -> candidates/
    python scripts/scrape_emerald.py --max-pages 78       # everything
    python scripts/scrape_emerald.py --limit 20 --out c.jsonl

Emerald lists journal special issues at /publish-with-us/calls-for-papers, six
per page, server-rendered, with the closing date, journal, title and summary all
present on the listing itself - so no detail-page fetch is needed.

Output is the candidate format ingest.py reads:

    python scripts/scrape_emerald.py
    python scripts/ingest.py candidates/emerald-YYYY-MM-DD.jsonl        # review
    python scripts/ingest.py candidates/emerald-YYYY-MM-DD.jsonl --write

Politeness, which is not optional:
  * robots.txt is fetched and obeyed; the script refuses to run if the listing
    path is disallowed.
  * Emerald publishes Crawl-delay: 15, and that is honoured between every
    request. Five pages therefore take about a minute, mostly waiting.
  * The User-Agent identifies the bot and links back to the site.

Records are marked verified = no. Nothing reaches the workbook without a human
running ingest.py, and the description is Emerald's own summary text - keep the
official_link so every listing credits and points back to the source.
"""

import argparse
import json
import re
import sys
import time
import urllib.robotparser
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode, urljoin

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("requests and beautifulsoup4 are required:  "
             "pip install requests beautifulsoup4 lxml")


SITE = "https://www.emeraldgrouppublishing.com"
LISTING = SITE + "/publish-with-us/calls-for-papers"
ROBOTS = SITE + "/robots.txt"
UA = ("AcademicAlmanacBot/0.1 "
      "(+https://academic-almanac.github.io/; academic deadline aggregator)")

JOURNAL_TYPE = "43877"          # the "Journal" facet: excludes books and case studies
SORTS = {
    # Newest first is what a weekly scrape wants: new calls appear on page 1.
    "newest": "created_DESC",
    # Soonest deadline first sorts closed calls to the front, so it burns pages
    # on listings we drop. Useful for a one-off sweep, not for the weekly run.
    "deadline": "field_deadline_value_ASC",
}

DEFAULT_DELAY = 15.0            # fallback if robots.txt states no Crawl-delay
MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


def clean(s):
    """Text of a tag (or a string), whitespace collapsed.

    Takes a tag or None so callers can pass select_one() straight in. Emerald's
    CMS sprinkles zero-width spaces through titles, so strip those too.
    """
    if s is None:
        return ""
    if hasattr(s, "get_text"):
        s = s.get_text(" ", strip=True)
    return re.sub(r"\s+", " ",
                  str(s).replace("​", "").replace("\xa0", " ")).strip()


def parse_deadline(node):
    """Prefer <time datetime=...>; fall back to '15 Jun 2027' text."""
    t = node.find("time")
    if t and t.get("datetime"):
        raw = t["datetime"][:10]
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError:
            pass
    text = clean(node.select_one(".cfp-card__active-dates-item")
                 or t or node).lower()
    m = re.search(r"(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{4})", text)
    if m and m.group(2) in MONTHS:
        try:
            return date(int(m.group(3)), MONTHS[m.group(2)],
                        int(m.group(1))).isoformat()
        except ValueError:
            return ""
    return ""


def fetch(session, url, params=None):
    r = session.get(url, params=params, timeout=45)
    r.raise_for_status()
    return r.text


def parse_page(html):
    """Yield one record per call-for-papers card on a listing page."""
    soup = BeautifulSoup(html, "lxml")
    for card in soup.select("a.node--type-call-for-papers"):
        href = card.get("href") or ""
        title = clean(card.select_one(".cfp-card__content-title"))
        journal = clean(card.select_one(".cfp-card__content-journal"))
        body = clean(card.select_one(".cfp-card__content-body"))
        editors = clean(card.select_one(".cfp-card__editors"))
        editors = re.sub(r"^Guest editor\(s\)\s*", "", editors).strip(" ,")
        yield {
            "title": title,
            "organiser": journal,
            "submission_deadline": parse_deadline(card),
            "official_link": urljoin(SITE, href),
            "description": body,
            "editors": editors,
        }


def to_candidate(rec):
    """Map a scraped record onto the workbook's Calls for Special Issues shape."""
    out = {
        "category": "Calls for Special Issues",
        "title": rec["title"],
        "organiser": rec["organiser"],
        "mode": "Online",
        "submission_deadline": rec["submission_deadline"],
        "official_link": rec["official_link"],
        "description": rec["description"],
        "source": "emerald",
    }
    if rec["editors"]:
        out["notes"] = "Guest editors: " + rec["editors"]
    return out


def main():
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-pages", type=int, default=5,
                    help="listing pages to read, 6 calls each (default 5)")
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after this many records (0 = no limit)")
    ap.add_argument("--out", type=Path, default=None,
                    help="output .jsonl (default: candidates/emerald-<today>.jsonl)")
    ap.add_argument("--delay", type=float, default=None,
                    help="seconds between requests (default: robots.txt Crawl-delay)")
    ap.add_argument("--min-days", type=int, default=7,
                    help="skip calls closing sooner than this many days (default 7)")
    ap.add_argument("--all-types", action="store_true",
                    help="include books and case studies, not just journals")
    ap.add_argument("--sort", choices=sorted(SORTS), default="newest",
                    help="listing order (default: newest, i.e. recently added)")
    ap.add_argument("--known", type=Path, action="append", default=[],
                    help="data.json or a .jsonl of candidates whose links are "
                         "already handled; repeatable. Matching calls are dropped "
                         "so a weekly run only reports what is new.")
    ap.add_argument("--allow-empty", action="store_true",
                    help="exit 0 when nothing new is found (for scheduled runs)")
    ap.add_argument("--seen", type=Path, default=None,
                    help="running log of every link ever emitted, read and "
                         "appended (default: candidates/seen.txt). This is what "
                         "stops a rejected call reappearing next week.")
    ap.add_argument("--no-seen", action="store_true",
                    help="do not read or update the seen log")
    args = ap.parse_args()

    out = args.out or (root / "candidates" /
                       ("emerald-" + date.today().isoformat() + ".jsonl"))
    out.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite an earlier batch: two runs on one day would otherwise
    # clobber the first file, losing any "skip": true a reviewer had added.
    if out.exists():
        stem, n = out, 2
        while out.exists():
            out = stem.with_name(stem.stem + "-" + str(n) + stem.suffix)
            n += 1
        print("note: " + stem.name + " exists; writing " + out.name + " instead.")

    seen_path = None if args.no_seen else (
        args.seen or (root / "candidates" / "seen.txt"))

    session = requests.Session()
    session.headers.update({"User-Agent": UA,
                            "Accept": "text/html,application/xhtml+xml"})

    # ---- robots.txt: obey it, and take its crawl delay ----
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(ROBOTS)
    try:
        rp.parse(session.get(ROBOTS, timeout=30).text.splitlines())
    except Exception as e:
        sys.exit("Could not read robots.txt (" + str(e) + ") - refusing to crawl.")
    if not rp.can_fetch(UA, LISTING):
        sys.exit("robots.txt disallows " + LISTING + " - refusing to crawl.")
    delay = args.delay if args.delay is not None else (
        rp.crawl_delay(UA) or rp.crawl_delay("*") or DEFAULT_DELAY)
    delay = float(delay)
    print("robots.txt allows the listing; using a " + format(delay, "g") +
          "s delay between requests.")

    # ---- links we already know about, so a weekly run reports only new calls ----
    def links_in(path):
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".json":
            for post in json.loads(text).get("posts", []):
                for key in ("link", "subLink", "official_link"):
                    if post.get(key):
                        yield post[key]
            return
        for line in text.splitlines():
            line = line.strip()
            if line and not line.startswith("//"):
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for key in ("official_link", "link"):
                    if rec.get(key):
                        yield rec[key]

    known = set()
    if seen_path and seen_path.exists():
        for line in seen_path.read_text(encoding="utf-8").splitlines():
            line = line.split("#")[0].strip()
            if line:
                known.add(line)
        print("known: " + str(len(known)) + " link(s) from " + seen_path.name)
    for path in args.known:
        if path.exists():
            found = set(links_in(path))
            known |= found
            print("known: " + str(len(found)) + " link(s) from " + path.name)
        else:
            print("known: " + str(path) + " not found - ignoring")

    today = date.today()
    records, seen_links, skipped = [], set(), {"no date": 0, "closing soon": 0,
                                               "past": 0, "duplicate": 0,
                                               "incomplete": 0,
                                               "already known": 0}

    for page in range(args.max_pages):
        params = {"page": page, "sort_bef_combine": SORTS[args.sort]}
        if not args.all_types:
            params["field_journal_type_target_id"] = JOURNAL_TYPE
        if page:
            time.sleep(delay)
        print("  page " + str(page + 1) + "/" + str(args.max_pages) + " ... ",
              end="", flush=True)
        try:
            html = fetch(session, LISTING, params)
        except Exception as e:
            print("failed: " + str(e))
            break

        found = 0
        for rec in parse_page(html):
            found += 1
            if not (rec["title"] and rec["organiser"] and rec["description"]
                    and rec["official_link"]):
                skipped["incomplete"] += 1
                continue
            if rec["official_link"] in seen_links:
                skipped["duplicate"] += 1
                continue
            if rec["official_link"] in known:
                skipped["already known"] += 1
                continue
            if not rec["submission_deadline"]:
                skipped["no date"] += 1
                continue
            days = (date.fromisoformat(rec["submission_deadline"]) - today).days
            if days < 0:
                skipped["past"] += 1
                continue
            if days < args.min_days:
                skipped["closing soon"] += 1
                continue
            seen_links.add(rec["official_link"])
            records.append(to_candidate(rec))
            if args.limit and len(records) >= args.limit:
                break
        print(str(found) + " card(s), " + str(len(records)) + " kept so far")
        if found == 0:
            print("  no cards on this page - stopping.")
            break
        if args.limit and len(records) >= args.limit:
            break

    dropped = ", ".join(k + ": " + str(v) for k, v in skipped.items() if v)
    if not records:
        print("\nNothing new." + ("  Dropped - " + dropped if dropped else ""))
        if sum(skipped.values()) == 0:
            print("No cards matched the selectors - the page layout probably "
                  "changed; parse_page() is what needs updating.")
        elif skipped["already known"]:
            print("Every call on these pages is already known, which is the "
                  "normal result for a weekly run.")
        else:
            print("Cards were found and parsed, so the filters rejected them "
                  "all. Try --sort newest, or a smaller --min-days.")
        return 0 if args.allow_empty else 1

    with out.open("w", encoding="utf-8") as fh:
        fh.write("// Scraped from " + LISTING + " on " +
                 datetime.now().replace(microsecond=0).isoformat() + "\n")
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    if seen_path:
        stamp = date.today().isoformat()
        fresh = not seen_path.exists() or seen_path.stat().st_size == 0
        with seen_path.open("a", encoding="utf-8") as fh:
            if fresh:
                fh.write("# Every link this scraper has emitted. Read on every "
                         "run so nothing is offered twice - including calls a "
                         "reviewer rejected.\n")
            for rec in records:
                fh.write(rec["official_link"] + "  # " + stamp + "\n")
        print("seen log: " + str(len(records)) + " link(s) added to " +
              seen_path.name)

    print("\n" + str(len(records)) + " call(s) written to " + str(out))
    if dropped:
        print("Dropped - " + dropped)
    print("\nEarliest deadlines:")
    for rec in sorted(records, key=lambda r: r["submission_deadline"])[:8]:
        print("  " + rec["submission_deadline"] + "  " + rec["title"][:58])
        print("              " + rec["organiser"][:64])
    print("\nNext: python scripts/ingest.py " + str(out) + "   (review, then --write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
