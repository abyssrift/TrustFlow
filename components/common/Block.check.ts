import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const block = fs.readFileSync(path.join(root, 'components/common/Block.tsx'), 'utf8');
const entity = fs.readFileSync(path.join(root, 'components/entities/EntityUI.tsx'), 'utf8');
const retention = fs.readFileSync(path.join(root, 'components/admin/RetentionPanel.tsx'), 'utf8');
const billing = fs.readFileSync(path.join(root, 'components/admin/BillingPanel.tsx'), 'utf8');
const dataExport = fs.readFileSync(path.join(root, 'components/admin/DataExportPanel.tsx'), 'utf8');
const radar = fs.readFileSync(path.join(root, 'components/intelligence/RadarWidgets.tsx'), 'utf8');
const adaptiveIntelligence = fs.readFileSync(path.join(root, 'components/intelligence/_index_adaptive.tsx'), 'utf8');
const uiRules = fs.readFileSync(path.join(root, '.agents/rules/ui-consistency.md'), 'utf8');
const utilityRegistry = fs.readFileSync(path.join(root, '.agents/rules/global-utilities-index.md'), 'utf8');

for (const token of ['title?: string', 'hint?: string', 'icon?: React.ReactNode', 'eyebrow?: React.ReactNode', 'right?: React.ReactNode', 'accent?: string', 'rounded-2xl', 'p-4 md:p-5', 'title || hint || icon || eyebrow || right']) {
  if (!block.includes(token)) throw new Error(`Block API/default missing: ${token}`);
}
if (!entity.includes("<Block") || !entity.includes('eyebrow={kind ? <EntityTag kind={kind} /> : undefined}')) {
  throw new Error('SectionCard is not backed by Block with entity compatibility composition');
}
if (!fs.readFileSync(path.join(root, 'components/intelligence/ProjectLens.tsx'), 'utf8').includes('eyebrow={<EntityTag kind="portfolio" />}')) {
  throw new Error('ProjectLens must preserve entity eyebrow semantics when adopting Block');
}
if ((retention.match(/<Block/g) || []).length !== 4) throw new Error('RetentionPanel should adopt all four top-level blocks');
if (retention.includes('bg-surface-card border border-surface-border rounded-2xl p-5')) throw new Error('RetentionPanel retains an ad-hoc top-level shell');
for (const title of ['title="Policy"', 'title="Inactive members"', 'title="Danger Zone"']) {
  if (!retention.includes(title)) throw new Error(`Retention header missing Block API: ${title}`);
}
if (!uiRules.includes('components/common/Block.tsx') || !utilityRegistry.includes('**Block** (`components/common/Block.tsx`')) {
  throw new Error('Block is missing from the authoritative shared UI conventions');
}

// Corrective layout contracts stay class-level and deterministic: wide peers
// stretch evenly, while operational sections remain full-width and compact.
if (!retention.includes("'flex-row items-stretch gap-6 mb-6'")) {
  throw new Error('Retention status/policy peers must use the wide flex row contract');
}
const inactiveStart = retention.indexOf('title="Inactive members"');
const dangerStart = retention.indexOf('title="Danger Zone"');
if (inactiveStart < 0 || !retention.slice(inactiveStart, dangerStart).includes('className="w-full mb-6"')) {
  throw new Error('Retention inactive members block must remain full width');
}
if (dangerStart < 0 || !retention.slice(dangerStart, dangerStart + 320).includes('className="w-full bg-state-danger/5"')) {
  throw new Error('Retention danger block must remain full width');
}
if (!retention.includes('items-center py-5')) throw new Error('Retention empty state should use compact py-5 spacing');

// Company retention purge must use the shared adaptive Popup contract; keep
// this structural check narrow so it does not snapshot the confirmation UI.
if (/import[^;]*\bModal\b|<Modal\b/.test(retention)) throw new Error('RetentionPanel must not use a raw Modal');
const purgePopupStart = retention.indexOf('const purgeCompanyContent');
const purgePopupSection = purgePopupStart >= 0 ? retention.slice(purgePopupStart) : '';
if (!purgePopupSection.includes('<Popup') || !purgePopupSection.includes('presentation="auto"') || !purgePopupSection.includes('maxWidth={440}')) {
  throw new Error('RetentionPanel company purge must use Popup auto with maxWidth 440');
}

