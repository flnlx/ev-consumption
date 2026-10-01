import { cp, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await writeFile("dist/_routes.json", JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }));
console.log("网页已输出到 dist；Pages 只对 /api/* 调用 Functions。");
