# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** flow when available. Do not open a public issue containing API keys, private Google Form URLs, form responses, account information, or proof-of-concept data that could affect other users.

Include the affected extension version, a concise reproduction path, expected and observed behavior, security impact, and a minimal sanitized proof of concept when applicable.

## Security model

- API keys are stored in `chrome.storage.local` and are not included in source files.
- The autofill content script is available on HTTP and HTTPS pages to support general web quizzes, but it performs no extraction or network request until explicit user invocation; clipboard compatibility remains limited to NPTEL domains.
- Broad HTTP/HTTPS host access enables general quiz detection and cross-origin question-image retrieval; no page data is read or transmitted until explicit invocation.
- Gateway requests are sent only after explicit user invocation.
- The NPTEL clipboard compatibility script runs in the page world but has no access to extension storage or the configured API key.
- Returned field IDs are validated against IDs generated for the current page.
- The extension fills answers or code but never submits, compiles, or runs an assessment.

Users should create a dedicated Vercel AI Gateway key with appropriate budgets and rotate it if exposed.
