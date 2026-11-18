export interface AuthPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly tenantSlug: string;
  readonly expiresAt: number;
  readonly permissions: ReadonlySet<string>;
}
