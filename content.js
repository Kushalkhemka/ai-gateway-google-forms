(() => {
  const runtime = {
    fieldNodes: new Map(),
    running: false
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ isRespondentView: isRespondentForm() });
      return false;
    }
    if (message?.type !== "AUTOFILL_FORM") return false;
    runAutofill()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Autofill failed." }));
    return true;
  });

  const handleShortcut = (event) => {
    const modifierPressed = event.ctrlKey || event.metaKey;
    const enterPressed = event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
    if (!modifierPressed || event.altKey || !enterPressed) return;
    if (!isRespondentForm()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (runtime.running) return;
    runAutofill().catch(() => {});
  };

  window.addEventListener("keydown", handleShortcut, true);
  window.addEventListener("keyup", handleShortcut, true);

  function isRespondentForm() {
    return location.hostname === "docs.google.com" && location.pathname.includes("/forms/") && !!document.querySelector("form");
  }

  async function runAutofill() {
    if (runtime.running) throw new Error("AI Gateway is already working on this form.");
    runtime.running = true;
    await setProcessing(true);
    try {
      const form = await extractForm();
      if (!form.questions.length) throw new Error("No supported Google Form questions were found.");
      const response = await chrome.runtime.sendMessage({ type: "SOLVE_FORM", payload: form });
      if (!response?.ok) throw new Error(response?.error || "The AI request failed.");
      const summary = await applyAnswers(response.result.answers);
      return { ...summary, imageCount: response.result.imageCount };
    } finally {
      runtime.running = false;
      await setProcessing(false);
    }
  }

  async function extractForm() {
    runtime.fieldNodes.clear();
    const formElement = document.querySelector("form");
    const title = cleanText(document.querySelector('[role="heading"][aria-level="1"], [role="heading"]')?.textContent) || document.title;
    const description = cleanText(
      document.querySelector('[role="heading"][aria-level="1"]')?.parentElement?.nextElementSibling?.textContent || ""
    );
    const containers = findQuestionContainers(formElement);
    const questions = [];
    const images = [];

    for (let qIndex = 0; qIndex < containers.length; qIndex += 1) {
      const container = containers[qIndex];
      const questionId = `q${qIndex + 1}`;
      const headings = [...container.querySelectorAll('[role="heading"]')].filter(isVisible);
      const questionTitle = cleanText(headings[0]?.textContent) || `Question ${qIndex + 1}`;
      const questionDescription = getQuestionDescription(container, headings[0]);
      const required = !!container.querySelector('[aria-label*="Required" i], [data-required="true"]') || /\*\s*$/.test(questionTitle);
      const imageRefs = collectQuestionImages(container, questionId, images);
      const fields = await extractFields(container, questionId, questionTitle);
      if (fields.length) {
        questions.push({
          id: questionId,
          title: questionTitle.replace(/\s*\*\s*$/, ""),
          description: questionDescription,
          required,
          imageRefs,
          fields
        });
      }
    }

    collectFormLevelImages(formElement, containers, images);

    return { title, description, url: location.href, questions, images };
  }

  function findQuestionContainers(formElement) {
    if (!formElement) return [];
    const controlSelector = 'input:not([type="hidden"]), textarea, [role="radio"], [role="checkbox"], [role="listbox"], [role="slider"], input[type="date"], input[type="time"]';
    const candidates = [...formElement.querySelectorAll('[role="listitem"]')].filter(
      (element) => isVisible(element) && element.querySelector(controlSelector)
    );
    return candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
  }

  async function extractFields(container, questionId, questionTitle) {
    const fields = [];
    const claimed = new Set();

    const radioGroups = [...container.querySelectorAll('[role="radiogroup"]')].filter(isVisible);
    if (radioGroups.length) {
      radioGroups.forEach((group, index) => {
        const options = [...group.querySelectorAll('[role="radio"]')].filter(isVisible);
        if (!options.length) return;
        options.forEach((node) => claimed.add(node));
        fields.push(registerField(questionId, fields.length, {
          type: "radio",
          label: fieldLabel(group, questionTitle, radioGroups.length > 1 ? index : null),
          allowedOptions: options.map(optionLabel).filter(Boolean)
        }, { type: "choice", root: group, options }));
      });
    } else {
      const radios = [...container.querySelectorAll('[role="radio"]')].filter(isVisible);
      if (radios.length) {
        radios.forEach((node) => claimed.add(node));
        fields.push(registerField(questionId, fields.length, {
          type: "radio",
          label: questionTitle,
          allowedOptions: radios.map(optionLabel).filter(Boolean)
        }, { type: "choice", root: container, options: radios }));
      }
    }

    const checkboxGroups = [...container.querySelectorAll('[role="group"]')].filter(
      (group) => isVisible(group) && group.querySelector('[role="checkbox"]')
    );
    if (checkboxGroups.length > 1) {
      checkboxGroups.forEach((group, index) => {
        const options = [...group.querySelectorAll('[role="checkbox"]')].filter(isVisible);
        options.forEach((node) => claimed.add(node));
        fields.push(registerField(questionId, fields.length, {
          type: "checkbox",
          label: fieldLabel(group, questionTitle, index),
          allowedOptions: options.map(optionLabel).filter(Boolean)
        }, { type: "choice", root: group, options }));
      });
    } else {
      const checkboxes = [...container.querySelectorAll('[role="checkbox"]')].filter(isVisible);
      if (checkboxes.length) {
        checkboxes.forEach((node) => claimed.add(node));
        fields.push(registerField(questionId, fields.length, {
          type: "checkbox",
          label: questionTitle,
          allowedOptions: checkboxes.map(optionLabel).filter(Boolean)
        }, { type: "choice", root: container, options: checkboxes }));
      }
    }

    for (const listbox of [...container.querySelectorAll('[role="listbox"]')].filter(isVisible)) {
      const options = await readDropdownOptions(listbox);
      fields.push(registerField(questionId, fields.length, {
        type: "dropdown",
        label: listbox.getAttribute("aria-label") || questionTitle,
        allowedOptions: options
      }, { type: "dropdown", root: listbox }));
    }

    const textControls = [...container.querySelectorAll('textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"]):not([type="button"])')]
      .filter((node) => isVisible(node) && !node.closest('[role="listbox"]'));

    textControls.forEach((node, index) => {
      const htmlType = (node.getAttribute("type") || "text").toLowerCase();
      let type = node.tagName === "TEXTAREA" ? "paragraph" : "short_text";
      let format = "plain text";
      if (htmlType === "date") { type = "date"; format = "YYYY-MM-DD"; }
      if (htmlType === "time") { type = "time"; format = "HH:MM in 24-hour time"; }
      if (htmlType === "number") { type = "number"; format = "number"; }
      fields.push(registerField(questionId, fields.length, {
        type,
        label: node.getAttribute("aria-label") || node.getAttribute("placeholder") || (textControls.length > 1 ? `${questionTitle} — part ${index + 1}` : questionTitle),
        format,
        allowedOptions: []
      }, { type: "text", root: node }));
    });

    const fileInput = [...container.querySelectorAll('input[type="file"]')].find(isVisible);
    if (fileInput) {
      fields.push(registerField(questionId, fields.length, {
        type: "file_upload",
        label: questionTitle,
        allowedOptions: []
      }, { type: "unsupported", root: fileInput }));
    }

    return fields;
  }

  function registerField(questionId, index, modelField, nodeField) {
    const id = `${questionId}_f${index + 1}`;
    runtime.fieldNodes.set(id, nodeField);
    return { id, ...modelField };
  }

  async function readDropdownOptions(listbox) {
    const existing = [...listbox.querySelectorAll('[role="option"]')].filter(isVisible).map(optionLabel).filter(isRealDropdownOption);
    if (existing.length) return unique(existing);
    listbox.click();
    await delay(120);
    const openOptions = [...document.querySelectorAll('[role="option"]')]
      .filter(isVisible)
      .map(optionLabel)
      .filter(isRealDropdownOption);
    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await delay(40);
    return unique(openOptions);
  }

  function isRealDropdownOption(label) {
    return !!label && !/^(choose|select|please select)( an option)?$/i.test(label);
  }

  function collectQuestionImages(container, questionId, allImages) {
    const refs = [];
    const imageNodes = [...container.querySelectorAll("img")].filter((img) => {
      const src = img.currentSrc || img.src;
      const rect = img.getBoundingClientRect();
      return src && isVisible(img) && rect.width >= 48 && rect.height >= 48 && !/icon|avatar|logo/i.test(`${img.alt} ${img.className}`);
    });
    imageNodes.forEach((img, index) => {
      const ref = `${questionId}_image${index + 1}`;
      const url = img.currentSrc || img.src;
      if (!url || allImages.some((item) => item.url === url && item.ref.startsWith(questionId))) return;
      refs.push(ref);
      allImages.push({ ref, url, alt: img.alt || "" });
    });
    return refs;
  }

  function collectFormLevelImages(formElement, questionContainers, allImages) {
    const unclaimed = [...formElement.querySelectorAll("img")].filter((img) => {
      if (questionContainers.some((container) => container.contains(img))) return false;
      const src = img.currentSrc || img.src;
      const rect = img.getBoundingClientRect();
      return src && isVisible(img) && rect.width >= 80 && rect.height >= 60 && !/icon|avatar|logo/i.test(`${img.alt} ${img.className}`);
    });
    unclaimed.forEach((img, index) => {
      const url = img.currentSrc || img.src;
      if (!url || allImages.some((item) => item.url === url)) return;
      allImages.push({ ref: `form_image${index + 1}`, url, alt: img.alt || "Form-level image" });
    });
  }

  async function applyAnswers(answers) {
    let filled = 0;
    let skipped = 0;
    let missing = 0;

    for (const answer of answers) {
      const field = runtime.fieldNodes.get(answer.fieldId);
      if (!field) { missing += 1; continue; }
      if (answer.action === "skip" || field.type === "unsupported") { skipped += 1; continue; }
      const values = Array.isArray(answer.values) ? answer.values.map(String).filter(Boolean) : [];
      if (!values.length) { skipped += 1; continue; }

      let didFill = false;
      if (field.type === "text") didFill = fillText(field.root, values.join("\n"));
      if (field.type === "choice") didFill = fillChoices(field.options, values);
      if (field.type === "dropdown") didFill = await fillDropdown(field.root, values[0]);
      didFill ? (filled += 1) : (missing += 1);
      await delay(35);
    }
    return { filled, skipped, missing };
  }

  function fillText(element, value) {
    element.focus();
    const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    return element.value === value;
  }

  function fillChoices(options, values) {
    let matches = 0;
    const wanted = values.map(normalize);
    options.forEach((option) => {
      const shouldSelect = wanted.includes(normalize(optionLabel(option)));
      const checked = option.getAttribute("aria-checked") === "true";
      if (shouldSelect && !checked) option.click();
      if (!shouldSelect && checked && option.getAttribute("role") === "checkbox") option.click();
      if (shouldSelect) matches += 1;
    });
    return matches === wanted.length && matches > 0;
  }

  async function fillDropdown(listbox, value) {
    listbox.click();
    await delay(100);
    const target = [...document.querySelectorAll('[role="option"]')].filter(isVisible).find((option) => normalize(optionLabel(option)) === normalize(value));
    if (!target) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      return false;
    }
    target.click();
    return true;
  }

  function getQuestionDescription(container, heading) {
    if (!heading) return "";
    const text = cleanText(container.innerText);
    const title = cleanText(heading.textContent);
    const controls = [...container.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]')].map(optionLabel);
    let remainder = text.replace(title, "");
    controls.forEach((label) => { remainder = remainder.replace(label, ""); });
    return cleanText(remainder).slice(0, 1000);
  }

  function fieldLabel(group, fallback, rowIndex) {
    const aria = cleanText(group.getAttribute("aria-label"));
    if (aria && !/^question$/i.test(aria)) return aria;
    const row = group.closest('[role="group"], [role="row"]');
    const heading = cleanText(row?.querySelector('[role="heading"], [role="rowheader"]')?.textContent);
    return heading || (rowIndex === null ? fallback : `${fallback} — row ${Number(rowIndex) + 1}`);
  }

  function optionLabel(element) {
    return cleanText(
      element.getAttribute("data-value") ||
      element.getAttribute("aria-label") ||
      element.querySelector('[data-value], [aria-label]')?.getAttribute("data-value") ||
      element.textContent
    );
  }

  function normalize(value) {
    return cleanText(value).toLocaleLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  }

  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function setProcessing(processing) {
    try {
      await chrome.runtime.sendMessage({ type: "SET_PROCESSING", processing });
    } catch {
      // The toolbar icon is only a visual indicator; autofill should continue if it cannot update.
    }
  }
})();
