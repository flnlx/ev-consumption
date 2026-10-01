import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { calculate } from "../public/lib/calculate.js";
import { emptyData, emptyRecord, dateSerial } from "../public/lib/data.js";

const directory = new URL("../.artifact/", import.meta.url);
await mkdir(directory, { recursive: true });
if (process.argv.includes("--check")) {
  const results = JSON.parse(await readFile(new URL("excel-reference.json", directory), "utf8"));
  const equal = (actual, expected, label) => {
    const normalized = expected === "" || expected === undefined ? null : expected;
    if (typeof actual === "number" && typeof normalized === "number") { assert.ok(Math.abs(actual - normalized) < 1e-7 * Math.max(1, Math.abs(normalized)), `${label}: ${actual} != ${normalized}`); return; }
    assert.equal(actual, normalized, label);
  };
  const metrics = ["startDate", "endDate", "startKm", "endKm", "distance", "energy", "amount", "consumption", "unitPrice", "costKm", "cost100", "range", "attainment", "status"];
  for (const [index, result] of results.entries()) {
    const actual = calculate(result.input);
    for (const [offset, field] of metrics.entries()) { equal(actual.full[field], result.full[offset], `${index} full.${field}`); equal(actual.all[field], result.all[offset], `${index} all.${field}`); }
    for (const [offset, field] of ["count", "anomalies", "fullCount", "intervalCount"].entries()) equal(actual[field], result.counts[offset], `${index} ${field}`);
    for (const [offset, row] of actual.rows.entries()) {
      const expected = result.rows.find((item) => item.slot === row.slot);
      for (const [column, field] of ["unitPrice", "status", "previousFullSlot", "distance", "energy", "amount", "consumption"].entries()) {
        if (field === "previousFullSlot") continue;
        equal(row[field], expected.values[column], `${index} row ${offset}.${field}`);
      }
    }
    for (const [offset, row] of actual.periods.entries()) for (const [column, field] of ["label", "purchasedEnergy", "purchasedAmount", "intervalCount", "distance", "energy", "amount", "consumption", "costKm", "attainment", "purchasedUnitPrice"].entries()) equal(row[field], result.periods[offset][column], `${index} period ${offset}.${field}`);
  }
  console.log(`通过 ${results.length} 组原生 Excel 逐项对照（总览、记录状态、区间和分期）。`);
} else {
  const random = { value: 20261001 };
  const next = (max) => { random.value = (Math.imul(random.value, 1664525) + 1013904223) >>> 0; return random.value % max; };
  const cases = Array.from({ length: 20 }, (_, index) => {
    const distance = { value: 1000 };
    return { ...emptyData(), vehicle: { batteryCapacityKwh: 60, ratedRangeKm: 500 }, view: { grain: ["月度", "季度", "年度"][index % 3], year: 2025 },
      chargingRecords: Array.from({ length: index === 19 ? 500 : 2 + next(80) }, (_, offset) => {
        distance.value += next(200);
        return { ...emptyRecord(offset + 1), dateValue: dateSerial("2024-12-20") + offset * 4, odometerKm: distance.value, chargedKwh: (next(599) + 1) / 10, amountCny: next(1200) / 10, fullCharge: next(4) === 0 ? "是" : "否", note: null };
      }) };
  });
  const base = { ...emptyData(), vehicle: { batteryCapacityKwh: 60, ratedRangeKm: 500 }, view: { grain: "月度", year: 2025 }, chargingRecords: [
    { ...emptyRecord(1), dateValue: dateSerial("2024-12-20"), odometerKm: 1000, chargedKwh: 20, amountCny: 10, fullCharge: "是" },
    { ...emptyRecord(2), dateValue: dateSerial("2024-12-31"), odometerKm: 1200, chargedKwh: 30, amountCny: 0, fullCharge: "否" },
    { ...emptyRecord(3), dateValue: dateSerial("2025-01-05"), odometerKm: 1500, chargedKwh: 50, amountCny: 60, fullCharge: "是" },
  ] };
  for (const [field, value] of [["dateValue", "45600"], ["odometerKm", "1200"], ["dateValue", 0], ["amountCny", null], ["chargedKwh", 0], ["fullCharge", "未知"]]) { const data = structuredClone(base); data.chargingRecords[1][field] = value; cases.push(data); }
  const badFull = structuredClone(base); badFull.chargingRecords[0].amountCny = -1; cases.push(badFull);
  const gap = structuredClone(base); gap.chargingRecords[1] = emptyRecord(2); cases.push(gap);
  const empty = emptyData(); empty.view.year = 2025; cases.push(empty);
  const lower = structuredClone(base); lower.view = { grain: "年度", year: 1900 }; cases.push(lower);
  await writeFile(new URL("excel-cases.json", directory), JSON.stringify(cases));
  console.log(`已生成 ${cases.length} 组 Excel 对照输入。`);
}
