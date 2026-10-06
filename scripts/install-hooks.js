// Runs `lefthook install` from the `prepare` script. Production installs
// omit devDependencies, so lefthook may be absent: skip quietly then, but
// let real install failures (e.g. an unwritable .git/hooks) fail loudly.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

try {
	require.resolve("lefthook/package.json");
} catch {
	process.exit(0);
}

const result = spawnSync("lefthook", ["install"], {
	stdio: "inherit",
	shell: true,
});
process.exit(result.status ?? 1);
