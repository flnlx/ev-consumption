export const $ = (selector) => document.querySelector(selector);
export const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export const format = (value, digits = 2) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "—";

export async function api(path, method = "GET", body) {
  const result = await fetch(`/api${path}`, { method, credentials: "same-origin", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const value = await result.json().catch(() => ({ error: "后台返回了无效内容，请检查部署配置。" }));
  if (!result.ok) throw Object.assign(new Error(value.error ?? "操作失败。"), { status: result.status });
  return value;
}

export function message(text) { $("#message").textContent = text; $("#message").hidden = false; }
export function dismiss() { $("#message").hidden = true; }
export async function action(button, task) {
  button.disabled = true;
  dismiss();
  await task().catch((error) => message(error.message));
  button.disabled = false;
}
export function download(name, contents, type = "application/json") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function chart(title, rows, field, percent = false) {
  const points = rows.map((row) => typeof row[field] === "number" ? row[field] * (percent ? 100 : 1) : null);
  const maximum = points.reduce((value, point) => Math.max(value, point ?? 0), 0);
  const magnitude = 10 ** Math.floor(Math.log10(maximum || 1));
  const top = maximum > 0 ? Math.ceil(maximum * 1.12 / magnitude * 2) / 2 * magnitude : 1;
  const x = (index) => rows.length === 1 ? 310 : 65 + index * 490 / Math.max(1, rows.length - 1);
  const y = (value) => 175 - value / top * 140;
  const segments = [];
  const current = { values: [] };
  points.forEach((value, index) => {
    if (value === null) { if (current.values.length) segments.push(current.values.join(" ")); current.values = []; return; }
    current.values.push(`${x(index)},${y(value)}`);
  });
  if (current.values.length) segments.push(current.values.join(" "));
  const labels = new Set(Array.from({ length: Math.min(5, rows.length) }, (_, index) => Math.round(index * (rows.length - 1) / Math.max(1, Math.min(5, rows.length) - 1))));
  return `<div class="card chart"><div class="chart-title">${escape(title)}</div><svg viewBox="0 0 610 230" role="group" aria-label="${escape(title)}；横轴为选中期间，缺失数据不绘制"><g>${[0, .25, .5, .75, 1].map((fraction) => `<line class="chart-grid" x1="65" x2="555" y1="${y(top * fraction)}" y2="${y(top * fraction)}"/><text class="chart-label" x="57" text-anchor="end" y="${y(top * fraction) + 4}">${format(top * fraction, top >= 4 ? 0 : top >= .04 ? 2 : 4)}${percent ? "%" : ""}</text>`).join("")}</g>${segments.map((segment) => `<polyline class="chart-line" points="${segment}"/>`).join("")}${points.map((value, index) => {
    if (value === null) return "";
    const detail = `${rows[index].label}：${format(value)}${percent ? "%" : ""}`;
    return `<circle class="chart-dot" cx="${x(index)}" cy="${y(value)}" r="4"/><circle class="chart-point" tabindex="0" role="button" aria-label="${escape(detail)}" data-detail="${escape(detail)}" cx="${x(index)}" cy="${y(value)}" r="12"><title>${escape(detail)}</title></circle>`;
  }).join("")}${rows.map((row, index) => labels.has(index) ? `<text class="chart-label" x="${x(index)}" y="204" text-anchor="middle">${escape(row.axisLabel ?? row.label)}</text>` : "").join("")}${maximum === 0 && points.every((value) => value === null) ? '<text class="chart-label" x="310" y="100" text-anchor="middle">所选范围暂无可绘制数据</text>' : ""}</svg><p class="chart-detail muted" aria-live="polite">点选数据点查看数值 · 空缺期间不连线</p></div>`;
}
