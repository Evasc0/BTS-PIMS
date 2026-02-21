
import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Plus, Search, Check, X, Clock, AlertCircle, UserPlus } from 'lucide-react';
import { useLiveQuery } from '../lib/useLiveQuery';
import type { Employee, EmployeeRole, Product, ReturnCondition, ReturnRecord, ReturnStatus } from '../lib/types';
import { db } from '../lib/db';
import { createId, formatDate, nowIso } from '../lib/utils';
import { logActivity } from '../lib/activity';

interface ReturnsPageProps {
  user: Employee;
}

interface ReceiverFormState {
  receiverName: string;
  position: string;
  receivedDate: string;
  location: string;
}

interface ReturnFormState {
  rrspNumber: string;
  productId: string;
  selectedProductIds: string[];
  returnDate: string;
  condition: ReturnCondition | '';
  remarks: string;
  receivers: ReceiverFormState[];
}

const emptyReceiver: ReceiverFormState = {
  receiverName: '',
  position: '',
  receivedDate: '',
  location: ''
};

const emptyReturnForm: ReturnFormState = {
  rrspNumber: '',
  productId: '',
  selectedProductIds: [],
  returnDate: '',
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

const roleOptions: EmployeeRole[] = ['employee', 'system_admin'];

export function ReturnsPage({ user }: ReturnsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState<ReturnRecord | null>(null);
  const [filterStatus, setFilterStatus] = useState<ReturnStatus | 'all'>('all');
  const [filterSubmittedBy, setFilterSubmittedBy] = useState<'all' | EmployeeRole>('all');
  const [formState, setFormState] = useState<ReturnFormState>(emptyReturnForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [processingNotes, setProcessingNotes] = useState('');
  const [processingAction, setProcessingAction] = useState<'approve' | 'reject'>('approve');
  const [submitSyncMessage, setSubmitSyncMessage] = useState<string | null>(null);
  const [propertySearch, setPropertySearch] = useState('');
  const [debouncedPropertySearch, setDebouncedPropertySearch] = useState('');

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
  const isAdmin = user.role === 'system_admin';
  const isEmployee = user.role === 'employee';
  const canProcess = user.role === 'system_admin';

  const adminEmployees = useMemo(
    () => (employees || []).filter((employee) => employee.role === 'system_admin' && employee.status === 'active'),
    [employees]
  );

  const employeesByName = useMemo(() => {
    const map = new Map<string, Employee>();
    (employees || []).forEach((employee) => {
      const key = employee.fullName.trim().toLowerCase();
      if (key) map.set(key, employee);
    });
    return map;
  }, [employees]);

  const availableProducts = useMemo(() => {
    if (isEmployee) {
      return (products || []).filter((product) => product.assignedToEmployeeId === user.id);
    }
    return products || [];
  }, [products, isEmployee, user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedPropertySearch(propertySearch.trim().toLowerCase());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [propertySearch]);

  const selectedAdminProducts = useMemo(() => {
    if (!isAdmin) return [] as Product[];
    return formState.selectedProductIds
      .map((id) => productMap.get(id))
      .filter((product): product is Product => Boolean(product));
  }, [isAdmin, formState.selectedProductIds, productMap]);

  const searchableAdminProducts = useMemo(() => {
    if (!isAdmin) return [] as Product[];
    const selected = new Set(formState.selectedProductIds);
    return (products || [])
      .filter((product) => !selected.has(product.id))
      .filter((product) => {
        if (!debouncedPropertySearch) return true;
        return (
          product.propertyNumber.toLowerCase().includes(debouncedPropertySearch) ||
          product.article.toLowerCase().includes(debouncedPropertySearch) ||
          product.description.toLowerCase().includes(debouncedPropertySearch)
        );
      })
      .sort((a, b) => a.propertyNumber.localeCompare(b.propertyNumber))
      .slice(0, 50);
  }, [isAdmin, products, formState.selectedProductIds, debouncedPropertySearch]);

  const filteredReturns = useMemo(() => {
    return (returns || []).filter((ret) => {
      if (user.role === 'employee' && ret.returnedByEmployeeId !== user.id) {
        return false;
      }
      if (filterStatus !== 'all' && ret.status !== filterStatus) return false;
      if (filterSubmittedBy !== 'all' && ret.returnedByPosition !== filterSubmittedBy) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.trim().toLowerCase();
      const productName = productMap.get(ret.productId)?.article?.toLowerCase() || '';
      return productName.includes(term) || ret.rrspNumber.toLowerCase().includes(term);
    });
  }, [returns, filterStatus, filterSubmittedBy, searchTerm, user, productMap]);

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
    const defaultAdmin = adminEmployees[0];
    setFormState({
      ...emptyReturnForm,
      productId: isEmployee && availableProducts.length === 1 ? availableProducts[0].id : '',
      receivers: [
        {
          receiverName: isEmployee ? defaultAdmin?.fullName || '' : '',
          position: isEmployee ? 'system_admin' : '',
          receivedDate: '',
          location: ''
        }
      ]
    });
    setFormError(null);
    setPropertySearch('');
    setDebouncedPropertySearch('');
  };

  const addSelectedAdminProperty = (productId: string) => {
    setFormState((prev) => {
      if (prev.selectedProductIds.includes(productId)) return prev;
      return { ...prev, selectedProductIds: [productId, ...prev.selectedProductIds] };
    });
  };

  const removeSelectedAdminProperty = (productId: string) => {
    setFormState((prev) => ({
      ...prev,
      selectedProductIds: prev.selectedProductIds.filter((id) => id !== productId)
    }));
  };

  const addReceiver = () => {
    if (isEmployee) return;
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
      current[field] = value;
      updated[index] = current;
      return { ...prev, receivers: updated };
    });
  };

  const serializeReturnAudit = (input: {
    action: 'submitted' | 'approved' | 'rejected';
    returnId: string;
    rrspNumber: string;
    productId: string;
    productNumber?: string;
    submittedBy: string;
    approvedBy?: string;
    rejectedBy?: string;
    quantity: number;
    quantityBefore: number;
    quantityAfter: number;
    status: ReturnStatus;
    note?: string;
  }) =>
    JSON.stringify({
      action: input.action,
      return_id: input.returnId,
      rrsp_number: input.rrspNumber,
      product_id: input.productId,
      property_number: input.productNumber || null,
      submitted_by: input.submittedBy,
      approved_by: input.approvedBy || null,
      rejected_by: input.rejectedBy || null,
      status: input.status,
      quantity: input.quantity,
      quantity_before: input.quantityBefore,
      quantity_after: input.quantityAfter,
      timestamp: nowIso(),
      note: input.note || null
    });

  const autoPushEmployeeSubmission = async (): Promise<string> => {
    if (user.role !== 'employee' || !window.api?.sync) return '';

    if (!navigator.onLine) {
      return 'Return submitted locally. It will auto-push when internet becomes available.';
    }

    try {
      let status = await window.api.sync.getStatus(user.id);
      if (!status.configured) {
        return 'Return submitted locally. Supabase sync is not configured.';
      }

      if (status.mode !== 'online') {
        status = await window.api.sync.setMode(user.id, true);
      }

      if (status.fullSyncRequired) {
        return status.fullSyncReason || 'Return submitted locally. Full sync is required before online sync can continue.';
      }

      const result = await window.api.sync.push(user.id);
      if (result.status === 'synced') {
        return `Return submitted and pushed (${result.pushedCount} change(s)).`;
      }
      if (result.status === 'idle') {
        return 'Return submitted. No pending local changes were found to push.';
      }
      if (result.status === 'offline') {
        return 'Return submitted locally. Sync is offline and will push when online mode is enabled.';
      }
      return `Return submitted locally. ${result.error || 'Automatic push will retry when possible.'}`;
    } catch (error: any) {
      return `Return submitted locally. ${error?.message || 'Automatic push will retry when possible.'}`;
    }
  };

  const autoPushAdminReturnUpdates = async (): Promise<string | null> => {
    if (!isAdmin || !window.api?.sync || !navigator.onLine) return null;

    try {
      let status = await window.api.sync.getStatus(user.id);
      if (!status.configured) return null;

      if (status.mode !== 'online') {
        status = await window.api.sync.setMode(user.id, true);
      }

      if (status.fullSyncRequired) {
        return status.fullSyncReason || 'Full sync is required before return status updates can be pushed.';
      }

      const localChanges = await window.api.sync.viewLocalChanges(user.id);
      const returnOutboxIds = (localChanges?.changes || [])
        .filter((change: any) => change.entityType === 'returns' || change.entityType === 'products')
        .map((change: any) => Number(change.outboxId))
        .filter((id: number) => Number.isFinite(id));

      if (!returnOutboxIds.length) return null;

      const result = await window.api.sync.push(user.id, { outboxIds: returnOutboxIds });
      if (result.status === 'synced') {
        try {
          await window.api.sync.pull(user.id, 'skip');
          if (window.api.sync.autoPullEmployeeSubmissions) {
            await window.api.sync.autoPullEmployeeSubmissions(user.id);
          }
        } catch {
          // Push already succeeded; pull follow-up is best effort.
        }
        return `Synced ${result.pushedCount} return/inventory update(s).`;
      }

      if (result.status === 'error') {
        return result.error || 'Failed to push return status updates.';
      }

      return null;
    } catch (error: any) {
      return error?.message || 'Failed to push return status updates.';
    }
  };

  const handleSubmitReturn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    setSubmitSyncMessage(null);

    if (!formState.returnDate || !formState.condition) {
      setFormError('Return date and condition are required.');
      return;
    }

    if (isAdmin && !formState.rrspNumber.trim()) {
      setFormError('RRSP number is required for system admin submissions.');
      return;
    }

    if (isEmployee && !formState.productId) {
      setFormError('Select an assigned inventory item to return.');
      return;
    }

    if (isAdmin && formState.selectedProductIds.length === 0) {
      setFormError('Select at least one inventory number.');
      return;
    }

    const validReceivers = formState.receivers.filter(
      (receiver) => receiver.receiverName.trim() && receiver.position.trim() && receiver.receivedDate && receiver.location.trim()
    );
    if (validReceivers.length === 0) {
      setFormError('Receiver name, position, date, and location are required.');
      return;
    }

    if (isEmployee && adminEmployees.length === 0) {
      setFormError('No active system admin account found for receiver validation.');
      return;
    }

    const receiverEntries = validReceivers.map((receiver) => {
      const receiverName = receiver.receiverName.trim();
      const matchedEmployee = employeesByName.get(receiverName.toLowerCase());
      return {
        employeeId: matchedEmployee?.id,
        receiverName,
        position: receiver.position.trim(),
        receivedDate: receiver.receivedDate,
        location: receiver.location.trim()
      };
    });

    if (isEmployee) {
      const primaryAdmin = adminEmployees[0];
      if (!primaryAdmin) {
        setFormError('No active system admin account found for receiver routing.');
        return;
      }

      const firstReceiver = receiverEntries[0];
      if (!firstReceiver || !firstReceiver.receivedDate || !firstReceiver.location) {
        setFormError('Received date and location are required.');
        return;
      }

      receiverEntries.splice(0, receiverEntries.length, {
        employeeId: primaryAdmin.id,
        receiverName: primaryAdmin.fullName,
        position: 'system_admin',
        receivedDate: firstReceiver.receivedDate,
        location: firstReceiver.location
      });
    }

    const primaryReceiver = receiverEntries[0];
    const rrspNumber = isAdmin ? formState.rrspNumber.trim() : '';

    const targetProductIds = isAdmin ? formState.selectedProductIds : [formState.productId];
    const targetProducts = targetProductIds
      .map((productId) => productMap.get(productId))
      .filter((product): product is Product => Boolean(product));

    if (!targetProducts.length) {
      setFormError('Selected properties were not found locally.');
      return;
    }

    if (isEmployee) {
      const invalidSelection = targetProducts.some((product) => product.assignedToEmployeeId !== user.id);
      if (invalidSelection) {
        setFormError('You can only return properties currently assigned to your account.');
        return;
      }
      const alreadyPending = targetProducts.some((product) => product.status === 'pending_return');
      if (alreadyPending) {
        setFormError('One or more selected inventory items already have a pending return request.');
        return;
      }
    }

    for (const product of targetProducts) {
      const returnId = createId();
      const returnQuantity = 1;
      const quantityBefore = product.onHandPerCount;
      const nextStatus: ReturnStatus = isAdmin ? 'approved' : 'pending';

      await db.returns.add({
        id: returnId,
        rrspNumber,
        productId: product.id,
        returnDate: formState.returnDate,
        quantity: returnQuantity,
        condition: formState.condition as ReturnCondition,
        remarks: formState.remarks.trim(),
        returnedByEmployeeId: user.id,
        returnedByPosition: user.role,
        receivedDate: primaryReceiver.receivedDate,
        location: primaryReceiver.location,
        receivedByEmployeeIds: receiverEntries.map((entry) => entry.employeeId).filter((value): value is string => Boolean(value)),
        receivedByEntries: receiverEntries,
        createdAt: nowIso(),
        status: nextStatus,
        processedByEmployeeId: isAdmin ? user.id : undefined,
        processedDate: isAdmin ? nowIso() : undefined,
        processingNotes: isAdmin ? 'Auto-approved system admin return.' : undefined
      });

      if (isAdmin) {
        await db.products.update(product.id, {
          assignedToEmployeeId: undefined,
          assignmentStatus: 'returned',
          status: 'returned'
        });
      } else {
        await db.products.update(product.id, {
          assignedToEmployeeId: undefined,
          assignmentStatus: 'returned',
          status: 'pending_return'
        });
      }

      await logActivity({
        action: 'SUBMIT',
        entityType: 'return',
        entityId: returnId,
        performedByEmployeeId: user.id,
        details: serializeReturnAudit({
          action: 'submitted',
          returnId,
          rrspNumber,
          productId: product.id,
          productNumber: product.propertyNumber,
          submittedBy: user.id,
          approvedBy: isAdmin ? user.id : undefined,
          quantity: returnQuantity,
          quantityBefore,
          quantityAfter: quantityBefore,
          status: nextStatus,
          note: isAdmin ? 'Auto-approved system admin return.' : 'Pending system admin approval.'
        })
      });
    }

    if (user.role === 'employee') {
      const message = await autoPushEmployeeSubmission();
      setSubmitSyncMessage(message);
    } else if (isAdmin) {
      const adminSyncMessage = await autoPushAdminReturnUpdates();
      if (adminSyncMessage) setSubmitSyncMessage(adminSyncMessage);
    }

    setShowSubmitModal(false);
    resetForm();
  };

  const handleApprove = async () => {
    if (!selectedReturn) return;
    if (selectedReturn.status !== 'pending') {
      setSelectedReturn(null);
      setProcessingNotes('');
      return;
    }

    const product = productMap.get(selectedReturn.productId);
    const quantity = Math.max(1, Number(selectedReturn.quantity || 1));
    const quantityBefore = Number(product?.onHandPerCount || 0);
    const quantityAfter = quantityBefore;

    try {
      await db.returns.process({
        id: selectedReturn.id,
        adminUserId: user.id,
        decision: 'approve',
        reason: processingNotes.trim() || undefined
      });

      await logActivity({
        action: 'UPDATE',
        entityType: 'return',
        entityId: selectedReturn.id,
        performedByEmployeeId: user.id,
        details: serializeReturnAudit({
          action: 'approved',
          returnId: selectedReturn.id,
          rrspNumber: selectedReturn.rrspNumber,
          productId: selectedReturn.productId,
          productNumber: product?.propertyNumber,
          submittedBy: selectedReturn.returnedByEmployeeId,
          approvedBy: user.id,
          quantity,
          quantityBefore,
          quantityAfter,
          status: 'approved',
          note: processingNotes.trim()
        })
      });

      const adminSyncMessage = await autoPushAdminReturnUpdates();
      if (adminSyncMessage) setSubmitSyncMessage(adminSyncMessage);
      setSelectedReturn(null);
      setProcessingNotes('');
      setProcessingAction('approve');
      setFormError(null);
    } catch (error: any) {
      setFormError(error?.message || 'Failed to approve return.');
    }
  };

  const handleReject = async () => {
    if (!canProcess) return;
    if (!selectedReturn) return;
    if (selectedReturn.status !== 'pending') {
      setSelectedReturn(null);
      setProcessingNotes('');
      setProcessingAction('approve');
      return;
    }

    const rejectionNote = processingNotes.trim() || 'Your return request was rejected. Please review remarks.';
    const product = productMap.get(selectedReturn.productId);
    const quantity = Math.max(1, Number(selectedReturn.quantity || 1));
    const quantityBefore = Number(product?.onHandPerCount || 0);

    try {
      await db.returns.process({
        id: selectedReturn.id,
        adminUserId: user.id,
        decision: 'reject',
        reason: rejectionNote
      });

      await logActivity({
        action: 'UPDATE',
        entityType: 'return',
        entityId: selectedReturn.id,
        performedByEmployeeId: user.id,
        details: serializeReturnAudit({
          action: 'rejected',
          returnId: selectedReturn.id,
          rrspNumber: selectedReturn.rrspNumber,
          productId: selectedReturn.productId,
          productNumber: product?.propertyNumber,
          submittedBy: selectedReturn.returnedByEmployeeId,
          rejectedBy: user.id,
          quantity,
          quantityBefore,
          quantityAfter: quantityBefore,
          status: 'rejected',
          note: rejectionNote
        })
      });
      const adminSyncMessage = await autoPushAdminReturnUpdates();
      if (adminSyncMessage) setSubmitSyncMessage(adminSyncMessage);
      setSelectedReturn(null);
      setProcessingNotes('');
      setProcessingAction('approve');
      setFormError(null);
    } catch (error: any) {
      setFormError(error?.message || 'Failed to reject return.');
    }
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

        {submitSyncMessage && (
          <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
            <p className="text-sm text-indigo-800">{submitSyncMessage}</p>
          </div>
        )}

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
          {isAdmin && (
            <select
              value={filterSubmittedBy}
              onChange={(e) => setFilterSubmittedBy(e.target.value as 'all' | EmployeeRole)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            >
              <option value="all">All Submitters</option>
              <option value="employee">Employee</option>
              <option value="system_admin">System Admin</option>
            </select>
          )}
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
                      <p className="text-sm text-gray-600">
                        RRSP No:{' '}
                        {returnItem.returnedByPosition === 'system_admin'
                          ? returnItem.rrspNumber || 'N/A'
                          : 'N/A (employee return)'}
                      </p>
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
                  const receiverEmployee = receiver.employeeId ? employeeMap.get(receiver.employeeId) : undefined;
                  const receiverName = receiver.receiverName || receiverEmployee?.fullName || 'Unknown';
                  return (
                    <div key={`${receiver.employeeId || 'ext'}-${index}-${receiverName}`} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2 last:mb-0">
                      <div>
                        <p className="text-xs text-gray-600">Name</p>
                        <p className="text-sm font-medium text-gray-900">{receiverName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Position</p>
                        <p className="text-sm text-gray-900">{receiver.position}</p>
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
                      setProcessingAction('approve');
                    }}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      setSelectedReturn(returnItem);
                      setProcessingNotes('');
                      setProcessingAction('reject');
                    }}
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
                    {isAdmin && (
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
                    )}
                    <div className={isAdmin ? '' : 'col-span-2'}>
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

                  {isEmployee && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Assigned Inventory Item *</label>
                      <select
                        value={formState.productId}
                        onChange={(e) => setFormState({ ...formState, productId: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                        required
                      >
                        <option value="">Select assigned inventory item</option>
                        {availableProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.propertyNumber} - {product.article}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {isAdmin && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Search Inventory Number *</label>
                      <input
                        type="text"
                        value={propertySearch}
                        onChange={(e) => setPropertySearch(e.target.value)}
                        placeholder="Type inventory number, article, or description..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      />

                      <div className="mt-3 border border-gray-200 rounded-lg max-h-72 overflow-y-auto divide-y divide-gray-100">
                        {selectedAdminProducts.length > 0 && (
                          <div>
                            <p className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50 uppercase tracking-wide">Selected</p>
                            {selectedAdminProducts.map((product) => (
                              <div key={`selected-${product.id}`} className="px-3 py-2 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{product.propertyNumber}</p>
                                  <p className="text-xs text-gray-600">{product.article}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeSelectedAdminProperty(product.id)}
                                  className="text-red-600 hover:text-red-700 text-xs"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div>
                          <p className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50 uppercase tracking-wide">Search Results</p>
                          {searchableAdminProducts.length === 0 ? (
                            <p className="px-3 py-3 text-sm text-gray-500">No inventory items found.</p>
                          ) : (
                            searchableAdminProducts.map((product) => (
                              <button
                                key={`result-${product.id}`}
                                type="button"
                                onClick={() => addSelectedAdminProperty(product.id)}
                                className="w-full px-3 py-2 text-left hover:bg-indigo-50 transition"
                              >
                                <p className="text-sm font-medium text-gray-900">{product.propertyNumber}</p>
                                <p className="text-xs text-gray-600">
                                  {product.article} | {product.description}
                                </p>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

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
                  {!isEmployee && (
                    <button
                      type="button"
                      onClick={addReceiver}
                      className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition flex items-center gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      Add Another Receiver
                    </button>
                  )}
                </div>
                {isEmployee && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                    Employee returns can only be received by a system admin account.
                  </p>
                )}
                <div className="space-y-4">
                  {formState.receivers.map((receiver, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-gray-700">Receiver {index + 1}</p>
                        {!isEmployee && formState.receivers.length > 1 && (
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
                          <input
                            type="text"
                            value={receiver.receiverName}
                            onChange={(e) => handleReceiverChange(index, 'receiverName', e.target.value)}
                            placeholder={isEmployee ? 'System admin' : 'Type receiver name'}
                            readOnly={isEmployee}
                            className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none ${
                              isEmployee ? 'bg-gray-50 text-gray-600' : ''
                            }`}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Position *</label>
                          <input
                            type="text"
                            value={receiver.position}
                            onChange={(e) => handleReceiverChange(index, 'position', e.target.value)}
                            placeholder={isEmployee ? 'system_admin' : 'Type receiver position'}
                            readOnly={isEmployee}
                            className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none ${
                              isEmployee ? 'bg-gray-50 text-gray-600' : ''
                            }`}
                            required
                          />
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
              <h2 className="font-bold text-gray-900">{processingAction === 'approve' ? 'Approve Return' : 'Reject Return'}</h2>
              <button
                onClick={() => {
                  setSelectedReturn(null);
                  setProcessingNotes('');
                  setProcessingAction('approve');
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mb-4">
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
                  placeholder={
                    processingAction === 'approve'
                      ? 'Add notes about the approval...'
                      : 'Add notes about the rejection (optional)...'
                  }
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReturn(null);
                    setProcessingNotes('');
                    setProcessingAction('approve');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={processingAction === 'approve' ? handleApprove : handleReject}
                  className={`px-4 py-2 text-white rounded-lg transition ${
                    processingAction === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {processingAction === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
