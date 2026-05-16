import { render as litRender } from "lit";
import { afterEach, vi } from "vitest";

/**
 * Render a Lit component into the document and wait for updateComplete.
 */
export async function render<T extends HTMLElement>(template: unknown): Promise<T> {
  const container = document.createElement("div");
  document.body.appendChild(container);

  litRender(template as any, container);

  const element = container.firstElementChild as T;

  if (element && "updateComplete" in element) {
    await (element as any).updateComplete;
  }

  return element;
}

/**
 * Query inside a shadow root and assert the element exists.
 */
export function getByShadow<T extends Element>(
  host: HTMLElement,
  selector: string,
): T {
  const root = host.shadowRoot;
  if (!root) throw new Error("Shadow root not found");

  const el = root.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);

  return el as T;
}

/**
 * Clean up after each test.
 */
export function setupTestCleanup() {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });
}
