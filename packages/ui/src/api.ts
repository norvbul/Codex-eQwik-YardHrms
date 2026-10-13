export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const csrf =
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('yard_csrf='))
      ?.split('=')
      .slice(1)
      .join('=') || '';
  const response = await fetch('/api/v1' + path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': decodeURIComponent(csrf),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new HttpError(
      response.status,
      result.error?.code || 'REQUEST_FAILED',
      result.error?.message || 'Unable to complete this request',
      result.error?.issues,
    );
  return result.data as T;
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export async function download(path: string, filename: string) {
  const csrf =
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('yard_csrf='))
      ?.split('=')[1] || '';
  const response = await fetch('/api/v1' + path, {
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrf },
  });
  if (!response.ok) {
    const body = await response.json();
    throw new HttpError(
      response.status,
      body.error?.code || 'REQUEST_FAILED',
      body.error?.message || 'Download failed',
    );
  }
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
