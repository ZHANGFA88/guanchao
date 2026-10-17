// SPEC-TRANSLATION §2: headline language detection. Pure-function tests; no database needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hanRatio, isChineseTitle } from "@aihot/backend/editorial/translate-headlines";

test("hanRatio counts Han characters among letters and digits", () => {
  assert.equal(hanRatio("美联储宣布降息"), 1);
  assert.equal(hanRatio("Federal Reserve cuts rates"), 0);
  // Mixed title: 10 Han + 3 letters (MLF) = 10/13 ≈ 0.77
  const mixed = "中国央行MLF操作利率下调";
  assert.ok(hanRatio(mixed) > 0.76 && hanRatio(mixed) < 0.78);
  assert.equal(hanRatio(""), 0);
  assert.equal(hanRatio("!!!"), 0);
});

test("isChineseTitle skips Chinese titles per SPEC-TRANSLATION §2", () => {
  assert.ok(isChineseTitle("美联储宣布降息25个基点", null));
  assert.ok(isChineseTitle("央行开展5000亿元MLF操作", null));
  assert.ok(!isChineseTitle("Fed cuts rates by 25 bps", null));
  assert.ok(!isChineseTitle("Tesla Q3 earnings beat estimates", null));
  // An explicit language tag wins over the ratio for zh; other tags fall back to the ratio.
  assert.ok(isChineseTitle("whatever", "zh"));
  assert.ok(isChineseTitle("中国央行MLF操作", "en"));
  assert.ok(!isChineseTitle("Fed cuts rates", "en"));
});
