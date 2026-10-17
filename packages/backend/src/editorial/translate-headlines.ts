// Headline + summary Chinese translations for the whole article pool (SPEC-TRANSLATION).
// Separate from full-text translation (editorial/translate.ts): every collected article's title and
// display summary is translated once, in batches of up to 10 items, on its own cron queue that shares
// the 5-minute rhythm but never the receipts of the full-text pipeline. Originals are never touched:
// translations land in articles.title_zh / articles.summary_zh and every reader surface falls back to
// the originals while a translation is missing.
import { z } from "zod";
import { sql } from "../db.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt, ReceiptUnknownError } from "../providers/receipts.ts";
import { modelFor } from "./models.ts";
import { shutdownSignal } from "../jobs/queue.ts";
import { promptFromText } from "./prompts.ts";
import { emit } from "../modules.ts";

export const HEADLINE_BATCH_SIZE = 10;
export const HEADLINE_PER_RUN = 60;
/** Batch attempts per run before the batch is left to the next day (SPEC-TRANSLATION §4). */
export const MAX_BATCH_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 20_000];
/** Translation sub-cap: at most this share of the llm daily budget (SPEC-TRANSLATION §7). */
const SUB_CAP_RATIO = 0.25;
const PURPOSE = "translate_headlines";

const Output = z.object({
  items: z.array(z.object({ id: z.string(), title_zh: z.string(), summary_zh: z.string() })),
});

const SYSTEM = promptFromText(
  "translate-headlines",
  [
    "Translate news headlines and their short summaries into Simplified Chinese.",
    'Return ONLY JSON: {"items": [{"id": ..., "title_zh": ..., "summary_zh": ...}]} with the same ids, in the same order, one entry per input item.',
    "Keep company, institution and person names in their standard Chinese form, or leave them in the original language when no standard form exists.",
    "Never invent facts not present in the source text. If a summary is empty, return summary_zh as an empty string.",
  ].join(" "),
);
const PROMPT_VERSION = "translate-headlines@2026-10-17";

class HeadlineInterruptedError extends Error {}

interface BatchItem {
  id: string;
  title: string;
  excerpt: string | null;
}

/** SPEC-TRANSLATION §2: the share of Han characters among the title's letters and digits. */
export function hanRatio(title: string): number {
  let han = 0;
  let other = 0;
  for (const ch of title) {
    if (/\p{Script=Han}/u.test(ch)) han++;
    else if (/\p{L}|\p{N}/u.test(ch)) other++;
  }
  return han + other === 0 ? 0 : han / (han + other);
}

/** SPEC-TRANSLATION §2: already-Chinese titles skip translation (no model call, no marking). */
export function isChineseTitle(title: string, language: string | null): boolean {
  return language === "zh" || hanRatio(title) >= 0.3;
}

export interface HeadlineRunResult {
  translated: number;
  skippedChinese: number;
  /** Batches left for the next day after their attempts ran out, or failed in this run. */
  failed: number;
  deferred: number;
  capped: boolean;
}

/** SPEC-TRANSLATION §7: the translation sub-cap stops the run when today's headline calls reach 25% of the llm daily budget. */
async function subCapReached(): Promise<boolean> {
  const [budget] = await sql<{ per_day: number }[]>`SELECT per_day FROM budgets WHERE service = 'llm'`;
  if (!budget) return false; // an operator-removed row means unlimited, same leniency as the receipt budget check
  const cap = Math.floor(budget.per_day * SUB_CAP_RATIO);
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*) AS n FROM receipt_attempts ra JOIN receipts r ON r.id = ra.receipt_id
    WHERE ra.service = 'llm' AND r.purpose = ${PURPOSE} AND ra.origin = 'live'
      AND ra.started_at > now() - interval '1 day'`;
  return Number(row!.n) >= cap;
}

/**
 * SPEC-TRANSLATION §4: a batch that already used its attempts in the last day waits for the next day.
 * The mark lives in the receipts this purpose already writes (subject = the batch's article ids), so no
 * new schema is needed and the full-text pipeline's translation_attempts is never touched.
 */
async function batchDeferred(subject: string): Promise<boolean> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*) AS n FROM receipt_attempts ra JOIN receipts r ON r.id = ra.receipt_id
    WHERE r.purpose = ${PURPOSE} AND r.subject = ${subject} AND ra.origin = 'live'
      AND ra.started_at > now() - interval '1 day'`;
  return Number(row!.n) >= MAX_BATCH_ATTEMPTS;
}

function aligned(input: BatchItem[], data: z.infer<typeof Output>): boolean {
  if (data.items.length !== input.length) return false;
  const ids = new Set(input.map((i) => i.id));
  if (!data.items.every((t) => ids.has(t.id))) return false;
  if (new Set(data.items.map((t) => t.id)).size !== input.length) return false;
  return data.items.every((t) => t.title_zh.trim().length > 0);
}

