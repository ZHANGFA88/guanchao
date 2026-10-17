-- Chinese rendition of the article's display summary (SPEC-TRANSLATION §3). The original excerpt is
-- never overwritten; NULL means untranslated, Chinese-skipped, or pending retry, and display falls back to excerpt.
ALTER TABLE articles ADD COLUMN summary_zh text;
