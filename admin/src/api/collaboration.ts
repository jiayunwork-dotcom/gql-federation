import api from './index';
import { Draft, DraftHistory, LockStatus, ActivityLog, SyntaxValidationResult, Subgraph, SchemaDiffPreview, CompatibilityCheckResult, RemoteCursor } from '../types/collaboration';

export async function getSubgraphs(): Promise<Subgraph[]> {
  const response = await api.get('/subgraphs');
  return response.data.subgraphs;
}

export async function getCurrentSchema(subgraphId: string): Promise<{ sdl: string; versionId: string; version: number }> {
  const response = await api.get(`/collaboration/schema/${subgraphId}/current`);
  return response.data;
}

export async function getDrafts(): Promise<Draft[]> {
  const response = await api.get('/collaboration/drafts');
  return response.data.drafts;
}

export async function getDraft(subgraphId: string): Promise<Draft | null> {
  try {
    const response = await api.get(`/collaboration/drafts/${subgraphId}`);
    return response.data.draft;
  } catch (err: any) {
    if (err.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function saveDraft(subgraphId: string, sdl: string): Promise<Draft> {
  const response = await api.post(`/collaboration/drafts/${subgraphId}`, { sdl });
  return response.data.draft;
}

export async function deleteDraft(subgraphId: string): Promise<void> {
  await api.delete(`/collaboration/drafts/${subgraphId}`);
}

export async function getLockStatus(subgraphId: string): Promise<LockStatus> {
  const response = await api.get(`/collaboration/locks/${subgraphId}`);
  return response.data.lockStatus;
}

export async function acquireLock(subgraphId: string): Promise<{ success: boolean; position?: number; message: string }> {
  const response = await api.post(`/collaboration/locks/${subgraphId}/acquire`);
  return response.data;
}

export async function releaseLock(subgraphId: string, saveDraft?: boolean): Promise<{ success: boolean; message: string; transferredTo?: any }> {
  const response = await api.post(`/collaboration/locks/${subgraphId}/release`, { saveDraft });
  return response.data;
}

export async function refreshLock(subgraphId: string): Promise<boolean> {
  const response = await api.post(`/collaboration/locks/${subgraphId}/refresh`);
  return response.data.success;
}

export async function cancelWait(subgraphId: string): Promise<{ success: boolean; message: string }> {
  const response = await api.post(`/collaboration/locks/${subgraphId}/cancel-wait`);
  return response.data;
}

export async function getActivityLogs(
  subgraphId: string,
  limit: number = 50,
  offset: number = 0
): Promise<{ logs: ActivityLog[]; total: number; hasMore: boolean }> {
  const response = await api.get(`/collaboration/activity/${subgraphId}`, {
    params: { limit, offset },
  });
  return response.data;
}

export async function validateSDL(sdl: string): Promise<SyntaxValidationResult> {
  const response = await api.post('/collaboration/validate-sdl', { sdl });
  return response.data.validation;
}

export async function getOnlineUsers(subgraphId: string): Promise<Array<{ userId: string; userName: string; userEmail: string }>> {
  const response = await api.get(`/collaboration/online-users/${subgraphId}`);
  return response.data.users;
}

export async function submitChange(
  subgraphId: string,
  sdl: string,
  changelog: string
): Promise<{ message: string; approval: any; versionId: string }> {
  const response = await api.post(`/collaboration/submit/${subgraphId}`, { sdl, changelog });
  return response.data;
}

export async function getDiffPreview(
  subgraphId: string,
  newSdl: string
): Promise<SchemaDiffPreview> {
  const response = await api.post(`/collaboration/diff-preview/${subgraphId}`, { newSdl });
  return response.data;
}

export async function checkCompatibility(
  subgraphId: string,
  newSdl: string
): Promise<CompatibilityCheckResult> {
  const response = await api.post(`/collaboration/check-compatibility/${subgraphId}`, { newSdl });
  return response.data.compatibility;
}

export async function getDraftHistories(subgraphId: string): Promise<DraftHistory[]> {
  const response = await api.get(`/collaboration/draft-histories/${subgraphId}`);
  return response.data.histories;
}

export async function getDraftHistoryById(historyId: string): Promise<DraftHistory> {
  const response = await api.get(`/collaboration/draft-history/${historyId}`);
  return response.data.history;
}

export async function getRemoteCursors(subgraphId: string): Promise<RemoteCursor[]> {
  const response = await api.get(`/collaboration/remote-cursors/${subgraphId}`);
  return response.data.cursors;
}
