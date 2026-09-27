#!/usr/bin/env python3
"""Refresh a public AI-tag-only feed; never guess tags or publish private data.

Adapted from the original filter_nate.py. Uses only public publisher metadata,
keeps the last validated AI entries when they fall out of the publisher's RSS,
and writes atomically only after every current entry was checked.
"""
from __future__ import annotations
import argparse
import json
import time
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

ORIGIN = "https://www.natesilver.net"
UA = "LongForm/1.0 (+https://reader.antonioskilton.com)"
MAX_BYTES = 2_000_000


def canonical_post_url(value: str) -> str | None:
    p = urlsplit(value)
    if p.scheme not in {"http", "https"} or p.username or p.password or (p.hostname or "").lower().removeprefix("www.") != "natesilver.net" or not p.path.startswith("/p/"):
        return None
    return urlunsplit(("https", "www.natesilver.net", p.path.rstrip("/"), "", ""))


def get(url: str) -> bytes:
    for attempt in range(2):
        try:
            with urlopen(Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml,application/json,text/xml"}), timeout=10) as response:
                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise RuntimeError("Publisher response exceeds safe size")
                return data
        except HTTPError as error:
            if attempt or error.code not in {429, 500, 502, 503, 504}:
                raise
            time.sleep(1)
    raise RuntimeError("Publisher request failed")


def ai_tagged(payload: object) -> bool:
    if not isinstance(payload, dict):
        raise ValueError("Post metadata is not an object")
    post = payload.get("post", payload)
    if not isinstance(post, dict) or not ({"postTags", "post_tags"} & post.keys()):
        raise ValueError("Publisher omitted tag metadata; refusing to guess")
    tags = post.get("postTags", post.get("post_tags"))
    if not isinstance(tags, list):
        raise ValueError("Publisher tag metadata is invalid")
    return any(isinstance(t, dict) and (str(t.get("slug", "")).lower() == "ai" or str(t.get("name", "")).lower() in {"ai", "ai+"}) for t in tags)


def clean_item(item: ET.Element, url: str) -> ET.Element:
    result = ET.Element("item")
    fields = {"title": item.findtext("title", "Untitled"), "link": url, "guid": url}
    for key in ("pubDate", "description", "author"):
        value = item.findtext(key)
        if value:
            fields[key] = value
    for key, value in fields.items():
        child = ET.SubElement(result, key)
        child.text = value
        if key == "guid":
            child.set("isPermaLink", "true")
    return result


def refresh(output: Path, previous: Path | None = None, fetch=get) -> dict:
    source = ET.fromstring(fetch(ORIGIN + "/feed"))
    entries = source.findall("./channel/item")
    if source.tag != "rss" or not entries:
        raise RuntimeError("Publisher did not return a non-empty RSS feed")
    if len(entries) > 100:
        raise RuntimeError("Publisher feed exceeds verification limit")
    saved: dict[str, ET.Element] = {}
    if previous and previous.exists():
        for item in ET.parse(previous).getroot().findall("./channel/item"):
            url = canonical_post_url(item.findtext("link", ""))
            if url:
                saved[url] = clean_item(item, url)
    checked = matched = 0
    for item in entries:
        url = canonical_post_url(item.findtext("link", ""))
        if not url:
            continue
        checked += 1
        payload = json.loads(fetch(ORIGIN + "/api/v1/posts/" + urlsplit(url).path.removeprefix("/p/")))
        if ai_tagged(payload):
            matched += 1
            saved[url] = clean_item(item, url)
        else:
            saved.pop(url, None)
    if not checked:
        raise RuntimeError("No publisher posts could be verified")
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    now = datetime.now(timezone.utc)
    for name, value in {"title": "Silver Bulletin — AI+", "link": ORIGIN + "/t/ai", "description": "Public posts explicitly tagged AI by Silver Bulletin.", "language": "en", "generator": "Long Form scoped feed", "lastBuildDate": format_datetime(now)}.items():
        ET.SubElement(channel, name).text = value
    # Dict order retains publisher order for current entries; dates remain original.
    from email.utils import parsedate_to_datetime
    def date_key(item):
        try:
            return parsedate_to_datetime(item.findtext("pubDate", "")).timestamp()
        except (TypeError, ValueError):
            return 0
    for item in sorted(saved.values(), key=date_key, reverse=True)[:50]:
        channel.append(item)
    ET.indent(rss, space="  ")
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(".tmp")
    temp.write_bytes(ET.tostring(rss, encoding="utf-8", xml_declaration=True) + b"\n")
    temp.replace(output)
    report = {"refreshed_at": now.isoformat(), "checked_posts": checked, "current_ai_posts": matched, "published_items": len(channel.findall("item")), "source": ORIGIN + "/t/ai"}
    output.with_name("nate-ai-status.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    print(json.dumps(refresh(args.output, args.previous), indent=2))
