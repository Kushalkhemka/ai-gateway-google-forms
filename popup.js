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
  const settings = await chrome.storage.local.get(["apiKey", "model"]);
  modelText.textContent = settings.model || "google/gemini-3.7-flash";

  if (!isSupportedUrl(url)) {
    setStatus("Open a supported assessment page.", "error");
    return;
  }
  if (!settings.apiKey) {
    setStatus("Add your Vercel AI Gateway key in Settings.", "error");
    return;
  }

  try {
    const page = await chrome.tabs.sendMessage(activeTabId, { type: "PING" });
    if (!page?.isSupportedPage) throw new Error("Unsupported page");
    const label = page.site === "nptel" ? "NPTEL assessment" : "Google Form";
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
  return url?.startsWith("https://docs.google.com/forms/") ||
    url?.startsWith("https://onlinecourses.nptel.ac.in/e-learning/course/");
}

function setStatus(message, state) {
  statusText.textContent = message;
  dot.className = `dot ${state || ""}`;
}
