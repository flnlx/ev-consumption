import test from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { base64, unbase64, derivePassword, iterations, signSession } from "../worker/security.js";

test("线上 PBKDF2 不支持高迭代时仍保留现有密码哈希", async () => {
  const salt = "AAAAAAAAAAAAAAAAAAAAAA";
  const password = '测试密码:IE;E"*.123456';
  const result = await derivePassword(password, salt, {
    importKey: (...args) => crypto.subtle.importKey(...args),
    deriveBits: async () => { throw new DOMException("Iteration limit", "NotSupportedError"); },
  });
  assert.equal(base64(result), base64(pbkdf2Sync(password, unbase64(salt), iterations, 32, "sha256")));
});

test("其他加密故障不会被兼容实现掩盖", async () => {
  await assert.rejects(derivePassword("test-password", "AAAAAAAAAAAAAAAAAAAAAA", {
    importKey: (...args) => crypto.subtle.importKey(...args),
    deriveBits: async () => { throw new DOMException("Operation failed", "OperationError"); },
  }), { name: "OperationError" });
});

test("过短会话密钥返回明确配置错误", async () => {
  await assert.rejects(signSession({ role: "admin" }, "short-secret"), { status: 503, message: "尚未配置至少 32 字符的 SESSION_SECRET。" });
});
