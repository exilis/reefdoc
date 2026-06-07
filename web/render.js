import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js';

// createRenderer returns a pure function (markdown:string) => html:string.
// Fenced ```mermaid blocks are emitted as <pre class="mermaid"> for the
// browser to render with mermaid.run(); all other code is highlighted here.
export function createRenderer() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return '<pre class="hljs"><code>' +
            hljs.highlight(code, { language: lang }).value +
            '</code></pre>';
        } catch (_) { /* fall through */ }
      }
      return '<pre class="hljs"><code>' + md.utils.escapeHtml(code) + '</code></pre>';
    },
  });
  md.use(taskLists);

  const defaultFence =
    md.renderer.rules.fence ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() === 'mermaid') {
      return '<pre class="mermaid">' + md.utils.escapeHtml(token.content) + '</pre>';
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  return (markdown) => md.render(markdown);
}
