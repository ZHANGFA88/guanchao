#!/usr/bin/env python3
"""观潮浏览器采集推送器：抓框架直采过不去的信源，把标题+链接+时间(+摘要)推进 external 信源。

四种模式：
  feed  —— RSS 被指纹墙挡住（SCMP、巴伦）：用隐身浏览器打开 feed 地址，仍按 RSS 解析。
  page  —— 没有可用 RSS 的财经站点（第一财经、财新、每经、证券时报、FT中文网、21世纪、经济观察报）：
           打开列表页/首页，按各站文章链接规律抽标题与链接。只搬标题与链接，与 RSS 订阅等价，不抓正文。
  api   —— 站点公开接口（华尔街见闻快讯 lives API）：直接读 JSON。
  signal —— 免费讨论源（东方财富股吧、雪球、Hacker News）：推给 hot_signal 信源，只给热点供讨论证据，
           永不单独成条（框架 group 逻辑写死），是 X 付费讨论层的免费替代。

抓取分工（2026-10-17 Mac 实证后定版）：
  feed / api / signal 接口 —— 普通请求优先拿原始字节（RSS XML / JSON 不能被浏览器包装成 HTML），
  失败或 403/429 时依次升级 curl_cffi（chrome 指纹伪装）→ StealthyFetcher → DynamicFetcher。
  page（列表页） —— 浏览器渲染优先（StealthyFetcher → DynamicFetcher → 普通请求），现行链不动。
服务端按 url 去重，可重复运行；建议每 30 分钟跑一次（见 docs/SCRAPLING.md）。

用法（在观潮仓库根目录）：
    python3 -m venv .venv-scrapling && .venv-scrapling/bin/pip install "scrapling[fetchers]"
    .venv-scrapling/bin/scrapling install          # 首次下载隐身浏览器（Camoufox）
    .venv-scrapling/bin/python scripts/push-scrapling.py [--api http://127.0.0.1:3001] [--dry-run]

依赖 .env 里的 INGEST_TOKEN（--dry-run 只抓不推，不需要 token）。
"""
import html as html_lib
import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlparse

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

# ---------- signal 模式：免费讨论源（hot_signal 信源） ----------
# 股吧盯盘名单：高关注度 A 股大票（讨论证据靠标题文本与报道归组，名单求精不求多）。
GUBA_BOARDS = [
    ("600519", "贵州茅台"), ("000858", "五粮液"), ("300750", "宁德时代"), ("002594", "比亚迪"),
    ("600036", "招商银行"), ("601318", "中国平安"), ("688981", "中芯国际"), ("603259", "药明康德"),
    ("601012", "隆基绿能"), ("002475", "立讯精密"), ("300059", "东方财富"), ("600276", "恒瑞医药"),
]
HN_MIN_SCORE = 120
XUEQIU_TIMELINE = "https://xueqiu.com/v4/statuses/public_timeline_by_category.json?since_id=-1&max_id=-1&count=30&category=-1"


def read_token() -> str:
    env = ROOT / ".env"
    if env.exists():
        m = re.search(r"^INGEST_TOKEN=(.+)$", env.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1).strip()
    print("INGEST_TOKEN missing in .env", file=sys.stderr)
    sys.exit(1)


