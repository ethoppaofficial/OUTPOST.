/**
 * @file paymentAccountService.ts
 * @module application/services/paymentAccountService
 * @description Application service managing landlord bank transfer account configuration
 * and scoped retrieval of beneficiary details for eligible student reservations.
 *
 * Security Invariants:
 * - Only authenticated landlords may configure or update their own active payment account.
 * - Account numbers are normalized, validated per Nigerian banking conventions, and never
 *   echoed in logs or error strings.
 * - Students retrieve only preserved invoice snapshots or active beneficiary details scoped
 *   strictly to their own eligible reservation.
 */

import {
  Invoice,
  LandlordPaymentAccount,
  LandlordPaymentAccountInput,
  ReservationPaymentDetails,
} from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import {
  maskAccountNumber,
  validateLandlordPaymentDetails,
} from '../utils/validation';

class PaymentAccountService {
  public getCachedPaymentAccount(landlordId?: string): LandlordPaymentAccount | undefined {
    const id = landlordId || repository.getActiveUserId();
    if (!id) return undefined;
    return repository.getLandlordPaymentAccount(id);
  }

  public async loadMyPaymentAccount(landlordId?: string): Promise<LandlordPaymentAccount | null> {
    const id = landlordId || repository.getActiveUserId();
    if (!id || id === 'anonymous') return null;
    return repository.fetchLandlordPaymentAccountFromSupabase(id);
  }

  public async saveMyPaymentAccount(
    landlordId: string,
    input: LandlordPaymentAccountInput
  ): Promise<{ success: boolean; account?: LandlordPaymentAccount; error?: string }> {
    const validation = validateLandlordPaymentDetails(input);
    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error || 'Please check your bank account details.',
      };
    }

    try {
      const saved = await repository.upsertLandlordPaymentAccountPersisted(
        landlordId,
        validation.normalized
      );
      return { success: true, account: saved };
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not save payment account details. Please try again.';
      return { success: false, error: message };
    }
  }

  public async resolvePaymentDetailsForReservation(
    reservationId: string,
    invoice?: Invoice
  ): Promise<ReservationPaymentDetails> {
    if (
      invoice?.bankDetails?.configured &&
      invoice.bankDetails.bankName &&
      invoice.bankDetails.accountNumber
    ) {
      return {
        configured: true,
        source: invoice.bankDetails.source || 'snapshot',
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        accountHolderName: invoice.bankDetails.accountName,
        bankName: invoice.bankDetails.bankName,
        accountNumber: invoice.bankDetails.accountNumber,
        accountType: invoice.bankDetails.accountType ?? null,
        paymentInstructions: invoice.bankDetails.paymentInstructions || null,
        capturedAt: invoice.bankDetails.snapshotCapturedAt,
      };
    }

    const remote = await repository.fetchReservationPaymentDetailsFromSupabase(reservationId);
    return remote || { configured: false, source: 'none' };
  }

  public maskAccountNumber(accountNumber: string | null | undefined): string {
    return maskAccountNumber(accountNumber);
  }
}

export const paymentAccountService = new PaymentAccountService();
