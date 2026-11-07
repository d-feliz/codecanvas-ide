/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/studioShell.css';
import { $ } from '../../../base/browser/dom.js';
import { ISerializableView, IViewSize } from '../../../base/browser/ui/grid/grid.js';
import { Orientation, Sash, SashState } from '../../../base/browser/ui/sash/sash.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { StudioRectangle, StudioShellInput, StudioShellRectangles, studioShellRectangles } from './studioShellGeometry.js';

export { STUDIO_LAYOUT_STYLE_SETTING } from '../../common/studio.js';

/** Ids of editors that lie under the floating panels instead of between them (the canvas editor adds its id). */
export const studioWindowFillingEditorIds = new Set<string>();

const STUDIO_LEFT_PANEL_FOOTER_HEIGHT = 44;

export type StudioEditorFreeArea = StudioShellRectangles['editorFreeArea'];
let studioEditorFreeArea: StudioEditorFreeArea = { left: 0, right: 0, top: 0, bottom: 0 };
const studioEditorFreeAreaEmitter = new Emitter<StudioEditorFreeArea>();
/** Fires when the floating panels cover a different part of a window-filling editor (the canvas). */
export const onDidChangeStudioEditorFreeArea: Event<StudioEditorFreeArea> = studioEditorFreeAreaEmitter.event;

/** What the floating panels leave free of a window-filling editor, as distances from its edges. */
export function getStudioEditorFreeArea(): StudioEditorFreeArea {
	return studioEditorFreeArea;
}

/**
 * The empty elements the shell places for Studio's own widgets. The widgets need services from
 * `contrib/` (source control, accounts, the canvas), so `contrib/studio` fills them in.
 */
export interface StudioChromeSlots {
	readonly topBar: HTMLElement;
	readonly leftPanelFooter: HTMLElement;
}

const studioChromeSlotsByContainer = new WeakMap<HTMLElement, StudioChromeSlots>();

/** The slots of the Studio shell in this workbench container, or undefined in the classic layout. */
export function getStudioChromeSlots(workbenchContainer: HTMLElement): StudioChromeSlots | undefined {
	return studioChromeSlotsByContainer.get(workbenchContainer);
}

/** The part of `SerializableGrid` that the workbench layout uses, which `StudioShell` also provides. */
export interface IWorkbenchGrid {
	readonly element: HTMLElement;
	edgeSnapping: boolean;
	layout(width: number, height: number): void;
	isViewVisible(view: ISerializableView): boolean;
	setViewVisible(view: ISerializableView, visible: boolean): void;
	getViewSize(view: ISerializableView): IViewSize;
	getViewCachedVisibleSize(view: ISerializableView): number | undefined;
	resizeView(view: ISerializableView, size: IViewSize): void;
	moveView(view: ISerializableView, sizing: unknown, referenceView: ISerializableView, direction: unknown): void;
	moveViewTo(view: ISerializableView, location: number[]): void;
	getNeighborViews(view: ISerializableView, direction: unknown, wrap?: boolean): ISerializableView[];
}

export interface StudioShellViews {
	titleBar: ISerializableView;
	banner: ISerializableView;
	activityBar: ISerializableView;
	sideBar: ISerializableView;
	editor: ISerializableView;
	panel: ISerializableView;
	auxiliaryBar: ISerializableView;
	statusBar: ISerializableView;
}

export interface StudioShellStartState {
	sideBarWidth: number;
	auxiliaryBarWidth: number;
	panelHeight: number;
	visibleViews: ISerializableView[];
	editorFillsWindow(): boolean;
}

const DEFAULT_PANEL_HEIGHT = 280;
const NO_SIZE: IViewSize = { width: 0, height: 0 };

/**
 * Studio's window layout: the editor (a canvas under everything, or any other editor between the
 * panels) with VS Code's parts floating over it as surfaces. It stands in for the workbench grid,
 * so `Layout` and everything that uses the layout service keep working unchanged.
 */
export class StudioShell extends Disposable implements IWorkbenchGrid {

