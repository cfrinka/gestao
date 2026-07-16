import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/domains/**/*.ts", "src/lib/api/http-errors.ts"],
      exclude: [
        "**/*.test.ts",
        "src/domains/**/types.ts",
        "src/domains/**/repository.ts",
        "src/domains/**/*-db.ts",
        "src/domains/**/firestore-*-repository.ts",
        // Raw Firestore access that isn't behind a repository interface, despite not
        // matching the *-db.ts naming convention. Same as *-db.ts, this is validated via
        // disposable-data scripts against real Firestore, not vitest.
        "src/domains/shared/idempotency.ts",
        "src/domains/clients/fiado-payment.ts",
        "src/domains/reports/reports-service.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
