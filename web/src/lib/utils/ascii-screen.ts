/**
 * ASCII Screen Renderer
 *
 * Converts a list of UI elements (from the accessibility tree) into a 2D
 * ASCII grid that shows the spatial layout of the screen.
 */

interface ParsedBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Parse a bounds string like "[0,72][1080,210]" into {left, top, right, bottom}.
 * Also accepts an array of 4 numbers [left, top, right, bottom].
 */
function parseBounds(bounds: unknown): ParsedBounds | null {
	if (Array.isArray(bounds) && bounds.length >= 4) {
		const [left, top, right, bottom] = bounds.map(Number);
		if ([left, top, right, bottom].some(isNaN)) return null;
		return { left, top, right, bottom };
	}
	if (typeof bounds === 'string') {
		const m = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
		if (!m) return null;
		return {
			left: parseInt(m[1]),
			top: parseInt(m[2]),
			right: parseInt(m[3]),
			bottom: parseInt(m[4])
		};
	}
	return null;
}

/**
 * Build a short label for an element.
 */
function elementLabel(elem: Record<string, unknown>): string {
	const text = (elem.text as string) || '';
	const hint = (elem.hint as string) || '';
	const typeName = elem.type
		? (elem.type as string).split('.').pop() ?? ''
		: '';

	if (text) return text;
	if (hint) return hint;
	if (typeName) return typeName;
	return '?';
}

/**
 * Render a list of UI elements as an ASCII grid.
 *
 * @param elements   Array of element objects from observation data
 * @param screenWidth   Device screen width in pixels  (default 1080)
 * @param screenHeight  Device screen height in pixels (default 2400)
 * @param gridCols      ASCII grid columns (default 72)
 * @param gridRows      ASCII grid rows    (default 40)
 */
