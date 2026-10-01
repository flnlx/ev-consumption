import { $, escape, api, action, message, download } from "./lib/ui.js";

const state = { cursor: null, codes: [], pendingBatch: null };
async function list(append = false) {
  const result = await api(`/admin/invites${append && state.cursor ? `?cursor=${state.cursor}` : ""}`);
  if (!append) $("#invites").replaceChildren();
  $("#invites").insertAdjacentHTML("beforeend", result.rows.map((row) => `<tr><td><code>${escape(row.code)}</code></td><td>${escape(row.user?.deleting ? "删除中 · 可重试" : row.status)}</td><td>${escape(row.username ?? "—")}</td><td>${row.user?.writes ?? row.writes ?? "—"}</td><td>${row.user ? `<button class="danger" data-delete="${escape(row.user.id)}" data-name="${escape(row.username)}">${row.user.deleting ? "继续删除" : "删除用户"}</button>` : "—"}</td></tr>`).join(""));
  state.cursor = result.cursor; $("#more-invites").hidden = !state.cursor;
}
async function enter() { await list(); $("#admin-auth").hidden = true; $("#admin-workspace").hidden = false; }
$("#admin-login").onsubmit = (event) => { event.preventDefault(); action(event.submitter, async () => { await api("/admin/login", "POST", { password: $("#admin-password").value }); $("#admin-password").value = ""; await enter(); }); };
$("#generate").onsubmit = (event) => {
  event.preventDefault();
  action(event.submitter, async () => {
    const count = Number($("#invite-count").value);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("N 须为正整数。");
    if (!state.pendingBatch) { state.pendingBatch = { count, remaining: count, batch: null }; state.codes = []; }
    if (state.pendingBatch.count !== count) throw new Error("上次生成尚未完成，请先使用原数量重试。");
    $("#invite-count").disabled = true;
    await (async () => {
      while (state.pendingBatch.remaining > 0) {
        state.pendingBatch.batch ??= { id: crypto.randomUUID(), count: Math.min(20, state.pendingBatch.remaining) };
        const batch = state.pendingBatch.batch;
        const result = await api("/admin/invites", "POST", { count: batch.count, batch: batch.id });
        state.codes.push(...result.codes);
        state.pendingBatch.remaining -= batch.count; state.pendingBatch.batch = null;
        $("#generated").value = state.codes.join("\n");
        $("#generation-status").textContent = `已生成 ${state.codes.length} / ${count} 个`;
      }
      state.pendingBatch = null; await list(); message(`已生成 ${count} 个邀请码。`);
    })().finally(() => { $("#invite-count").disabled = false; });
  });
};
$("#download-invites").onclick = () => { if (!state.codes.length) { message("请先生成邀请码。"); return; } download(`邀请码_${Date.now()}.txt`, state.codes.join("\n"), "text/plain;charset=utf-8"); };
$("#refresh-invites").onclick = () => action($("#refresh-invites"), () => list());
$("#more-invites").onclick = () => action($("#more-invites"), () => list(true));
$("#invites").onclick = (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button || !confirm(`删除用户“${button.dataset.name}”及其全部数据？删除后原邀请码仍然失效，此操作不可恢复。`)) return;
  action(button, async () => {
    const progress = { done: false };
    while (!progress.done) { const result = await api("/admin/user", "DELETE", { id: button.dataset.delete }); progress.done = result.done; }
    await list(); message("用户和数据已删除，原邀请码继续保持失效。");
  });
};
$("#admin-logout").onclick = () => action($("#admin-logout"), async () => { await api("/logout", "POST", {}); location.reload(); });
await api("/me").then(async (me) => { if (me.role === "admin") await enter(); }).catch((error) => { if (error.status !== 401) message(error.message); });
