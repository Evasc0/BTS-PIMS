import React, { useState } from 'react';
import { User } from '../App';
import { History, Search, Filter, Download, Calendar } from 'lucide-react';

interface ActivityLogsPageProps {
  user: User;
}

interface ActivityLog {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  target: string;
  details: string;
  ipAddress: string;
  status: 'success' | 'warning' | 'error';
}

export function ActivityLogsPage({ user }: ActivityLogsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');

  // Mock activity logs
  const [logs] = useState<ActivityLog[]>([
    {
      id: '1',
      timestamp: '2024-02-05 14:32:15',
      user: 'John Admin',
      action: 'CREATE',
      target: 'Product',
      details: 'Created product "Laptop Dell XPS 15" (SKU: LAP-001)',
      ipAddress: '192.168.1.100',
      status: 'success'
    },
    {
      id: '2',
      timestamp: '2024-02-05 13:45:22',
      user: 'Sarah Supervisor',
      action: 'APPROVE',
      target: 'Return',
      details: 'Approved return request #42 for "Mouse Logitech MX"',
      ipAddress: '192.168.1.101',
      status: 'success'
    },
    {
      id: '3',
      timestamp: '2024-02-05 12:18:05',
      user: 'Mike Employee',
      action: 'VIEW',
      target: 'Product',
      details: 'Viewed product details for "USB-C Cable"',
      ipAddress: '192.168.1.102',
      status: 'success'
    },
    {
      id: '4',
      timestamp: '2024-02-05 11:22:40',
      user: 'John Admin',
      action: 'UPDATE',
      target: 'Employee',
      details: 'Updated employee role for "Emma Worker" from Employee to Supervisor',
      ipAddress: '192.168.1.100',
      status: 'success'
    },
    {
      id: '5',
      timestamp: '2024-02-05 10:15:33',
      user: 'Sarah Supervisor',
      action: 'REJECT',
      target: 'Return',
      details: 'Rejected return request #38 for "HDMI Adapter"',
      ipAddress: '192.168.1.101',
      status: 'warning'
    },
    {
      id: '6',
      timestamp: '2024-02-05 09:45:12',
      user: 'Unknown User',
      action: 'LOGIN',
      target: 'Authentication',
      details: 'Failed login attempt for user "test@company.com"',
      ipAddress: '192.168.1.200',
      status: 'error'
    },
    {
      id: '7',
      timestamp: '2024-02-04 16:30:25',
      user: 'John Admin',
      action: 'DELETE',
      target: 'Product',
      details: 'Deleted product "Old Monitor 22"" (SKU: MON-999)',
      ipAddress: '192.168.1.100',
      status: 'success'
    },
    {
      id: '8',
      timestamp: '2024-02-04 15:22:18',
      user: 'Mike Employee',
      action: 'SUBMIT',
      target: 'Return',
      details: 'Submitted return request for "Laptop Dell XPS 15" - Reason: Defective screen',
      ipAddress: '192.168.1.102',
      status: 'success'
    },
    {
      id: '9',
      timestamp: '2024-02-04 14:10:50',
      user: 'Sarah Supervisor',
      action: 'UPDATE',
      target: 'Product',
      details: 'Updated quantity for "USB-C Cable" from 8 to 5',
      ipAddress: '192.168.1.101',
      status: 'success'
    },
    {
      id: '10',
      timestamp: '2024-02-04 13:05:42',
      user: 'John Admin',
      action: 'CREATE',
      target: 'Employee',
      details: 'Created new employee account for "David Staff"',
      ipAddress: '192.168.1.100',
      status: 'success'
    },
  ]);

  const filteredLogs = logs.filter((log) => {
    if (filterAction !== 'all' && log.action !== filterAction) return false;
    if (searchTerm && !log.details.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !log.user.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !log.target.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });

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
      case 'VIEW':
        return 'bg-gray-100 text-gray-700';
      case 'APPROVE':
        return 'bg-green-100 text-green-700';
      case 'REJECT':
        return 'bg-orange-100 text-orange-700';
      case 'LOGIN':
        return 'bg-indigo-100 text-indigo-700';
      case 'SUBMIT':
        return 'bg-cyan-100 text-cyan-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleExport = () => {
    console.log('Exporting activity logs...');
    // Would trigger download
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
            <option value="CREATE">Create</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
            <option value="VIEW">View</option>
            <option value="APPROVE">Approve</option>
            <option value="REJECT">Reject</option>
            <option value="LOGIN">Login</option>
            <option value="SUBMIT">Submit</option>
          </select>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Date Range
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Total Actions</p>
          <p className="font-bold text-gray-900">{logs.length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Successful</p>
          <p className="font-bold text-green-600">{logs.filter(l => l.status === 'success').length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Warnings</p>
          <p className="font-bold text-yellow-600">{logs.filter(l => l.status === 'warning').length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200">
          <p className="text-sm text-gray-600 mb-1">Errors</p>
          <p className="font-bold text-red-600">{logs.filter(l => l.status === 'error').length}</p>
        </div>
      </div>

      {/* Activity Logs Table */}
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
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-900">{log.timestamp}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {log.user}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getActionColor(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {log.target}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-md truncate">
                    {log.details}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono">
                    {log.ipAddress}
                  </td>
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

      {/* Pagination */}
      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Showing {filteredLogs.length} of {logs.length} logs
        </p>
        <div className="flex gap-2">
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm">
            Previous
          </button>
          <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
