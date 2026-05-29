export function sectionList(text, names) {
  const lines = String(text || "").split(/\r?\n/);
  const wanted = names.map((name) => name.toLowerCase());
  const values = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[1].replace(/[:：]$/, "").toLowerCase();
      collecting = wanted.some((name) => title.includes(name));
      continue;
    }
    if (collecting && /^#{1,6}\s+/.test(line)) collecting = false;
    if (!collecting) continue;
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/);
    if (item) values.push(item[1]);
  }

  return values;
}

export function firstParagraph(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("```"));
  return lines[0] || "";
}

export function bulletList(title, values) {
  const items = values?.length ? values : ["暂无记录"];
  return [`## ${title}`, "", ...items.map((item, index) => `${index + 1}. ${item}`), ""].join("\n");
}

export function fieldLine(text, names) {
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    for (const name of names) {
      const match = line.match(new RegExp(`^\\s*${name}\\s*[:：]\\s*(.+?)\\s*$`, "i"));
      if (match) return match[1];
    }
  }
  return "";
}
