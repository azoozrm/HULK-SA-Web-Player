export type LogoutFetch = (
  input: string,
  init: RequestInit,
) => Promise<Readonly<{ ok: boolean }>>;

export async function requestLogout(
  fetcher: LogoutFetch,
  sessionUrl = '/api/session',
): Promise<boolean> {
  const response = await fetcher(sessionUrl, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  return response.ok;
}
