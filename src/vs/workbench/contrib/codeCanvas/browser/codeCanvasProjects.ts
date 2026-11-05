/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { extname, isEqualOrParent, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CODE_CANVAS_FILE_EXTENSIONS, CODE_CANVAS_LAYOUT_FOLDER } from '../common/codeCanvas.js';
import { loadEngine, Project } from './codeCanvasEngine.js';

/** Folders that never hold the project's own source. */
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.build', 'coverage', CODE_CANVAS_LAYOUT_FOLDER]);
const MAX_PROJECT_FILES = 3000;

/** All TypeScript files of a folder in one engine `Project`, kept in sync with open documents and the disk. */
export class CodeCanvasFolderProject extends Disposable {

	private readonly _onDidChangeOtherFiles = this._register(new Emitter<void>());
	/** A file changed that no canvas is editing: canvases should resolve their usages and errors again. */
	readonly onDidChangeOtherFiles: Event<void> = this._onDidChangeOtherFiles.event;

	private readonly notifySoon = this._register(new RunOnceScheduler(() => this._onDidChangeOtherFiles.fire(), 300));
	private readonly modelListeners = this._register(new DisposableMap<string>());

	constructor(
		readonly folder: URI,
		readonly project: Project,
		@IFileService private readonly fileService: IFileService,
		@IModelService private readonly modelService: IModelService,
	) {
		super();
		for (const model of this.modelService.getModels()) {
			this.trackModel(model);
		}
		this._register(this.modelService.onModelAdded(model => this.trackModel(model)));
		this._register(this.modelService.onModelRemoved(model => this.modelListeners.deleteAndDispose(model.uri.toString())));
		this._register(this.fileService.onDidFilesChange(e => {
			// Files open in an editor follow their document instead (`trackModel`).
			const isClosedProjectFile = (resource: URI) => !!this.projectPath(resource) && !this.modelService.getModel(resource);
			for (const resource of e.rawDeleted.filter(isClosedProjectFile)) {
				this.project.removeFile(this.projectPath(resource)!);
				this.notifySoon.schedule();
			}
			for (const resource of [...e.rawAdded, ...e.rawUpdated].filter(isClosedProjectFile)) {
				void this.reloadFromDisk(resource, this.projectPath(resource)!);
			}
		}));
	}

	/** Path of a TypeScript file of this folder, relative to it (`src/cart.ts`), or undefined. */
	projectPath(resource: URI): string | undefined {
		const isProjectFile = CODE_CANVAS_FILE_EXTENSIONS.includes(extname(resource)) && isEqualOrParent(resource, this.folder);
		if (!isProjectFile) {
			return undefined;
		}
		const path = relativePath(this.folder, resource);
		const isInSkippedFolder = !!path && path.split('/').some(part => SKIPPED_FOLDERS.has(part));
		return isInSkippedFolder ? undefined : path;
	}

	/** Open documents can hold changes that aren't saved yet: the project follows the document, not the disk. */
	private trackModel(model: ITextModel) {
		const path = this.projectPath(model.uri);
		if (!path || model.uri.scheme !== this.folder.scheme) {
			return;
		}
		this.project.setFile(path, model.getValue());
		this.modelListeners.set(model.uri.toString(), model.onDidChangeContent(() => {
			this.project.setFile(path, model.getValue());
			this.notifySoon.schedule();
		}));
	}

	private async reloadFromDisk(resource: URI, path: string) {
		try {
			const content = await this.fileService.readFile(resource);
			if (!this.modelService.getModel(resource)) {
				this.project.setFile(path, content.value.toString());
				this.notifySoon.schedule();
			}
		} catch {
			// Deleted again in the meantime: the delete event removes it.
		}
	}
}

export const ICodeCanvasProjectService = createDecorator<ICodeCanvasProjectService>('codeCanvasProjectService');

export interface ICodeCanvasProjectService {
	readonly _serviceBrand: undefined;
	/** The project of a workspace folder, created on first use. */
	getFolderProject(folder: URI): Promise<CodeCanvasFolderProject>;
}

export class CodeCanvasProjectService extends Disposable implements ICodeCanvasProjectService {

	declare readonly _serviceBrand: undefined;

	private readonly loading = new Map<string, Promise<CodeCanvasFolderProject>>();
	private readonly projects = this._register(new DisposableStore());

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	getFolderProject(folder: URI): Promise<CodeCanvasFolderProject> {
		const key = folder.toString();
		let loading = this.loading.get(key);
		if (!loading) {
			loading = this.createFolderProject(folder);
			this.loading.set(key, loading);
		}
		return loading;
	}

	private async createFolderProject(folder: URI): Promise<CodeCanvasFolderProject> {
		// No standard library: type errors come from VS Code's TypeScript service; usage links don't need it.
		const [engine, files] = await Promise.all([loadEngine(), this.readSourceFiles(folder)]);
		const project = new engine.Project(files);
		return this.projects.add(this.instantiationService.createInstance(CodeCanvasFolderProject, folder, project));
	}

	private async readSourceFiles(folder: URI): Promise<Record<string, string>> {
		const resources: URI[] = [];
		const walk = async (stat: IFileStat) => {
			for (const child of stat.children ?? []) {
				if (resources.length >= MAX_PROJECT_FILES) {
					return;
				}
				if (child.isDirectory && !SKIPPED_FOLDERS.has(child.name)) {
					await walk(await this.fileService.resolve(child.resource));
				} else if (child.isFile && CODE_CANVAS_FILE_EXTENSIONS.includes(extname(child.resource))) {
					resources.push(child.resource);
				}
			}
		};
		await walk(await this.fileService.resolve(folder));
		if (resources.length >= MAX_PROJECT_FILES) {
			this.logService.warn(`[codeCanvas] ${folder.fsPath} has more than ${MAX_PROJECT_FILES} TypeScript files; references only cover the first ${MAX_PROJECT_FILES}.`);
		}
		const files: Record<string, string> = {};
		const contents = await Promise.all(resources.map(resource => this.fileService.readFile(resource).catch(() => undefined)));
		resources.forEach((resource, index) => {
			const content = contents[index];
			if (content) {
				files[relativePath(folder, resource)!] = content.value.toString();
			}
		});
		return files;
	}
}
