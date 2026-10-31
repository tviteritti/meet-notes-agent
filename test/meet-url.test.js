import assert from "node:assert/strict";
import test from "node:test";
import { meetCall } from "../extension/meet-url.js";

test("reconoce la llamada aunque la otra cuenta entre por lookup", () => {
  assert.equal(meetCall("https://meet.google.com/abc-defg-hij"), true);
  assert.equal(meetCall("https://meet.google.com/abc-defg-hij?authuser=1"), true);
  assert.equal(meetCall("https://meet.google.com/lookup/c2dhdn5hqs?authuser=1&hs=179"), true);
  assert.equal(meetCall("https://meet.google.com/?authuser=1"), false);
  assert.equal(meetCall("https://meet.google.com/landing"), false);
  assert.equal(meetCall("https://mail.google.com/mail/"), false);
});
