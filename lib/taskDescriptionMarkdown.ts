export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'emphasis' | 'strike' | 'code'; children: MarkdownInline[]; value?: string }
  | { type: 'link'; label: MarkdownInline[]; href: string };
export type MarkdownBlock =
  | { type: 'paragraph' | 'heading' | 'quote'; children: MarkdownInline[]; level?: number }
  | { type: 'list'; ordered: boolean; items: { checked?: boolean; children: MarkdownInline[] }[] }
  | { type: 'code'; value: string; language?: string } | { type: 'divider' }
  | { type: 'table'; headers: MarkdownInline[][]; rows: MarkdownInline[][][] };
export const MAX_INPUT = 100_000; export const MAX_BLOCKS = 500;
const SAFE_LINK = /^(?:https?:|mailto:|tel:)/i;
export function isAllowedMarkdownHref(href: string): boolean { const value = href.trim(); if (!value || value.length > 2048 || /[\u0000-\u0020]/.test(value) || !SAFE_LINK.test(value)) return false; if (/^https?:/i.test(value)) { try { const url = new URL(value); return !!url.hostname && !url.username && !url.password; } catch { return false; } } return /^(?:mailto:[^\s@]+@[^\s@]+\.[^\s@]+|tel:[+\d][\d ().-]{2,40})$/i.test(value); }
export type MarkdownCommand = 'bold'|'italic'|'strike'|'heading'|'bullet'|'number'|'checklist'|'quote'|'inlineCode'|'codeBlock'|'link'|'divider'|'table'|'indent'|'outdent'|'tableRow'|'tableColumn'|'tableRemoveRow'|'tableRemoveColumn';
export type MarkdownSelection = { start: number; end: number };
function clamp(source: string, s: MarkdownSelection): MarkdownSelection { const start = Math.max(0, Math.min(source.length, Math.min(s.start, s.end))); return { start, end: Math.max(start, Math.min(source.length, Math.max(s.start, s.end))) }; }
function lines(source: string, selection: MarkdownSelection) { const s = clamp(source, selection); const start = source.lastIndexOf('\n', Math.max(0, s.start - 1)) + 1; const b = source.indexOf('\n', s.end); return { start, end: b < 0 ? source.length : b, selected: s }; }
function result(source: string, start: number, end: number, inserted: string, caret = start + inserted.length) { return { value: source.slice(0, start) + inserted + source.slice(end), selection: { start: caret, end: caret } }; }
const PREFIX: Record<string,string> = { heading:'## ', bullet:'- ', number:'1. ', checklist:'- [ ] ', quote:'> ' };
function toggleLines(source: string, selection: MarkdownSelection, command: string) {
  const range = lines(source, selection);
  const prefix = PREFIX[command];
  const chunks = source.slice(range.start, range.end).split('\n');
  const patterns: Record<string, RegExp> = {
    heading: /^\s*#{1,6}\s+/,
    bullet: /^\s*[-*+]\s+/,
    number: /^\s*\d+[.)]\s+/,
    checklist: /^\s*[-*+]\s+\[[ xX]\]\s+/,
    quote: /^\s*>\s?/,
  };
  const anyPrefix = /^\s*(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;
  const active = chunks.every((line) => patterns[command].test(line));
  const replacements = chunks.map((line) => {
    const stripped = line.replace(active ? patterns[command] : anyPrefix, '');
    return active ? stripped : prefix + stripped;
  });

  const mapOffset = (absolute: number) => {
    const relative = Math.max(0, Math.min(range.end - range.start, absolute - range.start));
    let oldAt = 0;
    let newAt = 0;
    for (let index = 0; index < chunks.length; index++) {
      const oldLine = chunks[index];
      const newLine = replacements[index];
      if (relative <= oldAt + oldLine.length) {
        const within = relative - oldAt;
        const removed = oldLine.length - oldLine.replace(active ? patterns[command] : anyPrefix, '').length;
        const added = active ? 0 : prefix.length;
        return range.start + newAt + Math.max(0, within - removed) + added;
      }
      oldAt += oldLine.length + 1;
      newAt += newLine.length + 1;
    }
    return range.start + replacements.join('\n').length;
  };

  const changed = replacements.join('\n');
  return {
    value: source.slice(0, range.start) + changed + source.slice(range.end),
    selection: { start: mapOffset(range.selected.start), end: mapOffset(range.selected.end) },
  };
}
type MarkdownCommandOptions = { tableRows?: number; tableColumns?: number };
export function createMarkdownTable(bodyRows = 1, columns = 2): string {
  const rowCount = Math.max(1, Math.min(20, Math.round(bodyRows)));
  const columnCount = Math.max(2, Math.min(10, Math.round(columns)));
  const header = Array.from({ length: columnCount }, (_, index) => index === 0 ? 'Header' : index === 1 ? 'Value' : `Column ${index + 1}`);
  const divider = Array(columnCount).fill('---');
  const body = Array.from({ length: rowCount }, () => Array(columnCount).fill('Cell'));
  return [header, divider, ...body].map(row => `| ${row.join(' | ')} |`).join('\n');
}
export function applyMarkdownCommand(source: string, selection: MarkdownSelection, command: MarkdownCommand, options: MarkdownCommandOptions = {}): {value:string;selection:MarkdownSelection} {
  const s=clamp(source,selection), selected=source.slice(s.start,s.end); const wraps: Partial<Record<MarkdownCommand,[string,string]>>={bold:['**','**'],italic:['*','*'],strike:['~~','~~'],inlineCode:['`','`'],codeBlock:['```\n','\n```']};
  if(wraps[command]){const [a,b]=wraps[command]!; if(source.slice(Math.max(0,s.start-a.length),s.start)===a&&source.slice(s.end,s.end+b.length)===b) return {value:source.slice(0,s.start-a.length)+selected+source.slice(s.end+b.length),selection:{start:s.start-a.length,end:s.end-a.length}}; return result(source,s.start,s.end,a+selected+b,selected?s.start+a.length+selected.length+b.length:s.start+a.length);}
  if(PREFIX[command]) return toggleLines(source,selection,command);
  if(command==='indent'||command==='outdent'){const r=lines(source,selection), chunks=source.slice(r.start,r.end).split('\n'); const remove=chunks.map(x=>command==='outdent'?Math.min(2,(x.match(/^ {1,2}/)||[''])[0].length):0); const changed=chunks.map((x,i)=>command==='indent'?`  ${x}`:x.slice(remove[i])).join('\n'); const mapOffset=(absolute:number)=>{const relative=Math.max(0,Math.min(r.end-r.start,absolute-r.start));let oldAt=0,newAt=0;for(let i=0;i<chunks.length;i++){const oldLine=chunks[i],delta=command==='indent'?2:-remove[i];if(relative<=oldAt+oldLine.length)return r.start+newAt+(relative-oldAt)+(relative===oldAt+oldLine.length?delta:Math.max(0,Math.min(relative-oldAt,Math.max(0,relative-oldAt+delta))));oldAt+=oldLine.length+1;newAt+=oldLine.length+1+delta;}return r.start+changed.length;}; return {value:source.slice(0,r.start)+changed+source.slice(r.end),selection:{start:mapOffset(s.start),end:mapOffset(s.end)}};}
  if(command==='divider') return result(source,s.start,s.end,`${s.start&&source[s.start-1]!='\n'?'\n':''}---\n`,s.start+(s.start&&source[s.start-1]!='\n'?5:4));
  if(command==='table') return result(source,s.start,s.end,createMarkdownTable(options.tableRows, options.tableColumns));
  if(command==='link'){const label=selected||'link text', inserted=`[${label}](https://example.com)`, urlStart=s.start+label.length+3; return {value:source.slice(0,s.start)+inserted+source.slice(s.end),selection:{start:urlStart,end:urlStart+19}};}
  if(command.startsWith('table')){const r=lines(source,selection), raw=source.slice(r.start,r.end).split('\n'), first=raw.find(x=>x.includes('|')); if(!first)return {value:source,selection}; const cols=first.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').length, rows=raw.filter((line,index)=>index!==1||!/^\s*\|?\s*:?-{3,}:?/.test(line)).map(x=>x.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(y=>y.trim())); if(command==='tableRow')rows.push(Array(cols).fill('Cell')); if(command==='tableColumn')rows.forEach(x=>x.push('Cell')); if(command==='tableRemoveRow'&&rows.length>2)rows.splice(2,1); if(command==='tableRemoveColumn'&&cols>1)rows.forEach(x=>x.pop()); const rendered=rows.map((row,i)=>`| ${row.join(' | ')} |${i===0?`\n| ${row.map(()=> '---').join(' | ')} |`:''}`).join('\n'); return {value:source.slice(0,r.start)+rendered+source.slice(r.end),selection:{start:r.start+rendered.length,end:r.start+rendered.length}};}
  return {value:source,selection};
}
export function continueMarkdownOnEnter(source:string,cursorOrSelection:number|MarkdownSelection){const selection=typeof cursorOrSelection==='number'?{start:cursorOrSelection,end:cursorOrSelection}:clamp(source,cursorOrSelection), at=selection.start, ls=source.lastIndexOf('\n',at-1)+1, lineEnd=source.indexOf('\n',Math.max(at,selection.end)), line=source.slice(ls,lineEnd<0?source.length:lineEnd), m=line.match(/^(\s*)(-\s+\[[ xX]\]\s+|[-*+] |\d+[.)] |> )(.*)$/); if(!m)return result(source,selection.start,selection.end,'\n'); if(!m[3])return result(source,ls,selection.end,'\n'); if(selection.start!==selection.end)return result(source,ls+1,lineEnd<0?source.length:lineEnd+1,'\n'); const marker=/^-\s+\[[ xX]\]/.test(m[2])?'- [ ] ':/^\d/.test(m[2])?`${Number((m[2].match(/\d+/)||['0'])[0])+1}. `:m[2]; return result(source,selection.start,selection.end,`\n${m[1]}${marker}`);}
function text(value:string):MarkdownInline{return{type:'text',value};}
function plainUrls(value:string):MarkdownInline[]{const out:MarkdownInline[]=[];let at=0;const re=/https?:\/\/[^\s<>]+/gi;let m:RegExpExecArray|null;while((m=re.exec(value))){const raw=m[0],trail=(raw.match(/[.,!?;:]+$/)||[''])[0],href=trail?raw.slice(0,-trail.length):raw;if(!isAllowedMarkdownHref(href))continue;if(m.index>at)out.push(text(value.slice(at,m.index)));out.push({type:'link',label:[text(href)],href});if(trail)out.push(text(trail));at=m.index+raw.length;}if(at<value.length)out.push(text(value.slice(at)));return out.length?out:[text(value)];}
export function parseMarkdownInline(source:string,depth=0):MarkdownInline[]{if(depth>8)return[text(source)];const out:MarkdownInline[]=[];let rest=source;while(rest){const m=rest.match(/^(?:\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*([^*\n]+)\*|_([^_\n]+)_)/);if(!m){const n=rest.search(/[\*_~`\[]/),take=n<0?rest.length:Math.max(1,n);out.push(...plainUrls(rest.slice(0,take)));rest=rest.slice(take);continue;}if(m[1]||m[2])out.push({type:'strong',children:parseMarkdownInline(m[1]||m[2],depth+1)});else if(m[3])out.push({type:'strike',children:parseMarkdownInline(m[3],depth+1)});else if(m[4])out.push({type:'code',children:[text(m[4])],value:m[4]});else if(m[5]&&m[6]&&isAllowedMarkdownHref(m[6]))out.push({type:'link',label:parseMarkdownInline(m[5],depth+1),href:m[6]});else if(m[7]||m[8])out.push({type:'emphasis',children:[text(m[7]||m[8])]});else out.push(text(m[0]));rest=rest.slice(m[0].length);}return out.flatMap(n=>n.type==='text'?splitEmphasis(n.value):[n]);}
function splitEmphasis(value:string,depth=0):MarkdownInline[]{if(depth>32)return[text(value)];const m=value.match(/^(.*?)(?:\*([^*\n]+)\*|_([^_\n]+)_)(.*)$/);if(!m)return plainUrls(value);return[...(m[1]?splitEmphasis(m[1],depth+1):[]),{type:'emphasis',children:[text(m[2]||m[3])] as MarkdownInline[]},...(m[4]?splitEmphasis(m[4],depth+1):[])];}
function splitRow(line:string){return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());}
export function parseTaskDescriptionMarkdown(source:string):MarkdownBlock[]{const ls=source.slice(0,MAX_INPUT).replace(/\r\n?/g,'\n').split('\n'),blocks:MarkdownBlock[]=[];let i=0;while(i<ls.length&&blocks.length<MAX_BLOCKS){const line=ls[i];if(!line.trim()){i++;continue;}if(/^\s*```/.test(line)){const language=line.trim().slice(3).trim()||undefined,code:string[]=[];i++;while(i<ls.length&&!/^\s*```/.test(ls[i]))code.push(ls[i++]);if(i<ls.length)i++;blocks.push({type:'code',value:code.join('\n'),language});continue;}if(/^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/.test(line)){blocks.push({type:'divider'});i++;continue;}const h=line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);if(h){blocks.push({type:'heading',level:h[1].length,children:parseMarkdownInline(h[2])});i++;continue;}if(/^\s*>/.test(line)){blocks.push({type:'quote',children:parseMarkdownInline(line.replace(/^\s*>\s?/,''))});i++;continue;}const l=line.match(/^\s*([-*+] |\d+[.)] )(.+)$/);if(l){const ordered=/^\d/.test(l[1]),items:{checked?:boolean;children:MarkdownInline[]}[]=[];while(i<ls.length){const x=ls[i].match(/^\s*([-*+] |\d+[.)] )(.+)$/);if(!x||/^\d/.test(x[1])!==ordered)break;const c=x[2].match(/^\[([ xX])\]\s+(.*)$/);items.push(c?{checked:c[1].toLowerCase()==='x',children:parseMarkdownInline(c[2])}:{children:parseMarkdownInline(x[2])});i++;}blocks.push({type:'list',ordered,items});continue;}if(line.includes('|')&&i+1<ls.length&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(ls[i+1])){const headers=splitRow(line).map(x=>parseMarkdownInline(x));i+=2;const rows:MarkdownInline[][][]=[];while(i<ls.length&&ls[i].includes('|')&&ls[i].trim()){rows.push(splitRow(ls[i]).map(x=>parseMarkdownInline(x)));i++;}blocks.push({type:'table',headers,rows});continue;}const p=[line];i++;while(i<ls.length&&ls[i].trim()&&!/^(?:\s*```|\s*#{1,6}\s|\s*>|\s*[-*+] |\s*\d+[.)] )/.test(ls[i]))p.push(ls[i++]);blocks.push({type:'paragraph',children:parseMarkdownInline(p.join('\n'))});}return blocks;}
function inlineText(nodes:MarkdownInline[]|undefined):string{return(nodes||[]).map(n=>n.type==='text'||n.type==='code'?n.value||'':n.type==='link'?inlineText(n.label):inlineText(n.children)).join('');}
export function markdownToPlainText(source:string){return parseTaskDescriptionMarkdown(source).map(b=>b.type==='code'?b.value:b.type==='divider'?'':b.type==='list'?b.items.map(x=>inlineText(x.children)).join('\n'):b.type==='table'?[b.headers.map(x=>inlineText(x)).join(' | '),...b.rows.map(r=>r.map(x=>inlineText(x)).join(' | '))].join('\n'):inlineText(b.children)).join('\n').replace(/\n{3,}/g,'\n\n').trim();}
export function markdownExcerpt(source:string,maxLength=160){const value=markdownToPlainText(source);return value.length<=maxLength?value:`${value.slice(0,Math.max(0,maxLength-1)).trimEnd()}…`;}
