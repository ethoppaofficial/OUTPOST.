import { Reservation, Invoice, PaymentReceipt, ReservationStatus } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../../infrastructure/firebase/firebaseConfig';

class ReservationService {
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
      registrationNumber: inv.registrationNumber || student?.registrationNumber || 'STU-2026-4821',
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

  public cancelReservation(reservationId: string, reason?: string): { success: boolean; message?: string } {
    return repository.cancelReservation(reservationId, reason);
  }

  public getReceiptsForLandlord(landlordId: string): PaymentReceipt[] {
    return repository.getPaymentReceiptsForLandlord(landlordId).map((rc) => {
      const res = repository.getReservationById(rc.reservationId);
      const student = repository.getStudentProfile(rc.studentId);
      return {
        ...rc,
        propertyTitle: rc.propertyName,
        roomName: res?.unitName || 'Standard Room',
        registrationNumber: student?.registrationNumber || 'STU-2026-4821',
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

  public createReservation(studentId: string, propertyId: string, unitId: string, groupId?: string) {
    return repository.createReservation(studentId, propertyId, unitId, groupId);
  }

  public uploadPaymentReceipt(data: {
    reservationId: string;
    studentId: string;
    fileUrl: string;
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
      paymentReference: data.paymentReference,
      payerBankName: data.payerBankName,
      amountPaid: data.amountPaid,
    });
  }

  public uploadReceipt(data: any) {
    return this.uploadPaymentReceipt(data);
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
      // It's a rejection reason
      reason = landlordIdOrReason;
    } else if (landlordIdOrReason && landlordIdOrReason.startsWith('user-')) {
      landlordId = landlordIdOrReason;
    } else if (landlordIdOrReason && !rejectionReason) {
      reason = landlordIdOrReason;
    }

    const receipt = repository.reviewPaymentReceipt(receiptId, decision, landlordId, reason);

    if (auth.currentUser) {
      try {
        const callable = httpsCallable<{ receiptId: string; decision: string; rejectionReason?: string }, { ok: boolean }>(
          functions,
          'reviewPaymentReceipt'
        );
        callable({ receiptId, decision, rejectionReason: reason }).catch((err) => {
          console.warn('reviewPaymentReceipt backend sync warning:', err?.message || err);
        });
      } catch (err) {
        console.warn('Could not dispatch reviewPaymentReceipt:', err);
      }
    }

    return { success: !!receipt, receipt };
  }

  public runSevenDayExpirationCheck() {
    return repository.checkAndExpireReservations();
  }
}

export const reservationService = new ReservationService();
