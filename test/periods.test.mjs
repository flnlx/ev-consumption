import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../public/lib/calculate.js";
import { monthDomain, monthIndex, selectedPeriods } from "../public/lib/periods.js";
import { chart } from "../public/lib/ui.js";
import { emptyData, dateSerial } from "../public/lib/data.js";

function ledger() {
  return { ...emptyData(), vehicle: { batteryCapacityKwh: 60, ratedRangeKm: 500 }, chargingRecords: [
    ["2024-12-20", 1000, 20, 10, "是"], ["2024-12-31", 1200, 30, 0, "否"], ["2025-01-05", 1500, 50, 60, "是"],
  ].map((row, index) => ({ slot: index + 1, dateValue: dateSerial(row[0]), odometerKm: row[1], chargedKwh: row[2], amountCny: row[3], fullCharge: row[4], note: null })) };
}

test("跨年月份完整列出、单月和空期间保留", () => {
  const result = calculate(ledger(), { start: "2024-12", end: "2025-02" });
  assert.deepEqual(result.periods.map((row) => row.label), ["2024-12", "2025-01", "2025-02"]);
  assert.equal(result.periods[0].purchasedEnergy, 50);
  assert.equal(result.periods[1].energy, 80);
  assert.equal(result.periods[2].purchasedEnergy, null);
  assert.equal(calculate(ledger(), { start: "2025-01", end: "2025-01" }).periods.length, 1);
});

test("筛选起点外的充满记录仍参与完整区间计算", () => {
  const result = calculate(ledger(), { start: "2025-01", end: "2025-01" });
  assert.equal(result.periods[0].distance, 500);
  assert.equal(result.periods[0].energy, 80);
  assert.equal(result.periods[0].purchasedEnergy, 50);
  assert.equal(result.full.energy, calculate(ledger()).full.energy);
});

test("不完整季度年度只统计选定月份，并明确标注", () => {
  const data = ledger(); data.view.grain = "季度";
  const result = calculate(data, { start: "2024-12", end: "2025-01" });
  assert.deepEqual(result.periods.map((row) => row.label), ["2024 Q4（12月）", "2025 Q1（1月）"]);
  data.view.grain = "年度";
  const yearly = calculate(data, { start: "2024-12", end: "2025-01" });
  assert.equal(yearly.periods[1].purchasedEnergy, 50);
  assert.equal(yearly.periods[1].energy, 80);
  assert.equal(yearly.periods[1].partial, true);
});

test("月份边界、非法范围与无记录默认值", () => {
  assert.equal(monthIndex("2025-13"), null);
  assert.equal(selectedPeriods({ start: "2025-02", end: "2025-01" }, "月度"), null);
  assert.equal(selectedPeriods({ start: "9998-12", end: "9998-12" }, "月度")[0].label, "9998-12");
  assert.equal(monthDomain([], new Date(2026, 9, 1)).start, monthIndex("2026-10"));
  assert.equal(monthDomain(ledger().chargingRecords, new Date(2026, 9, 1)).min, monthIndex("2024-01"));
});

test("图表保留跨年标签、长范围稀疏标注、范围变化后纵轴缩放", () => {
  const rows = Array.from({ length: 36 }, (_, index) => ({ label: `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`, value: index === 0 ? 500 : .2 }));
  const full = chart("充电量", rows, "value");
  const narrow = chart("充电量", rows.slice(12, 14), "value");
  assert.ok(full.includes("2024-01") && full.includes("2026-12"));
  assert.equal((full.match(/y="204"/g) ?? []).length, 5);
  assert.ok(narrow.includes("0.25"));
  assert.ok(!narrow.includes(">600.00<"));
  assert.ok(chart("单月", [{ label: "2025-01", value: 1 }], "value").includes('cx="310"'));
});