// Billing keeps Current Plan as a shared surface, while repeated Available
// Plans cards remain specialized cards with their own layout.
const currentPlanStart = billing.indexOf('{/* Current plan */}');
const availablePlansStart = billing.indexOf('{/* Section divider */}');
if (currentPlanStart < 0 || availablePlansStart < 0) throw new Error('BillingPanel section markers missing');
const currentPlanSection = billing.slice(currentPlanStart, availablePlansStart);
if (!currentPlanSection.includes('<Block')) throw new Error('BillingPanel Current Plan must use Block');
for (const marker of ['accessibilityLabel="Redeem a trial code"', 'accessibilityLabel={redeemLoading ?', 'accessibilityState={{ disabled: redeemLoading', 'min-h-11']) {
  if (!currentPlanSection.includes(marker)) throw new Error(`BillingPanel redemption QOL marker missing: ${marker}`);
}
for (const marker of ['accessibilityLabel={isCurrent ?', 'accessibilityState={{ disabled: isCurrent', 'min-h-11']) {
  if (!billing.includes(marker)) throw new Error(`BillingPanel current-plan action marker missing: ${marker}`);
}
const planCardsSection = billing.slice(availablePlansStart);
if (!planCardsSection.includes('{data?.plans.map(p =>')) throw new Error('BillingPanel Available Plans map missing');
if (!/<View\s+key=\{p\.code\}/.test(planCardsSection)) throw new Error('BillingPanel Available Plans cards must remain specialized Views');
if (planCardsSection.includes('<Block')) throw new Error('BillingPanel Available Plans cards must not be generalized to Block');
if (!planCardsSection.includes('flex-1 min-w-[240px]')) throw new Error('BillingPanel Available Plans cards need flex/min-width sizing');
if (planCardsSection.includes('max-w-[360px]')) throw new Error('BillingPanel Available Plans must not use arbitrary max width');

// Data Export has one syntactic Block for the entity map and one aggregate
// shell. Format controls and live status stay outside those surfaces.
if ((dataExport.match(/<Block\b/g) || []).length !== 2) throw new Error('DataExportPanel should have exactly two syntactic Block occurrences');
const entityCardsStart = dataExport.indexOf('{/* Entity cards */}');
const exportEverythingStart = dataExport.indexOf('{/* Export everything as one workbook */}');
const formatToggleStart = dataExport.indexOf('{/* Format toggle */}');
const statusStart = dataExport.indexOf('{!!exportStatus &&');
if (entityCardsStart < 0 || exportEverythingStart < 0 || formatToggleStart < 0 || statusStart < 0) throw new Error('DataExportPanel structural markers missing');
if (!dataExport.slice(entityCardsStart, exportEverythingStart).includes('<Block key={e.key}')) throw new Error('DataExportPanel entity map must own the repeated Block');
if (!dataExport.slice(exportEverythingStart, statusStart).includes('<Block')) throw new Error('DataExportPanel Everything shell must use Block');
if (formatToggleStart > entityCardsStart || statusStart < exportEverythingStart) throw new Error('DataExportPanel format/status rows must remain outside Block sections');
const formatSection = dataExport.slice(formatToggleStart, entityCardsStart);
const entitySection = dataExport.slice(entityCardsStart, exportEverythingStart);
const allSection = dataExport.slice(exportEverythingStart, statusStart);
if (!entitySection.includes('flex-row flex-wrap gap-4 mb-5') || !entitySection.includes('flex-1 min-w-[300px]')) {
  throw new Error('DataExportPanel entity map must use flex-wrap with 300px peer minimums');
}
if (/(?:w-1\/2|w-\[\d+%\])/.test(entitySection)) throw new Error('DataExportPanel entity map must not use percentage width branches');
if (!allSection.includes('<Block') || allSection.includes('max-w-2xl')) throw new Error('DataExportPanel aggregate export must be a full-width Block without max width');
for (const marker of ['accessibilityRole="radio"', 'accessibilityState={{ checked:', 'min-h-[44px]']) {
  if (!formatSection.includes(marker)) throw new Error(`DataExportPanel format control marker missing: ${marker}`);
}
for (const marker of ['accessibilityLabel={`Export ${e.label}`}', 'accessibilityState={{ busy:', 'min-h-[44px]']) {
  if (!entitySection.includes(marker)) throw new Error(`DataExportPanel entity action marker missing: ${marker}`);
}
for (const marker of ['accessibilityLabel="Export all company data as an Excel workbook"', 'accessibilityState={{ busy:', 'min-h-[48px]', 'Exporting']) {
  if (!allSection.includes(marker)) throw new Error(`DataExportPanel all action marker missing: ${marker}`);
}

