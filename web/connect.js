(() => {
  const mcpUrl = `${window.location.origin}/mcp`;
  for (const element of document.querySelectorAll("[data-mcp-url]")) element.textContent = mcpUrl;
  for (const element of document.querySelectorAll("[data-cli]")) element.textContent = element.textContent.replaceAll("https://…/mcp", mcpUrl);

  const copyButton = document.querySelector("[data-copy-url]");
  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      copyButton.textContent = "已複製";
    } catch {
      copyButton.textContent = "請手動選取複製";
    }
    setTimeout(() => { copyButton.textContent = "複製網址"; }, 1800);
  });

  const tabs = [...document.querySelectorAll(".guide-tab")];
  const panels = [...document.querySelectorAll("[data-panel]")];
  const show = (name) => {
    for (const tab of tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of panels) panel.hidden = panel.dataset.panel !== name;
  };
  for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.tab));
  const initial = new URLSearchParams(window.location.search).get("tab");
  if (initial && tabs.some((tab) => tab.dataset.tab === initial)) show(initial);
})();