	readonly element = $('.studio-shell');
	edgeSnapping = false;
	private readonly topBar = $('.studio-top-bar');
	private readonly leftPanelFooter = $('.studio-left-panel-footer.studio-floating');

	private readonly visibleViews: Set<ISerializableView>;
	private readonly laidOutRectangles = new Map<ISerializableView, StudioRectangle>();
	private sideBarWidth: number;
	private auxiliaryBarWidth: number;
	private panelHeight: number;
	private windowSize: IViewSize | undefined;
	private laidOutEditorFillsWindow = false;
	private readonly sideBarSash: Sash;
	private readonly auxiliaryBarSash: Sash;
	private readonly panelSash: Sash;

	constructor(workbenchContainer: HTMLElement, private readonly views: StudioShellViews, private readonly startState: StudioShellStartState) {
		super();
		this.visibleViews = new Set(startState.visibleViews);
		this.sideBarWidth = startState.sideBarWidth;
		this.auxiliaryBarWidth = startState.auxiliaryBarWidth;
		this.panelHeight = startState.panelHeight || DEFAULT_PANEL_HEIGHT;

		const floatingViews = [views.activityBar, views.sideBar, views.auxiliaryBar, views.panel];
		for (const view of [views.editor, views.titleBar, views.banner, ...floatingViews, views.statusBar]) {
			this.element.appendChild(view.element);
			view.element.classList.add('studio-part');
			view.element.style.display = this.isShown(view) ? '' : 'none';
		}
		for (const slot of [this.topBar, this.leftPanelFooter]) {
			this.element.appendChild(slot);
			slot.classList.add('studio-part');
		}
		studioChromeSlotsByContainer.set(workbenchContainer, { topBar: this.topBar, leftPanelFooter: this.leftPanelFooter });
		for (const view of floatingViews) {
			view.element.classList.add('studio-floating');
		}
		views.editor.element.classList.add('studio-editor');
		views.statusBar.element.classList.add('studio-status-pills');

		this.sideBarSash = this.createWidthSash(views.sideBar, () => this.sideBarWidth, width => this.sideBarWidth = width, +1);
		this.auxiliaryBarSash = this.createWidthSash(views.auxiliaryBar, () => this.auxiliaryBarWidth, width => this.auxiliaryBarWidth = width, -1);
		this.panelSash = this.createPanelSash();
	}

	layout(width: number, height: number): void {
		this.windowSize = { width, height };
		this.element.style.width = `${width}px`;
		this.element.style.height = `${height}px`;
		this.layoutViews();
	}

	isViewVisible(view: ISerializableView): boolean {
		return this.visibleViews.has(view);
	}

	setViewVisible(view: ISerializableView, visible: boolean): void {
		if (this.visibleViews.has(view) === visible) {
			return;
		}
		if (visible) {
			this.visibleViews.add(view);
		} else {
			this.visibleViews.delete(view);
		}
		view.element.style.display = this.isShown(view) ? '' : 'none';
		view.setVisible?.(visible);
		this.layoutViews();
	}

	getViewSize(view: ISerializableView): IViewSize {
		const rectangle = this.visibleViews.has(view) ? this.laidOutRectangles.get(view) : undefined;
		return rectangle ? { width: rectangle.width, height: rectangle.height } : NO_SIZE;
	}

	getViewCachedVisibleSize(view: ISerializableView): number | undefined {
		switch (view) {
			case this.views.sideBar: return this.sideBarWidth;
			case this.views.auxiliaryBar: return this.auxiliaryBarWidth;
			case this.views.panel: return this.panelHeight;
			default: return undefined;
		}
	}

	resizeView(view: ISerializableView, size: IViewSize): void {
		switch (view) {
			case this.views.sideBar: this.sideBarWidth = this.widthWithinLimits(view, size.width); break;
			case this.views.auxiliaryBar: this.auxiliaryBarWidth = this.widthWithinLimits(view, size.width); break;
			case this.views.panel: this.panelHeight = size.height; break;
			default: return; // the other parts take the room the floating surfaces leave
		}
		this.layoutViews();
	}

