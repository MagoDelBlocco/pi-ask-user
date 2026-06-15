/**
 * Ask User Extension — Interactive question UI for pi-coding-agent.
 *
 * Registers the ask_user tool with searchable split-pane selection,
 * multi-select, freeform input, desktop notifications, and overlay/inline modes.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type, type TUnsafe } from "@sinclair/typebox";
import { type OverlayHandle, Text, type TUI } from "@earendil-works/pi-tui";

import type {
	AskDisplayMode,
	AskOptionInput,
	AskToolDetails,
	AskUIResult,
	QuestionOption,
} from "./src/types";
import { AskComponent } from "./src/ask-component";
import {
	FREEFORM_SENTINEL,
	buildCustomUIOptions,
	createFreeformResponse,
	createSelectionResponse,
	formatOptionsForMessage,
	formatResponseSummary,
	isCancelledInput,
	isSelectionResponse,
	normalizeOptions,
	notifyUser,
	parseDialogSelections,
	resolveDisplayMode,
	resolveShortcuts,
} from "./src/utils";

// ── StringEnum helper (Google-compatible flat enum) ──────────────────────────

function StringEnum<const T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: [...values],
		...(options?.description ? { description: options.description } : {}),
		...(options?.default !== undefined ? { default: options.default } : {}),
	});
}

// ── Abort helpers ────────────────────────────────────────────────────────────

const ABORTED = Symbol("aborted");

/**
 * Race a UI interaction against an abort signal. The underlying dialog promise
 * cannot be cancelled, but once aborted we stop waiting on it and treat the
 * interaction as cancelled.
 */
async function raceAbort<T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T | typeof ABORTED> {
	if (!signal) return promise;
	if (signal.aborted) return ABORTED;
	return new Promise<T | typeof ABORTED>((resolve) => {
		const onAbort = () => resolve(ABORTED);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			() => {
				signal.removeEventListener("abort", onAbort);
				resolve(ABORTED);
			},
		);
	});
}

// ── RPC/headless fallback ────────────────────────────────────────────────────

async function askViaDialogs(
	ui: { select: Function; input: Function },
	question: string,
	context: string | undefined,
	options: QuestionOption[],
	allowMultiple: boolean,
	allowFreeform: boolean,
	allowComment: boolean,
	timeout?: number,
	signal?: AbortSignal,
): Promise<AskUIResult | null> {
	const dialogOpts = timeout ? { timeout } : undefined;
	const prompt = context ? `${question}\n\nContext:\n${context}` : question;

	if (allowMultiple) {
		const rawSelections = await raceAbort(
			ui.input(
				`${prompt}\n\nOptions (select one or more):\n${formatOptionsForMessage(options)}`,
				"Type your selection(s)...",
				dialogOpts,
			) as Promise<string | undefined>,
			signal,
		);
		if (rawSelections === ABORTED || isCancelledInput(rawSelections))
			return null;

		const selections = parseDialogSelections(rawSelections);
		if (selections.length === 0) return null;

		if (!allowComment) {
			return createSelectionResponse(selections);
		}

		const comment = await raceAbort(
			ui.input(
				`${prompt}\n\nSelected options:\n${selections.join("\n")}`,
				"Optional comment (press Enter to skip)...",
				dialogOpts,
			) as Promise<string | undefined>,
			signal,
		);
		return createSelectionResponse(
			selections,
			comment === ABORTED ? undefined : comment,
		);
	}

	const selectOptions = options.map((o) => o.title);
	if (allowFreeform) selectOptions.push(FREEFORM_SENTINEL);

	const selected = await raceAbort(
		ui.select(prompt, selectOptions, dialogOpts) as Promise<string | undefined>,
		signal,
	);
	if (selected === ABORTED || isCancelledInput(selected)) return null;

	if (selected === FREEFORM_SENTINEL) {
		const answer = await raceAbort(
			ui.input(prompt, "Type your answer...", dialogOpts) as Promise<
				string | undefined
			>,
			signal,
		);
		if (answer === ABORTED || isCancelledInput(answer)) return null;
		return createFreeformResponse(answer);
	}

	if (!allowComment) {
		return createSelectionResponse([selected]);
	}

	const comment = await raceAbort(
		ui.input(
			`${prompt}\n\nSelected option:\n${selected}`,
			"Optional comment (press Enter to skip)...",
			dialogOpts,
		) as Promise<string | undefined>,
		signal,
	);
	return createSelectionResponse(
		[selected],
		comment === ABORTED ? undefined : comment,
	);
}

// ── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user a clarifying question. Supports multiple-choice options, freeform text input, and optional comments. Use for ambiguous requirements, architectural decisions, or any choice requiring human judgment.",
		promptSnippet:
			"Ask the user one focused question with optional multiple-choice answers to gather information interactively",
		promptGuidelines: [
			"Ask early rather than guessing — it is better to clarify than to build the wrong thing.",
			"Before calling ask_user, gather context with tools (read/web/ref) and pass a concise summary via the context field.",
			"Ask exactly one focused question per ask_user call.",
			"Use ask_user for: ambiguous requirements, preference choices, scope decisions, architectural trade-offs, or any time you are unsure what the user wants.",
			"When in doubt, ask.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user" }),
			context: Type.Optional(
				Type.String({
					description:
						"Relevant context to show before the question (summary of findings)",
				}),
			),
			options: Type.Optional(
				Type.Array(
					Type.Union([
						Type.String({ description: "Short title for this option" }),
						Type.Object({
							title: Type.String({
								description: "Short title for this option",
							}),
							description: Type.Optional(
								Type.String({
									description: "Longer description explaining this option",
								}),
							),
						}),
					]),
					{ description: "List of options for the user to choose from" },
				),
			),
			allowMultiple: Type.Optional(
				Type.Boolean({
					description: "Allow selecting multiple options. Default: false",
				}),
			),
			allowFreeform: Type.Optional(
				Type.Boolean({
					description: "Add a freeform text option. Default: true",
				}),
			),
			allowComment: Type.Optional(
				Type.Boolean({
					description:
						"Collect an optional comment after selecting one or more options. Default: false",
				}),
			),
			displayMode: Type.Optional(
				StringEnum(["overlay", "inline"] as const, {
					description:
						"UI rendering mode. 'overlay' shows a centered modal, 'inline' renders in-place. Default: PI_ASK_USER_DISPLAY_MODE env var if set, otherwise 'overlay'. Omit to respect the user's configured preference.",
				}),
			),
			overlayToggleKey: Type.Optional(
				Type.String({
					description:
						"Shortcut for hiding/showing the overlay popup (overlay mode only), e.g. 'alt+o' or 'ctrl+shift+h'. Pass 'off' to disable. Default: PI_ASK_USER_OVERLAY_TOGGLE_KEY env var if set, otherwise 'alt+o'.",
				}),
			),
			commentToggleKey: Type.Optional(
				Type.String({
					description:
						"Shortcut for toggling the optional comment/extra-context row when allowComment is true, e.g. 'ctrl+g'. Pass 'off' to disable. Default: PI_ASK_USER_COMMENT_TOGGLE_KEY env var if set, otherwise 'ctrl+g'.",
				}),
			),
			timeout: Type.Optional(
				Type.Number({
					description:
						"Auto-dismiss after N milliseconds. Returns null (cancelled) when expired.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Cancelled" }],
					details: {
						question: params.question,
						options: [],
						response: null,
						cancelled: true,
					} as AskToolDetails,
				};
			}

			const {
				question,
				context,
				options: rawOptions = [],
				allowMultiple = false,
				allowFreeform = true,
				allowComment = false,
				displayMode,
				overlayToggleKey,
				commentToggleKey,
				timeout,
			} = params as {
				question: string;
				context?: string;
				options?: AskOptionInput[];
				allowMultiple?: boolean;
				allowFreeform?: boolean;
				allowComment?: boolean;
				displayMode?: AskDisplayMode;
				overlayToggleKey?: string | null;
				commentToggleKey?: string | null;
				timeout?: number;
			};

			const effectiveDisplayMode = resolveDisplayMode(displayMode);
			const shortcuts = resolveShortcuts(overlayToggleKey, commentToggleKey);
			const options = normalizeOptions(rawOptions);
			const normalizedContext = context?.trim() || undefined;

			// No UI available — report error
			if (!ctx.hasUI || !ctx.ui) {
				const optionText =
					options.length > 0
						? `\n\nOptions:\n${formatOptionsForMessage(options)}`
						: "";
				const freeformHint = allowFreeform
					? "\n\nYou can also answer freely."
					: "";
				const commentHint = allowComment
					? "\n\nAfter choosing an option, you may add an optional comment."
					: "";
				const contextText = normalizedContext
					? `\n\nContext:\n${normalizedContext}`
					: "";
				return {
					content: [
						{
							type: "text",
							text: `Ask requires interactive mode. Please answer:\n\n${question}${contextText}${optionText}${freeformHint}${commentHint}`,
						},
					],
					isError: true,
					details: {
						question,
						context: normalizedContext,
						options,
						response: null,
						cancelled: true,
					} as AskToolDetails,
				};
			}

			// No options — just ask for freeform text
			if (options.length === 0) {
				const prompt = normalizedContext
					? `${question}\n\nContext:\n${normalizedContext}`
					: question;
				notifyUser("Pi: question for you", question);
				const answer = await raceAbort(
					ctx.ui.input(
						prompt,
						"Type your answer...",
						timeout ? { timeout } : undefined,
					) as Promise<string | undefined>,
					signal,
				);
				const response =
					answer === ABORTED ? null : createFreeformResponse(answer);

				if (!response) {
					return {
						content: [{ type: "text", text: "User cancelled the question" }],
						details: {
							question,
							context: normalizedContext,
							options,
							response: null,
							cancelled: true,
						} as AskToolDetails,
					};
				}

				pi.events.emit("ask:answered", {
					question,
					context: normalizedContext,
					response,
				});
				return {
					content: [
						{
							type: "text",
							text: `User answered: ${formatResponseSummary(response)}`,
						},
					],
					details: {
						question,
						context: normalizedContext,
						options,
						response,
						cancelled: false,
					} as AskToolDetails,
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: "Waiting for user input..." }],
				details: {
					question,
					context: normalizedContext,
					options,
					response: null,
					cancelled: false,
				},
			});

			// Fire a desktop notification so the user is alerted outside the terminal.
			notifyUser("Pi: question for you", question);

			let result: AskUIResult | null;
			let overlayHandle: OverlayHandle | undefined;
			let removeOverlayInputListener: (() => void) | undefined;
			let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
			let hasAnnouncedHide = false;

			try {
				const customFactory = (
					tui: TUI,
					theme: Theme,
					keybindings: any,
					done: (result: AskUIResult | null) => void,
				) => {
					if (signal) {
						const onAbort = () => done(null);
						signal.addEventListener("abort", onAbort, { once: true });
					}

					if (timeout && timeout > 0) {
						timeoutTimer = setTimeout(() => done(null), timeout);
					}

					return new AskComponent(
						question,
						normalizedContext,
						options,
						allowMultiple,
						allowFreeform,
						allowComment,
						effectiveDisplayMode,
						tui,
						theme,
						keybindings,
						shortcuts,
						done,
					);
				};

				// Register a raw terminal input listener for the overlay-toggle key so the
				// overlay can be toggled even while it is hidden (hidden overlays do not
				// receive input). Inline mode does not need this because the prompt is
				// already non-modal. Skipped entirely if the user disabled the shortcut.
				const overlayToggle = shortcuts.overlayToggle;
				if (
					effectiveDisplayMode === "overlay" &&
					!overlayToggle.disabled &&
					typeof ctx.ui.onTerminalInput === "function"
				) {
					removeOverlayInputListener = ctx.ui.onTerminalInput((data) => {
						if (!overlayToggle.matches(data) || !overlayHandle)
							return undefined;
						const nextHidden = !overlayHandle.isHidden();
						overlayHandle.setHidden(nextHidden);
						if (nextHidden && !hasAnnouncedHide) {
							hasAnnouncedHide = true;
							ctx.ui.notify?.(
								`ask_user hidden — press ${overlayToggle.spec} to reopen`,
								"info",
							);
						}
						return { consume: true };
					});
				}

				const customResult = await ctx.ui.custom<AskUIResult | null>(
					customFactory,
					buildCustomUIOptions(effectiveDisplayMode, (handle) => {
						overlayHandle = handle;
					}),
				);

				if (customResult !== undefined) {
					result = customResult;
				} else {
					// RPC/headless mode: degrade to select()/input() dialog protocol
					result = await askViaDialogs(
						ctx.ui,
						question,
						normalizedContext,
						options,
						allowMultiple,
						allowFreeform,
						allowComment,
						timeout,
						signal,
					);
				}
			} catch (error) {
				const message =
					error instanceof Error
						? `${error.message}\n${error.stack ?? ""}`
						: String(error);
				return {
					content: [{ type: "text", text: `Ask tool failed: ${message}` }],
					isError: true,
					details: { error: message },
				};
			} finally {
				if (timeoutTimer) clearTimeout(timeoutTimer);
				removeOverlayInputListener?.();
			}

			if (result === null) {
				pi.events.emit("ask:cancelled", {
					question,
					context: normalizedContext,
					options,
				});
				return {
					content: [{ type: "text", text: "User cancelled the question" }],
					details: {
						question,
						context: normalizedContext,
						options,
						response: null,
						cancelled: true,
					} as AskToolDetails,
				};
			}

			pi.events.emit("ask:answered", {
				question,
				context: normalizedContext,
				response: result,
			});
			return {
				content: [
					{
						type: "text",
						text: `User answered: ${formatResponseSummary(result)}`,
					},
				],
				details: {
					question,
					context: normalizedContext,
					options,
					response: result,
					cancelled: false,
				} as AskToolDetails,
			};
		},

		renderCall(args, theme) {
			const question = (args.question as string) || "";
			const rawOptions = Array.isArray(args.options) ? args.options : [];
			let text = theme.fg("toolTitle", theme.bold("ask_user "));
			text += theme.fg("muted", question);
			if (rawOptions.length > 0) {
				const labels = rawOptions.map((o: unknown) =>
					typeof o === "string" ? o : ((o as QuestionOption)?.title ?? ""),
				);
				text +=
					"\n" +
					theme.fg(
						"dim",
						`  ${rawOptions.length} option(s): ${labels.join(", ")}`,
					);
			}
			if (args.allowMultiple) {
				text += theme.fg("dim", " [multi-select]");
			}
			if (args.allowComment) {
				text += theme.fg("dim", " [optional comment]");
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, options, theme) {
			const details = result.details as
				| (AskToolDetails & { error?: string })
				| undefined;

			if (details?.error) {
				return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
			}

			if (options.isPartial) {
				const waitingText =
					result.content
						?.filter(
							(part: { type?: string; text?: string }) => part?.type === "text",
						)
						.map((part: { text?: string }) => part.text ?? "")
						.join("\n")
						.trim() || "Waiting for user input...";
				return new Text(theme.fg("muted", waitingText), 0, 0);
			}

			if (!details || details.cancelled || !details.response) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}

			const response = details.response;
			let text = theme.fg("success", "✓ ");
			if (response.kind === "freeform") {
				text += theme.fg("muted", "(wrote) ");
			}
			text += theme.fg("accent", formatResponseSummary(response));

			if (options.expanded) {
				text += "\n" + theme.fg("dim", `Q: ${details.question}`);
				if (details.context) {
					text += "\n" + theme.fg("dim", details.context);
				}

				if (isSelectionResponse(response) && details.options.length > 0) {
					const selectedTitles = new Set(response.selections);
					text += "\n" + theme.fg("dim", "Options:");
					for (const opt of details.options) {
						const desc = opt.description ? ` — ${opt.description}` : "";
						const marker = selectedTitles.has(opt.title)
							? theme.fg("success", "●")
							: theme.fg("dim", "○");
						text += `\n  ${marker} ${theme.fg("dim", opt.title)}${theme.fg(
							"dim",
							desc,
						)}`;
					}
					if (response.comment) {
						text += `\n${theme.fg("dim", "Comment:")} ${theme.fg(
							"dim",
							response.comment,
						)}`;
					}
				}
			}

			return new Text(text, 0, 0);
		},
	});
}
