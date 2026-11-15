/**
 * @blindrev/renderer-iss — the Three.js orbital hub ("the NISAR Hub", ARCHITECTURE §5 + §10).
 * Public API: createHubRenderer, the Hub* types, WebGL2UnavailableError.
 */
import { createHubRenderer as createHubRendererImpl } from "./hub";
import type { HubRenderer, HubRendererOptions } from "./types";

export type { HubEvents, HubMission, HubOrbitState, HubRenderer, HubRendererOptions } from "./types";
export { WebGL2UnavailableError } from "./types";

/**
 * Creates the hub on an explicit WebGL2 context inside `opts.container`.
 * Throws `WebGL2UnavailableError` synchronously when WebGL2 is unavailable; any later failure rejects `ready`.
 */
export function createHubRenderer(opts: HubRendererOptions): HubRenderer {
  return createHubRendererImpl(opts);
}
