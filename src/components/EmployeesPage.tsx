import React, { useMemo, useRef, useState } from 'react';
import { Users, Plus, Search, Edit, Trash2, Mail, Phone, X, Shield, Camera, Eye, EyeOff } from 'lucide-react';
import { useLiveQuery } from '../lib/useLiveQuery';
import type { Employee, EmployeeRole } from '../lib/types';
import { db } from '../lib/db';
import { logActivity } from '../lib/activity';
import { getInitials, optimizeProfileImage, splitFullName } from '../lib/profile';

interface EmployeesPageProps {
  user: Employee;
}

interface EmployeeFormState {
  fullName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  address: string;
  role: EmployeeRole;
  status: 'active' | 'inactive';
  password: string;
  profileImageDataUrl: string | null;
  profileImageFormat: string | null;
}

const emptyFormState: EmployeeFormState = {
  fullName: '',
  email: '',
  phone: '',
  position: '',
  department: '',
  address: '',
  role: 'employee',
  status: 'active',
  password: '',
  profileImageDataUrl: null,
  profileImageFormat: null
};

export function EmployeesPage({ user }: EmployeesPageProps) {
  const editPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [formState, setFormState] = useState<EmployeeFormState>(emptyFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageChangedAt, setImageChangedAt] = useState<string | null>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);

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

  const canManageEmployees = user.role === 'system_admin';

  const filteredEmployees = (employees || []).filter((employee) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      employee.fullName.toLowerCase().includes(term) ||
      employee.email.toLowerCase().includes(term) ||
      (employee.department || '').toLowerCase().includes(term) ||
      (employee.position || '').toLowerCase().includes(term)
    );
  });

  const getRoleBadge = (role: EmployeeRole) => {
    switch (role) {
      case 'system_admin':
        return { color: 'bg-purple-100 text-purple-700', icon: Shield, label: 'system_admin' };
      default:
        return { color: 'bg-green-100 text-green-700', icon: Users, label: 'employee' };
    }
  };

  const resetForm = () => {
    setFormState(emptyFormState);
    setFormError(null);
    setFormSuccess(null);
    setImageChangedAt(null);
    setShowCreatePassword(false);
    setResetPassword('');
    setShowResetPassword(false);
    setResetPasswordBusy(false);
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
      position: employee.position ?? '',
      department: employee.department,
      address: employee.address ?? employee.location ?? '',
      role: employee.role,
      status: employee.status,
      password: '',
      profileImageDataUrl: employee.profileImageDataUrl ?? null,
      profileImageFormat: employee.profileImageFormat ?? null
    });
    setFormError(null);
    setFormSuccess(null);
    setImageChangedAt(null);
    setResetPassword('');
    setShowResetPassword(false);
    setResetPasswordBusy(false);
  };

  const handleAddEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageEmployees) return;
    setFormError(null);
    setFormSuccess(null);

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

    if (!navigator.onLine) {
      setFormError('Internet connection required to create user.');
      return;
    }

    if (!window.api?.auth?.createUser) {
      setFormError('Secure user creation API is unavailable.');
      return;
    }

    const createResult = await window.api.auth.createUser({
      adminUserId: user.id,
      fullName: formState.fullName.trim(),
      email: normalizedEmail,
      phone: formState.phone.trim(),
      position: formState.position.trim(),
      department: formState.department.trim(),
      address: formState.address.trim(),
      role: formState.role,
      status: formState.status,
      password: formState.password
    });

    if (!createResult.success || !createResult.employeeId) {
      setFormError(createResult.error || 'Unable to create user.');
      return;
    }

    if (formState.profileImageDataUrl) {
      await db.employees.update(createResult.employeeId, {
        profileImageDataUrl: formState.profileImageDataUrl,
        profileImageFormat: formState.profileImageFormat,
        profileImageUpdatedAt: new Date().toISOString()
      });
    }

    await logActivity({
      action: 'CREATE',
      entityType: 'employee',
      entityId: createResult.employeeId,
      performedByEmployeeId: user.id,
      details: `Employee created: ${formState.fullName.trim()}`
    });

    if (navigator.onLine && window.api?.sync?.push) {
      void window.api.sync.push(user.id);
    }

    setShowAddModal(false);
    resetForm();
  };

  const handleEditEmployee = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageEmployees || !selectedEmployee) return;
    setFormError(null);
    setFormSuccess(null);

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

    const split = splitFullName(formState.fullName);
    const payload: Partial<Employee> = {
      fullName: formState.fullName.trim(),
      firstName: split.firstName,
      lastName: split.lastName,
      email: normalizedEmail,
      phone: formState.phone.trim(),
      position: formState.position.trim(),
      department: formState.department.trim(),
      address: formState.address.trim(),
      location: formState.address.trim(),
      role: formState.role,
      status: formState.status
    };

    if (imageChangedAt) {
      payload.profileImageDataUrl = formState.profileImageDataUrl;
      payload.profileImageFormat = formState.profileImageFormat;
      payload.profileImageUpdatedAt = imageChangedAt;
    }

    await db.employees.update(selectedEmployee.id, payload);

    await logActivity({
      action: 'UPDATE',
      entityType: 'employee',
      entityId: selectedEmployee.id,
      performedByEmployeeId: user.id,
      details: `Employee updated: ${formState.fullName.trim()}`
    });

    if (navigator.onLine && window.api?.sync?.push) {
      void window.api.sync.push(user.id);
    }

    setSelectedEmployee(null);
    setFormSuccess('Employee updated.');
    setImageChangedAt(null);
  };

  const generateStrongPassword = (): string => {
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '@#$%&*!?';
    const all = `${lower}${upper}${digits}${symbols}`;
    const randomChar = (set: string) => set[Math.floor(Math.random() * set.length)];
    const chars = [randomChar(lower), randomChar(upper), randomChar(digits), randomChar(symbols)];
    while (chars.length < 12) chars.push(randomChar(all));
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  };

  const handleAdminResetPassword = async () => {
    if (!canManageEmployees || !selectedEmployee) return;
    setFormError(null);
    setFormSuccess(null);
    const nextPassword = resetPassword.trim();
    if (!nextPassword) {
      setFormError('Enter a new password or generate one first.');
      return;
    }
    if (!window.api?.auth?.adminResetPassword) {
      setFormError('Admin reset password API is unavailable.');
      return;
    }

    setResetPasswordBusy(true);
    try {
      const result = await window.api.auth.adminResetPassword({
        adminUserId: user.id,
        targetEmployeeId: selectedEmployee.id,
        newPassword: nextPassword
      });
      if (!result.success) {
        setFormError(result.error || 'Unable to reset employee password.');
        return;
      }

      await logActivity({
        action: 'UPDATE',
        entityType: 'employee',
        entityId: selectedEmployee.id,
        performedByEmployeeId: user.id,
        details: `Password reset for employee: ${selectedEmployee.fullName}`
      });

      setFormSuccess('Employee password reset successfully.');
      setResetPassword('');
      setShowResetPassword(false);

      if (navigator.onLine && window.api?.sync?.push) {
        void window.api.sync.push(user.id);
      }
    } finally {
      setResetPasswordBusy(false);
    }
  };

  const handleDeleteEmployee = async (employeeId: string, employeeName: string) => {
    if (!canManageEmployees) return;
    const adminCount = (employees || []).filter((emp) => emp.role === 'system_admin').length;
    const target = (employees || []).find((emp) => emp.id === employeeId);
    if (target?.role === 'system_admin' && adminCount <= 1) {
      setFormError('At least one system admin account must remain active.');
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
    if (navigator.onLine && window.api?.sync?.push) {
      void window.api.sync.push(user.id);
    }
  };

  const handleEditImageClick = () => {
    if (imageBusy) return;
    editPhotoInputRef.current?.click();
  };

  const handleEditImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError('Please select a valid image file.');
      return;
    }
    setImageBusy(true);
    setFormError(null);
    try {
      const optimized = await optimizeProfileImage(file);
      setFormState((prev) => ({
        ...prev,
        profileImageDataUrl: optimized.dataUrl,
        profileImageFormat: optimized.format
      }));
      setImageChangedAt(new Date().toISOString());
    } catch (error: any) {
      setFormError(error?.message || 'Unable to process profile image.');
    } finally {
      setImageBusy(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Employees</h1>
            <p className="text-gray-600">
              {user.role === 'system_admin' ? 'Manage all employee records' : 'View your team members'}
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
        {formError && !showAddModal && !selectedEmployee && <p className="mt-3 text-sm text-red-600">{formError}</p>}
        {formSuccess && !showAddModal && !selectedEmployee && <p className="mt-3 text-sm text-emerald-700">{formSuccess}</p>}
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
                    <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center overflow-hidden">
                      {employee.profileImageDataUrl ? (
                        <img
                          src={employee.profileImageDataUrl}
                          alt={`${employee.fullName} profile`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="font-bold text-indigo-600">{getInitials(employee.fullName)}</span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{employee.fullName}</p>
                      <p className="text-sm text-gray-600">{employee.position || employee.department || 'No position set'}</p>
                    </div>
                  </div>
                  {canManageEmployees && (
                    <button onClick={() => openEditModal(employee)} className="p-2 hover:bg-gray-100 rounded-lg transition">
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
                  <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${roleBadge.color}`}>
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">Contact Number</label>
                  <input
                    type="tel"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                  <input
                    type="text"
                    value={formState.position}
                    onChange={(e) => setFormState({ ...formState, position: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                  <input
                    type="text"
                    value={formState.department}
                    onChange={(e) => setFormState({ ...formState, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                  <input
                    type="text"
                    value={formState.address}
                    onChange={(e) => setFormState({ ...formState, address: e.target.value })}
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
                    <option value="system_admin">System Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={formState.status}
                    onChange={(e) => setFormState({ ...formState, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                <div className="flex items-center border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                  <input
                    type={showCreatePassword ? 'text' : 'password'}
                    value={formState.password}
                    onChange={(e) => setFormState({ ...formState, password: e.target.value })}
                    className="w-full flex-1 bg-transparent px-3 py-2 outline-none"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword((prev) => !prev)}
                    className="mr-2 inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-gray-700"
                    aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                  >
                    {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
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
              <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
                <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center overflow-hidden">
                  {formState.profileImageDataUrl ? (
                    <img src={formState.profileImageDataUrl} alt="Employee profile" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-bold text-indigo-600">{getInitials(formState.fullName)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleEditImageClick}
                    disabled={imageBusy}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-60 flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    {imageBusy ? 'Processing...' : 'Change Photo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormState((prev) => ({ ...prev, profileImageDataUrl: null, profileImageFormat: null }));
                      setImageChangedAt(new Date().toISOString());
                    }}
                    className="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition"
                  >
                    Remove Photo
                  </button>
                  <input
                    ref={editPhotoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/jpg"
                    hidden
                    onChange={handleEditImageChange}
                  />
                </div>
              </div>
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">Contact Number</label>
                  <input
                    type="tel"
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                  <input
                    type="text"
                    value={formState.position}
                    onChange={(e) => setFormState({ ...formState, position: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                  <input
                    type="text"
                    value={formState.department}
                    onChange={(e) => setFormState({ ...formState, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                  <input
                    type="text"
                    value={formState.address}
                    onChange={(e) => setFormState({ ...formState, address: e.target.value })}
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
                    <option value="system_admin">System Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <select
                    value={formState.status}
                    onChange={(e) => setFormState({ ...formState, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-gray-800">Reset Employee Password</p>
                <p className="text-xs text-gray-500 mt-1">Admin-only action. This updates Supabase Auth and syncs to all devices.</p>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
                  <div className="flex items-center border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                    <input
                      type={showResetPassword ? 'text' : 'password'}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      placeholder="New password"
                      className="w-full flex-1 bg-transparent px-3 py-2 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword((prev) => !prev)}
                      className="mr-2 inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:text-gray-700"
                      aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                    >
                      {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResetPassword(generateStrongPassword());
                      setShowResetPassword(true);
                    }}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition"
                  >
                    Generate
                  </button>
                  <button
                    type="button"
                    onClick={handleAdminResetPassword}
                    disabled={resetPasswordBusy}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-60"
                  >
                    {resetPasswordBusy ? 'Resetting...' : 'Reset Password'}
                  </button>
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
