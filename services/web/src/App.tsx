import { useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { AgentBrowse } from './pages/AgentBrowse';
import { ConversationDetail } from './pages/ConversationDetail';
import { ConversationList } from './pages/ConversationList';
import { JobView } from './pages/JobView';
import { MemoryEditor } from './pages/MemoryEditor';
import { MemoryList } from './pages/MemoryList';
import { WorkflowBrowse } from './pages/WorkflowBrowse';

const NAV_ITEMS = [
  {
    key: '/conversations',
    label: 'Conversations',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M14 2H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3l2 2 2-2h5a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: '/workflows',
    label: 'Workflows',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="10" y="1" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="5.5" y="10" width="5" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M3.5 6v2h9V6M8 8v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: '/agents',
    label: 'Agents',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: '/memories',
    label: 'Memory',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1a5 5 0 0 1 5 5c0 2-.8 3.7-2 4.8V13H5v-2.2A5 5 0 0 1 3 6a5 5 0 0 1 5-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M5 13h6M6 15h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export function App() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const activeKey =
    NAV_ITEMS.find(
      (item) => location.pathname === item.key || location.pathname.startsWith(item.key + '/'),
    )?.key;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <nav className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-logo" onClick={() => setCollapsed((v) => !v)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="2" width="20" height="20" rx="6" fill="#5B5BD6"/>
            <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {!collapsed && <span className="sidebar-logo-text">Praxis</span>}
        </div>

        <div className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              to={item.key}
              className={`sidebar-nav-item${activeKey === item.key ? ' active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              {!collapsed && <span className="sidebar-nav-label">{item.label}</span>}
            </Link>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="app-main">
        <div className="page-content">
          <Routes>
            <Route path="/" element={<ConversationList />} />
            <Route path="/jobs/:jobId" element={<JobView />} />
            <Route path="/conversations" element={<ConversationList />} />
            <Route path="/conversations/:id" element={<ConversationDetail />} />
            <Route path="/workflows" element={<WorkflowBrowse />} />
            <Route path="/agents" element={<AgentBrowse />} />
            <Route path="/memories" element={<MemoryList />} />
            <Route path="/memories/*" element={<MemoryEditor />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
