// esbuild bundles CSS imported for its side effects into out/webview/main.css.
// TypeScript 6 checks side-effect imports (noUncheckedSideEffectImports is on
// by default), so it needs to know such modules exist.
declare module "*.css";
