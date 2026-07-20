import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { Sparkline } from "../components/sparkline.js";
import { getWebRuntime } from "../services/runtime.server.js";
import { allowStatusRequest } from "../services/status-rate-limit.server.js";
import { statusPageService, type PublicStatusPageData } from "../services/status-page.server.js";

export const meta: MetaFunction = () => [
  { title: "Checkout status" },
  { name: "robots", content: "index,follow" },
  { name: "description", content: "Live checkout availability verified by CheckoutWatch." },
];

export async function loader({ params, request }: LoaderFunctionArgs) {
  const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowStatusRequest(clientAddress))
    throw new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": "60", "X-Robots-Tag": "noindex" },
    });
  const slug = params.slug;
  if (!slug)
    throw new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
  const runtime = await getWebRuntime();
  const data = await statusPageService(runtime.client).getPublicPage(slug);
  if (!data)
    throw new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "public, max-age=60", "X-Robots-Tag": "noindex" },
    });
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=60" },
  });
}

export function StatusPageView({ data }: { data: PublicStatusPageData }) {
  const incident = data.state === "incident";
  return (
    <main className="cw-status">
      <style>{styles}</style>
      <header>
        <p className="brand">CHECKOUTWATCH</p>
        <h1>{data.title}</h1>
        <p className={`banner ${incident ? "incident" : "operational"}`}>
          <span aria-hidden="true" />
          {incident ? "Checkout incident detected" : "All monitored checkouts operational"}
        </p>
      </header>
      <section aria-labelledby="availability-heading">
        <h2 id="availability-heading">90-day availability</h2>
        {data.monitors.length === 0 ? <p>No monitors are published yet.</p> : null}
        {data.monitors.map((monitor) => (
          <article className="monitor" key={monitor.name}>
            <div className="row">
              <h3>{monitor.name}</h3>
              <strong>
                {monitor.uptime === null ? "No data" : `${monitor.uptime.toFixed(2)}% uptime`}
              </strong>
            </div>
            <div className="days" aria-label={`${monitor.name} daily availability`}>
              {monitor.days.map((day) => (
                <span
                  key={day.date}
                  className={`day ${day.state}`}
                  title={`${day.date}: ${day.uptime === null ? "no data" : `${day.uptime.toFixed(2)}%`}`}
                />
              ))}
            </div>
            {monitor.responseTimes.length ? (
              <div className="latency">
                <span>Recent response time</span>
                <Sparkline
                  label={`${monitor.name} response-time trend`}
                  values={monitor.responseTimes.map((point) => point.durationMs)}
                />
              </div>
            ) : null}
          </article>
        ))}
      </section>
      <section aria-labelledby="history-heading">
        <h2 id="history-heading">Recent incidents</h2>
        {data.incidents.length === 0 ? <p>No incidents reported.</p> : null}
        {data.incidents.map((item) => (
          <article className="history" key={`${item.monitorName}:${item.openedAt}`}>
            <div className="row">
              <h3>{item.monitorName}</h3>
              <span className={`pill ${item.status}`}>{item.status}</span>
            </div>
            <p>{item.summary}</p>
            <small>
              Opened{" "}
              {new Date(item.openedAt).toLocaleString("en-US", {
                timeZone: "UTC",
                timeZoneName: "short",
              })}
              {item.durationMinutes === null ? "" : ` · Resolved in ${item.durationMinutes} min`}
            </small>
          </article>
        ))}
      </section>
      <footer>
        Checkout availability verified by CheckoutWatch. Engine errors are excluded from uptime.
      </footer>
    </main>
  );
}

export default function PublicStatusRoute() {
  return <StatusPageView data={useLoaderData<typeof loader>()} />;
}

const styles = `
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f6f8f7;color:#14231c}
  body{margin:0}.cw-status{box-sizing:border-box;max-width:880px;margin:auto;padding:48px 24px 64px}
  header,section{background:white;border:1px solid #dce5e0;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 8px 28px rgba(20,35,28,.05)}
  h1{font-size:2rem;margin:.2rem 0 1.5rem}h2{font-size:1.15rem;margin:0 0 18px}h3{font-size:1rem;margin:0}
  .brand{color:#26734d;font-size:.72rem;font-weight:800;letter-spacing:.16em}.banner{display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:10px;font-weight:700;margin:0}
  .banner span{width:10px;height:10px;border-radius:50%}.operational{background:#e9f8ef;color:#17663c}.operational span{background:#26a269}.incident{background:#fff0ed;color:#9c2f1f}.incident span{background:#d94b36}
  .monitor+.monitor,.history+.history{border-top:1px solid #e6ece9;margin-top:18px;padding-top:18px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .days{display:grid;grid-template-columns:repeat(90,1fr);gap:2px;margin:14px 0}.day{height:22px;border-radius:2px;background:#d9dfdc}.day.operational{background:#39a96b}.day.outage{background:#df634e}.day.no_data{background:#d9dfdc}
  .latency{display:flex;align-items:center;justify-content:space-between;color:#52635b;font-size:.85rem}.pill{font-size:.72rem;font-weight:700;text-transform:uppercase;border-radius:99px;padding:4px 8px}.pill.open{background:#fff0ed;color:#9c2f1f}.pill.resolved{background:#e9f8ef;color:#17663c}
  .history p{margin:.6rem 0;color:#32443b}.history small,footer{color:#66776f}footer{text-align:center;font-size:.78rem;padding:14px}@media(max-width:600px){.days{grid-template-columns:repeat(45,1fr)}.cw-status{padding:20px 12px}.row{align-items:flex-start;flex-direction:column}}
`;
