(() => {
  const definitions = {
    vercel: {
      id: "vercel",
      label: "Vercel AI Gateway",
      shortLabel: "Vercel",
      keyPlaceholder: "vck_…",
      keyUrl: "https://vercel.com/ai-gateway",
      description: "Automatic provider routing, failover, budgets, and one unified key.",
      chatUrl: "https://ai-gateway.vercel.sh/v1/chat/completions",
      modelsUrl: "https://ai-gateway.vercel.sh/v1/models",
      modelsRequireKey: false,
      defaultModel: "google/gemini-3.7-flash",
      strictJsonSchema: true
    },
    google: {
      id: "google",
      label: "Google AI Studio",
      shortLabel: "Google",
      keyPlaceholder: "AIza…",
      keyUrl: "https://aistudio.google.com/app/apikey",
      description: "Direct Gemini access through Google AI Studio's official OpenAI-compatible API.",
      chatUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      modelsRequireKey: true,
      defaultModel: "gemini-3.7-flash",
      strictJsonSchema: false
    },
    openrouter: {
      id: "openrouter",
      label: "OpenRouter",
      shortLabel: "OpenRouter",
      keyPlaceholder: "sk-or-v1-…",
      keyUrl: "https://openrouter.ai/settings/keys",
      description: "A large live catalog with image-input models and free-model options when available.",
      chatUrl: "https://openrouter.ai/api/v1/chat/completions",
      modelsUrl: "https://openrouter.ai/api/v1/models?input_modalities=image&output_modalities=text",
      modelsRequireKey: true,
      defaultModel: "google/gemini-3.7-flash",
      strictJsonSchema: false
    },
    nvidia: {
      id: "nvidia",
      label: "NVIDIA NIM Free API",
      shortLabel: "NVIDIA NIM",
      keyPlaceholder: "nvapi-…",
      keyUrl: "https://build.nvidia.com/",
      description: "Direct access to NVIDIA-hosted vision-language model endpoints for prototyping.",
      chatUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
      modelsUrl: "https://integrate.api.nvidia.com/v1/models",
      modelsRequireKey: true,
      defaultModel: "meta/llama-3.2-11b-vision-instruct",
      strictJsonSchema: false
    }
  };

  const fallbackModels = {
    vercel: [
      { id: "google/gemini-3.7-flash", name: "Gemini 3.7 Flash", vision: true },
      { id: "google/gemini-3.1-pro", name: "Gemini 3.1 Pro", vision: true }
    ],
    google: [
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", vision: true },
      { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", vision: true }
    ],
    openrouter: [
      { id: "google/gemini-3.7-flash", name: "Google: Gemini 3.7 Flash", vision: true },
      { id: "google/gemini-3.1-pro", name: "Google: Gemini 3.1 Pro", vision: true },
      { id: "meta-llama/llama-4-maverick", name: "Meta: Llama 4 Maverick", vision: true }
    ],
    nvidia: [
      { id: "meta/llama-3.2-11b-vision-instruct", name: "Llama 3.2 11B Vision Instruct", vision: true, free: true },
      { id: "qwen/qwen3.5-122b-a10b", name: "Qwen 3.5 122B A10B", vision: true, free: true },
      { id: "nvidia/cosmos3-nano-reasoner", name: "Cosmos 3 Nano Reasoner", vision: true, free: true }
    ]
  };

  const nvidiaVisionIds = new Set(fallbackModels.nvidia.map((model) => model.id));

  function provider(providerId) {
    return definitions[providerId] || definitions.vercel;
  }

  function listFromPayload(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ["data", "models", "items", "results"]) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }

  function stringArray(value) {
    return Array.isArray(value) ? value.map((item) => String(item).toLowerCase()) : [];
  }

  function inputModalities(record) {
    return stringArray(
      record?.architecture?.input_modalities ||
      record?.modalities?.input ||
      record?.input_modalities ||
      record?.inputModalities
    );
  }

  function outputModalities(record) {
    return stringArray(
      record?.architecture?.output_modalities ||
      record?.modalities?.output ||
      record?.output_modalities ||
      record?.outputModalities
    );
  }

  function modalityStringHasImage(record) {
    const raw = record?.architecture?.modality || record?.modality;
    if (typeof raw !== "string") return false;
    return raw.toLowerCase().split("->")[0].includes("image");
  }

  function hasVisionInput(record) {
    return record?.vision === true || record?.supports_vision === true || record?.supportsVision === true ||
      inputModalities(record).includes("image") || modalityStringHasImage(record);
  }

  function hasTextOutput(record) {
    const modalities = outputModalities(record);
    return modalities.length === 0 || modalities.includes("text");
  }

  function priceIsZero(pricing) {
    if (!pricing || typeof pricing !== "object") return false;
    const values = [pricing.prompt, pricing.completion, pricing.input, pricing.output]
      .filter((value) => value !== undefined)
      .map(Number);
    return values.length > 0 && values.every((value) => Number.isFinite(value) && value === 0);
  }

  function isGoogleVisionModel(record) {
    const id = String(record?.baseModelId || record?.name || "").replace(/^models\//, "");
    const methods = record?.supportedGenerationMethods || record?.supported_actions || [];
    if (!String(id).startsWith("gemini-")) return false;
    if (!/^gemini-(?:1\.5|[2-9](?:\.|-))/i.test(id)) return false;
    if (!methods.includes("generateContent")) return false;
    return !/(?:embedding|image|tts|transcribe|robotics|live|computer-use|deep-research|veo)/i.test(id);
  }

  function normalizeVisionModels(providerId, payload) {
    const rows = listFromPayload(payload);
    const models = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      let id = String(row.id || row.baseModelId || row.name || "").replace(/^models\//, "").trim();
      if (!id) continue;
      let vision = hasVisionInput(row);
      if (providerId === "google") vision = isGoogleVisionModel(row);
      if (providerId === "nvidia") vision = vision || nvidiaVisionIds.has(id);
      if (!vision || !hasTextOutput(row)) continue;
      if (providerId === "vercel" && row.type && row.type !== "language") continue;
      const name = String(row.displayName || row.name || id).replace(/^models\//, "");
      models.push({
        id,
        name,
        vision: true,
        free: providerId === "nvidia" || priceIsZero(row.pricing),
        contextWindow: Number(row.context_window || row.context_length || row.inputTokenLimit) || undefined
      });
    }
    const deduped = [...new Map(models.map((model) => [model.id, model])).values()];
    return deduped.sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name)).slice(0, 300);
  }

  function fallbackVisionModels(providerId) {
    return (fallbackModels[providerId] || fallbackModels.vercel).map((model) => ({ ...model }));
  }

  function modelListRequest(providerId, apiKey) {
    const selected = provider(providerId);
    const headers = { Accept: "application/json" };
    if (apiKey?.trim()) {
      if (providerId === "google") headers["x-goog-api-key"] = apiKey.trim();
      else headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    return { url: selected.modelsUrl, options: { method: "GET", headers } };
  }

  function chatRequest(providerId, apiKey, requestBody) {
    const selected = provider(providerId);
    const headers = {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json"
    };
    if (providerId === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/Kushalkhemka/ai-gateway-google-forms";
      headers["X-Title"] = "AI Gateway Web Quiz Autofill";
    }
    return {
      url: selected.chatUrl,
      options: { method: "POST", headers, body: JSON.stringify(requestBody) }
    };
  }

  globalThis.AIProviderConfig = Object.freeze({
    definitions: Object.freeze(definitions),
    provider,
    normalizeVisionModels,
    fallbackVisionModels,
    modelListRequest,
    chatRequest
  });
})();
