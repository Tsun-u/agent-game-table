import type { SeatAction } from "./types.js";

export interface SameClaim { by: string; votes: Record<string, "agree" | "reject"> }
export const normalizedAnswer = (text: string): string => text.trim().toLowerCase();
export const startClaim = (by: string): SameClaim => ({ by, votes: { [by]: "agree" } });
export const pendingVotes = (claim: SameClaim, order: readonly string[]): string[] => order.filter((id) => !(id in claim.votes));
export function voteSame(claim: SameClaim, seatId: string, action: SeatAction): void {
  if (action.action !== "agree_same" && action.action !== "reject_same") throw new Error("現在只能投同義認定票。");
  if (seatId in claim.votes) throw new Error("這次已經投過票了。");
  claim.votes[seatId] = action.action === "agree_same" ? "agree" : "reject";
}
export function claimOutcome(claim: SameClaim, order: readonly string[]): boolean | null {
  if (Object.values(claim.votes).includes("reject")) return false;
  return pendingVotes(claim, order).length === 0 ? true : null;
}
export function timeoutClaim(claim: SameClaim, order: readonly string[]): void {
  for (const id of pendingVotes(claim, order)) claim.votes[id] = "reject";
}
