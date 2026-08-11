import { spawnSync } from "node:child_process";

const [typescriptCli] = process.argv.slice(2);

if (!typescriptCli) {
  console.error("Expected the TypeScript CLI path.");
  process.exit(1);
}

function compile(project) {
  return spawnSync(
    process.execPath,
    [typescriptCli, "--pretty", "false", "-p", project],
    {
      cwd: import.meta.dirname,
      encoding: "utf8",
    },
  );
}

const control = compile("tsconfig.control.json");

if (control.status !== 0) {
  console.error("The reverse-order control unexpectedly failed.");
  process.exit(1);
}

const failure = compile("tsconfig.json");
const output = `${failure.stdout}${failure.stderr}`;

if (failure.status === 0 || !output.includes("TS2322")) {
  console.error(
    "The declaration-order case did not produce the expected diagnostic.",
  );
  process.exit(1);
}

process.stderr.write(output);
process.exit(failure.status ?? 1);
