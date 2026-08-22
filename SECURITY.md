# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** flow when available. Do not open a public issue containing API keys, private Google Form URLs, form responses, account information, or proof-of-concept data that could affect other users.

Include the affected extension version, a concise reproduction path, expected and observed behavior, security impact, and a minimal sanitized proof of concept when applicable.

## Security model

- API keys are stored in `chrome.storage.local` and are not included in source files.
- The autofill content script runs only on `docs.google.com/forms/*` and `onlinecourses.nptel.ac.in/e-learning/course/*` pages; clipboard compatibility is limited to NPTEL domains.
- Additional `docs.google.com/*` host access downloads Google Forms image assets for inline encoding.
- Gateway requests are sent only after explicit user invocation.
- The NPTEL clipboard compatibility script runs in the page world but has no access to extension storage or the configured API key.
- Returned field IDs are validated against IDs generated for the current page.
- The extension fills answers or code but never submits, compiles, or runs an assessment.

Users should create a dedicated Vercel AI Gateway key with appropriate budgets and rotate it if exposed.
