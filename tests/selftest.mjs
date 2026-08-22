import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.content_scripts[0].matches.includes("https://docs.google.com/forms/*"));
assert.ok(manifest.content_scripts[0].matches.includes("https://onlinecourses.nptel.ac.in/e-learning/course/*"));
assert.ok(manifest.host_permissions.includes("https://ai-gateway.vercel.sh/*"));
assert.ok(manifest.host_permissions.includes("https://storage.googleapis.com/*"));

const javascript = (await readdir(root)).filter((name) => name.endsWith(".js"));
for (const file of javascript) {
  const check = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  assert.equal(check.status, 0, `${file} failed syntax validation:\n${check.stderr}`);
}

const background = await readFile(path.join(root, "background.js"), "utf8");
const content = await readFile(path.join(root, "content.js"), "utf8");
const allSource = await Promise.all(
  (await readdir(root)).filter((name) => /\.(?:js|json|html|md)$/.test(name)).map((name) => readFile(path.join(root, name), "utf8"))
);

assert.match(background, /google\/gemini-3\.7-flash/);
assert.doesNotMatch(background, /providerOptions/);
assert.match(background, /response_format/);
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
assert.match(content, /main\.programming-assessment-main/);
assert.match(content, /fillAceEditor/);
assert.ok(!allSource.join("\n").match(/(?:vck_|llmgtwy_)[A-Za-z0-9_-]{20,}/), "An API key appears to be committed in source");

console.log(`Self-test passed: ${javascript.length} scripts, secure configuration, multimodal Google Forms and NPTEL support.`);
