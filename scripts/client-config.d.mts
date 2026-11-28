export interface ClientConfig { apiUrl: string; updateUrl: string }
export function resolveClientConfig(env?: Record<string, string | undefined>): ClientConfig
export function loadClientConfig(mode: string, root: string): ClientConfig
export function loadReleaseConfig(root: string, env?: Record<string, string | undefined>): ClientConfig
