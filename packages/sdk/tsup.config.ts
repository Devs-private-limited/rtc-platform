import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // @rtc/protocol is types-only; inline its declarations so the published package stands alone.
  dts: { resolve: ["@rtc/protocol"] },
  clean: true,
  sourcemap: true,
  target: "es2022",
});
