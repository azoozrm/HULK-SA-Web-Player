export type LogoutFetch = (
  input: string,
  init: RequestInit,
) => Promise<Readonly<{ ok: boolean }>>;

export async function requestLogout(fetcher: LogoutFetch): Promise<boolean> {
  const response = await fetcher('/api/session', {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  return response.ok;
}
