import React, { useMemo } from 'react';
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
import { useLiveQuery } from '../lib/useLiveQuery';
import type { Employee } from '../lib/types';
import { db } from '../lib/db';
import { formatDate } from '../lib/utils';

interface DashboardProps {
  user: Employee;
}

export function Dashboard({ user }: DashboardProps) {
  const products = useLiveQuery(() => db.products.toArray(), []);
  const employees = useLiveQuery(() => db.employees.toArray(), []);
  const returns = useLiveQuery(() => db.returns.toArray(), []);
  const activityLogs = useLiveQuery(() => db.activityLogs.toArray(), []);

  const isAdmin = user.role === 'admin';
  const isEmployee = user.role === 'employee';

  const assignedProducts = useMemo(
    () => (products || []).filter((product) => product.assignedToEmployeeId === user.id),
    [products, user.id]
  );

  const lowStockProducts = useMemo(() => {
    return (products || [])
      .filter((product) => product.onHandPerCount < product.balancePerCard)
      .slice(0, 3);
  }, [products]);

  const recentActivity = useMemo(() => {
    return (activityLogs || [])
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 4);
  }, [activityLogs]);

  const stats = {
    totalProducts: isEmployee ? assignedProducts.length : (products || []).length,
    lowStockItems: isEmployee ? 0 : lowStockProducts.length,
    totalEmployees: isAdmin ? (employees || []).length : 0,
    pendingReturns: isEmployee
      ? (returns || []).filter((ret) => ret.returnedByEmployeeId === user.id && ret.status === 'pending').length
      : (returns || []).filter((ret) => ret.status === 'pending').length
  };

  const activityType = (action: string) => {
    if (action === 'CREATE') return 'success';
    if (action === 'ASSIGN') return 'info';
    if (action === 'UPDATE') return 'info';
    if (action === 'DELETE') return 'warning';
    if (action === 'SUBMIT') return 'info';
    return 'info';
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-bold text-gray-900 mb-2">Welcome back, {user.fullName}</h1>
        <p className="text-gray-600">
          {isAdmin && 'You have full system control and oversight'}
          {isEmployee && 'View your assigned products and submit returns'}
          {!isAdmin && !isEmployee && 'Manage inventory workflows and return approvals'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Package className="w-6 h-6 text-blue-600" />
            </div>
            <span className="text-sm text-green-600 flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              Live
            </span>
          </div>
          <p className="text-gray-600 text-sm mb-1">{isEmployee ? 'Assigned Products' : 'Total Products'}</p>
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
                Threshold
              </span>
            </div>
            <p className="text-gray-600 text-sm mb-1">Low Stock Items</p>
            <p className="font-bold text-gray-900">{stats.lowStockItems}</p>
          </div>
        )}

        {isAdmin && (
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-purple-600" />
              </div>
              <span className="text-sm text-green-600 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" />
                Active
              </span>
            </div>
            <p className="text-gray-600 text-sm mb-1">Total Employees</p>
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
        {!isEmployee && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-bold text-gray-900 mb-4">Recent Activity</h2>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-gray-600">No activity logged yet.</p>
            ) : (
              <div className="space-y-4">
                {recentActivity.map((activity) => {
                  const type = activityType(activity.action);
                  return (
                    <div key={activity.id} className="flex items-start gap-3 pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          type === 'success' ? 'bg-green-100' : type === 'warning' ? 'bg-orange-100' : 'bg-blue-100'
                        }`}
                      >
                        {type === 'success' && <CheckCircle className="w-4 h-4 text-green-600" />}
                        {type === 'warning' && <AlertTriangle className="w-4 h-4 text-orange-600" />}
                        {type === 'info' && <RotateCcw className="w-4 h-4 text-blue-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">{activity.action}</p>
                        <p className="text-sm text-gray-600 truncate">{activity.details}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatDate(activity.timestamp)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!isEmployee && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-900">Low Stock Alert</h2>
              <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                {lowStockProducts.length} Items
              </span>
            </div>
            {lowStockProducts.length === 0 ? (
              <p className="text-sm text-gray-600">No low stock alerts.</p>
            ) : (
              <div className="space-y-4">
                {lowStockProducts.map((product) => (
                  <div key={product.id} className="flex items-center justify-between pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{product.article}</p>
                      <p className="text-xs text-gray-500">{product.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-orange-600">{product.onHandPerCount} units</p>
                      <p className="text-xs text-gray-500">Min: {product.balancePerCard}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isEmployee && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 lg:col-span-2">
            <h2 className="font-bold text-gray-900 mb-4">My Assigned Products</h2>
            {assignedProducts.length === 0 ? (
              <p className="text-sm text-gray-600">No products assigned yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {assignedProducts.map((product) => (
                  <div key={product.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900">{product.article}</p>
                        <p className="text-sm text-gray-600">{product.description}</p>
                      </div>
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                        {product.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                      <span className="text-sm text-gray-600">Quantity</span>
                      <span className="font-medium text-gray-900">{product.onHandPerCount} units</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
