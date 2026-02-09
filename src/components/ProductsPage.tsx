
import React, { useMemo, useState } from 'react';
import {
  Package,
  Plus,
  Search,
  Edit,
  Trash2,
  Filter,
  MoreVertical,
  X
} from 'lucide-react';
import { useLiveQuery } from '../lib/useLiveQuery';
import type { Employee, Product, ProductStatus, ValueCategory } from '../lib/types';
import { db } from '../lib/db';
import { createId, formatCurrency, toNumber } from '../lib/utils';
import { logActivity } from '../lib/activity';

interface ProductsPageProps {
  user: Employee;
}

interface ProductFormState {
  valueCategory: ValueCategory | '';
  article: string;
  description: string;
  date: string;
  parControlNumber: string;
  propertyNumber: string;
  unit: string;
  unitValue: string;
  balancePerCard: string;
  onHandPerCount: string;
  location: string;
  remarks: string;
  assignedToEmployeeId: string;
}

const emptyFormState: ProductFormState = {
  valueCategory: '',
  article: '',
  description: '',
  date: '',
  parControlNumber: '',
  propertyNumber: '',
  unit: '',
  unitValue: '',
  balancePerCard: '',
  onHandPerCount: '',
  location: '',
  remarks: '',
  assignedToEmployeeId: ''
};

const valueOptions: ValueCategory[] = ['HV', 'MV', 'LV'];
const unitOptions = ['pcs', 'set', 'box', 'unit', 'pack'];

