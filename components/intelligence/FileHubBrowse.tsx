import { useFileHub } from "@/contexts/FileHubContext";
import { useDoubleTap } from "@/hooks/useDoubleTap";
import { useImageLightbox, type LightboxMedia } from "@/hooks/useImageLightbox";
import { useThemeColors } from "@/hooks/useThemeColors";
import { downloadFilesAsZip, openStorageFile } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import {
  isMultiSelectModifierActive,
  webModifierKeys,
} from "@/lib/webModifierKeys";
import { FontAwesome } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import FilterPanel, {
  FilterChipGroup,
  FilterDropdown,
  FilterSection,
} from "../common/FilterPanel";
import { FilePreviewCard } from "../common/FilePreviewCard";
import Tooltip from "../common/Tooltip";
import ExplorerCollection from "../filehub/explorer/ExplorerCollection";
import FileHubDetailPane, { type DetailFile } from "./FileHubDetailPane";
import { fileIcon, formatSize } from "./TaskFileResults";
import {
  canonicalIdentityKey,
  getBrowseOriginLabel,
  getBrowsePageCursor,
  groupByCanonicalIdentity,
  isCurrentBrowseRequest,
  type BrowsePageCursor,
} from "./filehubShared";

export type BrowseItem = {
  source: "filehub" | "submission" | "task_brief";
  file_id: string;
  canonical_file_id: string | null;
  canonical_version_id: string | null;
  folder_id: string | null;
  workspace_folder_id: string | null;
  workspace_path: string | null;
  origin:
    "workspace" | "deliverable" | "shared" | "brief" | "submission" | null;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  task_id: string | null;
  task_title: string | null;
  project_id: string | null;
  project_name: string | null;
  task_category: string | null;
  submission_id: string | null;
  uploaded_by?: string | null;
  alias_count?: number;
  alias_context?: string;
};

type Facets = {
  projects: { id: string; name: string; count: number }[];
  categories: { category: string; count: number }[];
  types: { type: string; count: number }[];
  origins: { origin: BrowseItem["origin"]; count: number }[];
};

const PAGE = 60;
const ORIGIN_OPTIONS = [
  "workspace",
  "deliverable",
  "shared",
  "brief",
  "submission",
];
const SOURCE_TABS = [
  { label: "All", value: null },
  { label: "FileHub", value: ["filehub"] },
  { label: "Submissions", value: ["submission"] },
  { label: "Briefs", value: ["task_brief"] },
] as const;
const idOf = (item: BrowseItem) => canonicalIdentityKey(item);
const isImage = (mime: string | null) =>
  !!mime && mime.toLowerCase().includes("image");

