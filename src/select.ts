/**
 * Select list components: WrappedSingleSelectList (fuzzy search + split-pane)
 * and MultiSelectList (checkbox-based multi-select).
 */

import {
	type Component,
	type KeybindingsManager,
	type Theme,
	decodeKittyPrintable,
	fuzzyFilter,
	Key,
	Markdown,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { QuestionOption, ResolvedShortcut } from "./types";
import { renderSingleSelectRows } from "./layout";
import {
	COMMENT_TOGGLE_LABEL,
	FREEFORM_HINT,
	FREEFORM_TITLE,
	safeMarkdownTheme,
} from "./utils";

// ── Constants ────────────────────────────────────────────────────────────────

const VIM_SELECT_UP_KEY = Key.ctrl("k");
const VIM_SELECT_DOWN_KEY = Key.ctrl("j");
const SINGLE_SELECT_SPLIT_PANE_MIN_WIDTH = 84;
const SINGLE_SELECT_SPLIT_PANE_LEFT_MIN_WIDTH = 32;
const SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH = 28;
const SINGLE_SELECT_SPLIT_PANE_SEPARATOR = " │ ";

function matchesSelectUp(data: string, kb: KeybindingsManager): boolean {
	return (
		kb.matches(data, "tui.select.up") ||
		matchesKey(data, Key.shift("tab")) ||
		matchesKey(data, VIM_SELECT_UP_KEY)
	);
}

function matchesSelectDown(data: string, kb: KeybindingsManager): boolean {
	return (
		kb.matches(data, "tui.select.down") ||
		matchesKey(data, Key.tab) ||
		matchesKey(data, VIM_SELECT_DOWN_KEY)
	);
}

// ── MultiSelectList ──────────────────────────────────────────────────────────

export class MultiSelectList implements Component {
	private options: QuestionOption[];
	private allowFreeform: boolean;
	private allowComment: boolean;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private commentToggle: ResolvedShortcut;
	private selectedIndex = 0;
	private checked = new Set<number>();
	private commentEnabled = false;
	private cachedWidth?: number;
	private cachedLines?: string[];

	public onCancel?: () => void;
	public onSubmit?: (result: string[]) => void;
	public onEnterFreeform?: () => void;

	constructor(
		options: QuestionOption[],
		allowFreeform: boolean,
		allowComment: boolean,
		theme: Theme,
		keybindings: KeybindingsManager,
		commentToggle: ResolvedShortcut,
	) {
		this.options = options;
		this.allowFreeform = allowFreeform;
		this.allowComment = allowComment;
		this.theme = theme;
		this.keybindings = keybindings;
		this.commentToggle = commentToggle;
	}

	public isCommentEnabled(): boolean {
		return this.commentEnabled;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private getItemCount(): number {
		return (
			this.options.length +
			(this.allowComment ? 1 : 0) +
			(this.allowFreeform ? 1 : 0)
		);
	}

	private getCommentToggleIndex(): number | null {
		return this.allowComment ? this.options.length : null;
	}

	private getFreeformIndex(): number {
		return this.options.length + (this.allowComment ? 1 : 0);
	}

	private isCommentToggleRow(index: number): boolean {
		const toggleIndex = this.getCommentToggleIndex();
		return toggleIndex !== null && index === toggleIndex;
	}

	private isFreeformRow(index: number): boolean {
		return this.allowFreeform && index === this.getFreeformIndex();
	}

	private toggle(index: number): void {
		if (index < 0 || index >= this.options.length) return;
		if (this.checked.has(index)) this.checked.delete(index);
		else this.checked.add(index);
	}

	private toggleComment(): void {
		if (!this.allowComment) return;
		this.commentEnabled = !this.commentEnabled;
		this.invalidate();
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
			return;
		}

		const count = this.getItemCount();
		if (count === 0) {
			this.onCancel?.();
			return;
		}

		if (
			this.allowComment &&
			!this.commentToggle.disabled &&
			this.commentToggle.matches(data)
		) {
			this.toggleComment();
			return;
		}

		if (matchesSelectUp(data, this.keybindings)) {
			this.selectedIndex =
				this.selectedIndex === 0 ? count - 1 : this.selectedIndex - 1;
			this.invalidate();
			return;
		}

		if (matchesSelectDown(data, this.keybindings)) {
			this.selectedIndex =
				this.selectedIndex === count - 1 ? 0 : this.selectedIndex + 1;
			this.invalidate();
			return;
		}

		const numMatch = data.match(/^[1-9]$/);
		if (numMatch) {
			const idx = Number.parseInt(numMatch[0], 10) - 1;
			if (idx >= 0 && idx < this.options.length) {
				this.toggle(idx);
				this.selectedIndex = Math.min(idx, count - 1);
				this.invalidate();
			}
			return;
		}

		if (matchesKey(data, Key.space)) {
			if (this.isCommentToggleRow(this.selectedIndex)) {
				this.toggleComment();
				return;
			}
			if (this.isFreeformRow(this.selectedIndex)) {
				this.onEnterFreeform?.();
				return;
			}
			this.toggle(this.selectedIndex);
			this.invalidate();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.confirm")) {
			if (this.isCommentToggleRow(this.selectedIndex)) {
				this.toggleComment();
				return;
			}
			if (this.isFreeformRow(this.selectedIndex)) {
				this.onEnterFreeform?.();
				return;
			}

			const selectedTitles = Array.from(this.checked)
				.sort((a, b) => a - b)
				.map((i) => this.options[i]?.title)
				.filter((t): t is string => !!t);

			const fallback = this.options[this.selectedIndex]?.title;
			const result =
				selectedTitles.length > 0 ? selectedTitles : fallback ? [fallback] : [];

			if (result.length > 0) this.onSubmit?.(result);
			else this.onCancel?.();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const theme = this.theme;
		const count = this.getItemCount();
		const maxVisible = Math.min(count, 10);

		if (count === 0) {
			this.cachedLines = [theme.fg("warning", "No options")];
			this.cachedWidth = width;
			return this.cachedLines;
		}

		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(maxVisible / 2),
				count - maxVisible,
			),
		);
		const endIndex = Math.min(startIndex + maxVisible, count);

		const lines: string[] = [];

		for (let i = startIndex; i < endIndex; i++) {
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→") : " ";

			if (this.isCommentToggleRow(i)) {
				const checkbox = this.commentEnabled
					? theme.fg("success", "[✓]")
					: theme.fg("dim", "[ ]");
				const label = isSelected
					? theme.fg("accent", theme.bold(COMMENT_TOGGLE_LABEL))
					: theme.fg("text", theme.bold(COMMENT_TOGGLE_LABEL));
				lines.push(
					truncateToWidth(`${prefix}   ${checkbox} ${label}`, width, ""),
				);
				continue;
			}

			if (this.isFreeformRow(i)) {
				const label = theme.fg("text", theme.bold(FREEFORM_TITLE));
				const desc = theme.fg("muted", FREEFORM_HINT);
				const line = `${prefix}   ${label} ${theme.fg("dim", "—")} ${desc}`;
				lines.push(truncateToWidth(line, width, ""));
				continue;
			}

			const option = this.options[i];
			if (!option) continue;

			const checkbox = this.checked.has(i)
				? theme.fg("success", "[✓]")
				: theme.fg("dim", "[ ]");
			const num = theme.fg("dim", `${i + 1}.`);
			const title = isSelected
				? theme.fg("accent", theme.bold(option.title))
				: theme.fg("text", theme.bold(option.title));

			const firstLine = `${prefix} ${num} ${checkbox} ${title}`;
			lines.push(truncateToWidth(firstLine, width, ""));

			if (option.description) {
				const indent = "      ";
				const wrapWidth = Math.max(10, width - indent.length);
				const wrapped = wrapTextWithAnsi(option.description, wrapWidth);
				for (const w of wrapped) {
					lines.push(truncateToWidth(indent + theme.fg("muted", w), width, ""));
				}
			}
		}

		if (startIndex > 0 || endIndex < count) {
			lines.push(
				theme.fg(
					"dim",
					truncateToWidth(`  (${this.selectedIndex + 1}/${count})`, width, ""),
				),
			);
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

// ── WrappedSingleSelectList ──────────────────────────────────────────────────

export class WrappedSingleSelectList implements Component {
	private options: QuestionOption[];
	private allowFreeform: boolean;
	private allowComment: boolean;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private commentToggle: ResolvedShortcut;
	private selectedIndex = 0;
	private searchQuery = "";
	private commentEnabled = false;
	private maxVisibleRows = 12;
	private cachedWidth?: number;
	private cachedLines?: string[];

	public onCancel?: () => void;
	public onSubmit?: (result: string) => void;
	public onEnterFreeform?: () => void;

	constructor(
		options: QuestionOption[],
		allowFreeform: boolean,
		allowComment: boolean,
		theme: Theme,
		keybindings: KeybindingsManager,
		commentToggle: ResolvedShortcut,
	) {
		this.options = options;
		this.allowFreeform = allowFreeform;
		this.allowComment = allowComment;
		this.theme = theme;
		this.keybindings = keybindings;
		this.commentToggle = commentToggle;
	}

	public isCommentEnabled(): boolean {
		return this.commentEnabled;
	}

	setMaxVisibleRows(rows: number): void {
		const next = Math.max(1, Math.floor(rows));
		if (next !== this.maxVisibleRows) {
			this.maxVisibleRows = next;
			this.invalidate();
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private getFilteredOptions(): QuestionOption[] {
		return fuzzyFilter(
			this.options,
			this.searchQuery,
			(o) => `${o.title} ${o.description ?? ""}`,
		);
	}

	private getItemCount(filtered: QuestionOption[]): number {
		return (
			filtered.length +
			(this.allowComment ? 1 : 0) +
			(this.allowFreeform ? 1 : 0)
		);
	}

	private isCommentToggleRow(
		index: number,
		filtered: QuestionOption[],
	): boolean {
		return this.allowComment && index === filtered.length;
	}

	private isFreeformRow(index: number, filtered: QuestionOption[]): boolean {
		return (
			this.allowFreeform &&
			index === filtered.length + (this.allowComment ? 1 : 0)
		);
	}

	private toggleComment(): void {
		if (!this.allowComment) return;
		this.commentEnabled = !this.commentEnabled;
		this.invalidate();
	}

	private setSearchQuery(query: string): void {
		this.searchQuery = query;
		this.selectedIndex = 0;
		this.invalidate();
	}

	private popSearchCharacter(): void {
		if (!this.searchQuery) return;
		const chars = [...this.searchQuery];
		chars.pop();
		this.setSearchQuery(chars.join(""));
	}

	private getPrintableInput(data: string): string | null {
		const kittyPrintable = decodeKittyPrintable(data);
		if (kittyPrintable !== undefined) return kittyPrintable;

		const characters = [...data];
		if (characters.length !== 1) return null;
		const [ch] = characters;
		if (!ch) return null;
		const code = ch.charCodeAt(0);
		if (code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f))
			return null;
		return ch;
	}

	private styleListLine(
		line: string,
		width: number,
		isSelected: boolean,
	): string {
		const trimmed = line.trim();
		if (trimmed.startsWith("("))
			return truncateToWidth(this.theme.fg("dim", line), width, "");
		if (isSelected)
			return truncateToWidth(
				this.theme.fg("accent", this.theme.bold(line)),
				width,
				"",
			);
		if (line.startsWith("      "))
			return truncateToWidth(this.theme.fg("muted", line), width, "");
		if (line.startsWith("→"))
			return truncateToWidth(
				this.theme.fg("accent", this.theme.bold(line)),
				width,
				"",
			);
		return truncateToWidth(this.theme.fg("text", line), width, "");
	}

	private getSplitPaneWidths(
		width: number,
	): { left: number; right: number } | null {
		if (width < SINGLE_SELECT_SPLIT_PANE_MIN_WIDTH) return null;
		const available = width - SINGLE_SELECT_SPLIT_PANE_SEPARATOR.length;
		if (
			available <
			SINGLE_SELECT_SPLIT_PANE_LEFT_MIN_WIDTH +
				SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH
		)
			return null;

		const preferredLeft = Math.floor(available * 0.42);
		const left = Math.max(
			SINGLE_SELECT_SPLIT_PANE_LEFT_MIN_WIDTH,
			Math.min(
				preferredLeft,
				available - SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH,
			),
		);
		const right = available - left;
		if (right < SINGLE_SELECT_SPLIT_PANE_RIGHT_MIN_WIDTH) return null;
		return { left, right };
	}

	private buildListLines(
		width: number,
		filtered: QuestionOption[],
		hideDescriptions = false,
	): string[] {
		const lines: string[] = [];
		const count = this.getItemCount(filtered);
		const searchValue = this.searchQuery
			? this.theme.fg("text", this.searchQuery)
			: this.theme.fg("dim", "type to filter");
		lines.push(
			truncateToWidth(
				`${this.theme.fg("accent", "Filter:")} ${searchValue}`,
				width,
				"",
			),
		);

		if (this.searchQuery && filtered.length === 0) {
			lines.push(
				truncateToWidth(
					this.theme.fg("warning", "No matching options"),
					width,
					"",
				),
			);
		}

		if (count === 0) {
			if (!this.searchQuery) {
				lines.push(
					truncateToWidth(this.theme.fg("warning", "No options"), width, ""),
				);
			}
			return lines.slice(0, this.maxVisibleRows);
		}

		const maxRows = Math.max(1, this.maxVisibleRows - lines.length);
		const optionRows = renderSingleSelectRows({
			options: filtered,
			selectedIndex: this.selectedIndex,
			width,
			allowFreeform: this.allowFreeform,
			allowComment: this.allowComment,
			commentEnabled: this.commentEnabled,
			maxRows,
			hideDescriptions,
		});
		const optionLines = optionRows.map((row) =>
			this.styleListLine(row.line, width, row.selected),
		);
		lines.push(...optionLines);
		return lines.slice(0, this.maxVisibleRows);
	}

	private buildPreviewLines(
		width: number,
		filtered: QuestionOption[],
		maxLines: number,
	): string[] {
		if (maxLines <= 0) return [];
		const mdTheme = safeMarkdownTheme();
		let md = "";

		if (this.isCommentToggleRow(this.selectedIndex, filtered)) {
			md += "## Additional context\n\n";
			md += `Currently: **${this.commentEnabled ? "Enabled" : "Disabled"}**\n\n`;
			md +=
				"Turn this on when the selected option needs extra explanation before the tool submits.\n";
		} else if (this.isFreeformRow(this.selectedIndex, filtered)) {
			md += "## Custom response\n\n";
			md += "Open the editor to write **any** answer.\n\n";
			md += "*Use this when none of the listed options fit.*\n";
			if (this.searchQuery)
				md += `\n> Current filter: \`${this.searchQuery}\`\n`;
		} else {
			const selected = filtered[this.selectedIndex];
			if (!selected) {
				md += "*No option selected*\n";
			} else {
				md += `## ${selected.title}\n\n`;
				if (selected.description?.trim()) md += `${selected.description}\n`;
				else md += "*No additional details provided for this option.*\n";
				md += `\n---\n\nPress \`Enter\` to select this option.\n`;
				if (this.searchQuery) md += `\n> Filter: \`${this.searchQuery}\`\n`;
			}
		}

		let lines: string[];
		if (mdTheme) {
			const mdComponent = new Markdown(md.trim(), 0, 0, mdTheme);
			lines = mdComponent.render(width);
		} else {
			lines = [];
			for (const line of wrapTextWithAnsi(md.trim(), Math.max(10, width))) {
				lines.push(truncateToWidth(line, width, ""));
			}
		}

		while (lines.length > 0 && lines[lines.length - 1]?.trim() === "")
			lines.pop();
		if (lines.length <= maxLines) return lines;
		if (maxLines === 1)
			return [truncateToWidth(this.theme.fg("dim", "\u2026"), width, "")];

		const visible = lines.slice(0, maxLines - 1);
		visible.push(truncateToWidth(this.theme.fg("dim", "\u2026"), width, ""));
		return visible;
	}

	handleInput(data: string): void {
		if (this.searchQuery && matchesKey(data, Key.escape)) {
			this.setSearchQuery("");
			return;
		}

		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
			return;
		}

		if (
			this.allowComment &&
			!this.commentToggle.disabled &&
			this.commentToggle.matches(data)
		) {
			this.toggleComment();
			return;
		}

		const filtered = this.getFilteredOptions();
		const count = this.getItemCount(filtered);

		if (matchesSelectUp(data, this.keybindings) && count > 0) {
			this.selectedIndex =
				this.selectedIndex === 0 ? count - 1 : this.selectedIndex - 1;
			this.invalidate();
			return;
		}

		if (matchesSelectDown(data, this.keybindings) && count > 0) {
			this.selectedIndex =
				this.selectedIndex === count - 1 ? 0 : this.selectedIndex + 1;
			this.invalidate();
			return;
		}

		const numMatch = data.match(/^[1-9]$/);
		if (numMatch && filtered.length > 0) {
			const idx = Number.parseInt(numMatch[0], 10) - 1;
			if (idx >= 0 && idx < filtered.length) {
				this.selectedIndex = idx;
				this.invalidate();
				return;
			}
		}

		if (
			matchesKey(data, Key.space) &&
			count > 0 &&
			this.isCommentToggleRow(this.selectedIndex, filtered)
		) {
			this.toggleComment();
			return;
		}

		if (this.keybindings.matches(data, "tui.select.confirm") && count > 0) {
			if (this.isCommentToggleRow(this.selectedIndex, filtered)) {
				this.toggleComment();
				return;
			}
			if (this.isFreeformRow(this.selectedIndex, filtered)) {
				this.onEnterFreeform?.();
				return;
			}

			const result = filtered[this.selectedIndex]?.title;
			if (result) this.onSubmit?.(result);
			else this.onCancel?.();
			return;
		}

		if (
			this.keybindings.matches(data, "tui.editor.deleteCharBackward") ||
			matchesKey(data, Key.backspace)
		) {
			this.popSearchCharacter();
			return;
		}

		const printable = this.getPrintableInput(data);
		if (printable) {
			this.setSearchQuery(this.searchQuery + printable);
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const filtered = this.getFilteredOptions();
		const count = this.getItemCount(filtered);
		this.selectedIndex =
			count > 0 ? Math.max(0, Math.min(this.selectedIndex, count - 1)) : 0;

		const splitPane = this.getSplitPaneWidths(width);
		let lines: string[];

		if (!splitPane) {
			lines = this.buildListLines(width, filtered);
		} else {
			const listLines = this.buildListLines(splitPane.left, filtered, true);
			const previewLines = this.buildPreviewLines(
				splitPane.right,
				filtered,
				this.maxVisibleRows,
			);
			const rowCount = Math.min(
				this.maxVisibleRows,
				Math.max(listLines.length, previewLines.length),
			);
			const separator = this.theme.fg(
				"dim",
				SINGLE_SELECT_SPLIT_PANE_SEPARATOR,
			);
			lines = Array.from({ length: rowCount }, (_, i) => {
				const left = truncateToWidth(
					listLines[i] ?? "",
					splitPane.left,
					"",
					true,
				);
				const right = truncateToWidth(
					previewLines[i] ?? "",
					splitPane.right,
					"",
				);
				return `${left}${separator}${right}`;
			});
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}
