// jsdom 26 reflète l'attribut `open` de <dialog> mais n'implémente ni
// showModal() ni close(). Le jeu s'appuie sur les deux, et sur l'événement
// "close" pour relancer une partie : on comble le manque le temps des tests.
if (
  typeof HTMLDialogElement !== "undefined" &&
  typeof HTMLDialogElement.prototype.showModal !== "function"
) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };

  HTMLDialogElement.prototype.close = function close(returnValue) {
    if (!this.hasAttribute("open")) {
      return;
    }

    this.removeAttribute("open");

    if (returnValue !== undefined) {
      this.returnValue = returnValue;
    }

    this.dispatchEvent(new Event("close"));
  };
}
