export type Session = { token: string; name: string; tenantSlug: string };

export type Principal = {
  userId: string;
  tenantId: string;
  permissions: string[];
  expiresAt: number;
  displayName: string;
  tenantSlug: string;
};