def fetch_plain(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _plain_status(url: str) -> tuple[int | None, str]:
    """普通请求：返回 (status, text)。HTTPError 也带回状态码，供升级链决策。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001
        print(f"plain {url} failed: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
        return None, ""


def _impersonated(url: str) -> tuple[int | None, str]:
    """curl_cffi chrome 伪装：返回原始字节，专治 TLS 指纹墙。"""
    try:
        from curl_cffi import requests as creq
    except ImportError:
        return None, ""
    try:
        r = creq.get(url, impersonate="chrome120", timeout=30,
                     headers={"User-Agent": UA, "Referer": "https://www.google.com/"})
        return r.status_code, r.text
    except Exception as e:  # noqa: BLE001
        print(f"impersonate {url} failed: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
        return None, ""


def _rendered(url: str) -> str:
    """浏览器渲染兜底。返回的可能是包装后的 HTML，解析端要有容错。"""
    for name in ("StealthyFetcher", "DynamicFetcher"):
        try:
            mod = __import__("scrapling.fetchers", fromlist=[name])
            page = getattr(mod, name).fetch(url, headless=True, network_idle=True, timeout=60000)
            if page.status == 200 and page.html_content:
                return page.html_content
            print(f"{name.lower()} {url} -> {page.status}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"{name.lower()} unavailable/failed: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
    raise RuntimeError(f"all fetch routes failed for {url}")


def fetch_raw(url: str) -> str:
    """feed / api / signal 接口类取数：普通请求拿原始字节优先；失败或 403/429 时依次升级
    curl_cffi（chrome 伪装）→ StealthyFetcher → DynamicFetcher。返回的一定是原始文本。"""
    status, text = _plain_status(url)
    if status == 200 and text:
        return text
    if status is not None and status not in (403, 429):
        raise RuntimeError(f"plain fetch failed: HTTP {status}")
    status, text = _impersonated(url)
    if status == 200 and text:
        print(f"impersonate {url} -> 200", file=sys.stderr)
        return text
    return _rendered(url)


def fetch_rendered(url: str) -> str:
    """page 模式：浏览器渲染优先（现行链不动），最后回退普通请求。"""
    for name in ("StealthyFetcher", "DynamicFetcher"):
        try:
            mod = __import__("scrapling.fetchers", fromlist=[name])
            page = getattr(mod, name).fetch(url, headless=True, network_idle=True, timeout=60000)
            if page.status == 200 and page.html_content:
                return page.html_content
            print(f"{name.lower()} {url} -> {page.status}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"{name.lower()} unavailable/failed: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
    return fetch_plain(url)


# ---------- feed 解析（与旧版一致） ----------
def _extract_xml(text: str) -> str:
    """剥掉 <rss>/<feed>/<?xml 之前的杂质，并截掉 </rss>/</feed> 之后的尾巴。
    防浏览器渲染把 RSS 包成 HTML 文档后 ET 严格解析炸掉。"""
    m = re.search(r"<(?:\?xml\b|rss\b|feed\b)", text)
    if m:
        text = text[m.start():]
    for end in ("</rss>", "</feed>"):
        i = text.rfind(end)
        if i >= 0:
            text = text[: i + len(end)]
            break
    return text


def parse_feed(xml_text: str) -> list[dict]:
    xml_text = _extract_xml(xml_text)
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as first_err:
        # 宽容重试：lxml recover（scrapling 的依赖，venv 里有）
        try:
            from lxml import etree as LET
        except ImportError:
            raise first_err
        root = LET.fromstring(xml_text.encode("utf-8", "replace"),
                              parser=LET.XMLParser(recover=True, huge_tree=True))
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


# ---------- 第一批新增（2026-10-17 接入单 docs/SOURCE-ACCESS-BATCH1.md） ----------
EDGAR_UA = "GuanchaoBot/1.0 (+https://github.com/ZHANGFA88/shikuang)"  # SEC 公平访问申报串（架构裁定，不许编造邮箱）
# 实测（2026-10-17 云端）：SEC 对无邮箱形态的申报串一律 403（URL 串与浏览器 UA 均 403，邮箱形态 200）。
# 按架构裁定「SEC 明确要求邮箱形式则先停该源、由架构向 owner 索取联系邮箱」：未注入 EDGAR_CONTACT_UA 前跳过本源。


def _clean(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    return html_lib.unescape(re.sub(r"\s+", " ", text)).strip()


def parse_sina724(raw: str) -> list[dict]:
    """新浪财经 7×24：快讯全文即标题面（与既有快讯源同口径），标题取首句、摘要留全文。"""
    data = json.loads(raw)
    feed = (((data.get("result") or {}).get("data") or {}).get("feed") or {}).get("list") or []
    items = []
    for it in feed:
        text = _clean(it.get("rich_text") or "")
        url = (it.get("docurl") or "").strip()
        ts = (it.get("create_time") or "").strip()
        if not text or not url or not ts:
            continue
        title = re.split(r"[。！？]", text, maxsplit=1)[0][:120]
        published = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=CST).isoformat()
        item = {"title": title, "url": url, "publishedAt": published}
        if text != title:
            item["summary"] = text[:300]
        items.append(item)
    return items


def parse_edgar_atom(xml_text: str) -> list[dict]:
    """SEC EDGAR browse-edgar Atom（框架 parse_feed 只认 RSS item，这里单独解 entry）。"""
    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(_extract_xml(xml_text))
    items = []
    for entry in root.findall("a:entry", ns):
        title = _clean(entry.findtext("a:title", default="", namespaces=ns))
        link = ""
        for el in entry.findall("a:link", ns):
            if el.get("rel") in (None, "alternate"):
                link = el.get("href") or ""
                break
        updated = (entry.findtext("a:updated", default="", namespaces=ns) or "").strip()
        if not title or not link or not updated:
            continue
        published = datetime.fromisoformat(updated.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        items.append({"title": title[:200], "url": link, "publishedAt": published})
    return items


def collect_edgar() -> list[dict]:
    """8-K / 10-Q / 10-K 三路合并；请求必须带申报串，间隔 0.6s 守 SEC 速率礼仪。

    申报串优先取环境变量 EDGAR_CONTACT_UA（owner 提供的真实联系邮箱形态，如
    "Guanchao Research you@example.org"）；未提供时按架构裁定停源跳过，不许自行拼邮箱。
    """
    import os
    import time

    ua = os.environ.get("EDGAR_CONTACT_UA", "").strip()
    if not ua:
        print("push-sec-edgar skipped: SEC requires an email-shaped declared UA; "
              "awaiting owner contact via architecture (set EDGAR_CONTACT_UA to enable)")
        return []
    items: list[dict] = []
    for form in ("8-K", "10-Q", "10-K"):
        url = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent"
               f"&type={form}&company=&dateb=&owner=include&count=20&output=atom")
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "application/atom+xml"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            items.extend(parse_edgar_atom(resp.read().decode("utf-8", "replace")))
        time.sleep(0.6)
    return items


def parse_hkex(raw: str) -> list[dict]:
    """披露易 titleSearchServlet：result 是字符串化 JSON，二次解包。日期口径 HKT=+08。"""
    data = json.loads(raw)
    result = data.get("result")
    rows = json.loads(result) if isinstance(result, str) else (result or [])
    items = []
    for r in rows:
        title = _clean(r.get("TITLE") or r.get("SHORT_TEXT") or "")
        link = (r.get("FILE_LINK") or "").strip()
        ts = (r.get("DATE_TIME") or "").strip()
        if not title or not link or not ts:
            continue
        url = urljoin("https://www1.hkexnews.hk", link)
        published = datetime.strptime(ts, "%d/%m/%Y %H:%M").replace(tzinfo=CST).isoformat()
        stock = " ".join(x for x in [(r.get("STOCK_CODE") or "").strip(), _clean(r.get("STOCK_NAME") or "")] if x)
        item = {"title": title[:200], "url": url, "publishedAt": published}
        if stock:
            item["summary"] = stock[:300]
        items.append(item)
    return items


def collect_hkex() -> list[dict]:
    today = datetime.now(CST).date()
    frm = (today - timedelta(days=1)).strftime("%Y%m%d")
    to = today.strftime("%Y%m%d")
    url = ("https://www1.hkexnews.hk/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime"
           "&category=0&market=SEHK&stockId=-1&documentType=-1"
           f"&fromDate={frm}&toDate={to}&title=&searchType=1&t1code=-2&t2code=-2&rowRange=100&lang=EN")
    return parse_hkex(fetch_plain(url))


def collect_cninfo() -> list[dict]:
    """巨潮 hisAnnouncement：form POST，深沪两市各一页；近 24h、总量上限 200（接入单口径）。"""
    today = datetime.now(CST).date()
    se_date = f"{today - timedelta(days=1)} ~ {today}"
    items: list[dict] = []
    for column, plate in (("szse", "sz"), ("sse", "sh")):
        body = urlencode({
            "pageNum": 1, "pageSize": 100, "column": column, "tabName": "fulltext", "plate": plate,
            "stock": "", "searchkey": "", "secid": "", "category": "", "trade": "", "seDate": se_date,
        }).encode()
        req = urllib.request.Request(
            "https://www.cninfo.com.cn/new/hisAnnouncement/query", data=body,
            headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded",
                     "X-Requested-With": "XMLHttpRequest",
                     "Referer": "https://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        for a in data.get("announcements") or []:
            title = _clean(a.get("announcementTitle") or "")
            adj = (a.get("adjunctUrl") or "").strip()
            ts = a.get("announcementTime")
            if not title or not adj or not ts:
                continue
            published = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).isoformat()
            item = {"title": title[:200], "url": "http://static.cninfo.com.cn/" + adj, "publishedAt": published}
            sec = " ".join(x for x in [(a.get("secCode") or "").strip(), (a.get("secName") or "").strip()] if x)
            if sec:
                item["summary"] = sec[:300]
            items.append(item)
            if len(items) >= 200:
                return items
    return items


# ---------- signal 解析 ----------
def parse_hn() -> list[dict]:
    """HN 官方 Firebase 接口（免费免 Key）：头条里分数达标的才推，标题就是讨论帖标题。"""
    from concurrent.futures import ThreadPoolExecutor

    ids = json.loads(fetch_plain("https://hacker-news.firebaseio.com/v0/topstories.json"))[:40]

    def one(i):
        try:
            return json.loads(fetch_plain(f"https://hacker-news.firebaseio.com/v0/item/{i}.json"))
        except Exception:  # noqa: BLE001
            return None

    with ThreadPoolExecutor(max_workers=8) as ex:
        raw = [r for r in ex.map(one, ids) if r]
    items = []
    for it in raw:
        if it.get("type") != "story" or it.get("dead") or it.get("deleted"):
            continue
        if (it.get("score") or 0) < HN_MIN_SCORE or not it.get("title"):
            continue
        item = {"title": it["title"][:200],
                "url": f"https://news.ycombinator.com/item?id={it['id']}",
                "publishedAt": datetime.fromtimestamp(it["time"], tz=timezone.utc).isoformat()}
        if it.get("text"):
            text = html_lib.unescape(re.sub(r"<[^>]+>", " ", it["text"]))
            item["summary"] = re.sub(r"\s+", " ", text).strip()[:300]
        items.append(item)
    items.sort(key=lambda x: x["publishedAt"], reverse=True)
    return items[:20]


def parse_guba_board(page_html: str, code: str) -> list[dict]:
    """股吧列表页内嵌 var article_list JSON：按评论/阅读门槛筛真讨论帖。"""
    at = page_html.find("var article_list=")
    if at < 0:
        return []
    data, _ = json.JSONDecoder().raw_decode(page_html[at + len("var article_list="):])
    posts = []
    for p in data.get("re") or []:
        title = (p.get("post_title") or "").strip()
        clicks = p.get("post_click_count") or 0
        comments = p.get("post_comment_count") or 0
        if len(title) < 10 or (comments < 10 and clicks < 20000):
            continue
        try:
            when = datetime.strptime(p["post_publish_time"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=CST)
            published = when.astimezone(timezone.utc).isoformat()
        except Exception:  # noqa: BLE001
            published = datetime.now(timezone.utc).isoformat()
        posts.append({"title": title[:200],
                      "url": f"https://guba.eastmoney.com/news,{code},{p['post_id']}.html",
                      "publishedAt": published, "_comments": comments})
    posts.sort(key=lambda x: x["_comments"], reverse=True)
    for p in posts:
        del p["_comments"]
    return posts[:3]


def fetch_xueqiu(url: str) -> str:
    """雪球：patchright 无头打开首页种 cookie（xq_a_token），同一浏览器上下文里调 API 取 JSON。
    patchright/浏览器不可用时回退普通取数链；取数失败如实报错（本轮该源跳过）。"""

    def warmup() -> str:
        from patchright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(user_agent=UA)
                pg = ctx.new_page()
                pg.goto("https://xueqiu.com/", wait_until="domcontentloaded", timeout=60000)
                pg.wait_for_timeout(4000)
                if "xq_a_token" not in {c["name"] for c in ctx.cookies()}:
                    print("xueqiu: xq_a_token not planted, retrying once", file=sys.stderr)
                    pg.goto("https://xueqiu.com/", wait_until="domcontentloaded", timeout=60000)
                    pg.wait_for_timeout(4000)
                resp = ctx.request.get(url, headers={"Referer": "https://xueqiu.com/"})
                print(f"xueqiu api -> {resp.status}", file=sys.stderr)
                if resp.status != 200:
                    raise RuntimeError(f"xueqiu api HTTP {resp.status}")
                text = resp.text()
                if not text:
                    raise RuntimeError("xueqiu api empty body")
                return text
            finally:
                browser.close()

    try:
        return warmup()
    except ImportError:
        print("xueqiu: patchright not installed, using fetch chain", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        if "Executable doesn't exist" in str(e):
            print("xueqiu: patchright browser missing; "
                  "install with: .venv-scrapling/bin/python -m patchright install chromium", file=sys.stderr)
        else:
            print(f"xueqiu: browser warmup failed ({type(e).__name__}: {str(e)[:100]}), "
                  "using fetch chain", file=sys.stderr)
    return fetch_raw(url)


def parse_xueqiu(raw: str) -> list[dict]:
    """雪球全站讨论时间线：外层 list 的 data 字段是帖子 JSON 字符串。取数走 fetch_xueqiu
   （patchright 首页预热种 xq_a_token cookie 后调 API）；若返回的是阿里云 WAF 挑战页
    （带 _waf_ 标记且无帖子结构）直接抛错，本轮跳过。"""
    start = raw.find("{")
    if start < 0 or ("_waf_" in raw[:2000] and '"list"' not in raw):
        raise RuntimeError("xueqiu WAF challenge page, skip this round")
    data = json.loads(raw[start:])
    items = []
    for entry in data.get("list") or []:
        try:
            st = json.loads(entry["data"]) if isinstance(entry.get("data"), str) else entry
        except Exception:  # noqa: BLE001
            continue
        sid, uid = st.get("id"), st.get("user_id")
        desc = html_lib.unescape(re.sub(r"<[^>]+>", " ", st.get("description") or ""))
        desc = re.sub(r"\s+", " ", desc).strip()
        title = (st.get("title") or "").strip() or desc[:60]
        if not sid or not uid or len(title) < 6:
            continue
        if st.get("reply_count") is not None and st["reply_count"] < 3:
            continue
        item = {"title": title[:200], "url": f"https://xueqiu.com/{uid}/{sid}",
                "publishedAt": datetime.fromtimestamp((st.get("created_at") or 0) / 1000, tz=timezone.utc).isoformat()}
        if desc and desc[: len(title)] != title:
            item["summary"] = desc[:300]
        items.append(item)
    return items[:25]


def collect_guba() -> list[dict]:
    items, seen = [], set()
    for code, _name in GUBA_BOARDS:
        try:
            for it in parse_guba_board(fetch_plain(f"https://guba.eastmoney.com/list,{code}.html"), code):
                if it["url"] not in seen:
                    seen.add(it["url"])
                    items.append(it)
        except Exception as e:  # noqa: BLE001
            print(f"guba {code} failed: {type(e).__name__}: {str(e)[:80]}", file=sys.stderr)
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
        jobs.append((sid, name, lambda u=url: parse_feed(fetch_raw(u))))
    for cfg in PAGES:
        jobs.append((cfg["id"], cfg["name"], lambda c=cfg: parse_page(fetch_rendered(c["url"]), c)))
    for sid, name, url in APIS:
        jobs.append((sid, name, lambda u=url: parse_wallstreetcn(fetch_raw(u))))
    jobs.append(("push-guba", "东方财富股吧", collect_guba))
    jobs.append(("push-hn", "Hacker News 讨论", parse_hn))
    jobs.append(("push-xueqiu", "雪球讨论", lambda: parse_xueqiu(fetch_xueqiu(XUEQIU_TIMELINE))))
    jobs.append(("push-sina724", "新浪财经7×24快讯",
                 lambda: parse_sina724(fetch_raw("https://zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&page=1&page_size=30&type=0"))))
    jobs.append(("push-sec-edgar", "SEC EDGAR 公司申报", collect_edgar))
    jobs.append(("push-hkexnews", "港交所披露易公告", collect_hkex))
    jobs.append(("push-cninfo", "巨潮资讯公告", collect_cninfo))

    if "--only" in sys.argv:
        keep = set(sys.argv[sys.argv.index("--only") + 1].split(","))
        jobs = [j for j in jobs if j[0] in keep]

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
