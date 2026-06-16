/**
 * Normalization, formatting, and shortcut resolution utilities.
 */

import {
	type EditorTheme,
	type KeybindingsManager,
	type SelectListTheme,
	matchesKey,
	type Theme,
} from "@earendil-works/pi-tui";
import type {
	AskDisplayMode,
	AskOptionInput,
	AskResponse,
	QuestionOption,
	ResolvedAskShortcuts,
	ResolvedShortcut,
} from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

const SHORTCUT_DISABLE_VALUES = new Set(["off", "none", "disabled", ""]);
const DEFAULT_OVERLAY_TOGGLE_KEY = "alt+o";
const DEFAULT_COMMENT_TOGGLE_KEY = "ctrl+g";
const FREEFORM_SENTINEL = "\u270f\ufe0f Type custom response...";
const COMMENT_TOGGLE_LABEL = "Add extra context after selection";
const FREEFORM_TITLE = "Type something.";
const FREEFORM_HINT = "Enter a custom response";

// ── Option normalization ─────────────────────────────────────────────────────

export function normalizeOptions(options: AskOptionInput[]): QuestionOption[] {
	return options
		.map((option) => {
			if (typeof option === "string") return { title: option };
			if (
				option &&
				typeof option === "object" &&
				typeof option.title === "string"
			)
				return { title: option.title, description: option.description };
			return null;
		})
		.filter((option): option is QuestionOption => option !== null);
}

export function formatOptionsForMessage(options: QuestionOption[]): string {
	return options
		.map((option, index) => {
			const desc = option.description ? ` — ${option.description}` : "";
			return `${index + 1}. ${option.title}${desc}`;
		})
		.join("\n");
}

// ── Response helpers ─────────────────────────────────────────────────────────

export function normalizeOptionalComment(
	text: string | null | undefined,
): string | undefined {
	const trimmed = text?.trim();
	return trimmed ? trimmed : undefined;
}

export function createFreeformResponse(
	text: string | null | undefined,
): AskResponse | null {
	const trimmed = text?.trim();
	return trimmed ? { kind: "freeform", text: trimmed } : null;
}

export function createSelectionResponse(
	selections: string[],
	comment?: string | null,
): AskResponse | null {
	const normalized = selections.map((s) => s.trim()).filter(Boolean);
	if (normalized.length === 0) return null;
	const normalizedComment = normalizeOptionalComment(comment);
	return normalizedComment
		? { kind: "selection", selections: normalized, comment: normalizedComment }
		: { kind: "selection", selections: normalized };
}

export function formatResponseSummary(response: AskResponse): string {
	if (response.kind === "freeform") return response.text;
	const selections = response.selections.join(", ");
	return response.comment ? `${selections} — ${response.comment}` : selections;
}

export function parseDialogSelections(input: string): string[] {
	return input
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function isCancelledInput(value: unknown): value is null | undefined {
	return value === null || value === undefined;
}

export function isSelectionResponse(
	response: AskResponse,
): response is Extract<AskResponse, { kind: "selection" }> {
	return response.kind === "selection";
}

// ── Shortcut resolution ──────────────────────────────────────────────────────

const DISABLED_SHORTCUT: ResolvedShortcut = {
	disabled: true,
	spec: null,
	matches: ((_data: string) => false) as (data: string) => false,
};

function normalizeShortcutSpec(
	value: string | null | undefined,
): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	const trimmed = value.trim().toLowerCase();
	if (SHORTCUT_DISABLE_VALUES.has(trimmed)) return null;
	return trimmed;
}

function isValidShortcutSpec(spec: string): boolean {
	if (!spec) return false;
	if (!/^[a-z0-9+\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]+$/i.test(spec))
		return false;
	if (spec.startsWith("+") || spec.endsWith("+")) return false;
	if (spec.includes("++")) return false;
	return true;
}

function buildShortcut(spec: string): ResolvedShortcut {
	return {
		disabled: false,
		spec,
		matches: (data: string) => matchesKey(data, spec as any),
	};
}

