(function () {
  "use strict";

  function setVisible(button, input, visible) {
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", visible ? "true" : "false");
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    button.title = visible ? "Hide password" : "Show password";

    var icon = button.querySelector("i");
    if (icon) {
      icon.className = visible ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
    }
  }

  function toggle(button) {
    if (!button) return;
    var inputId = button.getAttribute("data-password-toggle");
    var input = inputId ? document.getElementById(inputId) : null;
    if (!input) return;

    var visible = input.type === "password";
    setVisible(button, input, visible);

    // Keep the field focused without moving the caret to the beginning.
    try {
      var start = input.selectionStart;
      var end = input.selectionEnd;
      input.focus({ preventScroll: true });
      if (typeof start === "number" && typeof end === "number") {
        input.setSelectionRange(start, end);
      }
    } catch (_) {
      input.focus();
    }
  }

  window.togglePasswordVisibility = function (button) {
    toggle(button);
    return false;
  };

  function initialize() {
    document.querySelectorAll("[data-password-toggle]").forEach(function (button) {
      var inputId = button.getAttribute("data-password-toggle");
      var input = inputId ? document.getElementById(inputId) : null;
      if (!input) return;
      setVisible(button, input, input.type === "text");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
