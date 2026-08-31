const DEFAULT_INSTRUCTIONS = "Answer accurately and naturally. For subjective answers, sound like a thoughtful student rather than a textbook or AI.";
const PROVIDERS = {
  vercel: {
    label: "Vercel AI Gateway",
    defaultModel: "google/gemini-3.7-flash",
    keyLabel: "Vercel AI Gateway API key",
    keyPlaceholder: "vck_...",
    providerHelp: "Uses Vercel AI Gateway routing with OpenAI-compatible chat completions.",
    modelHelp: "Use Vercel provider/model IDs, for example google/gemini-3.7-flash."
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-3.7-flash",
    keyLabel: "Google Gemini API key",
    keyPlaceholder: "AIza...",
    providerHelp: "Calls Google Gemini directly from the extension service worker.",
    modelHelp: "Use Gemini model IDs, for example gemini-3.7-flash."
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5.6",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-...",
    providerHelp: "Calls the OpenAI Responses API directly from the extension service worker.",
    modelHelp: "Use OpenAI model IDs, for example gpt-5.6."
  }
};

const form = document.querySelector("#form");
const provider = document.querySelector("#provider");
const apiKey = document.querySelector("#apiKey");
const apiKeyLabel = document.querySelector("#apiKeyLabel");
const apiKeyHelp = document.querySelector("#apiKeyHelp");
const model = document.querySelector("#model");
const modelHelp = document.querySelector("#modelHelp");
const maxImages = document.querySelector("#maxImages");
const instructions = document.querySelector("#instructions");
const providerHelp = document.querySelector("#providerHelp");
const saved = document.querySelector("#saved");
const toggle = document.querySelector("#toggle");

let apiKeys = {};
let models = {};
let activeProvider = "vercel";

restore();

async function restore() {
  const settings = await chrome.storage.local.get(["provider", "apiKey", "apiKeys", "model", "models", "maxImages", "instructions"]);
  activeProvider = normalizeProvider(settings.provider);
  provider.value = activeProvider;
  apiKeys = normalizedRecord(settings.apiKeys);
  models = normalizedRecord(settings.models);
  if (!settings.apiKeys && settings.apiKey) apiKeys[activeProvider] = settings.apiKey;
  if (!settings.models && settings.model) models[activeProvider] = settings.model;
  apiKey.value = apiKeys[activeProvider] || "";
  model.value = models[activeProvider] || PROVIDERS[activeProvider].defaultModel;
  maxImages.value = Math.max(10, Number(settings.maxImages) || 20);
  instructions.value = settings.instructions || DEFAULT_INSTRUCTIONS;
  updateProviderUi();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  rememberCurrentProviderFields();
  const selectedModel = models[activeProvider] || PROVIDERS[activeProvider].defaultModel;
  await chrome.storage.local.set({
    provider: activeProvider,
    apiKey: apiKeys[activeProvider] || "",
    apiKeys,
    model: selectedModel,
    models,
    maxImages: Math.max(10, Math.min(30, Number(maxImages.value) || 20)),
    instructions: instructions.value.trim() || DEFAULT_INSTRUCTIONS
  });
  saved.textContent = "Saved";
  setTimeout(() => (saved.textContent = ""), 1800);
});

provider.addEventListener("change", () => {
  rememberCurrentProviderFields();
  activeProvider = normalizeProvider(provider.value);
  apiKey.value = apiKeys[activeProvider] || "";
  model.value = models[activeProvider] || PROVIDERS[activeProvider].defaultModel;
  updateProviderUi();
});

apiKey.addEventListener("input", rememberCurrentProviderFields);
model.addEventListener("input", rememberCurrentProviderFields);

toggle.addEventListener("click", () => {
  const visible = apiKey.type === "text";
  apiKey.type = visible ? "password" : "text";
  toggle.textContent = visible ? "Show" : "Hide";
});

function rememberCurrentProviderFields() {
  apiKeys[activeProvider] = apiKey.value.trim();
  models[activeProvider] = model.value.trim() || PROVIDERS[activeProvider].defaultModel;
}

function updateProviderUi() {
  const config = PROVIDERS[activeProvider];
  apiKeyLabel.textContent = config.keyLabel;
  apiKey.placeholder = config.keyPlaceholder;
  apiKeyHelp.textContent = `Stored only in Chrome extension storage on this browser. Use a ${config.label} key.`;
  providerHelp.textContent = config.providerHelp;
  modelHelp.textContent = config.modelHelp;
}

function normalizeProvider(value) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value) ? value : "vercel";
}

function normalizedRecord(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const key of Object.keys(PROVIDERS)) {
    if (typeof value[key] === "string") result[key] = value[key].trim();
  }
  return result;
}
