import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { passwordConfig } from "../worker/security.js";

if (!process.stdin.isTTY) throw new Error("请在交互终端运行 npm run admin:config。");
console.log("设置管理员密码（至少 12 字符）。输入不显示，也不写入命令历史。");
process.stdin.setRawMode(true);
process.stdin.resume();
const password = await new Promise((resolve) => {
  const characters = [];
  const onData = (buffer) => {
    for (const char of buffer.toString()) {
      if (char === "\u0003") process.exit(130);
      if (char === "\r" || char === "\n") {
        process.stdin.off("data", onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(characters.join(""));
        return;
      }
      if (char === "\u007f" || char === "\b") { characters.pop(); continue; }
      characters.push(char);
    }
  };
  process.stdin.on("data", onData);
});
if (password.length < 12 || password.length > 128) throw new Error("密码须为 12 至 128 字符。");
await writeFile("admin-config.json", JSON.stringify(await passwordConfig(password), null, 2), { mode: 0o600 });
const terminal = createInterface({ input: process.stdin, output: process.stdout });
terminal.close();
console.log("\n已生成 admin-config.json。将内容放到 KV 的 config:admin 键；不要提交此文件。");
