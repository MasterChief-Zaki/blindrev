/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
}

interface Window {
  CESIUM_BASE_URL?: string;
}

declare module "virtual:blindrev-credits" {
  const credits: { license: string; attribution: string; source: string; folders: string[] }[];
  export default credits;
}
