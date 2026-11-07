const dialog = document.querySelector("#viewer");
const viewerImg = document.querySelector("#viewer-img");

document.querySelectorAll("[data-zoom]").forEach((button) => {
  button.addEventListener("click", () => {
    const source = button.querySelector("img");
    if (!source || !dialog || !viewerImg) return;
    viewerImg.src = source.currentSrc || source.src;
    viewerImg.alt = source.alt;
    dialog.showModal();
  });
});
