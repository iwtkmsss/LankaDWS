export function withCompanyScope(path: string, _companyId: string | null | undefined): string {
  // Compatibility wrapper for existing callers. The product has one
  // organization now, so navigation must not expose or persist company scope.
  return path
}
