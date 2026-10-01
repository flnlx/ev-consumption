import { emptyData, validateData } from "../public/lib/data.js";
import { base64, digest, passwordConfig, verifyPassword, signSession, readSession } from "./security.js";

const encoder = new TextEncoder();
const response = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const publicUser = (user) => ({ id: user.id, username: user.username, writes: user.writes, deleting: user.deleting ?? false });

export class CoordinatorService {
  constructor(storage, env) {
    this.storage = storage;
    this.env = env;
    this.tail = Promise.resolve();
    this.cache = new Map();
  }

  fetch(request) {
    // Serialize across awaits, including KV writes. DO storage is authoritative for admission and revisions.
    const task = this.tail.then(() => this.handle(request));
    this.tail = task.catch(() => {});
    return task.catch((error) => {
      if (error.status) return response({ error: error.message }, error.status);
      console.error("Request failed", error.name);
      return response({ error: "后台暂时不可用，可能是免费额度耗尽或配置未完成。请稍后重试；本次修改请先导出备份。" }, 503);
    });
  }

  async handle(request) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) fail("不支持的操作。", 405);
    if (request.method !== "GET" && (request.headers.get("Origin") !== url.origin || request.headers.get("Content-Type")?.split(";")[0] !== "application/json")) fail("请求来源无效。", 403);
    const body = request.method === "GET" ? null : await this.body(request);
    if (route === "POST /api/logout") return response({ ok: true }, 200, { "Set-Cookie": this.cookie(request, "", 0) });
    if (route === "POST /api/register") return this.register(request, body);
    if (route === "POST /api/login" || route === "POST /api/admin/login") return this.login(request, body, route.includes("admin"));
    const session = await readSession(request.headers.get("Cookie")?.match(/(?:^|;\s*)ev_session=([^;]+)/)?.[1], this.env.SESSION_SECRET);
    if (!session) fail("请先登录。", 401);
    if (session.role === "admin") {
      const config = await this.env.DATA.get("config:admin", "json");
      if (!config || session.config !== await digest(JSON.stringify(config))) fail("管理员配置已改变，请重新登录。", 401);
      if (route === "GET /api/me") return response({ role: "admin" });
      if (route === "POST /api/admin/invites") return this.createInvites(body);
      if (route === "GET /api/admin/invites") return this.listInvites(url);
      if (route === "DELETE /api/admin/user") return this.deleteUser(body);
      fail("没有此操作。", 404);
    }
    const user = await this.storage.get(`user:${session.uid}`);
    if (!user || user.pending || user.deleting) fail("账户已被删除或停用。", 401);
    if (route === "GET /api/me") return response({ role: "user", user: publicUser(user) });
    if (route === "GET /api/data") return response({ manifest: user.manifest, revision: user.revision, writes: user.writes, backup: user.backup ?? null });
    if (route === "GET /api/data/chunk") {
      const key = url.searchParams.get("key");
      if (![...user.manifest.chunks, ...(user.backup?.chunks ?? [])].some((chunk) => chunk.key === key)) fail("无权读取此数据。", 403);
      return response({ records: await this.readChunk(key) });
    }
    if (route === "POST /api/data/start") return this.startSave(user, body);
    if (route === "PUT /api/data/chunk") return this.writeChunk(user, body);
    if (route === "POST /api/data/finish") return this.finishSave(user, body);
    if (route === "POST /api/data/restore") {
      if (body.revision !== user.revision) fail("数据已被其他窗口更新，请先重新加载。", 409);
      if (!user.backup) fail("暂无导入前备份。");
      const previous = user.manifest;
      user.manifest = user.backup;
      user.backup = previous;
      user.revision += 1;
      await this.storage.put(`user:${user.id}`, user);
      return response({ revision: user.revision, writes: user.writes });
    }
    fail("没有此操作。", 404);
  }

  async body(request) {
    // A transport limit, not a record limit: records are uploaded in independent chunks.
    const reader = request.body?.getReader();
    if (!reader) fail("缺少请求内容。");
    const pieces = [];
    const size = { value: 0 };
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size.value += item.value.byteLength;
      if (size.value > 2 * 1024 * 1024) { await reader.cancel(); fail("单次请求过大，请使用分块保存。", 413); }
      pieces.push(item.value);
    }
    const bytes = new Uint8Array(size.value);
    const position = { value: 0 };
    for (const piece of pieces) { bytes.set(piece, position.value); position.value += piece.byteLength; }
    const parsed = await Promise.resolve().then(() => JSON.parse(new TextDecoder().decode(bytes))).catch(() => fail("请求不是有效 JSON。"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("请求内容无效。");
    return parsed;
  }

  cookie(request, token, age = 86400) {
    return `ev_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  }

  async sessionResponse(request, payload) {
    return response({ ok: true, role: payload.role }, 200, { "Set-Cookie": this.cookie(request, await signSession({ ...payload, exp: Date.now() + 86400000 }, this.env.SESSION_SECRET)) });
  }

  credentials(body) {
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) fail("密码须为 12 至 128 字符。");
    if (typeof body.username !== "string" || !/^[\p{L}\p{N}_-]{2,32}$/u.test(body.username.normalize("NFKC"))) fail("用户名须为 2 至 32 个文字、数字、下划线或短横线。");
    return body.username.normalize("NFKC").toLowerCase();
  }

  async rateLimit(request) {
    const key = `rate:${await digest(request.headers.get("CF-Connecting-IP") ?? "local")}`;
    const rate = await this.storage.get(key);
    if (rate && rate.until > Date.now() && rate.attempts >= 10) fail("尝试次数过多，请 15 分钟后重试。", 429);
    await this.storage.put(key, { until: rate?.until > Date.now() ? rate.until : Date.now() + 900000, attempts: rate?.until > Date.now() ? rate.attempts + 1 : 1 });
  }

  async register(request, body) {
    await this.rateLimit(request);
    const username = this.credentials(body);
    if (typeof body.invite !== "string" || !/^[A-F0-9]{32}$/.test(body.invite.trim().toUpperCase())) fail("邀请码已失效。", 400);
    const code = body.invite.trim().toUpperCase();
    const invite = await this.storage.get(`invite:${code}`);
    if (invite?.used) fail("邀请码已失效。");
    const config = await this.env.DATA.get(`invite:${code}`, "json");
    if (!config || config.enabled !== true || (config.expiresAt && config.expiresAt <= Date.now())) fail("邀请码已失效。");
    const existingID = await this.storage.get(`name:${username}`);
    const pending = invite?.reserved ? await this.storage.get(`user:${invite.uid}`) : null;
    if (pending && (pending.username !== username || !await verifyPassword(body.password, pending.credential))) fail("邀请码已失效。");
    if (existingID && existingID !== pending?.id) fail("用户名已存在。", 409);
    const user = pending ?? { id: crypto.randomUUID(), username, credential: await passwordConfig(body.password), code, writes: 0, revision: 0,
      pending: true, manifest: { ...emptyData(), chargingRecords: undefined, chunks: [] }, createdAt: Date.now() };
    // Validate signing configuration before admitting a registration.
    const signed = await this.sessionResponse(request, { role: "user", uid: user.id });
    await this.storage.transaction(async (tx) => {
      await tx.put(`user:${user.id}`, user);
      await tx.put(`name:${username}`, user.id);
      await tx.put(`invite:${code}`, { code, reserved: true, uid: user.id, username, createdAt: invite?.createdAt ?? Date.now() });
    });
    // Journal an allocated key before writing, so interrupted registration can be cleaned up.
    await this.storage.put(`key:${user.id}:account`, { key: `user:${user.id}:account`, status: "pending" });
    await this.env.DATA.put(`user:${user.id}:account`, JSON.stringify({ username, credential: user.credential, createdAt: user.createdAt }));
    user.writes = 1;
    user.pending = false;
    await this.storage.transaction(async (tx) => {
      await tx.put(`key:${user.id}:account`, { key: `user:${user.id}:account`, status: "confirmed" });
      await tx.put(`user:${user.id}`, user);
      await tx.put(`name:${username}`, user.id);
      await tx.put(`invite:${code}`, { code, used: true, uid: user.id, username, createdAt: invite?.createdAt ?? Date.now(), usedAt: Date.now() });
    });
    return signed;
  }

  async login(request, body, admin) {
    await this.rateLimit(request);
    if (typeof body.password !== "string" || body.password.length > 128) fail("账号或密码错误。", 401);
    if (admin) {
      const config = await this.env.DATA.get("config:admin", "json");
      if (!config) fail("管理员密码尚未在 KV 配置。", 503);
      if (!await verifyPassword(body.password, config)) fail("密码错误。", 401);
      return this.sessionResponse(request, { role: "admin", config: await digest(JSON.stringify(config)) });
    }
    const username = typeof body.username === "string" ? body.username.normalize("NFKC").toLowerCase() : "";
    const id = await this.storage.get(`name:${username}`);
    const user = id ? await this.storage.get(`user:${id}`) : null;
    const dummy = { algorithm: "PBKDF2-SHA256", iterations: 600000, salt: "AAAAAAAAAAAAAAAAAAAAAA", hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
    const valid = await verifyPassword(body.password, user?.credential ?? dummy);
    if (!user || user.pending || user.deleting || !valid) fail("账号或密码错误。", 401);
    return this.sessionResponse(request, { role: "user", uid: user.id });
  }

  async createInvites(body) {
    if (!Number.isInteger(body.count) || body.count < 1 || body.count > 20) fail("单批生成数量须为 1 至 20；页面会自动分批处理 N。");
    if (typeof body.batch !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(body.batch)) fail("批次标识无效。");
    const previous = await this.storage.get(`batch:${body.batch}`);
    if (previous && previous.count !== body.count) fail("批次参数冲突。", 409);
    const batch = previous ?? { count: body.count, codes: Array.from({ length: body.count }, () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase()), done: [] };
    await this.storage.put(`batch:${body.batch}`, batch);
    for (const code of batch.codes) {
      if (batch.done.includes(code)) continue;
      await this.env.DATA.put(`invite:${code}`, JSON.stringify({ enabled: true, expiresAt: null }));
      await this.storage.put(`invite:${code}`, { code, used: false, createdAt: Date.now() });
      batch.done.push(code);
      await this.storage.put(`batch:${body.batch}`, batch);
    }
    return response({ codes: batch.codes });
  }

  async listInvites(url) {
    const start = url.searchParams.get("cursor");
    if (start && !/^[A-F0-9]{32}$/.test(start)) fail("翻页标识无效。");
    const entries = await this.storage.list({ prefix: "invite:", limit: 101, ...(start ? { startAfter: `invite:${start}` } : {}) });
    const values = Array.from(entries.values());
    const rows = [];
    for (const invite of values.slice(0, 100)) {
      const user = invite.uid ? await this.storage.get(`user:${invite.uid}`) : null;
      rows.push({ ...invite, user: user ? publicUser(user) : null, status: invite.deleted ? "用户已删除" : invite.used ? "已使用（失效）" : invite.reserved ? "注册待完成" : "未使用" });
    }
    return response({ rows, cursor: values.length > 100 ? rows.at(-1).code : null });
  }

  async readChunk(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const value = await this.env.DATA.get(key, "json");
    // Never substitute an empty dataset when KV propagation has not completed.
    if (!Array.isArray(value)) fail("数据正在同步，请稍后重新加载。", 503);
    this.cache.set(key, value);
    if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  async startSave(user, body) {
    if (body.revision !== user.revision) fail("数据已被其他窗口更新，请先导出本地修改，再重新加载。", 409);
    const checked = validateData({ ...emptyData(), vehicle: body.vehicle, view: body.view, chargingRecords: [] });
    if (!Array.isArray(body.hashes) || body.hashes.some((hash) => typeof hash !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(hash))) fail("分块索引无效。");
    const reusable = new Map(user.manifest.chunks.map((chunk) => [chunk.hash, chunk]));
    const stage = { id: crypto.randomUUID(), revision: user.revision, expires: Date.now() + 3600000, imported: body.imported === true,
      vehicle: checked.vehicle, view: checked.view, hashes: body.hashes, chunks: body.hashes.map((hash) => reusable.get(hash) ?? null) };
    await this.storage.put(`stage:${user.id}`, stage);
    return response({ uploadID: stage.id, missing: stage.chunks.flatMap((chunk, index) => chunk ? [] : [index]) });
  }

  async stage(user, body) {
    const stage = await this.storage.get(`stage:${user.id}`);
    if (!stage || stage.id !== body.uploadID || stage.expires < Date.now()) fail("保存任务已过期或被另一个窗口替换，请重新保存。", 409);
    if (stage.revision !== user.revision) fail("数据已被其他窗口更新，请重新加载。", 409);
    return stage;
  }

  async writeChunk(user, body) {
    const stage = await this.stage(user, body);
    if (!Number.isInteger(body.index) || body.index < 0 || body.index >= stage.hashes.length) fail("分块位置无效。");
    const checked = validateData({ ...emptyData(), chargingRecords: body.records }).chargingRecords;
    if (!checked.length) fail("分块不能为空。");
    const serialized = JSON.stringify(checked);
    if (encoder.encode(serialized).byteLength > 128 * 1024) fail("分块过大。", 413);
    const hash = await digest(serialized);
    if (hash !== stage.hashes[body.index]) fail("分块内容与索引不一致。");
    if (stage.chunks[body.index]) return response({ ok: true, writes: user.writes });
    const key = `user:${user.id}:chunk:${crypto.randomUUID()}`;
    await this.storage.put(`key:${user.id}:${key}`, { key, status: "pending" });
    await this.env.DATA.put(key, serialized);
    user.writes += 1;
    stage.chunks[body.index] = { key, hash, first: checked[0].slot, last: checked.at(-1).slot, count: checked.length };
    await this.storage.transaction(async (tx) => {
      await tx.put(`user:${user.id}`, user);
      await tx.put(`stage:${user.id}`, stage);
      await tx.put(`key:${user.id}:${key}`, { key, status: "confirmed" });
    });
    this.cache.set(key, checked);
    if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value);
    return response({ ok: true, writes: user.writes });
  }

  async finishSave(user, body) {
    if (body.uploadID === user.lastUpload) return response({ revision: user.revision, writes: user.writes });
    const stage = await this.stage(user, body);
    if (stage.chunks.some((chunk) => !chunk)) fail("数据尚未上传完整。");
    if (stage.chunks.some((chunk, index) => index > 0 && chunk.first <= stage.chunks[index - 1].last)) fail("跨分块的记录位置重复或顺序错误。");
    if (stage.imported) user.backup = user.manifest;
    user.manifest = { ...emptyData(), chargingRecords: undefined, vehicle: stage.vehicle, view: stage.view, chunks: stage.chunks };
    const key = `user:${user.id}:manifest:${crypto.randomUUID()}`;
    await this.storage.put(`key:${user.id}:${key}`, { key, status: "pending" });
    await this.env.DATA.put(key, JSON.stringify(user.manifest));
    user.writes += 1;
    user.manifest.key = key;
    user.revision += 1;
    user.lastUpload = stage.id;
    await this.storage.transaction(async (tx) => {
      await tx.put(`user:${user.id}`, user);
      await tx.put(`key:${user.id}:${key}`, { key, status: "confirmed" });
      await tx.delete(`stage:${user.id}`);
    });
    const cleanupPending = await this.collect(user).then(() => false).catch(() => true);
    return response({ revision: user.revision, writes: user.writes, cleanupPending });
  }

  async collect(user) {
    const keep = new Set([`user:${user.id}:account`, user.manifest.key, user.backup?.key, ...user.manifest.chunks.map((chunk) => chunk.key), ...(user.backup?.chunks ?? []).map((chunk) => chunk.key)]);
    const entries = await this.storage.list({ prefix: `key:${user.id}:`, limit: 100, ...(user.gcCursor ? { startAfter: user.gcCursor } : {}) });
    const removed = { count: 0 };
    for (const [entry, item] of entries) {
      user.gcCursor = entry;
      if (!keep.has(item.key)) {
        await this.env.DATA.delete(item.key);
        await this.storage.delete(entry);
        this.cache.delete(item.key);
        removed.count += 1;
      }
      if (removed.count >= 10) break;
    }
    if (entries.size < 100 && removed.count < 10) user.gcCursor = null;
    await this.storage.put(`user:${user.id}`, user);
  }

  async deleteUser(body) {
    if (typeof body.id !== "string") fail("用户标识无效。");
    const user = await this.storage.get(`user:${body.id}`);
    if (!user) return response({ done: true });
    // Revoke first, then clean in bounded batches. Retrying cannot reactivate the invitation.
    user.deleting = true;
    await this.storage.put(`user:${user.id}`, user);
    const keys = await this.storage.list({ prefix: `key:${user.id}:`, limit: 20 });
    for (const [entry, item] of keys) {
      await this.env.DATA.delete(item.key);
      this.cache.delete(item.key);
      await this.storage.delete(entry);
    }
    const remaining = await this.storage.list({ prefix: `key:${user.id}:`, limit: 1 });
    if (remaining.size) return response({ done: false });
    const invite = await this.storage.get(`invite:${user.code}`);
    await this.storage.transaction(async (tx) => {
      await tx.put(`invite:${user.code}`, { ...invite, deleted: true, deletedAt: Date.now(), writes: user.writes });
      await tx.delete(`user:${user.id}`);
      await tx.delete(`name:${user.username}`);
      await tx.delete(`stage:${user.id}`);
    });
    return response({ done: true });
  }
}
