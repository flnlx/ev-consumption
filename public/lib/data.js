export const fields = ["dateValue", "odometerKm", "chargedKwh", "amountCny", "fullCharge", "note"];
export const emptyRecord = (slot) => ({ slot, dateValue: null, odometerKm: null, chargedKwh: null, amountCny: null, fullCharge: null, note: null });
export const emptyData = () => ({
  schema: "ev-consumption-inputs", schemaVersion: 2, workbookVersion: "Pages-1.0.0",
  dateEncoding: "Excel 1900 date serial; text dates preserved as text",
  vehicle: { batteryCapacityKwh: null, ratedRangeKm: null },
  view: { grain: "月度", year: new Date().getFullYear() }, chargingRecords: [],
});

export function validateData(input) {
  if (!input || input.schema !== "ev-consumption-inputs" || ![1, 2].includes(input.schemaVersion)) throw new Error("不支持的备份格式或版本。");
  const scalar = (value) => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
  if (!input.vehicle || !input.view || !Array.isArray(input.chargingRecords)) throw new Error("备份缺少车辆参数、视图设置或充电记录。");
  for (const [object, names] of [[input.vehicle, ["batteryCapacityKwh", "ratedRangeKm"]], [input.view, ["grain", "year"]]]) {
    if (names.some((name) => !Object.hasOwn(object, name) || !scalar(object[name]))) throw new Error("备份字段缺失或数据类型错误。");
  }
  const slots = new Set();
  const records = input.chargingRecords.map((record) => {
    if (!record || !Number.isSafeInteger(record.slot) || record.slot < 1 || slots.has(record.slot)) throw new Error("备份的记录位置重复或无效。");
    if (fields.some((name) => !Object.hasOwn(record, name) || !scalar(record[name]))) throw new Error("记录字段缺失或数据类型错误。");
    slots.add(record.slot);
    return Object.fromEntries([['slot', record.slot], ...fields.map((name) => [name, record[name]])]);
  });
  return {
    ...emptyData(), schemaVersion: input.schemaVersion,
    vehicle: { batteryCapacityKwh: input.vehicle.batteryCapacityKwh, ratedRangeKm: input.vehicle.ratedRangeKm },
    view: { grain: input.view.grain, year: input.view.year }, chargingRecords: records.sort((a, b) => a.slot - b.slot),
  };
}

export function dateSerial(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || null;
  const time = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== text) return text;
  return (time - Date.UTC(1899, 11, 31)) / 86400000 + (text >= "1900-03-01" ? 1 : 0);
}

export function dateText(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value == null ? "" : String(value);
  if (Math.floor(value) === 60) return "1900-02-29";
  const time = Date.UTC(1899, 11, 31) + (value - (value >= 60 ? 1 : 0)) * 86400000;
  return Math.abs(time) <= 8640000000000000 ? new Date(time).toISOString().slice(0, 10) : String(value);
}
