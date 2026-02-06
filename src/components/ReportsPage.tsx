import React, { useState } from 'react';
import { User } from '../App';
import { FileText, Download, Calendar, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';

interface ReportsPageProps {
  user: User;
}

interface InventoryItem {
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
}

interface ReturnItemData {
  id: string;
  product: {
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
  };
  returnInfo: {
    rrspNo: string;
    returnDate: string;
    quantity: number;
    remarks: string;
    condition: 'Functional' | 'Destroyed' | 'For Disposal' | 'Need Repair' | 'Damaged';
    returnedBy: {
      name: string;
      position: string;
    };
    receivedDate: string;
    location: string;
  };
}

export function ReportsPage({ user }: ReportsPageProps) {
  const [reportType, setReportType] = useState('inventory');
  const [dateRange, setDateRange] = useState('month');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Mock inventory data
  const inventoryItems: InventoryItem[] = [
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
      assignedTo: 'Mike Employee'
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
      assignedTo: 'John Admin'
    },
    {
      id: '3',
      value: 'LV',
      article: 'USB-C Cable',
      description: 'Standard USB-C charging cable',
      date: '2024-01-25',
      parControlNumber: 'PAR-2024-003',
      propertyNumber: 'PROP-2024-003',
      unit: 'pcs',
      unitValue: 15,
      balancePerCard: 50,
      onHandPerCount: 48,
      total: 720,
      remarks: 'Low stock warning',
      assignedTo: 'Emma Worker'
    }
  ];

  // Mock returns data
  const returnItems: ReturnItemData[] = [
    {
      id: '1',
      product: {
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
        remarks: 'In good condition'
      },
      returnInfo: {
        rrspNo: 'RRSP-2024-001',
        returnDate: '2024-02-03',
        quantity: 1,
        remarks: 'Screen not working properly',
        condition: 'Need Repair',
        returnedBy: {
          name: 'Mike Employee',
          position: 'employee'
        },
        receivedDate: '2024-02-03',
        location: 'Main Office'
      }
    },
    {
      id: '2',
      product: {
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
        remarks: 'New stock'
      },
      returnInfo: {
        rrspNo: 'RRSP-2024-002',
        returnDate: '2024-02-02',
        quantity: 2,
        remarks: 'Customer changed preference',
        condition: 'Functional',
        returnedBy: {
          name: 'Emma Worker',
          position: 'employee'
        },
        receivedDate: '2024-02-02',
        location: 'Warehouse A'
      }
    }
  ];

  const canExportData = user.role === 'administrator';

  const handleExport = (format: 'pdf' | 'excel') => {
    console.log(`Exporting ${reportType} report as ${format}`);
  };

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
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

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-gray-900 mb-2">Reports</h1>
            <p className="text-gray-600">View and export system reports</p>
          </div>
          {canExportData && (
            <div className="flex gap-2">
              <button 
                onClick={() => handleExport('pdf')}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition flex items-center gap-2"
              >
                <Download className="w-5 h-5" />
                Export PDF
              </button>
              <button 
                onClick={() => handleExport('excel')}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
              >
                <Download className="w-5 h-5" />
                Export Excel
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <select 
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="inventory">Inventory Report</option>
            <option value="returns">Returns Report</option>
          </select>
          <select 
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="week">Last Week</option>
            <option value="month">Last Month</option>
            <option value="quarter">Last Quarter</option>
            <option value="year">Last Year</option>
          </select>
          <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Custom Range
          </button>
        </div>
      </div>

      {/* Inventory Report */}
      {reportType === 'inventory' && (
        <div className="space-y-4">
          {inventoryItems.map((item) => {
            const isExpanded = expandedItems.has(item.id);
            return (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Article:</p>
                      <p className="font-medium text-gray-900">{item.article}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Description:</p>
                      <p className="text-sm text-gray-900">{item.description}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Date:</p>
                      <p className="text-sm text-gray-900">{new Date(item.date).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">PAR Control Number:</p>
                      <p className="text-sm text-gray-900">{item.parControlNumber}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Property Number:</p>
                      <p className="text-sm text-gray-900">{item.propertyNumber}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Unit:</p>
                      <p className="text-sm text-gray-900">{item.unit}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Unit Value:</p>
                      <p className="text-sm text-gray-900">₱{item.unitValue.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Balance per Card:</p>
                      <p className="text-sm text-gray-900">{item.balancePerCard}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">On Hand per Count:</p>
                      <p className="text-sm text-gray-900">{item.onHandPerCount}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Total:</p>
                      <p className="font-medium text-gray-900">₱{item.total.toLocaleString()}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-sm text-gray-600 mb-1">Remarks:</p>
                      <p className="text-sm text-gray-900">{item.remarks}</p>
                    </div>
                  </div>

                  {/* Expandable Section */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Value:</p>
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getValueColor(item.value)}`}>
                            {item.value} - {item.value === 'HV' ? 'High Value' : item.value === 'MV' ? 'Mid Value' : 'Low Value'}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Assigned To:</p>
                          <p className="text-sm font-medium text-gray-900">{item.assignedTo}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => toggleExpand(item.id)}
                  className="w-full px-6 py-3 bg-gray-50 hover:bg-gray-100 transition flex items-center justify-center gap-2 text-sm font-medium text-gray-700 border-t border-gray-200"
                >
                  {isExpanded ? (
                    <>
                      <EyeOff className="w-4 h-4" />
                      Hide Details
                      <ChevronUp className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      Show More Details
                      <ChevronDown className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Returns Report */}
      {reportType === 'returns' && (
        <div className="space-y-4">
          {returnItems.map((item) => {
            const isExpanded = expandedItems.has(item.id);
            return (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-6">
                  <h3 className="font-medium text-gray-900 mb-4">Property Product Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Article:</p>
                      <p className="font-medium text-gray-900">{item.product.article}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Description:</p>
                      <p className="text-sm text-gray-900">{item.product.description}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Date:</p>
                      <p className="text-sm text-gray-900">{new Date(item.product.date).toLocaleDateString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">PAR Control Number:</p>
                      <p className="text-sm text-gray-900">{item.product.parControlNumber}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Property Number:</p>
                      <p className="text-sm text-gray-900">{item.product.propertyNumber}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Unit:</p>
                      <p className="text-sm text-gray-900">{item.product.unit}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Unit Value:</p>
                      <p className="text-sm text-gray-900">₱{item.product.unitValue.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Balance per Card:</p>
                      <p className="text-sm text-gray-900">{item.product.balancePerCard}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">On Hand per Count:</p>
                      <p className="text-sm text-gray-900">{item.product.onHandPerCount}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Total:</p>
                      <p className="font-medium text-gray-900">₱{item.product.total.toLocaleString()}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-sm text-gray-600 mb-1">Remarks:</p>
                      <p className="text-sm text-gray-900">{item.product.remarks}</p>
                    </div>
                  </div>

                  {/* Expandable Return Information Section */}
                  {isExpanded && (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h3 className="font-medium text-gray-900 mb-4">Return Information</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm text-gray-600 mb-1">RRSP No.:</p>
                          <p className="font-medium text-gray-900">{item.returnInfo.rrspNo}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Return Date:</p>
                          <p className="text-sm text-gray-900">{new Date(item.returnInfo.returnDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Quantity:</p>
                          <p className="text-sm text-gray-900">{item.returnInfo.quantity} units</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Condition:</p>
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${getConditionColor(item.returnInfo.condition)}`}>
                            {item.returnInfo.condition}
                          </span>
                        </div>
                        <div className="md:col-span-2">
                          <p className="text-sm text-gray-600 mb-1">Remarks:</p>
                          <p className="text-sm text-gray-900">{item.returnInfo.remarks}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Returned By - Name:</p>
                          <p className="text-sm text-gray-900">{item.returnInfo.returnedBy.name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Position:</p>
                          <p className="text-sm text-gray-900 capitalize">{item.returnInfo.returnedBy.position}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Received Date:</p>
                          <p className="text-sm text-gray-900">{new Date(item.returnInfo.receivedDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 mb-1">Location:</p>
                          <p className="text-sm text-gray-900">{item.returnInfo.location}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => toggleExpand(item.id)}
                  className="w-full px-6 py-3 bg-gray-50 hover:bg-gray-100 transition flex items-center justify-center gap-2 text-sm font-medium text-gray-700 border-t border-gray-200"
                >
                  {isExpanded ? (
                    <>
                      <EyeOff className="w-4 h-4" />
                      Hide Details
                      <ChevronUp className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" />
                      Show More Details
                      <ChevronDown className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
