import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["server/__tests__/social-workflows.e2e.test.ts"],
		testTimeout: 600_000, // 10 min per test
		hookTimeout: 60_000,
		pool: "forks", // Isolated processes
		maxConcurrency: 1, // Sequential — one device at a time
		retry: 0, // Don't retry device tests
	},
});
