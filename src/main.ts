import { ClaudeCodeProvider } from "./providers/claude-code.js";
import { CodexProvider } from "./providers/codex.js";
import { DroidProvider } from "./providers/droid.js";
import { OpenCodeProvider } from "./providers/opencode.js";
import { GrokProvider } from "./providers/grok.js";
import { run, runSplash } from "./app.js";

if (process.argv.includes("--splash")) {
  await runSplash();
} else {
  const providers = [
    new ClaudeCodeProvider(),
    new CodexProvider(),
    new DroidProvider(),
    new OpenCodeProvider(),
    new GrokProvider(),
  ];
  await run(providers);
}
