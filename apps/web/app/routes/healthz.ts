import { getWebRuntime } from "../services/runtime.server.js";

export async function loader() {
  try {
    const { client } = await getWebRuntime();
    await client.$queryRawUnsafe("SELECT 1");
    return Response.json({ ok: true, service: "web" });
  } catch {
    return Response.json({ ok: false, service: "web" }, { status: 503 });
  }
}
