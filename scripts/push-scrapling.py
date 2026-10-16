#!/usr/bin/env python3
"""市况台 Scrapling 推送器：抓被机器人墙挡住的信源（南华早报 SCMP），把标题+链接+摘要推进 external 信源。

为什么需要它：SCMP 的 RSS 对普通请求返回 403（Cloudflare 指纹墙），框架自带的 RSS 采集器过不去。
Scrapling 的 StealthyFetcher 用真实浏览器指纹（Camoufox）打开页面，能像真人浏览器一样拿到 feed。
只搬运标题、链接、时间和摘要（与 RSS 订阅等价），不抓正文。

用法（在市况台仓库根目录）：
    python3 -m venv .venv-scrapling && .venv-scrapling/bin/pip install "scrapling[fetchers]"
    .venv-scrapling/bin/scrapling install          # 首次下载隐身浏览器（Camoufox）
    .venv-scrapling/bin/python scripts/push-scrapling.py [--api http://127.0.0.1:3001]

依赖 .env 里的 INGEST_TOKEN。服务端按 url 去重，可重复运行；建议每 30 分钟跑一次（cron/launchd）。
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FEEDS = [
    ("push-scmp-business", "南华早报 SCMP 商业", "https://www.scmp.com/rss/91/feed"),
    ("push-scmp-hk", "南华早报 SCMP 香港", "https://www.scmp.com/rss/5/feed"),
]


def read_token() -> str:
    env = ROOT / ".env"
    if env.exists():
        m = re.search(r"^INGEST_TOKEN=(.+)$", env.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1).strip()
    print("INGEST_TOKEN missing in .env", file=sys.stderr)
    sys.exit(1)


def fetch_xml(url: str) -> str:
    """StealthyFetcher first (Camoufox, real fingerprint), DynamicFetcher as fallback."""
    try:
        from scrapling.fetchers import StealthyFetcher

        page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=60000)
        if page.status == 200 and page.html_content:
            return page.html_content
        print(f"stealth {url} -> {page.status}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"stealth failed: {type(e).__name__}: {str(e)[:120]}", file=sys.stderr)
    from scrapling.fetchers import DynamicFetcher

    page = DynamicFetcher.fetch(url, headless=True, network_idle=True, timeout=60000)
    if page.status != 200:
        raise RuntimeError(f"dynamic fetch {url} -> {page.status}")
    return page.html_content or ""


def parse_feed(xml_text: str) -> list[dict]:
    # A browser returns the feed inside an HTML shell or as raw XML; locate the RSS root either way.
    start = xml_text.find("<rss")
    if start < 0:
        start = xml_text.find("<feed")
    if start >= 0:
        xml_text = xml_text[start:]
    root = ET.fromstring(xml_text)
    items = []
    for node in root.iter("item"):
        title = (node.findtext("title") or "").strip()
        link = (node.findtext("link") or "").strip()
        if not title or not link:
            continue
        pub = node.findtext("pubDate")
        try:
            published = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat() if pub else datetime.now(timezone.utc).isoformat()
        except Exception:  # noqa: BLE001
            published = datetime.now(timezone.utc).isoformat()
        desc = re.sub(r"<[^>]+>", "", node.findtext("description") or "").strip()
        item = {"title": title[:200], "url": link, "publishedAt": published}
        if desc:
            item["summary"] = desc[:300]
        items.append(item)
    return items


def push(api: str, token: str, source_id: str, source_name: str, items: list[dict]) -> None:
    if not items:
        print(source_id, "no items")
        return
    for i in range(0, len(items), 50):
        batch = items[i : i + 50]
        req = urllib.request.Request(
            f"{api}/api/ingest/items",
            data=json.dumps({"sourceId": source_id, "sourceName": source_name, "items": batch}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(source_id, resp.status, resp.read().decode()[:120])


def main() -> None:
    api = "http://127.0.0.1:3001"
    if "--api" in sys.argv:
        api = sys.argv[sys.argv.index("--api") + 1]
    token = read_token()
    for source_id, source_name, url in FEEDS:
        try:
            items = parse_feed(fetch_xml(url))
            print(source_id, "fetched", len(items), "items")
            push(api, token, source_id, source_name, items)
        except Exception as e:  # noqa: BLE001
            print(source_id, "failed:", type(e).__name__, str(e)[:160], file=sys.stderr)


if __name__ == "__main__":
    main()
