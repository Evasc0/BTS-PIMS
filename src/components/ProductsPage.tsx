import React, { useState } from 'react';
import { User } from '../App';
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

interface ProductsPageProps {
  user: User;
}

interface Product {
  id: string;
  value: 'HV' | 'MV' | 'LV';
  article: string;
  description: string;
  date: string;
  parControlNumber: string;
  propertyNumber: string;
  unit: string;
  unitValue: number;
  balancePerCard: number;
  onHandPerCount: number;
  total: number;
  remarks: string;
  assignedTo?: string;
  status: 'in-stock' | 'low-stock' | 'out-of-stock';
}

export function ProductsPage({ user }: ProductsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Mock products data
  const [products] = useState<Product[]>([
    { 
      id: '1', 
      value: 'HV',
      article: 'Laptop Dell XPS 15', 
      description: 'High-performance laptop with 16GB RAM', 
      date: '2024-01-15',
      parControlNumber: 'PAR-2024-001',
      propertyNumber: 'PROP-2024-001',
      unit: 'pcs',
      unitValue: 1499,
      balancePerCard: 25,
      onHandPerCount: 25,
      total: 37475,
      remarks: 'In good condition',
      assignedTo: 'Mike Employee', 
      status: 'in-stock' 
    },
    { 
      id: '2', 
      value: 'MV',
      article: 'Mouse Logitech MX', 
      description: 'Wireless ergonomic mouse', 
      date: '2024-01-20',
      parControlNumber: 'PAR-2024-002',
      propertyNumber: 'PROP-2024-002',
      unit: 'pcs',
      unitValue: 99,
      balancePerCard: 45,
      onHandPerCount: 45,
      total: 4455,
      remarks: 'New stock',
      assignedTo: 'Sarah Supervisor', 
      status: 'in-stock' 
    },
  ]);

  const canAddProduct = user.role === 'administrator';
  const canEditProduct = user.role === 'administrator';
  const canDeleteProduct = user.role === 'administrator';

  const filteredProducts = products.filter((product) => {
    // Employee can only see assigned products
    if (user.role === 'employee') {
      return user.assignedProducts?.includes(product.id);
    }
    
    return true;
  }).filter((product) => 
    product.article.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.propertyNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.parControlNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'in-stock':
        return 'bg-green-100 text-green-700';
      case 'low-stock':
        return 'bg-orange-100 text-orange-700';
      case 'out-of-stock':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getValueColor = (value: string) => {
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

  const getValueLabel = (value: string) => {
    switch (value) {
      case 'HV':
        return 'High Value';
      case 'MV':
        return 'Mid Value';
      case 'LV':
        return 'Low Value';
      default:
        return value;
    }
  };

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
          {canAddProduct && (
            <button 
              onClick={() => setShowAddModal(true)}
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
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filter
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Article</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PAR Control No.</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Property No.</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">On Hand</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                {user.role !== 'employee' && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned To</th>
                )}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getValueColor(product.value)}`}>
                      {product.value}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <Package className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{product.article}</p>
                        <p className="text-xs text-gray-500">{product.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.parControlNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.propertyNumber}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{product.unit}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">₱{product.unitValue.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{product.onHandPerCount}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">₱{product.total.toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(product.status)}`}>
                      {product.status.replace('-', ' ')}
                    </span>
                  </td>
                  {user.role !== 'employee' && (
                    <td className="px-6 py-4 text-sm text-gray-600">{product.assignedTo || '-'}</td>
                  )}
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {canEditProduct && (
                        <button 
                          onClick={() => {
                            setSelectedProduct(product);
                            setShowEditModal(true);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition"
                        >
                          <Edit className="w-4 h-4 text-gray-600" />
                        </button>
                      )}
                      {canDeleteProduct && (
                        <button className="p-2 hover:bg-red-50 rounded-lg transition">
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      )}
                      <button className="p-2 hover:bg-gray-100 rounded-lg transition">
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

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Add New Product</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Value *</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                  <option value="">Select value classification</option>
                  <option value="HV">HV (High Value)</option>
                  <option value="MV">MV (Mid Value)</option>
                  <option value="LV">LV (Low Value)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Article *</label>
                  <input 
                    type="text" 
                    placeholder="Enter article name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date *</label>
                  <input 
                    type="date" 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description *</label>
                <textarea 
                  rows={3}
                  placeholder="Enter product description"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">PAR Control Number *</label>
                  <input 
                    type="text" 
                    placeholder="e.g., PAR-2024-001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Property Number *</label>
                  <input 
                    type="text" 
                    placeholder="e.g., PROP-2024-001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit *</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                    <option value="">Select unit</option>
                    <option>pcs</option>
                    <option>set</option>
                    <option>box</option>
                    <option>unit</option>
                    <option>pack</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit Value (₱) *</label>
                  <input 
                    type="number" 
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Balance per Card *</label>
                  <input 
                    type="number" 
                    placeholder="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">On Hand per Count *</label>
                  <input 
                    type="number" 
                    placeholder="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Total (₱)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    placeholder="Auto-calculated"
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                <textarea 
                  rows={2}
                  placeholder="Enter any remarks or notes"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign to</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                  <option value="">Select employee</option>
                  <option>Mike Employee</option>
                  <option>Emma Worker</option>
                  <option>David Staff</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
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

      {/* Edit Product Modal */}
      {showEditModal && selectedProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Edit Product</h2>
              <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Value *</label>
                <select defaultValue={selectedProduct.value} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                  <option value="HV">HV (High Value)</option>
                  <option value="MV">MV (Mid Value)</option>
                  <option value="LV">LV (Low Value)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Article *</label>
                  <input 
                    type="text" 
                    defaultValue={selectedProduct.article}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Date *</label>
                  <input 
                    type="date" 
                    defaultValue={selectedProduct.date}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description *</label>
                <textarea 
                  rows={3}
                  defaultValue={selectedProduct.description}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">PAR Control Number *</label>
                  <input 
                    type="text" 
                    defaultValue={selectedProduct.parControlNumber}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Property Number *</label>
                  <input 
                    type="text" 
                    defaultValue={selectedProduct.propertyNumber}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit *</label>
                  <select defaultValue={selectedProduct.unit} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                    <option>pcs</option>
                    <option>set</option>
                    <option>box</option>
                    <option>unit</option>
                    <option>pack</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Unit Value (₱) *</label>
                  <input 
                    type="number" 
                    step="0.01"
                    defaultValue={selectedProduct.unitValue}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Balance per Card *</label>
                  <input 
                    type="number" 
                    defaultValue={selectedProduct.balancePerCard}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">On Hand per Count *</label>
                  <input 
                    type="number" 
                    defaultValue={selectedProduct.onHandPerCount}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Total (₱)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    defaultValue={selectedProduct.total}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                <textarea 
                  rows={2}
                  defaultValue={selectedProduct.remarks}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign to</label>
                <select defaultValue={selectedProduct.assignedTo} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                  <option value="">Select employee</option>
                  <option>Mike Employee</option>
                  <option>Emma Worker</option>
                  <option>David Staff</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
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