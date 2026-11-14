/**
 * @file reservationService.ts
 * @module application/services/reservationService
 * @description Application service managing student accommodation reservations, invoices, bank transfer receipts, and 7-day hold lifecycle.
 *
 * Core Business & Security Rules:
 * - 7-Day Hold Policy: A student reservation places an atomic hold on a room space for exactly 7 days (`holdExpiresAt`).
 * - External Bank Payment: Students make direct bank transfers to verified landlord accounts (MVP safety model avoiding merchant card custody).
 * - Receipt Review Workflow: Students upload bank transfer receipts with transaction references. The property landlord reviews the receipt.
 *   - 'approved': Reservation transitions to `confirmed`; invoice marked `paid`.
 *   - 'rejected': Requires mandatory rejection reason; releases inventory and returns to `pending_payment`.
 * - Expiration Engine: Idempotent job checks database timestamps against current time and releases held capacity on expired reservations.
 * - Concurrency & Invariants: All inventory modifications delegate to database stored procedures (`create_reservation_atomic`, `review_payment_receipt_atomic`) to prevent double-booking.
 */

import { Reservation, ReservationMode, Invoice, PaymentReceipt } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { invokeEdgeFunction } from '../../infrastructure/supabase/supabaseClient';
import { storageService } from './storageService';

class ReservationService {
  public async loadStudentReservations(studentId?: string): Promise<Reservation[]> {
    const id = studentId || repository.getActiveUserId();
    return repository.fetchStudentReservationsFromSupabase(id);
  }

  public async loadReservationDetail(reservationId: string): Promise<{
    reservation: Reservation;
    invoice?: Invoice;
    receipt?: PaymentReceipt;
  } | null> {
    const bundle = await repository.fetchReservationDetailFromSupabase(reservationId);
    if (!bundle) return null;
    return {
      reservation: bundle.reservation,
      invoice: bundle.invoice ? this.enrichInvoice(bundle.invoice) : undefined,
      receipt: bundle.receipt,
    };
  }

  public async loadInvoiceById(invoiceId: string): Promise<Invoice | null> {
    const inv = await repository.fetchInvoiceByIdFromSupabase(invoiceId);
    return inv ? this.enrichInvoice(inv) : null;
  }

  public async loadLandlordReservations(landlordId?: string): Promise<Reservation[]> {
    const id = landlordId || repository.getActiveUserId();
    return repository.fetchLandlordReservationsFromSupabase(id);
  }

  public async loadLandlordReceipts(landlordId?: string): Promise<PaymentReceipt[]> {
    const id = landlordId || repository.getActiveUserId();
    return repository.fetchLandlordReceiptsFromSupabase(id);
  }

  public getReservationsForStudent(studentId: string): Reservation[] {
    return repository.getReservationsForStudent(studentId);
  }

  public getStudentReservations(studentId?: string): Reservation[] {
    const id = studentId || repository.getActiveUserId();
    return repository.getReservationsForStudent(id);
  }

  public getReservationsForLandlord(landlordId: string): Reservation[] {
    return repository.getReservationsForLandlord(landlordId);
  }

  public getAllReservations(): Reservation[] {
    return repository.getReservations();
  }

  public getReservationById(id: string): Reservation | undefined {
    return repository.getReservationById(id);
  }

  public getInvoiceById(id: string): Invoice | undefined {
    const inv = repository.getInvoiceById(id);
    if (!inv) return undefined;
    return this.enrichInvoice(inv);
  }

  public getInvoiceByReservationId(resId: string): Invoice | undefined {
    const inv = repository.getInvoiceByReservationId(resId);
    if (!inv) return undefined;
    return this.enrichInvoice(inv);
  }

  private enrichInvoice(inv: Invoice): Invoice {
    const student = repository.getStudentProfile(inv.studentId);
    const reservation = repository.getReservationById(inv.reservationId);
    const landlord = reservation ? repository.getLandlordProfile(reservation.landlordId) : undefined;
    const property = reservation ? repository.getPropertyById(reservation.propertyId) : undefined;

    return {
      ...inv,
      registrationNumber: inv.registrationNumber || student?.registrationNumber || '',
      university: inv.university || student?.university || student?.institutionName || 'Higher Institution',
      landlordName: inv.landlordName || landlord?.legalName || 'Verified Property Manager',
      propertyTitle: inv.propertyTitle || property?.title || inv.propertyName,
      totalAmount: inv.totalAmount || inv.amount,
      items: inv.items || [
        {
          description: `${inv.unitName || 'Student Room'} Accommodation Fee (Academic Session)`,
          amount: inv.amount,
        },
      ],
    };
  }

  public getInvoiceByReservation(resId: string): Invoice | undefined {
    return this.getInvoiceByReservationId(resId);
  }

  public getReceiptByReservationId(resId: string): PaymentReceipt | undefined {
    return repository.getReceiptByReservationId(resId);
  }

  public getReceiptForReservation(resId: string): PaymentReceipt | undefined {
    return repository.getReceiptByReservationId(resId);
  }

  public async cancelReservationPersisted(
    reservationId: string,
    reason?: string
  ): Promise<{ success: boolean; message?: string }> {
    return repository.cancelReservationPersisted(reservationId, reason);
  }

