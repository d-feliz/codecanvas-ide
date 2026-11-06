/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { parse as parseJsonWithComments } from '../../../../base/common/json.js';
import { dirname, extname, isEqual, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { CODE_CANVAS_FILE_EXTENSIONS, CODE_CANVAS_FILE_PATTERN, CODE_CANVAS_LAYOUT_FOLDER } from '../common/codeCanvas.js';
import { FileAccess } from '../../../../base/common/network.js';
import { WebWorkerDescriptor } from '../../../../platform/webWorker/browser/webWorkerDescriptor.js';
import { IWebWorkerService } from '../../../../platform/webWorker/browser/webWorkerService.js';
import { loadEngine, RemoteProject } from './codeCanvasEngine.js';
import type { CodeCanvasProjectWorker } from './codeCanvasProjectWorker.js';

/** Folders that never hold the project's own source. */
const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.build', 'coverage', CODE_CANVAS_LAYOUT_FOLDER]);
const MAX_PROJECT_FILES = 10000;
/** TypeScript settings at the folder's root, in the order TypeScript's own tools pick them. */
const CONFIG_FILE_NAMES = ['tsconfig.json', 'jsconfig.json'];
const MAX_EXTENDS_DEPTH = 5;

/** All TypeScript files of a folder in one engine `Project`, kept in sync with open documents and the disk. */
export class CodeCanvasFolderProject extends Disposable {

	private readonly _onDidChangeOtherFiles = this._register(new Emitter<void>());
	/** A file changed that no canvas is editing: canvases should resolve their usages and errors again. */
	readonly onDidChangeOtherFiles: Event<void> = this._onDidChangeOtherFiles.event;

	private readonly notifySoon = this._register(new RunOnceScheduler(() => this._onDidChangeOtherFiles.fire(), 300));
	private readonly modelListeners = this._register(new DisposableMap<string>());
	private readonly reloadConfigSoon = this._register(new RunOnceScheduler(() => void this.loadConfigFile(), 300));
	/** The config files in use (the root one and those it extends), plus the root names not there yet. */
	private watchedConfigFiles: URI[] = [];

	constructor(
		readonly folder: URI,
		readonly project: RemoteProject,
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
			const isConfigChange = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted].some(resource => this.watchedConfigFiles.some(config => isEqual(config, resource)));
			if (isConfigChange) {
				this.reloadConfigSoon.schedule();
			}
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

	/** Give the project the folder's tsconfig.json (or jsconfig.json): path aliases decide where imports point. */
	async loadConfigFile(): Promise<void> {
		const rootConfigFiles = CONFIG_FILE_NAMES.map(name => joinPath(this.folder, name));
		for (const configResource of rootConfigFiles) {
			const text = await this.readText(configResource);
			if (text === undefined) {
				continue;
			}
			const extendedFiles: Record<string, string> = {};
			const usedConfigFiles = [configResource];
			const readExtendedConfigs = async (resource: URI, configText: string, depth: number) => {
				const extendsValue = (parseJsonWithComments(configText) as { extends?: unknown } | undefined)?.extends;
				const extendedNames = typeof extendsValue === 'string' ? [extendsValue] : Array.isArray(extendsValue) ? extendsValue.filter(name => typeof name === 'string') : [];
				// Package configs (`@tsconfig/node20`) live in node_modules, which the project doesn't read.
				const relativeNames = extendedNames.filter(name => name.startsWith('.'));
				for (const name of relativeNames) {
					const extendedResource = joinPath(dirname(resource), name.endsWith('.json') ? name : `${name}.json`);
					const path = isEqualOrParent(extendedResource, this.folder) ? relativePath(this.folder, extendedResource) : undefined;
					const extendedText = path && !(path in extendedFiles) ? await this.readText(extendedResource) : undefined;
					if (path && extendedText !== undefined) {
						extendedFiles[path] = extendedText;
						usedConfigFiles.push(extendedResource);
						if (depth < MAX_EXTENDS_DEPTH) {
							await readExtendedConfigs(extendedResource, extendedText, depth + 1);
						}
					}
				}
			};
			await readExtendedConfigs(configResource, text, 1);
			this.project.setConfigFile({ path: relativePath(this.folder, configResource)!, text, extendedFiles });
			this.watchedConfigFiles = [...rootConfigFiles, ...usedConfigFiles];
			this.notifySoon.schedule();
			return;
		}
		this.project.setConfigFile(null);
		this.watchedConfigFiles = rootConfigFiles;
		this.notifySoon.schedule();
	}

	private async readText(resource: URI): Promise<string | undefined> {
		try {
			return (await this.fileService.readFile(resource)).value.toString();
		} catch {
			return undefined;
		}
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
		this.project.setFileText(path, model.getValue());
		this.modelListeners.set(model.uri.toString(), model.onDidChangeContent(() => {
			this.project.setFileText(path, model.getValue());
			this.notifySoon.schedule();
		}));
	}

	private async reloadFromDisk(resource: URI, path: string) {
		try {
			const content = await this.fileService.readFile(resource);
			if (!this.modelService.getModel(resource)) {
				this.project.setFileText(path, content.value.toString());
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
		@IWebWorkerService private readonly webWorkerService: IWebWorkerService,
		@ISearchService private readonly searchService: ISearchService,
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
		const [engine, files] = await Promise.all([loadEngine(), this.readSourceFiles(folder)]);
		// The TypeScript work runs in a worker so a pause in a big file can't stall the window. No standard
		// library there: type errors come from VS Code's TypeScript service, and usage links don't need it.
		const worker = this.projects.add(this.webWorkerService.createWorkerClient<CodeCanvasProjectWorker>(new WebWorkerDescriptor({
			esmModuleLocation: FileAccess.asBrowserUri('vs/workbench/contrib/codeCanvas/browser/codeCanvasProjectWorkerMain.js'),
			label: 'CodeCanvasProjectWorker',
		})));
		const project = new engine.RemoteProject((method, args) => worker.proxy.$call(method, args));
		project.setFiles(files);
		const folderProject = this.projects.add(this.instantiationService.createInstance(CodeCanvasFolderProject, folder, project));
		await folderProject.loadConfigFile();
		return folderProject;
	}

	private async readSourceFiles(folder: URI): Promise<Record<string, string>> {
		const resources = await this.listSourceFiles(folder);
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

	/** VS Code's file search: fast, and it leaves out what .gitignore and the exclude settings leave out. */
	private async listSourceFiles(folder: URI): Promise<URI[]> {
		try {
			const query = this.instantiationService.createInstance(QueryBuilder).file([folder], {
				_reason: 'codeCanvasProject',
				includePattern: CODE_CANVAS_FILE_PATTERN,
				excludePattern: [{ pattern: [...SKIPPED_FOLDERS].map(name => `**/${name}/**`) }],
				maxResults: MAX_PROJECT_FILES,
			});
			const result = await this.searchService.fileSearch(query);
			if (result.limitHit) {
				this.logService.warn(`[codeCanvas] ${folder.fsPath} has more than ${MAX_PROJECT_FILES} TypeScript files; references only cover ${MAX_PROJECT_FILES} of them.`);
			}
			return result.results.map(match => match.resource);
		} catch (error) {
			this.logService.warn('[codeCanvas] file search failed, listing the folder instead', error);
			return this.walkSourceFiles(folder);
		}
	}

	private async walkSourceFiles(folder: URI): Promise<URI[]> {
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
		return resources;
	}
}
