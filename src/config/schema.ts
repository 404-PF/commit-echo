import { z } from "zod";

const providerConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
});

const styleProfileSchema = z.object({
  dominantPrefix: z.string(),
  prefixPct: z.number().min(0).max(100),
  usesScope: z.boolean(),
  scopePct: z.number().min(0).max(100),
  avgSubjectLength: z.number().min(0),
  tone: z.enum(["imperative", "descriptive", "mixed"]),
  usesBody: z.boolean(),
  bodyPct: z.number().min(0).max(100),
  examples: z.array(z.string()),
  analyzedAt: z.string(),
  totalCommits: z.number().min(0),
});

export const configSchema = z.object({
  initialized: z.boolean().optional().default(false),
  provider: z.string().min(1),
  model: z.string().min(1),
  conventionalCommits: z.boolean(),
  maxSubjectLength: z.number().min(10).max(200),
  styleProfile: styleProfileSchema.nullable(),
  providers: z.record(providerConfigSchema),
});