export function resolveShortcut(
	paramValue: string | null | undefined,
	envValue: string | undefined,
	defaultSpec: string,
): ResolvedShortcut {
	const candidates: Array<string | null | undefined> = [
		paramValue,
		envValue,
		defaultSpec,
	];
	for (const raw of candidates) {
		const normalized = normalizeShortcutSpec(raw);
		if (normalized === undefined) continue;
		if (normalized === null) return DISABLED_SHORTCUT;
		if (isValidShortcutSpec(normalized)) return buildShortcut(normalized);
	}
	return DISABLED_SHORTCUT;
}

export function resolveShortcuts(
	overlayToggleKey: string | null | undefined,
	commentToggleKey: string | null | undefined,
): ResolvedAskShortcuts {
	return {
		overlayToggle: resolveShortcut(
			overlayToggleKey,
			process.env.PI_ASK_USER_OVERLAY_TOGGLE_KEY,
			DEFAULT_OVERLAY_TOGGLE_KEY,
		),
		commentToggle: resolveShortcut(
			commentToggleKey,
			process.env.PI_ASK_USER_COMMENT_TOGGLE_KEY,
			DEFAULT_COMMENT_TOGGLE_KEY,
		),
	};
}

// ── Display mode resolution ──────────────────────────────────────────────────

export function resolveDisplayMode(
	paramDisplayMode: AskDisplayMode | undefined,
): AskDisplayMode {
	const envMode = process.env.PI_ASK_USER_DISPLAY_MODE;
	const envDisplayMode: AskDisplayMode | undefined =
		envMode === "overlay" || envMode === "inline" ? envMode : undefined;
	return paramDisplayMode ?? envDisplayMode ?? "overlay";
}

// ── Custom UI options builder ────────────────────────────────────────────────

const ASK_OVERLAY_MAX_HEIGHT_RATIO = 0.85;
const ASK_OVERLAY_WIDTH = "92%";
const ASK_OVERLAY_MIN_WIDTH = 40;

import type { OverlayHandle } from "@earendil-works/pi-tui";

export function buildCustomUIOptions(
	displayMode: AskDisplayMode,
	onHandle?: (handle: OverlayHandle) => void,
) {
	if (displayMode === "inline") return undefined;
	return {
		overlay: true,
		overlayOptions: {
			anchor: "center" as const,
			width: ASK_OVERLAY_WIDTH,
			minWidth: ASK_OVERLAY_MIN_WIDTH,
			maxHeight: "85%",
			margin: 1,
		},
		...(onHandle ? { onHandle } : {}),
	};
}

// ── Keybinding helpers ───────────────────────────────────────────────────────

export function formatKeyList(keys: string[]): string {
	return keys.join("/");
}

export function keybindingHint(
	theme: Theme,
	keybindings: KeybindingsManager,
	keybinding: any,
	description: string,
): string {
	return `${theme.fg("dim", formatKeyList(keybindings.getKeys(keybinding)))}${theme.fg("muted", ` ${description}`)}`;
}

export function literalHint(
	theme: Theme,
	key: string,
	description: string,
): string {
	return `${theme.fg("dim", key)}${theme.fg("muted", ` ${description}`)}`;
}

// ── Markdown theme safety ────────────────────────────────────────────────────

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";

export function safeMarkdownTheme(): MarkdownTheme | undefined {
	try {
		const md = getMarkdownTheme();
		if (!md) return undefined;
		md.bold("");
		return md;
	} catch {
		return undefined;
	}
}

// ── Notification ─────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";

export function notifyUser(summary: string, body: string): void {
	try {
		const child = spawn("notify-send", [summary, body], {
			detached: true,
			stdio: "ignore",
		});
		// A missing notify-send surfaces as an asynchronous "error" event
		// (ENOENT), not a synchronous throw. Without this listener Node would
		// rethrow it as an uncaught exception, so swallow it here.
		child.on("error", () => {});
		child.unref();
	} catch {
		// Defensive: spawn can also throw synchronously on invalid arguments.
	}
}

// ── Exported constants for consumers ─────────────────────────────────────────

export {
	FREEFORM_SENTINEL,
	COMMENT_TOGGLE_LABEL,
	FREEFORM_TITLE,
	FREEFORM_HINT,
	ASK_OVERLAY_MAX_HEIGHT_RATIO,
};

// ── Theme factories ──────────────────────────────────────────────────────────

export function createSelectListTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};
}

export function createEditorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (s: string) => theme.fg("accent", s),
		selectList: createSelectListTheme(theme),
	};
}
