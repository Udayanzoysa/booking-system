import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import {
  BankTransferSlipStatus, PaymentMethod, PayHereCheckoutStatus, Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AvailabilityEvents } from '../availability/availability.events';
import type { AuthPrincipal } from '../auth/auth-principal';
import { assertBookable } from '../bookings/booking-availability';
import { withLockedBooking, type BookingWithSlot } from '../bookings/booking-lock';
import { assertOwner, assertUpcomingBooking } from '../bookings/booking-state';
import { invoicePayableAmount } from '../invoices/invoice-balance';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCode } from '../rbac/permissions';
import {
  BankSlipListDto, BankSlipReviewDto, BankTransferSlipDto, PayHereCheckoutDto, PaymentSettingsDto,
  type SlipAttachment,
} from './customer-payments.dto';
import { PaymentsService } from './payments.service';
import { checkoutHash, safeAttachment, validNotificationSignature } from './payhere';
import { decryptPaymentSecret, encryptPaymentSecret, paymentEncryptionAvailable } from './payment-secrets';
import { readSlipAttachment, removeSlipAttachment, writeSlipAttachment } from './slip-storage';

const slipSelect = {
  id: true, bookingId: true, amount: true, currency: true, reference: true, fileName: true,
  mimeType: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true,
  booking: { select: { customer: { select: { name: true } }, slot: { select: {
    startsAt: true, lane: { select: { name: true, branch: { select: { timeZone: true } } } },
  } } } },
} satisfies Prisma.BankTransferSlipSelect;
type SlipView = Prisma.BankTransferSlipGetPayload<{ select: typeof slipSelect }>;
const view = ({ booking, ...slip }: SlipView) => ({
  ...slip, customerName: booking.customer.name, laneName: booking.slot.lane.name, startsAt: booking.slot.startsAt,
  timeZone: booking.slot.lane.branch.timeZone,
});
const emptySettings = {
  bankTransferEnabled: false, bankName: '', accountName: '', accountNumber: '', bankBranch: '', instructions: '',
  payhereConfigured: false, payhereEnabled: false, payhereSandbox: true, payhereMerchantId: '',
  payhereMerchantSecretEncrypted: '', payhereNotifyUrl: '', payhereReturnOrigin: '', contactPhone: '',
};

function environmentGatewayConfig(tenantSlug: string, notification = false) {
  const merchantId = process.env.PAYHERE_MERCHANT_ID?.trim();
  const secret = process.env.PAYHERE_MERCHANT_SECRET?.trim();
  const configuredTenant = process.env.PAYHERE_TENANT_SLUG?.trim();
  const notifyUrl = process.env.PAYHERE_NOTIFY_URL?.trim();
  const returnOrigin = process.env.PAYMENT_RETURN_ORIGIN?.trim();
  if ((!notification && process.env.PAYHERE_SANDBOX_ENABLED !== '1') || !merchantId || !secret || configuredTenant !== tenantSlug || !notifyUrl || !returnOrigin) return null;
  return validateGatewayUrls({ merchantId, secret, tenantSlug, notifyUrl, returnOrigin });
}

