# Studio: design

Date: 2026-11-07. Status: in progress (steps 1–3 done).

Studio is CodeCanvas's own look, instead of VS Code's: floating surfaces over an infinite dotted
canvas, one accent color (gold), node-style blocks, and Canvas / Code / Split views of a file. The
design canvas is the source of truth for how it looks:
[CodeCanvas-IDE Redesign](https://claude.ai/artifact/Fh7UqJPrSahqH42kRtefCR) (boards: Canvas view,
Code view, Split view, Light theme, Command palette, Tokens and components).

Decisions made with the owner:

- Our own shell (a new layout), not a skin over VS Code's grid or Modern UI.
- The floating panels hold VS Code's real views, restyled with Studio tokens.
- The terminal and the rest of the bottom panel are a floating drawer, hidden by default.
- Studio-style blocks for every block kind, in the engine (the playground gets them too).
- The classic layout stays available with a setting; Studio becomes the default when it is done.
- ⌘K opens "Go to anything"; VS Code's ⌘K chords move to ⌘; in Studio.

## 1. Architecture

- `workbench.layoutStyle`: `"studio"` | `"classic"`. While Studio is being built the default is
  `"classic"`; the last step makes it `"studio"`.
- VS Code's `Layout` (`src/vs/workbench/browser/layout.ts`) talks to its grid through about ten
  methods (`setViewVisible`, `isViewVisible`, `getViewSize`, `resizeView`, `moveView`, `moveViewTo`,
  `getViewCachedVisibleSize`, `getNeighborViews`, `edgeSnapping`, `layout`). `StudioShell`, in
  `src/vs/workbench/browser/studio/`, provides the same methods. In Studio, `Layout` uses
  `StudioShell` instead of the grid; everything else (commands, views, extensions, keybindings) keeps
  using the layout service as it is.
- VS Code still creates its parts (side bar, secondary side bar, panel, editor, status bar).
  `StudioShell` positions each one as a floating surface, 12px from the window edges, and calls the
  part's `layout()` with its size.
- Per editor: a canvas editor fills the whole window, under the floating panels, and is told the free
  area (for Fit and centering). Text, diff, settings and other editors get the area between the
  panels.
- In Studio the title bar, activity bar and editor tabs are hidden. Studio's own widgets replace them
  (section 2) and call VS Code's services.
- Changes to VS Code's own files: the switch in `layout.ts`, and parts registering with the shell.
  The rest is new files in `browser/studio/`. Parts or layout features that upstream adds later have
  to be placed by `StudioShell`.

## 2. The window's surfaces

| Design | Backed by |
|---|---|
| Project button (top left) | Folder name; opens Open Recent |
| Branch button | Active repository's branch; opens Checkout to… |
| "Go to anything ⌘K" | The Studio palette |
| Open files (top center) | Back / Forward; the active group's editors as pills with a dot colored by language; × on the active one, ● when unsaved; scrolls, "+N" menu when full |
| Canvas / Code / Split (top right) | The active canvas editor's view; shown for TS/JS files |
| Theme switch | Studio Dark ↔ Studio Light |
| Assistant toggle | Secondary side bar |
| Sign in / avatar | VS Code accounts |
| Left panel (268px): icon row | Files, Search, Source control (dot when there are changes), Run, Extensions; other view containers in a "⋯" menu |
| Left panel: content | VS Code's views of that container (Files: Explorer, with Outline and Timeline at the bottom) |
| Left panel: footer | Account and the settings gear (Manage menu) |
| Assistant (320px, right) | VS Code's Chat view, titled "Assistant", with new chat and close |
| Terminal drawer | VS Code's panel (Terminal, Problems, Output, Debug Console) as a floating surface above the dock; ⌃` or a click on the errors pill opens it |
| Status pills (bottom corners) | VS Code's status bar, left items in the left pill, right items in the right pill (extension items included) |
| Command palette | VS Code's quick input in Studio style with group headers |

