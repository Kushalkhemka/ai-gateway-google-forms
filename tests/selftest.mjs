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
const providerSource = await readFile(path.join(root, "provider-config.js"), "utf8");
const content = await readFile(path.join(root, "content.js"), "utf8");
const clipboard = await readFile(path.join(root, "nptel-clipboard.js"), "utf8");
const genericFixture = await readFile(path.join(root, "tests/fixtures/generic-quiz.html"), "utf8");
const allSource = await Promise.all(
  (await readdir(root)).filter((name) => /\.(?:js|json|html|md)$/.test(name)).map((name) => readFile(path.join(root, name), "utf8"))
);

assert.match(background, /LIST_VISION_MODELS/);
assert.match(background, /AIProviderConfig\.chatRequest/);
assert.doesNotMatch(background, /providerOptions/);
assert.match(background, /response_format/);
assert.match(background, /delete requestBody\.response_format/);
assert.match(background, /Math\.max\(10,/);
assert.match(background, /inlineImages/);
assert.match(background, /base64/);
assert.match(background, /dataUrl/);
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
assert.ok(!allSource.join("\n").match(/(?:vck_|llmgtwy_|sk-or-v1-|nvapi-|AIza)[A-Za-z0-9_-]{20,}/), "An API key appears to be committed in source");

const providerSandbox = {};
runInNewContext(providerSource, providerSandbox);
const providers = providerSandbox.AIProviderConfig;
assert.deepEqual(Array.from(Object.keys(providers.definitions)), ["vercel", "google", "openrouter", "nvidia"]);

const vercelModels = providers.normalizeVisionModels("vercel", {
  data: [
    { id: "text-only", type: "language", modalities: { input: ["text"], output: ["text"] } },
    { id: "vision-model", name: "Vision Model", type: "language", modalities: { input: ["text", "image"], output: ["text"] } }
  ]
});
assert.deepEqual(Array.from(vercelModels, (entry) => entry.id), ["vision-model"]);

const openRouterModels = providers.normalizeVisionModels("openrouter", {
  data: [
    {
      id: "free/vision",
      name: "Free Vision",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { prompt: "0", completion: "0" }
    },
    { id: "audio-only", architecture: { input_modalities: ["audio"], output_modalities: ["text"] } }
  ]
});
assert.equal(openRouterModels.length, 1);
assert.equal(openRouterModels[0].free, true);

const googleModels = providers.normalizeVisionModels("google", {
  models: [
    { name: "models/gemini-3.7-flash", displayName: "Gemini 3.7 Flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1000000 },
    { name: "models/gemini-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }
  ]
});
assert.deepEqual(Array.from(googleModels, (entry) => entry.id), ["gemini-3.7-flash"]);

const nvidiaModels = providers.normalizeVisionModels("nvidia", {
  data: [
    { id: "meta/llama-3.2-11b-vision-instruct" },
    { id: "unknown/text-model" }
  ]
});
assert.deepEqual(Array.from(nvidiaModels, (entry) => entry.id), ["meta/llama-3.2-11b-vision-instruct"]);

const requestBody = { model: "example", messages: [] };
assert.equal(providers.chatRequest("google", "test-key", requestBody).url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
assert.equal(providers.chatRequest("openrouter", "test-key", requestBody).options.headers["HTTP-Referer"], "https://github.com/Kushalkhemka/ai-gateway-google-forms");
assert.equal(providers.chatRequest("nvidia", "test-key", requestBody).url, "https://integrate.api.nvidia.com/v1/chat/completions");

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
