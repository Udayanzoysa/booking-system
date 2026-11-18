import { Injectable } from '@nestjs/common';
import { Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto, UpdateOwnCustomerDto } from './customers.dto';

function maskPhone(customer: Customer) {
  return { ...customer, phone: customer.phone ? `••••${customer.phone.slice(-4)}` : null };
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, after?: string) {
    const size = 100;
    const customers = await this.prisma.customer.findMany({
      where: { tenantId, id: after ? { gt: after } : undefined },
      orderBy: { id: 'asc' },
      take: size + 1,
    });
    const visible = customers.slice(0, size);
    return {
      customers: visible.map(maskPhone),
      nextCursor: customers.length > size ? visible.at(-1)?.id : null,
    };
  }

  async get(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id: customerId } },
    });
    return maskPhone(customer);
  }

  getUnmaskedPhone(tenantId: string, customerId: string) {
    return this.prisma.customer.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id: customerId } },
      select: { id: true, phone: true },
    });
  }

  async create(tenantId: string, dto: CreateCustomerDto) {
    const customer = await this.prisma.customer.create({
      data: { tenantId, name: dto.name.trim(), phone: dto.phone, email: dto.email?.toLowerCase() ?? null },
    });
    return maskPhone(customer);
  }

  async update(tenantId: string, customerId: string, dto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.update({
      where: { tenantId_id: { tenantId, id: customerId } },
      data: {
        name: dto.name?.trim(),
        phone: dto.phone,
        email: dto.email === undefined ? undefined : dto.email?.toLowerCase() ?? null,
      },
    });
    return maskPhone(customer);
  }

  async own(tenantId: string, userId: string) {
    const { user, ...customer } = await this.prisma.customer.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId } }, include: { user: { select: { googleSubject: true } } },
    });
    return { ...customer, googleLinked: Boolean(user?.googleSubject) };
  }

  updateOwn(tenantId: string, userId: string, dto: UpdateOwnCustomerDto) {
    return this.prisma.customer.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: { name: dto.name?.trim(), phone: dto.phone },
    });
  }
}
