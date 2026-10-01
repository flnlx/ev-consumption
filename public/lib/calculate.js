import { fields, dateSerial } from "./data.js";
import { selectedPeriods } from "./periods.js";

const number = (value) => typeof value === "number" && Number.isFinite(value);
const sum = (rows, field) => rows.reduce((total, row) => total + (number(row[field]) ? row[field] : 0), 0);
const blank = (value) => value === null || value === "";
// Excel compares a numeric cell as less than a text or boolean cell; JS would coerce it.
const less = (value, previous) => typeof previous === "boolean" || (typeof previous === "string" && previous !== "") || value < (previous ?? 0);

export function calculate(data, selection = null) {
  const state = { lastFull: null, energy: 0, amount: 0 };
  const records = data.chargingRecords.filter((row) => fields.some((field) => !blank(row[field])));
  const bySlot = new Map(records.map((row) => [row.slot, row]));
  const rows = records.map((record) => {
    const previous = bySlot.get(record.slot - 1);
    const status = ![record.dateValue, record.odometerKm, record.chargedKwh, record.amountCny].every(number) || !["是", "否"].includes(record.fullCharge)
      ? "填写必填项"
      : record.dateValue <= 0 || record.dateValue >= 2958466 || record.odometerKm < 0 || record.chargedKwh <= 0 || record.amountCny < 0
        ? "数值无效"
        : record.slot > 1 && (!previous || blank(previous.dateValue))
          ? "请连续录入"
          : record.slot > 1 && less(Math.floor(record.dateValue), number(previous.dateValue) ? Math.floor(previous.dateValue) : previous.dateValue)
            ? "日期早于上一条"
            : record.slot > 1 && less(record.odometerKm, previous.odometerKm)
              ? "累计里程小于上一条" : "正常";
    const previousFull = state.lastFull;
    if (status === "正常") { state.energy += record.chargedKwh; state.amount += record.amountCny; }
    const closed = status === "正常" && record.fullCharge === "是" && previousFull;
    const distance = closed ? record.odometerKm - previousFull.odometerKm : null;
    const energy = closed ? state.energy - previousFull.energy : null;
    const amount = closed ? state.amount - previousFull.amount : null;
    if (status === "正常" && record.fullCharge === "是") state.lastFull = { ...record, energy: state.energy, amount: state.amount };
    return { ...record, status, unitPrice: number(record.chargedKwh) && number(record.amountCny) && record.chargedKwh > 0 ? record.amountCny / record.chargedKwh : null,
      previousFullSlot: previousFull?.slot ?? null, distance, energy, amount, consumption: distance > 0 ? energy / distance * 100 : null };
  });
  const anomalies = rows.filter((row) => row.status !== "正常").length;
  const full = rows.filter((row) => row.status === "正常" && row.fullCharge === "是");
  const intervals = rows.filter((row) => number(row.distance));
  const valid = rows.filter((row) => row.status === "正常");
  const count = rows.filter((row) => number(row.dateValue)).length;
  const first = bySlot.get(1);
  const last = valid.at(-1);
  const metrics = (distance, energy, amount, start, end, status) => {
    const consumption = number(distance) && distance > 0 ? energy / distance * 100 : null;
    const range = number(consumption) && consumption > 0 && number(data.vehicle.batteryCapacityKwh) && data.vehicle.batteryCapacityKwh > 0 ? data.vehicle.batteryCapacityKwh / consumption * 100 : null;
    return { startDate: start?.dateValue ?? null, endDate: end?.dateValue ?? null, startKm: start?.odometerKm ?? null, endKm: end?.odometerKm ?? null,
      distance, energy, amount, consumption, unitPrice: energy > 0 ? amount / energy : null, costKm: distance > 0 ? amount / distance : null,
      cost100: distance > 0 ? amount / distance * 100 : null, range,
      attainment: number(range) && number(data.vehicle.ratedRangeKm) && data.vehicle.ratedRangeKm > 0 ? range / data.vehicle.ratedRangeKm : null, status };
  };
  const fullReady = !anomalies && full.length >= 2;
  const allReady = !anomalies && count >= 2;
  const fullDistance = fullReady ? sum(intervals, "distance") : null;
  const allDistance = allReady ? (last?.odometerKm ?? 0) - (first?.odometerKm ?? 0) : null;
  const fullMetrics = metrics(fullDistance, fullReady ? sum(intervals, "energy") : null, fullReady ? sum(intervals, "amount") : null,
    full.length >= 2 ? rows.find((row) => row.fullCharge === "是") : null, full.length >= 2 ? full.at(-1) : null,
    anomalies ? "请修正异常记录" : full.length < 2 ? "需要两次充满" : fullDistance <= 0 ? "区间里程不足" : "可统计");
  const allMetrics = metrics(allDistance, allReady ? sum(rows.filter((row) => row.slot > 1), "chargedKwh") : null, allReady ? sum(rows.filter((row) => row.slot > 1), "amountCny") : null,
    count >= 2 ? first : null, count >= 2 ? last : null,
    anomalies ? "请修正异常记录" : count < 2 ? "需要两条记录" : allDistance <= 0 ? "累计里程不足" : "累计估算");
  const selected = selection ? selectedPeriods(selection, data.view.grain) : null;
  const viewValid = selection ? selected !== null : number(data.view.year) && Number.isInteger(data.view.year) && data.view.year >= 1900 && data.view.year <= 9998 && ["月度", "季度", "年度"].includes(data.view.grain);
  const bounds = selection ? selected ?? [] : !viewValid ? [] : Array.from({ length: data.view.grain === "月度" ? 12 : data.view.grain === "季度" ? 4 : 5 }, (_, index) => {
    // Excel DATE treats years 0..1899 as offsets from 1900, including the five-year view at the lower boundary.
    const rawYear = data.view.grain === "年度" ? data.view.year - 4 + index : data.view.year;
    const year = rawYear >= 0 && rawYear < 1900 ? rawYear + 1900 : rawYear;
    const month = data.view.grain === "月度" ? index : data.view.grain === "季度" ? index * 3 : 0;
    const months = data.view.grain === "月度" ? 1 : data.view.grain === "季度" ? 3 : 12;
    const begin = dateSerial(`${year.toString().padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`);
    const endDate = new Date(Date.UTC(year, month + months, 1)).toISOString().slice(0, 10);
    const end = dateSerial(endDate);
    return { begin, end, label: data.view.grain === "月度" ? `${year}-${String(month + 1).padStart(2, "0")}` : data.view.grain === "季度" ? `${year} Q${index + 1}` : String(year) };
  });
  const periods = bounds.map((period) => {
    const begin = period.begin;
    const end = period.end;
    const purchased = rows.filter((row) => number(row.dateValue) && row.dateValue >= begin && row.dateValue < end);
    const closed = intervals.filter((row) => row.dateValue >= begin && row.dateValue < end);
    const distance = !anomalies && closed.length ? sum(closed, "distance") : null;
    const energy = !anomalies && closed.length ? sum(closed, "energy") : null;
    const amount = !anomalies && closed.length ? sum(closed, "amount") : null;
    return { ...period,
      purchasedEnergy: !anomalies && purchased.length ? sum(purchased, "chargedKwh") : null,
      purchasedAmount: !anomalies && purchased.length ? sum(purchased, "amountCny") : null,
      intervalCount: anomalies ? null : closed.length,
      ...metrics(distance, energy, amount, null, null, ""),
      purchasedUnitPrice: !anomalies && sum(purchased, "chargedKwh") > 0 ? sum(purchased, "amountCny") / sum(purchased, "chargedKwh") : null };
  });
  return { rows, full: fullMetrics, all: allMetrics, periods, count, anomalies, fullCount: full.length, intervalCount: intervals.length, viewValid };
}
