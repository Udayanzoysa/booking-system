export interface AuthPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly permissions: ReadonlySet<string>;
}
