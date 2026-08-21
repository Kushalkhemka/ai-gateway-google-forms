# Contributing

Thanks for helping improve AI Gateway for Google Forms.

## Before opening an issue

- Reload the unpacked extension from `chrome://extensions`.
- Refresh the Google Form tab so the latest content script is injected.
- Confirm the issue occurs in the public/respondent view of a Google Form.
- Remove API keys, account details, form responses, and private form URLs from screenshots and logs.

## Development workflow

1. Fork the repository and create a focused branch.
2. Make the smallest change that solves the issue.
3. Run `npm test`.
4. Reload the extension and test against a non-sensitive practice form.
5. Open a pull request describing the behavior before and after the change.

## Pull request checklist

- [ ] No API keys or private form data are committed.
- [ ] `npm test` passes.
- [ ] New field behavior includes a reproducible test form description.
- [ ] The extension never submits a form automatically.
- [ ] UI changes remain compact and monochrome.
- [ ] Documentation reflects user-visible changes.

## Code style

- Prefer browser-native APIs and zero runtime dependencies.
- Prefer semantic selectors (`role`, `aria-label`, input type) over generated Google class names.
- Preserve stable field IDs between extraction and fill phases.
- Fail with a clear user-facing message instead of silently guessing.
