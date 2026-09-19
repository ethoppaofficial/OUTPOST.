import { Reservation, Invoice, PaymentReceipt, ReservationStatus } from '../../domain/types';
import { repository } from '../../infrastructure/repositories/localStorageRepository';

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
    const res = repository.getReservationById(reservationId);
    if (!res) return { success: false, message: 'Reservation not found.' };

    res.status = 'cancelled';
    res.cancellationReason = reason || 'Cancelled by student';

    // Release hold
    const property = repository.getPropertyById(res.propertyId);
    if (property) {
      const room = property.rooms.find((r) => r.id === res.unitId);
      if (room) {
        room.availableSpaces = Math.min(room.totalCapacity, room.availableSpaces + 1);
        property.availableSpaces = property.rooms.reduce((acc, r) => acc + r.availableSpaces, 0);
        repository.updateProperty(property);
      }
    }

    const reservations = repository.getReservations().map((r) => (r.id === res.id ? res : r));
    localStorage.setItem('outpost_reservations_v1', JSON.stringify(reservations));
    return { success: true };
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
    return { success: !!receipt, receipt };
  }

  public runSevenDayExpirationCheck() {
    return repository.checkAndExpireReservations();
  }
}

export const reservationService = new ReservationService();
