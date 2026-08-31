const DEFAULT_INSTRUCTIONS = "Answer accurately and naturally. For subjective answers, sound like a thoughtful student rather than a textbook or AI.";
const form = document.querySelector("#form");
const providerSelect = document.querySelector("#provider");
const providerDescription = document.querySelector("#providerDescription");
const apiKey = document.querySelector("#apiKey");
const apiKeyLabel = document.querySelector("#apiKeyLabel");
const apiKeyLink = document.querySelector("#apiKeyLink");
const model = document.querySelector("#model");
const refreshModels = document.querySelector("#refreshModels");
const modelStatus = document.querySelector("#modelStatus");
const maxImages = document.querySelector("#maxImages");
const instructions = document.querySelector("#instructions");
const saved = document.querySelector("#saved");
const toggle = document.querySelector("#toggle");

let providerKeys = {};
let providerModels = {};
let activeProvider = "vercel";
let modelLoadId = 0;

initialize();

async function initialize() {
  for (const provider of Object.values(AIProviderConfig.definitions)) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    providerSelect.append(option);
  }

  const settings = await readSettings([
    "provider", "providerKeys", "providerModels", "apiKey", "model", "maxImages", "instructions"
  ]);
  providerKeys = { ...(settings.providerKeys || {}) };
  providerModels = { ...(settings.providerModels || {}) };
  if (settings.apiKey && !providerKeys.vercel) providerKeys.vercel = settings.apiKey;
  if (settings.model && !providerModels.vercel) providerModels.vercel = settings.model;

  activeProvider = AIProviderConfig.provider(settings.provider).id;
  providerSelect.value = activeProvider;
  maxImages.value = Math.max(10, Number(settings.maxImages) || 20);
  instructions.value = settings.instructions || DEFAULT_INSTRUCTIONS;
  await showProvider(activeProvider);
}

providerSelect.addEventListener("change", async () => {
  rememberCurrentProvider();
  activeProvider = AIProviderConfig.provider(providerSelect.value).id;
  await showProvider(activeProvider);
});

refreshModels.addEventListener("click", async () => {
  rememberCurrentProvider();
  await loadModels(activeProvider);
});

model.addEventListener("change", () => {
  providerModels[activeProvider] = model.value;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  rememberCurrentProvider();
  if (!providerKeys[activeProvider]) {
    apiKey.focus();
    modelStatus.textContent = `Add a ${AIProviderConfig.provider(activeProvider).label} API key first.`;
    modelStatus.className = "help warning";
    return;
  }

  await writeSettings({
    provider: activeProvider,
    providerKeys,
    providerModels,
    model: providerModels[activeProvider],
    maxImages: Math.max(10, Math.min(30, Number(maxImages.value) || 20)),
    instructions: instructions.value.trim() || DEFAULT_INSTRUCTIONS
  });
  saved.textContent = "Saved";
  setTimeout(() => (saved.textContent = ""), 1800);
});

toggle.addEventListener("click", () => {
  const visible = apiKey.type === "text";
  apiKey.type = visible ? "password" : "text";
  toggle.textContent = visible ? "Show" : "Hide";
});

async function showProvider(providerId) {
  const provider = AIProviderConfig.provider(providerId);
  providerDescription.textContent = provider.description;
  apiKeyLabel.textContent = `${provider.shortLabel} API key`;
  apiKey.placeholder = provider.keyPlaceholder;
  apiKey.value = providerKeys[provider.id] || "";
  apiKeyLink.href = provider.keyUrl;
  apiKeyLink.textContent = "Get a key";
  model.replaceChildren();
  await loadModels(provider.id);
}

function rememberCurrentProvider() {
  providerKeys[activeProvider] = apiKey.value.trim();
  if (model.value) providerModels[activeProvider] = model.value;
}

async function loadModels(providerId) {
  const loadId = ++modelLoadId;
  const provider = AIProviderConfig.provider(providerId);
  model.disabled = true;
  refreshModels.disabled = true;
  modelStatus.textContent = "Finding vision-capable models…";
  modelStatus.className = "help";

  let response;
  try {
    response = await requestModels(providerId, providerKeys[providerId] || apiKey.value.trim());
  } catch (error) {
    response = { ok: false, error: error.message };
  }
  if (loadId !== modelLoadId) return;

  const models = response?.models?.length
    ? response.models
    : AIProviderConfig.fallbackVisionModels(providerId);
  renderModels(models, providerModels[providerId] || provider.defaultModel);
  model.disabled = false;
  refreshModels.disabled = false;

  if (response?.warning || !response?.ok) {
    modelStatus.textContent = response?.warning || response?.error || "Showing the verified fallback list.";
    modelStatus.className = "help warning";
  } else {
    modelStatus.textContent = `${models.length} vision-capable model${models.length === 1 ? "" : "s"} available.`;
    modelStatus.className = "help success";
  }
}

function renderModels(models, preferredModel) {
  model.replaceChildren();
  for (const entry of models) {
    const option = document.createElement("option");
    option.value = entry.id;
    const details = ["Vision"];
    if (entry.free) details.push("Free");
    if (entry.contextWindow) details.push(formatContext(entry.contextWindow));
    option.textContent = `${entry.name || entry.id} · ${details.join(" · ")}`;
    model.append(option);
  }

  const available = [...model.options].some((option) => option.value === preferredModel);
  model.value = available ? preferredModel : model.options[0]?.value || "";
  providerModels[activeProvider] = model.value;
}

function formatContext(value) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M context`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K context`;
  return `${value} context`;
}

async function readSettings(keys) {
  if (!globalThis.chrome?.storage?.local?.get) return {};
  return chrome.storage.local.get(keys);
}

async function writeSettings(values) {
  if (!globalThis.chrome?.storage?.local?.set) return;
  await chrome.storage.local.set(values);
}

async function requestModels(provider, key) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return {
      ok: true,
      models: AIProviderConfig.fallbackVisionModels(provider),
      warning: "Showing the verified fallback list until the extension is loaded."
    };
  }
  return chrome.runtime.sendMessage({ type: "LIST_VISION_MODELS", provider, apiKey: key });
}
