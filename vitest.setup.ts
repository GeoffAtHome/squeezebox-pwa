// Only run DOM + MWC mocks when JSDOM is available
if (typeof window !== "undefined" && typeof document !== "undefined") {
  // Global MWC Form-Associated API mock
  if (!window.ElementInternals) {
    class FakeElementInternals {
      setFormValue() {}
      setValidity() {}
      reportValidity() { return true }
    }

    // @ts-ignore
    window.ElementInternals = FakeElementInternals;

    // @ts-ignore
    HTMLElement.prototype.attachInternals = function () {
      return new FakeElementInternals();
    };
  }

  // Prevent Material Web Components from executing their real constructors
  vi.mock("@material/web/textfield/filled-text-field.js", () => ({
    default: class MockTextField extends HTMLElement {},
  }));

  vi.mock("@material/web/checkbox/checkbox.js", () => ({
    default: class MockCheckbox extends HTMLElement {},
  }));

  vi.mock("@material/web/button/filled-button.js", () => ({
    default: class MockButton extends HTMLElement {},
  }));

  vi.mock("@material/web/button/text-button.js", () => ({
    default: class MockTextButton extends HTMLElement {},
  }));
}

console.log("Vitest setup file loaded");
