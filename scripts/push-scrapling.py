#!/usr/bin/env python3
"""市况台浏览器采集推送器：抓框架直采过不去的信源，把标题+链接+时间(+摘要)推进 external 信源。

三种模式：
  feed  —— RSS 被指纹墙挡住（SCMP、巴伦）：用隐身浏览器打开 feed 地址，仍按 RSS 解析。
  page  —— 没有可用 RSS 的财经站点（第一财经、财新、每经、证券时报、FT中文网、21世纪、经济观察报）：
           打开列表页/首页，按各站文章链接规律抽标题与链接。只搬标题与链接，与 RSS 订阅等价，不抓正文。
  api   —— 站点公开接口（华尔街见闻快讯 lives API）：直接读 JSON。

抓取优先 Scrapling StealthyFetcher（真实浏览器指纹），失败回退 DynamicFetcher，再回退普通请求。
服务端按 url 去重，可重复运行；建议每 30 分钟跑一次（见 docs/SCRAPLING.md）。

用法（在市况台仓库根目录）：
    python3 -m venv .venv-scrapling && .venv-scrapling/bin/pip install "scrapling[fetchers]"
    .venv-scrapling/bin/scrapling install          # 首次下载隐身浏览器（Camoufox）
    .venv-scrapling/bin/python scripts/push-scrapling.py [--api http://127.0.0.1:3001] [--dry-run]

依赖 .env 里的 INGEST_TOKEN（--dry-run 只抓不推，不需要 token）。
"""
import html as html_lib
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
CST = timezone(timedelta(hours=8))

# ---------- feed 模式：被墙的 RSS ----------
FEEDS = [
    ("push-scmp-business", "南华早报 SCMP 商业", "https://www.scmp.com/rss/91/feed"),
    ("push-scmp-hk", "南华早报 SCMP 香港", "https://www.scmp.com/rss/5/feed"),
    ("push-barrons", "巴伦周刊 Barron's", "https://feeds.a.dj.com/rss/BarronBusiness.xml"),
]

# ---------- page 模式：列表页抽链接 ----------
# link_re 命中的 href 才算文章；date_from_url 表示链接里带日期（更准的发布时间）；
# fresh_days 只收最近 N 天的链接（防首页常驻的旧精选混入），仅对带日期链接生效。
PAGES = [
    {
        "id": "push-yicai", "name": "第一财经", "url": "https://www.yicai.com/news/",
        "link_re": r"/news/\d{9,}\.html", "limit": 20, "glue_split": True,
    },
    {
        "id": "push-caixin", "name": "财新网", "url": "https://www.caixin.com/",
        "link_re": r"caixin\.com/\d{4}-\d{2}-\d{2}/\d+\.html", "limit": 25,
        "date_from_url": True, "fresh_days": 2,
    },
    {
        "id": "push-nbd", "name": "每日经济新闻", "url": "https://www.nbd.com.cn/",
        "link_re": r"/articles/\d{4}-\d{2}-\d{2}/\d+\.html", "limit": 25,
        "date_from_url": True, "fresh_days": 2, "strip_column_prefix": True,
    },
    {
        "id": "push-stcn", "name": "证券时报", "url": "https://www.stcn.com/",
        "link_re": r"/article/detail/\d+\.html", "limit": 25,
    },
    {
        "id": "push-ftchinese", "name": "FT中文网", "url": "https://www.ftchinese.com/",
        "link_re": r"/story/\d{9,}", "limit": 20,
    },
    {
        "id": "push-21jingji", "name": "21世纪经济报道", "url": "https://www.21jingji.com/",
        "link_re": r"21jingji\.com/article/\d{8}/[0-9a-f]+\.html", "limit": 20,
        "date_from_url": True, "fresh_days": 2, "strip_noise": True,
    },
    {
        "id": "push-eeo", "name": "经济观察报", "url": "https://www.eeo.com.cn/",
        "link_re": r"eeo\.com\.cn/\d{4}/\d{4}/\d+\.shtml", "limit": 20,
        "date_from_url": True, "fresh_days": 3,
    },
]

# ---------- api 模式：公开 JSON 接口 ----------
APIS = [
    ("push-wallstreetcn", "华尔街见闻快讯",
     "https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&client=pc&limit=30"),
]


def read_token() -> str:
    env = ROOT / ".env"
    if env.exists():
        m = re.search(r"^INGEST_TOKEN=(.+)$", env.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1).strip()
    print("INGEST_TOKEN missing in .env", file=sys.stderr)
    sys.exit(1)


