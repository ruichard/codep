class Codep < Formula
  desc "Route coding tasks to the best official CLI (Claude / Codex / Gemini)"
  homepage "https://github.com/ruichard/codep"
  url "https://registry.npmjs.org/@ruichard/codep/-/codep-0.2.2.tgz"
  sha256 "1798d67fed25f70d54154e3c2be8368473c39a5d89a5e6c46ffb1b26255bfab0"
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
