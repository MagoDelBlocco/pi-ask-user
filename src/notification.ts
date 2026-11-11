import { randomUUID } from "node:crypto";

const MAX_PAYLOAD_BYTES = 2048;
const OSC = "\u001b]99;";
const ST = "\u001b\\";
const APP_NAME = Buffer.from("pi-ask-user").toString("base64");
const NOTIFICATION_TYPE = Buffer.from("question").toString("base64");

/** Build a Kitty OSC 99 notification without embedding untrusted text in escapes. */
export function encodeOsc99Notification(title: string, body: string, id = randomUUID()): string {
	const parts: Array<{ kind: "title" | "body"; payload: string }> = [];
	for (const [kind, value] of [["title", title], ["body", body]] as const) {
		const bytes = Buffer.from(value, "utf8");
		for (let offset = 0; offset < bytes.length;) {
			let end = Math.min(offset + MAX_PAYLOAD_BYTES, bytes.length);
			// Keep each UTF-8 character intact when the terminal decodes a chunk.
			if (end < bytes.length) {
				while (end > offset && (bytes[end]! & 0xc0) === 0x80) end--;
			}
			parts.push({
				kind,
				payload: bytes.subarray(offset, end).toString("base64"),
			});
			offset = end;
		}
	}
	if (parts.length === 0) return "";

	return parts
		.map(({ kind, payload }, index) => {
			const done = index === parts.length - 1 ? 1 : 0;
			const identity = index === 0 ? `:f=${APP_NAME}:t=${NOTIFICATION_TYPE}` : "";
			return `${OSC}i=${id}:d=${done}:e=1:p=${kind}${identity};${payload}${ST}`;
		})
		.join("");
}

export function notifyUser(title: string, body: string): void {
	if (!process.stdout.isTTY) return;
	const notification = encodeOsc99Notification(title, body);
	if (notification) process.stdout.write(notification);
}
