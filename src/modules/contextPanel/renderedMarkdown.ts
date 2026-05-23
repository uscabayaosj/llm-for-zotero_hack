import { renderMarkdown } from "../../utils/markdown";
import { sanitizeText } from "./textUtils";

export type RenderedMarkdownOptions = {
  resolveImage?: (src: string) => string | null;
};

export function renderAssistantMarkdownHtmlForChat(
  text: string,
  options?: RenderedMarkdownOptions,
): string {
  return renderMarkdown(sanitizeText(text), options);
}

function formatCodeCopyButtonLabel(rawLang: string): string {
  const lang = sanitizeText(rawLang || "").trim().toLowerCase();
  const labels: Record<string, string> = {
    bash: "Bash",
    css: "CSS",
    html: "HTML",
    javascript: "JavaScript",
    js: "JavaScript",
    json: "JSON",
    jsx: "JSX",
    markdown: "Markdown",
    md: "Markdown",
    plaintext: "text",
    py: "Python",
    python: "Python",
    shell: "Shell",
    sh: "Shell",
    sql: "SQL",
    svg: "SVG",
    text: "text",
    ts: "TypeScript",
    tsx: "TSX",
    typescript: "TypeScript",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
  };
  if (labels[lang]) return labels[lang];
  if (!lang) return "text";
  return lang
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function attachRenderedCopyButtons(root: ParentNode, doc: Document): void {
  const copyables = Array.from(
    root.querySelectorAll(".llm-copyable[data-llm-copy-source]"),
  ) as HTMLElement[];
  for (const copyable of copyables) {
    if (copyable.classList.contains("llm-copyable-inline")) continue;
    if (!copyable.dataset.copyFeedbackBound) {
      copyable.dataset.copyFeedbackBound = "true";
      const clearCopyFeedback = () => {
        delete copyable.dataset.copyFeedback;
      };
      copyable.addEventListener("mouseleave", clearCopyFeedback);
      copyable.addEventListener("focusout", (event: FocusEvent) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !copyable.contains(next)) {
          clearCopyFeedback();
        }
      });
    }
    const existing = copyable.querySelector(
      ":scope > .llm-render-copy-btn",
    ) as HTMLButtonElement | null;
    if (existing) continue;
    const button = doc.createElement("button") as HTMLButtonElement;
    button.type = "button";
    button.className = "llm-render-copy-btn";
    const codeShell = copyable.querySelector(
      ":scope .llm-codeblock-shell",
    ) as HTMLElement | null;
    if (codeShell) {
      button.classList.add("llm-render-code-copy-btn");
      button.textContent = "⧉";
      const codeLangLabel = formatCodeCopyButtonLabel(
        codeShell.dataset.codeLang || "",
      );
      button.title = `Copy ${codeLangLabel} code`;
      button.setAttribute("aria-label", `Copy ${codeLangLabel} code`);
    } else {
      button.textContent = "⧉";
      button.title = "Copy original markdown";
      button.setAttribute("aria-label", "Copy original markdown");
    }
    copyable.insertBefore(button, copyable.firstChild);
  }
}

export function renderRenderedMarkdownInto(
  target: HTMLElement,
  text: string,
  doc: Document,
  options?: RenderedMarkdownOptions,
): void {
  target.classList.add("llm-rendered-markdown");
  target.innerHTML = renderAssistantMarkdownHtmlForChat(text, options);
  attachRenderedCopyButtons(target, doc);
}
