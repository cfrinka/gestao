import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
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
        // Runtime-only wiring and the demo-mode (in-memory) twins of the Firestore
        // repositories. Same rationale as firestore-*-repository.ts: these are the
        // I/O adapters, not the logic under test — the logic lives in *-service.ts and
        // the pure helpers, which the suites cover directly. Excluding them keeps the
        // threshold meaningful instead of averaging in adapter boilerplate.
        "src/domains/**/*-repository-factory.ts",
        "src/domains/**/in-memory-*.ts",
        "src/domains/**/*-facade.ts",
        "src/domains/reports/demo-reports-service.ts",
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
