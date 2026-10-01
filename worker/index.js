import { DurableObject } from "cloudflare:workers";
import { CoordinatorService } from "./service.js";

export class Coordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.service = new CoordinatorService(ctx.storage, env);
  }
  fetch(request) { return this.service.fetch(request); }
}

// Production has no public Worker route; Pages calls the bound Durable Object directly.
export default { fetch: () => new Response("Not found", { status: 404 }) };
