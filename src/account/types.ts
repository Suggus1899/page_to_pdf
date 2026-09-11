export const FREE_QUOTA_BYTES = 150 * 1024 * 1024;
export const FREE_CYCLE_DAYS = 15;
export const PREMIUM_PRICE_USD = 2.49;
export const MIN_SUPPORT_USD = 4;

export type AccountPlan = 'free' | 'premium';
export type SubscriptionStatus =
  | 'none'
  | 'approval-pending'
  | 'active'
  | 'past-due'
  | 'cancelled'
  | 'suspended'
  | 'expired';

export interface AccountSnapshot {
  configured: boolean;
  signedIn: boolean;
  email?: string;
  emailVerified?: boolean;
  plan?: AccountPlan;
  freeBytesLimit?: number;
  freeBytesUsed?: number;
  cycleStartedAt?: string;
  cycleEndsAt?: string;
  premiumUntil?: string;
  subscriptionStatus?: SubscriptionStatus;
  supportBenefitUsed?: boolean;
}

export interface AuthActionResult {
  snapshot: AccountSnapshot;
  message?: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
}

export interface QuotaReservation {
  id: string;
  operationId: string;
  bytes: number;
  expiresAt: string;
}
