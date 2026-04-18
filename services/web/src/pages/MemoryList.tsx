import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../rpc';

export function MemoryList() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['memories', 'list'],
    queryFn: () => rpc.memories.listRepos(),
  });

  const repos = data ?? [];

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Repository Memory</h1>
          <p className="page-subtitle">
            Memory is created when a job completes. Learning passes refine it automatically.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="empty-state">
          <p className="empty-state-title">Loading…</p>
        </div>
      ) : repos.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2a8 8 0 0 1 8 8c0 3.2-1.3 6-3.2 7.7V20H7.2V17.7A9 9 0 0 1 4 10a8 8 0 0 1 8-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M7 20h10M9 22h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="empty-state-title">No repo memories yet</p>
          <p className="empty-state-description">
            Run a job on a repo — memory is built automatically after each completed job.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th style={{ textAlign: 'right', width: 80 }}>Entries</th>
                <th style={{ textAlign: 'right', width: 90 }}>Size</th>
                <th style={{ width: 180 }}>Last updated</th>
                <th style={{ width: 70 }} />
              </tr>
            </thead>
            <tbody>
              {repos.map((row) => (
                <tr
                  key={row.repoKey}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/memories/${row.repoKey}`)}
                >
                  <td>
                    <code
                      style={{
                        fontSize: 12,
                        background: 'var(--c-surface-2)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 4,
                        padding: '1px 5px',
                      }}
                    >
                      {row.repoKey}
                    </code>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--c-text-2)' }}>{row.entryCount}</td>
                  <td style={{ textAlign: 'right', color: 'var(--c-text-2)' }}>
                    {(row.sizeBytes / 1024).toFixed(1)} KB
                  </td>
                  <td style={{ color: 'var(--c-text-3)' }}>
                    {new Date(row.updatedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/memories/${row.repoKey}`);
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