	// Studio places every part itself: the side bar on the left, the assistant on the right and the
	// panel as a drawer at the bottom, wherever VS Code would move them.
	editorPlacementIsOutdated(): boolean {
		return this.startState.editorFillsWindow() !== this.laidOutEditorFillsWindow;
	}

	moveView(): void { }
	moveViewTo(): void { }
	getNeighborViews(): ISerializableView[] { return []; }

	/** Studio's top bar takes the place of VS Code's title bar, which stays hidden. */
	private isShown(view: ISerializableView): boolean {
		return view !== this.views.titleBar && this.visibleViews.has(view);
	}

	private layoutViews(): void {
		if (!this.windowSize) {
			return;
		}
		const views = this.views;
		const sizeIfVisible = <T>(view: ISerializableView, size: T): T | undefined => this.visibleViews.has(view) ? size : undefined;
		const input: StudioShellInput = {
			windowWidth: this.windowSize.width,
			windowHeight: this.windowSize.height,
			banner: sizeIfVisible(views.banner, { height: views.banner.minimumHeight }),
			activityBar: sizeIfVisible(views.activityBar, { width: views.activityBar.minimumWidth }),
			sideBar: sizeIfVisible(views.sideBar, { width: this.widthWithinLimits(views.sideBar, this.sideBarWidth) }),
			auxiliaryBar: sizeIfVisible(views.auxiliaryBar, { width: this.widthWithinLimits(views.auxiliaryBar, this.auxiliaryBarWidth) }),
			panel: sizeIfVisible(views.panel, { height: this.panelHeight }),
			statusBar: sizeIfVisible(views.statusBar, { height: views.statusBar.minimumHeight }),
			leftPanelFooter: sizeIfVisible(views.sideBar, { height: STUDIO_LEFT_PANEL_FOOTER_HEIGHT }),
			editorFillsWindow: this.startState.editorFillsWindow(),
		};
		this.laidOutEditorFillsWindow = input.editorFillsWindow;
		const rectangles = studioShellRectangles(input);

		this.placeView(views.titleBar, rectangles.titleBar);
		this.placeView(views.banner, rectangles.banner);
		this.placeView(views.activityBar, rectangles.activityBar);
		this.placeView(views.sideBar, rectangles.sideBar);
		this.placeView(views.auxiliaryBar, rectangles.auxiliaryBar);
		this.placeView(views.panel, rectangles.panel);
		this.placeView(views.statusBar, rectangles.statusBar);
		this.placeView(views.editor, rectangles.editor);
		placeElement(this.topBar, rectangles.topBar);
		this.leftPanelFooter.style.display = rectangles.leftPanelFooter ? '' : 'none';
		placeElement(this.leftPanelFooter, rectangles.leftPanelFooter);
		this.markJoinedSurfaces(rectangles);
		this.passFreeAreaToEditor(rectangles, input.editorFillsWindow);

		this.sideBarSash.state = rectangles.sideBar ? SashState.Enabled : SashState.Disabled;
		this.auxiliaryBarSash.state = rectangles.auxiliaryBar ? SashState.Enabled : SashState.Disabled;
		this.panelSash.state = rectangles.panel ? SashState.Enabled : SashState.Disabled;
		this.sideBarSash.layout();
		this.auxiliaryBarSash.layout();
		this.panelSash.layout();
	}

	private placeView(view: ISerializableView, rectangle: StudioRectangle | undefined): void {
		if (!rectangle) {
			return;
		}
		this.laidOutRectangles.set(view, rectangle);
		view.layout(rectangle.width, rectangle.height, rectangle.top, rectangle.left);
		// After layout(): pane parts reset their own inline height there (the grid sizes a wrapper instead).
		placeElement(view.element, rectangle);
	}