"Go to anything" (⌘K) shows three groups: nodes in this file (the canvas's blocks), files, and
actions (add function, open selection in split view, switch theme). `>` lists all commands, as
today. In Studio, keybindings whose first chord is ⌘K get ⌘; as their first chord instead
(⌘K ⌘S → ⌘; ⌘S). Before that, check that ⌘; isn't already a first chord in VS Code. The classic
layout keeps ⌘K.

Studio's own surfaces follow the design closely. VS Code's views get Studio's colors, fonts, radii and
spacing but keep their own structure (tree icons, extra controls, Copilot's chat).

## 3. The canvas (engine)

- Blocks are Studio nodes: a header with an 18px glyph, the name (mono 12.5/600) and the signature
  (faint mono), an `async` chip for async functions; the code below (mono 11.5, line height 19) with
  simple syntax colors. The selected block has a 2px accent ring; blocks not linked to it dim to 38%.
- Glyphs and colors (dark; light values from the tokens board, extended in the same way):

| Kind | Glyph | Color |
|---|---|---|
| import | ↓ | gray `#B4B9C2` (design) |
| variable | = | cyan `#7CC4E8` (design) |
| function | ƒ | gold `#E8C27A` (design) |
| class | C | green |
| type | T | lavender |
| component | ⟨⟩ | teal |
| state | ◆ | orange |
| namespace | { } | slate |
| statement | ▸ | muted gray |

  The glyph background is the kind color at 16% (dark) / 10% (light).
- The file frame: dashed rounded border; above it "folder / File.ts" and a chip "N nodes · M links".
- Links: curves with a dot at the end. Faint (55%) normally; with a selection, the selected block's
  links are accent and 2px, others 18%. Links to imports are dashed.
- Selected-block toolbar, above the block (below it when there is no room): "N deps · used by M",
  Open code (Split at the block), Ask (Assistant about the block), Rename, Delete, ×. Edit, Refs,
  Copy, Duplicate and + Inside move to a "⋯" menu and the context menu.
- Dock (bottom center): Select and Pan tools, + Function, Arrange, Fit, − / zoom % / +, the language
  label.
- Minimap (bottom right, Canvas view only): blocks as small bars in their kind color, the visible area
  outlined in the accent; a click moves there.
- Views of a file:
  - Canvas: the canvas.
  - Code: Monaco on the file, with a lane left of the line numbers: at each block's first line a chip
    (glyph and name), and a bar in the kind color along its lines. A click on a chip selects the block;
    the selected block's lines get an accent tint.
  - Split: canvas left, Code right; the selection follows on both sides.
  The block editor (double-click a block) stays.

## 4. Theme, tests, order

Theme:

- Two built-in color themes, Studio Dark (default) and Studio Light, made from the tokens board
  (workbench colors and syntax colors).
- Studio surfaces read registered theme colors (`studio.surface`, `studio.raised`, `studio.border`,
  `studio.accent`, …), so themes can change them. The desktop app passes the tokens to the engine;
  the playground uses the Studio palette as its default.
- The theme switch toggles the two themes; with `window.autoDetectColorScheme` it follows the OS.
- Inter and JetBrains Mono are bundled (SIL OFL).

Tests:

- Engine unit tests: glyph and color per kind; the frame's node and link counts; the Code view's
  block ranges and chips; dimming of unlinked blocks.
- Playground browser checks: Studio blocks, dock, minimap, Split selection following both ways.
- Desktop end-to-end checks: the Studio layout is there; each left-panel icon opens its view; ⌃`
  opens the drawer; ⌘K opens the palette with this file's nodes; ⌘; ⌘S opens keyboard shortcuts;
  the Assistant toggles; `"classic"` brings back the classic layout. The existing checks keep passing.
- Side by side: the desktop check takes 1440×900 screenshots of Canvas, Code, Split, Light and the
  palette; a comparison page puts each next to its design board.

Order (each step tested and pushed; classic stays the default until step 7):

1. Tokens, the two themes, the fonts.
2. Engine: Studio blocks, glyphs, frame, links, selected-block toolbar, dock, minimap (engine 0.4.0).
3. `StudioShell`: floating panels, canvas under the panels, status pills, drawer. (Until the engine
   can be told the free area, step 6, Fit and centering still use the whole canvas.)
4. Studio chrome: top groups, open-files bar, left panel icon row and footer, Assistant header.
5. The palette, ⌘K, and the ⌘K chords moved to ⌘;.
6. Code and Split views with the block lane (engine 0.5.0).
7. Polish against the boards (light theme included), Studio becomes the default, docs.
