// @blindrev/renderer-globe — public entry. Exactly the ARCHITECTURE §5 API.
export { createGlobeRenderer } from "./globe";
export type {
  GlobeAnnotation,
  GlobeEvents,
  GlobeLayer,
  GlobeRenderer,
  GlobeRendererOptions,
  GlobeStatus,
} from "./types";
export { WebGL2UnavailableError } from "./types";
