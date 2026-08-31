const autofillButton = document.querySelector("#autofill");
const settingsButton = document.querySelector("#settings");
const statusText = document.querySelector("#status");
const dot = document.querySelector("#dot");
const buttonText = document.querySelector("#buttonText");
const spinner = document.querySelector("#spinner");
const modelText = document.querySelector("#model");

let activeTabId;

initialize();

async function initialize() {
  const [{ id, url } = {}] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = id;
  const settings = await chrome.storage.local.get([
    "provider", "providerKeys", "providerModels", "apiKey", "model"
  ]);
  const provider = AIProviderConfig.provider(settings.provider);
  const providerKeys = { ...(settings.providerKeys || {}) };
  const providerModels = { ...(settings.providerModels || {}) };
  if (settings.apiKey && !providerKeys.vercel) providerKeys.vercel = settings.apiKey;
  if (settings.model && !providerModels.vercel) providerModels.vercel = settings.model;
  const selectedModel = providerModels[provider.id] || provider.defaultModel;
  modelText.textContent = `${provider.label} · ${selectedModel}`;

  if (!isSupportedUrl(url)) {
    setStatus("Open a supported assessment page.", "error");
    return;
  }
  if (!providerKeys[provider.id]) {
    setStatus(`Add your ${provider.label} API key in Settings.`, "error");
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

function setStatus(message, state) {
  statusText.textContent = message;
  dot.className = `dot ${state || ""}`;
}
