import { API_URL } from '../config';

export type StatusApi = { estado: 'ok'; ambiente: string } | { estado: 'indisponivel' };

export async function consultarHealth(
  fetcher: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<StatusApi> {
  try {
    const res = await fetcher(`${API_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { estado: 'indisponivel' };
    const corpo = (await res.json()) as { status?: string; ambiente?: string };
    return corpo.status === 'ok'
      ? { estado: 'ok', ambiente: corpo.ambiente ?? '?' }
      : { estado: 'indisponivel' };
  } catch {
    return { estado: 'indisponivel' };
  }
}
