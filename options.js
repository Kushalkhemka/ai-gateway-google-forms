const DEFAULT_INSTRUCTIONS = "Answer accurately and naturally. For subjective answers, sound like a thoughtful student rather than a textbook or AI.";
const form = document.querySelector("#form");
const apiKey = document.querySelector("#apiKey");
const model = document.querySelector("#model");
const maxImages = document.querySelector("#maxImages");
const instructions = document.querySelector("#instructions");
const saved = document.querySelector("#saved");
const toggle = document.querySelector("#toggle");

restore();

async function restore() {
  const settings = await chrome.storage.local.get(["apiKey", "model", "maxImages", "instructions"]);
  apiKey.value = settings.apiKey || "";
  model.value = settings.model || "google/gemini-3.7-flash";
  maxImages.value = Math.max(10, Number(settings.maxImages) || 20);
  instructions.value = settings.instructions || DEFAULT_INSTRUCTIONS;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.local.set({
    apiKey: apiKey.value.trim(),
    model: "google/gemini-3.7-flash",
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
