import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { passwordConfig } from "../worker/security.js";
import { emptyData, emptyRecord } from "../public/lib/data.js";
import { hashRecords, splitRecords } from "../public/lib/chunks.js";
import { mkdir, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "../scripts/bundle.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}/.artifact`, { recursive: true });
const persistence = await mkdtemp(`${root}/.artifact/integration-`);
const options = { modules: true, script: await bundle(`${root}/test/fixture-worker.js`), compatibilityDate: "2026-08-01", kvNamespaces: ["DATA"],
  durableObjects: { STATE: { className: "TestCoordinator", useSQLite: true } }, bindings: { SESSION_SECRET: "test-only-secret-with-at-least-thirty-two-characters" }, kvPersist: `${persistence}/kv`, durableObjectsPersist: `${persistence}/do` };
const fixture = { mf: null, stub: null, kv: null, counter: 1 };
async function initialize() {
  fixture.mf = new Miniflare(options);
  fixture.kv = await fixture.mf.getKVNamespace("DATA");
  const namespace = await fixture.mf.getDurableObjectNamespace("STATE");
  fixture.stub = namespace.get(namespace.idFromName("ev-consumption-v1"));
}

async function request(path, method = "GET", body, cookie, extra = {}) {
  const result = await fixture.stub.fetch(`http://localhost/api${path}`, { method,
    headers: { Origin: "http://localhost", "Content-Type": "application/json", "CF-Connecting-IP": `test-${fixture.counter++}`, ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await result.text();
  const value = await Promise.resolve().then(() => JSON.parse(text)).catch(() => ({ error: text }));
  return { status: result.status, body: value, cookie: result.headers.get("Set-Cookie")?.split(";")[0] };
}

async function save(cookie, records, revision, imported = false) {
  const chunks = splitRecords(records);
  const hashes = await Promise.all(chunks.map(hashRecords));
  const start = await request("/data/start", "POST", { revision, vehicle: { batteryCapacityKwh: 60, ratedRangeKm: 500 }, view: { grain: "月度", year: 2025 }, hashes, imported }, cookie);
  assert.equal(start.status, 200, JSON.stringify(start.body));
  for (const index of start.body.missing) {
    const result = await request("/data/chunk", "PUT", { uploadID: start.body.uploadID, index, records: chunks[index] }, cookie);
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  const end = await request("/data/finish", "POST", { uploadID: start.body.uploadID }, cookie);
  assert.equal(end.status, 200, JSON.stringify(end.body));
  return { ...end.body, uploadID: start.body.uploadID, missing: start.body.missing };
}

test("Cloudflare 本地 KV / SQLite Durable Objects 集成", async (t) => {
  t.after(async () => fixture.mf?.dispose());
  await initialize();
  await t.test("真实 Worker 环境执行线上加密限制兼容路径", async () => {
    const result = await request("/test/crypto-limit");
    assert.equal(result.status, 200);
    assert.equal(result.body.hash, (await passwordConfig("compatibility-test-password", "AAAAAAAAAAAAAAAAAAAAAA")).hash);
    assert.ok(result.body.elapsedMs < 30000, "密码计算须在 DO 默认执行预算内完成");
  });
  await fixture.kv.put("config:admin", JSON.stringify(await passwordConfig("admin-password-123456")));
  const adminLogin = await request("/admin/login", "POST", { password: "admin-password-123456" });
  assert.equal(adminLogin.status, 200);
  const admin = adminLogin.cookie;
  const generated = await request("/admin/invites", "POST", { count: 3, batch: crypto.randomUUID() }, admin);
  assert.equal(generated.status, 200);
  const codes = generated.body.codes;
  const credentials = { username: "测试用户", password: "user-password-123456", invite: codes[0] };
  const sessions = {};

  await t.test("无邀请码、错误邀请码、错误密码与未登录访问", async () => {
    assert.equal((await request("/data")).status, 401);
    const bad = await request("/register", "POST", { ...credentials, invite: "wrong" });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, "邀请码已失效。");
    assert.equal((await request("/admin/login", "POST", { password: "incorrect-password" })).status, 401);
    assert.equal((await request("/admin/invites", "POST", { count: 1, batch: crypto.randomUUID() }, null, { Origin: "https://evil.example" })).status, 403);
  });

  await t.test("邀请码并发注册只有一个成功，用过即失效", async () => {
    const results = await Promise.all([request("/register", "POST", credentials), request("/register", "POST", { ...credentials, username: "其他用户" })]);
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 400]);
    sessions.user = results.find((item) => item.status === 200).cookie;
    const repeat = await request("/register", "POST", { ...credentials, username: "新用户" });
    assert.equal(repeat.body.error, "邀请码已失效。");
    const user = await request("/me", "GET", undefined, sessions.user);
    sessions.id = user.body.user.id;
    assert.equal(user.body.user.writes, 1);
    assert.equal((await request("/admin/invites", "GET", undefined, sessions.user)).status, 404);
  });

  await t.test("批次幂等、用户名唯一及独立用户", async () => {
    const batch = crypto.randomUUID();
    const a = await request("/admin/invites", "POST", { count: 1, batch }, admin);
    const b = await request("/admin/invites", "POST", { count: 1, batch }, admin);
    assert.deepEqual(a.body.codes, b.body.codes);
    const duplicate = await request("/register", "POST", { ...credentials, invite: codes[1] });
    assert.equal(duplicate.status, 409);
    const second = await request("/register", "POST", { ...credentials, username: "second-user", invite: codes[1] });
    assert.equal(second.status, 200); sessions.second = second.cookie;
  });

  const records = Array.from({ length: 1100 }, (_, index) => ({ ...emptyRecord(index + 1), dateValue: 45000 + index, odometerKm: index * 100, chargedKwh: 20, amountCny: 0, fullCharge: index % 3 ? "否" : "是", note: index === 0 ? '<script>\n"中文"' : null }));
  await t.test("1100 条分块保存、成功写入计数、幂等与跨用户隔离", async () => {
    const saved = await save(sessions.user, records, 0);
    assert.equal(saved.writes, 7); // account + five chunks + one KV manifest
    assert.equal(saved.revision, 1);
    const again = await request("/data/finish", "POST", { uploadID: saved.uploadID }, sessions.user);
    assert.equal(again.body.writes, 7);
    const snapshot = await request("/data", "GET", undefined, sessions.user);
    assert.equal(snapshot.body.manifest.chunks.length, 5);
    const key = snapshot.body.manifest.chunks[0].key;
    const stored = await request(`/data/chunk?key=${encodeURIComponent(key)}`, "GET", undefined, sessions.user);
    assert.deepEqual(stored.body.records, records.slice(0, 256));
    assert.equal((await request(`/data/chunk?key=${encodeURIComponent(key)}`, "GET", undefined, sessions.second)).status, 403);
    assert.equal((await request("/data", "GET", undefined, sessions.second)).body.manifest.chunks.length, 0);
    assert.equal((await save(sessions.user, records, 1)).missing.length, 0);
    assert.equal((await request("/me", "GET", undefined, sessions.user)).body.user.writes, 8);
  });

  await t.test("旧版本拒绝覆盖，KV 写入故障和半途上传不替换旧数据", async () => {
    const stale = await request("/data/start", "POST", { revision: 0, hashes: [], ...emptyData() }, sessions.user);
    assert.equal(stale.status, 409);
    const next = [{ ...records[0], chargedKwh: 44 }];
    const stage = await request("/data/start", "POST", { revision: 2, vehicle: emptyData().vehicle, view: emptyData().view, hashes: [await hashRecords(next)] }, sessions.user);
    const fault = await request("/data/chunk", "PUT", { uploadID: stage.body.uploadID, index: 0, records: next }, sessions.user, { "X-Test-Fault": "quota" });
    assert.equal(fault.status, 503);
    const snapshot = await request("/data", "GET", undefined, sessions.user);
    assert.equal(snapshot.body.revision, 2);
    assert.equal(snapshot.body.writes, 8);
    assert.equal((await request("/data/finish", "POST", { uploadID: stage.body.uploadID }, sessions.user)).status, 400);
    const retried = await request("/data/chunk", "PUT", { uploadID: stage.body.uploadID, index: 0, records: next }, sessions.user);
    assert.equal(retried.status, 200);
    assert.equal(retried.body.writes, 9);
    assert.equal((await request("/data", "GET", undefined, sessions.user)).body.revision, 2);
  });

  await t.test("导入前备份和恢复", async () => {
    const saved = await save(sessions.user, [records[0]], 2, true);
    const snapshot = await request("/data", "GET", undefined, sessions.user);
    assert.equal(snapshot.body.backup.chunks.length, 5);
    const restored = await request("/data/restore", "POST", { revision: saved.revision }, sessions.user);
    assert.equal(restored.status, 200);
    assert.equal((await request("/data", "GET", undefined, sessions.user)).body.manifest.chunks.length, 5);
  });

  await t.test("KV 暂时不可见返回同步错误，不能当成空数据", async () => {
    const snapshot = await request("/data", "GET", undefined, sessions.user);
    const key = snapshot.body.manifest.chunks[0].key;
    const stale = await request(`/data/chunk?key=${encodeURIComponent(key)}`, "GET", undefined, sessions.user, { "X-Test-Fault": "stale" });
    assert.equal(stale.status, 503);
    assert.match(stale.body.error, /同步/);
  });

  await t.test("重启后仍记得邀请码消耗、用户数据和计数", async () => {
    const previous = await request("/me", "GET", undefined, sessions.user);
    await fixture.mf.dispose(); await initialize();
    assert.equal((await request("/me", "GET", undefined, sessions.user)).body.user.writes, previous.body.user.writes);
    assert.equal((await request("/register", "POST", { ...credentials, username: "restart-user" })).body.error, "邀请码已失效。");
    assert.equal((await request("/data", "GET", undefined, sessions.user)).body.manifest.chunks.length, 5);
  });

  await t.test("删除先停用会话，故障可重试，清除全部 KV 数据且邀请码不复活", async () => {
    const first = await request("/admin/user", "DELETE", { id: sessions.id }, admin, { "X-Test-Fault": "delete" });
    assert.equal(first.status, 503);
    assert.equal((await request("/me", "GET", undefined, sessions.user)).status, 401);
    const deleted = await request("/admin/user", "DELETE", { id: sessions.id }, admin);
    assert.equal(deleted.body.done, true);
    const keys = await fixture.kv.list({ prefix: `user:${sessions.id}:` });
    assert.equal(keys.keys.length, 0);
    const invites = await request("/admin/invites", "GET", undefined, admin);
    assert.equal(invites.body.rows.find((row) => row.code === codes[0]).status, "用户已删除");
    assert.equal((await request("/register", "POST", { ...credentials, username: "deleted-retry" })).body.error, "邀请码已失效。");
  });

  await t.test("6000 条记录跨批删除，先停用后逐批完成", async () => {
    const large = Array.from({ length: 6000 }, (_, index) => ({ ...records[0], slot: index + 1, dateValue: 45000 + index, odometerKm: index * 100 }));
    await save(sessions.second, large, 0);
    const me = await request("/me", "GET", undefined, sessions.second);
    const id = me.body.user.id;
    const first = await request("/admin/user", "DELETE", { id }, admin);
    assert.equal(first.status, 200); assert.equal(first.body.done, false);
    assert.equal((await request("/data", "GET", undefined, sessions.second)).status, 401);
    assert.equal((await request("/admin/user", "DELETE", { id }, admin)).body.done, true);
    assert.equal((await fixture.kv.list({ prefix: `user:${id}:` })).keys.length, 0);
  });
});
