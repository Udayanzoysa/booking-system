export const dashboardSections = {
  calendar: { label: 'Booking calendar', permissions: [] },
  bookings: { label: 'All bookings', permissions: ['VIEW_BOOKINGS', 'MANAGE_BOOKINGS'] },
  invoices: { label: 'Invoices', permissions: ['MANAGE_INVOICES'] },
  lanes: { label: 'Branches & lanes', permissions: ['MANAGE_TENANT', 'MANAGE_LANES'] },
  pricing: { label: 'Pricing', permissions: ['MANAGE_PRICING'] },
  roster: { label: 'Staff roster', permissions: ['MANAGE_ROSTER'] },
  customers: { label: 'Customers', permissions: ['MANAGE_CUSTOMERS', 'VIEW_CUSTOMER_PHONE'] },
  policies: { label: 'Cancellation policies', permissions: ['MANAGE_POLICIES'] },
  access: { label: 'Staff & roles', permissions: ['MANAGE_USERS', 'MANAGE_RBAC'] },
} as const;

export type DashboardSection = keyof typeof dashboardSections;
const staffPermissions = new Set<string>([
  ...Object.values(dashboardSections).flatMap((section) => [...section.permissions]),
  'RECORD_PAYMENT', 'ISSUE_REFUND', 'WAIVE_CANCELLATION_FEE',
]);

export function hasDashboardAccess(permissions: readonly string[]): boolean {
  return permissions.some((permission) => staffPermissions.has(permission));
}

export function canAccessSection(section: DashboardSection, permissions: readonly string[]): boolean {
  const required: readonly string[] = dashboardSections[section].permissions;
  return hasDashboardAccess(permissions) && (required.length === 0 || required.some((permission) => permissions.includes(permission)));
}

export function dashboardPath(section: DashboardSection): string {
  return section === 'calendar' ? '/dashboard' : '/dashboard/' + section;
}
