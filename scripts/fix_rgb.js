const fs = require('fs');

const files = [
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/_ReportGenerator_adaptive.tsx',
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/ReportFiltersModal.tsx',
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/IntelligenceCommon.tsx',
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/IntelligenceModals.tsx',
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/_archives_adaptive.tsx',
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/_reports_adaptive.tsx',
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/_graphs_adaptive.tsx',
  'c:/Users/j/Documents/Github/TrustFlow/components/intelligence/_analytics_adaptive.tsx'
];

files.forEach(p => {
  if (!fs.existsSync(p)) return;
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
    // color="rgb(var(--brand-primary))" -> color={colors.primary}
    const regex1 = new RegExp('([a-zA-Z]+)="rgb\\(var\\(' + cssVar + '\\)\\)"', 'g');
    txt = txt.replace(regex1, "$1={colors." + jsProp + "}");
    
    // 'rgb(var(--brand-primary))' -> colors.primary
    const regex2 = new RegExp("'rgb\\(var\\(" + cssVar + "\\)\\)'", 'g');
    txt = txt.replace(regex2, "colors." + jsProp);
    
    // "rgb(var(--brand-primary))" -> colors.primary
    const regex3 = new RegExp('"rgb\\(var\\(' + cssVar + '\\)\\)"', 'g');
    txt = txt.replace(regex3, "colors." + jsProp);
  }

  // Handle explicit rgba(var(--brand-primary), 0.5) by replacing with the color object for now (opacity gets lost unfortunately unless we write a helper, but react native vector icons don't support opacity easily without a hex. Since we just want to eradicate the syntax error:
  // e.g., 'rgba(var(--brand-primary), 0.5)' -> colors.primary + '80' (approx 50% opacity in hex)
  for (const [cssVar, jsProp] of Object.entries(colorMap)) {
    const rgbaRegex = new RegExp("'rgba\\(var\\(" + cssVar + "\\),\\s*([0-9.]+)\\)'", 'g');
    txt = txt.replace(rgbaRegex, (match, opac) => {
      const alphaHex = Math.round(parseFloat(opac) * 255).toString(16).padStart(2, '0');
      return `(colors.${jsProp} + '${alphaHex}')`;
    });
  }

  // Handle hardcoded rgb(99,102,241) and rgba(99,102,241,...) which is BRAND
  txt = txt.replace(/['"]rgb\(99,102,241\)['"]/g, "colors.primary");
  txt = txt.replace(/['"]rgba\(99,102,241,\s*([0-9.]+)['"]/g, "(colors.primary + '26')"); // approximation for dim

  if (txt !== originalTxt) {
    if (!txt.includes('useThemeColors')) {
        txt = txt.replace(/(import .* from 'react(?:-native)?';\r?\n?)/, "$1import { useThemeColors } from '@/lib/themeColors';\n");
    }
    
    txt = txt.replace(/(function [A-Z][a-zA-Z0-9_]*\s*\([\s\S]*?\)\s*(?::\s*[^\{]+)?\s*\{\r?\n)/g, "$1  const colors = useThemeColors();\n");
    txt = txt.replace(/(const [A-Z][a-zA-Z0-9_]*\s*=\s*(?:<[^>]+>\s*)?\([^=>]*\)\s*(?::\s*[^\{]+)?\s*=>\s*\{\r?\n)/g, "$1  const colors = useThemeColors();\n");
    
    fs.writeFileSync(p, txt);
    console.log('Fixed RGB in ' + p);
  }
});
