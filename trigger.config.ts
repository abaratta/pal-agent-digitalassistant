import { defineConfig } from "@trigger.dev/sdk/v3";

export default defineConfig({
  project: "proj_tdgkbsjcbmjxtoiequpb",
  runtime: "node",
  logLevel: "log",
  dirs: ["./trigger"],
  maxDuration: 300, // 5 minutes — covers long agent streaming responses
});
