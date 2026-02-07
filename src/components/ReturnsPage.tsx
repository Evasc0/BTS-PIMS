
import React, { useMemo, useState } from 'react';
import { RotateCcw, Plus, Search, Check, X, Clock, AlertCircle, UserPlus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Employee, EmployeeRole, Product, ReturnCondition, ReturnRecord, ReturnStatus } from '../lib/types';
import { db } from '../lib/db';
import { createId, formatDate, nowIso, toNumber } from '../lib/utils';
import { logActivity } from '../lib/activity';

interface ReturnsPageProps {
  user: Employee;
}

interface ReceiverFormState {
  employeeId: string;
  position: EmployeeRole;
  receivedDate: string;
  location: string;
}

interface ReturnFormState {
  rrspNumber: string;
  productId: string;
  returnDate: string;
  quantity: string;
  condition: ReturnCondition | '';
  remarks: string;
  receivers: ReceiverFormState[];
}

const emptyReceiver: ReceiverFormState = {
  employeeId: '',
  position: 'employee',
  receivedDate: '',
  location: ''
};

const emptyReturnForm: ReturnFormState = {
  rrspNumber: '',
  productId: '',
  returnDate: '',
  quantity: '',
  condition: '',
  remarks: '',
  receivers: [{ ...emptyReceiver }]
};

const conditionOptions: { value: ReturnCondition; label: string }[] = [
  { value: 'functional', label: 'Functional' },
  { value: 'destroyed', label: 'Destroyed' },
  { value: 'for disposal', label: 'For Disposal' },
  { value: 'need repair', label: 'Need Repair' },
  { value: 'damaged', label: 'Damaged' }
];

const roleOptions: EmployeeRole[] = ['employee', 'supervisor', 'admin'];

