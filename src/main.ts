import { ClaudeCodeProvider } from "./providers/claude-code.js";
import { CodexProvider } from "./providers/codex.js";
import { DroidProvider } from "./providers/droid.js";
import { OpenCodeProvider } from "./providers/opencode.js";
import { GrokProvider } from "./providers/grok.js";
import { ensureIndex, refreshIndex, createIndexProviders } from "./providers/index.js";
import { run, runSplash } from "./app.js";
import { parseCli, runCli } from "./cli.js";
import type { Provider } from "./providers/base.js";

function tsProviders(): Provider[] {
  return [
    new ClaudeCodeProvider(),
    new CodexProvider(),
    new DroidProvider(),
    new OpenCodeProvider(),
    new GrokProvider(),
  ];
}

function getProviders(noIndex: boolean): Provider[] {
  if (!noIndex) {
    ensureIndex();
    const indexed = createIndexProviders();
    if (indexed) return indexed;
  }
  return tsProviders();
}

const cli = parseCli(process.argv);

switch (cli.command) {
  case "tui":
    await run(getProviders(cli.noIndex));
    break;
  case "splash":
    await runSplash();
    break;
  case "index":
    if (!refreshIndex(false)) {
      console.error("skilled-index not found. Build it with: cd index && cargo build --release");
      process.exit(1);
    }
    break;
  default:
    runCli(getProviders(cli.noIndex), cli);
    break;
}
