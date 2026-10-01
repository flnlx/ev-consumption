import { DurableObject } from "cloudflare:workers";
import { CoordinatorService } from "../worker/service.js";

export class TestCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.fault = null;
    this.service = new CoordinatorService(ctx.storage, { ...env, DATA: {
      get: (key, type) => this.fault === "stale" && key.includes(":chunk:") ? Promise.resolve(null) : env.DATA.get(key, type),
      put: (key, value) => {
        if (this.fault === "quota" && key.includes(":chunk:")) { this.fault = null; return Promise.reject(new Error("Injected KV quota")); }
        return env.DATA.put(key, value);
      },
      delete: (key) => {
        if (this.fault === "delete") { this.fault = null; return Promise.reject(new Error("Injected delete failure")); }
        return env.DATA.delete(key);
      },
    } });
  }
  fetch(request) {
    this.fault = request.headers.get("X-Test-Fault");
    if (this.fault === "stale") this.service.cache.clear();
    return this.service.fetch(request);
  }
}
export default { fetch: () => new Response("Not found", { status: 404 }) };
