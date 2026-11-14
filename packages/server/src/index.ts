/** The Cloudflare Worker entry point. */
import { handle, type Env } from "./api.js";

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
} satisfies ExportedHandler<Env>;
