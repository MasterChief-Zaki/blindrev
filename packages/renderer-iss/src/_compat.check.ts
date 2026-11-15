import type { OrbitState } from "@blindrev/core-sim";
import type { HubOrbitState } from "./types";
// Compile-time check: core-sim's OrbitState must be assignable to the hub's structural type.
export const _orbitStateCompat = (s: OrbitState): HubOrbitState => s;
