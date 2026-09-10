// src/roles/roles.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PERMISSION_GROUPS_BY_BUSINESS_TYPE, PERMISSIONS } from '../common/permissions';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  /** Once-per-process flag for syncing the Permission catalog rows. */
  private catalogSynced = false;

  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.role.findMany({
      where: { organizationId: getCurrentTenantId() },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * List the permission catalog filtered to the active org's business type, so
   * the Roles & Permissions editor only shows permissions relevant to the
   * vertical (e.g. a retail shop never sees Restaurant/Hotel/Kitchen groups).
   */
  async findPermissions() {
    // Keep the shared Permission catalog in sync with the PERMISSIONS constant
    // so newly introduced keys (e.g. requests.delete) exist for orgs created
    // before they were added. Runs once per process; failures are non-fatal.
    if (!this.catalogSynced) {
      this.catalogSynced = true;
      try {
        for (const p of PERMISSIONS) {
          await this.prisma.permission.upsert({
            where: { key: p.key },
            update: { label: p.label, group: p.group },
            create: { key: p.key, label: p.label, group: p.group },
          });
        }
      } catch {
        // Best-effort — listing still proceeds with whatever rows exist.
      }
    }
    const tenantId = getCurrentTenantId();
    let allowedGroups: string[] | null = null;
    if (tenantId != null) {
      const org = await this.prisma.organization.findUnique({
        where: { id: tenantId },
        select: { businessType: true },
      });
      if (org?.businessType) {
        allowedGroups =
          PERMISSION_GROUPS_BY_BUSINESS_TYPE[org.businessType] ?? null;
      }
    }

    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    if (allowedGroups == null) return permissions;
    return permissions.filter((p) => allowedGroups.includes(p.group));
  }

  async create(dto: CreateRoleDto) {
    const permissionIds = await this.resolvePermissionIds(dto.permissions);

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        organizationId: getCurrentTenantId(),
        permissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async update(id: number, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new BadRequestException('Role not found');
    if (role.isSystem) throw new BadRequestException('System role cannot be edited');

    const data: { name?: string; description?: string } = {};
    if (dto.name) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    if (Object.keys(data).length > 0) {
      await this.prisma.role.update({ where: { id }, data });
    }

    if (dto.permissions) {
      const permissionIds = await this.resolvePermissionIds(dto.permissions);
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissionIds.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
    }

    return this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    });
  }

  async remove(id: number) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new BadRequestException('Role not found');
    if (role.isSystem) throw new BadRequestException('System role cannot be deleted');
    if (role._count.users > 0) {
      throw new BadRequestException('Cannot delete a role that is assigned to users');
    }
    return this.prisma.role.delete({ where: { id } });
  }

  private async resolvePermissionIds(keys: string[]) {
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
    });
    return permissions.map((p) => p.id);
  }
}
