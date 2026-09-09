# Releasing

## Before you start

You need a Visual Studio Marketplace publisher and a Personal Access Token.

1. Create an Azure DevOps organisation at https://dev.azure.com.
2. Create a Personal Access Token with **Marketplace: Manage** scope, and organisation set to **All accessible organizations**. Copy it; it is shown once.
3. Create a publisher at https://marketplace.visualstudio.com/manage.
4. The publisher ID must match `publisher` in `package.json`.

## Checklist

- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `CHANGELOG.md` has an entry for the new version
- [ ] `package.json` version is bumped
- [ ] `publisher` matches your Marketplace publisher ID
- [ ] Screenshots in `README.md` still reflect the UI
- [ ] The `.vsix` installs and opens a CSV file cleanly

## Version numbers

The extension follows semantic versioning. The Marketplace additionally treats the middle number specially for pre-releases, so keep patch releases to the third number.

| Change | Bump |
| --- | --- |
| Bug fix, documentation | Patch |
| New feature, new setting | Minor |
| Removed setting, changed default behaviour, raised minimum VS Code version | Major |

## Build and package

```bash
npm run package:vsix
```

This runs the production build and produces `csv-grid-viewer-<version>.vsix`. Dependencies are bundled by esbuild, so the package excludes `node_modules` entirely.

Verify what is inside before publishing:

```bash
npx @vscode/vsce ls --no-dependencies
```

The package should contain `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, the icon, and `out/`. Sources, tests, samples and screenshots are excluded by `.vscodeignore`.

## Test the package

```bash
code --install-extension csv-grid-viewer-<version>.vsix
```

Open a CSV file and confirm the grid renders, a cell edit saves, an AutoFilter dropdown opens, and the SQL panel returns a result. The SQL panel is the one to check specifically, because it is the only feature that loads a file from disk at runtime.

Uninstall with `code --uninstall-extension bash-365.csv-grid-viewer`.

## Publish

```bash
npx @vscode/vsce login <publisher-id>
npm run publish:extension
```

Or publish an already-built package:

```bash
npx @vscode/vsce publish --packagePath csv-grid-viewer-<version>.vsix
```

Publishing from CI uses a token instead of an interactive login:

```bash
npx @vscode/vsce publish --no-dependencies --pat "$VSCE_PAT"
```

The release workflow in `.github/workflows/release.yml` does this on a tag push when the `VSCE_PAT` repository secret is set. Without that secret it still builds and attaches the `.vsix` to the GitHub release, so tagging is safe before the secret exists.

## Tag a release

```bash
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

## Open VSX

Publishing to Open VSX, which is what VSCodium and Gitpod use, is a separate step:

```bash
npx ovsx publish csv-grid-viewer-<version>.vsix -p "$OVSX_PAT"
```

## After publishing

The Marketplace takes a few minutes to show a new version. Verify the listing renders: images in `README.md` must use absolute HTTPS URLs, because the Marketplace does not resolve relative paths.
