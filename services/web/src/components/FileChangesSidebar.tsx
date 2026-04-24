import { Tag } from 'antd';

export interface FileChange {
  path: string;
  /** 'added' = new file, 'modified' = existing file edited */
  status: 'added' | 'modified';
  touchCount: number;
}

interface Props {
  fileChanges: Map<string, FileChange>;
}

export function FileChangesSidebar({ fileChanges }: Props) {
  if (fileChanges.size === 0) return null;

  // Group by directory
  const groups = new Map<string, FileChange[]>();
  for (const change of fileChanges.values()) {
    const parts = change.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const existing = groups.get(dir) ?? [];
    existing.push(change);
    groups.set(dir, existing);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div style={{ fontSize: 12, fontFamily: "'Fira Code', 'Consolas', monospace" }}>
      {sortedGroups.map(([dir, changes]) => (
        <div key={dir || '_root'} style={{ marginBottom: 10 }}>
          {dir && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--c-text-3)',
                padding: '2px 0',
                marginBottom: 2,
                letterSpacing: 0,
              }}
            >
              {dir}/
            </div>
          )}
          {[...changes]
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((change) => {
              const filename = change.path.split('/').pop() ?? change.path;
              return (
                <div
                  key={change.path}
                  title={change.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '2px 0 2px 10px',
                    gap: 6,
                    borderLeft: '2px solid',
                    borderColor:
                      change.status === 'added' ? 'var(--c-success)' : 'var(--c-warning)',
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--c-text-1)',
                      fontSize: 12,
                    }}
                  >
                    {filename}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {change.touchCount > 1 && (
                      <span style={{ fontSize: 10, color: 'var(--c-text-3)' }}>
                        ×{change.touchCount}
                      </span>
                    )}
                    <Tag
                      color={change.status === 'added' ? 'green' : 'orange'}
                      style={{ fontSize: 10, margin: 0, padding: '0 4px', lineHeight: '16px' }}
                    >
                      {change.status === 'added' ? '+' : 'M'}
                    </Tag>
                  </span>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
