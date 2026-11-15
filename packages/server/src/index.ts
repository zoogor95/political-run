/** The Cloudflare Worker entry point, and the Durable Object class for private matches. */
import { handle, type Env } from "./api.js";
import { runTournaments } from "./tournaments-run.js";

export { MatchRoom } from "./match.js";
export { Matchmaker } from "./matchmaker.js";

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
  // Every 15 minutes: tournaments open, start, advance and finish (tournaments-run.ts).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runTournaments(env));
  },
} satisfies ExportedHandler<Env>;
