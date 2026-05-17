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

function getProviders(noIndex: boolean, db?: string, forceRefresh = false): Provider[] {
  if (!noIndex) {
    if (forceRefresh) {
      refreshIndex(true, false, db);
    } else {
      ensureIndex(db);
    }
    const indexed = createIndexProviders(db);
    if (indexed) return indexed;
  }
  return tsProviders();
}

const cli = parseCli(process.argv);

switch (cli.command) {
  case "tui": {
    const providerFactory = () => getProviders(cli.noIndex, cli.db, true);
    await run(getProviders(cli.noIndex, cli.db), providerFactory);
    break;
  }
  case "splash":
    await runSplash();
    break;
  case "index": {
    const result = refreshIndex(false, cli.json, cli.db);
    if (result === "not-found") {
      console.error("skilled-index not found. Build it with: cd index && cargo build --release");
      process.exit(1);
    } else if (result === "failed") {
      console.error("skilled-index exited with an error. Check the output above for details.");
      process.exit(1);
    }
    break;
  }
  default:
    runCli(getProviders(cli.noIndex, cli.db), cli);
    break;
}