const sleepInterruptible = (ms: number) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    shutdownSignal.signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new HeadlineInterruptedError("worker shutting down"));
    }, { once: true });
  });

async function translateBatch(model: string, items: BatchItem[]): Promise<{ data: z.infer<typeof Output>; receiptId: number }> {
  const subject = `headlines:${[...items.map((i) => i.id)].sort().join(",")}`;
  const user = { items: items.map((i) => ({ id: i.id, title: i.title, summary: i.excerpt ?? "" })) };
  const maxTokens = Math.min(8000, Math.ceil(JSON.stringify(user).length * 1.5) + 400);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS; attempt++) {
    if (shutdownSignal.signal.aborted) throw new HeadlineInterruptedError("worker shutting down");
    if (attempt > 0) await sleepInterruptible(RETRY_DELAYS_MS[attempt - 1]!);
    try {
      const res = await chatJson({
        model,
        purpose: PURPOSE,
        subject,
        promptVersion: PROMPT_VERSION,
        system: SYSTEM,
        user: JSON.stringify(user),
        schema: Output,
        temperature: 0.2,
        maxTokens,
        timeoutMs: 120_000,
        attemptTag: attempt === 0 ? undefined : `retry-${attempt}`,
      });
      if (!aligned(items, res.data)) throw new Error(`batch answer did not line up (${res.data.items.length}/${items.length} items)`);
      return { data: res.data, receiptId: res.receiptId };
    } catch (error) {
      lastError = error;
      // A deploy stops between batches; an unknown outcome is released once by ops.recover.
      if (error instanceof HeadlineInterruptedError || error instanceof ReceiptUnknownError) throw error;
      // Switched-off model calls or an exhausted budget: stop the run without burning another attempt.
      if (/disabled|not configured|budget/i.test((error as Error).message)) throw error;
    }
  }
  throw lastError;
}

/**
 * Every few minutes: articles whose title has no Chinese rendition yet, newest first, in batches of up
 * to 10. Chinese titles are skipped without a model call (their title_zh stays NULL and the display
 * falls back to the original, which is already Chinese). An analysis-produced summary_zh is never
 * overwritten. Returns counts so the run record shows skips, failures and budget stops.
 */
export async function translateHeadlines(opts: { perRun?: number; budgetMs?: number } = {}): Promise<HeadlineRunResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 4 * 60_000;
  const result: HeadlineRunResult = { translated: 0, skippedChinese: 0, failed: 0, deferred: 0, capped: false };
  if (await subCapReached()) {
    result.capped = true;
    return result;
  }
  const model = await modelFor("translate");
  const rows = await sql<{ id: string; title: string; excerpt: string | null; language: string | null }[]>`
    SELECT id, title, excerpt, language FROM articles
    WHERE title_zh IS NULL
    ORDER BY discovered_at DESC, id
    LIMIT ${opts.perRun ?? HEADLINE_PER_RUN}`;
  const batches: BatchItem[][] = [];
  let current: BatchItem[] = [];
  for (const r of rows) {
    if (!r.title?.trim() || isChineseTitle(r.title, r.language)) {
      result.skippedChinese++;
      continue;
    }
    current.push({ id: r.id, title: r.title, excerpt: r.excerpt });
    if (current.length >= HEADLINE_BATCH_SIZE) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length) batches.push(current);

  for (const batch of batches) {
    if (Date.now() - started > budgetMs || shutdownSignal.signal.aborted) break;
    const subject = `headlines:${[...batch.map((i) => i.id)].sort().join(",")}`;
    if (await batchDeferred(subject)) {
      result.deferred++;
      continue;
    }
    let data: z.infer<typeof Output>;
    let receiptId: number;
    try {
      ({ data, receiptId } = await translateBatch(model, batch));
    } catch (error) {
      if (error instanceof HeadlineInterruptedError || error instanceof ReceiptUnknownError) break;
      // Disabled calls or an exhausted budget stop this run; the queue resumes next round.
      if (/disabled|not configured|budget/i.test((error as Error).message)) break;
      result.failed++;
      continue;
    }
    await sql.begin(async (tx) => {
      for (const t of data.items) {
        const done = await tx<{ id: string }[]>`
          UPDATE articles
          SET title_zh = ${t.title_zh.trim()},
              summary_zh = CASE WHEN summary_zh IS NULL THEN NULLIF(${t.summary_zh.trim()}, '') ELSE summary_zh END,
              updated_at = now()
          WHERE id = ${t.id} AND title_zh IS NULL
          RETURNING id`;
        if (done.length) {
          result.translated++;
          await emit("articleChanged", { id: t.id, kind: "content", reason: "headline translation" }, tx);
        }
      }
      await completeReceipt(tx, receiptId);
    });
  }
  return result;
}