// Named intelligence charts use Block; compact trend comparisons remain KPI tiles.
if (!radar.includes("import Block from '@/components/common/Block';")) throw new Error('RadarWidgets must import Block');
const nextExport = (source: string, start: number) => {
  const next = source.indexOf('export const ', start + 1);
  return next < 0 ? source.length : next;
};
for (const name of ['SLARiskAlertWeb', 'ConversionFunnelChartWeb', 'WorkDistributionChartWeb', 'QualityLeaderboardWeb', 'StageDwellChartWeb']) {
  const start = radar.indexOf(`export const ${name}`);
  if (start < 0 || !radar.slice(start, nextExport(radar, start)).includes('<Block')) throw new Error(`RadarWidgets ${name} must use Block`);
}
const trendStart = radar.indexOf('export const TrendComparisonCardsWeb');
if (trendStart < 0 || radar.slice(trendStart, nextExport(radar, trendStart)).includes('<Block')) throw new Error('RadarWidgets TrendComparisonCardsWeb must remain specialized');
const radarBlockOpeningLines = radar.split('\n').filter(line => line.includes('<Block'));
if (radarBlockOpeningLines.some(line => /(?:bg-surface-card|border-surface-border|rounded-|\bp-\d)/.test(line))) throw new Error('Migrated Radar Block className must not restate shared surface chrome');
if (!adaptiveIntelligence.includes("import Block from '@/components/common/Block';")) throw new Error('_index_adaptive.tsx must import Block');
for (const title of ['Retention Funnel', 'Operator Engagement', 'Quality Scoreboard', 'Pipeline Load Distribution']) {
  if (!adaptiveIntelligence.includes(`<Block title="${title}"`)) throw new Error(`_index_adaptive.tsx ${title} section must use Block`);
}
const adaptiveTrendStart = adaptiveIntelligence.indexOf('const TrendComparisonCards =');
const adaptiveTrendEnd = adaptiveIntelligence.indexOf('// Same validated categorical palette', adaptiveTrendStart);
if (adaptiveTrendStart < 0 || adaptiveTrendEnd < 0 || adaptiveIntelligence.slice(adaptiveTrendStart, adaptiveTrendEnd).includes('<Block')) throw new Error('_index_adaptive.tsx TrendComparisonCards must remain specialized');
const adaptiveBlockClassNames = [...adaptiveIntelligence.matchAll(/<Block\b[^>]*\bclassName="([^"]*)"/g)].map(m => m[1]);
if (adaptiveBlockClassNames.some(c => /(?:bg-surface-card|border-surface-border|rounded-|\bp\d)/.test(c))) throw new Error('Migrated adaptive Block className must not restate shared surface chrome');

// Adaptive Intelligence controls: semantics and touch sizing are contracts,
// while the surrounding card markup remains intentionally implementation-free.
const radarSectionStart = adaptiveIntelligence.indexOf('const RadarSection =');
const archivesSectionStart = adaptiveIntelligence.indexOf('const ArchivesSection =');
const reportConfigStart = adaptiveIntelligence.indexOf('const ReportConfigModal =');
const intelligenceHeaderSection = radarSectionStart >= 0 && archivesSectionStart >= 0
  ? adaptiveIntelligence.slice(radarSectionStart, archivesSectionStart)
  : '';
const archiveSection = archivesSectionStart >= 0 && reportConfigStart >= 0
  ? adaptiveIntelligence.slice(archivesSectionStart, reportConfigStart)
  : '';
for (const marker of ['accessibilityLabel="Customize visible metrics"', 'min-h-[44px]']) {
  if (!intelligenceHeaderSection.includes(marker)) throw new Error(`Intelligence Customize marker missing: ${marker}`);
}
if ((archiveSection.match(/accessibilityRole="tab"/g) || []).length < 2 || (archiveSection.match(/min-h-\[44px\]/g) || []).length < 2) {
  throw new Error('Intelligence archive subsection controls need tab semantics and 44px targets');
}
for (const marker of ['accessibilityRole="radio"', 'accessibilityState={{ checked: d === val }}', 'min-h-[44px]']) {
  if (!adaptiveIntelligence.includes(marker)) throw new Error(`Intelligence timeframe marker missing: ${marker}`);
}
for (const marker of ['accessibilityRole="progressbar"', 'accessibilityLabel="Loading intelligence data"', 'Loading intelligence data']) {
  if (!adaptiveIntelligence.includes(marker)) throw new Error(`Intelligence loading marker missing: ${marker}`);
}
if (!adaptiveIntelligence.includes('flex-row flex-wrap gap-4') || !adaptiveIntelligence.includes('flex-1 min-w-[320px]')) {
  throw new Error('Adaptive Intelligence wide peer rows need flex-wrap/min-width contracts');
}
if (/grid(?:-cols)?[-\s]/.test(adaptiveIntelligence)) throw new Error('Adaptive Intelligence must remain grid-free');

console.log('Block.check.ts: OK');
