import type { MultiViewListProps } from '@/components/common/MultiViewList';
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

export type ExplorerCollectionProps<T> = MultiViewListProps<T>;

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
