import { calculate } from "./lib/calculate.js";
import { emptyData, emptyRecord, fields, validateData, dateSerial, dateText } from "./lib/data.js";
import { $, escape, format, api, message, dismiss, action, download, chart } from "./lib/ui.js";
import { splitRecords, hashRecords } from "./lib/chunks.js";
import { monthDomain, monthIndex, monthText } from "./lib/periods.js";

const state = { data: emptyData(), saved: null, revision: 0, dirty: false, imported: false, page: 0, registering: false, busy: false, backup: false, writes: 0, user: null };
const numberInput = (text) => text.trim() === "" ? null : /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text.trim()) && Number.isFinite(Number(text)) ? Number(text) : text;
const periodState = { start: null, end: null };
const recordView = { order: "newest" };
function visibleRecords() {
  if (recordView.order === "original") return state.data.chargingRecords;
  return state.data.chargingRecords.toReversed();
}

function periodControls() {
  const domain = monthDomain(state.data.chargingRecords);
  periodState.start ??= domain.start;
  periodState.end ??= domain.end;
  const min = Math.min(domain.min, periodState.start);
  const max = Math.max(domain.max, periodState.end);
  for (const field of ["start", "end"]) {
    const slider = $(`#period-${field}`);
    slider.min = min;
    slider.max = max;
    slider.value = periodState[field];
    slider.setAttribute("aria-valuetext", monthText(periodState[field]));
    $(`#period-${field}-month`).value = monthText(periodState[field]);
    $(`#period-${field}-month`).min = "1900-01";
    $(`#period-${field}-month`).max = "9998-12";
  }
  $("#month-selection").style.left = `${(periodState.start - min) / (max - min) * 100}%`;
  $("#month-selection").style.width = `${(periodState.end - periodState.start) / (max - min) * 100}%`;
  $(".month-slider").classList.toggle("same-month", periodState.start === periodState.end);
  monthTicks();
}
function monthTicks() {
  const width = $("#month-ticks").getBoundingClientRect().width;
  const min = Number($("#period-start").min);
  const max = Number($("#period-start").max);
  const count = Math.min(5, Math.max(2, Math.floor(width / 90) + 1));
  const ticks = Array.from({ length: count }, (_, index) => Math.round(min + (max - min) * index / (count - 1)));
  $("#month-ticks").replaceChildren(...ticks.map((month) => {
    const tick = document.createElement("span");
    tick.textContent = monthText(month);
    // CSS property assignment works with Pages style-src 'self'; HTML style attributes do not.
    tick.style.left = `${(month - min) / (max - min) * 100}%`;
    return tick;
  }));
}
new ResizeObserver(() => monthTicks()).observe($("#month-ticks"));
function saveStatus() {
  $("#save").disabled = state.busy || !state.dirty;
  $("#save-status").textContent = state.dirty ? "有未保存修改" : `已保存 · 累计 ${state.writes} 次写入`;
  $("#save-status").classList.toggle("error-text", state.dirty);
}
function dirty() { state.dirty = state.imported || JSON.stringify(state.data) !== state.saved; saveStatus(); }
function populate() {
  $("#battery").value = state.data.vehicle.batteryCapacityKwh ?? "";
  $("#range").value = state.data.vehicle.ratedRangeKm ?? "";
  $("#grain").value = state.data.view.grain;
  saveStatus();
  $("#restore").disabled = !state.backup;
  render();
}

