import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeOsc99Notification } from "../src/notification.ts";

test("OSC 99 frames encode and chunk arbitrary UTF-8 text", () => {
	const title = "Pi: question for you";
	const body = `Line 1\n\u001b]99;injected;payload\u001b\\\n${"💬".repeat(1500)}`;
	const encoded = encodeOsc99Notification(title, body, "test-id");
	const frames = [...encoded.matchAll(/\u001b\]99;([^;]*);([^\u001b]*)\u001b\\/g)];
	assert.ok(frames.length > 2);
	assert.equal(frames.map((frame) => frame[0]).join(""), encoded);

	const decoded = { title: "", body: "" };
	for (const [index, frame] of frames.entries()) {
		const metadata = Object.fromEntries(frame[1]!.split(":").map((entry) => entry.split("=")));
		assert.equal(metadata.i, "test-id");
		assert.equal(metadata.e, "1");
		assert.equal(metadata.d, index === frames.length - 1 ? "1" : "0");
		assert.ok(metadata.p === "title" || metadata.p === "body");
		assert.ok(Buffer.from(frame[2]!, "base64").length <= 2048);
		assert.ok(frame[2]!.length <= 4096);
		decoded[metadata.p] += Buffer.from(frame[2]!, "base64").toString("utf8");
	}
	assert.equal(decoded.title, title);
	assert.equal(decoded.body, body);
	assert.equal(Buffer.from(frames[0]![1]!.match(/f=([^:]+)/)![1]!, "base64").toString(), "pi-ask-user");
	assert.equal(Buffer.from(frames[0]![1]!.match(/t=([^:]+)/)![1]!, "base64").toString(), "question");
});

test("empty notification emits no escape sequence", () => {
	assert.equal(encodeOsc99Notification("", ""), "");
});
