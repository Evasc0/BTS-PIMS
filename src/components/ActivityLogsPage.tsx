import React, { useMemo, useState } from 'react';
import { History, Search, Download, Calendar } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Employee } from '../lib/types';
import { db } from '../lib/db';

interface ActivityLogsPageProps {
  user: Employee;
}

const escapeCsv = (value: string) => {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export function ActivityLogsPage({ user }: ActivityLogsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [dateFilter, setDateFilter] = useState<{ start: string; end: string } | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const logs = useLiveQuery(() => db.activityLogs.toArray(), []);
  const employees = useLiveQuery(() => db.employees.toArray(), []);

  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    (employees || []).forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const actionOptions = useMemo(() => {
    const set = new Set<string>();
    (logs || []).forEach((log) => set.add(log.action));
    return Array.from(set).sort();
  }, [logs]);

  const logsWithUsers = useMemo(() => {
    return (logs || []).map((log) => ({
      ...log,
      userName: employeeMap.get(log.performedByEmployeeId)?.fullName || 'System',
      target: log.entityType
    }));
  }, [logs, employeeMap]);

  const filteredLogs = logsWithUsers.filter((log) => {
    if (filterAction !== 'all' && log.action !== filterAction) return false;
    if (dateFilter) {
      const logDate = new Date(log.timestamp);
      const start = new Date(dateFilter.start);
      const end = new Date(dateFilter.end);
      if (logDate < start || logDate > end) return false;
    }
    if (!searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();
    return (
      log.details.toLowerCase().includes(term) ||
      log.userName.toLowerCase().includes(term) ||
      log.target.toLowerCase().includes(term)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-700';
      case 'warning':
        return 'bg-yellow-100 text-yellow-700';
      case 'error':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE':
        return 'bg-blue-100 text-blue-700';
      case 'UPDATE':
        return 'bg-purple-100 text-purple-700';
      case 'DELETE':
        return 'bg-red-100 text-red-700';
      case 'ASSIGN':
        return 'bg-orange-100 text-orange-700';
      case 'SUBMIT':
        return 'bg-cyan-100 text-cyan-700';
      case 'SYNC':
        return 'bg-indigo-100 text-indigo-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleExport = () => {
    const headers = ['Timestamp', 'User', 'Action', 'Target', 'Details', 'IP Address', 'Status'];
    const rows = logsWithUsers.map((log) => [
      new Date(log.timestamp).toLocaleString(),
      log.userName,
      log.action,
      log.target,
      log.details,
      log.ipAddress,
      log.status
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsv(String(cell || ''))).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'activity-logs.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDateRange = () => {
    const start = window.prompt('Enter start date (YYYY-MM-DD):', dateFilter?.start || '');
    if (!start) return;
    const end = window.prompt('Enter end date (YYYY-MM-DD):', dateFilter?.end || '');
    if (!end) return;
    setDateFilter({ start, end });
    setPage(1);
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Activity Logs</h1>
            <p className="text-gray-600">View all system activity and audit trail</p>
          </div>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
          >
            <Download className="w-5 h-5" />
            Export Logs
          </button>
        </div>

        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search activity logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="all">All Actions</option>
            {actionOptions.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <button
            onClick={handleDateRange}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition flex items-center gap-2"
          >
            <Calendar className="w-5 h-5" />
            Date Range
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Total Actions</p>
          <p className="font-bold text-gray-900">{logsWithUsers.length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Successful</p>
          <p className="font-bold text-green-600">{logsWithUsers.filter((log) => log.status === 'success').length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Warnings</p>
          <p className="font-bold text-yellow-600">{logsWithUsers.filter((log) => log.status === 'warning').length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Errors</p>
          <p className="font-bold text-red-600">{logsWithUsers.filter((log) => log.status === 'error').length}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pagedLogs.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-center text-gray-500" colSpan={7}>
                    No activity logs available.
                  </td>
                </tr>
              )}
              {pagedLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-900">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{log.userName}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{log.target}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-md truncate">{log.details}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono">{log.ipAddress}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(log.status)}`}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing {pagedLogs.length} of {filteredLogs.length} logs
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