	/** The activity bar, the side bar and the footer make one surface, the left panel. */
	private markJoinedSurfaces(rectangles: StudioShellRectangles): void {
		const activityBarBesideSideBar = !!rectangles.activityBar && !!rectangles.sideBar;
		this.views.activityBar.element.classList.toggle('studio-joined-to-next', activityBarBesideSideBar);
		this.views.sideBar.element.classList.toggle('studio-joined-to-previous', activityBarBesideSideBar);
		this.views.sideBar.element.classList.toggle('studio-joined-to-below', !!rectangles.leftPanelFooter);
		this.leftPanelFooter.classList.toggle('studio-joined-to-previous', activityBarBesideSideBar);
	}

	private passFreeAreaToEditor(rectangles: StudioShellRectangles, editorFillsWindow: boolean): void {
		const editorElement = this.views.editor.element;
		editorElement.classList.toggle('studio-editor-fills-window', editorFillsWindow);
		const freeArea = rectangles.editorFreeArea;
		const freeAreaChanged = (Object.keys(freeArea) as (keyof StudioEditorFreeArea)[]).some(edge => freeArea[edge] !== studioEditorFreeArea[edge]);
		if (freeAreaChanged) {
			studioEditorFreeArea = freeArea;
			studioEditorFreeAreaEmitter.fire(freeArea);
		}
		editorElement.style.setProperty('--studio-free-left', `${freeArea.left}px`);
		editorElement.style.setProperty('--studio-free-right', `${freeArea.right}px`);
		editorElement.style.setProperty('--studio-free-top', `${freeArea.top}px`);
		editorElement.style.setProperty('--studio-free-bottom', `${freeArea.bottom}px`);
	}

	private widthWithinLimits(view: ISerializableView, width: number): number {
		return Math.max(view.minimumWidth, Math.min(view.maximumWidth, width));
	}

	/** A sash on the inner edge of a side surface: `towardsInside` is +1 when the inside is to its right. */
	private createWidthSash(view: ISerializableView, getWidth: () => number, setWidth: (width: number) => void, towardsInside: 1 | -1): Sash {
		const sash = this._register(new Sash(this.element, {
			getVerticalSashLeft: () => {
				const rectangle = this.laidOutRectangles.get(view);
				return rectangle ? (towardsInside === 1 ? rectangle.left + rectangle.width : rectangle.left) : 0;
			},
			getVerticalSashTop: () => this.laidOutRectangles.get(view)?.top ?? 0,
			getVerticalSashHeight: () => this.laidOutRectangles.get(view)?.height ?? 0,
		}, { orientation: Orientation.VERTICAL }));
		let widthAtStart = 0;
		this._register(sash.onDidStart(() => widthAtStart = getWidth()));
		this._register(sash.onDidChange(event => {
			setWidth(this.widthWithinLimits(view, widthAtStart + towardsInside * (event.currentX - event.startX)));
			this.layoutViews();
		}));
		return sash;
	}

	private createPanelSash(): Sash {
		const panel = this.views.panel;
		const sash = this._register(new Sash(this.element, {
			getHorizontalSashTop: () => this.laidOutRectangles.get(panel)?.top ?? 0,
			getHorizontalSashLeft: () => this.laidOutRectangles.get(panel)?.left ?? 0,
			getHorizontalSashWidth: () => this.laidOutRectangles.get(panel)?.width ?? 0,
		}, { orientation: Orientation.HORIZONTAL }));
		let heightAtStart = 0;
		this._register(sash.onDidStart(() => heightAtStart = this.laidOutRectangles.get(panel)?.height ?? this.panelHeight));
		this._register(sash.onDidChange(event => {
			this.panelHeight = Math.max(panel.minimumHeight, heightAtStart - (event.currentY - event.startY));
			this.layoutViews();
		}));
		return sash;
	}
}

function placeElement(element: HTMLElement, rectangle: StudioRectangle | undefined): void {
	if (!rectangle) {
		return;
	}
	element.style.left = `${rectangle.left}px`;
	element.style.top = `${rectangle.top}px`;
	element.style.width = `${rectangle.width}px`;
	element.style.height = `${rectangle.height}px`;
}
