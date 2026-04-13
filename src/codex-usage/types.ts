export interface LocalAuth {
  accessToken: string;
  accountId: string;
  planType?: string | undefined;
}

export interface UsageWindow {
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: number | null;
}

export interface CreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface UsageSnapshot {
  planType: string;
  primary?: UsageWindow | undefined;
  secondary?: UsageWindow | undefined;
  credits?: CreditsSnapshot | undefined;
  additional: Array<{
    limitId: string;
    limitName: string | null;
    primary?: UsageWindow | undefined;
    secondary?: UsageWindow | undefined;
  }>;
  raw: unknown;
}
