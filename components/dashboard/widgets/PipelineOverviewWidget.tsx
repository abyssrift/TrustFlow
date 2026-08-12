// Native half of the pipeline-overview chart split (#213, Wave 2b).
//
// The registry needs ONE import specifier for a component that exists in two
// mutually exclusive flavours: recharts on web, react-native-svg on native
// (global-utilities-index.md: "recharts cannot render on native RN, hence the
// platform split"). Metro resolves `.web.tsx` on web and this file everywhere
// else, so the native bundle never sees recharts at all.
//
// Nothing else lives here on purpose: the chart's props are built once, in
// registry.tsx's adapter, so the two platforms cannot drift on what `period` or
// `metrics` mean. This file only answers "which chart".

export { default } from '@/components/intelligence/PipelineOverviewChartNative';
