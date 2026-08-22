(() => {
  const runtime = {
    fieldNodes: new Map(),
    running: false
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({ isSupportedPage: isSupportedPage(), site: detectSite() });
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
    if (!isSupportedPage()) return;
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

  function isNptelAssessment() {
    return location.hostname === "onlinecourses.nptel.ac.in" &&
      location.pathname.includes("/e-learning/course/") &&
      !!document.querySelector("main.practice-questions");
  }

  function isGenericQuizPage() {
    if (!/^https?:$/.test(location.protocol)) return false;
    if (location.hostname === "docs.google.com" && location.pathname.includes("/forms/")) return false;
    const root = document.querySelector("main") || document.body;
    const radios = [...root.querySelectorAll('input[type="radio"], [role="radio"]')].filter(isVisible);
    if (radios.length >= 2) return true;
    const checkboxes = [...root.querySelectorAll('input[type="checkbox"], [role="checkbox"]')].filter(isVisible);
    return checkboxes.some((checkbox) => {
      const container = genericQuestionContainer(checkbox, root);
      return [...container.querySelectorAll('input[type="checkbox"], [role="checkbox"]')].filter(isVisible).length >= 2;
    });
  }

  function detectSite() {
    if (isRespondentForm()) return "google_forms";
    if (isNptelAssessment()) return "nptel";
    if (isGenericQuizPage()) return "generic_web";
    return "unsupported";
  }

  function isSupportedPage() {
    return detectSite() !== "unsupported";
  }

  async function runAutofill() {
    if (runtime.running) throw new Error("AI Gateway is already working on this assessment.");
    runtime.running = true;
    await setProcessing(true);
    try {
      const form = await extractPage();
      if (!form.questions.length) throw new Error("No supported assessment questions were found on this page.");
      const response = await chrome.runtime.sendMessage({ type: "SOLVE_FORM", payload: form });
      if (!response?.ok) throw new Error(response?.error || "The AI request failed.");
      const summary = await applyAnswers(response.result.answers);
      return { ...summary, imageCount: response.result.imageCount };
    } finally {
      runtime.running = false;
      await setProcessing(false);
    }
  }

  async function extractPage() {
    if (isRespondentForm()) return extractGoogleForm();
    if (isNptelAssessment()) return extractNptelAssessment();
    if (isGenericQuizPage()) return extractGenericAssessment();
    throw new Error("This page is not supported by AI Gateway.");
  }

  async function extractGoogleForm() {
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

    return { site: "google_forms", title, description, url: location.href, questions, images };
  }

  async function extractNptelAssessment() {
    runtime.fieldNodes.clear();
    const root = document.querySelector("main.programming-assessment-main, main.practice-questions");
    const title = cleanText(document.querySelector(".assessment-header-title")?.textContent) ||
      cleanText(document.querySelector("main.assessment-main")?.previousElementSibling?.textContent) ||
      document.title;
    const description = cleanText([
      document.querySelector(".assessment-header-due-date-container")?.textContent,
      document.querySelector(".assessment-header-messages")?.textContent
    ].filter(Boolean).join(" "));
    const questions = [];
    const images = [];

    if (root?.matches("main.programming-assessment-main")) {
      const question = extractNptelProgrammingQuestion(root, images);
      if (question) questions.push(question);
      return { site: "nptel", assessmentType: "programming", title, description, url: location.href, questions, images };
    }

    let contextIndex = 0;
    let currentContext = { text: "", imageRefs: [] };
    const sections = [...root.querySelectorAll("section")].filter(
      (section) => !section.parentElement?.closest("section")
    );
    for (const section of sections) {
      const answerControls = [...section.querySelectorAll('input:not([type="hidden"]), textarea, select')]
        .filter((node) => !node.closest(".ace_editor"));
      if (!answerControls.length) {
        const contextText = cleanText(section.innerText);
        if (contextText.length > 20) {
          contextIndex += 1;
          currentContext = {
            text: contextText.slice(0, 12000),
            imageRefs: collectNptelContextImages(section, `context${contextIndex}`, images)
          };
        }
        continue;
      }

      const questionId = `nptel_q${questions.length + 1}`;
      const questionTitle = cleanText(section.querySelector(".question-content")?.innerText) ||
        cleanText(section.querySelector(".question-row")?.innerText) ||
        `Question ${questions.length + 1}`;
      const fields = extractNptelFields(section, questionId, questionTitle);
      if (!fields.length) continue;
      const questionImages = collectQuestionImages(section, questionId, images);
      questions.push({
        id: questionId,
        title: questionTitle.replace(/^\d+\.\s*/, ""),
        description: currentContext.text,
        required: !answerControls.every((control) => control.disabled),
        imageRefs: unique([...currentContext.imageRefs, ...questionImages]),
        fields
      });
    }

    return { site: "nptel", assessmentType: "standard", title, description, url: location.href, questions, images };
  }

  function extractNptelProgrammingQuestion(root, images) {
    const editor = root.querySelector("#code-editor.ace_editor, .programming-editor-wrapper .ace_editor");
    if (!editor) return null;
    const questionId = "nptel_code_q1";
    const language = cleanText(root.querySelector(".programming-dropdown-button")?.textContent) || "language selected on page";
    const title = cleanText(root.querySelector(".programming-question-text")?.innerText) || "Programming assignment";
    const samples = cleanText(root.querySelector(".programming-test-cases")?.innerText);
    const instructions = cleanText(root.querySelector(".programming-info-box")?.innerText);
    const starterCode = readAceText(editor);
    const field = registerField(questionId, 0, {
      type: "code",
      label: `Complete ${language} solution`,
      language,
      starterCode,
      format: "Return one complete source file as plain code only, without Markdown fences or explanation.",
      allowedOptions: []
    }, { type: "ace", root: editor });
    return {
      id: questionId,
      title,
      description: cleanText([instructions, samples].filter(Boolean).join(" ")).slice(0, 12000),
      required: !editor.querySelector("textarea.ace_text-input")?.readOnly,
      imageRefs: collectQuestionImages(root, questionId, images),
      fields: [field]
    };
  }

  function extractNptelFields(section, questionId, questionTitle) {
    const fields = [];
    const radios = [...section.querySelectorAll('input[type="radio"]')];
    if (radios.length) {
      const labels = radios.map((input) => input.closest("label") || input);
      fields.push(registerField(questionId, fields.length, {
        type: "radio",
        label: questionTitle,
        allowedOptions: labels.map(optionLabel).filter(Boolean)
      }, { type: "choice", root: section, options: labels }));
    }

    const checkboxes = [...section.querySelectorAll('input[type="checkbox"]')];
    if (checkboxes.length) {
      const labels = checkboxes.map((input) => input.closest("label") || input);
      fields.push(registerField(questionId, fields.length, {
        type: "checkbox",
        label: questionTitle,
        allowedOptions: labels.map(optionLabel).filter(Boolean)
      }, { type: "choice", root: section, options: labels }));
    }

    const textControls = [...section.querySelectorAll('textarea, input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="submit"]):not([type="button"])')]
      .filter((node) => !node.closest(".ace_editor") && isVisible(node));
    textControls.forEach((node, index) => {
      const htmlType = (node.getAttribute("type") || "text").toLowerCase();
      let type = node.tagName === "TEXTAREA" ? "paragraph" : "short_text";
      let format = "plain text";
      if (htmlType === "number") { type = "number"; format = "number"; }
      if (htmlType === "date") { type = "date"; format = "YYYY-MM-DD"; }
      if (htmlType === "time") { type = "time"; format = "HH:MM in 24-hour time"; }
      fields.push(registerField(questionId, fields.length, {
        type,
        label: node.getAttribute("aria-label") || node.getAttribute("placeholder") || (textControls.length > 1 ? `${questionTitle} — part ${index + 1}` : questionTitle),
        format,
        allowedOptions: []
      }, { type: "text", root: node }));
    });

    for (const select of section.querySelectorAll("select")) {
      const options = [...select.options].map((option) => cleanText(option.textContent)).filter(isRealDropdownOption);
      fields.push(registerField(questionId, fields.length, {
        type: "dropdown",
        label: select.getAttribute("aria-label") || questionTitle,
        allowedOptions: options
      }, { type: "native-select", root: select }));
    }

    const fileInput = section.querySelector('input[type="file"]');
    if (fileInput) {
      fields.push(registerField(questionId, fields.length, {
        type: "file_upload",
        label: questionTitle,
        allowedOptions: []
      }, { type: "unsupported", root: fileInput }));
    }
    return fields;
  }

  function collectNptelContextImages(container, contextId, allImages) {
    const refs = [];
    [...container.querySelectorAll("img")].forEach((img, index) => {
      const url = img.currentSrc || img.src;
      if (!url || /icon|avatar|logo/i.test(`${img.alt} ${img.className}`)) return;
      const existing = allImages.find((item) => item.url === url);
      if (existing) {
        refs.push(existing.ref);
        return;
      }
      const ref = `${contextId}_image${index + 1}`;
      refs.push(ref);
      allImages.push({ ref, url, alt: img.alt || "NPTEL question context image" });
    });
    return refs;
  }

  function readAceText(editor) {
    return [...editor.querySelectorAll(".ace_text-layer .ace_line")].map((line) => line.textContent || "").join("\n").trim();
  }

  async function extractGenericAssessment() {
    runtime.fieldNodes.clear();
    const root = document.querySelector("main") || document.body;
    const title = cleanText(document.querySelector("h1, [role=heading][aria-level='1']")?.textContent) || document.title;
    const description = cleanText(document.querySelector("main > p, form > p, [class*='description' i]")?.textContent).slice(0, 2000);
    const questions = [];
    const images = [];
    const claimed = new Set();

    const addQuestion = (controls, type, nodeFieldType, labelRoot = null) => {
      const visibleControls = controls.filter((control) => isVisible(control) && !control.disabled);
      if (!visibleControls.length || visibleControls.some((control) => claimed.has(control))) return;
      visibleControls.forEach((control) => claimed.add(control));
      const container = genericQuestionContainer(labelRoot || visibleControls[0], root);
      const questionId = `web_q${questions.length + 1}`;
      const options = type === "radio" || type === "checkbox"
        ? visibleControls.map(nativeChoiceLabelElement)
        : [];
      const allowedOptions = options.map(optionLabel).filter(Boolean);
      const questionTitle = genericQuestionTitle(container, visibleControls[0], allowedOptions, questions.length + 1);
      const field = registerField(questionId, 0, {
        type,
        label: questionTitle,
        allowedOptions
      }, { type: nodeFieldType, root: labelRoot || container, options });
      questions.push({
        id: questionId,
        title: questionTitle,
        description: genericQuestionDescription(container, questionTitle, allowedOptions),
        required: visibleControls.some((control) => control.required || control.getAttribute("aria-required") === "true"),
        imageRefs: collectQuestionImages(container, questionId, images),
        fields: [field]
      });
    };

    const nativeRadios = [...root.querySelectorAll('input[type="radio"]')];
    for (const radio of nativeRadios) {
      if (claimed.has(radio) || !isVisible(radio)) continue;
      const name = radio.name;
      const semanticContainer = genericQuestionContainer(radio, root);
      const group = name
        ? nativeRadios.filter((item) => item.name === name && item.form === radio.form)
        : [...semanticContainer.querySelectorAll('input[type="radio"]')];
      const container = semanticContainer === root || semanticContainer.matches("form")
        ? commonControlContainer(group, semanticContainer)
        : semanticContainer;
      addQuestion(group, "radio", "choice", container);
    }

    const nativeCheckboxes = [...root.querySelectorAll('input[type="checkbox"]')];
    for (const checkbox of nativeCheckboxes) {
      if (claimed.has(checkbox) || !isVisible(checkbox)) continue;
      const container = genericQuestionContainer(checkbox, root);
      const containerGroup = [...container.querySelectorAll('input[type="checkbox"]')];
      const group = container !== root && !container.matches("form") && containerGroup.length > 1
        ? containerGroup
        : checkbox.name
          ? nativeCheckboxes.filter((item) => item.name === checkbox.name && item.form === checkbox.form)
          : containerGroup;
      addQuestion(group, "checkbox", "choice", container);
    }

    for (const group of [...root.querySelectorAll('[role="radiogroup"]')].filter(isVisible)) {
      addQuestion([...group.querySelectorAll('[role="radio"]')], "radio", "choice", group);
    }
    for (const group of [...root.querySelectorAll('[role="group"]')].filter((node) => isVisible(node) && node.querySelector('[role="checkbox"]'))) {
      addQuestion([...group.querySelectorAll('[role="checkbox"]')], "checkbox", "choice", group);
    }

    const selects = [...root.querySelectorAll("select")].filter((node) => isVisible(node) && !node.disabled);
    for (const select of selects) {
      const options = [...select.options].map((option) => cleanText(option.textContent)).filter(isRealDropdownOption);
      if (!options.length) continue;
      const container = genericQuestionContainer(select, root);
      const questionId = `web_q${questions.length + 1}`;
      const questionTitle = genericQuestionTitle(container, select, options, questions.length + 1);
      const field = registerField(questionId, 0, {
        type: "dropdown",
        label: questionTitle,
        allowedOptions: options
      }, { type: "native-select", root: select });
      questions.push({
        id: questionId,
        title: questionTitle,
        description: genericQuestionDescription(container, questionTitle, options),
        required: select.required || select.getAttribute("aria-required") === "true",
        imageRefs: collectQuestionImages(container, questionId, images),
        fields: [field]
      });
    }

    for (const listbox of [...root.querySelectorAll('[role="listbox"]')].filter(isVisible)) {
      const options = await readDropdownOptions(listbox);
      if (!options.length) continue;
      const container = genericQuestionContainer(listbox, root);
      const questionId = `web_q${questions.length + 1}`;
      const questionTitle = genericQuestionTitle(container, listbox, options, questions.length + 1);
      const field = registerField(questionId, 0, {
        type: "dropdown",
        label: questionTitle,
        allowedOptions: options
      }, { type: "dropdown", root: listbox });
      questions.push({
        id: questionId,
        title: questionTitle,
        description: genericQuestionDescription(container, questionTitle, options),
        required: listbox.getAttribute("aria-required") === "true",
        imageRefs: collectQuestionImages(container, questionId, images),
        fields: [field]
      });
    }

    const textControls = [...root.querySelectorAll('textarea, input[type="text"], input[type="number"], input[type="date"], input[type="time"]')]
      .filter((node) => isVisible(node) && !node.disabled && !node.readOnly && !node.closest(".ace_editor"));
    for (const control of textControls) {
      const container = genericQuestionContainer(control, root);
      if (!container.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]') && !/question|quiz|answer/i.test(container.className || "")) continue;
      const questionId = `web_q${questions.length + 1}`;
      const htmlType = (control.getAttribute("type") || "text").toLowerCase();
      let type = control.tagName === "TEXTAREA" ? "paragraph" : "short_text";
      let format = "plain text";
      if (htmlType === "number") { type = "number"; format = "number"; }
      if (htmlType === "date") { type = "date"; format = "YYYY-MM-DD"; }
      if (htmlType === "time") { type = "time"; format = "HH:MM in 24-hour time"; }
      const questionTitle = genericQuestionTitle(container, control, [], questions.length + 1);
      const field = registerField(questionId, 0, {
        type,
        label: questionTitle,
        format,
        allowedOptions: []
      }, { type: "text", root: control });
      questions.push({
        id: questionId,
        title: questionTitle,
        description: genericQuestionDescription(container, questionTitle, []),
        required: control.required || control.getAttribute("aria-required") === "true",
        imageRefs: collectQuestionImages(container, questionId, images),
        fields: [field]
      });
    }

    return { site: "generic_web", assessmentType: "generic_quiz", title, description, url: location.href, questions, images };
  }

  function genericQuestionContainer(control, root) {
    return control.closest([
      "[data-question-id]",
      "[data-question]",
      "fieldset",
      "[role='radiogroup']",
      "[role='group']",
      ".question",
      ".quiz-question",
      ".quiz-item",
      ".form-group",
      ".field",
      "[data-testid*='question' i]",
      "[class*='question' i]",
      "[class*='question-container' i]",
      "[class*='question-card' i]",
      "article",
      "section",
      "li"
    ].join(",")) || control.closest("form") || root;
  }

  function commonControlContainer(controls, fallback) {
    let candidate = controls[0]?.parentElement;
    while (candidate && candidate !== fallback && !controls.every((control) => candidate.contains(control))) {
      candidate = candidate.parentElement;
    }
    return candidate || fallback;
  }

  function nativeChoiceLabelElement(control) {
    if (control.matches('[role="radio"], [role="checkbox"]')) return control;
    if (control.id) {
      const escapedId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(control.id) : control.id.replace(/["\\]/g, "\\$&");
      const explicit = document.querySelector(`label[for="${escapedId}"]`);
      if (explicit) return explicit;
    }
    return control.closest("label") || control.parentElement || control;
  }

  function genericQuestionTitle(container, control, options, index) {
    const explicit = cleanText(
      container.querySelector("legend, [data-question-text], .question-text, .question-title, h1, h2, h3, h4, [role='heading']")?.textContent ||
      control.getAttribute("aria-label") ||
      control.getAttribute("placeholder")
    );
    if (explicit) return explicit.replace(/^\d+[.)]\s*/, "").slice(0, 1200);
    let text = cleanText(container.innerText);
    options.forEach((option) => { text = text.replace(option, " "); });
    return cleanText(text).replace(/^\d+[.)]\s*/, "").slice(0, 1200) || `Question ${index}`;
  }

  function genericQuestionDescription(container, title, options) {
    let text = cleanText(container.innerText).replace(title, " ");
    options.forEach((option) => { text = text.replace(option, " "); });
    return cleanText(text).slice(0, 2000);
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
      return isSupportedImageUrl(src) && isVisible(img) && rect.width >= 48 && rect.height >= 48 && !/icon|avatar|logo/i.test(`${img.alt} ${img.className}`);
    });
    imageNodes.forEach((img, index) => {
      const url = img.currentSrc || img.src;
      const existing = allImages.find((item) => item.url === url);
      if (existing) {
        refs.push(existing.ref);
        return;
      }
      const ref = `${questionId}_image${index + 1}`;
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
      return isSupportedImageUrl(src) && isVisible(img) && rect.width >= 80 && rect.height >= 60 && !/icon|avatar|logo/i.test(`${img.alt} ${img.className}`);
    });
    unclaimed.forEach((img, index) => {
      const url = img.currentSrc || img.src;
      if (!url || allImages.some((item) => item.url === url)) return;
      allImages.push({ ref: `form_image${index + 1}`, url, alt: img.alt || "Form-level image" });
    });
  }

  function isSupportedImageUrl(url) {
    return /^(?:https?:|data:image\/)/i.test(String(url || ""));
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
      if (field.type === "native-select") didFill = fillNativeSelect(field.root, values[0]);
      if (field.type === "ace") didFill = await fillAceEditor(field.root, stripCodeFences(values.join("\n")));
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
      const control = choiceControl(option);
      const checked = control.checked === true || control.getAttribute("aria-checked") === "true";
      const isCheckbox = control.type === "checkbox" || control.getAttribute("role") === "checkbox";
      if (shouldSelect && !checked) option.click();
      if (!shouldSelect && checked && isCheckbox) option.click();
      if (shouldSelect) matches += 1;
    });
    return matches === wanted.length && matches > 0;
  }

  function choiceControl(option) {
    if (option.matches('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')) return option;
    return option.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]') || option;
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

  function fillNativeSelect(select, value) {
    const option = [...select.options].find((item) => normalize(item.textContent) === normalize(value));
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (setter) setter.call(select, option.value);
    else select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value === option.value;
  }

  async function fillAceEditor(editor, value) {
    const input = editor.querySelector("textarea.ace_text-input");
    if (!input || input.readOnly || input.disabled) return false;
    input.focus();
    const shortcut = new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      ctrlKey: !/Mac/i.test(navigator.platform),
      metaKey: /Mac/i.test(navigator.platform),
      bubbles: true,
      cancelable: true
    });
    for (const property of ["keyCode", "which"]) {
      try { Object.defineProperty(shortcut, property, { get: () => 65 }); } catch {}
    }
    input.dispatchEvent(shortcut);
    await delay(30);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    }
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "a", code: "KeyA", bubbles: true }));
    await delay(120);
    return normalizeCode(readAceText(editor)) === normalizeCode(value);
  }

  function normalizeCode(value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  }

  function stripCodeFences(value) {
    return String(value || "").trim().replace(/^```[^\n]*\n/i, "").replace(/\n```\s*$/, "");
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