function render(rebuildRecords = true) {
  periodControls();
  const result = calculate(state.data, { start: monthText(periodState.start), end: monthText(periodState.end) });
  $("#counts").textContent = `${result.count} 条日期记录 · ${result.fullCount} 次充满 · ${result.intervalCount} 个完整区间 · ${result.anomalies} 条异常`;
  $("#highlights").innerHTML = [["百公里电耗", result.full.consumption, "kWh / 100km"], ["每公里成本", result.full.costKm, "元 / km"], ["等效满电续航", result.full.range, "km · 估算"]].map(([label, value, unit]) => `<div class="highlight"><span class="muted">${label}</span><strong>${format(value)}</strong><small>${unit} · 充满区间口径</small></div>`).join("");
  const metrics = [["统计起点日期", "startDate", "日期"], ["统计终点日期", "endDate", "日期"], ["统计起点里程", "startKm", "km"], ["统计终点里程", "endKm", "km"], ["累计行驶里程", "distance", "km"], ["统计充电量", "energy", "kWh"], ["统计金额", "amount", "元"], ["百公里电耗", "consumption", "kWh/100km"], ["平均购电单价", "unitPrice", "元/kWh"], ["每公里用电成本", "costKm", "元/km"], ["百公里用电成本", "cost100", "元/100km"], ["等效满电续航", "range", "km"], ["估算里程达成率", "attainment", "%"], ["统计状态", "status", ""]];
  const metricValue = (value, field) => field.includes("Date") ? escape(dateText(value) || "—") : field === "status" ? escape(value) : field === "attainment" ? value == null ? "—" : `${format(value * 100)}%` : format(value);
  $("#metrics").innerHTML = metrics.map(([label, field, unit]) => `<tr><td>${label}</td><td>${metricValue(result.full[field], field)}</td><td>${metricValue(result.all[field], field)}</td><td class="muted">${unit}</td></tr>`).join("");
  renderRecords(result, rebuildRecords);
  $("#period-status").textContent = !result.viewValid ? "请选择有效的开始、结束月份。" : result.anomalies ? "请先修正异常记录，分期结果暂不显示。" : `${monthText(periodState.start)} 至 ${monthText(periodState.end)} · ${result.periods.length} 个期间。电耗按完整区间的结束日期归属，无完整区间时留空。`;
  $("#charts").innerHTML = [["充电量 / kWh", "purchasedEnergy"], ["支出 / 元", "purchasedAmount"], ["电耗 / kWh/100km", "consumption"], ["估算里程达成率", "attainment", true]].map(([title, field, percent]) => chart(title, result.periods, field, percent)).join("");
  $("#period-rows").innerHTML = result.periods.map((row) => `<tr><td>${escape(row.label)}</td>${["purchasedEnergy", "purchasedAmount", "intervalCount", "distance", "energy", "amount", "consumption", "costKm", "attainment", "purchasedUnitPrice"].map((field) => `<td>${field === "attainment" ? metricValue(row[field], field) : format(row[field], field === "intervalCount" ? 0 : 2)}</td>`).join("")}</tr>`).join("");
}

function renderRecords(result, rebuild = true) {
  if (!rebuild) {
    const calculated = new Map(result.rows.map((row) => [row.slot, row]));
    document.querySelectorAll("#record-rows tr").forEach((row) => {
      const output = calculated.get(Number(row.dataset.slot));
      row.querySelectorAll("[data-output]").forEach((cell) => {
        cell.textContent = cell.dataset.output === "status" ? output?.status ?? "空行" : format(output?.[cell.dataset.output]);
        if (cell.dataset.output === "status") cell.classList.toggle("error-text", output?.status !== "正常");
      });
    });
    return;
  }
  const rows = visibleRecords();
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  state.page = Math.min(state.page, pages - 1);
  const calculated = new Map(result.rows.map((row) => [row.slot, row]));
  $("#record-rows").innerHTML = rows.slice(state.page * 50, state.page * 50 + 50).map((row) => {
    const output = calculated.get(row.slot);
    const input = (field) => {
      if (field === "fullCharge") return `<select data-field="${field}" aria-label="第 ${row.slot} 条是否充满"><option value=""></option>${["是", "否"].map((value) => `<option${row[field] === value ? " selected" : ""}>${value}</option>`).join("")}${row[field] != null && !["", "是", "否"].includes(row[field]) ? `<option selected>${escape(row[field])}</option>` : ""}</select>`;
      if (field === "note") return `<textarea rows="2" data-field="note" aria-label="第 ${row.slot} 条备注">${escape(row.note)}</textarea>`;
      const date = field === "dateValue" && (row.dateValue == null || typeof row.dateValue === "number" && row.dateValue > 0 && row.dateValue < 2958466 && Math.floor(row.dateValue) !== 60);
      return `<input data-field="${field}" aria-label="第 ${row.slot} 条${labels[field]}" value="${escape(field === "dateValue" ? dateText(row[field]) : row[field])}" ${date ? 'type="date"' : ""} ${["odometerKm", "chargedKwh", "amountCny"].includes(field) ? 'inputmode="decimal"' : ""} ${field === "dateValue" ? 'placeholder="YYYY-MM-DD"' : ""}>`;
    };
    const labels = { dateValue: "日期", odometerKm: "累计里程 km", chargedKwh: "充电量 kWh", amountCny: "金额 元", fullCharge: "是否充满", note: "备注", distance: "区间里程 km", energy: "区间电量 kWh", amount: "区间金额 元", consumption: "区间电耗" };
    return `<tr data-slot="${row.slot}"><td data-label="记录序号">${row.slot}</td>${fields.map((field) => `<td data-label="${labels[field]}">${input(field)}</td>`).join("")}<td data-label="购电单价" data-output="unitPrice">${format(output?.unitPrice)}</td><td data-label="状态" data-output="status" class="${output?.status !== "正常" ? "error-text" : ""}">${escape(output?.status ?? "空行")}</td>${["distance", "energy", "amount", "consumption"].map((field) => `<td data-label="${labels[field]}" data-output="${field}">${format(output?.[field])}</td>`).join("")}<td class="record-operation"><button data-delete="${row.slot}" class="danger">删除</button></td></tr>`;
  }).join("");
  $("#page-label").textContent = `第 ${state.page + 1} / ${pages} 页 · ${rows.length} 行`;
  $("#previous").disabled = state.page === 0;
  $("#next").disabled = state.page >= pages - 1;
}

