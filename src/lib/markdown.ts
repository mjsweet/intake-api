/**
 * Minimal markdown-to-HTML converter for content field rendering.
 * Handles headings, paragraphs, bold, italic, links, lists, and code blocks.
 * No external dependencies.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic: *text* or _text_ (not inside words for _)
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>");
  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-sm">$1</code>');
  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-blue-600 underline" target="_blank" rel="noopener">$1</a>'
  );
  return result;
}

export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const output: string[] = [];
  let i = 0;
  let inList: "ul" | "ol" | null = null;

  function closeList() {
    if (inList) {
      output.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code block: ```
    if (line.trimStart().startsWith("```")) {
      closeList();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      output.push(
        `<pre class="bg-gray-100 rounded-lg p-4 text-sm overflow-x-auto my-3"><code>${codeLines.join("\n")}</code></pre>`
      );
      continue;
    }

    // Heading: # to ######
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const sizes: Record<number, string> = {
        1: "text-2xl font-bold",
        2: "text-xl font-bold",
        3: "text-lg font-semibold",
        4: "text-base font-semibold",
        5: "text-sm font-semibold",
        6: "text-sm font-medium",
      };
      output.push(
        `<h${level} class="${sizes[level]} text-gray-900 mt-4 mb-2">${inlineMarkdown(headingMatch[2])}</h${level}>`
      );
      i++;
      continue;
    }

    // Horizontal rule: --- or ***
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      output.push('<hr class="border-gray-200 my-4" />');
      i++;
      continue;
    }

    // Unordered list: - item or * item
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (ulMatch) {
      if (inList !== "ul") {
        closeList();
        inList = "ul";
        output.push('<ul class="list-disc list-inside space-y-1 my-2 text-gray-700">');
      }
      output.push(`<li>${inlineMarkdown(ulMatch[2])}</li>`);
      i++;
      continue;
    }

    // Ordered list: 1. item
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
    if (olMatch) {
      if (inList !== "ol") {
        closeList();
        inList = "ol";
        output.push('<ol class="list-decimal list-inside space-y-1 my-2 text-gray-700">');
      }
      output.push(`<li>${inlineMarkdown(olMatch[2])}</li>`);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Table: | col | col |
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      closeList();
      const tableRows: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableRows.push(lines[i]);
        i++;
      }

      if (tableRows.length >= 2) {
        const parseCells = (row: string) =>
          row
            .trim()
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim());

        const headerCells = parseCells(tableRows[0]);

        // Check if row 2 is a separator (|---|---|)
        const isSeparator = /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|$/.test(
          tableRows[1].trim()
        );
        const bodyStart = isSeparator ? 2 : 1;

        output.push(
          '<div class="overflow-x-auto my-3"><table class="w-full text-sm border-collapse">'
        );

        // Header
        output.push("<thead><tr>");
        for (const cell of headerCells) {
          output.push(
            `<th class="text-left font-semibold text-gray-900 border-b border-gray-300 px-3 py-2">${inlineMarkdown(cell)}</th>`
          );
        }
        output.push("</tr></thead>");

        // Body
        if (bodyStart < tableRows.length) {
          output.push("<tbody>");
          for (let r = bodyStart; r < tableRows.length; r++) {
            const cells = parseCells(tableRows[r]);
            output.push("<tr>");
            for (const cell of cells) {
              output.push(
                `<td class="border-b border-gray-200 px-3 py-2 text-gray-700">${inlineMarkdown(cell)}</td>`
              );
            }
            output.push("</tr>");
          }
          output.push("</tbody>");
        }

        output.push("</table></div>");
      }
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    closeList();
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^[-*]\s/) &&
      !lines[i].match(/^\d+\.\s/) &&
      !lines[i].trimStart().startsWith("```") &&
      !/^(-{3,}|\*{3,})$/.test(lines[i].trim()) &&
      !(lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|"))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      output.push(
        `<p class="text-gray-700 my-2">${inlineMarkdown(paraLines.join(" "))}</p>`
      );
    }
  }

  closeList();
  return output.join("\n");
}
