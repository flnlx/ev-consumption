import { dateSerial, dateText } from "./data.js";

export function monthIndex(text) {
  if (typeof text !== "string" || !/^(\d{4})-(0[1-9]|1[0-2])$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  return year >= 1900 && year <= 9998 ? year * 12 + Number(text.slice(5)) - 1 : null;
}

export function monthText(index) {
  return `${Math.floor(index / 12).toString().padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}

export function monthDomain(records, now = new Date()) {
  const current = now.getFullYear() * 12 + now.getMonth();
  const months = records.flatMap((row) => {
    if (typeof row.dateValue !== "number" || !Number.isFinite(row.dateValue) || row.dateValue <= 0 || row.dateValue >= 2958466) return [];
    const index = monthIndex(dateText(row.dateValue).slice(0, 7));
    return index === null ? [] : [index];
  });
  const start = months.reduce((value, month) => Math.min(value, month), months[0] ?? current);
  const end = months.reduce((value, month) => Math.max(value, month), months[0] ?? current);
  return { min: Math.floor(Math.min(start, current) / 12) * 12, max: Math.floor(Math.max(end, current) / 12) * 12 + 11, start, end, current };
}

export function selectedPeriods(selection, grain) {
  const start = monthIndex(selection.start);
  const end = monthIndex(selection.end);
  if (start === null || end === null || start > end || !["月度", "季度", "年度"].includes(grain)) return null;
  const size = grain === "月度" ? 1 : grain === "季度" ? 3 : 12;
  const first = Math.floor(start / size) * size;
  return Array.from({ length: Math.floor((end - first) / size) + 1 }, (_, index) => {
    const base = first + index * size;
    const from = Math.max(start, base);
    const until = Math.min(end + 1, base + size);
    const label = grain === "月度" ? monthText(base) : grain === "季度" ? `${Math.floor(base / 12)} Q${Math.floor(base % 12 / 3) + 1}` : String(Math.floor(base / 12));
    const partial = from !== base || until !== base + size;
    const months = from === until - 1 ? `${from % 12 + 1}月` : `${from % 12 + 1}–${(until - 1) % 12 + 1}月`;
    return { label: partial ? `${label}（${months}）` : label, axisLabel: label,
      begin: dateSerial(`${monthText(from)}-01`), end: dateSerial(`${monthText(until)}-01`), partial };
  });
}
