-- Chinese rendition of the article headline (SPEC-TRANSLATION §3). The original title is never
-- overwritten; NULL means untranslated, Chinese-skipped, or pending retry, and display falls back to title.
ALTER TABLE articles ADD COLUMN title_zh text;