async function loadManifest(manifest) {
  const records = [];
  for (const chunk of manifest.chunks) {
    const loaded = await api(`/data/chunk?key=${encodeURIComponent(chunk.key)}`);
    if (await hashRecords(loaded.records) !== chunk.hash) throw new Error("数据校验失败，请重新加载。");
    records.push(...loaded.records);
  }
  return validateData({ ...manifest, chargingRecords: records });
}

async function load() {
  const snapshot = await api("/data");
  const data = await loadManifest(snapshot.manifest);
  state.data = data; state.revision = snapshot.revision; state.writes = snapshot.writes;
  state.saved = JSON.stringify(data);
  periodState.start = null; periodState.end = null;
  state.dirty = false; state.imported = false; state.backup = !!snapshot.backup;
  populate();
}

async function save() {
  if (state.busy || !state.dirty) return;
  state.busy = true;
  saveStatus();
  $("#workspace").inert = true;
  await (async () => {
    const data = validateData(state.data);
    const chunks = splitRecords(data.chargingRecords);
    const hashes = [];
    for (const chunk of chunks) hashes.push(await hashRecords(chunk));
    const stage = await api("/data/start", "POST", { revision: state.revision, vehicle: data.vehicle, view: data.view, hashes, imported: state.imported });
    for (const [index, missing] of stage.missing.entries()) {
      $("#save-status").textContent = `保存中 ${index + 1}/${stage.missing.length}…`;
      await api("/data/chunk", "PUT", { uploadID: stage.uploadID, index: missing, records: chunks[missing] });
    }
    const result = await api("/data/finish", "POST", { uploadID: stage.uploadID });
    state.data = data; state.revision = result.revision; state.writes = result.writes;
    state.saved = JSON.stringify(data);
    state.backup ||= state.imported; state.imported = false; state.dirty = false;
    populate(); message(result.cleanupPending ? "保存成功。旧数据清理暂未完成，下次保存会继续。" : "保存成功。");
  })().finally(() => { state.busy = false; $("#workspace").inert = false; saveStatus(); if (state.dirty) $("#save-status").textContent = "保存未完成 · 请保留本地修改"; });
}

async function enter(user) {
  state.user = user;
  await load();
  $("#identity").textContent = user.username;
  $("#auth").hidden = true; $("#workspace").hidden = false;
}

