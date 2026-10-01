import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../public/lib/calculate.js";
import { dateSerial, dateText, emptyData, emptyRecord, validateData } from "../public/lib/data.js";
import { splitRecords, hashRecords } from "../public/lib/chunks.js";

export function ledger() {
  return { ...emptyData(), vehicle: { batteryCapacityKwh: 60, ratedRangeKm: 500 }, view: { grain: "月度", year: 2025 }, chargingRecords: [
    ["2024-12-20", 1000, 20, 10, "是", "中文\n第二行"], ["2024-12-31", 1200, 30, 0, "否", "免费"],
    ["2025-01-05", 1500, 50, 60, "是", ""], ["2025-04-05", 1800, 54, 36, "是", ""],
    ["2025-04-06", 1800, 2, 1, "是", "=纯文字"], ["2025-05-01", 2000, 20, 15, "否", "未结束"],
  ].map((row, index) => ({ slot: index + 1, dateValue: dateSerial(row[0]), odometerKm: row[1], chargedKwh: row[2], amountCny: row[3], fullCharge: row[4], note: row[5] })) };
}

test("原 Excel 跨年、免费充电、同里程补电和未结束区间的已知结果", () => {
  const result = calculate(ledger());
  assert.equal(result.anomalies, 0);
  assert.equal(result.full.distance, 800);
  assert.equal(result.full.energy, 136);
  assert.equal(result.full.amount, 97);
  assert.equal(result.all.distance, 1000);
  assert.equal(result.all.energy, 156);
  assert.equal(result.all.amount, 112);
  assert.equal(result.periods[0].purchasedEnergy, 50);
  assert.equal(result.periods[0].energy, 80);
  assert.equal(result.periods[0].consumption, 16);
  assert.equal(result.periods[0].attainment, .75);
  assert.equal(result.periods[3].energy, 56);
  assert.equal(result.periods[3].consumption, 56 / 300 * 100);
  assert.equal(result.periods[1].purchasedEnergy, null);
  assert.equal(result.periods[4].consumption, null);
  const quarterly = ledger(); quarterly.view.grain = "季度";
  assert.equal(calculate(quarterly).periods.length, 4);
  assert.equal(calculate(quarterly).periods[1].energy, 56);
  quarterly.view.grain = "年度";
  assert.equal(calculate(quarterly).periods.length, 5);
  assert.equal(calculate(quarterly).periods[4].purchasedEnergy, 126);
  assert.equal(calculate(quarterly).periods[4].energy, 136);
});

test("异常输入使统计留空；零金额有效，数字文本保留原类型", () => {
  for (const [field, value] of [["chargedKwh", 0], ["amountCny", -1], ["dateValue", 0], ["fullCharge", "未知"], ["odometerKm", 900], ["amountCny", null], ["dateValue", "45600"]]) {
    const data = ledger(); data.chargingRecords[1][field] = value;
    const result = calculate(data);
    assert.ok(result.anomalies > 0, field);
    assert.equal(result.full.consumption, null);
    assert.equal(result.periods[0].consumption, null);
  }
  const data = ledger(); data.vehicle.batteryCapacityKwh = "60";
  assert.equal(calculate(data).full.range, null);
  data.view.year = 2025.5;
  assert.deepEqual(calculate(data).periods, []);
  const textPrevious = ledger(); textPrevious.chargingRecords[1].dateValue = "45600";
  assert.equal(calculate(textPrevious).rows[2].status, "日期或里程倒退");
});

test("无记录、只有一条、零里程、空行和缺失图表值", () => {
  assert.equal(calculate(emptyData()).full.status, "需要两次充满");
  const data = ledger(); data.chargingRecords = data.chargingRecords.slice(0, 1);
  assert.equal(calculate(data).all.consumption, null);
  data.chargingRecords.push({ ...data.chargingRecords[0], slot: 2 });
  assert.equal(calculate(data).full.status, "区间里程不足");
  assert.equal(calculate(data).full.energy, 20);
  assert.equal(calculate(data).full.consumption, null);
  data.chargingRecords[1].slot = 3;
  assert.equal(calculate(data).rows[1].status, "请连续录入");
});

test("超过 500 条：10000 条记录、分块及加权电耗", async () => {
  const data = ledger();
  data.chargingRecords = Array.from({ length: 10000 }, (_, index) => ({ ...emptyRecord(index + 1), dateValue: 45000 + index, odometerKm: index * 100, chargedKwh: 20, amountCny: 10, fullCharge: index % 3 === 0 ? "是" : "否" }));
  const result = calculate(data);
  assert.equal(result.count, 10000);
  assert.equal(result.full.consumption, 20);
  assert.equal(result.all.consumption, 20);
  const chunks = splitRecords(data.chargingRecords);
  assert.equal(chunks.flat().length, 10000);
  assert.ok(chunks.length > 1);
  assert.equal((await hashRecords(chunks[0])).length, 43);
});

test("旧版 JSON 无损读取，重复位置、缺失字段和未知版本拒绝", () => {
  const original = ledger(); original.schemaVersion = 1;
  original.chargingRecords.push({ ...emptyRecord(700), amountCny: 0, note: '<script>\n"_x000A_"' });
  const data = validateData(original);
  assert.deepEqual(data.chargingRecords, original.chargingRecords);
  assert.equal(data.schemaVersion, 1);
  assert.throws(() => validateData({ ...original, schemaVersion: 8 }));
  assert.throws(() => validateData({ ...original, chargingRecords: [original.chargingRecords[0], original.chargingRecords[0]] }));
  assert.throws(() => validateData({ ...original, chargingRecords: [{ slot: 1 }] }));
  assert.equal(dateText(dateSerial("2025-01-05")), "2025-01-05");
  assert.equal(dateSerial("1900-01-01"), 1);
  assert.equal(dateSerial("1900-03-01"), 61);
  assert.equal(dateText(60), "1900-02-29");
  assert.equal(dateSerial("2025-02-30"), "2025-02-30");
});
