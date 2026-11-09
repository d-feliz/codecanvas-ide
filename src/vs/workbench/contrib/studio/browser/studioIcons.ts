/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type IconShape = readonly ['path' | 'rect' | 'circle', Record<string, string>];

// The line icons of the Studio design (16px grid, drawn with the current text color).
export const STUDIO_ICONS = {
	chevronDown: [['path', { d: 'M3 4.5l3 3 3-3' }]],
	chevronLeft: [['path', { d: 'M7.5 3l-3 3 3 3' }]],
	chevronRight: [['path', { d: 'M4.5 3l3 3-3 3' }]],
	branch: [['circle', { cx: '4', cy: '3', r: '1.6' }], ['circle', { cx: '4', cy: '11', r: '1.6' }], ['circle', { cx: '10.5', cy: '5', r: '1.6' }], ['path', { d: 'M4 4.6v4.8M10.5 6.6c0 2.4-6.5 1.4-6.5 2.8' }]],
	search: [['circle', { cx: '6', cy: '6', r: '4' }], ['path', { d: 'M9 9l3.5 3.5' }]],
	moon: [['path', { d: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z' }]],
	sun: [['circle', { cx: '8', cy: '8', r: '3' }], ['path', { d: 'M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1' }]],
	assistant: [['path', { d: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z' }], ['path', { d: 'M10.5 1v2M9.5 2h2' }]],
} satisfies Record<string, readonly IconShape[]>;

export type StudioIconName = keyof typeof STUDIO_ICONS;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ICON_VIEW_BOX_SIZE: Partial<Record<StudioIconName, number>> = { chevronDown: 12, chevronLeft: 12, chevronRight: 12, branch: 14, search: 14 };

export function studioIcon(name: StudioIconName, size: number): SVGSVGElement {
	const viewBoxSize = ICON_VIEW_BOX_SIZE[name] ?? 16;
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	svg.setAttribute('width', `${size}`);
	svg.setAttribute('height', `${size}`);
	svg.setAttribute('viewBox', `0 0 ${viewBoxSize} ${viewBoxSize}`);
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.4');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('studio-icon');
	for (const [tag, attributes] of STUDIO_ICONS[name]) {
		const shape = document.createElementNS(SVG_NAMESPACE, tag);
		for (const [attribute, value] of Object.entries(attributes)) {
			shape.setAttribute(attribute, value);
		}
		svg.appendChild(shape);
	}
	return svg;
}

/** The CodeCanvas mark (build/codecanvas/make-icons.ts draws the same one): blocks in the text colour, the output block in the accent colour. */
export function studioLogoMark(size: number): SVGSVGElement {
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	svg.setAttribute('width', `${size}`);
	svg.setAttribute('height', `${size}`);
	svg.setAttribute('viewBox', '0 0 48 48');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('studio-logo-mark');
	const shapes: IconShape[] = [
		['path', { d: 'M20 14h8M13 21v4a4 4 0 0 0 4 4M35 21v4a4 4 0 0 1-4 4', stroke: 'currentColor', 'stroke-width': '3', 'stroke-linecap': 'round' }],
		['rect', { x: '6', y: '7', width: '14', height: '14', rx: '3.5', fill: 'currentColor' }],
		['rect', { x: '28', y: '7', width: '14', height: '14', rx: '3.5', fill: 'currentColor' }],
		['rect', { x: '17', y: '27', width: '14', height: '14', rx: '3.5', class: 'studio-logo-accent' }],
	];
	for (const [tag, attributes] of shapes) {
		const shape = document.createElementNS(SVG_NAMESPACE, tag);
		for (const [attribute, value] of Object.entries(attributes)) {
			shape.setAttribute(attribute, value);
		}
		svg.appendChild(shape);
	}
	return svg;
}
