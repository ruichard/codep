class Codep < Formula
  desc "Route coding tasks to the best official CLI (Claude / Codex / Gemini)"
  homepage "https://github.com/ruichard/codep"
  url "https://registry.npmjs.org/@ruichard/codep/-/codep-0.1.3.tgz"
  sha256 "ebf3989d20858db0d71a04893af9c795aaaaf6bcd55a57b6f17a48aace3021f8"
  license "AGPL-3.0-only"
  revision 1

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args(prefix: libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]

    # Install shell completions via the CLI's own generator so that
    # `brew install codep` and `brew upgrade codep` also refresh them.
    generate_completions_from_executable(bin/"codep", "completion", shells: [:bash, :zsh, :fish])
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codep --version")
  end
end
