export async function onRequest(context) {
  if (context.env.CF_PAGES_BRANCH && context.env.CF_PAGES_BRANCH !== "dev") return Response.json({ error: "预览分支未启用数据接口，以保护正式数据。" }, { status: 403 });
  if (!context.env.STATE) return Response.json({ error: "尚未配置后台服务绑定，请按 README 完成部署。" }, { status: 503 });
  return context.env.STATE.get(context.env.STATE.idFromName("ev-consumption-v1")).fetch(context.request);
}