/** Collapse canonical file/version/storage aliases before rendering or selecting bytes. */
export function groupBrowseItems(rows: BrowseItem[]): BrowseItem[] {
  return groupByCanonicalIdentity(rows).map((group) => {
    const representative = group[0];
    const contexts = [
      ...new Set(
        group.map((row) =>
          [
            row.origin && getBrowseOriginLabel(row.origin),
            row.project_name || row.task_title,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
    ].filter(Boolean);
    return {
      ...representative,
      alias_count: Math.max(0, group.length - 1),
      alias_context: contexts.length > 1 ? contexts.join(" · ") : undefined,
    };
  });
}

export default function FileHubBrowse({ compact }: { compact?: boolean }) {
  const colors = useThemeColors();
  const { searchDebounced } = useFileHub();
  const [sourceTab, setSourceTab] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [rawBrowseItems, setRawBrowseItems] = useState<BrowseItem[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const queryGenerationRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);
  const [detail, setDetail] = useState<BrowseItem | null>(null);
  const [fastPreview, setFastPreview] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isDoubleTap = useDoubleTap();
  const sources = SOURCE_TABS[sourceTab].value;
  const items = useMemo(
    () => groupBrowseItems(rawBrowseItems),
    [rawBrowseItems],
  );
  const media: LightboxMedia[] = useMemo(
    () =>
      items.map((item) => ({
        id: idOf(item),
        name: item.file_name,
        storagePath: item.storage_path,
        mimeType: item.mime_type,
        bucket: item.bucket,
        sizeBytes: item.size_bytes,
      })),
    [items],
  );
  const { signedUrls } = useImageLightbox(media, "filehub-files");

  const fetchPage = useCallback(
    async (before: BrowsePageCursor | null, withFacets: boolean) => {
      const { data, error } = await supabase.rpc("rpc_filehub_browse", {
        p_query: searchDebounced || null,
        p_sources: sources,
        p_project_id: projectId,
        p_origins: origin ? [origin] : null,
        p_category: category,
        p_type: type,
        p_before: before?.created_at ?? null,
        p_before_file_id: before?.file_id ?? null,
        p_limit: PAGE,
        p_include_facets: withFacets,
      });
      if (error) {
        console.error("[FileHubBrowse] error", error);
        return {
          rawItems: [] as BrowseItem[],
          has_more: false,
          facets: null,
          rawCursor: before,
        };
      }
      const result = data as {
        items: BrowseItem[];
        has_more: boolean;
        facets: Facets | null;
      };
      const rawItems = result.items ?? [];
      return {
        ...result,
        rawItems,
        rawCursor: getBrowsePageCursor(rawItems, before),
      };
    },
    [searchDebounced, sources, projectId, origin, category, type],
  );
  const [pageCursor, setPageCursor] = useState<BrowsePageCursor | null>(null);
  useEffect(() => {
    const requestGeneration = queryGenerationRef.current + 1;
    queryGenerationRef.current = requestGeneration;
    let cancelled = false;
    setLoading(true);
    setLoadingMore(false);
    setPageCursor(null);
    setDetail(null);
    setRawBrowseItems([]);
    fetchPage(null, true).then((result) => {
      if (
        cancelled ||
        !isCurrentBrowseRequest(requestGeneration, queryGenerationRef.current)
      )
        return;
      setRawBrowseItems(result.rawItems);
      setPageCursor(result.rawCursor);
      setHasMore(result.has_more);
      setFacets(result.facets);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);
  const loadMore = async () => {
    if (loadingMore || !rawBrowseItems.length || !pageCursor) return;
    const requestGeneration = queryGenerationRef.current;
    setLoadingMore(true);
    try {
      const result = await fetchPage(pageCursor, false);
      if (
        !isCurrentBrowseRequest(requestGeneration, queryGenerationRef.current)
      )
        return;
      setRawBrowseItems((previous) => [...previous, ...result.rawItems]);
      setPageCursor(result.rawCursor);
      setHasMore(result.has_more);
    } finally {
      if (isCurrentBrowseRequest(requestGeneration, queryGenerationRef.current))
        setLoadingMore(false);
    }
  };
  const toggleOne = (item: BrowseItem, index: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      const key = idOf(item);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setAnchorIdx(index);
  };
  const onItemPress = (item: BrowseItem) => {
    const index = items.findIndex((row) => idOf(row) === idOf(item));
    if (webModifierKeys.shift && anchorIdx !== null) {
      const [a, b] = [anchorIdx, index].sort((x, y) => x - y);
      setSelectedIds((previous) => {
        const next = new Set(previous);
        for (let i = a; i <= b; i++) next.add(idOf(items[i]));
        return next;
      });
      return;
    }
    if (isMultiSelectModifierActive()) {
      toggleOne(item, index);
      return;
    }
    setFastPreview(isDoubleTap(idOf(item)));
    setDetail(item);
    setAnchorIdx(index);
  };
  const selectedItems = items.filter((item) => selectedIds.has(idOf(item)));
  const downloadSelected = async () => {
    if (!selectedItems.length || zipping) return;
    setZipping(true);
    try {
      const unique = new Map(
        selectedItems.map((item) => [canonicalIdentityKey(item), item]),
      );
      await downloadFilesAsZip(
        [...unique.values()].map((item) => ({
          storage_path: item.storage_path,
          bucket: item.bucket,
          original_name: item.file_name,
          mime_type: item.mime_type,
        })),
        `filehub-${unique.size}-files.zip`,
      );
    } finally {
      setZipping(false);
    }
  };
  const filterCount = [projectId, origin, category, type].filter(
    Boolean,
  ).length;
  const clearFilters = () => {
    setProjectId(null);
    setOrigin(null);
    setCategory(null);
    setType(null);
  };
  const filterBody = (
    <View className="px-4 pt-4">
      <View className="flex-row flex-wrap gap-4">
        <View className="flex-1 min-w-[220px]">
          <FilterDropdown
            label="Project"
            count={projectId ? 1 : 0}
            selected={projectId ? [projectId] : []}
            options={(facets?.projects ?? []).map((project) => ({
              value: project.id,
              label: project.name || "Untitled",
            }))}
            onToggle={(value) =>
              setProjectId(projectId === value ? null : value)
            }
          />
        </View>
        <View className="flex-1 min-w-[220px]">
          <FilterDropdown
            label="Origin"
            count={origin ? 1 : 0}
            selected={origin ? [origin] : []}
            options={ORIGIN_OPTIONS.map((value) => ({
              value,
              label: getBrowseOriginLabel(value),
            }))}
            onToggle={(value) => setOrigin(origin === value ? null : value)}
          />
        </View>
        <View className="flex-1 min-w-[220px]">
          <FilterDropdown
            label="Category"
            count={category ? 1 : 0}
            selected={category ? [category] : []}
            options={(facets?.categories ?? []).map((item) => ({
              value: item.category,
              label: item.category,
            }))}
            onToggle={(value) => setCategory(category === value ? null : value)}
          />
        </View>
        <View className="flex-1 min-w-[220px]">
          <FilterDropdown
            label="Type"
            count={type ? 1 : 0}
            selected={type ? [type] : []}
            options={(facets?.types ?? []).map((item) => ({
              value: item.type,
              label: item.type,
            }))}
            onToggle={(value) => setType(type === value ? null : value)}
          />
        </View>
      </View>
      <FilterSection label="Origin shortcuts" compact>
        <FilterChipGroup>
          {ORIGIN_OPTIONS.map((value) => (
            <TouchableOpacity
              key={value}
              onPress={() => setOrigin(origin === value ? null : value)}
              className={`min-h-11 min-w-11 px-3 py-2 rounded-xl border ${origin === value ? "bg-brand-primary/10 border-brand-primary" : "bg-surface-card border-surface-border"}`}
            >
              <Text
                className={
                  origin === value
                    ? "text-brand-primary text-xs font-bold"
                    : "text-typography-muted text-xs font-bold"
                }
              >
                {getBrowseOriginLabel(value)}
              </Text>
            </TouchableOpacity>
          ))}
        </FilterChipGroup>
      </FilterSection>
      <TouchableOpacity
        disabled={!filterCount}
        onPress={clearFilters}
        className="self-end min-h-11 min-w-11 px-3 py-2"
      >
        <Text className="text-state-danger text-xs font-black">
          Clear Filters
        </Text>
      </TouchableOpacity>
    </View>
  );

  // MultiViewList owns the grid card press. Disable the card's nested press targets here so a grid tap activates Browse once; list/details retain their outer row press contract.
  const renderCard = (item: BrowseItem, _density: "large" | "medium") => (
    <View pointerEvents="none">
      <FilePreviewCard
        fileName={item.file_name}
        mimeType={item.mime_type}
        subtitle={[
          item.project_name || item.task_title,
          getBrowseOriginLabel(item.origin),
          item.alias_count
            ? `${item.alias_count} alias${item.alias_count === 1 ? "" : "es"}`
            : null,
          item.alias_context ? `Also in ${item.alias_context}` : null,
          formatSize(item.size_bytes),
        ]
          .filter(Boolean)
          .join(" · ")}
        imageUri={isImage(item.mime_type) ? signedUrls[idOf(item)] : undefined}
        sizeBytes={item.size_bytes}
        onPress={() => onItemPress(item)}
      />
    </View>
  );
  const renderRow = (item: BrowseItem) => (
    <BrowseRow
      item={item}
      colors={colors}
      onDownload={() =>
        openStorageFile(
          item.bucket,
          item.storage_path,
          item.file_name,
          item.mime_type,
        )
      }
    />
  );
  const collection = (
    <ExplorerCollection
      items={items}
      keyExtractor={idOf}
      storageKey="filehub-global-browse"
      defaultMode="details"
      modes={["large", "medium", "list", "details"]}
      loading={loading}
      emptyState={{
        icon: "folder-open-o",
        title: "No files found",
        body: searchDebounced
          ? `Nothing matches “${searchDebounced}” with these filters.`
          : "Try a different filter.",
      }}
      onItemPress={onItemPress}
      testIDPrefix="filehub-browse"
      renderCard={renderCard}
      renderRow={renderRow}
      columns={[
        { key: "name", label: "File", flex: 2, render: renderRow },
        {
          key: "origin",
          label: "Origin",
          render: (item) => (
            <Text className="text-typography-muted text-xs">
              {getBrowseOriginLabel(item.origin)}
            </Text>
          ),
        },
        {
          key: "project",
          label: "Project",
          render: (item) => (
            <Text className="text-typography-muted text-xs">
              {item.project_name || "—"}
            </Text>
          ),
        },
        {
          key: "size",
          label: "Size",
          align: "right",
          render: (item) => (
            <Text className="text-typography-muted text-xs">
              {formatSize(item.size_bytes)}
            </Text>
          ),
        },
      ]}
    />
  );
  const detailFile: DetailFile | null = detail && { ...detail };
  const clearSelection = () => setSelectedIds(new Set());
  const header = (
    <View className="px-4 pt-4 flex-row flex-wrap items-center gap-2">
      <View className="flex-1 min-w-0">
        <FilterChipGroup>
          {SOURCE_TABS.map((tab, index) => (
            <TouchableOpacity
              key={tab.label}
              onPress={() => {
                setSourceTab(index);
                clearFilters();
              }}
              className={`min-h-11 min-w-11 px-4 py-2 rounded-xl border items-center justify-center ${sourceTab === index ? "bg-brand-primary/10 border-brand-primary" : "bg-surface-card border-surface-border"}`}
            >
              <Text
                className={
                  sourceTab === index
                    ? "text-brand-primary text-xs font-black"
                    : "text-typography-muted text-xs font-black"
                }
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </FilterChipGroup>
      </View>
      <FilterPanel
        isOpen={filtersOpen}
        onOpenChange={setFiltersOpen}
        activeCount={filterCount}
        trigger={({ toggle }) => (
          <Tooltip label="Filters">
            <TouchableOpacity
              accessibilityLabel="Filters"
              onPress={toggle}
              className="min-h-11 min-w-11 h-11 w-11 items-center justify-center rounded-xl border border-surface-border bg-surface-card"
            >
              <FontAwesome name="filter" size={13} color={colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>
        )}
      >
        {filterBody}
      </FilterPanel>
      {browseCapabilities.canUpload && <ExplorerUploadAction destination={{ label: "Upload files", accessibilityLabel: "Upload files", onPress: () => summon("upload") }} />}
    </View>
  );
  const collectionWithPagination = (
    <View className="flex-1 p-4">
      {collection}
      {hasMore && (
        <View className="items-center pt-4">
          <TouchableOpacity
            onPress={loadMore}
            disabled={loadingMore}
            className="min-h-11 min-w-11 px-6 py-3 rounded-xl bg-surface-card border border-surface-border flex-row items-center gap-2"
          >
            {loadingMore && (
              <ActivityIndicator size="small" color={colors.primary} />
            )}
            <Text className="text-typography-main font-black text-sm">
              Load more
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
  return (
    <View className="flex-1">
      <ExplorerInspectorShell
        header={header}
        collection={collectionWithPagination}
        inspector={detailFile ? (
          <FileHubDetailPane
            file={detailFile}
            onClose={() => setDetail(null)}
            compact={compact}
            autoPreview={fastPreview}
          />
        ) : undefined}
        mobilePane={detailFile ? "inspector" : "collection"}
        onRequestCollection={() => setDetail(null)}
      />
      {selectedItems.length > 0 && (
        <View className="absolute bottom-4 left-4 right-4 rounded-2xl border border-brand-primary/30 bg-surface-card px-4 py-3 flex-row items-center gap-3">
          <Text className="text-brand-primary text-xs font-black">
            {selectedItems.length} selected
          </Text>
          <View className="flex-1" />
          <TouchableOpacity
            disabled={zipping}
            onPress={downloadSelected}
            className="min-h-11 min-w-11 px-3 py-2 rounded-xl bg-brand-primary flex-row items-center gap-2"
          >
            {zipping && <ActivityIndicator size="small" color="#fff" />}
            <Text className="text-white text-xs font-black">Download ZIP</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={clearSelection}
            className="min-h-11 min-w-11 p-2"
          >
            <FontAwesome name="times" size={13} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function BrowseRow({
  item,
  colors,
  onDownload,
}: {
  item: BrowseItem;
  colors: { textMuted: string };
  onDownload?: () => void;
}) {
  return (
    <View className="flex-row items-center gap-3 flex-1">
      <FontAwesome
        name={fileIcon(item.mime_type)}
        size={16}
        color={colors.textMuted}
      />
      <View className="flex-1 min-w-0">
        <Text
          numberOfLines={1}
          className="text-typography-main text-sm font-bold"
        >
          {item.file_name}
        </Text>
        <Text numberOfLines={1} className="text-typography-muted text-[11px]">
          {[
            item.project_name || item.task_title,
            getBrowseOriginLabel(item.origin),
            item.alias_count
              ? `${item.alias_count} alias${item.alias_count === 1 ? "" : "es"}`
              : null,
            formatSize(item.size_bytes),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {item.alias_context && (
          <Text numberOfLines={1} className="text-typography-muted text-[10px]">
            Also in {item.alias_context}
          </Text>
        )}
      </View>
      {onDownload && (
        <Tooltip label="Download">
          <TouchableOpacity
            onPress={(event) => {
              event.stopPropagation();
              onDownload();
            }}
            className="min-h-11 min-w-11 rounded-lg items-center justify-center border border-surface-border"
          >
            <FontAwesome name="download" size={11} color={colors.textMuted} />
          </TouchableOpacity>
        </Tooltip>
      )}
    </View>
  );
}
