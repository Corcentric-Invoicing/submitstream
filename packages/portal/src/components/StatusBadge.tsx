import type { InvoiceStatus } from '../../../../shared/src/types/invoice';

const statusConfig: Record<InvoiceStatus, { label: string; bg: string; text: string; dot: string }> = {
  processing: { label: 'Processing', bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400' },
  processed: { label: 'Processed', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  pending: { label: 'Pending', bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  rejected: { label: 'Rejected', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

export default function StatusBadge({ status }: { status: InvoiceStatus }) {
  const config = statusConfig[status] || statusConfig.processing;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.bg} ${config.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
