# CodeCanvas IDE

This is the desktop app of [CodeCanvas](https://github.com/d-feliz/codecanvas): a fork of
[Code-OSS](https://github.com/microsoft/vscode) (the open-source code of VS Code) where TypeScript
files can also be edited as a zoomable diagram. The canvas engine lives in the CodeCanvas repo; this
fork will embed it as a built-in editor.

## Changes from upstream

Kept small on purpose, so merging new VS Code versions stays easy:

- `product.json`: name, app IDs, data folders and URL protocol are CodeCanvas's own, so it installs
  and keeps settings separately from VS Code and Code - OSS (settings go in `~/.codecanvas-ide`).
- This file.

## Build and run (macOS)

Needs Xcode command line tools, Python 3, and about 6 GB of disk.

```sh
nvm install                 # the Node version in .nvmrc (currently 24.22.1)
npm i -g pnpm@12.16.0       # the version pinned in package.json "packageManager"
pnpm ci                     # not `npm install`: upstream uses pnpm and its lockfile
pnpm run compile            # or `pnpm run watch` while developing
pnpm run electron           # downloads Electron and names the app from product.json
./scripts/code.sh           # starts CodeCanvas
```

Notes:

- Re-run `pnpm run electron` after changing the name in `product.json`.
- To try it without touching your settings, pass a separate profile:
  `./scripts/code.sh --user-data-dir .build/dev/user --extensions-dir .build/dev/ext`.
  Keep that path short: macOS limits socket paths to 104 characters, and a long
  `--user-data-dir` fails with `listen EINVAL`.
- The install log shows build errors for an old `fsevents` under `glob-watcher`. It's an optional
  dependency of gulp's file watcher; the build doesn't need it.

## Updating from VS Code

```sh
git fetch upstream main
git merge upstream/main
```

The clone may be shallow (`git clone --depth 1`); run `git fetch --unshallow upstream` once if a
merge can't find the common history.
