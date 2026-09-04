function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code class="agent-md-code">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a class="agent-md-a" href="$2" target="_blank" rel="noreferrer">$1</a>');
  return out;
}

function renderTable(rows: string[]): string {
  const cells = rows.map((row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
  const body = cells.filter((row, index) => index !== 1 && !row.every((cell) => /^:?-+:?$/.test(cell)));
  if (body.length < 1) return rows.map((row) => `<p>${inline(row)}</p>`).join('');
  const head = body[0] ?? [];
  const rest = body.slice(1);
  return `<div class="agent-md-table-wrap"><table class="agent-md-table"><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rest.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderBlock(block: string): string {
  const trimmed = block.trim();
  if (!trimmed) return '';
  if (/^```/.test(trimmed)) {
    const match = trimmed.match(/^```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```$/);
    const language = match?.[1] || 'text';
    const code = escapeHtml((match?.[2] ?? trimmed.replace(/^```|```$/g, '')).replace(/\n$/, ''));
    return `<div class="agent-md-codeblock"><div class="agent-md-code-header"><span>${escapeHtml(language)}</span><button type="button" data-copy-code aria-label="Copy">Copy</button></div><pre><code>${code}</code></pre></div>`;
  }
  const lines = trimmed.split('\n');
  if (lines.every((line) => /^\|.+\|$/.test(line.trim())) && lines.length >= 2) {
    return renderTable(lines.map((line) => line.trim()));
  }
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return `<ul class="agent-md-ul">${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
  }
  if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    return `<ol class="agent-md-ol">${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
  }
  if (lines.every((line) => /^\s*>/.test(line))) {
    return `<blockquote class="agent-md-quote">${inline(lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' '))}</blockquote>`;
  }
  const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
  if (heading && !trimmed.includes('\n')) {
    const level = heading[1].length;
    return `<h${level} class="agent-md-h${level}">${inline(heading[2])}</h${level}>`;
  }
  if (trimmed === '---' || trimmed === '***') return '<hr class="agent-md-hr">';
  return `<p class="agent-md-p">${lines.map((line) => inline(line)).join('<br>')}</p>`;
}

export function renderMarkdown(source: string): string {
  const text = source.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const chunks: string[] = [];
  const fence = /```[a-zA-Z0-9_-]*\n?[\s\S]*?```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text))) {
    if (match.index > last) chunks.push(text.slice(last, match.index));
    chunks.push(match[0]);
    last = match.index + match[0].length;
  }
  if (last < text.length) chunks.push(text.slice(last));
  return chunks.map((chunk) => {
    if (chunk.startsWith('```')) return renderBlock(chunk.trim());
    return chunk.split(/\n{2,}/).map(renderBlock).join('');
  }).join('');
}
