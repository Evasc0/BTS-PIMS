import React, { useState } from 'react';
import { User } from '../App';
import { Users, Plus, Search, Edit, Trash2, Mail, Phone, X, Shield, UserCog } from 'lucide-react';

interface EmployeesPageProps {
  user: User;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  role: 'administrator' | 'employee';
  phone: string;
  department: string;
  assignedProducts: number;
  status: 'active' | 'inactive';
  joinedDate: string;
}

export function EmployeesPage({ user }: EmployeesPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Mock employees data
  const [employees] = useState<Employee[]>([
    { id: '1', name: 'John Admin', email: 'admin@company.com', role: 'administrator', phone: '+1 234 567 8900', department: 'IT', assignedProducts: 0, status: 'active', joinedDate: '2023-01-15' },
    { id: '2', name: 'Sarah Johnson', email: 'sarah@company.com', role: 'employee', phone: '+1 234 567 8901', department: 'Operations', assignedProducts: 3, status: 'active', joinedDate: '2023-03-20' },
    { id: '3', name: 'Mike Employee', email: 'employee@company.com', role: 'employee', phone: '+1 234 567 8902', department: 'Warehouse', assignedProducts: 1, status: 'active', joinedDate: '2023-06-10' },
    { id: '4', name: 'Emma Worker', email: 'emma@company.com', role: 'employee', phone: '+1 234 567 8903', department: 'Warehouse', assignedProducts: 2, status: 'active', joinedDate: '2023-08-05' },
    { id: '5', name: 'David Staff', email: 'david@company.com', role: 'employee', phone: '+1 234 567 8904', department: 'Logistics', assignedProducts: 4, status: 'active', joinedDate: '2023-09-12' },
  ]);

  const canAddEmployee = user.role === 'administrator';
  const canEditEmployee = user.role === 'administrator';
  const canDeleteEmployee = user.role === 'administrator';

  // Filter employees based on role
  const filteredEmployees = employees.filter((employee) =>
    employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'administrator':
        return { color: 'bg-purple-100 text-purple-700', icon: Shield };
      case 'employee':
        return { color: 'bg-green-100 text-green-700', icon: Users };
      default:
        return { color: 'bg-gray-100 text-gray-700', icon: Users };
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Employees</h1>
            <p className="text-gray-600">
              {user.role === 'administrator' ? 'Manage all employee records' : 'View your team members'}
            </p>
          </div>
          {canAddEmployee && (
            <button 
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Employee
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search employees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      {/* Employees Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEmployees.map((employee) => {
          const roleBadge = getRoleBadge(employee.role);
          const RoleIcon = roleBadge.icon;
          
          return (
            <div key={employee.id} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                    <span className="font-bold text-indigo-600">
                      {employee.name.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{employee.name}</p>
                    <p className="text-sm text-gray-600">{employee.department}</p>
                  </div>
                </div>
                {canEditEmployee && (
                  <button 
                    onClick={() => setSelectedEmployee(employee)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition"
                  >
                    <Edit className="w-4 h-4 text-gray-600" />
                  </button>
                )}
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Mail className="w-4 h-4" />
                  {employee.email}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone className="w-4 h-4" />
                  {employee.phone}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${roleBadge.color}`}>
                  <RoleIcon className="w-3 h-3" />
                  {employee.role}
                </span>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{employee.assignedProducts}</p>
                  <p className="text-xs text-gray-500">Products</p>
                </div>
              </div>

              {canDeleteEmployee && (
                <button className="w-full mt-4 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition flex items-center justify-center gap-2">
                  <Trash2 className="w-4 h-4" />
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Add New Employee</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                  <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input type="email" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                  <input type="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                  <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                    <option value="employee">Employee</option>
                    <option value="administrator">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <input type="password" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                  Add Employee
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {selectedEmployee && !showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Edit Employee</h2>
              <button onClick={() => setSelectedEmployee(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                  <input type="text" defaultValue={selectedEmployee.name} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input type="email" defaultValue={selectedEmployee.email} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                  <input type="tel" defaultValue={selectedEmployee.phone} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                  <input type="text" defaultValue={selectedEmployee.department} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select defaultValue={selectedEmployee.role} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                    <option value="employee">Employee</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="administrator">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select defaultValue={selectedEmployee.status} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setSelectedEmployee(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