export function renderAsciiScreen(
	elements: Record<string, unknown>[],
	screenWidth = 1080,
	screenHeight = 2400,
	gridCols = 72,
	gridRows = 40
): string {
	// Create 2D grid filled with middle-dot
	const grid: string[][] = Array.from({ length: gridRows }, () =>
		Array.from({ length: gridCols }, () => ' ')
	);

	// Helper: scale pixel coords to grid coords (clamped)
	const scaleX = (px: number) => Math.min(gridCols - 1, Math.max(0, Math.round((px * gridCols) / screenWidth)));
	const scaleY = (py: number) => Math.min(gridRows - 1, Math.max(0, Math.round((py * gridRows) / screenHeight)));

	// Helper: safely set a char in the grid
	const setChar = (r: number, c: number, ch: string) => {
		if (r >= 0 && r < gridRows && c >= 0 && c < gridCols) {
			grid[r][c] = ch;
		}
	};

	// Helper: place a string on the grid (truncated to fit)
	const placeString = (r: number, startC: number, endC: number, str: string) => {
		const maxLen = endC - startC - 1; // leave room
		if (maxLen <= 0) return;
		const truncated = str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
		for (let i = 0; i < truncated.length && startC + i < endC; i++) {
			setChar(r, startC + i, truncated[i]);
		}
	};

	// Build element render list, sorted by depth (lower = drawn first, overwritten by higher)
	type RenderItem = {
		bounds: ParsedBounds;
		elem: Record<string, unknown>;
		depth: number;
	};

	const items: RenderItem[] = [];
	for (const elem of elements) {
		const b = parseBounds(elem.bounds);
		if (!b) continue;

		// Scale to grid
		const c1 = scaleX(b.left);
		const r1 = scaleY(b.top);
		const c2 = scaleX(b.right);
		const r2 = scaleY(b.bottom);

		// Skip elements too small to render (< 2 cols or < 1 row)
		if (c2 - c1 < 2 || r2 - r1 < 1) continue;

		items.push({
			bounds: { left: c1, top: r1, right: c2, bottom: r2 },
			elem,
			depth: (elem.depth as number) ?? 0
		});
	}

	// Sort by depth ascending — deeper elements drawn later (on top)
	items.sort((a, b) => a.depth - b.depth);

	// Draw each element
	for (const item of items) {
		const { left: c1, top: r1, right: c2, bottom: r2 } = item.bounds;
		const { elem } = item;
		const label = elementLabel(elem);
		const action = (elem.action as string) ?? '';
		const isChecked = !!elem.checked;
		const isEditable = !!elem.editable;
		const isScrollable = !!elem.scrollable;
		const typeName = elem.type ? (elem.type as string).split('.').pop()?.toLowerCase() ?? '' : '';

		// Determine box style
		const isImage = typeName.includes('image');
		const isButton =
			typeName.includes('button') || action === 'tap';
		const isCheckbox =
			typeName.includes('check') || typeName.includes('switch') || typeName.includes('toggle');

		if (r2 - r1 === 1) {
			// Single-row element — draw inline
			if (isCheckbox) {
				const mark = isChecked ? '✓' : ' ';
				const tag = `[${mark}] ${label}`;
				placeString(r1, c1, c2, tag);
			} else if (isEditable) {
				const tag = `|${label}|`;
				placeString(r1, c1, c2, tag);
			} else if (isImage) {
				placeString(r1, c1, c2, `◻ ${label}`);
			} else {
				placeString(r1, c1, c2, label);
			}
		} else {
			// Multi-row element — draw a box
			// Choose border chars based on element type
			let hChar = '─';
			let vChar = '│';
			let tl = '┌', tr = '┐', bl = '└', br = '┘';

			if (isScrollable) {
				hChar = '┄';
				vChar = '┆';
				tl = '┌'; tr = '┐'; bl = '└'; br = '┘';
			} else if (isEditable) {
				hChar = '_';
				vChar = '│';
			}

			// Top border
			setChar(r1, c1, tl);
			setChar(r1, c2 - 1, tr);
			for (let c = c1 + 1; c < c2 - 1; c++) setChar(r1, c, hChar);

			// Bottom border
			setChar(r2 - 1, c1, bl);
			setChar(r2 - 1, c2 - 1, br);
			for (let c = c1 + 1; c < c2 - 1; c++) setChar(r2 - 1, c, hChar);

			// Side borders
			for (let r = r1 + 1; r < r2 - 1; r++) {
				setChar(r, c1, vChar);
				setChar(r, c2 - 1, vChar);
			}

			// Place label inside the box (on the first content row)
			const contentRow = r1 + 1;
			if (contentRow < r2 - 1) {
				const innerStart = c1 + 1;
				const innerEnd = c2 - 1;
				if (isCheckbox) {
					const mark = isChecked ? '✓' : ' ';
					placeString(contentRow, innerStart, innerEnd, `[${mark}] ${label}`);
				} else if (isImage) {
					placeString(contentRow, innerStart, innerEnd, `◻ ${label}`);
				} else if (isButton) {
					placeString(contentRow, innerStart, innerEnd, `[${label}]`);
				} else {
					placeString(contentRow, innerStart, innerEnd, label);
				}

				// Add action hint on next row if space permits
				if (action && action !== 'read' && contentRow + 1 < r2 - 1) {
					placeString(contentRow + 1, innerStart, innerEnd, `(${action})`);
				}
			}
		}
	}

	// Build output with row numbers
	const lines: string[] = [];

	// Header with pixel dimensions
	lines.push(`Screen ${screenWidth}×${screenHeight}  →  ${gridCols}×${gridRows} grid`);
	lines.push('');

	for (let r = 0; r < gridRows; r++) {
		const rowLabel = r % 5 === 0 ? String(r).padStart(3) : '   ';
		lines.push(`${rowLabel} │${grid[r].join('')}│`);
	}

	// Footer
	lines.push(`    ${'└' + '─'.repeat(gridCols) + '┘'}`);

	return lines.join('\n');
}
