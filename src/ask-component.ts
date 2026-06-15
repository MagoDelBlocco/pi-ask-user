/**
 * Main AskComponent — the root Container that orchestrates the ask_user UI.
 * Swaps between select mode (single/multi), freeform editor, and comment editor.
 */

import {
	Container,
	type Component,
	type KeybindingsManager,
	type Theme,
	type TUI,
	Editor,
	Key,
	Markdown,
	matchesKey,
	Spacer,
	Text,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type {
	AskDisplayMode,
	AskMode,
	AskUIResult,
	QuestionOption,
	ResolvedAskShortcuts,
} from "./types";
import { BoxBorderBottom, BoxBorderTop } from "./borders";
import { MultiSelectList, WrappedSingleSelectList } from "./select";
import {
	ASK_OVERLAY_MAX_HEIGHT_RATIO,
	createEditorTheme,
	createFreeformResponse,
	createSelectionResponse,
	formatKeyList,
	keybindingHint,
	literalHint,
	safeMarkdownTheme,
} from "./utils";

const BOX_BORDER_LEFT = "│ ";
const BOX_BORDER_RIGHT = " │";
const BOX_BORDER_OVERHEAD = BOX_BORDER_LEFT.length + BOX_BORDER_RIGHT.length;

// Read extension version at module scope
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const ASK_USER_VERSION: string = (
	_require("../package.json") as { version: string }
).version;

export class AskComponent extends Container {
	private question: string;
	private context?: string;
	private options: QuestionOption[];
	private allowMultiple: boolean;
	private allowFreeform: boolean;
	private allowComment: boolean;
	private displayMode: AskDisplayMode;
	private tui: TUI;
	private theme: Theme;
	private keybindings: KeybindingsManager;
	private shortcuts: ResolvedAskShortcuts;
	private onDone: (result: AskUIResult | null) => void;

	private mode: AskMode = "select";
	private pendingSelections: string[] = [];
	private freeformDraft = "";
	private commentDraft = "";

	// Static layout components
	private titleText: Text;
	private questionText: Text;
	private contextComponent?: Component;
	private modeContainer: Container;
	private helpText: Text;

	// Mode components
	private singleSelectList?: WrappedSingleSelectList;
	private multiSelectList?: MultiSelectList;
	private editor?: Editor;

	// Focusable — propagate to Editor for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		if (this.editor && (this.mode === "freeform" || this.mode === "comment")) {
			(this.editor as any).focused = value;
		}
	}

	constructor(
		question: string,
		context: string | undefined,
		options: QuestionOption[],
		allowMultiple: boolean,
		allowFreeform: boolean,
		allowComment: boolean,
		displayMode: AskDisplayMode,
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		shortcuts: ResolvedAskShortcuts,
		onDone: (result: AskUIResult | null) => void,
	) {
		super();

		this.question = question;
		this.context = context;
		this.options = options;
		this.allowMultiple = allowMultiple;
		this.allowFreeform = allowFreeform;
		this.allowComment = allowComment;
		this.displayMode = displayMode;
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.shortcuts = shortcuts;
		this.onDone = onDone;

		// Layout skeleton. The top/bottom box borders are not children — they are
		// drawn at full width directly in render(), wrapping the children below.
		this.addChild(new Spacer(1));

		this.titleText = new Text("", 1, 0);
		this.addChild(this.titleText);
		this.addChild(new Spacer(1));

		this.questionText = new Text("", 1, 0);
		this.addChild(this.questionText);

		if (this.context) {
			this.addChild(new Spacer(1));
			const mdTheme = safeMarkdownTheme();
			if (mdTheme) {
				this.contextComponent = new Markdown("", 1, 0, mdTheme);
			} else {
				this.contextComponent = new Text("", 1, 0);
			}
			this.addChild(this.contextComponent);
		}

		this.addChild(new Spacer(1));

		this.modeContainer = new Container();
		this.addChild(this.modeContainer);

		this.addChild(new Spacer(1));
		this.helpText = new Text("", 1, 0);
		this.addChild(this.helpText);

		this.addChild(new Spacer(1));

		this.updateStaticText();
		this.showSelectMode();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateStaticText();
		this.updateHelpText();
	}

	override render(width: number): string[] {
		const innerWidth = Math.max(1, width - BOX_BORDER_OVERHEAD);

		if (this.mode === "select" && !this.allowMultiple) {
			const overlayMaxHeight = Math.max(
				12,
				Math.floor(this.tui.terminal.rows * ASK_OVERLAY_MAX_HEIGHT_RATIO),
			);
			const staticLines = this.countStaticLines(innerWidth);
			const availableOptionRows = Math.max(4, overlayMaxHeight - staticLines);
			this.ensureSingleSelectList().setMaxVisibleRows(availableOptionRows);
		}

		// Render children at the inner width (excluding side border characters).
		const innerLines = super.render(innerWidth);

		const borderColor = (s: string) => this.theme.fg("accent", s);
		const titleColor = (s: string) => this.theme.fg("dim", this.theme.bold(s));
		const labelColor = (s: string) => this.theme.fg("dim", s);
		const bgFn = (s: string) => this.theme.bg("selectedBg", s);

		// Draw the top/bottom borders once at full width, wrapping each inner line
		// with side borders and a background color.
		const top = bgFn(
			new BoxBorderTop(borderColor, "ask_user", titleColor).render(width)[0],
		);
		const bottom = bgFn(
			new BoxBorderBottom(
				borderColor,
				`v${ASK_USER_VERSION}`,
				labelColor,
			).render(width)[0],
		);
		const body = innerLines.map((line) => {
			const padded = truncateToWidth(line, innerWidth, "", true);
			return bgFn(
				`${borderColor(BOX_BORDER_LEFT)}${padded}${borderColor(BOX_BORDER_RIGHT)}`,
			);
		});

		return [top, ...body, bottom];
	}

	private countWrappedLines(text: string, width: number): number {
		return Math.max(1, wrapTextWithAnsi(text, Math.max(10, width - 2)).length);
	}

	private countStaticLines(width: number): number {
		const titleLines = 1;
		const questionLines = this.countWrappedLines(this.question, width);
		const contextLines = this.context
			? 1 + this.countWrappedLines(this.context, width)
			: 0;
		const helpLines = 1;
		const borderLines = 2;
		const spacerLines = this.context ? 6 : 5;
		return (
			borderLines +
			spacerLines +
			titleLines +
			questionLines +
			contextLines +
			helpLines
		);
	}

	private updateStaticText(): void {
		const theme = this.theme;
		const title = this.mode === "comment" ? "Optional comment" : "Question";
		this.titleText.setText(theme.fg("accent", theme.bold(title)));
		this.questionText.setText(theme.fg("text", theme.bold(this.question)));
		if (this.contextComponent && this.context) {
			if (this.contextComponent instanceof Markdown) {
				(this.contextComponent as Markdown).setText(
					`**Context:**\n${this.context}`,
				);
			} else {
				(this.contextComponent as Text).setText(
					`${theme.fg("accent", theme.bold("Context:"))}\n${theme.fg("dim", this.context)}`,
				);
			}
		}
	}

	private updateHelpText(): void {
		const theme = this.theme;
		const overlayHint =
			this.displayMode === "overlay" && !this.shortcuts.overlayToggle.disabled
				? literalHint(theme, this.shortcuts.overlayToggle.spec, "hide")
				: null;
		const commentHint =
			this.allowComment && !this.shortcuts.commentToggle.disabled
				? literalHint(
						theme,
						this.shortcuts.commentToggle.spec,
						"toggle context",
					)
				: null;

		if (this.mode === "freeform" || this.mode === "comment") {
			const alternateCancelKeys = this.keybindings
				.getKeys("tui.select.cancel")
				.filter((key) => key !== "escape" && key !== "esc");
			const hints = [
				keybindingHint(
					theme,
					this.keybindings,
					"tui.input.submit",
					this.mode === "comment" ? "submit/skip" : "submit",
				),
				keybindingHint(theme, this.keybindings, "tui.input.newLine", "newline"),
				literalHint(theme, "esc", "back"),
				overlayHint,
				alternateCancelKeys.length > 0
					? literalHint(theme, formatKeyList(alternateCancelKeys), "cancel")
					: null,
			]
				.filter((h): h is string => !!h)
				.join(" • ");
			this.helpText.setText(theme.fg("dim", hints));
			return;
		}

		if (this.allowMultiple) {
			const hints = [
				literalHint(theme, "↑↓", "navigate"),
				literalHint(theme, "space", "toggle"),
				commentHint,
				overlayHint,
				keybindingHint(theme, this.keybindings, "tui.select.confirm", "submit"),
				keybindingHint(theme, this.keybindings, "tui.select.cancel", "cancel"),
			]
				.filter((h): h is string => !!h)
				.join(" • ");
			this.helpText.setText(theme.fg("dim", hints));
		} else {
			const alternateCancelKeys = this.keybindings
				.getKeys("tui.select.cancel")
				.filter((key) => key !== "escape" && key !== "esc");
			const hints = [
				literalHint(theme, "type", "filter"),
				keybindingHint(
					theme,
					this.keybindings,
					"tui.editor.deleteCharBackward",
					"erase",
				),
				literalHint(theme, "↑↓", "navigate"),
				commentHint,
				overlayHint,
				keybindingHint(theme, this.keybindings, "tui.select.confirm", "select"),
				literalHint(theme, "esc", "clear/cancel"),
				alternateCancelKeys.length > 0
					? literalHint(theme, formatKeyList(alternateCancelKeys), "cancel")
					: null,
			]
				.filter((h): h is string => !!h)
				.join(" • ");
			this.helpText.setText(theme.fg("dim", hints));
		}
	}

	private ensureSingleSelectList(): WrappedSingleSelectList {
		if (this.singleSelectList) return this.singleSelectList;

		const list = new WrappedSingleSelectList(
			this.options,
			this.allowFreeform,
			this.allowComment,
			this.theme,
			this.keybindings,
			this.shortcuts.commentToggle,
		);
		list.onSubmit = (result) =>
			this.handleSelectionSubmit([result], list.isCommentEnabled());
		list.onCancel = () => this.onDone(null);
		list.onEnterFreeform = () => this.showFreeformMode();

		this.singleSelectList = list;
		return list;
	}

	private ensureMultiSelectList(): MultiSelectList {
		if (this.multiSelectList) return this.multiSelectList;

		const list = new MultiSelectList(
			this.options,
			this.allowFreeform,
			this.allowComment,
			this.theme,
			this.keybindings,
			this.shortcuts.commentToggle,
		);
		list.onCancel = () => this.onDone(null);
		list.onSubmit = (result) =>
			this.handleSelectionSubmit(result, list.isCommentEnabled());
		list.onEnterFreeform = () => this.showFreeformMode();

		this.multiSelectList = list;
		return list;
	}

	private ensureEditor(): Editor {
		if (this.editor) return this.editor;
		const editor = new Editor(this.tui, createEditorTheme(this.theme));
		editor.disableSubmit = false;
		editor.onSubmit = (text: string) => {
			this.handleEditorSubmit(text);
		};
		this.editor = editor;
		return editor;
	}

	private saveEditorDraft(): void {
		if (!this.editor) return;
		const getText = (this.editor as any).getText;
		if (typeof getText !== "function") return;

		const currentText = String(getText.call(this.editor) ?? "");
		if (this.mode === "freeform") {
			this.freeformDraft = currentText;
		} else if (this.mode === "comment") {
			this.commentDraft = currentText;
		}
	}

	private setEditorText(text: string): void {
		const editor = this.ensureEditor();
		const setText = (editor as any).setText;
		if (typeof setText === "function") {
			setText.call(editor, text);
		}
	}

	private handleSelectionSubmit(
		selections: string[],
		wantsComment: boolean,
	): void {
		if (this.allowComment && wantsComment) {
			this.pendingSelections = selections;
			this.commentDraft = "";
			this.showCommentMode();
			return;
		}

		this.onDone(createSelectionResponse(selections));
	}

	private handleEditorSubmit(text: string): void {
		if (this.mode === "freeform") {
			this.onDone(createFreeformResponse(text));
			return;
		}

		if (this.mode === "comment") {
			this.commentDraft = text;
			this.onDone(createSelectionResponse(this.pendingSelections, text));
		}
	}

	private showSelectMode(): void {
		if (this.mode === "freeform" || this.mode === "comment") {
			this.saveEditorDraft();
		}

		this.mode = "select";
		this.pendingSelections = [];
		this.modeContainer.clear();

		if (this.allowMultiple) {
			this.modeContainer.addChild(this.ensureMultiSelectList());
		} else {
			this.modeContainer.addChild(this.ensureSingleSelectList());
		}

		this.updateHelpText();
		this.invalidate();
		this.tui.requestRender();
	}

	private showFreeformMode(): void {
		if (this.mode === "comment") {
			this.saveEditorDraft();
		}

		this.mode = "freeform";
		this.modeContainer.clear();

		const editor = this.ensureEditor();
		this.setEditorText(this.freeformDraft);
		(editor as any).focused = this._focused;

		this.modeContainer.addChild(
			new Text(
				this.theme.fg("accent", this.theme.bold("Custom response")),
				1,
				0,
			),
		);
		this.modeContainer.addChild(new Spacer(1));
		this.modeContainer.addChild(editor);

		this.updateHelpText();
		this.invalidate();
		this.tui.requestRender();
	}

	private showCommentMode(): void {
		if (this.mode === "freeform") {
			this.saveEditorDraft();
		}

		this.mode = "comment";
		this.modeContainer.clear();

		const editor = this.ensureEditor();
		this.setEditorText(this.commentDraft);
		(editor as any).focused = this._focused;

		const selectedLabel =
			this.pendingSelections.length === 1
				? "Selected option:"
				: "Selected options:";
		this.modeContainer.addChild(
			new Text(this.theme.fg("accent", this.theme.bold(selectedLabel)), 1, 0),
		);
		this.modeContainer.addChild(
			new Text(this.theme.fg("text", this.pendingSelections.join(", ")), 1, 0),
		);
		this.modeContainer.addChild(new Spacer(1));
		this.modeContainer.addChild(editor);

		this.updateHelpText();
		this.invalidate();
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.mode === "freeform" || this.mode === "comment") {
			if (matchesKey(data, Key.escape)) {
				this.showSelectMode();
				return;
			}

			if (this.keybindings.matches(data, "tui.select.cancel")) {
				this.onDone(null);
				return;
			}

			this.ensureEditor().handleInput(data);
			this.tui.requestRender();
			return;
		}

		if (this.allowMultiple) {
			this.ensureMultiSelectList().handleInput?.(data);
			this.tui.requestRender();
			return;
		}

		this.ensureSingleSelectList().handleInput?.(data);
		this.tui.requestRender();
	}
}
