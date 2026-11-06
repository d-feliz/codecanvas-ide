# CodeCanvas IDE

This is the desktop app of [CodeCanvas](https://github.com/d-feliz/codecanvas): a fork of
[Code-OSS](https://github.com/microsoft/vscode) (the open-source code of VS Code) where TypeScript
files can also be edited as a zoomable diagram. The canvas engine lives in the CodeCanvas repo; this
fork embeds it as a built-in editor ("Open as Canvas" on any TypeScript file).

## Changes from upstream

Kept small on purpose, so merging new VS Code versions stays easy:

- `product.json`: name, app IDs, data folders and URL protocol are CodeCanvas's own, so it installs
  and keeps settings separately from VS Code and Code - OSS (settings go in `~/.codecanvas-ide`).
- `src/vs/workbench/contrib/codeCanvas/`: the canvas editor. TypeScript files get "Open as Canvas"
  (title bar button, command, and Open With…). The canvas edits the file's text document, so unsaved
  changes, save and undo are shared with the text editor. Blocks are edited in Monaco on the file's
  own document with the other lines hidden, so IntelliSense, hovers and error squiggles work there.
  Errors on blocks come from Problems (the TypeScript extension). Usage links between blocks and
  renames are computed by the engine in a worker (`codeCanvasProjectWorkerMain`), so the window only
  parses the open file. A rename that changes several files is one workspace edit. The project
  covers the folder's TypeScript files (found with VS Code's file search, so `.gitignore` and the
  exclude settings apply; up to 10,000) and follows its `tsconfig.json` or `jsconfig.json` (path
  aliases, `baseUrl`, relative `extends`). Block positions are saved in `.codecanvas/` in the
  workspace folder once you arrange something; until then (when you only open a file) they stay in
  VS Code's workspace storage, so the repo gets no new files.
- `build/next/index.ts`: bundles that worker in production builds.
- `build/gulpfile.vscode.ts`: packages the engine's runtime files. The dependency list comes from
  the pnpm lockfile, which leaves out `link:` dependencies such as the engine.
- `api/browser/mainThreadEditorTabs.ts`: extensions see a canvas tab as a text tab of its file.
  The TypeScript extension only checks files open in text tabs; without this, a file shown only as a
  canvas would get no errors.
- `workbench.common.main.ts`: imports that contribution.
- `workbench.html`, `workbench-dev.html`: allow the `codecanvas` Trusted Types policy (the engine
  renders blocks with HTML strings).
- `package.json`, `pnpm-lock.yaml`: the engine, `@codecanvas/engine`, linked from the CodeCanvas repo.
- `test/codecanvas/`: end-to-end check of the canvas editor.
- This file.

## Build and run (macOS)

Needs Xcode command line tools, Python 3, and about 6 GB of disk. The engine comes from the
[CodeCanvas repo](https://github.com/d-feliz/codecanvas), checked out next to this one:

```sh
git clone https://github.com/d-feliz/codecanvas ../codecanvas
(cd ../codecanvas && npm install && npm run build -w @codecanvas/engine)
```

Rebuild the engine after changing it; reload the CodeCanvas window to pick it up. Then:

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

## Packaging the app (macOS)

After `pnpm run compile` (and the engine build):

```sh
pnpm run gulp vscode-darwin-arm64     # or vscode-darwin-arm64-min for a minified build
```

The app is written next to this repo, to `../VSCode-darwin-arm64/CodeCanvas.app` (about 1.4 GB). It
isn't signed. To repackage without compiling again, run `pnpm run gulp vscode-darwin-arm64-ci`.

At the current upstream version the task ends with an error from `prepareBuiltInCopilotRipgrepShim`
(it looks for `@github/copilot/sdk`, which the Copilot package now ships as `copilot-sdk`). That step
runs after the app is complete and only concerns Copilot's search; the app works.

## Testing the canvas editor

One command copies the CodeCanvas sample project (plus a `tsconfig.json` path alias) to `.build/e2e`,
starts the app on it with a separate profile, runs `test/codecanvas/canvas.e2e.cjs`, and quits the app:

```sh
node test/codecanvas/run.cjs                                              # development build
node test/codecanvas/run.cjs --app ../VSCode-darwin-arm64/CodeCanvas.app  # packaged app
```

Quit other CodeCanvas windows first: the check uses debugging port 9333. If it fails, screenshots
and the app's log are in `.build/e2e`.

## Updating from VS Code

```sh
git fetch upstream main
git merge upstream/main
```

The clone may be shallow (`git clone --depth 1`); run `git fetch --unshallow upstream` once if a
merge can't find the common history.
