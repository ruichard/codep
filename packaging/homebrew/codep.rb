class Codep < Formula
  desc "Route coding tasks to the best official CLI (Claude / Codex / Gemini)"
  homepage "https://github.com/ruichard/codep"
  url "https://registry.npmjs.org/@ruichard/codep/-/codep-0.2.0.tgz"
  sha256 "20c6ea43a7dd5de254d705399da967c89dbb0186193bdbe727f8bd4514ece489"
  license "AGPL-3.0-only"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args(prefix: libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codep --version")
  end
end
