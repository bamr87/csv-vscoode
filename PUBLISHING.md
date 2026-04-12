# Publishing Guide

This repo includes helper utilities to prepare and package the extension for the VS Code Marketplace.

## 1) One-time setup

Install dependencies (includes `@vscode/vsce`):

```bash
npm install
```

Initialize publishing metadata in `package.json`:

```bash
npm run publish:init -- --publisher <publisher-id> --repo <https://github.com/<user>/<repo>.git>
```

This command:

- updates `publisher`, `repository`, `homepage`, `bugs`, `license`, and `keywords`
- creates `CHANGELOG.md` and `LICENSE` if missing

## 2) Create Marketplace credentials

Follow the official guide: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

Required steps:

1. Create Azure DevOps Personal Access Token (scope: `Marketplace (Manage)`, organization: `All accessible organizations`)
2. Create your publisher in Marketplace
3. Authenticate locally:

```bash
npm run publish:login -- <publisher-id>
```

## 3) Package to VSIX (local artifact)

```bash
npm run package:vsix
```

This runs compile + `vsce package` and produces:

- `<extension-name>-<version>.vsix`

## 4) Publish to Marketplace

Manual version bump first (recommended), then:

```bash
npm run publish:extension
```

or auto-bump:

```bash
npx @vscode/vsce publish patch
```

## Quick checklist before publish

- `publisher` in `package.json` matches your Marketplace publisher ID
- `README.md`, `CHANGELOG.md`, and `LICENSE` are present and accurate
- image links in docs are HTTPS and non-SVG (or trusted badge providers)
- `npm run compile` passes cleanly
