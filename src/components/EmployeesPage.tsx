import React, { useMemo, useState } from 'react';
import { Users, Plus, Search, Edit, Trash2, Mail, Phone, X, Shield, UserCog } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Employee, EmployeeRole } from '../lib/types';
import { db } from '../lib/db';
import { createPasswordHash } from '../lib/security';
import { createId, nowIso } from '../lib/utils';
import { logActivity } from '../lib/activity';

interface EmployeesPageProps {
  user: Employee;
}

interface EmployeeFormState {
  fullName: string;
  email: string;
  phone: string;
  department: string;
  role: EmployeeRole;
  status: 'active' | 'inactive';
  password: string;
}

const emptyFormState: EmployeeFormState = {
  fullName: '',
  email: '',
  phone: '',
  department: '',
  role: 'employee',
  status: 'active',
  password: ''
};

export function EmployeesPage({ user }: EmployeesPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [formState, setFormState] = useState<EmployeeFormState>(emptyFormState);
  const [formError, setFormError] = useState<string | null>(null);

  const employees = useLiveQuery(() => db.employees.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);

  const assignedCounts = useMemo(() => {
    const map = new Map<string, number>();
    (products || []).forEach((product) => {
      if (!product.assignedToEmployeeId) return;
      map.set(product.assignedToEmployeeId, (map.get(product.assignedToEmployeeId) || 0) + 1);
    });
    return map;
  }, [products]);

  const canManageEmployees = user.role === 'admin';

  const filteredEmployees = (employees || []).filter((employee) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      employee.fullName.toLowerCase().includes(term) ||
      employee.email.toLowerCase().includes(term) ||
      employee.department.toLowerCase().includes(term)
    );
  });

  const getRoleBadge = (role: EmployeeRole) => {
    switch (role) {
      case 'admin':
        return { color: 'bg-purple-100 text-purple-700', icon: Shield, label: 'admin' };
      case 'supervisor':
        return { color: 'bg-blue-100 text-blue-700', icon: UserCog, label: 'supervisor' };
      default:
        return { color: 'bg-green-100 text-green-700', icon: Users, label: 'employee' };
    }
  };

  const resetForm = () => {
    setFormState(emptyFormState);
    setFormError(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setFormState({
      fullName: employee.fullName,
      email: employee.email,
      phone: employee.phone,
      department: employee.department,
      role: employee.role,
      status: employee.status,
      password: ''
    });
    setFormError(null);
  };

  const handleAddEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageEmployees) return;
    setFormError(null);

    const normalizedEmail = formState.email.trim().toLowerCase();
    if (!formState.fullName.trim() || !normalizedEmail || !formState.password) {
      setFormError('Full name, email, and password are required.');
      return;
    }

    const existing = await db.employees.where('email').equals(normalizedEmail).first();
    if (existing) {
      setFormError('An employee with this email already exists.');
      return;
    }

    const { hash, salt } = await createPasswordHash(formState.password);
    const employeeId = createId();
    await db.employees.add({
      id: employeeId,
      fullName: formState.fullName.trim(),
      email: normalizedEmail,
      phone: formState.phone.trim(),
      department: formState.department.trim(),
      role: formState.role,
      status: formState.status,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: nowIso(),
      location: '',
      twoFactorEnabled: false,
      emailNotifications: false,
      lowStockAlerts: false,
      language: 'English'
    });

    await logActivity({
      action: 'CREATE',
      entityType: 'employee',
      entityId: employeeId,
      performedByEmployeeId: user.id,
      details: `Employee created: ${formState.fullName.trim()}`
    });

    setShowAddModal(false);
    resetForm();
  };

  const handleEditEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageEmployees || !selectedEmployee) return;
    setFormError(null);

    const normalizedEmail = formState.email.trim().toLowerCase();
    if (!formState.fullName.trim() || !normalizedEmail) {
      setFormError('Full name and email are required.');
      return;
    }

    const existing = await db.employees.where('email').equals(normalizedEmail).first();
    if (existing && existing.id !== selectedEmployee.id) {
      setFormError('Another employee already uses this email.');
      return;
    }

    await db.employees.update(selectedEmployee.id, {
      fullName: formState.fullName.trim(),
      email: normalizedEmail,
      phone: formState.phone.trim(),
      department: formState.department.trim(),
      role: formState.role,
      status: formState.status
    });

    await logActivity({
      action: 'UPDATE',
      entityType: 'employee',
      entityId: selectedEmployee.id,
      performedByEmployeeId: user.id,
      details: `Employee updated: ${formState.fullName.trim()}`
    });

    setSelectedEmployee(null);
  };

  const handleDeleteEmployee = async (employeeId: string, employeeName: string) => {
    if (!canManageEmployees) return;
    const adminCount = (employees || []).filter((emp) => emp.role === 'admin').length;
    const target = (employees || []).find((emp) => emp.id === employeeId);
    if (target?.role === 'admin' && adminCount <= 1) {
      setFormError('At least one admin account must remain active.');
      return;
    }
    const confirmed = window.confirm(`Remove ${employeeName}? This cannot be undone.`);
    if (!confirmed) return;
    await db.employees.delete(employeeId);
    await logActivity({
      action: 'DELETE',
      entityType: 'employee',
      entityId: employeeId,
      performedByEmployeeId: user.id,
      details: `Employee removed: ${employeeName}`
    });
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Employees</h1>
            <p className="text-gray-600">
              {user.role === 'admin' ? 'Manage all employee records' : 'View your team members'}
            </p>
          </div>
          {canManageEmployees && (
            <button
              onClick={openAddModal}
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
        {formError && !showAddModal && !selectedEmployee && (
          <p className="mt-3 text-sm text-red-600">{formError}</p>
        )}
      </div>

      {filteredEmployees.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-600">
          No employees found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEmployees.map((employee) => {
            const roleBadge = getRoleBadge(employee.role);
            const RoleIcon = roleBadge.icon;
            const assignedCount = assignedCounts.get(employee.id) || 0;

            return (
              <div key={employee.id} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
                      <span className="font-bold text-indigo-600">
                        {employee.fullName
                          .split(' ')
                          .filter(Boolean)
                          .map((n) => n[0])
                          .join('')}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{employee.fullName}</p>
                      <p className="text-sm text-gray-600">{employee.department || 'No department set'}</p>
                    </div>
                  </div>
                  {canManageEmployees && (
                    <button
                      onClick={() => openEditModal(employee)}
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
                    {employee.phone || 'No phone number'}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${roleBadge.color}`}
                  >
                    <RoleIcon className="w-3 h-3" />
                    {roleBadge.label}
                  </span>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">{assignedCount}</p>
                    <p className="text-xs text-gray-500">Products</p>
                  </div>
                </div>

                {canManageEmployees && (
                  <button
                    onClick={() => handleDeleteEmployee(employee.id, employee.fullName)}
                    className="w-full mt-4 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Add New Employee</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleAddEmployee}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={formState.fullName}
                    onChange={(e) => setFormState({ ...formState, fullName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                  <input
                    type="text"
                    value={formState.department}
                    onChange={(e) => setFormState({ ...formState, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select
                    value={formState.role}
                    onChange={(e) => setFormState({ ...formState, role: e.target.value as EmployeeRole })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  >
                    <option value="employee">Employee</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({ ...formState, status: e.target.value as 'active' | 'inactive' })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <input
                  type="password"
                  value={formState.password}
                  onChange={(e) => setFormState({ ...formState, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                />
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
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

      {selectedEmployee && !showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Edit Employee</h2>
              <button onClick={() => setSelectedEmployee(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleEditEmployee}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={formState.fullName}
                    onChange={(e) => setFormState({ ...formState, fullName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                  <input
                    type="text"
                    value={formState.department}
                    onChange={(e) => setFormState({ ...formState, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                  <select
                    value={formState.role}
                    onChange={(e) => setFormState({ ...formState, role: e.target.value as EmployeeRole })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  >
                    <option value="employee">Employee</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState({ ...formState, status: e.target.value as 'active' | 'inactive' })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setSelectedEmployee(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
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
