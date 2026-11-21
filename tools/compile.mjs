// Compiles contracts/*.sol with solc-js and writes build/contracts.json (+ build/mocks.json for tests)
import { createRequire } from "module";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const solc = require("solc");
const sources = {};
for (const f of readdirSync(join(root, "contracts"))) if (f.endsWith(".sol")) sources[f] = { content: readFileSync(join(root, "contracts", f), "utf8") };
const input = { language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter(e => e.severity === "error");
for (const e of out.errors || []) if (e.severity === "error") console.error(e.formattedMessage);
if (errs.length) process.exit(1);
const art = {};
for (const [, cs] of Object.entries(out.contracts)) for (const [name, c] of Object.entries(cs)) art[name] = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, size: c.evm.deployedBytecode.object.length / 2 };
const mocks = {}; for (const k of Object.keys(art)) if (/^Mock/.test(k)) { mocks[k] = art[k]; delete art[k]; }
for (const k of Object.keys(art)) if (art[k].bytecode === "0x") delete art[k];
mkdirSync(join(root, "build"), { recursive: true });
writeFileSync(join(root, "build/contracts.json"), JSON.stringify(art));
writeFileSync(join(root, "build/mocks.json"), JSON.stringify(mocks));
for (const [n, a] of Object.entries(art)) console.log(n, a.size, "bytes");
