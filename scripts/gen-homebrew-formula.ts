#!/usr/bin/env tsx
/**
 * Generate a Homebrew formula for @ruichard/codep at a given version.
 *
 * Usage:
 *   tsx scripts/gen-homebrew-formula.ts                 # uses package.json version
 *   tsx scripts/gen-homebrew-formula.ts 0.1.2           # explicit version
 *   tsx scripts/gen-homebrew-formula.ts --write         # write to packaging/homebrew/codep.rb
 *
 * The output is a formula that installs codep as a Node-backed CLI. Paste it
 * (or let --write drop it in) and then commit it to the tap repo at
 * https://github.com/ruichard/homebrew-codep under Formula/codep.rb.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "@ruichard/codep";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const explicit = args.find((a) => !a.startsWith("--"));
  const version =
    explicit ??
    (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      version: string;
    }).version;

  const tarballUrl = `https://registry.npmjs.org/${PKG}/-/codep-${version}.tgz`;
  process.stderr.write(`Fetching ${tarballUrl} …\n`);
  const res = await fetch(tarballUrl);
  if (!res.ok) {
    throw new Error(`npm returned ${res.status} for ${tarballUrl}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  process.stderr.write(`sha256 = ${sha256}\n`);

  const formula = `class Codep < Formula
  desc "Route coding tasks to the best official CLI (Claude / Codex / Gemini)"
  homepage "https://github.com/ruichard/codep"
  url "${tarballUrl}"
  sha256 "${sha256}"
  license "AGPL-3.0-only"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codep --version")
  end
end
`;

  if (write) {
    const out = join(repoRoot, "packaging", "homebrew", "codep.rb");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, formula);
    process.stderr.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(formula);
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