def fetch_text(url: str) -> str:
    """StealthyFetcher first (Camoufox, real fingerprint), then DynamicFetcher, then plain HTTP."""
    try:
        from scrapling.fetchers import StealthyFetcher

        page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=60000)
        if page.status == 200 and page.html_content:
            return page.html_content
        print(f"stealth {url} -> {page.status}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"stealth unavailable/failed: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
    try:
        from scrapling.fetchers import DynamicFetcher

        page = DynamicFetcher.fetch(url, headless=True, network_idle=True, timeout=60000)
        if page.status == 200 and page.html_content:
            return page.html_content
        print(f"dynamic {url} -> {page.status}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"dynamic failed: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


# ---------- feed 解析（与旧版一致） ----------
def parse_feed(xml_text: str) -> list[dict]:
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


# ---------- page 解析 ----------
def clean_title(text: str, cfg: dict) -> tuple[str, str]:
    """返回 (title, summary)。summary 只在标题粘连了摘要时才拆出来。"""
    t = html_lib.unescape(re.sub(r"<[^>]+>", "", text))
    t = re.sub(r"\s+", " ", t).strip(" 　·|")
    summary = ""
    if cfg.get("strip_column_prefix") and " | " in t:
        head, rest = t.split(" | ", 1)
        if len(head) <= 6:
            t = rest.strip()
    if cfg.get("strip_noise"):
        t = re.sub(r"^(视频|焦点|独家|重磅|快讯)\s*", "", t)
        t = re.sub(r"\s*\S{0,6}\s*\d+\s*(分钟前|小时前).*$", "", t).strip()
        t = re.sub(r"\s+(投资|产经|公司|市场)$", "", t).strip()
    if cfg.get("glue_split") and len(t) > 50:
        # 第一财经等站点的锚文本把标题和摘要粘在一起：在第一个句末标点处拆开。
        m = re.search(r"^(.{12,}?[。！？])\s*(.+)$", t)
        if m:
            summary = m.group(2).strip()
            t = m.group(1).strip()
    return t, summary


def url_date(url: str) -> datetime | None:
    m = re.search(r"/(20\d{2})-(\d{2})-(\d{2})/", url) or re.search(r"/(20\d{2})(\d{2})(\d{2})/", url) \
        or re.search(r"/(20\d{2})/(\d{2})(\d{2})/", url)
    if not m:
        return None
    try:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, 0, tzinfo=CST)
    except ValueError:
        return None


def parse_page(page_html: str, cfg: dict) -> list[dict]:
    now = datetime.now(timezone.utc)
    link_re = re.compile(cfg["link_re"])
    items, seen = [], set()
    for href, inner in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', page_html, re.S):
        full = urljoin(cfg["url"], html_lib.unescape(href))
        if not link_re.search(full) or full in seen:
            continue
        title, summary = clean_title(inner, cfg)
        if len(title) < 8 or len(title) > 120:
            continue
        when = url_date(full) if cfg.get("date_from_url") else None
        if when is not None and cfg.get("fresh_days"):
            if (datetime.now(CST).date() - when.date()).days > cfg["fresh_days"]:
                continue
        seen.add(full)
        item = {"title": title[:200], "url": full,
                "publishedAt": (when.astimezone(timezone.utc).isoformat() if when else now.isoformat())}
        if summary:
            item["summary"] = summary[:300]
        items.append(item)
        if len(items) >= cfg["limit"]:
            break
    return items


# ---------- api 解析 ----------
def parse_wallstreetcn(raw: str) -> list[dict]:
    data = json.loads(raw)
    items = []
    for it in (data.get("data") or {}).get("items") or []:
        text = re.sub(r"<[^>]+>", "", it.get("content") or "").strip()
        text = html_lib.unescape(re.sub(r"\s+", " ", text))
        title = (it.get("title") or "").strip()
        if not title:
            title = re.split(r"[。！？\n]", text, maxsplit=1)[0][:80]
        url = it.get("uri") or ""
        ts = it.get("display_time")
        if not title or not url or not ts:
            continue
        published = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
        item = {"title": title[:200], "url": url, "publishedAt": published}
        if text and text[: len(title)] != title:
            item["summary"] = text[:300]
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
    dry = "--dry-run" in sys.argv
    token = "" if dry else read_token()

    jobs = []
    for sid, name, url in FEEDS:
        jobs.append((sid, name, lambda u=url: parse_feed(fetch_text(u))))
    for cfg in PAGES:
        jobs.append((cfg["id"], cfg["name"], lambda c=cfg: parse_page(fetch_text(c["url"]), c)))
    for sid, name, url in APIS:
        jobs.append((sid, name, lambda u=url: parse_wallstreetcn(fetch_text(u))))

    for sid, name, run in jobs:
        try:
            items = run()
            print(sid, "fetched", len(items), "items")
            for it in items[:2]:
                print("   -", it["title"][:70], "|", it["url"][:80])
            if dry:
                continue
            push(api, token, sid, name, items)
        except Exception as e:  # noqa: BLE001
            print(sid, "failed:", type(e).__name__, str(e)[:160], file=sys.stderr)


if __name__ == "__main__":
    main()
