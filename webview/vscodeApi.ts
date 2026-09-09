import type { WebviewMessage } from "../src/core/messages";

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode: VsCodeApi = acquireVsCodeApi();

export function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}
