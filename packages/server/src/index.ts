/** The Cloudflare Worker entry point, and the Durable Object class for private matches. */
import { handle, type Env } from "./api.js";

export { MatchRoom } from "./match.js";

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
} satisfies ExportedHandler<Env>;
