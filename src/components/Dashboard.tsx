import React from 'react';
import { User } from '../App';
import { 
  Package, 
  Users, 
  RotateCcw, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  CheckCircle,
  Clock
} from 'lucide-react';

interface DashboardProps {
  user: User;
}

export function Dashboard({ user }: DashboardProps) {
  // Mock data - would come from backend
  const stats = {
    totalProducts: user.role === 'employee' ? user.assignedProducts?.length || 0 : 150,
    lowStockItems: user.role === 'employee' ? 0 : 12,
    totalEmployees: user.role === 'administrator' ? 45 : 0,
    pendingReturns: user.role === 'employee' ? 1 : 5,
  };

  const recentActivity = [
    { id: 1, action: 'Product Added', item: 'Laptop Dell XPS 15', user: 'John Admin', time: '2 hours ago', type: 'success' },
    { id: 2, action: 'Return Approved', item: 'Mouse Logitech MX', user: 'Sarah Johnson', time: '3 hours ago', type: 'info' },
    { id: 3, action: 'Low Stock Alert', item: 'USB-C Cable', user: 'System', time: '5 hours ago', type: 'warning' },
    { id: 4, action: 'Employee Added', item: 'Mike Employee', user: 'John Admin', time: '1 day ago', type: 'success' },
  ];

  const lowStockProducts = [
    { id: 1, name: 'USB-C Cable', stock: 5, minStock: 20, category: 'Accessories' },
    { id: 2, name: 'HDMI Adapter', stock: 3, minStock: 15, category: 'Accessories' },
    { id: 3, name: 'Keyboard Mechanical', stock: 8, minStock: 10, category: 'Peripherals' },
  ];

  const isAdministrator = user.role === 'administrator';
  const isEmployee = user.role === 'employee';

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-bold text-gray-900 mb-2">
          Welcome back, {user.name}
        </h1>
        <p className="text-gray-600">
          {isAdministrator && 'You have full system control and oversight'}
          {isEmployee && 'View your assigned products and submit returns'}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
            <span className="text-sm text-green-600 flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              12%
            </span>
          </div>
          <p className="text-gray-600 text-sm mb-1">
            {isEmployee ? 'Assigned Products' : 'Total Products'}
          </p>
          <p className="font-bold text-gray-900">{stats.totalProducts}</p>
        </div>

        {!isEmployee && (
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-orange-600" />
              </div>
              <span className="text-sm text-red-600 flex items-center gap-1">
                <TrendingDown className="w-4 h-4" />
                8%
              </span>
            </div>
            <p className="text-gray-600 text-sm mb-1">Low Stock Items</p>
            <p className="font-bold text-gray-900">{stats.lowStockItems}</p>
          </div>
        )}

        {(isAdministrator ) && (
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-purple-600" />
              </div>
              <span className="text-sm text-green-600 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" />
                5%
              </span>
            </div>
            <p className="text-gray-600 text-sm mb-1">
              {isAdministrator ? 'Total Employees' : 'My Team'}
            </p>
            <p className="font-bold text-gray-900">{stats.totalEmployees}</p>
          </div>
        )}

        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <RotateCcw className="w-6 h-6 text-green-600" />
            </div>
            <span className="text-sm text-orange-600 flex items-center gap-1">
              <Clock className="w-4 h-4" />
              Pending
            </span>
          </div>
          <p className="text-gray-600 text-sm mb-1">Pending Returns</p>
          <p className="font-bold text-gray-900">{stats.pendingReturns}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        {!isEmployee && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">Recent Activity</h2>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    activity.type === 'success' ? 'bg-green-100' :
                    activity.type === 'warning' ? 'bg-orange-100' :
                    'bg-blue-100'
                  }`}>
                    {activity.type === 'success' && <CheckCircle className="w-4 h-4 text-green-600" />}
                    {activity.type === 'warning' && <AlertTriangle className="w-4 h-4 text-orange-600" />}
                    {activity.type === 'info' && <RotateCcw className="w-4 h-4 text-blue-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{activity.action}</p>
                    <p className="text-sm text-gray-600 truncate">{activity.item}</p>
                    <p className="text-xs text-gray-500 mt-1">{activity.user} • {activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Low Stock Alert */}
        {!isEmployee && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Low Stock Alert</h2>
              <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                {lowStockProducts.length} Items
              </span>
            </div>
            <div className="space-y-4">
              {lowStockProducts.map((product) => (
                <div key={product.id} className="flex items-center justify-between pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{product.name}</p>
                    <p className="text-xs text-gray-500">{product.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-orange-600">{product.stock} units</p>
                    <p className="text-xs text-gray-500">Min: {product.minStock}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Employee Personal Dashboard */}
        {isEmployee && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 lg:col-span-2">
            <h2 className="font-bold text-gray-900 mb-4">My Assigned Products</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-gray-900">Laptop Dell XPS 15</p>
                    <p className="text-sm text-gray-600">Electronics</p>
                  </div>
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                    In Stock
                  </span>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <span className="text-sm text-gray-600">Quantity</span>
                  <span className="font-medium text-gray-900">25 units</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
