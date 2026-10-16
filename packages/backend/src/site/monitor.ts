// The observatory monitor's data (the home page deck): the topic graph, the materials flowing in,
// and the collection totals. Topic membership here is a presentation-layer aggregation over the
// collected articles themselves — entity topics by their title pattern, tag topics by their tags
// appearing in the title, plus a source's own entity — so the deck is alive from the first collected
// article, before any editorial analysis exists. Cached briefly; the deck polls.
import type { MonitorResponse } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { cached } from "../lib/cache.ts";
import { TOPICS, topicMembership, type Topic } from "../publication/topics.ts";
import { publicSourceName } from "../publication/rules.ts";
import { TAG_SYNONYMS } from "@aihot/industry/taxonomy";

const FEED_LIMIT = 40;
const SCAN_WINDOW = 3000;

interface ArticleRow { id: string; title: string; source_id: string; discovered_at: Date; excerpt: string | null; atops: string[] }
interface SourceRow { id: string; name: string; kind: string; owner_entity_id: string | null }

const monitor = cached(() => queryMonitor(new Date()), { freshMs: 60_000, maxStaleMs: 10 * 60_000 });

export function loadMonitor(): Promise<MonitorResponse> {
  return monitor.get();
}

export async function loadCollectedToday(now = new Date()): Promise<{ collectedToday: number }> {
  const start = shanghaiDayStart(now);
  const [row] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM articles WHERE discovered_at >= ${start}`;
  return { collectedToday: row?.c ?? 0 };
}

/** Midnight in Asia/Shanghai (the site's editorial day), as a UTC instant. */
export function shanghaiDayStart(now: Date): Date {
  const shifted = new Date(now.getTime() + 8 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600_000);
}

function topicMatchers(topic: Topic, sourcesByEntity: Map<string, string[]>): (a: ArticleRow, source?: SourceRow) => boolean {
  const pattern = topic.pattern ? new RegExp(topic.pattern) : null;
  const needles = new Set<string>();
  if (!topic.entityId) {
    for (const tag of topic.tags) { needles.add(tag); for (const part of tag.split("/")) if (part.length >= 2) needles.add(part); }
    for (const [word, canonical] of Object.entries(TAG_SYNONYMS)) if (topic.tags.includes(canonical) && word.length >= 2) needles.add(word);
    for (const part of topic.name.split("/")) if (part.trim().length >= 2) needles.add(part.trim());
  }
  const entitySources = topic.entityId ? new Set(sourcesByEntity.get(topic.entityId) ?? []) : null;
  return (a, source) => {
    if (entitySources && source && entitySources.has(source.id)) return true;
    if (pattern) { try { if (pattern.test(a.title)) return true; } catch { /* a pack pattern JS cannot run */ } }
    for (const n of needles) if (n && a.title.includes(n)) return true;
    return false;
  };
}

async function queryMonitor(now: Date): Promise<MonitorResponse> {
  const [sources, articles, totals] = await Promise.all([
    sql<SourceRow[]>`SELECT id, name, kind, owner_entity_id FROM sources WHERE enabled`,
    sql<ArticleRow[]>`
      SELECT a.id, a.title, a.source_id, a.discovered_at, a.excerpt, coalesce(m.topics, '{}') AS atops
      FROM articles a
      LEFT JOIN (SELECT DISTINCT ON (article_id) article_id, tags, subjects FROM analyses ORDER BY article_id, input_revision DESC) an ON an.article_id = a.id
      LEFT JOIN LATERAL (
        SELECT ${topicMembership()} AS topics
        FROM (SELECT coalesce(an.tags, '{}') || coalesce((SELECT array_agg('entity:' || s) FROM unnest(coalesce(an.subjects, '{}')) AS s), '{}') AS tags,
                     a.title AS title, a.title AS original_title) p
      ) m ON true
      ORDER BY a.discovered_at DESC LIMIT ${SCAN_WINDOW}`,
    sql<{ items: number }[]>`SELECT count(*)::int AS items FROM articles`,
  ]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const sourcesByEntity = new Map<string, string[]>();
  for (const s of sources) if (s.owner_entity_id) sourcesByEntity.set(s.owner_entity_id, [...(sourcesByEntity.get(s.owner_entity_id) ?? []), s.id]);

  const matchers = TOPICS.map((t) => ({ topic: t, match: topicMatchers(t, sourcesByEntity) }));
  const counts = new Map<string, number>(TOPICS.map((t) => [t.slug, 0]));
  const pairCounts = new Map<string, number>();
  const itemTopics = new Map<string, string[]>();

  for (const a of articles) {
    const src = sourceById.get(a.source_id);
    const hits = a.atops.length ? a.atops : matchers.filter((m) => m.match(a, src)).map((m) => m.topic.slug);
    itemTopics.set(a.id, hits);
    for (const slug of hits) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
      const key = hits[i]! < hits[j]! ? `${hits[i]}|${hits[j]}` : `${hits[j]}|${hits[i]}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  const pairs = [...pairCounts.entries()]
    .map(([key, w]) => { const [a, b] = key.split("|"); return [a!, b!, w] as [string, string, number]; })
    .sort((x, y) => y[2] - x[2])
    .slice(0, 300);

  const dayStart = shanghaiDayStart(now);
  const feedItems = articles.slice(0, FEED_LIMIT).map((a) => {
    const src = sourceById.get(a.source_id);
    return {
      id: a.id,
      title: a.title,
      summary: a.excerpt ? a.excerpt.slice(0, 160) : null,
      source: src ? publicSourceName(src.name) : a.source_id,
      at: a.discovered_at.toISOString(),
      kind: src?.kind ?? "rss",
      topics: itemTopics.get(a.id) ?? [],
    };
  });

  return {
    topics: TOPICS.map((t) => ({ slug: t.slug, name: t.name, group: t.group, total: counts.get(t.slug) ?? 0 })),
    pairs,
    feed: { items: feedItems },
    stats: { sources: sources.length, items: totals[0]?.items ?? articles.length, today: articles.filter((a) => a.discovered_at >= dayStart).length },
    generatedAt: now.toISOString(),
  };
}
