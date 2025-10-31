/**
 * Shared pending approvals storage
 * Used by telegram bot for approval workflows
 */

interface PendingApproval {
  gameId: string;
  userId: string;
  newTitle: string;
  detectedVersion?: string;
  expiresAt: number;
}

// In-memory storage for pending approvals
const pendingApprovals = new Map<string, PendingApproval>();

export function getPendingApprovals() {
  return pendingApprovals;
}

export function setPendingApproval(key: string, approval: PendingApproval) {
  pendingApprovals.set(key, approval);
}

export function deletePendingApproval(key: string) {
  pendingApprovals.delete(key);
}

export function clearExpiredApprovals() {
  const now = Date.now();
  for (const [key, approval] of pendingApprovals.entries()) {
    if (approval.expiresAt < now) {
      pendingApprovals.delete(key);
    }
  }
}
