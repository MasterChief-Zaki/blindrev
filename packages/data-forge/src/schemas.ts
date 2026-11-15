/** Zod schemas for the data-forge-owned JSON that has no core-sim contract. */
import { BoundsSchema } from "@blindrev/core-sim";
import { z } from "zod";

const nonEmpty = () => z.string().min(1);
const zoom = () => z.number().int().min(0).max(24);

export const BasemapPrefabSchema = z.object({
  online: z.object({
    layerId: nonEmpty(),
    urlTemplate: z
      .string()
      .regex(/^https:\/\/.+\{z\}.*\{y\}.*\{x\}/, "online urlTemplate must be https with {z}/{y}/{x}"),
    minZoom: zoom(),
    maxZoom: zoom(),
    tileMatrixSet: nonEmpty(),
    crs: z.literal("EPSG:3857"),
    date: nonEmpty(),
    attribution: nonEmpty(),
    license: nonEmpty(),
  }),
  offline: z.object({
    urlTemplate: z
      .string()
      .refine(
        (s) => !s.startsWith("/") && s.includes("{z}") && s.includes("{y}") && s.includes("{x}"),
        "relative {z}/{y}/{x} template",
      ),
    minZoom: zoom(),
    maxZoom: zoom(),
    regionalMaxZoom: zoom(),
    regionalBounds: BoundsSchema,
    tileMatrixSet: nonEmpty(),
    crs: z.literal("EPSG:3857"),
    attribution: nonEmpty(),
    license: nonEmpty(),
    notes: z.string(),
  }),
});
export type BasemapPrefab = z.infer<typeof BasemapPrefabSchema>;

export const AssetsManifestSchema = z.object({
  schemaVersion: z.literal(1),
  root: nonEmpty(),
  excluded: z.array(z.string()),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  files: z.array(
    z.object({
      path: nonEmpty(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      license: z.string().nullable(),
      attribution: z.string().nullable(),
      source: z.string().nullable(),
      licenseFile: z.string().nullable(),
      deterministic: z.boolean(),
    }),
  ),
});

export const AssetLicenseSchema = z.object({
  license: nonEmpty(),
  attribution: nonEmpty(),
  source: nonEmpty(),
  notes: z.string().optional(),
});