function validateGatewayUrls(config: { merchantId: string; secret: string; tenantSlug: string; notifyUrl: string; returnOrigin: string }) {
  try {
    const notify = new URL(config.notifyUrl);
    const origin = new URL(config.returnOrigin);
    if (notify.protocol !== 'https:' || notify.username || notify.password || notify.hash
      || ['localhost', '127.0.0.1', '[::1]'].includes(notify.hostname)
      || !['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash) return null;
    return { ...config, notifyUrl: notify.href, returnOrigin: origin.origin };
  } catch { return null; }
}

@Injectable()
export class CustomerPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly availability: AvailabilityEvents,
  ) {}

  async settings(principal: AuthPrincipal) {
    const settings = await this.prisma.paymentSettings.findUnique({ where: { tenantId: principal.tenantId } });
    return this.settingsView(settings ?? emptySettings);
  }

  async saveSettings(principal: AuthPrincipal, dto: PaymentSettingsDto) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize partial bank/contact/gateway edits to avoid overwriting another form's save.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${principal.tenantId}::uuid FOR UPDATE`;
      const saved = await tx.paymentSettings.findUnique({ where: { tenantId: principal.tenantId } });
      const existing = saved ?? emptySettings;
      const gatewayTouched = ['payhereEnabled', 'payhereSandbox', 'payhereMerchantId', 'payhereMerchantSecret',
        'payhereNotifyUrl', 'payhereReturnOrigin', 'clearPayhereMerchantSecret'].some((key) => {
          const value = dto[key as keyof PaymentSettingsDto];
          return value !== undefined && value !== null;
        });
      const secret = dto.payhereMerchantSecret?.trim();
      if (secret && dto.clearPayhereMerchantSecret) throw new BadRequestException('Choose a new merchant secret or clear it, not both.');
      const fields = {
        bankTransferEnabled: dto.bankTransferEnabled ?? existing.bankTransferEnabled,
        bankName: dto.bankName?.trim() ?? existing.bankName,
        accountName: dto.accountName?.trim() ?? existing.accountName,
        accountNumber: dto.accountNumber?.trim() ?? existing.accountNumber,
        bankBranch: dto.bankBranch?.trim() ?? existing.bankBranch,
        instructions: dto.instructions?.trim() ?? existing.instructions,
        contactPhone: dto.contactPhone?.trim() ?? existing.contactPhone,
        payhereConfigured: gatewayTouched || existing.payhereConfigured,
        payhereEnabled: dto.payhereEnabled ?? existing.payhereEnabled,
        payhereSandbox: dto.payhereSandbox ?? existing.payhereSandbox,
        payhereMerchantId: dto.payhereMerchantId?.trim() ?? existing.payhereMerchantId,
        payhereNotifyUrl: dto.payhereNotifyUrl?.trim() ?? existing.payhereNotifyUrl,
        payhereReturnOrigin: dto.payhereReturnOrigin?.trim() ?? existing.payhereReturnOrigin,
        payhereMerchantSecretEncrypted: secret ? encryptPaymentSecret(principal.tenantId, secret)
          : dto.clearPayhereMerchantSecret ? '' : existing.payhereMerchantSecretEncrypted,
      };
      if (fields.bankTransferEnabled && (!fields.bankName || !fields.accountName || !fields.accountNumber)) {
        throw new BadRequestException('Enter the bank name, account holder and account number before enabling bank transfers');
      }
      if (fields.contactPhone && !/^[+\d][\d ()-]{6,29}$/.test(fields.contactPhone)) throw new BadRequestException('Enter a valid club contact phone number');
      if (!fields.payhereSandbox) throw new BadRequestException('Live PayHere payments are not enabled. Use sandbox mode for this release.');
      if (gatewayTouched && fields.payhereEnabled) {
        if (!fields.payhereMerchantId || !fields.payhereMerchantSecretEncrypted) throw new BadRequestException('Enter the sandbox merchant ID and merchant secret before enabling PayHere.');
        const decrypted = decryptPaymentSecret(principal.tenantId, fields.payhereMerchantSecretEncrypted);
        if (!validateGatewayUrls({ merchantId: fields.payhereMerchantId, secret: decrypted, tenantSlug: principal.tenantSlug,
          notifyUrl: fields.payhereNotifyUrl, returnOrigin: fields.payhereReturnOrigin })) {
          throw new BadRequestException('Enter a public HTTPS notification URL and a valid frontend return origin.');
        }
      }
      const updated = await tx.paymentSettings.upsert({
        where: { tenantId: principal.tenantId }, create: { tenantId: principal.tenantId, ...fields }, update: fields,
      });
      return this.settingsView(updated);
    });
  }

  private settingsView(settings: typeof emptySettings & { tenantId?: string; updatedAt?: Date }) {
    const { tenantId: _tenant, updatedAt: _updated, payhereConfigured: _configured,
      payhereMerchantSecretEncrypted, ...fields } = settings;
    return { ...fields, payhereMerchantSecretConfigured: Boolean(payhereMerchantSecretEncrypted), encryptionAvailable: paymentEncryptionAvailable() };
  }

  private async gatewayConfig(tenantId: string, tenantSlug: string, notification = false) {
    const settings = await this.prisma.paymentSettings.findUnique({ where: { tenantId } });
    if (!settings?.payhereConfigured) return environmentGatewayConfig(tenantSlug, notification);
    if ((!notification && !settings.payhereEnabled) || !settings.payhereSandbox || !settings.payhereMerchantId || !settings.payhereMerchantSecretEncrypted) return null;
    try {
      return validateGatewayUrls({ merchantId: settings.payhereMerchantId, secret: decryptPaymentSecret(tenantId, settings.payhereMerchantSecretEncrypted),
        tenantSlug, notifyUrl: settings.payhereNotifyUrl, returnOrigin: settings.payhereReturnOrigin });
    } catch { return null; }
  }

  async options(principal: AuthPrincipal) {
    const config = await this.gatewayConfig(principal.tenantId, principal.tenantSlug);
    const bank = await this.settings(principal);
    return {
      payhere: { enabled: Boolean(config && config.tenantSlug === principal.tenantSlug), sandbox: true },
      contactPhone: bank.contactPhone || '070 126 1966',
      bankTransfer: {
        enabled: bank.bankTransferEnabled,
        bankName: bank.bankTransferEnabled ? bank.bankName : '',
        accountName: bank.bankTransferEnabled ? bank.accountName : '',
        accountNumber: bank.bankTransferEnabled ? bank.accountNumber : '',
        branch: bank.bankTransferEnabled ? bank.bankBranch : '',
        instructions: bank.bankTransferEnabled ? bank.instructions : '',
      },
    };
  }

  async checkout(principal: AuthPrincipal, bookingId: string, dto: PayHereCheckoutDto) {
    const config = await this.gatewayConfig(principal.tenantId, principal.tenantSlug);
    if (!config || config.tenantSlug !== principal.tenantSlug) {
      throw new ServiceUnavailableException('PayHere sandbox is not configured for this arena. Choose another payment method.');
    }
    if (!dto.billingAddress.trim() || !dto.billingCity.trim()) throw new BadRequestException('Enter your billing address and city');
    return withLockedBooking(this.prisma, principal.tenantId, bookingId, [], async (tx, booking) => {
      await assertOwner(tx, principal, booking);
      await this.assertCanPay(tx, booking, new Date());
      if (!['LKR', 'USD', 'GBP', 'EUR', 'AUD'].includes(booking.currency)) {
        throw new BadRequestException('This booking currency is not supported by PayHere');
      }
      if (await tx.bankTransferSlip.count({ where: { tenantId: principal.tenantId, bookingId, status: BankTransferSlipStatus.PENDING } })) {
        throw new ConflictException('A bank transfer is awaiting review. Contact the arena before using another payment method.');
      }
      const amount = (await invoicePayableAmount(tx, booking)).minus(booking.amountPaid);
      if (amount.lte(0)) throw new ConflictException('This booking has no balance due');
      if (!amount.eq(amount.toDecimalPlaces(2))) throw new BadRequestException('PayHere requires an amount with at most two decimal places');
      const idempotencyKey = dto.idempotencyKey.toLowerCase();
      let checkout = await tx.payHereCheckout.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: principal.tenantId, idempotencyKey } },
      });
      if (checkout) {
        if (checkout.bookingId !== bookingId || checkout.initiatedById !== principal.userId
          || !checkout.amount.eq(amount) || checkout.slotId !== booking.slotId || checkout.status !== PayHereCheckoutStatus.PENDING
          || checkout.merchantId !== config.merchantId) {
          throw new ConflictException('This checkout attempt is no longer payable. Refresh and try again.');
        }
      } else {
        checkout = await tx.payHereCheckout.create({ data: {
          tenantId: principal.tenantId, bookingId, initiatedById: principal.userId, slotId: booking.slotId,
          idempotencyKey, amount, currency: booking.currency, merchantId: config.merchantId,
          merchantSecretEncrypted: paymentEncryptionAvailable() ? encryptPaymentSecret(principal.tenantId, config.secret) : undefined,
        } });
      }
      const customer = await tx.customer.findUniqueOrThrow({ where: { tenantId_id: { tenantId: principal.tenantId, id: booking.customerId } } });
      const names = customer.name.trim().split(/\s+/);
      const formatted = amount.toFixed(2);
      const checkoutSecret = checkout.merchantSecretEncrypted
        ? decryptPaymentSecret(principal.tenantId, checkout.merchantSecretEncrypted) : config.secret;
      return { url: 'https://sandbox.payhere.lk/pay/checkout', fields: {
        merchant_id: config.merchantId,
        return_url: `${config.returnOrigin}/book?payment=return&booking=${booking.id}`,
        cancel_url: `${config.returnOrigin}/book?payment=cancel&booking=${booking.id}`,
        notify_url: config.notifyUrl, order_id: checkout.id,
        items: `Arena booking ${booking.id.slice(0, 8)}`, currency: booking.currency, amount: formatted,
        first_name: names[0] || 'Player', last_name: names.slice(1).join(' ') || names[0] || 'Player',
        email: customer.email ?? '', phone: dto.billingPhone.trim(), address: dto.billingAddress.trim(), city: dto.billingCity.trim(), country: 'Sri Lanka',
        hash: checkoutHash(checkout.merchantId, checkout.id, formatted, booking.currency, checkoutSecret),
      } };
    });
  }

  async notify(body: Record<string, unknown>) {
    const required = ['merchant_id', 'order_id', 'payment_id', 'payhere_amount', 'payhere_currency', 'status_code', 'md5sig'];
    if (!body || required.some((key) => typeof body[key] !== 'string' || (body[key] as string).length > 160)) {
      throw new BadRequestException('Invalid PayHere notification');
    }
    const fields = Object.fromEntries(required.map((key) => [key, body[key] as string]));
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fields.order_id) || !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(fields.payhere_amount)
      || !['2', '0', '-1', '-2', '-3'].includes(fields.status_code) || !fields.payment_id.trim()) {
      throw new BadRequestException('Invalid PayHere notification values');
    }
    const initial = await this.prisma.payHereCheckout.findUnique({ where: { id: fields.order_id } });
    if (!initial) throw new NotFoundException('Checkout not found');
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: initial.tenantId }, select: { slug: true } });
    const config = initial.merchantSecretEncrypted
      ? { merchantId: initial.merchantId, secret: decryptPaymentSecret(initial.tenantId, initial.merchantSecretEncrypted), tenantSlug: tenant.slug }
      : await this.gatewayConfig(initial.tenantId, tenant.slug, true);
    if (!config) throw new ServiceUnavailableException('PayHere sandbox credentials are unavailable for this arena');
    if (fields.merchant_id !== config.merchantId || !validNotificationSignature(fields, config.secret)) {
      throw new UnauthorizedException('Invalid PayHere notification signature');
    }
    if (initial.merchantId !== fields.merchant_id || !initial.amount.eq(fields.payhere_amount)
      || initial.currency !== fields.payhere_currency) throw new BadRequestException('Notification does not match the checkout');
    const result = await withLockedBooking(this.prisma, initial.tenantId, initial.bookingId, [], async (tx, booking) => {
      const checkout = await tx.payHereCheckout.findUniqueOrThrow({ where: { id: initial.id } });
      if (checkout.paymentId && checkout.paymentId !== fields.payment_id) throw new ConflictException('Checkout already has another provider payment');
      if (fields.status_code === '-3') {
        await tx.payHereCheckout.update({ where: { id: checkout.id }, data: {
          status: PayHereCheckoutStatus.REVIEW, statusCode: '-3', reviewNote: 'PayHere reported a chargeback. Staff must reconcile the payment.',
        } });
        return { received: true, status: 'REVIEW' };
      }
      if (checkout.status === PayHereCheckoutStatus.SUCCEEDED || checkout.status === PayHereCheckoutStatus.REVIEW) {
        return { received: true, status: checkout.status };
      }
      if (fields.status_code !== '2') {
        const status = fields.status_code === '0' ? PayHereCheckoutStatus.PENDING : PayHereCheckoutStatus.FAILED;
        await tx.payHereCheckout.update({ where: { id: checkout.id }, data: { status, statusCode: fields.status_code } });
        return { received: true, status };
      }
      const now = new Date();
      let reviewNote: string | undefined;
      try {
        await this.assertCanPay(tx, booking, now);
        if (booking.slotId !== checkout.slotId) throw new ConflictException('Booking was rescheduled after checkout');
        const balance = (await invoicePayableAmount(tx, booking)).minus(booking.amountPaid);
        if (!balance.eq(checkout.amount)) throw new ConflictException('The balance changed after checkout');
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        reviewNote = error.message;
      }
      if (reviewNote) {
        await tx.payHereCheckout.update({ where: { id: checkout.id }, data: {
          status: PayHereCheckoutStatus.REVIEW, paymentId: fields.payment_id, statusCode: '2',
          reviewNote: 'Verified payment received but not applied: ' + reviewNote,
        } });
        return { received: true, status: 'REVIEW' };
      }
      const principal: AuthPrincipal = {
        tenantId: checkout.tenantId, userId: checkout.initiatedById, displayName: 'PayHere sandbox',
        tenantSlug: config.tenantSlug, expiresAt: Date.now(), permissions: new Set(),
      };
      const collection = await this.payments.applyCollection(tx, booking, principal, {
        amount: checkout.amount, method: PaymentMethod.ONLINE_GATEWAY, idempotencyKey: 'payhere:' + checkout.id,
      }, now);
      await tx.paymentTransaction.update({ where: { id: collection.transaction.id }, data: {
        provider: 'PAYHERE_SANDBOX', providerReference: fields.payment_id,
      } });
      await tx.payHereCheckout.update({ where: { id: checkout.id }, data: {
        status: PayHereCheckoutStatus.SUCCEEDED, paymentId: fields.payment_id, statusCode: '2',
      } });
      return { received: true, status: 'SUCCEEDED' };
    });
    this.availability.changed(initial.tenantId);
    return result;
  }

  async uploadSlip(principal: AuthPrincipal, bookingId: string, dto: BankTransferSlipDto, attachment?: SlipAttachment) {
    if (!attachment || attachment.size === 0 || attachment.size !== attachment.buffer.length || attachment.size > 5 * 1024 * 1024 || !safeAttachment(attachment)) {
      throw new BadRequestException('Attach a JPEG, PNG or PDF bank slip up to 5 MB');
    }
    const fileSha256 = createHash('sha256').update(attachment.buffer).digest('hex');
    const idempotencyKey = dto.idempotencyKey.toLowerCase();
    const reference = dto.reference?.trim() || null;
    const amount = new Prisma.Decimal(dto.amount);
    const canRecord = principal.permissions.has(PermissionCode.RECORD_PAYMENT);
    const isStaff = canRecord || principal.permissions.has(PermissionCode.MANAGE_BOOKINGS);
    const approve = dto.reviewDecision === 'APPROVED';
    if (approve && !canRecord) throw new ForbiddenException('Recording a verified transfer requires payment permission');
    const newSlipId = randomUUID();
    let storagePath: string | undefined;
    try {
      const result = await withLockedBooking(this.prisma, principal.tenantId, bookingId, [], async (tx, booking) => {
        if (!isStaff) await assertOwner(tx, principal, booking);
        const replay = await tx.bankTransferSlip.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: principal.tenantId, idempotencyKey } }, select: {
            ...slipSelect, fileSha256: true, submittedById: true,
          },
        });
        if (replay) {
          if (replay.bookingId !== bookingId || replay.submittedById !== principal.userId || replay.fileSha256 !== fileSha256
            || !replay.amount.eq(amount) || replay.reference !== reference
            || (approve && replay.status !== BankTransferSlipStatus.APPROVED)) {
            throw new ConflictException('This upload key is already used');
          }
          const { fileSha256: _hash, submittedById: _user, ...slip } = replay;
          return view(slip);
        }
        const settings = await tx.paymentSettings.findUnique({ where: { tenantId: principal.tenantId } });
        if (!isStaff && !settings?.bankTransferEnabled) throw new ConflictException('Bank transfer is not enabled for this arena');
        const now = new Date();
        await this.assertCanPay(tx, booking, now);
        const balance = (await invoicePayableAmount(tx, booking)).minus(booking.amountPaid);
        if (amount.lte(0) || amount.gt(balance)) throw new BadRequestException('The transfer must be positive and cannot exceed the balance due');
        if (amount.lt(balance) && (booking.depositRequired.lte(0) || booking.amountPaid.plus(amount).lt(booking.depositRequired))) {
          throw new BadRequestException('Transfer the full balance or at least the configured deposit');
        }
        const pending = await tx.bankTransferSlip.count({ where: { tenantId: principal.tenantId, bookingId, status: BankTransferSlipStatus.PENDING } });
        if (pending) throw new ConflictException('A transfer slip for this booking is already awaiting review');
        storagePath = await writeSlipAttachment(booking.id, newSlipId, attachment);
        const slip = await tx.bankTransferSlip.create({ data: {
          id: newSlipId, tenantId: principal.tenantId, bookingId, submittedById: principal.userId, idempotencyKey,
          amount, currency: booking.currency, reference, fileSha256,
          fileName: attachment.originalname.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(-180) || 'bank-slip',
          mimeType: attachment.mimetype, fileSize: attachment.size, storagePath,
          status: approve ? BankTransferSlipStatus.APPROVED : BankTransferSlipStatus.PENDING,
          reviewedById: approve ? principal.userId : undefined,
          reviewedAt: approve ? now : undefined,
          reviewNote: approve ? 'Transfer verified and recorded by staff.' : undefined,
        }, select: slipSelect });
        if (approve) await this.payments.applyCollection(tx, booking, principal, {
          amount, method: PaymentMethod.BANK_TRANSFER, idempotencyKey: 'bank-slip:' + newSlipId,
        }, now);
        return view(slip);
      });
      this.availability.changed(principal.tenantId);
      return result;
    } catch (error) {
      if (storagePath) {
        // Avoid deleting a committed file if the database outcome is uncertain.
        const persisted = await this.prisma.bankTransferSlip.findUnique({ where: { id: newSlipId }, select: { id: true } }).catch(() => ({ id: newSlipId }));
        if (!persisted) await removeSlipAttachment(storagePath).catch(() => undefined);
      }
      throw error;
    }
  }

  async bookingSlips(principal: AuthPrincipal, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { tenantId_id: { tenantId: principal.tenantId, id: bookingId } } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (!principal.permissions.has(PermissionCode.RECORD_PAYMENT) && !principal.permissions.has(PermissionCode.MANAGE_BOOKINGS)) await assertOwner(this.prisma, principal, booking);
    return (await this.prisma.bankTransferSlip.findMany({
      where: { tenantId: principal.tenantId, bookingId }, orderBy: { createdAt: 'desc' }, take: 100, select: slipSelect,
    })).map(view);
  }

  async listSlips(principal: AuthPrincipal, dto: BankSlipListDto) {
    return (await this.prisma.bankTransferSlip.findMany({
      where: { tenantId: principal.tenantId, status: dto.status }, orderBy: { createdAt: 'desc' }, take: 100, select: slipSelect,
    })).map(view);
  }

  async attachment(principal: AuthPrincipal, id: string) {
    const slip = await this.prisma.bankTransferSlip.findFirst({ where: { id, tenantId: principal.tenantId }, select: { bookingId: true } });
    if (!slip) throw new NotFoundException('Transfer slip not found');
    if (!principal.permissions.has(PermissionCode.RECORD_PAYMENT) && !principal.permissions.has(PermissionCode.MANAGE_BOOKINGS)) {
      const booking = await this.prisma.booking.findUniqueOrThrow({ where: { tenantId_id: { tenantId: principal.tenantId, id: slip.bookingId } } });
      await assertOwner(this.prisma, principal, booking);
    }
    const file = await this.prisma.bankTransferSlip.findUniqueOrThrow({ where: { id }, select: {
      attachment: true, storagePath: true, mimeType: true, fileName: true, fileSize: true,
    } });
    const attachment = file.storagePath ? await readSlipAttachment(file.storagePath, file.fileSize)
      : file.attachment ? Buffer.from(file.attachment) : null;
    if (!attachment) throw new NotFoundException('Attachment not found');
    return { attachment, mimeType: file.mimeType, fileName: file.fileName, fileSize: file.fileSize };
  }

  async reviewSlip(principal: AuthPrincipal, id: string, dto: BankSlipReviewDto) {
    const initial = await this.prisma.bankTransferSlip.findFirst({ where: { id, tenantId: principal.tenantId }, select: { bookingId: true } });
    if (!initial) throw new NotFoundException('Transfer slip not found');
    const result = await withLockedBooking(this.prisma, principal.tenantId, initial.bookingId, [], async (tx, booking) => {
      const slip = await tx.bankTransferSlip.findUniqueOrThrow({ where: { id }, select: { status: true, amount: true, id: true } });
      if (slip.status !== BankTransferSlipStatus.PENDING) {
        if (slip.status !== dto.decision) throw new ConflictException('This transfer slip has already been reviewed');
        return view(await tx.bankTransferSlip.findUniqueOrThrow({ where: { id }, select: slipSelect }));
      }
      const now = new Date();
      if (dto.decision === 'APPROVED') {
        await this.assertCanPay(tx, booking, now);
        await this.payments.applyCollection(tx, booking, principal, {
          amount: slip.amount, method: PaymentMethod.BANK_TRANSFER, idempotencyKey: 'bank-slip:' + slip.id,
        }, now);
      }
      return view(await tx.bankTransferSlip.update({ where: { id }, data: {
        status: dto.decision, reviewedById: principal.userId, reviewedAt: now, reviewNote: dto.note?.trim() || null,
      }, select: slipSelect }));
    });
    this.availability.changed(principal.tenantId);
    return result;
  }

  private async assertCanPay(tx: Prisma.TransactionClient, booking: BookingWithSlot, now: Date) {
    assertUpcomingBooking(booking, now);
    await assertBookable(tx, booking.tenantId, booking.slot, now, booking.id);
    const lane = await tx.lane.findUnique({ where: { tenantId_id: { tenantId: booking.tenantId, id: booking.slot.laneId } }, select: { isActive: true, branch: { select: { isActive: true } } } });
    if (!lane?.isActive || !lane.branch.isActive) throw new ConflictException('This arena or lane is no longer available');
  }
}
