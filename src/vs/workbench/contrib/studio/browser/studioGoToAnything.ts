/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { StudioLayoutContext } from '../../../common/studio.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { CodeCanvasBlockSummary, CodeCanvasEditor } from '../../codeCanvas/browser/codeCanvasEditor.js';

export const STUDIO_GO_TO_ANYTHING_COMMAND_ID = 'studio.goToAnything';
export const STUDIO_TOGGLE_THEME_COMMAND_ID = 'studio.toggleTheme';

const COMMANDS_PREFIX = '>';
const MOST_FILES_SHOWN = 20;
/** Glyphs of the canvas's block kinds (as on the blocks), so a node reads the same in the palette. */
// allow-any-unicode-next-line
const KIND_GLYPH: Record<string, string> = { import: '↓', class: 'C', function: 'ƒ', component: '⟨⟩', state: '◆', variable: '=', type: 'T', namespace: '{}', statement: '▸' };
const TYPE_KEYWORD_GLYPH = new Map([['interface', 'I'], ['type', 'T'], ['enum', 'E']]);

function glyphOf(block: CodeCanvasBlockSummary): string {
	const typeKeyword = block.kind === 'type' ? block.tags.find(tag => TYPE_KEYWORD_GLYPH.has(tag)) : undefined;
	return (typeKeyword && TYPE_KEYWORD_GLYPH.get(typeKeyword)) || KIND_GLYPH[block.kind] || '·';
}

type GoToAnythingItem = IQuickPickItem & { run: () => unknown };

registerAction2(class GoToAnythingAction extends Action2 {
	constructor() {
		super({
			id: STUDIO_GO_TO_ANYTHING_COMMAND_ID,
			title: localize2('studio.goToAnything', "Go to Anything"),
			category: localize2('studio.category', "Studio"),
			f1: true,
			keybinding: { primary: KeyMod.CtrlCmd | KeyCode.KeyK, when: StudioLayoutContext, weight: KeybindingWeight.WorkbenchContrib },
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IInstantiationService).createInstance(GoToAnythingPicker).show();
	}
});

registerAction2(class ToggleStudioThemeAction extends Action2 {
	constructor() {
		super({
			id: STUDIO_TOGGLE_THEME_COMMAND_ID,
			title: localize2('studio.toggleTheme', "Switch Between Light and Dark Theme"),
			category: localize2('studio.category', "Studio"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const themeService = accessor.get(IWorkbenchThemeService);
		const isDark = themeService.getColorTheme().type === ColorScheme.DARK;
		const studioThemeLabel = isDark ? 'Studio Light' : 'Studio Dark';
		const studioTheme = (await themeService.getColorThemes()).find(theme => theme.label === studioThemeLabel);
		await themeService.setColorTheme(studioTheme, 'auto');
	}
});

/**
 * Studio's palette: the nodes of the file on the canvas, files, and a few actions, in groups. Typing
 * `>` hands over to VS Code's command palette.
 */
class GoToAnythingPicker {

	constructor(
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IEditorService private readonly editorService: IEditorService,
		@IHistoryService private readonly historyService: IHistoryService,
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILabelService private readonly labelService: ILabelService,
		@ICommandService private readonly commandService: ICommandService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) { }

	async show(): Promise<void> {
		const disposables = new DisposableStore();
		const picker = disposables.add(this.quickInputService.createQuickPick<GoToAnythingItem>({ useSeparators: true }));
		picker.placeholder = localize('studio.goToAnythingPlaceholder', "Go to a node, a file or an action. Type > for all commands.");
		picker.matchOnDescription = true;
		picker.sortByLabel = false;

		const nodes = this.nodeItems();
		const actions = this.actionItems();
		let fileSearch: CancellationTokenSource | undefined;
		const render = (files: GoToAnythingItem[]) => {
			picker.items = [
				...group(localize('studio.nodesInFile', "Nodes in this file"), nodes),
				...group(localize('studio.files', "Files"), files),
				...group(localize('studio.actions', "Actions"), actions),
			];
		};
		render(this.recentFileItems());

		disposables.add(picker.onDidChangeValue(value => {
			if (value.startsWith(COMMANDS_PREFIX)) {
				picker.hide();
				this.quickInputService.quickAccess.show(value);
				return;
			}
			fileSearch?.dispose(true);
			if (!value.trim()) {
				render(this.recentFileItems());
				return;
			}
			const thisSearch = fileSearch = new CancellationTokenSource();
			void this.searchFiles(value, thisSearch).then(files => {
				if (!thisSearch.token.isCancellationRequested) {
					render(files);
				}
			});
		}));
		disposables.add(picker.onDidAccept(() => {
			const [item] = picker.selectedItems;
			picker.hide();
			item?.run();
		}));
		disposables.add(picker.onDidHide(() => {
			fileSearch?.dispose(true);
			disposables.dispose();
		}));
		picker.show();
	}

	private nodeItems(): GoToAnythingItem[] {
		const canvasEditor = this.editorService.activeEditorPane;
		if (!(canvasEditor instanceof CodeCanvasEditor)) {
			return [];
		}
		const blocks = canvasEditor.getBlocks();
		return blocks.map(block => ({
			label: `${glyphOf(block)}  ${block.name}`,
			description: block.detail,
			run: () => canvasEditor.revealBlock(block.id),
		}));
	}

	private recentFileItems(): GoToAnythingItem[] {
		const resources = this.historyService.getHistory()
			.map(editor => EditorResourceAccessor.getOriginalUri(editor))
			.filter((resource): resource is URI => !!resource);
		return resources.slice(0, MOST_FILES_SHOWN).map(resource => this.fileItem(resource));
	}

	private async searchFiles(filePattern: string, search: CancellationTokenSource): Promise<GoToAnythingItem[]> {
		const queryBuilder = this.instantiationService.createInstance(QueryBuilder);
		const query = queryBuilder.file(this.workspaceContextService.getWorkspace().folders, { filePattern, maxResults: MOST_FILES_SHOWN, sortByScore: true });
		const searchResult = await this.searchService.fileSearch(query, search.token).catch(() => undefined);
		return (searchResult?.results ?? []).map(result => this.fileItem(result.resource));
	}

	private fileItem(resource: URI): GoToAnythingItem {
		return {
			label: basename(resource),
			description: this.labelService.getUriLabel(dirname(resource), { relative: true }),
			run: () => this.editorService.openEditor({ resource }),
		};
	}

	private actionItems(): GoToAnythingItem[] {
		const action = (label: string, commandId: string): GoToAnythingItem => ({ label, run: () => this.commandService.executeCommand(commandId) });
		const canvasIsActive = this.editorService.activeEditorPane instanceof CodeCanvasEditor;
		return [
			...(canvasIsActive ? [action(localize('studio.showChanges', "Show or hide changes"), 'codeCanvas.toggleChanges')] : []),
			action(localize('studio.switchTheme', "Switch between the light and dark theme"), STUDIO_TOGGLE_THEME_COMMAND_ID),
			action(localize('studio.toggleAssistantAction', "Show or hide the Assistant"), 'workbench.action.toggleAuxiliaryBar'),
			action(localize('studio.toggleTerminal', "Show or hide the terminal"), 'workbench.action.terminal.toggleTerminal'),
		];
	}
}

function group(label: string, items: GoToAnythingItem[]): (GoToAnythingItem | IQuickPickSeparator)[] {
	return items.length ? [{ type: 'separator', label }, ...items] : [];
}
