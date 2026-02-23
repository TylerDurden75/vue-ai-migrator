/**
 * Fixture for tests - composable used with app.provide('user', useUser())
 */
export function useUser() {
  return { mixinData: null, isUserAdmin: false, getUserDisplayName: () => "" };
}