$("#login-tab").onclick = () => { state.registering = false; $("#invite-label").hidden = true; $("#invite").required = false; $("#auth-submit").textContent = "登录"; $("#login-tab").classList.add("active"); $("#register-tab").classList.remove("active"); $("#password").autocomplete = "current-password"; };
$("#register-tab").onclick = () => { state.registering = true; $("#invite-label").hidden = false; $("#invite").required = true; $("#auth-submit").textContent = "注册并登录"; $("#register-tab").classList.add("active"); $("#login-tab").classList.remove("active"); $("#password").autocomplete = "new-password"; };
$("#auth-form").onsubmit = (event) => { event.preventDefault(); action($("#auth-submit"), async () => { await api(state.registering ? "/register" : "/login", "POST", { username: $("#username").value, password: $("#password").value, invite: $("#invite").value }); $("#password").value = ""; const me = await api("/me"); await enter(me.user); }); };
document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { document.querySelectorAll(".panel").forEach((panel) => { panel.hidden = panel.id !== button.dataset.tab; }); document.querySelectorAll("[data-tab]").forEach((tab) => tab.classList.toggle("active", tab === button)); }; });
for (const [selector, section, field] of [["#battery", "vehicle", "batteryCapacityKwh"], ["#range", "vehicle", "ratedRangeKm"], ["#grain", "view", "grain"]]) {
  $(selector).oninput = (event) => { state.data[section][field] = field === "grain" ? event.target.value : numberInput(event.target.value); dirty(); };
  $(selector).onchange = () => render(false);
}
for (const field of ["start", "end"]) {
  $(`#period-${field}`).oninput = (event) => {
    dismiss();
    periodState[field] = field === "start" ? Math.min(Number(event.target.value), periodState.end) : Math.max(Number(event.target.value), periodState.start);
    render(false);
  };
  $(`#period-${field}`).onfocus = (event) => {
    $("#period-start").style.zIndex = field === "start" ? "3" : "2";
    $("#period-end").style.zIndex = field === "end" ? "3" : "2";
  };
  $(`#period-${field}-month`).onchange = (event) => {
    dismiss();
    const month = monthIndex(event.target.value);
    if (month === null) { message("月份须为 1900-01 至 9998-12。"); periodControls(); return; }
    periodState[field] = month;
    if (periodState.start > periodState.end) periodState[field === "start" ? "end" : "start"] = month;
    render(false);
  };
}
document.querySelectorAll("[data-period-preset]").forEach((button) => { button.onclick = () => {
  dismiss();
  const domain = monthDomain(state.data.chargingRecords);
  const preset = button.dataset.periodPreset;
  periodState.start = preset === "all" ? domain.start : preset === "year" ? Math.floor(domain.current / 12) * 12 : domain.current - 11;
  periodState.end = preset === "all" ? domain.end : preset === "year" ? Math.floor(domain.current / 12) * 12 + 11 : domain.current;
  render(false);
}; });
for (const event of ["click", "focusin", "mouseover"]) $("#charts").addEventListener(event, (event) => {
  const point = event.target.closest?.("[data-detail]");
  if (point) point.closest(".chart").querySelector(".chart-detail").textContent = point.dataset.detail;
});
$("#charts").addEventListener("keydown", (event) => {
  if (["Enter", " "].includes(event.key) && event.target.matches("[data-detail]")) { event.preventDefault(); event.target.closest(".chart").querySelector(".chart-detail").textContent = event.target.dataset.detail; }
});
$("#record-rows").oninput = (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const row = state.data.chargingRecords.find((item) => item.slot === Number(event.target.closest("tr").dataset.slot));
  row[field] = field === "dateValue" ? dateSerial(event.target.value) : ["note", "fullCharge"].includes(field) ? event.target.value || null : numberInput(event.target.value);
  dirty();
};
$("#record-rows").onchange = () => render(false);
$("#record-rows").onclick = (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button || !confirm("删除这条记录并将后续位置前移？")) return;
  const slot = Number(button.dataset.delete);
  state.data.chargingRecords = state.data.chargingRecords.filter((row) => row.slot !== slot).map((row) => ({ ...row, slot: row.slot > slot ? row.slot - 1 : row.slot }));
  dirty(); render();
};
$("#add-record").onclick = () => {
  dismiss();
  const slot = (state.data.chargingRecords.at(-1)?.slot ?? 0) + 1;
  state.data.chargingRecords.push(emptyRecord(slot));
  state.page = recordView.order === "newest" ? 0 : Math.floor((state.data.chargingRecords.length - 1) / 50);
  dirty(); render();
  const row = $(`#record-rows tr[data-slot="${slot}"]`);
  row.querySelector('[data-field="dateValue"]').focus({ preventScroll: true });
  row.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
};
$("#record-order").onchange = (event) => { recordView.order = event.target.value; state.page = 0; render(); };
$("#previous").onclick = () => { state.page -= 1; render(); };
$("#next").onclick = () => { state.page += 1; render(); };
$("#save").onclick = () => action($("#save"), save).finally(saveStatus);
$("#reload").onclick = () => { if (state.dirty && !confirm("重新加载会放弃未保存修改。是否继续？")) return; action($("#reload"), load); };
$("#export").onclick = () => download(`电耗数据_${new Date().toISOString().replaceAll(":", "-")}.json`, JSON.stringify({ ...state.data, schemaVersion: 2, exportedAt: new Date().toISOString() }, null, 2));
$("#import").onchange = (event) => action($("#save"), async () => { const file = event.target.files[0]; if (!file) return; const data = validateData(JSON.parse(await file.text())); if (!confirm("导入将替换当前页面的数据，保存后生效。是否继续？")) return; state.data = data; state.imported = true; state.page = 0; dirty(); populate(); message("导入已加载，请检查后保存。保存时将保留替换前备份。"); event.target.value = ""; }).finally(saveStatus);
$("#restore").onclick = () => { if (!confirm("恢复导入前备份会替换当前数据（包括未保存修改），是否继续？")) return; action($("#restore"), async () => { await api("/data/restore", "POST", { revision: state.revision }); await load(); message("已恢复备份。"); }); };
$("#logout").onclick = () => { if (state.dirty && !confirm("还有未保存修改，确定退出？")) return; action($("#logout"), async () => { await api("/logout", "POST", {}); location.reload(); }); };
window.addEventListener("beforeunload", (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
await api("/me").then(async (me) => { if (me.role === "admin") return; await enter(me.user); }).catch((error) => { if (error.status !== 401) message(error.message); });
