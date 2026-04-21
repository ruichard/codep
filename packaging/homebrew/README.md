# Homebrew packaging

`codep` is distributed via a Homebrew **tap** — a small GitHub repo that
Homebrew can point at to install non-core formulas.

## One-time setup (tap repo)

1. Create an empty GitHub repo named **`homebrew-codep`** under the
   `ruichard` account. The `homebrew-` prefix is required so that
   `brew tap ruichard/codep` finds it.
2. Add a top-level `Formula/` directory. Brew expects formulas to live there
   (or at the repo root, but `Formula/` is idiomatic).

## Per-release workflow

Every time a new `@ruichard/codep` version is published to npm:

```sh
pnpm gen-brew <version> --write
# writes packaging/homebrew/codep.rb with a fresh sha256
```

Then copy that file into the tap repo:

```sh
cp packaging/homebrew/codep.rb ../homebrew-codep/Formula/codep.rb
cd ../homebrew-codep
git add Formula/codep.rb
git commit -m "codep <version>"
git push
```

Users install / upgrade with:

```sh
brew install ruichard/codep/codep
brew upgrade ruichard/codep/codep
```

## Why a tap instead of homebrew-core?

`homebrew-core` requires the project to have a meaningful user base
(typically ≥75 GitHub stars and a stable release history). Until codep
clears that bar, a personal tap is the recommended path.

## What the formula does

`codep.rb` treats the package as a Node-backed CLI: it calls `npm install
--prefix libexec` to install the tarball and its dependencies into a
sandboxed `libexec` directory, then symlinks the `bin/codep` shim into
Homebrew's `bin`. The `depends_on "node"` line ensures a modern Node
runtime is available.
