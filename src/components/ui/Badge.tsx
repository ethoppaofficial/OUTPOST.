/**
 * @file Badge.tsx
 * @module components/ui/Badge
 * @description Standardized semantic status badge components for persona verification, reservations, and receipts.
 *
 * Component Variations:
 * - `Badge`: Base pill tag with color variants (`success`, `warning`, `danger`, `neutral`, `info`).
 * - `VerificationBadge`: Renders academic, landlord, or property verification tags with shield icons.
 * - `ReservationStatusBadge`: Visualizes 7-day hold states (`pending_payment`, `payment_submitted`, `confirmed`, `expired`, `cancelled`).
 * - `ReceiptStatusBadge`: Maps bank transfer review states (`pending_review`, `approved`, `rejected`).
 */

import React from 'react';
import { ShieldCheck, CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { ReservationStatus, ReceiptStatus, PropertyVerificationStatus, LandlordVerificationStatus } from '../../domain/types';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Primitive pill badge with semantic color schemes.
 */
export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  icon,
  className = '',
}) => {
  const variantStyles = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
    danger: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
    neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    info: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800/60',
  }[variant];

  const sizeStyles = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-medium';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border tracking-wide whitespace-nowrap ${variantStyles} ${sizeStyles} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
};

export const VerificationBadge: React.FC<{
  type: 'student' | 'landlord' | 'property';
  status: boolean | PropertyVerificationStatus | LandlordVerificationStatus;
  showText?: boolean;
}> = ({ type, status, showText = true }) => {
  const isApproved = status === true || status === 'approved';
  const isPending = status === 'pending';

  if (isApproved) {
    return (
      <Badge
        variant="success"
        icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
      >
        {showText ? (type === 'student' ? 'Verified Student' : type === 'landlord' ? 'Verified Landlord' : 'Verified Property') : 'Verified'}
      </Badge>
    );
  }

  if (isPending) {
    return (
      <Badge
        variant="warning"
        icon={<Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />}
      >
        {showText ? 'Verification Pending' : 'Pending'}
      </Badge>
    );
  }

  return (
    <Badge
      variant="neutral"
      icon={<AlertTriangle className="w-3.5 h-3.5 text-slate-400" />}
    >
      {showText ? 'Unverified' : 'Unverified'}
    </Badge>
  );
};

export const ReservationStatusBadge: React.FC<{ status: ReservationStatus }> = ({ status }) => {
  switch (status) {
    case 'confirmed':
      return (
        <Badge variant="success" icon={<CheckCircle2 className="w-3.5 h-3.5" />}>
          Confirmed & Reserved
        </Badge>
      );
    case 'receipt_submitted':
      return (
        <Badge variant="info" icon={<Clock className="w-3.5 h-3.5" />}>
          Receipt Under Review
        </Badge>
      );
    case 'pending_payment':
      return (
        <Badge variant="warning" icon={<Clock className="w-3.5 h-3.5" />}>
          Hold Active (Payment Due)
        </Badge>
      );
    case 'rejected':
      return (
        <Badge variant="danger" icon={<XCircle className="w-3.5 h-3.5" />}>
          Rejected
        </Badge>
      );
    case 'expired':
      return (
        <Badge variant="danger" icon={<XCircle className="w-3.5 h-3.5" />}>
          Expired (7 Days Reached)
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge variant="neutral" icon={<XCircle className="w-3.5 h-3.5" />}>
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
};

export const ReceiptStatusBadge: React.FC<{ status: ReceiptStatus }> = ({ status }) => {
  switch (status) {
    case 'approved':
      return <Badge variant="success" icon={<CheckCircle2 className="w-3.5 h-3.5" />}>Payment Verified</Badge>;
    case 'pending_review':
      return <Badge variant="warning" icon={<Clock className="w-3.5 h-3.5" />}>Pending Landlord Check</Badge>;
    case 'rejected':
      return <Badge variant="danger" icon={<XCircle className="w-3.5 h-3.5" />}>Receipt Rejected</Badge>;
    default:
      return <Badge variant="neutral">Not Uploaded</Badge>;
  }
};