  public cancelReservation(reservationId: string, reason?: string): { success: boolean; message?: string } {
    return repository.cancelReservation(reservationId, reason);
  }

  public getReceiptsForLandlord(landlordId: string): PaymentReceipt[] {
    return repository.getPaymentReceiptsForLandlord(landlordId).map((rc) => {
      const res = repository.getReservationById(rc.reservationId);
      const student = repository.getStudentProfile(rc.studentId);
      return {
        ...rc,
        propertyTitle: rc.propertyTitle || rc.propertyName,
        roomName: rc.roomName || res?.unitName || 'Standard Room',
        registrationNumber: rc.registrationNumber || student?.registrationNumber || '',
      };
    });
  }

  public getLandlordReceipts(landlordId?: string): PaymentReceipt[] {
    const id = landlordId || repository.getActiveUserId();
    return this.getReceiptsForLandlord(id);
  }

  public getLandlordReservations(landlordId?: string): Reservation[] {
    const id = landlordId || repository.getActiveUserId();
    return this.getReservationsForLandlord(id);
  }

  public async createReservationPersisted(
    studentId: string,
    propertyId: string,
    unitId: string,
    groupId?: string,
    reservationMode: ReservationMode = 'hold'
  ) {
    return repository.createReservationPersisted(studentId, propertyId, unitId, groupId, reservationMode);
  }

  public createReservation(
    studentId: string,
    propertyId: string,
    unitId: string,
    groupId?: string,
    reservationMode: ReservationMode = 'hold'
  ) {
    return repository.createReservation(studentId, propertyId, unitId, groupId, reservationMode);
  }

  public async submitPaymentReceiptWithStorage(params: {
    reservationId: string;
    file: File | Blob;
    originalFileName: string;
    amountPaid: number;
    paymentReference: string;
    payerBankName: string;
    paymentDate?: string;
  }): Promise<{ success: boolean; receipt?: PaymentReceipt; error?: string }> {
    const paymentDate = params.paymentDate || new Date().toISOString();
    await storageService.uploadPaymentReceiptWithSession({
      reservationId: params.reservationId,
      file: params.file,
      originalFileName: params.originalFileName,
      amountPaid: params.amountPaid,
      paymentReference: params.paymentReference,
      payerBankName: params.payerBankName,
      paymentDate,
    });

    const bundle = await this.loadReservationDetail(params.reservationId);
    return {
      success: Boolean(bundle?.receipt),
      receipt: bundle?.receipt,
    };
  }

  public uploadPaymentReceipt(data: {
    reservationId: string;
    studentId: string;
    fileUrl?: string;
    storagePath?: string;
    fileName?: string;
    fileSize?: number;
    paymentReference: string;
    payerBankName: string;
    paymentDate?: string;
    amountPaid: number;
    invoiceId?: string;
    landlordId?: string;
  }) {
    return repository.uploadPaymentReceipt({
      fileName: data.fileName || 'bank_transfer_receipt.png',
      fileSize: data.fileSize || 1024 * 350,
      paymentDate: data.paymentDate || new Date().toISOString(),
      reservationId: data.reservationId,
      studentId: data.studentId,
      fileUrl: data.fileUrl,
      storagePath: data.storagePath,
      paymentReference: data.paymentReference,
      payerBankName: data.payerBankName,
      amountPaid: data.amountPaid,
    });
  }

  public uploadReceipt(data: any) {
    return this.uploadPaymentReceipt(data);
  }

  public async reviewPaymentReceiptPersisted(
    receiptId: string,
    decision: 'approved' | 'rejected',
    landlordId: string,
    rejectionReason?: string
  ): Promise<{ success: boolean; receipt?: PaymentReceipt; error?: string }> {
    return repository.reviewPaymentReceiptPersisted(receiptId, decision, landlordId, rejectionReason);
  }

  public reviewPaymentReceipt(
    receiptId: string,
    decision: 'approved' | 'rejected',
    landlordIdOrReason?: string,
    rejectionReason?: string
  ) {
    let landlordId = repository.getActiveUserId();
    let reason = rejectionReason;

    if (landlordIdOrReason && landlordIdOrReason.length > 20 && !rejectionReason) {
      reason = landlordIdOrReason;
    } else if (landlordIdOrReason && landlordIdOrReason.startsWith('user-')) {
      landlordId = landlordIdOrReason;
    } else if (landlordIdOrReason && !rejectionReason) {
      reason = landlordIdOrReason;
    }

    const receipt = repository.reviewPaymentReceipt(receiptId, decision, landlordId, reason);

    // Invoke Supabase Edge Function 'review-payment-receipt'
    invokeEdgeFunction('review-payment-receipt', {
      receiptId,
      decision,
      rejectionReason: reason,
    }).catch((err) => {
      console.warn('[ReservationService] review-payment-receipt edge function notice:', err?.message || err);
    });

    return { success: !!receipt, receipt };
  }

  public runSevenDayExpirationCheck() {
    return repository.checkAndExpireReservations();
  }
}

export const reservationService = new ReservationService();
