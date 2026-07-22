// Minimal, cross-platform HTML → plain text for imported rich-text fields
// (Odoo description is an html field). Regex-based on purpose — no DOM, so it
// works on native as well as web. Not a full sanitiser; just readable text.
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')                 // <br> → newline
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n') // block ends → newline
    .replace(/<[^>]+>/g, '')                          // strip remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/[ \t]*\n[ \t]*/g, '\n')                 // trim spaces around newlines (Odoo indents its HTML)
    .replace(/\n{3,}/g, '\n\n')                       // collapse blank runs
    .trim();
}
