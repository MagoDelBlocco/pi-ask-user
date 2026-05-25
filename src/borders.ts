/**
 * Box border components for the ask_user UI.
 */

import type { Component } from "@earendil-works/pi-tui";

export class BoxBorderTop implements Component {
	private color: (s: string) => string;
	private title?: string;
	private titleColor?: (s: string) => string;

	constructor(
		color: (s: string) => string,
		title?: string,
		titleColor?: (s: string) => string,
	) {
		this.color = color;
		this.title = title;
		this.titleColor = titleColor;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(0, width - 2);
		if (!this.title || inner < this.title.length + 4) {
			return [this.color(`╭${"─".repeat(inner)}╮`)];
		}
		const label = ` ${this.title} `;
		const remaining = inner - 1 - label.length;
		const titleStyle = this.titleColor ?? this.color;
		return [
			this.color("╭─") +
				titleStyle(label) +
				this.color("─".repeat(Math.max(0, remaining)) + "╮"),
		];
	}
}

export class BoxBorderBottom implements Component {
	private color: (s: string) => string;
	private label?: string;
	private labelColor?: (s: string) => string;

	constructor(
		color: (s: string) => string,
		label?: string,
		labelColor?: (s: string) => string,
	) {
		this.color = color;
		this.label = label;
		this.labelColor = labelColor;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const inner = Math.max(0, width - 2);
		if (!this.label || inner < this.label.length + 4) {
			return [this.color(`╰${"─".repeat(inner)}╯`)];
		}
		const tag = ` ${this.label} `;
		const leftDashes = inner - tag.length - 1;
		const style = this.labelColor ?? this.color;
		return [
			this.color("╰" + "─".repeat(Math.max(0, leftDashes))) +
				style(tag) +
				this.color("─╯"),
		];
	}
}
