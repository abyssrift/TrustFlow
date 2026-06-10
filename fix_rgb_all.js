const fs = require('fs');
const path = require('path');

function findAdaptiveFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      findAdaptiveFiles(fullPath, fileList);
    } else if (fullPath.endsWith('_adaptive.tsx') || fullPath.endsWith('Modal.tsx') || fullPath.endsWith('Common.tsx') || fullPath.endsWith('Sections.tsx')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const allFiles = findAdaptiveFiles('c:/Users/j/Documents/Github/TrustFlow/components');

allFiles.forEach(p => {
  let txt = fs.readFileSync(p, 'utf8');
  let originalTxt = txt;

  const colorMap = {
    '--brand-primary': 'primary',
    '--text-muted': 'textMuted',
    '--text-dim': 'textDim',
    '--text-main': 'textMain',
    '--state-danger': 'danger',
    '--state-warning': 'warning',
    '--state-success': 'success',
    '--state-info': 'info',
    '--surface-border': 'border',
    '--brand-accent': 'primary', // fallback
  };

  for (const [cssVar, jsProp] of Object.entries(colorMap)) {
    const regex1 = new RegExp('([a-zA-Z]+)="rgb\\(var\\(' + cssVar + '\\)\\)"', 'g');
    txt = txt.replace(regex1, "$1={colors." + jsProp + "}");
    
    const regex2 = new RegExp("'rgb\\(var\\(" + cssVar + "\\)\\)'", 'g');
    txt = txt.replace(regex2, "colors." + jsProp);
    
    const regex3 = new RegExp('"rgb\\(var\\(' + cssVar + '\\)\\)"', 'g');
    txt = txt.replace(regex3, "colors." + jsProp);
  }

  for (const [cssVar, jsProp] of Object.entries(colorMap)) {
    const rgbaRegex = new RegExp("'rgba\\(var\\(" + cssVar + "\\),\\s*([0-9.]+)\\)'", 'g');
    txt = txt.replace(rgbaRegex, (match, opac) => {
      const alphaHex = Math.round(parseFloat(opac) * 255).toString(16).padStart(2, '0');
      return `(colors.${jsProp} + '${alphaHex}')`;
    });
  }

  txt = txt.replace(/['"]rgb\(99,102,241\)['"]/g, "colors.primary");
  txt = txt.replace(/['"]rgba\(99,102,241,\s*([0-9.]+)['"]/g, "(colors.primary + '26')"); 

  if (txt !== originalTxt) {
    if (!txt.includes('useThemeColors')) {
        txt = txt.replace(/(import .* from 'react(?:-native)?';\r?\n?)/, "$1import { useThemeColors } from '@/lib/themeColors';\n");
    }
    
    // Inject if not present
    const compRegex = /(function [A-Z][a-zA-Z0-9_]*\s*\([\s\S]*?\)\s*(?::\s*[^\{]+)?\s*\{\r?\n)/g;
    txt = txt.replace(compRegex, (match) => {
        return match + "  const colors = useThemeColors();\n";
    });
    
    const arrowCompRegex = /(const [A-Z][a-zA-Z0-9_]*\s*=\s*(?:<[^>]+>\s*)?\([^=>]*\)\s*(?::\s*[^\{]+)?\s*=>\s*\{\r?\n)/g;
    txt = txt.replace(arrowCompRegex, (match) => {
        return match + "  const colors = useThemeColors();\n";
    });

    // Remove duplicates if they exist
    txt = txt.replace(/const colors = useThemeColors\(\);\s+const colors = useThemeColors\(\);/g, "const colors = useThemeColors();");

    fs.writeFileSync(p, txt);
    console.log('Fixed RGB in ' + p);
  }
});
