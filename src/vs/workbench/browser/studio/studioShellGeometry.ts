/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface StudioRectangle {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface StudioShellInput {
	windowWidth: number;
	windowHeight: number;
	titleBar?: { height: number };
	banner?: { height: number };
	activityBar?: { width: number };
	sideBar?: { width: number };
	auxiliaryBar?: { width: number };
	panel?: { height: number };
	statusBar?: { height: number };
	/** A canvas editor lies under the floating panels; any other editor gets the area between them. */
	editorFillsWindow: boolean;
}

export interface StudioShellRectangles {
	titleBar?: StudioRectangle;
	banner?: StudioRectangle;
	activityBar?: StudioRectangle;
	sideBar?: StudioRectangle;
	auxiliaryBar?: StudioRectangle;
	panel?: StudioRectangle;
	statusBar?: StudioRectangle;
	editor: StudioRectangle;
	/** The part of the editor that no floating surface covers, as distances from the editor's edges. */
	editorFreeArea: { left: number; right: number; top: number; bottom: number };
}

export const STUDIO_WINDOW_MARGIN = 12;
export const STUDIO_SURFACE_GAP = 8;
/** Room for the canvas's dock (bottom center), which the drawer stays above. */
export const STUDIO_CANVAS_DOCK_HEIGHT = 48;
export const STUDIO_PANEL_MINIMUM_HEIGHT = 120;

export function studioShellRectangles(input: StudioShellInput): StudioShellRectangles {
	const { windowWidth, windowHeight } = input;
	const rectangles: Partial<StudioShellRectangles> = {};

	let top = 0;
	if (input.titleBar) {
		rectangles.titleBar = { left: 0, top, width: windowWidth, height: input.titleBar.height };
		top += input.titleBar.height;
	}
	if (input.banner) {
		rectangles.banner = { left: 0, top, width: windowWidth, height: input.banner.height };
		top += input.banner.height;
	}

	let surfacesBottom = windowHeight - STUDIO_WINDOW_MARGIN;
	if (input.statusBar) {
		const statusBarTop = windowHeight - STUDIO_WINDOW_MARGIN - input.statusBar.height;
		rectangles.statusBar = { left: STUDIO_WINDOW_MARGIN, top: statusBarTop, width: windowWidth - 2 * STUDIO_WINDOW_MARGIN, height: input.statusBar.height };
		surfacesBottom = statusBarTop - STUDIO_SURFACE_GAP;
	}
	const surfacesTop = top + STUDIO_WINDOW_MARGIN;
	const surfacesHeight = Math.max(0, surfacesBottom - surfacesTop);

	let leftSurfacesRight = 0;
	if (input.activityBar) {
		rectangles.activityBar = { left: STUDIO_WINDOW_MARGIN, top: surfacesTop, width: input.activityBar.width, height: surfacesHeight };
		leftSurfacesRight = STUDIO_WINDOW_MARGIN + input.activityBar.width;
	}
	if (input.sideBar) {
		const sideBarLeft = leftSurfacesRight || STUDIO_WINDOW_MARGIN;
		rectangles.sideBar = { left: sideBarLeft, top: surfacesTop, width: input.sideBar.width, height: surfacesHeight };
		leftSurfacesRight = sideBarLeft + input.sideBar.width;
	}

	let rightSurfacesLeft = windowWidth;
	if (input.auxiliaryBar) {
		rightSurfacesLeft = windowWidth - STUDIO_WINDOW_MARGIN - input.auxiliaryBar.width;
		rectangles.auxiliaryBar = { left: rightSurfacesLeft, top: surfacesTop, width: input.auxiliaryBar.width, height: surfacesHeight };
	}

	const middleLeft = leftSurfacesRight ? leftSurfacesRight + STUDIO_SURFACE_GAP : STUDIO_WINDOW_MARGIN;
	const middleRight = rightSurfacesLeft < windowWidth ? rightSurfacesLeft - STUDIO_SURFACE_GAP : windowWidth - STUDIO_WINDOW_MARGIN;
	const middleWidth = Math.max(0, middleRight - middleLeft);

	const panelBottom = input.editorFillsWindow ? surfacesBottom - STUDIO_CANVAS_DOCK_HEIGHT - STUDIO_SURFACE_GAP : surfacesBottom;
	let panelTop = panelBottom;
	if (input.panel) {
		const panelHeight = Math.max(STUDIO_PANEL_MINIMUM_HEIGHT, Math.min(input.panel.height, panelBottom - surfacesTop));
		panelTop = panelBottom - panelHeight;
		rectangles.panel = { left: middleLeft, top: panelTop, width: middleWidth, height: panelHeight };
	}

	if (input.editorFillsWindow) {
		const editor = { left: 0, top, width: windowWidth, height: windowHeight - top };
		rectangles.editor = editor;
		rectangles.editorFreeArea = {
			left: leftSurfacesRight,
			right: windowWidth - rightSurfacesLeft,
			top: 0,
			bottom: windowHeight - (input.panel ? panelTop - STUDIO_SURFACE_GAP : surfacesBottom),
		};
	} else {
		const editorBottom = input.panel ? panelTop - STUDIO_SURFACE_GAP : surfacesBottom;
		rectangles.editor = { left: middleLeft, top: surfacesTop, width: middleWidth, height: Math.max(0, editorBottom - surfacesTop) };
		rectangles.editorFreeArea = { left: 0, right: 0, top: 0, bottom: 0 };
	}

	return rectangles as StudioShellRectangles;
}
