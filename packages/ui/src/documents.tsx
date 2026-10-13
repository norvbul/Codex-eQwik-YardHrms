import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, post, download } from './api.js';
import { Card, Field, Button, Notice, Badge } from './components.js';
export async function encodedFile(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file at most 5 MiB');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]!);
    reader.readAsDataURL(file);
  });
}
export function DocumentVault({
  employeeId,
  canUpload = false,
  tenantId,
}: {
  employeeId?: string;
  canUpload?: boolean;
  tenantId?: string;
}) {
  const client = useQueryClient(),
    [file, setFile] = useState<File | null>(null),
    [retainUntil, setRetain] = useState(''),
    [error, setError] = useState('');
  const platform = !!tenantId,
    path = platform
      ? '/platform/customers/' + tenantId + '/evidence'
      : '/employees/' + employeeId + '/documents';
  const q = useQuery({
    queryKey: ['private-documents', path],
    queryFn: () =>
      api<{ id: string; name: string; scanStatus: string; size: number; createdAt: string }[]>(
        path,
      ),
    refetchInterval: (q) =>
      q.state.data?.some((f) => f.scanStatus === 'QUARANTINED') ? 5000 : false,
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file first');
      return post(path, {
        name: file.name,
        contentType: file.type,
        data: await encodedFile(file),
        retainUntil: retainUntil || null,
      });
    },
    onSuccess: () => {
      setFile(null);
      client.invalidateQueries();
    },
  });
  const scan = useMutation({
    mutationFn: (id: string) => post('/private-files/' + id + '/rescan', {}),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <Card className="section-card">
      <h2>{platform ? 'Payment evidence' : 'Employee documents'}</h2>
      <Notice>
        PDF, PNG or JPEG, up to 5 MiB. Files remain private and quarantined until a configured
        malware scanner clears them. Retention dates record company policy; deletion requires a
        separate approved process.
      </Notice>
      {canUpload && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate();
          }}
        >
          <Field
            label="Select document"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <Field
            label="Retain through (optional)"
            type="date"
            value={retainUntil}
            onChange={(e) => setRetain(e.target.value)}
          />
          <Button disabled={upload.isPending || !file}>Upload for scanning</Button>
        </form>
      )}
      {(error || q.error || upload.error || scan.error) && (
        <Notice tone="error">
          {error || q.error?.message || upload.error?.message || scan.error?.message}
        </Notice>
      )}
      {q.data?.map((f) => (
        <div key={f.id} className="usage-line">
          <div>
            {f.name}
            <small>
              {Math.ceil(f.size / 1024)} KiB ·{' '}
              {platform ? 'Evidence ID: ' + f.id : new Date(f.createdAt).toLocaleDateString()}
            </small>
          </div>
          <div>
            <Badge>{f.scanStatus}</Badge>
            {f.scanStatus === 'CLEAN' && (
              <Button
                variant="secondary"
                onClick={() =>
                  download(
                    platform
                      ? '/platform/evidence/' + f.id + '/download'
                      : '/private-files/' + f.id + '/download',
                    f.name,
                  ).catch((e) => setError(e.message))
                }
              >
                Download
              </Button>
            )}
            {canUpload && f.scanStatus === 'QUARANTINED' && (
              <Button
                variant="secondary"
                disabled={scan.isPending}
                onClick={() => scan.mutate(f.id)}
              >
                Retry scan
              </Button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
