import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import type { SessionOutlet } from '../../../packages/ui/src/shell.js';
import { api, post, download } from '../../../packages/ui/src/api.js';
import {
  SectionHeading,
  Card,
  Button,
  Notice,
  Field,
  Badge,
} from '../../../packages/ui/src/components.js';
import { FileDown } from 'lucide-react';
export function ReportsPage() {
  const { me } = useOutletContext<SessionOutlet>(),
    client = useQueryClient(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [type, setType] = useState('employees'),
    [format, setFormat] = useState('csv'),
    [startDate, setStart] = useState(''),
    [endDate, setEnd] = useState('');
  const filters = { ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
  const jobs = useQuery({
    queryKey: ['report-jobs', me.tenant?.id],
    queryFn: () =>
      api<
        {
          id: string;
          type: string;
          format: string;
          status: string;
          error: string | null;
          createdAt: string;
        }[]
      >('/report-jobs'),
    refetchInterval: (q) =>
      q.state.data?.some((j) => ['QUEUED', 'PROCESSING'].includes(j.status)) ? 2000 : false,
  });
  const queue = useMutation({
    mutationFn: () => post('/report-jobs', { type, format, filters }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['report-jobs'] }),
  });
  return (
    <>
      <SectionHeading
        eyebrow="AUTHORIZED DATA EXPORTS"
        title="Reports"
        description="Export company records and immutable payroll results with recorded download attribution."
      />
      <Card className="section-card">
        <div className="field">
          <label htmlFor="report-kind">Report</label>
          <select id="report-kind" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="employees">Employee roster</option>
            <option value="leave">Leave requests</option>
            <option value="timesheets">Timesheet summary</option>
            {me.subscription?.features.includes('overtime') && (
              <option value="overtime">Overtime summary</option>
            )}
            {me.permissions.includes('payroll.read') &&
              me.subscription?.features.includes('payroll') &&
              [
                ['payroll', 'Payroll register'],
                ['statutory', 'Statutory deductions & employer contributions'],
                ['department-payroll', 'Payroll by department'],
                ['deductions', 'Personal & statutory deductions'],
                ['payroll-history', 'Payslip and bank export history'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </div>
        <div className="form-grid">
          <Field
            label="Start date (optional)"
            type="date"
            value={startDate}
            onChange={(e) => setStart(e.target.value)}
          />
          <Field
            label="End date (optional)"
            type="date"
            value={endDate}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <p>
          Dates filter employee hire date, request/work date, or payroll pay date. Reversed payroll
          remains explicitly marked in historical reports.
        </p>
        <div className="field">
          <label htmlFor="report-format">Format</label>
          <select id="report-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="csv">CSV spreadsheet</option>
            <option value="xlsx">Excel workbook</option>
            <option value="pdf">PDF document</option>
          </select>
        </div>
        <div className="table-actions">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await download(
                  `/reports/${type}?format=${format}&${new URLSearchParams(filters)}`,
                  type + '.' + format,
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <FileDown size={16} /> {busy ? 'Generating report…' : 'Download small report'}
          </Button>
          <Button variant="secondary" disabled={queue.isPending} onClick={() => queue.mutate()}>
            Queue background export
          </Button>
        </div>
        <Notice>
          Direct reports support up to 1,000 source records. Background exports support 50,000 in
          CSV, or 10,000 in Excel/PDF. Narrow the date range for larger datasets.
        </Notice>
        {(error || queue.error) && <Notice tone="error">{error || queue.error?.message}</Notice>}
      </Card>
      <Card>
        <h2>Your background exports</h2>
        {jobs.error && <Notice tone="error">{jobs.error.message}</Notice>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Report</th>
                <th>State</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data?.map((j) => (
                <tr key={j.id}>
                  <td>
                    {j.type} · {j.format}
                    <small>{new Date(j.createdAt).toLocaleString()}</small>
                  </td>
                  <td>
                    <Badge>{j.status}</Badge>
                    <small>{j.error}</small>
                  </td>
                  <td>
                    {j.status === 'COMPLETE' && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          download(
                            '/report-jobs/' + j.id + '/download',
                            j.type + '.' + j.format,
                          ).catch((e) => setError(e.message))
                        }
                      >
                        Download
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
