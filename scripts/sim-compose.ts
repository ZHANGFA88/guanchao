// 模拟专用：手动组当天的日报（正常由 worker 每半小时的 reports.compose 排程触发）。
import { composeDaily } from "@aihot/backend/reports/compose";
import { closeDb } from "@aihot/backend/db";
const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const r = await composeDaily(date, "sim");
console.log("composed:", r);
await closeDb();
