import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UnitsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.unit.findMany({ orderBy: { name: 'asc' } });
  }

  create(name: string, symbol?: string) {
    return this.prisma.unit.create({ data: { name, symbol: symbol ?? null } });
  }
}