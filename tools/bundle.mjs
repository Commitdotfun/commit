// Dev-only: bundles the browser module and the Worker (needs esbuild + viem, run on the build machine).
import { createRequire } from "module";
import { mkdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const esbuild = createRequire(import.meta.url)("esbuild");
mkdirSync(join(root, "dist"), { recursive: true });
const common = { bundle: true, minify: true, legalComments: "none", logLevel: "warning", target: "es2022" };
await esbuild.build({ ...common, entryPoints: [join(root, "src/web/web3.js")], outfile: join(root, "public/assets/web3.js"), format: "esm", platform: "browser" });
await esbuild.build({ ...common, entryPoints: [join(root, "src/worker/index.js")], outfile: join(root, "dist/worker.js"), format: "esm", platform: "browser", conditions: ["worker", "browser"] });
for (const f of ["public/assets/web3.js", "dist/worker.js"]) console.log(f, Math.round(statSync(join(root, f)).size / 1024) + " KB");
