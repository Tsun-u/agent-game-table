/* 規則頁：用網址帶的遊戲與房主選項向 Host 要規則全文，排成給人讀的版面；AI 協定那段不給人看。 */
(() => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") || "bigtwo";
  const options = params.get("options") || "{}";
  const title = document.getElementById("rulesTitle");
  const subtitle = document.getElementById("rulesSubtitle");
  const body = document.getElementById("rulesBody");

  fetch(`/api/games/${encodeURIComponent(mode)}/rules?options=${encodeURIComponent(options)}`)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "讀不到規則。");
      render(payload);
    })
    .catch((error) => {
      title.textContent = "讀不到規則";
      subtitle.textContent = error.message;
    });

  function render(payload) {
    const lines = payload.text.split("\n");
    const agentSection = lines.findIndex((line) => line.startsWith("Agent 協定"));
    const humanLines = agentSection === -1 ? lines : lines.slice(0, agentSection);
    title.textContent = `${payload.label}規則`;
    subtitle.textContent = `規則版本 ${payload.rules_version}。依這一桌的房主選項生成，和 AI 拿到的是同一份。`;
    document.title = `${payload.label}規則 · Agent Game Table`;

    const sections = [];
    let current = null;
    for (const line of humanLines.slice(1)) {
      if (!line.trim()) continue;
      if (line.endsWith("：") && !line.startsWith("- ")) {
        current = { heading: line.slice(0, -1), items: [] };
        sections.push(current);
      } else if (line.startsWith("- ")) {
        (current ?? sections[sections.push({ heading: "", items: [] }) - 1]).items.push(line.slice(2));
        if (!current) current = sections[sections.length - 1];
      } else {
        sections.push({ heading: "", items: [line] });
        current = null;
      }
    }
    body.replaceChildren(...sections.map((section) => {
      const block = document.createElement("section");
      block.className = "guide-section rules-section";
      if (section.heading) {
        const heading = document.createElement("h2");
        heading.textContent = section.heading;
        block.append(heading);
      }
      const list = document.createElement("ul");
      list.replaceChildren(...section.items.map((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      }));
      block.append(list);
      return block;
    }));
  }
})();
