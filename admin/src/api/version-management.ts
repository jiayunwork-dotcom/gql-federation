import api from './index';
import { 
  SchemaVersion, 
  VersionTimelineResult, 
  CanaryRelease, 
  CanaryMetricsSummary, 
  ReleaseAuditLog,
  VersionCompareResult 
} from '../types/version-management';

export interface GetTimelineParams {
  subgraphId?: string;
  subgraphName?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
}

export async function getVersionsTimeline(params: GetTimelineParams = {}): Promise<VersionTimelineResult[]> {
  const response = await api.get('/versions/timeline', { params });
  return response.data.data;
}

export async function getVersionDetail(versionId: string): Promise<SchemaVersion> {
  const response = await api.get(`/versions/${versionId}`);
  return response.data.data;
}

export async function compareVersions(versionId1: string, versionId2: string): Promise<VersionCompareResult> {
  const response = await api.post('/versions/compare', {
    versionId1,
    versionId2,
  });
  return response.data.data;
}

export interface StartCanaryParams {
  subgraphId: string;
  newVersionId: string;
  initialPercent?: number;
  errorRateThreshold?: number;
  autoFullReleaseHours?: number;
}

export async function startCanaryRelease(params: StartCanaryParams): Promise<CanaryRelease> {
  const response = await api.post('/canary', params);
  return response.data.data;
}

export async function getActiveCanary(subgraphId: string): Promise<CanaryRelease | null> {
  const response = await api.get(`/canary/active/${subgraphId}`);
  return response.data.data;
}

export async function getCanaryById(canaryId: string): Promise<CanaryRelease> {
  const response = await api.get(`/canary/${canaryId}`);
  return response.data.data;
}

export interface GetCanaryListParams {
  subgraphId?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export async function getCanaryReleases(params: GetCanaryListParams = {}): Promise<{ rows: CanaryRelease[]; total: number }> {
  const response = await api.get('/canary', { params });
  return { rows: response.data.data, total: response.data.total };
}

export async function adjustCanaryPercent(canaryId: string, newPercent: number, reason?: string): Promise<CanaryRelease> {
  const response = await api.put(`/canary/${canaryId}/percent`, { newPercent, reason });
  return response.data.data;
}

export async function rollbackCanary(canaryId: string, reason?: string): Promise<CanaryRelease> {
  const response = await api.post(`/canary/${canaryId}/rollback`, { reason });
  return response.data.data;
}

export async function fullReleaseCanary(canaryId: string, reason?: string): Promise<CanaryRelease> {
  const response = await api.post(`/canary/${canaryId}/full-release`, { reason });
  return response.data.data;
}

export async function getCanaryMetrics(canaryId: string): Promise<CanaryMetricsSummary> {
  const response = await api.get(`/canary/${canaryId}/metrics`);
  return response.data.data;
}

export async function checkCanaryAutoFullRelease(canaryId: string): Promise<boolean> {
  const response = await api.get(`/canary/${canaryId}/auto-full-release-check`);
  return response.data.data.canFullRelease;
}

export interface GetAuditLogsParams {
  subgraphId?: string;
  actionType?: string;
  startTime?: string;
  endTime?: string;
  canaryReleaseId?: string;
  limit?: number;
  offset?: number;
}

export async function getReleaseAuditLogs(params: GetAuditLogsParams = {}): Promise<{ rows: ReleaseAuditLog[]; total: number }> {
  const response = await api.get('/release-audit', { params });
  return { rows: response.data.data, total: response.data.total };
}

export async function getReleaseAuditLogById(id: string): Promise<ReleaseAuditLog> {
  const response = await api.get(`/release-audit/${id}`);
  return response.data.data;
}

export default {
  getVersionsTimeline,
  getVersionDetail,
  compareVersions,
  startCanaryRelease,
  getActiveCanary,
  getCanaryById,
  getCanaryReleases,
  adjustCanaryPercent,
  rollbackCanary,
  fullReleaseCanary,
  getCanaryMetrics,
  checkCanaryAutoFullRelease,
  getReleaseAuditLogs,
  getReleaseAuditLogById,
};
