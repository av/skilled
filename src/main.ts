import { ClaudeCodeProvider } from "./providers/claude-code.js";
import { run } from "./app.js";

const providers = [new ClaudeCodeProvider()];
await run(providers);