export function ReturnsPage({ user }: ReturnsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<ReturnRecord | null>(null);
  const [filterStatus, setFilterStatus] = useState<ReturnStatus | 'all'>('all');
  const [formState, setFormState] = useState<ReturnFormState>(emptyReturnForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [processingNotes, setProcessingNotes] = useState('');

  const returns = useLiveQuery(() => db.returns.toArray(), []);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const employees = useLiveQuery(() => db.employees.toArray(), []);

  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    (products || []).forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    (employees || []).forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const canSubmit = true;
  const canProcess = user.role === 'admin' || user.role === 'supervisor';

  const availableProducts = useMemo(() => {
    if (user.role === 'employee') {
      return (products || []).filter((product) => product.assignedToEmployeeId === user.id);
    }
    return products || [];
  }, [products, user]);

  const filteredReturns = useMemo(() => {
    return (returns || []).filter((ret) => {
      if (user.role === 'employee' && ret.returnedByEmployeeId !== user.id) {
        return false;
      }
      if (filterStatus !== 'all' && ret.status !== filterStatus) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.trim().toLowerCase();
      const productName = productMap.get(ret.productId)?.article?.toLowerCase() || '';
      return productName.includes(term) || ret.rrspNumber.toLowerCase().includes(term);
    });
  }, [returns, filterStatus, searchTerm, user, productMap]);

  const getStatusBadge = (status: ReturnStatus) => {
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

  const getConditionColor = (condition: ReturnCondition) => {
    switch (condition) {
      case 'functional':
        return 'bg-green-100 text-green-700';
      case 'destroyed':
      case 'for disposal':
        return 'bg-red-100 text-red-700';
      case 'need repair':
      case 'damaged':
        return 'bg-orange-100 text-orange-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const resetForm = () => {
    setFormState(emptyReturnForm);
    setFormError(null);
  };

  const addReceiver = () => {
    setFormState((prev) => ({
      ...prev,
      receivers: [...prev.receivers, { ...emptyReceiver }]
    }));
  };

  const removeReceiver = (index: number) => {
    setFormState((prev) => {
      if (prev.receivers.length <= 1) return prev;
      return { ...prev, receivers: prev.receivers.filter((_, i) => i !== index) };
    });
  };

  const handleReceiverChange = (
    index: number,
    field: keyof ReceiverFormState,
    value: string
  ) => {
    setFormState((prev) => {
      const updated = [...prev.receivers];
      const current = { ...updated[index] };
      if (field === 'employeeId') {
        const employee = employeeMap.get(value);
        current.employeeId = value;
        current.position = employee?.role || current.position;
      } else if (field === 'position') {
        current.position = value as EmployeeRole;
      } else if (field === 'receivedDate') {
        current.receivedDate = value;
      } else if (field === 'location') {
        current.location = value;
      }
      updated[index] = current;
      return { ...prev, receivers: updated };
    });
  };

  const handleSubmitReturn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setFormError(null);

    if (!formState.rrspNumber.trim() || !formState.productId || !formState.returnDate || !formState.condition) {
      setFormError('RRSP number, product, return date, and condition are required.');
      return;
    }

    const quantity = toNumber(formState.quantity);
    if (quantity <= 0) {
      setFormError('Quantity must be greater than zero.');
      return;
    }

    const validReceivers = formState.receivers.filter(
      (receiver) => receiver.employeeId && receiver.receivedDate && receiver.location
    );
    if (validReceivers.length === 0) {
      setFormError('At least one receiver with date and location is required.');
      return;
    }

    const returnId = createId();
    const receiverEntries = validReceivers.map((receiver) => ({
      employeeId: receiver.employeeId,
      position: receiver.position,
      receivedDate: receiver.receivedDate,
      location: receiver.location
    }));

    const primaryReceiver = receiverEntries[0];

    await db.returns.add({
      id: returnId,
      rrspNumber: formState.rrspNumber.trim(),
      productId: formState.productId,
      returnDate: formState.returnDate,
      quantity,
      condition: formState.condition as ReturnCondition,
      remarks: formState.remarks.trim(),
      returnedByEmployeeId: user.id,
      returnedByPosition: user.role,
      receivedDate: primaryReceiver.receivedDate,
      location: primaryReceiver.location,
      receivedByEmployeeIds: receiverEntries.map((entry) => entry.employeeId),
      receivedByEntries: receiverEntries,
      createdAt: nowIso(),
      status: 'pending'
    });

    const product = productMap.get(formState.productId);
    if (product) {
      const updatedOnHand = product.onHandPerCount + quantity;
      const updatedBalance = product.balancePerCard + quantity;
      const assignedToEmployeeId = product.assignedToEmployeeId === user.id ? undefined : product.assignedToEmployeeId;
      const status = product.assignedToEmployeeId === user.id ? 'returned' : product.status;

      await db.products.update(product.id, {
        onHandPerCount: updatedOnHand,
        balancePerCard: updatedBalance,
        total: product.unitValue * updatedOnHand,
        assignedToEmployeeId,
        status
      });
    }

    await logActivity({
      action: 'SUBMIT',
      entityType: 'return',
      entityId: returnId,
      performedByEmployeeId: user.id,
      details: `Return submitted: ${formState.rrspNumber.trim()}`
    });

    setShowSubmitModal(false);
    resetForm();
  };

  const handleApprove = async () => {
    if (!selectedReturn) return;
    await db.returns.update(selectedReturn.id, {
      status: 'approved',
      processedByEmployeeId: user.id,
      processedDate: nowIso(),
      processingNotes: processingNotes.trim()
    });
    await logActivity({
      action: 'UPDATE',
      entityType: 'return',
      entityId: selectedReturn.id,
      performedByEmployeeId: user.id,
      details: `Return approved: ${selectedReturn.rrspNumber}`
    });
    setSelectedReturn(null);
    setProcessingNotes('');
  };

  const handleReject = async (returnItem: ReturnRecord) => {
    if (!canProcess) return;
    const notes = window.prompt('Add rejection notes (optional):') || '';
    await db.returns.update(returnItem.id, {
      status: 'rejected',
      processedByEmployeeId: user.id,
      processedDate: nowIso(),
      processingNotes: notes.trim()
    });
    await logActivity({
      action: 'UPDATE',
      entityType: 'return',
      entityId: returnItem.id,
      performedByEmployeeId: user.id,
      details: `Return rejected: ${returnItem.rrspNumber}`
    });
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Returns Management (RRSP)</h1>
            <p className="text-gray-600">
              {user.role === 'employee'
                ? 'Submit and track your return requests'
                : 'Review and process return requests'}
            </p>
          </div>
          {canSubmit && (
            <button
              onClick={() => {
                resetForm();
                setShowSubmitModal(true);
              }}
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
            onChange={(e) => setFilterStatus(e.target.value as ReturnStatus | 'all')}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {filteredReturns.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-600">
            No return records available.
          </div>
        )}
        {filteredReturns.map((returnItem) => {
          const statusBadge = getStatusBadge(returnItem.status);
          const StatusIcon = statusBadge.icon;
          const product = productMap.get(returnItem.productId);
          const returnedBy = employeeMap.get(returnItem.returnedByEmployeeId);
          const receivers = returnItem.receivedByEntries || [];
          const conditionLabel =
            conditionOptions.find((option) => option.value === returnItem.condition)?.label || returnItem.condition;
          const processedBy = returnItem.processedByEmployeeId
            ? employeeMap.get(returnItem.processedByEmployeeId)
            : null;

          return (
            <div key={returnItem.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <RotateCcw className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{product?.article || 'Unknown product'}</h3>
                      <p className="text-sm text-gray-600">RRSP No: {returnItem.rrspNumber}</p>
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
                  <p className="text-sm font-medium text-gray-900">{formatDate(returnItem.returnDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Quantity</p>
                  <p className="text-sm font-medium text-gray-900">{returnItem.quantity} units</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Condition</p>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConditionColor(returnItem.condition)}`}>
                    {conditionLabel}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-600 mb-1">Returned By</p>
                  <p className="text-sm font-medium text-gray-900">{returnedBy?.fullName || 'Unknown'}</p>
                  <p className="text-xs text-gray-500 capitalize">{returnItem.returnedByPosition}</p>
                </div>
              </div>

              {returnItem.remarks && (
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-1">Remarks</p>
                  <p className="text-sm text-gray-900">{returnItem.remarks}</p>
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-sm font-medium text-gray-900 mb-3">Receiver Information</p>
                {receivers.map((receiver, index) => {
                  const receiverEmployee = employeeMap.get(receiver.employeeId);
                  return (
                    <div key={`${receiver.employeeId}-${index}`} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2 last:mb-0">
                      <div>
                        <p className="text-xs text-gray-600">Name</p>
                        <p className="text-sm font-medium text-gray-900">{receiverEmployee?.fullName || 'Unknown'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Position</p>
                        <p className="text-sm text-gray-900 capitalize">{receiver.position}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Received Date</p>
                        <p className="text-sm text-gray-900">{formatDate(receiver.receivedDate)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Location</p>
                        <p className="text-sm text-gray-900">{receiver.location}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {returnItem.processedByEmployeeId && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Processed By</p>
                      <p className="text-sm font-medium text-gray-900">{processedBy?.fullName || 'Unknown'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Processed Date</p>
                      <p className="text-sm font-medium text-gray-900">{returnItem.processedDate ? formatDate(returnItem.processedDate) : ''}</p>
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
                      setProcessingNotes('');
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

      {showSubmitModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-bold text-gray-900">Submit Return Request (RRSP)</h2>
              <button onClick={() => setShowSubmitModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form className="space-y-6" onSubmit={handleSubmitReturn}>
              <div>
                <h3 className="font-medium text-gray-900 mb-4">Return Information</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">RRSP No. *</label>
                      <input
                        type="text"
                        value={formState.rrspNumber}
                        onChange={(e) => setFormState({ ...formState, rrspNumber: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Return Date *</label>
                      <input
                        type="date"
                        value={formState.returnDate}
                        onChange={(e) => setFormState({ ...formState, returnDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Product *</label>
                    <select
                      value={formState.productId}
                      onChange={(e) => setFormState({ ...formState, productId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      required
                    >
                      <option value="">Select product</option>
                      {availableProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.article}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quantity *</label>
                    <input
                      type="number"
                      min="1"
                      value={formState.quantity}
                      onChange={(e) => setFormState({ ...formState, quantity: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Condition *</label>
                    <select
                      value={formState.condition}
                      onChange={(e) => setFormState({ ...formState, condition: e.target.value as ReturnCondition })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      required
                    >
                      <option value="">Select condition</option>
                      {conditionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
                    <textarea
                      rows={3}
                      value={formState.remarks}
                      onChange={(e) => setFormState({ ...formState, remarks: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h3 className="font-medium text-gray-900 mb-4">Returned By</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                    <input
                      type="text"
                      value={user.fullName}
                      readOnly
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Position *</label>
                    <select
                      value={user.role}
                      disabled
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

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
                  {formState.receivers.map((receiver, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-gray-700">Receiver {index + 1}</p>
                        {formState.receivers.length > 1 && (
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
                          <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                          <select
                            value={receiver.employeeId}
                            onChange={(e) => handleReceiverChange(index, 'employeeId', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            required
                          >
                            <option value="">Select employee</option>
                            {(employees || []).map((employee) => (
                              <option key={employee.id} value={employee.id}>
                                {employee.fullName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Position *</label>
                          <select
                            value={receiver.position}
                            onChange={(e) => handleReceiverChange(index, 'position', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            required
                          >
                            {roleOptions.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Received Date *</label>
                          <input
                            type="date"
                            value={receiver.receivedDate}
                            onChange={(e) => handleReceiverChange(index, 'receivedDate', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Location *</label>
                          <input
                            type="text"
                            value={receiver.location}
                            onChange={(e) => handleReceiverChange(index, 'location', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setShowSubmitModal(false);
                    resetForm();
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
              <p className="text-sm text-gray-600 mb-2">
                RRSP No: <span className="font-medium text-gray-900">{selectedReturn.rrspNumber}</span>
              </p>
              <p className="text-sm text-gray-600 mb-2">
                Product: <span className="font-medium text-gray-900">{productMap.get(selectedReturn.productId)?.article || 'Unknown'}</span>
              </p>
              <p className="text-sm text-gray-600 mb-2">
                Quantity: <span className="font-medium text-gray-900">{selectedReturn.quantity} units</span>
              </p>
              <p className="text-sm text-gray-600">
                Condition:{' '}
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getConditionColor(selectedReturn.condition)}`}>
                  {conditionOptions.find((option) => option.value === selectedReturn.condition)?.label || selectedReturn.condition}
                </span>
              </p>
            </div>
            <form className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Processing Notes</label>
                <textarea
                  rows={3}
                  value={processingNotes}
                  onChange={(e) => setProcessingNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  placeholder="Add notes about the approval..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setSelectedReturn(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApprove}
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
