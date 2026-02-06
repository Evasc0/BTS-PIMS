import React, { useState } from 'react';
import { User } from '../App';
import { RotateCcw, Plus, Search, Check, X, Clock, AlertCircle, UserPlus } from 'lucide-react';

interface ReturnsPageProps {
  user: User;
}

interface Receiver {
  name: string;
  position: string;
  receivedDate: string;
  location: string;
}

interface Return {
  id: string;
  rrspNo: string;
  productName: string;
  returnDate: string;
  quantity: number;
  condition: 'Functional' | 'Destroyed' | 'For Disposal' | 'Need Repair' | 'Damaged';
  remarks: string;
  returnedBy: {
    name: string;
    position: string;
  };
  receivers: Receiver[];
  status: 'pending' | 'approved' | 'rejected';
  processedBy?: string;
  processedDate?: string;
  processingNotes?: string;
}

export function ReturnsPage({ user }: ReturnsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<Return | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [receivers, setReceivers] = useState<Receiver[]>([
    { name: '', position: '', receivedDate: '', location: '' }
  ]);

  // Mock returns data
  const [returns] = useState<Return[]>([
    { 
      id: '1',
      rrspNo: 'RRSP-2024-001',
      productName: 'Laptop Dell XPS 15',
      returnDate: '2024-02-03',
      quantity: 1,
      condition: 'Need Repair',
      remarks: 'Screen not working properly',
      returnedBy: {
        name: 'Mike Employee',
        position: 'employee'
      },
      receivers: [
        {
          name: 'Sarah Johnson',
          position: 'employee',
          receivedDate: '2024-02-03',
          location: 'Main Office'
        }
      ],
      status: 'pending'
    },
    { 
      id: '2',
      rrspNo: 'RRSP-2024-002',
      productName: 'Mouse Logitech MX',
      returnDate: '2024-02-02',
      quantity: 2,
      condition: 'Functional',
      remarks: 'Customer changed preference',
      returnedBy: {
        name: 'Emma Worker',
        position: 'employee'
      },
      receivers: [
        {
          name: 'John Admin',
          position: 'administrator',
          receivedDate: '2024-02-02',
          location: 'Warehouse A'
        }
      ],
      status: 'approved',
      processedBy: 'Sarah Supervisor',
      processedDate: '2024-02-03',
      processingNotes: 'Verified and approved for restocking'
    },
  ]);

  const canSubmit = user.role === 'administrator'; // Only administrator can submit
  const canProcess = user.role === 'administrator';

  // Filter returns based on role and search
  const filteredReturns = returns.filter((ret) => {
    // Employee can only see their own returns
    if (user.role === 'employee') {
      if (ret.returnedBy.name !== user.name) return false;
    }
    
    // Status filter
    if (filterStatus !== 'all' && ret.status !== filterStatus) return false;
    
    // Search filter
    if (searchTerm && !ret.productName.toLowerCase().includes(searchTerm.toLowerCase()) && 
        !ret.rrspNo.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return { color: 'bg-yellow-100 text-yellow-700', icon: Clock };
      case 'approved':
        return { color: 'bg-green-100 text-green-700', icon: Check };
      case 'rejected':
        return { color: 'bg-red-100 text-red-700', icon: X };
      default:
        return { color: 'bg-gray-100 text-gray-700', icon: AlertCircle };
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'Functional':
        return 'bg-green-100 text-green-700';
      case 'Destroyed':
      case 'For Disposal':
        return 'bg-red-100 text-red-700';
      case 'Need Repair':
      case 'Damaged':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const handleApprove = (returnItem: Return) => {
    console.log('Approving return:', returnItem.id);
  };

  const handleReject = (returnItem: Return) => {
    console.log('Rejecting return:', returnItem.id);
  };

  const addReceiver = () => {
    setReceivers([...receivers, { name: '', position: '', receivedDate: '', location: '' }]);
  };

  const removeReceiver = (index: number) => {
    if (receivers.length > 1) {
      setReceivers(receivers.filter((_, i) => i !== index));
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Returns Management (RRSP)</h1>
            <p className="text-gray-600">
              {user.role === 'employee' ? 'Submit and track your return requests' : 'Review and process return requests'}
            </p>
          </div>
          {canSubmit && (
            <button 
              onClick={() => setShowSubmitModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Submit Return
            </button>
          )}
        </div>

        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search returns..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Returns List */}
      <div className="space-y-4">
        {filteredReturns.map((returnItem) => {
          const statusBadge = getStatusBadge(returnItem.status);
          const StatusIcon = statusBadge.icon;
          
          return (
            <div key={returnItem.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <RotateCcw className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{returnItem.productName}</h3>
                      <p className="text-sm text-gray-600">RRSP No: {returnItem.rrspNo}</p>
                    </div>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${statusBadge.color}`}>
                  <StatusIcon className="w-3 h-3" />
                  {returnItem.status}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Return Date</p>
                  <p className="text-sm font-medium text-gray-900">
                    {new Date(returnItem.returnDate).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Quantity</p>
                  <p className="text-sm font-medium text-gray-900">{returnItem.quantity} units</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Condition</p>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConditionColor(returnItem.condition)}`}>
                    {returnItem.condition}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Returned By</p>
                  <p className="text-sm font-medium text-gray-900">{returnItem.returnedBy.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{returnItem.returnedBy.position}</p>
                </div>
              </div>

              {returnItem.remarks && (
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-1">Remarks</p>
                  <p className="text-sm text-gray-900">{returnItem.remarks}</p>
                </div>
              )}

              {/* Receivers Information */}
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-sm font-medium text-gray-900 mb-3">Receiver Information</p>
                {returnItem.receivers.map((receiver, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2 last:mb-0">
                    <div>
                      <p className="text-xs text-gray-600">Name</p>
                      <p className="text-sm font-medium text-gray-900">{receiver.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Position</p>
                      <p className="text-sm text-gray-900 capitalize">{receiver.position}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Received Date</p>
                      <p className="text-sm text-gray-900">
                        {new Date(receiver.receivedDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600">Location</p>
                      <p className="text-sm text-gray-900">{receiver.location}</p>
                    </div>
                  </div>
                ))}
              </div>

              {returnItem.processedBy && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Processed By</p>
                      <p className="text-sm font-medium text-gray-900">{returnItem.processedBy}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Processed Date</p>
                      <p className="text-sm font-medium text-gray-900">
                        {returnItem.processedDate && new Date(returnItem.processedDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {returnItem.processingNotes && (
                    <div className="mt-3">
                      <p className="text-sm text-gray-600 mb-1">Processing Notes</p>
                      <p className="text-sm text-gray-900">{returnItem.processingNotes}</p>
                    </div>
                  )}
                </div>
              )}

              {canProcess && returnItem.status === 'pending' && (
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button 
                    onClick={() => {
                      setSelectedReturn(returnItem);
                    }}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Approve
                  </button>
                  <button 
                    onClick={() => handleReject(returnItem)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Submit Return Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Submit Return Request (RRSP)</h2>
              <button onClick={() => setShowSubmitModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-6">
              {/* Return Information */}
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Return Information</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        RRSP No. *
                      </label>
                      <input 
                        type="text" 
                        placeholder="Enter RRSP Number"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Return Date *
                      </label>
                      <input 
                        type="date" 
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Product
                    </label>
                    <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                      <option value="">Select product</option>
                      <option>Laptop Dell XPS 15</option>
                      <option>Mouse Logitech MX</option>
                      <option>USB-C Cable</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Quantity *
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      placeholder="Enter Quantity"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Condition *
                    </label>
                    <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" required>
                      <option value="">Select condition</option>
                      <option>Functional</option>
                      <option>Destroyed</option>
                      <option>For Disposal</option>
                      <option>Need Repair</option>
                      <option>Damaged</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Remarks
                    </label>
                    <textarea 
                      rows={3}
                      placeholder="Enter any remarks or notes"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Returned By */}
              <div className="pt-4 border-t border-gray-200">
                <h3 className="font-medium text-gray-900 mb-4">Returned By</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Name *
                    </label>
                    <input 
                      type="text" 
                      defaultValue={user.name}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Position *
                    </label>
                    <select defaultValue={user.role} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" required>
                      <option value="employee">Employee</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="administrator">Administrator</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Receivers */}
              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-medium text-gray-900">Receiver Information</h3>
                  <button
                    type="button"
                    onClick={addReceiver}
                    className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition flex items-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add Another Receiver
                  </button>
                </div>
                <div className="space-y-4">
                  {receivers.map((receiver, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-gray-700">Receiver {index + 1}</p>
                        {receivers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeReceiver(index)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Name *
                          </label>
                          <input 
                            type="text" 
                            placeholder="Receiver name"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Position *
                          </label>
                          <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                            <option value="">Select position</option>
                            <option value="employee">Employee</option>
                            <option value="supervisor">Supervisor</option>
                            <option value="administrator">Administrator</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Received Date *
                          </label>
                          <input 
                            type="date" 
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Location *
                          </label>
                          <input 
                            type="text" 
                            placeholder="Receive location"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" 
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button 
                  type="button" 
                  onClick={() => {
                    setShowSubmitModal(false);
                    setReceivers([{ name: '', position: '', receivedDate: '', location: '' }]);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                  Submit Return
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve Return Modal */}
      {selectedReturn && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Approve Return</h2>
              <button onClick={() => setSelectedReturn(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">RRSP No: <span className="font-medium text-gray-900">{selectedReturn.rrspNo}</span></p>
              <p className="text-sm text-gray-600 mb-2">Product: <span className="font-medium text-gray-900">{selectedReturn.productName}</span></p>
              <p className="text-sm text-gray-600 mb-2">Quantity: <span className="font-medium text-gray-900">{selectedReturn.quantity} units</span></p>
              <p className="text-sm text-gray-600">Condition: <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConditionColor(selectedReturn.condition)}`}>{selectedReturn.condition}</span></p>
            </div>
            <form className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Processing Notes</label>
                <textarea 
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  placeholder="Add notes about the approval..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setSelectedReturn(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button 
                  type="submit" 
                  onClick={() => {
                    handleApprove(selectedReturn);
                    setSelectedReturn(null);
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                >
                  Confirm Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}