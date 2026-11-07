# CodeCanvas IDE

This is the desktop app of [CodeCanvas](https://github.com/d-feliz/codecanvas): a fork of
[Code-OSS](https://github.com/microsoft/vscode) (the open-source code of VS Code) where TypeScript
and JavaScript files can also be edited as a zoomable diagram. The canvas engine lives in the
CodeCanvas repo; this fork embeds it as a built-in editor ("Open as Canvas" on any TypeScript or
JavaScript file).

## Changes from upstream

Kept small on purpose, so merging new VS Code versions stays easy:

- `product.json`: name, app IDs, data folders and URL protocol are CodeCanvas's own, so it installs
  and keeps settings separately from VS Code and Code - OSS (settings go in `~/.codecanvas-ide`).
- `src/vs/workbench/contrib/codeCanvas/`: the canvas editor. TypeScript and JavaScript files on disk
  open as a canvas, except minified `*.min.js` bundles ("Open as Text" in the title bar switches; the
  setting `codeCanvas.openFilesAsCanvas`, formerly `codeCanvas.openTypeScriptFilesAsCanvas`,
  turns the default off, leaving "Open as Canvas" and Open With…). Opening a file at a position
  (Go to Definition, search results, Problems) selects the block there. The canvas edits the file's text document, so unsaved
  changes, save and undo are shared with the text editor. Blocks are edited in Monaco on the file's
  own document with the other lines hidden, so IntelliSense, hovers and error squiggles work there.
  Errors on blocks come from Problems (the TypeScript extension). Usage links between blocks and
  renames are computed by the engine in a worker (`codeCanvasProjectWorkerMain`), so the window only
  parses the open file. A rename that changes several files is one workspace edit. The project
  covers the folder's TypeScript and JavaScript files (found with VS Code's file search, so `.gitignore` and the
  exclude settings apply; up to 10,000) and follows its config files (`tsconfig.json`,
  `tsconfig.*.json`, `jsconfig.json`: path aliases, `baseUrl`, relative `extends`). In a monorepo each
  config gets its own program and a file uses the nearest config that includes it; packages that
  import each other by name are found from their `package.json`. Block positions are saved in `.codecanvas/` in the
  workspace folder once you arrange something; until then (when you only open a file) they stay in
  VS Code's workspace storage, so the repo gets no new files.
  "Show Changes" (title bar) compares the file with its committed version from source control (the
  same one the gutter's change bars use): unchanged blocks are desaturated, added and changed blocks
  get a chip, removed blocks show in red where they were, and the block editor becomes an inline diff.
  A file with merge conflicts shows its current side, with the conflicted blocks marked; the block
  editor on such a block shows VS Code's own conflict actions (Accept Current / Incoming / Both,
  Resolve in Merge Editor) next to the canvas's Keep current / incoming / both.
- `build/next/index.ts`: bundles that worker in production builds, and bundles `.woff2` fonts (Studio's).
- Studio, CodeCanvas's own look (in progress; design in
  `docs/superpowers/specs/2026-11-07-studio-design.md`): `src/vs/workbench/browser/studio/` (its
  tokens in `studioTokens.ts`, the registered `studio.*` colors, and the bundled Inter and JetBrains
  Mono fonts, SIL OFL), and `extensions/theme-codecanvas-studio/` with the Studio Dark and Studio
  Light themes (the default themes, `services/themes/common/workbenchThemeService.ts`). The themes are generated from the tokens with `node build/codecanvas/make-studio-themes.ts`.
  With `"workbench.layoutStyle": "studio"` (the default; `"classic"` brings back VS Code's), `StudioShell` replaces the
  workbench grid: the parts float as surfaces, a canvas lies under them, and the panel is a drawer.
  `src/vs/workbench/contrib/studio/` fills the shell's top bar (project, branch, Go to anything, open
  files, editor actions, Canvas / Code, theme, Assistant, account), the left panel's footer and the
  Assistant's header. In Studio, the view icons go on top of the left panel and editor tabs and
  breadcrumbs are off by default (`studioSettingDefaults.ts`).
- `services/keybinding/browser/keybindingService.ts`: in Studio, default ⌘K chords start with ⌘'
  instead (`studioChords.ts`), since ⌘K opens Studio's Go to anything (`contrib/studio`).
- `browser/layout.ts`: uses `StudioShell` instead of the grid in the Studio layout, opens the palette
  below Studio's top bar, and turns off Modern
  UI's card insets there (the shell floats the parts itself).
- `build/lib/stylelint/vscode-known-variables.json`: the `studio.*` colors.
- `build/gulpfile.vscode.ts`: packages the engine's bundle. The engine is a devDependency, so the
  bundle (which includes TypeScript) ships without the package's own dependencies.
- `api/browser/mainThreadEditorTabs.ts`: extensions see a canvas tab as a text tab of its file.
  The TypeScript extension only checks files open in text tabs; without this, a file shown only as a
  canvas would get no errors.
- `workbench.common.main.ts`: imports that contribution, and Studio's two.
- `workbench.html`, `workbench-dev.html`: allow the `codecanvas` Trusted Types policy (the engine
  renders blocks with HTML strings).
- `package.json`, `pnpm-lock.yaml`: the engine, [`@codecanvas-ide/engine`](https://www.npmjs.com/package/@codecanvas-ide/engine)
  from npm.
- `pnpm-workspace.yaml`: the engine is exempt from the 7-day minimum package age, so a new engine
  release can be used at once.
- `test/codecanvas/`: end-to-end checks of the canvas editor and of Studio.
- `build/filters.ts`: hygiene skips `.woff2` fonts, as it does `.woff`.
- `eslint.config.js`, `build/hygiene.ts`: accept the CodeCanvas copyright header on the fork's own
  files, allow the engine import in workbench contributions, and give `test/codecanvas` import rules.
- `build/lib/i18n.resources.json`: the canvas's strings.
- `resources/darwin/code.icns`, `resources/linux/code.png`, `resources/win32/code.ico`: the CodeCanvas
  icon, rendered from `build/codecanvas/icon.svg` with `node build/codecanvas/make-icons.ts` (macOS).
- `README.md`: about CodeCanvas instead of VS Code, with a screenshot (`build/codecanvas/canvas.png`).
- This file.

## Build and run (macOS)

Needs Xcode command line tools, Python 3, and about 6 GB of disk. The engine comes from npm as
`@codecanvas-ide/engine`; its source is in the [CodeCanvas repo](https://github.com/d-feliz/codecanvas).

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
- To try engine changes before publishing them, link a local checkout of the CodeCanvas repo:
  `pnpm link ../codecanvas/packages/engine` after `npm run build -w @codecanvas-ide/engine` there.
  Rebuild the engine after each change and reload the window. The link is an override in
  `pnpm-workspace.yaml` and `pnpm-lock.yaml`; don't commit it. To go back to the published version:
  `git checkout pnpm-workspace.yaml pnpm-lock.yaml && pnpm ci`.
- The install log shows build errors for an old `fsevents` under `glob-watcher`. It's an optional
  dependency of gulp's file watcher; the build doesn't need it.

## Packaging the app (macOS)

After `pnpm run compile`:

```sh
pnpm run gulp vscode-darwin-arm64     # or vscode-darwin-arm64-min for a minified build
```

The app is written next to this repo, to `../VSCode-darwin-arm64/CodeCanvas.app` (about 1.4 GB). It
isn't signed. To repackage without compiling again, run `pnpm run gulp vscode-darwin-arm64-ci`.

At the current upstream version the task ends with an error from `prepareBuiltInCopilotRipgrepShim`
(it looks for `@github/copilot/sdk`, which the Copilot package now ships as `copilot-sdk`). That step
runs after the app is complete and only concerns Copilot's search; the app works.

Quit CodeCanvas (including a development window) before packaging: the Copilot CLI it runs adds and
removes files in `extensions/copilot/node_modules`, and packaging fails if one disappears mid-copy.

## Testing the canvas editor

One command copies the CodeCanvas sample project (from the CodeCanvas repo, checked out next to
this one as `../codecanvas`) (plus a `tsconfig.json` path alias, and a git repo
whose last merge left a conflict in `discounts.ts`) to `.build/e2e`,
starts the app on it with a separate profile, runs `test/codecanvas/canvas.e2e.ts`, and quits the app:

```sh
node test/codecanvas/run.ts                                               # development build
node test/codecanvas/run.ts --app ../VSCode-darwin-arm64/CodeCanvas.app   # packaged app
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
