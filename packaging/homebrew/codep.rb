class Codep < Formula
  desc "Route coding tasks to the best official CLI (Claude / Codex / Gemini)"
  homepage "https://github.com/ruichard/codep"
  url "https://registry.npmjs.org/@ruichard/codep/-/codep-0.1.2.tgz"
  sha256 "74d7edd18499a6d6e16776788ceb78b97520f2cd798e16e3aa640cc2de0fbab2"
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
