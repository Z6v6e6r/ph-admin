export type QrLinkStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export type QrLinkStatusFilter = QrLinkStatus | 'ALL';

export type QrLinkSortField =
  | 'createdAt'
  | 'name'
  | 'redirectsPeriod'
  | 'redirectsTotal'
  | 'lastRedirectAt';

export type QrLinkSortDirection = 'asc' | 'desc';

export interface StoredQrLink {
  id: string;
  code: string;
  name: string;
  stationId?: string | null;
  stationName?: string | null;
  placement?: string | null;
  description?: string | null;
  targetUrl: string;
  status: QrLinkStatus;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  idempotency?: {
    actorId: string;
    key: string;
    intentHash: string;
  };
}

export interface QrDailyStat {
  qrId: string;
  /** Business-timezone calendar day, YYYY-MM-DD. */
  dateKey: string;
  redirectsCount: number;
  lastRedirectAt: string;
  updatedAt: string;
}

export interface QrLinkView {
  id: string;
  code: string;
  name: string;
  stationId: string | null;
  stationName: string | null;
  placement: string | null;
  description: string | null;
  targetUrl: string;
  status: QrLinkStatus;
  shortUrl: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface QrLinkListItem extends QrLinkView {
  redirectsPeriod: number;
  redirectsTotal: number;
  lastRedirectAt: string | null;
}

export interface QrListMetrics {
  totalQr: number;
  activeQr: number;
  redirectsPeriod: number;
}

export interface QrPeriod {
  from: string;
  to: string;
  timezone: string;
}

export interface QrLinkListResponse {
  items: QrLinkListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  metrics: QrListMetrics;
  period: QrPeriod;
  persistence: 'MONGODB';
}

export interface QrLinkTotals {
  redirectsPeriod: number;
  redirectsTotal: number;
  lastRedirectAt: string | null;
}

export interface QrLinkAnalytics {
  link: QrLinkView;
  period: QrPeriod;
  totals: QrLinkTotals;
  daily: Array<{ date: string; redirects: number }>;
}

export interface QrHistoryEntry {
  id: string;
  at: string;
  action: string;
  actorLogin?: string;
  actorTitle?: string;
  targetLabel?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface QrHistoryResponse {
  items: QrHistoryEntry[];
  persistence: 'MONGODB' | 'DISABLED';
}

export interface QrStationOption {
  stationId: string;
  stationName: string;
  isActive: boolean;
}

export const QR_ALLOWED_HOSTS_KEY = 'allowed-hosts';

export interface StoredQrAllowedHostsSettings {
  key: string;
  hosts: string[];
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface QrAllowedHostsView {
  /** Hosts from the trusted server configuration; always allowed. */
  defaults: string[];
  /** Additional hosts managed from CUP for this deployment. */
  extra: string[];
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface QrListQuery {
  q?: string;
  stationId?: string;
  status?: QrLinkStatusFilter;
  from?: string;
  to?: string;
  sort?: QrLinkSortField;
  direction?: QrLinkSortDirection;
  page?: number;
  pageSize?: number;
  /** null = all stations; array = only those station ids. */
  stationScope: string[] | null;
}

export type QrPublicResolution =
  | { kind: 'redirect'; location: string; qrId: string; statsRecorded: boolean }
  | { kind: 'paused' }
  | { kind: 'archived' }
  | { kind: 'not_found' };

export interface QrRedirectWriteResult {
  recorded: boolean;
  errorCode?: string;
}
