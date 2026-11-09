/*---------------------------------------------------------------------------------------------
 *  Copyright (c) CodeCanvas contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JSONPath, Node, ParseError, parseTree } from '../../../../base/common/json.js';

export type JsonValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export interface JsonValue {
	readonly type: JsonValueType;
	/** The property name, or the index in the parent array; undefined for the root. */
	readonly key: string | number | undefined;
	readonly path: JSONPath;
	readonly parent: JsonValue | undefined;
	readonly children: JsonValue[];
	/** The value's own text in the file, such as `"Vooks"`, `412` or `{ … }`. */
	readonly valueOffset: number;
	readonly valueLength: number;
	readonly keyOffset: number | undefined;
	readonly keyLength: number | undefined;
	/** The line of its key, or of the value when it has no key. */
	readonly startLine: number;
	/** The line where the value starts: the `{` of an object, for example. */
	readonly valueLine: number;
	readonly endLine: number;
}

export interface JsonFilterResult {
	/** Lines that stay at full contrast: the matches, and the lines that lead to them. */
	readonly brightLines: ReadonlySet<number>;
	readonly matchedRanges: readonly { offset: number; length: number }[];
}

export function isJsonContainer(value: JsonValue): boolean {
	return value.type === 'object' || value.type === 'array';
}

/** `expo.android.versionCode`, with array items as `plugins[2]`. */
export function dottedPath(path: JSONPath): string {
	return path.map((segment, index) => typeof segment === 'number' ? `[${segment}]` : index === 0 ? segment : `.${segment}`).join('');
}

/** A parsed JSON file: its values by line, and the counts the status bar shows. */
export class StudioJsonDocument {

	readonly root: JsonValue | undefined;
	readonly firstErrorLine: number | undefined;
	readonly valueCount: number;
	readonly levels: number;
	private readonly values: JsonValue[] = [];

	/**
	 * `allowComments` is for JSON with comments (`.jsonc`), which also allows trailing commas.
	 * `lineAt` gives the 1-based line of a text offset.
	 */
	constructor(private readonly text: string, allowComments: boolean, private readonly lineAt: (offset: number) => number) {
		const errors: ParseError[] = [];
		const rootNode = parseTree(text, errors, { disallowComments: !allowComments, allowTrailingComma: allowComments });
		this.firstErrorLine = errors.length ? lineAt(errors[0].offset) : undefined;
		this.root = rootNode ? this.readValue(rootNode, undefined, undefined, []) : undefined;
		this.valueCount = this.values.filter(value => !isJsonContainer(value)).length;
		this.levels = this.root ? levelsOf(this.root) : 0;
	}

	get isValid(): boolean {
		return this.firstErrorLine === undefined && !!this.root;
	}

	/** The innermost value whose key (or value) starts on this line. */
	valueStartingOnLine(lineNumber: number): JsonValue | undefined {
		let innermost: JsonValue | undefined;
		for (const value of this.values) {
			if (value.startLine === lineNumber) {
				innermost = value;
			}
		}
		return innermost;
	}

	/** The innermost object or array that holds this line, such as the one a `}` line closes. */
	containerAroundLine(lineNumber: number): JsonValue | undefined {
		let innermost: JsonValue | undefined;
		for (const value of this.values) {
			if (isJsonContainer(value) && value.startLine <= lineNumber && lineNumber <= value.endLine) {
				innermost = value;
			}
		}
		return innermost;
	}

	/** The object or array whose `{` or `[` is on this line: a fold that starts there folds it. */
	containerOpeningOnLine(lineNumber: number): JsonValue | undefined {
		return this.values.find(value => isJsonContainer(value) && value.valueLine === lineNumber);
	}

	valueAtPath(path: JSONPath): JsonValue | undefined {
		let value = this.root;
		for (const segment of path) {
			value = value?.children.find(child => child.key === segment);
		}
		return value;
	}

	/** A short text of the value for the path bar: the JSON text of a plain value, `{ 3 }` or `[ 2 ]` for the others. */
	preview(value: JsonValue, longest: number): string {
		if (value.type === 'object') {
			return `{ ${value.children.length} }`;
		}
		if (value.type === 'array') {
			return `[ ${value.children.length} ]`;
		}
		const text = this.text.substr(value.valueOffset, value.valueLength);
		return text.length > longest ? `${text.slice(0, longest - 1)}…` : text;
	}

	/** Keys and plain values that hold `query`, ignoring case. */
	filter(query: string): JsonFilterResult {
		const lowerQuery = query.toLowerCase();
		const brightLines = new Set<number>();
		const matchedRanges: { offset: number; length: number }[] = [];
		const holdsQuery = (offset: number, length: number) => this.text.substr(offset, length).toLowerCase().includes(lowerQuery);
		for (const value of this.values) {
			const keyMatches = value.keyOffset !== undefined && value.keyLength !== undefined && holdsQuery(value.keyOffset, value.keyLength);
			const valueMatches = !isJsonContainer(value) && holdsQuery(value.valueOffset, value.valueLength);
			if (keyMatches) {
				matchedRanges.push({ offset: value.keyOffset!, length: value.keyLength! });
			}
			if (valueMatches) {
				matchedRanges.push({ offset: value.valueOffset, length: value.valueLength });
			}
			if (keyMatches || valueMatches) {
				const lastBrightLine = isJsonContainer(value) ? value.valueLine : value.endLine;
				for (let line = value.startLine; line <= lastBrightLine; line++) {
					brightLines.add(line);
				}
				for (let ancestor = value.parent; ancestor; ancestor = ancestor.parent) {
					brightLines.add(ancestor.startLine);
				}
			}
		}
		return { brightLines, matchedRanges };
	}

	allValues(): readonly JsonValue[] {
		return this.values;
	}

	private readValue(node: Node, parent: JsonValue | undefined, keyNode: Node | undefined, path: JSONPath): JsonValue | undefined {
		const type = valueTypeOf(node);
		if (!type) {
			return undefined;
		}
		const value: JsonValue = {
			type,
			key: path[path.length - 1],
			path,
			parent,
			children: [],
			valueOffset: node.offset,
			valueLength: node.length,
			keyOffset: keyNode?.offset,
			keyLength: keyNode?.length,
			startLine: this.lineAt(keyNode?.offset ?? node.offset),
			valueLine: this.lineAt(node.offset),
			endLine: this.lineAt(node.offset + Math.max(node.length - 1, 0)),
		};
		this.values.push(value);
		if (node.type === 'object') {
			for (const property of node.children ?? []) {
				const [propertyKey, propertyValue] = property.children ?? [];
				const child = propertyKey && propertyValue ? this.readValue(propertyValue, value, propertyKey, [...path, propertyKey.value]) : undefined;
				if (child) {
					value.children.push(child);
				}
			}
		} else if (node.type === 'array') {
			(node.children ?? []).forEach((item, index) => {
				const child = this.readValue(item, value, undefined, [...path, index]);
				if (child) {
					value.children.push(child);
				}
			});
		}
		return value;
	}
}

function valueTypeOf(node: Node): JsonValueType | undefined {
	switch (node.type) {
		case 'object': case 'array': case 'string': case 'number': case 'boolean': case 'null':
			return node.type;
	}
	return undefined;
}

/** Levels of nesting: a plain value is 0, an object or array is one more than its deepest child. */
function levelsOf(value: JsonValue): number {
	if (!isJsonContainer(value)) {
		return 0;
	}
	return 1 + Math.max(0, ...value.children.map(levelsOf));
}
