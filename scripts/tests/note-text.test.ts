import assert from "node:assert/strict";
import { test } from "node:test";
import { notePlainText } from "../../src/lib/noteText.ts";

test("note text preserves a plain first line before rich-text paragraphs", () => {
  assert.equal(notePlainText("Today I wanted<div>Hello</div><div>Third line</div>"), "Today I wanted\nHello\nThird line");
  assert.equal(notePlainText("<p>First</p><p>Second<br>Third</p>"), "First\nSecond\nThird");
  assert.equal(notePlainText("<ul><li>First</li><li>Second</li></ul>"), "First\nSecond");
  assert.equal(notePlainText("<p>A &amp; B</p>"), "A & B");
  assert.equal(notePlainText("<p>4 * 2 = 8 and 1 &lt; 2</p>"), "4 * 2 = 8 and 1 < 2");
});
