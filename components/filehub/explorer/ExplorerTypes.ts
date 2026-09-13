import type { MultiViewColumn, MultiViewEmptyState, MultiViewGroupOption, MultiViewStatusBanner, MultiViewMode } from '@/components/common/MultiViewList';
import type { ExplorerCapabilities, ExplorerMode, ExplorerOrigin } from '@/lib/fileExplorerMode';

export type { ExplorerCapabilities, ExplorerMode, ExplorerOrigin };

export type ExplorerItem = {
  id: string;
  name: string;
  projectId?: string | null;
  projectName?: string | null;
  origin?: ExplorerOrigin | null;
  path?: string | null;
  canonicalPath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ExplorerBreadcrumb = { id: string; label: string };

export type ExplorerCollectionProps<T> = {
  items: T[];
  keyExtractor: (item: T) => string;
  renderCard: (item: T, density: 'large' | 'medium') => React.ReactNode;
  renderRow: (item: T) => React.ReactNode;
  columns: MultiViewColumn<T>[];
  storageKey: string;
  defaultMode?: MultiViewMode;
  modes?: MultiViewMode[];
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  groupFilter?: { options: MultiViewGroupOption[]; activeId: string | null; onChange: (id: string | null) => void; allLabel?: string };
  loading?: boolean;
  statusBanner?: MultiViewStatusBanner | null;
  emptyState: MultiViewEmptyState;
  onItemPress?: (item: T) => void;
  testIDPrefix?: string;
};

export type ExplorerUploadDestination = {
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
};

export type ExplorerDetailPaneProps<T extends ExplorerItem = ExplorerItem> = {
  item: T;
  capabilities?: ExplorerCapabilities;
  onClose?: () => void;
  onOpen?: (item: T) => void;
  onDownload?: (item: T) => void;
  onShare?: (item: T) => void;
};
