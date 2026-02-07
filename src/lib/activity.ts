import { db } from './db';
import type { ActivityEntityType } from './types';
import { createId, nowIso } from './utils';

interface LogActivityInput {
  action: string;
  entityType: ActivityEntityType;
  entityId: string;
  performedByEmployeeId: string;
  details: string;
  status?: 'success' | 'warning' | 'error';
}

export const logActivity = async ({
  action,
  entityType,
  entityId,
  performedByEmployeeId,
  details,
  status = 'success'
}: LogActivityInput): Promise<void> => {
  await db.activityLogs.add({
    id: createId(),
    action,
    entityType,
    entityId,
    performedByEmployeeId,
    timestamp: nowIso(),
    details,
    status,
    ipAddress: 'offline'
  });
};
