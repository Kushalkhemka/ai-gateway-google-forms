const autofillButton = document.querySelector("#autofill");
const settingsButton = document.querySelector("#settings");
const statusText = document.querySelector("#status");
const dot = document.querySelector("#dot");
const buttonText = document.querySelector("#buttonText");
const spinner = document.querySelector("#spinner");
const modelText = document.querySelector("#model");
const PROVIDERS = {
  vercel: { label: "Vercel", defaultModel: "google/gemini-3.7-flash" },
  gemini: { label: "Gemini", defaultModel: "gemini-3.7-flash" },
  openai: { label: "OpenAI", defaultModel: "gpt-5.6" }
};

let activeTabId;

initialize();

async function initialize() {
  const [{ id, url } = {}] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = id;
  const settings = await chrome.storage.local.get(["provider", "apiKey", "apiKeys", "model", "models"]);
  const provider = normalizeProvider(settings.provider);
  const model = providerModel(settings, provider);
  modelText.textContent = `${PROVIDERS[provider].label} · ${model}`;

  if (!isSupportedUrl(url)) {
    setStatus("Open a supported assessment page.", "error");
    return;
  }
  if (!providerApiKey(settings, provider)) {
    setStatus(`Add your ${PROVIDERS[provider].label} key in Settings.`, "error");
    return;
  }

  try {
    const page = await chrome.tabs.sendMessage(activeTabId, { type: "PING" });
    if (!page?.isSupportedPage) {
      setStatus("No supported MCQ form was found on this page.", "error");
      return;
    }
    const label = page.site === "nptel"
      ? "NPTEL assessment"
      : page.site === "google_forms"
        ? "Google Form"
        : "web quiz";
    setStatus(`Ready to analyze this ${label}.`, "ready");
    autofillButton.disabled = false;
  } catch {
    setStatus("Reload the extension, then refresh this page.", "error");
  }
}

autofillButton.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Reading the complete form…", "ready");
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, { type: "AUTOFILL_FORM" });
    if (!result?.ok) throw new Error(result?.error || "Autofill failed.");
    const { filled, skipped, missing, imageCount } = result.result;
    setStatus(`Filled ${filled} field${filled === 1 ? "" : "s"}${imageCount ? ` using ${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}. ${skipped + missing ? `${skipped + missing} need review.` : "Review before submitting."}`, "ready");
  } catch (error) {
    setStatus(error.message || "Autofill failed.", "error");
  } finally {
    setBusy(false);
  }
});

settingsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

function setBusy(busy) {
  autofillButton.disabled = busy;
  spinner.hidden = !busy;
  buttonText.textContent = busy ? "Working…" : "Autofill again";
}

function isSupportedUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function normalizeProvider(value) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value) ? value : "vercel";
}

function providerApiKey(settings, provider) {
  const apiKeys = settings.apiKeys && typeof settings.apiKeys === "object" && !Array.isArray(settings.apiKeys)
    ? settings.apiKeys
    : {};
  if (typeof apiKeys[provider] === "string" && apiKeys[provider].trim()) return apiKeys[provider].trim();
  if (!settings.apiKeys && provider === "vercel") return String(settings.apiKey || "").trim();
  return "";
}

function providerModel(settings, provider) {
  const models = settings.models && typeof settings.models === "object" && !Array.isArray(settings.models)
    ? settings.models
    : {};
  return String(models[provider] || settings.model || PROVIDERS[provider].defaultModel).trim() || PROVIDERS[provider].defaultModel;
}

function setStatus(message, state) {
  statusText.textContent = message;
  dot.className = `dot ${state || ""}`;
}
