import { build } from "esbuild";

export async function bundle(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:workers"] });
  return result.outputFiles[0].text;
}
