import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
const autofillScript = manifest.content_scripts.find((script) => script.js.includes("content.js"));
const clipboardScript = manifest.content_scripts.find((script) => script.js.includes("nptel-clipboard.js"));
assert.ok(autofillScript.matches.includes("http://*/*"));
assert.ok(autofillScript.matches.includes("https://*/*"));
assert.equal(clipboardScript.run_at, "document_start");
assert.equal(clipboardScript.world, "MAIN");
assert.equal(clipboardScript.all_frames, true);
assert.ok(clipboardScript.matches.includes("https://*.nptel.ac.in/*"));
assert.ok(manifest.host_permissions.includes("http://*/*"));
assert.ok(manifest.host_permissions.includes("https://*/*"));

const javascript = (await readdir(root)).filter((name) => name.endsWith(".js"));
for (const file of javascript) {
  const check = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  assert.equal(check.status, 0, `${file} failed syntax validation:\n${check.stderr}`);
}

const background = await readFile(path.join(root, "background.js"), "utf8");
const content = await readFile(path.join(root, "content.js"), "utf8");
const clipboard = await readFile(path.join(root, "nptel-clipboard.js"), "utf8");
const optionsPage = await readFile(path.join(root, "options.html"), "utf8");
const optionsScript = await readFile(path.join(root, "options.js"), "utf8");
const popupScript = await readFile(path.join(root, "popup.js"), "utf8");
const genericFixture = await readFile(path.join(root, "tests/fixtures/generic-quiz.html"), "utf8");
const allSource = await Promise.all(
  (await readdir(root)).filter((name) => /\.(?:js|json|html|md)$/.test(name)).map((name) => readFile(path.join(root, name), "utf8"))
);

assert.match(background, /google\/gemini-3\.7-flash/);
assert.match(background, /api\.openai\.com\/v1\/responses/);
assert.match(background, /generativelanguage\.googleapis\.com\/v1beta\/models/);
assert.match(background, /responseJsonSchema/);
assert.match(background, /input_image/);
assert.match(background, /selectedProviderSettings/);
assert.match(background, /postOpenAIWithCompatibility/);
assert.match(background, /unsupportedOpenAIParameter/);
assert.doesNotMatch(background, /providerOptions/);
assert.match(background, /response_format/);
assert.match(background, /Math\.max\(10,/);
assert.match(background, /inlineImages/);
assert.match(background, /base64/);
assert.match(background, /dataUrl/);
const openAISection = background.slice(
  background.indexOf("async function requestOpenAIAnswers"),
  background.indexOf("async function requestGeminiAnswers")
);
assert.doesNotMatch(openAISection, /temperature/, "OpenAI Responses requests should not send temperature; some model families reject it.");
for (const fieldType of ["short_text", "paragraph", "radio", "checkbox", "dropdown", "date", "time", "code", "file_upload"]) {
  assert.ok(content.includes(`"${fieldType}"`), `Missing support marker for ${fieldType}`);
}
assert.ok(content.includes("collectFormLevelImages"));
assert.match(content, /event\.ctrlKey \|\| event\.metaKey/);
assert.match(content, /window\.addEventListener\("keydown", handleShortcut, true\)/);
assert.match(content, /window\.addEventListener\("keyup", handleShortcut, true\)/);
assert.match(content, /extractNptelAssessment/);
assert.match(content, /extractGenericAssessment/);
assert.match(content, /site: "generic_web"/);
assert.match(content, /genericQuestionContainer/);
assert.match(content, /commonControlContainer/);
assert.doesNotMatch(content, /\.submit\(/);
assert.match(content, /main\.programming-assessment-main/);
assert.match(content, /fillAceEditor/);
assert.match(clipboard, /clipboardEvents/);
assert.match(clipboard, /isClipboardShortcut/);
assert.match(clipboard, /user-select: text !important/);
assert.doesNotMatch(clipboard, /pointer-events:\s*auto/);
for (const provider of ["vercel", "gemini", "openai"]) {
  assert.match(optionsPage, new RegExp(`value="${provider}"`));
  assert.match(optionsScript, new RegExp(`${provider}:`));
  assert.match(popupScript, new RegExp(`${provider}:`));
}
assert.ok(!allSource.join("\n").match(/(?:vck_|llmgtwy_)[A-Za-z0-9_-]{20,}/), "An API key appears to be committed in source");

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener));
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) {
      if (typeof listener === "function") listener.call(this, event);
      else listener.handleEvent.call(listener, event);
    }
  }
}

const fakeWindow = new FakeEventTarget();
const fakeDocument = new FakeEventTarget();
fakeDocument.documentElement = new FakeEventTarget();
fakeDocument.body = new FakeEventTarget();
const injectedStyles = [];
fakeDocument.head = { appendChild: (node) => injectedStyles.push(node) };
fakeDocument.createElement = () => ({});
fakeDocument.getElementById = (id) => injectedStyles.find((node) => node.id === id) || null;
runInNewContext(clipboard, {
  window: fakeWindow,
  document: fakeDocument,
  EventTarget: FakeEventTarget,
  setInterval: () => 1
});

let rootCopyCalls = 0;
fakeDocument.addEventListener("copy", () => { rootCopyCalls += 1; });
fakeDocument.dispatchEvent({ type: "copy" });
assert.equal(rootCopyCalls, 0, "Page-root copy blockers should not be installed");

let elementCopyCalls = 0;
const editorElement = new FakeEventTarget();
editorElement.addEventListener("copy", () => { elementCopyCalls += 1; });
editorElement.dispatchEvent({ type: "copy" });
assert.equal(elementCopyCalls, 1, "Element-level editor listeners should remain active");

let rootKeyCalls = 0;
fakeWindow.addEventListener("keydown", () => { rootKeyCalls += 1; });
fakeWindow.dispatchEvent({ type: "keydown", key: "c", ctrlKey: true, metaKey: false, altKey: false });
fakeWindow.dispatchEvent({ type: "keydown", key: "Enter", ctrlKey: true, metaKey: false, altKey: false });
assert.equal(rootKeyCalls, 1, "Only clipboard keyboard shortcuts should bypass page-root handlers");
assert.equal(injectedStyles[0]?.id, "ai-gateway-nptel-copy-style");
assert.match(genericFixture, /input type="radio"/);
assert.match(genericFixture, /input type="checkbox"/);
assert.match(genericFixture, /<select required>/);
assert.match(genericFixture, /<textarea/);
assert.match(genericFixture, /Not submitted/);

console.log(`Self-test passed: ${javascript.length} scripts, secure configuration, and generic multimodal quiz support.`);