export function ProductsPage({ user }: ProductsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProductStatus | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [formState, setFormState] = useState<ProductFormState>(emptyFormState);
  const [formError, setFormError] = useState<string | null>(null);

  const products = useLiveQuery(() => db.products.toArray(), []);
  const employees = useLiveQuery(() => db.employees.toArray(), []);

  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    (employees || []).forEach((employee: Employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const canManageProduct = user.role === 'admin' || user.role === 'supervisor';

  const filteredProducts = (products || [])
    .filter((product: Product) => {
      if (user.role === 'employee') {
        return product.assignedToEmployeeId === user.id;
      }
      return true;
    })
    .filter((product: Product) => (statusFilter === 'all' ? true : product.status === statusFilter))
    .filter((product: Product) => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;
      return (
        (product.article || '').toLowerCase().includes(term) ||
        (product.propertyNumber || '').toLowerCase().includes(term) ||
        (product.parControlNumber || '').toLowerCase().includes(term) ||
        (product.description || '').toLowerCase().includes(term)
      );
    });

  const computeTotal = (unitValue: string, onHandPerCount: string) => {
    const unitValueNumber = toNumber(unitValue);
    const onHandNumber = toNumber(onHandPerCount);
    return unitValueNumber * onHandNumber;
  };

  const openAddModal = () => {
    setFormState(emptyFormState);
    setFormError(null);
    setShowAddModal(true);
  };

  const openEditModal = (product: Product) => {
    setSelectedProduct(product);
    setFormState({
      valueCategory: product.valueCategory,
      article: product.article,
      description: product.description,
      date: product.date,
      parControlNumber: product.parControlNumber,
      propertyNumber: product.propertyNumber,
      unit: product.unit,
      unitValue: String(product.unitValue),
      balancePerCard: String(product.balancePerCard),
      onHandPerCount: String(product.onHandPerCount),
      location: product.location,
      remarks: product.remarks,
      assignedToEmployeeId: product.assignedToEmployeeId || ''
    });
    setFormError(null);
    setShowEditModal(true);
  };

  const buildStatus = (assignedToEmployeeId: string): ProductStatus =>
    assignedToEmployeeId ? 'assigned' : 'available';

  const handleAddProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageProduct) return;
    setFormError(null);

    if (!formState.valueCategory || !formState.article.trim() || !formState.date || !formState.parControlNumber.trim()) {
      setFormError('Value, article, date, and PAR control number are required.');
      return;
    }

    const total = computeTotal(formState.unitValue, formState.onHandPerCount);
    const productId = createId();
    const assignedId = formState.assignedToEmployeeId || undefined;
    const status = buildStatus(formState.assignedToEmployeeId);

    await db.products.add({
      id: productId,
      valueCategory: formState.valueCategory,
      article: formState.article.trim(),
      description: formState.description.trim(),
      date: formState.date,
      parControlNumber: formState.parControlNumber.trim(),
      propertyNumber: formState.propertyNumber.trim(),
      unit: formState.unit,
      unitValue: toNumber(formState.unitValue),
      balancePerCard: toNumber(formState.balancePerCard),
      onHandPerCount: toNumber(formState.onHandPerCount),
      total,
      location: formState.location.trim(),
      remarks: formState.remarks.trim(),
      assignedToEmployeeId: assignedId,
      status
    });

    await logActivity({
      action: 'CREATE',
      entityType: 'product',
      entityId: productId,
      performedByEmployeeId: user.id,
      details: `Product added: ${formState.article.trim()}`
    });

    if (assignedId) {
      await logActivity({
        action: 'ASSIGN',
        entityType: 'product',
        entityId: productId,
        performedByEmployeeId: user.id,
        details: `Product assigned to ${employeeMap.get(assignedId)?.fullName || 'employee'}`
      });
    }

    setShowAddModal(false);
    setFormState(emptyFormState);
  };

  const handleEditProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageProduct || !selectedProduct) return;
    setFormError(null);

    if (!formState.valueCategory || !formState.article.trim() || !formState.date || !formState.parControlNumber.trim()) {
      setFormError('Value, article, date, and PAR control number are required.');
      return;
    }

    const assignedId = formState.assignedToEmployeeId || undefined;
    const total = computeTotal(formState.unitValue, formState.onHandPerCount);
    const status = buildStatus(formState.assignedToEmployeeId);

    await db.products.update(selectedProduct.id, {
      valueCategory: formState.valueCategory,
      article: formState.article.trim(),
      description: formState.description.trim(),
      date: formState.date,
      parControlNumber: formState.parControlNumber.trim(),
      propertyNumber: formState.propertyNumber.trim(),
      unit: formState.unit,
      unitValue: toNumber(formState.unitValue),
      balancePerCard: toNumber(formState.balancePerCard),
      onHandPerCount: toNumber(formState.onHandPerCount),
      total,
      location: formState.location.trim(),
      remarks: formState.remarks.trim(),
      assignedToEmployeeId: assignedId,
      status
    });

    await logActivity({
      action: 'UPDATE',
      entityType: 'product',
      entityId: selectedProduct.id,
      performedByEmployeeId: user.id,
      details: `Product updated: ${formState.article.trim()}`
    });

    if (assignedId !== (selectedProduct.assignedToEmployeeId || '')) {
      await logActivity({
        action: 'ASSIGN',
        entityType: 'product',
        entityId: selectedProduct.id,
        performedByEmployeeId: user.id,
        details: assignedId
          ? `Product assigned to ${employeeMap.get(assignedId)?.fullName || 'employee'}`
          : 'Product unassigned'
      });
    }

    setShowEditModal(false);
    setSelectedProduct(null);
  };

  const handleDeleteProduct = async (product: Product) => {
    if (!canManageProduct) return;
    const confirmed = window.confirm(`Delete ${product.article}? This cannot be undone.`);
    if (!confirmed) return;
    await db.products.delete(product.id);
    await logActivity({
      action: 'DELETE',
      entityType: 'product',
      entityId: product.id,
      performedByEmployeeId: user.id,
      details: `Product deleted: ${product.article}`
    });
  };

  const handleCopyPropertyNumber = async (propertyNumber: string) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(propertyNumber);
      } else {
        const tempInput = document.createElement('textarea');
        tempInput.value = propertyNumber;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }
    } catch {
      // ignore clipboard errors
    }
  };

  const cycleStatusFilter = () => {
    const next =
      statusFilter === 'all'
        ? 'available'
        : statusFilter === 'available'
          ? 'assigned'
          : statusFilter === 'assigned'
            ? 'returned'
            : 'all';
    setStatusFilter(next);
  };

  const getStatusColor = (status: ProductStatus) => {
    switch (status) {
      case 'available':
        return 'bg-green-100 text-green-700';
      case 'assigned':
        return 'bg-orange-100 text-orange-700';
      case 'returned':
        return 'bg-blue-100 text-blue-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getValueColor = (value: ValueCategory) => {
    switch (value) {
      case 'HV':
        return 'bg-purple-100 text-purple-700';
      case 'MV':
        return 'bg-blue-100 text-blue-700';
      case 'LV':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const columnCount = user.role !== 'employee' ? 15 : 14;

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Products</h1>
            <p className="text-gray-600">
              {user.role === 'employee' ? 'View your assigned products' : 'Manage inventory products'}
            </p>
          </div>
          {canManageProduct && (
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Product
            </button>
          )}
        </div>

        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <button
            onClick={cycleStatusFilter}
            title={`Filter: ${statusFilter}`}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition flex items-center gap-2"
          >
            <Filter className="w-5 h-5" />
            Filter
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Article</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Acquired</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PAR Control No.</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property No.</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UOM</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Cost</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">QTY</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Amount</th>
                {user.role !== 'employee' && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned To</th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Remarks</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProducts.length === 0 && (
                <tr>
                  <td className="px-6 py-6 text-center text-gray-500" colSpan={columnCount}>
                    No products available.
                  </td>
                </tr>
              )}
              {filteredProducts.map((product: Product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getValueColor(product.valueCategory)}`}>
                      {product.valueCategory}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{product.article}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.description}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.date}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.parControlNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.propertyNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.unit}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{formatCurrency(product.unitValue)}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{product.onHandPerCount}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{formatCurrency(product.total)}</td>
                  {user.role !== 'employee' && (
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {product.assignedToEmployeeId ? employeeMap.get(product.assignedToEmployeeId)?.fullName || '-' : '-'}
                    </td>
                  )}
                  <td className="px-6 py-4 text-sm text-gray-600">{product.location}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{product.remarks}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(product.status)}`}>
                      {product.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {canManageProduct && (
                        <button
                          onClick={() => openEditModal(product)}
                          className="p-2 hover:bg-gray-100 rounded-lg transition"
                        >
                          <Edit className="w-4 h-4 text-gray-600" />
                        </button>
                      )}
                      {canManageProduct && (
                        <button onClick={() => handleDeleteProduct(product)} className="p-2 hover:bg-red-50 rounded-lg transition">
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      )}
                      <button
                        onClick={() => handleCopyPropertyNumber(product.propertyNumber)}
                        title="Copy property number"
                        className="p-2 hover:bg-gray-100 rounded-lg transition"
                      >
                        <MoreVertical className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Add New Product</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleAddProduct}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Value *</label>
                <select
                  value={formState.valueCategory}
                  onChange={(e) => setFormState({ ...formState, valueCategory: e.target.value as ValueCategory })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                >
                  <option value="">Select value classification</option>
                  {valueOptions.map((value) => (
                    <option key={value} value={value}>
                      {value} ({value === 'HV' ? 'High' : value === 'MV' ? 'Mid' : 'Low'} Value)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Article *</label>
                  <input
                    type="text"
                    value={formState.article}
                    onChange={(e) => setFormState({ ...formState, article: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date *</label>
                  <input
                    type="date"
                    value={formState.date}
                    onChange={(e) => setFormState({ ...formState, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description *</label>
                <textarea
                  rows={3}
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">PAR Control Number *</label>
                  <input
                    type="text"
                    value={formState.parControlNumber}
                    onChange={(e) => setFormState({ ...formState, parControlNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Property Number *</label>
                  <input
                    type="text"
                    value={formState.propertyNumber}
                    onChange={(e) => setFormState({ ...formState, propertyNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit *</label>
                  <select
                    value={formState.unit}
                    onChange={(e) => setFormState({ ...formState, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  >
                    <option value="">Select unit</option>
                    {unitOptions.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit Value (PHP) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formState.unitValue}
                    onChange={(e) => setFormState({ ...formState, unitValue: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Balance per Card *</label>
                  <input
                    type="number"
                    value={formState.balancePerCard}
                    onChange={(e) => setFormState({ ...formState, balancePerCard: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">On Hand per Count *</label>
                  <input
                    type="number"
                    value={formState.onHandPerCount}
                    onChange={(e) => setFormState({ ...formState, onHandPerCount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Total (PHP)</label>
                  <input
                    type="text"
                    value={formatCurrency(computeTotal(formState.unitValue, formState.onHandPerCount))}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Location *</label>
                  <input
                    type="text"
                    value={formState.location}
                    onChange={(e) => setFormState({ ...formState, location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                <textarea
                  rows={2}
                  value={formState.remarks}
                  onChange={(e) => setFormState({ ...formState, remarks: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign to</label>
                <select
                  value={formState.assignedToEmployeeId}
                  onChange={(e) => setFormState({ ...formState, assignedToEmployeeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="">Unassigned</option>
                  {(employees || []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName} ({employee.role})
                    </option>
                  ))}
                </select>
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                  Add Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && selectedProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Edit Product</h2>
              <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleEditProduct}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Value *</label>
                <select
                  value={formState.valueCategory}
                  onChange={(e) => setFormState({ ...formState, valueCategory: e.target.value as ValueCategory })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                >
                  {valueOptions.map((value) => (
                    <option key={value} value={value}>
                      {value} ({value === 'HV' ? 'High' : value === 'MV' ? 'Mid' : 'Low'} Value)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Article *</label>
                  <input
                    type="text"
                    value={formState.article}
                    onChange={(e) => setFormState({ ...formState, article: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date *</label>
                  <input
                    type="date"
                    value={formState.date}
                    onChange={(e) => setFormState({ ...formState, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description *</label>
                <textarea
                  rows={3}
                  value={formState.description}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">PAR Control Number *</label>
                  <input
                    type="text"
                    value={formState.parControlNumber}
                    onChange={(e) => setFormState({ ...formState, parControlNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Property Number *</label>
                  <input
                    type="text"
                    value={formState.propertyNumber}
                    onChange={(e) => setFormState({ ...formState, propertyNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit *</label>
                  <select
                    value={formState.unit}
                    onChange={(e) => setFormState({ ...formState, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  >
                    {unitOptions.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit Value (PHP) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formState.unitValue}
                    onChange={(e) => setFormState({ ...formState, unitValue: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Balance per Card *</label>
                  <input
                    type="number"
                    value={formState.balancePerCard}
                    onChange={(e) => setFormState({ ...formState, balancePerCard: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">On Hand per Count *</label>
                  <input
                    type="number"
                    value={formState.onHandPerCount}
                    onChange={(e) => setFormState({ ...formState, onHandPerCount: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Total (PHP)</label>
                  <input
                    type="text"
                    value={formatCurrency(computeTotal(formState.unitValue, formState.onHandPerCount))}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Location *</label>
                  <input
                    type="text"
                    value={formState.location}
                    onChange={(e) => setFormState({ ...formState, location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                <textarea
                  rows={2}
                  value={formState.remarks}
                  onChange={(e) => setFormState({ ...formState, remarks: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign to</label>
                <select
                  value={formState.assignedToEmployeeId}
                  onChange={(e) => setFormState({ ...formState, assignedToEmployeeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="">Unassigned</option>
                  {(employees || []).map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName} ({employee.role})
                    </option>
                  ))}
                </select>
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
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
