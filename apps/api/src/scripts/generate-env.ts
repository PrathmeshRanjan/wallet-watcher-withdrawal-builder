import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Wallet } from "ethers";

const root = resolve(process.cwd(), "../..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

if (existsSync(envPath)) {
  process.stderr.write(".env already exists; refusing to overwrite it.\n");
  process.exitCode = 1;
} else {
  const mnemonic = Wallet.createRandom().mnemonic?.phrase;
  if (!mnemonic) throw new Error("Could not generate an HD mnemonic");
  const template = readFileSync(examplePath, "utf8");
  const generated = template.replace("HD_MNEMONIC=", `HD_MNEMONIC=${mnemonic}`);
  writeFileSync(envPath, generated, { encoding: "utf8", mode: 0o600 });
  chmodSync(envPath, 0o600);
  process.stdout.write(
    "Created a testnet-only .env with permissions 0600. It is ignored by Git.\n",
  );
}
