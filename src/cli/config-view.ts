import pc from "picocolors";
import { getConfig } from "../config/manager.js";

interface ConfigOptions {
  list?: boolean;
}

export async function runConfig(opts: ConfigOptions = {}): Promise<void> {
  const cfg = getConfig();

  if (opts.list) {
    const sanitized = structuredClone(cfg);
    for (const key of Object.keys(sanitized.providers)) {
      if (sanitized.providers[key].apiKey) {
        sanitized.providers[key].apiKey = "***";
      }
    }
    console.log(JSON.stringify(sanitized, null, 2));
    return;
  }

  console.log(`\n${pc.bold("commit-echo config")}`);
  console.log(`  ${pc.dim("Provider:")}       ${cfg.provider} / ${cfg.model}`);
  console.log(`  ${pc.dim("Conventional:")}    ${cfg.conventionalCommits ? "yes" : "no"}`);
  console.log(`  ${pc.dim("Max subject len:")} ${cfg.maxSubjectLength}`);
  console.log(`  ${pc.dim("Style profile:")}   ${cfg.styleProfile ? `${cfg.styleProfile.totalCommits} commits analyzed` : "none"}`);
  const providerKeys = Object.keys(cfg.providers);
  console.log(`  ${pc.dim("Configured providers:")} ${providerKeys.length > 0 ? providerKeys.join(", ") : "none"}`);
  console.log();
}
