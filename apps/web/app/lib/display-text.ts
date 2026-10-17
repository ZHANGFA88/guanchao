/**
 * SPEC-TRANSLATION §6 · 唯一真源的取用口径。
 * 全站渲染新闻标题/摘要只能走这里，不许各组件各写一套：
 *   展示标题 = titleZh ?? title
 *   展示摘要 = summaryZh ?? summary
 * 译文缺失时自然回退原文（不许空卡、不许占位文案冒充译文）。
 * 链接字段（url / links.original）一律不经手，永远指向英文原文。
 */
export interface TranslatableText {
  title: string;
  titleZh?: string | null;
  summary?: string | null;
  summaryZh?: string | null;
}

/** 展示标题 = titleZh ?? title */
export function displayTitle(item: { title: string; titleZh?: string | null }): string {
  return item.titleZh ?? item.title;
}

/** 展示摘要 = summaryZh ?? summary（两者皆无时为 null） */
export function displaySummary(item: { summary?: string | null; summaryZh?: string | null }): string | null {
  return item.summaryZh ?? item.summary ?? null;
}
