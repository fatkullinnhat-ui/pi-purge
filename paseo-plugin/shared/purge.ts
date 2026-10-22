import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const patchEntrySchema = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  layer: z.string(),
  status: z.string(),
});

export const statusResultSchema = z.object({
  ok: z.boolean(),
  piRoot: z.string(),
  piVersion: z.string(),
  applied: z.number(),
  pending: z.number(),
  other: z.number(),
  total: z.number(),
  drift: z.boolean(),
  injectBytes: z.number(),
  hasInject: z.boolean(),
  hasBackup: z.boolean(),
  hasState: z.boolean(),
  shims: z.array(z.object({ name: z.string(), status: z.string() })),
  patches: z.array(patchEntrySchema),
  error: z.string().optional(),
});

export const actionResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string(),
  error: z.string().optional(),
});

export const purgeStatus = defineRpc({
  name: "pi-purge.status",
  input: z.object({}),
  output: statusResultSchema,
});

export const purgeApply = defineRpc({
  name: "pi-purge.apply",
  input: z.object({}),
  output: actionResultSchema,
});

export const purgeRevert = defineRpc({
  name: "pi-purge.revert",
  input: z.object({}),
  output: actionResultSchema,
});

export const purgeGuard = defineRpc({
  name: "pi-purge.guard",
  input: z.object({}),
  output: actionResultSchema,
});

export const drillKindSchema = z.enum(["identity", "cap", "trust", "update"]);
export type DrillKind = z.output<typeof drillKindSchema>;

export const drillResultSchema = z.object({
  ok: z.boolean(),
  kind: z.string(),
  durationMs: z.number(),
  lines: z.array(z.string()),
  sessionFile: z.string().optional(),
  error: z.string().optional(),
});

export const drillHistorySchema = z.object({
  results: z.array(z.object({
    kind: z.string(),
    ok: z.boolean(),
    durationMs: z.number(),
    at: z.string(),
    lines: z.array(z.string()),
    sessionFile: z.string().optional(),
  })),
});

export const purgeDrill = defineRpc({
  name: "pi-purge.drill",
  input: z.object({ kind: drillKindSchema }),
  output: drillResultSchema,
});

export const purgeDrillHistory = defineRpc({
  name: "pi-purge.drill.history",
  input: z.object({}),
  output: drillHistorySchema,
});

export type StatusResult = z.output<typeof statusResultSchema>;
export type PatchEntry = z.output<typeof patchEntrySchema>;
export type DrillResult = z.output<typeof drillResultSchema>;
