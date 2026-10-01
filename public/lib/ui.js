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
  const top = Math.max(1, ...points.filter((value) => value !== null)) * 1.15;
  const x = (index) => 48 + index * 520 / Math.max(1, rows.length - 1);
  const y = (value) => 175 - value / top * 140;
  const segments = [];
  const current = { values: [] };
  points.forEach((value, index) => {
    if (value === null) { if (current.values.length) segments.push(current.values.join(" ")); current.values = []; return; }
    current.values.push(`${x(index)},${y(value)}`);
  });
  if (current.values.length) segments.push(current.values.join(" "));
  return `<div class="card chart"><div class="chart-title">${escape(title)}</div><svg viewBox="0 0 610 220" role="img" aria-label="${escape(title)}；缺失数据不绘制"><g>${[0, .5, 1].map((fraction) => `<line class="chart-grid" x1="48" x2="575" y1="${y(top * fraction)}" y2="${y(top * fraction)}"/><text class="chart-label" x="0" y="${y(top * fraction) + 4}">${format(top * fraction, 0)}${percent ? "%" : ""}</text>`).join("")}</g>${segments.map((segment) => `<polyline class="chart-line" points="${segment}"/>`).join("")}${points.map((value, index) => value === null ? "" : `<circle class="chart-dot" cx="${x(index)}" cy="${y(value)}" r="3"><title>${escape(rows[index].label)}：${format(value)}${percent ? "%" : ""}</title></circle>`).join("")}${rows.map((row, index) => `<text class="chart-label" x="${x(index)}" y="202" text-anchor="middle">${escape(row.label.replace(/^\d{4}-/, ""))}</text>`).join("")}</svg></div>`;
}
