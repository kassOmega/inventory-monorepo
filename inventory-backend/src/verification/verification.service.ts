// src/verification/verification.service.ts
// Account verification (KYC): handles document uploads for user (owner) accounts
// and business accounts, runs the AI reviewer, applies the anti-fraud block rule,
// and powers the admin review queue. All status changes notify the affected user
// and/or the platform admins.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VerificationStatus } from '@prisma/client';
import { getVerticalLabel } from '../common/verticals';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiReviewResult, VerificationAiService } from './verification-ai.service';

const MAX_SCAM_ATTEMPTS = Math.max(
  1,
  Number(process.env.VERIFICATION_MAX_SCAM_ATTEMPTS ?? 4),
);

type FileLike = {
  filename: string;
  mimetype: string;
  size: number;
  path: string;
};

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly ai: VerificationAiService,
  ) {}

  /** The user's own verification state: their account + every business they own. */
  async getMyVerification(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isOwnerAccount: true,
        verificationStatus: true,
        verificationNote: true,
        verificationAttempts: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const memberships = await this.prisma.membership.findMany({
      where: { userId, role: { isSystem: true } },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            businessType: true,
            verificationStatus: true,
            verificationNote: true,
            verificationAttempts: true,
          },
        },
      },
      orderBy: { organizationId: 'asc' },
    });

    const orgIds = memberships.map((m) => m.organizationId);
    const docs = await this.prisma.verificationDocument.findMany({
      where: {
        OR: [
          { accountType: 'USER', userId },
          { accountType: 'BUSINESS', organizationId: { in: orgIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const userDocs = docs.filter((d) => d.accountType === 'USER');
    const businessDocs = new Map<number, typeof docs>();
    for (const d of docs) {
      if (d.accountType !== 'BUSINESS' || d.organizationId == null) continue;
      const list = businessDocs.get(d.organizationId) ?? [];
      list.push(d);
      businessDocs.set(d.organizationId, list);
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isOwnerAccount: user.isOwnerAccount,
        verificationStatus: user.verificationStatus,
        verificationNote: user.verificationNote,
        verificationAttempts: user.verificationAttempts,
        documents: userDocs,
      },
      businesses: memberships.map((m) => ({
        id: m.organizationId,
        name: m.organization.name,
        businessType: m.organization.businessType,
        label: getVerticalLabel(m.organization.businessType),
        verificationStatus: m.organization.verificationStatus,
        verificationNote: m.organization.verificationNote,
        verificationAttempts: m.organization.verificationAttempts,
        documents: businessDocs.get(m.organizationId) ?? [],
      })),
    };
  }

  /** Load a document and authorize the caller (owner, org member, or admin). */
  async getAuthorizedDocument(docId: string, user: JwtPayload) {
    const doc = await this.prisma.verificationDocument.findUnique({
      where: { id: docId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const isAdmin = user.isPlatformAdmin || user.isSuperuser;
    const isUploader = doc.userId === user.sub;
    const isOrgMember =
      doc.organizationId != null &&
      (user.memberships?.some((m) => m.organizationId === doc.organizationId) ??
        false);

    if (!isAdmin && !isUploader && !isOrgMember) {
      throw new ForbiddenException('You cannot view this document');
    }
    return doc;
  }

  // =========================================================================
  // Uploads
  // =========================================================================

  /**
   * Upload (or re-upload) the user account's national ID.
   * `callerUserId` is the account performing the upload — normally the owner
   * themself; the platform admin can upload on an owner's behalf.
   */
  async uploadUserDocument(userId: number, file: FileLike) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        isOwnerAccount: true,
        verificationStatus: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isOwnerAccount) {
      throw new ForbiddenException(
        'Only owner accounts require user-level verification.',
      );
    }
    this.assertNotBlocked(user.verificationStatus);
    this.assertCanSubmit(user.verificationStatus);

    const doc = await this.prisma.verificationDocument.create({
      data: {
        accountType: 'USER',
        documentType: 'NATIONAL_ID',
        userId,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        filePath: file.path,
        status: VerificationStatus.SUBMITTED,
      },
    });

    const outcome = await this.reviewAndUpdate({
      docId: doc.id,
      userId,
      accountName: user.name,
    });
    return { documentId: doc.id, ...outcome };
  }

  /** Self-service upload: the caller uploads a business document they own. */
  async uploadBusinessDocument(
    userId: number,
    organizationId: number,
    file: FileLike,
    documentType: 'TRADE_LICENSE' | 'TIN_CERTIFICATE',
  ) {
    await this.assertCanManageBusiness(userId, organizationId);
    return this.createBusinessDocument(userId, organizationId, file, documentType);
  }

  /** Admin upload on a business's behalf (owner check skipped; admin authorized). */
  async adminUploadBusinessDocument(
    adminId: number,
    organizationId: number,
    file: FileLike,
    documentType: 'TRADE_LICENSE' | 'TIN_CERTIFICATE',
  ) {
    return this.createBusinessDocument(adminId, organizationId, file, documentType);
  }

  private async createBusinessDocument(
    uploaderId: number,
    organizationId: number,
    file: FileLike,
    documentType: 'TRADE_LICENSE' | 'TIN_CERTIFICATE',
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, verificationStatus: true },
    });
    if (!org) throw new NotFoundException('Business not found');
    this.assertNotBlocked(org.verificationStatus);
    this.assertCanSubmit(org.verificationStatus);

    const doc = await this.prisma.verificationDocument.create({
      data: {
        accountType: 'BUSINESS',
        documentType,
        userId: uploaderId,
        organizationId,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        filePath: file.path,
        status: VerificationStatus.SUBMITTED,
      },
    });

    const outcome = await this.reviewAndUpdate({
      docId: doc.id,
      organizationId,
      userId: uploaderId,
      accountName: org.name,
    });
    return { documentId: doc.id, ...outcome };
  }


  // =========================================================================
  // AI review + account status resolution
  // =========================================================================

  private async reviewAndUpdate(opts: {
    docId: string;
    userId: number;
    organizationId?: number;
    accountName: string;
  }) {
    const doc = await this.prisma.verificationDocument.findUnique({
      where: { id: opts.docId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const review = await this.ai.review({
      documentType: doc.documentType,
      filePath: doc.filePath,
      mimeType: doc.mimeType,
      accountName: opts.accountName,
    });

    const docStatus =
      review.decision === 'CLEAR'
        ? VerificationStatus.APPROVED
        : VerificationStatus.FLAGGED;
    await this.prisma.verificationDocument.update({
      where: { id: doc.id },
      data: {
        status: docStatus,
        aiResult: review as object,
      },
    });

    // A cleared national ID / trade license immediately approves the account.
    if (review.decision === 'CLEAR' && !review.unavailable) {
      if (opts.organizationId != null) {
        return this.applyClearBusinessResult(doc, opts.organizationId, review);
      }
      return this.applyClearUserResult(opts.userId, doc.userId, review);
    }

    // Suspicious / manual-review: flag the account and notify the admins.
    if (opts.organizationId != null) {
      await this.prisma.organization.update({
        where: { id: opts.organizationId },
        data: {
          verificationStatus: VerificationStatus.FLAGGED,
          verificationNote: this.flagNote(review),
        },
      });
    } else {
      await this.prisma.user.update({
        where: { id: opts.userId },
        data: {
          verificationStatus: VerificationStatus.FLAGGED,
          verificationNote: this.flagNote(review),
        },
      });
    }
    await this.notifyAdminsForFlag(doc, review);
    return {
      status: VerificationStatus.FLAGGED,
      decision: review.decision,
      confidence: review.confidence,
      reasons: review.reasons,
      manualReview: review.unavailable,
    };
  }

  private async applyClearUserResult(
    targetUserId: number,
    uploaderId: number,
    review: AiReviewResult,
  ) {
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        verificationStatus: VerificationStatus.APPROVED,
        verificationNote: null,
        verificationAttempts: 0,
      },
    });
    await this.notifications.notifyUser(
      targetUserId,
      'Account verified',
      'Your account has been verified successfully. You can now operate the system.',
      'ACCOUNT_VERIFICATION',
    );
    return {
      status: VerificationStatus.APPROVED,
      decision: review.decision,
      confidence: review.confidence,
      reasons: review.reasons,
      manualReview: false,
    };
  }


  private async applyClearBusinessResult(
    doc: { documentType: string },
    organizationId: number,
    review: AiReviewResult,
  ) {
    // The trade license is required; TIN is optional. Only approve when the
    // trade license itself has been approved (now or earlier).
    if (doc.documentType === 'TRADE_LICENSE') {
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          verificationStatus: VerificationStatus.APPROVED,
          verificationNote: null,
          verificationAttempts: 0,
        },
      });
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });
      const owners = await this.prisma.membership.findMany({
        where: { organizationId, role: { isSystem: true } },
        select: { userId: true },
      });
      for (const owner of owners) {
        await this.notifications.notifyUser(
          owner.userId,
          'Business verified',
          `Your business "${org?.name ?? `#${organizationId}`}" has been verified successfully.`,
          'ACCOUNT_VERIFICATION',
        );
      }
      return {
        status: VerificationStatus.APPROVED,
        decision: review.decision,
        confidence: review.confidence,
        reasons: review.reasons,
        manualReview: false,
      };
    }

    // TIN approved but the trade license is not yet approved — keep it pending.
    const hasLicense = await this.prisma.verificationDocument.count({
      where: {
        organizationId,
        documentType: 'TRADE_LICENSE',
        status: VerificationStatus.APPROVED,
      },
    });
    if (hasLicense > 0) {
      return {
        status: VerificationStatus.APPROVED,
        decision: review.decision,
        confidence: review.confidence,
        reasons: review.reasons,
        manualReview: false,
      };
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        verificationStatus: VerificationStatus.SUBMITTED,
        verificationNote: null,
      },
    });
    return {
      status: VerificationStatus.SUBMITTED,
      decision: review.decision,
      confidence: review.confidence,
      reasons: review.reasons,
      manualReview: false,
    };
  }

  private flagNote(review: AiReviewResult): string {
    if (review.unavailable) {
      return 'Pending manual review by the admin.';
    }
    const reasons = (review.reasons ?? []).join('; ');
    return `Flagged as suspicious by the AI reviewer${reasons ? `: ${reasons}` : '.'}`;
  }

  private async notifyAdminsForFlag(
    doc: { documentType: string; organizationId: number | null },
    review: AiReviewResult,
  ) {
    const target =
      doc.organizationId != null
        ? `Business #${doc.organizationId}`
        : 'a user account';
    const reasons = (review.reasons ?? []).join('; ') || 'No details provided';
    await this.notifications.notifyAdmins(
      'Verification flagged for review',
      `${target} submitted a ${doc.documentType} document that needs manual review. AI says: ${reasons}`,
      'ACCOUNT_VERIFICATION',
    );
  }


  // =========================================================================
  // Admin review queue
  // =========================================================================

  /** All owner accounts + organizations with verification state, optional filter. */
  async adminList(status?: string) {
    const where =
      status &&
      Object.values(VerificationStatus).includes(status as VerificationStatus)
        ? { verificationStatus: status as VerificationStatus }
        : {};

    const users = await this.prisma.user.findMany({
      where: { isOwnerAccount: true, ...where },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isPlatformAdmin: true,
        status: true,
        verificationStatus: true,
        verificationNote: true,
        verificationAttempts: true,
        createdAt: true,
        verificationDocs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            documentType: true,
            fileName: true,
            mimeType: true,
            size: true,
            status: true,
            aiResult: true,
            createdAt: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const organizations = await this.prisma.organization.findMany({
      where,
      select: {
        id: true,
        name: true,
        businessType: true,
        status: true,
        verificationStatus: true,
        verificationNote: true,
        verificationAttempts: true,
        createdAt: true,
        memberships: {
          where: { role: { isSystem: true } },
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        verificationDocs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            documentType: true,
            fileName: true,
            mimeType: true,
            size: true,
            status: true,
            aiResult: true,
            createdAt: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    return {
      users,
      organizations: organizations.map((o) => ({
        ...o,
        label: getVerticalLabel(o.businessType),
      })),
    };
  }


  async adminApproveUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isOwnerAccount) {
      throw new BadRequestException('Only owner accounts are verified here');
    }

    await this.prisma.$transaction([
      this.prisma.verificationDocument.updateMany({
        where: {
          accountType: 'USER',
          userId,
          status: { in: [VerificationStatus.SUBMITTED, VerificationStatus.FLAGGED] },
        },
        data: { status: VerificationStatus.APPROVED },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          verificationStatus: VerificationStatus.APPROVED,
          verificationNote: null,
          verificationAttempts: 0,
        },
      }),
    ]);

    await this.notifications.notifyUser(
      userId,
      'Account verified',
      'The admin approved your account verification. You can now operate the system.',
      'ACCOUNT_VERIFICATION',
    );
    return { userId, verificationStatus: VerificationStatus.APPROVED };
  }

  async adminRejectUser(userId: number, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.isOwnerAccount) {
      throw new BadRequestException('Only owner accounts are verified here');
    }

    const nextAttempts = user.verificationAttempts + 1;
    const blocked = nextAttempts > MAX_SCAM_ATTEMPTS;

    await this.prisma.verificationDocument.updateMany({
      where: {
        accountType: 'USER',
        userId,
        status: { in: [VerificationStatus.SUBMITTED, VerificationStatus.FLAGGED] },
      },
      data: { status: VerificationStatus.REJECTED },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        verificationStatus: blocked
          ? VerificationStatus.BLOCKED
          : VerificationStatus.REJECTED,
        verificationNote: blocked
          ? 'Permanently blocked for repeated fraudulent verification attempts.'
          : reason,
        verificationAttempts: nextAttempts,
      },
    });

    if (blocked) {
      await this.notifications.notifyUser(
        userId,
        'Account permanently blocked',
        'Your account has been permanently blocked for repeated fraudulent verification attempts.',
        'ACCOUNT_VERIFICATION',
      );
      this.logger.warn(
        `User ${userId} permanently blocked for repeated verification fraud.`,
      );
      return { userId, verificationStatus: VerificationStatus.BLOCKED };
    }

    await this.notifications.notifyUser(
      userId,
      'Verification rejected',
      `Your verification was rejected. Reason: ${reason} Please upload a legitimate document to try again.`,
      'ACCOUNT_VERIFICATION',
    );
    return { userId, verificationStatus: VerificationStatus.REJECTED };
  }


  async adminApproveBusiness(organizationId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Business not found');

    await this.prisma.$transaction([
      this.prisma.verificationDocument.updateMany({
        where: {
          accountType: 'BUSINESS',
          organizationId,
          status: { in: [VerificationStatus.SUBMITTED, VerificationStatus.FLAGGED] },
        },
        data: { status: VerificationStatus.APPROVED },
      }),
      this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          verificationStatus: VerificationStatus.APPROVED,
          verificationNote: null,
          verificationAttempts: 0,
        },
      }),
    ]);

    const owners = await this.prisma.membership.findMany({
      where: { organizationId, role: { isSystem: true } },
      select: { userId: true },
    });
    for (const owner of owners) {
      await this.notifications.notifyUser(
        owner.userId,
        'Business verified',
        `The admin approved verification for "${org.name}". You can now operate this business.`,
        'ACCOUNT_VERIFICATION',
      );
    }
    return { organizationId, verificationStatus: VerificationStatus.APPROVED };
  }

  async adminRejectBusiness(organizationId: number, reason: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Business not found');

    const nextAttempts = org.verificationAttempts + 1;
    const blocked = nextAttempts > MAX_SCAM_ATTEMPTS;

    await this.prisma.verificationDocument.updateMany({
      where: {
        accountType: 'BUSINESS',
        organizationId,
        status: { in: [VerificationStatus.SUBMITTED, VerificationStatus.FLAGGED] },
      },
      data: { status: VerificationStatus.REJECTED },
    });

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        verificationStatus: blocked
          ? VerificationStatus.BLOCKED
          : VerificationStatus.REJECTED,
        verificationNote: blocked
          ? 'Permanently blocked for repeated fraudulent verification attempts.'
          : reason,
        verificationAttempts: nextAttempts,
      },
    });

    const owners = await this.prisma.membership.findMany({
      where: { organizationId, role: { isSystem: true } },
      select: { userId: true },
    });

    if (blocked) {
      for (const owner of owners) {
        await this.notifications.notifyUser(
          owner.userId,
          'Business permanently blocked',
          `Your business "${org.name}" has been permanently blocked for repeated fraudulent verification attempts.`,
          'ACCOUNT_VERIFICATION',
        );
      }
      this.logger.warn(
        `Organization ${organizationId} permanently blocked for verification fraud.`,
      );
      return { organizationId, verificationStatus: VerificationStatus.BLOCKED };
    }

    for (const owner of owners) {
      await this.notifications.notifyUser(
        owner.userId,
        'Business verification rejected',
        `Verification for "${org.name}" was rejected. Reason: ${reason} Please upload a legitimate document to try again.`,
        'ACCOUNT_VERIFICATION',
      );
    }
    return { organizationId, verificationStatus: VerificationStatus.REJECTED };
  }

  /**
   * Admin can move a user or business to ANY verification status from any
   * current status (e.g. revoke an approval, unblock, re-flag). Approving also
   * approves pending documents; rejecting/blocking also rejects pending ones.
   */
  async adminSetStatus(
    accountType: 'USER' | 'BUSINESS',
    accountId: number,
    status: VerificationStatus,
    note?: string,
  ) {
    const notify = ([
      VerificationStatus.APPROVED,
      VerificationStatus.REJECTED,
      VerificationStatus.BLOCKED,
      VerificationStatus.FLAGGED,
    ] as VerificationStatus[]).includes(status);
    const pendingWhere = {
      status: { in: [VerificationStatus.SUBMITTED, VerificationStatus.FLAGGED] },
    };

    if (accountType === 'USER') {
      const user = await this.prisma.user.findUnique({
        where: { id: accountId },
      });
      if (!user) throw new NotFoundException('User not found');
      if (!user.isOwnerAccount) {
        throw new BadRequestException('Only owner accounts are verified here');
      }

      const updates: Prisma.UserUpdateInput = {
        verificationStatus: status,
        verificationNote: note ?? user.verificationNote,
      };
      if (status === VerificationStatus.APPROVED) {
        updates.verificationAttempts = 0;
        await this.prisma.verificationDocument.updateMany({
          where: { accountType: 'USER', userId: accountId, ...pendingWhere },
          data: { status: VerificationStatus.APPROVED },
        });
      } else if (
        status === VerificationStatus.REJECTED ||
        status === VerificationStatus.BLOCKED
      ) {
        await this.prisma.verificationDocument.updateMany({
          where: { accountType: 'USER', userId: accountId, ...pendingWhere },
          data: { status: VerificationStatus.REJECTED },
        });
      }
      await this.prisma.user.update({ where: { id: accountId }, data: updates });

      if (notify) {
        const messages: Record<string, string> = {
          APPROVED:
            'Your account verification has been approved. You can now operate the system.',
          REJECTED: `Your account verification was rejected${note ? `: ${note}` : '.'}`,
          BLOCKED:
            'Your account has been blocked for repeated failed verification attempts.',
          FLAGGED:
            'Your account verification needs additional review. Please check for updates.',
        };
        await this.notifications.notifyUser(
          accountId,
          'Account verification update',
          messages[status],
          'ACCOUNT_VERIFICATION',
        );
      }
      return { accountType, accountId, verificationStatus: status };
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: accountId },
    });
    if (!org) throw new NotFoundException('Business not found');

    const updates: Prisma.OrganizationUpdateInput = {
      verificationStatus: status,
      verificationNote: note ?? org.verificationNote,
    };
    if (status === VerificationStatus.APPROVED) {
      updates.verificationAttempts = 0;
      await this.prisma.verificationDocument.updateMany({
        where: { accountType: 'BUSINESS', organizationId: accountId, ...pendingWhere },
        data: { status: VerificationStatus.APPROVED },
      });
    } else if (
      status === VerificationStatus.REJECTED ||
      status === VerificationStatus.BLOCKED
    ) {
      await this.prisma.verificationDocument.updateMany({
        where: { accountType: 'BUSINESS', organizationId: accountId, ...pendingWhere },
        data: { status: VerificationStatus.REJECTED },
      });
    }
    await this.prisma.organization.update({
      where: { id: accountId },
      data: updates,
    });

    if (notify) {
      const owners = await this.prisma.membership.findMany({
        where: { organizationId: accountId, role: { isSystem: true } },
        select: { userId: true },
      });
      const messages: Record<string, string> = {
        APPROVED: `Your business "${org.name}" has been verified successfully.`,
        REJECTED: `Your business "${org.name}" verification was rejected${note ? `: ${note}` : '.'}`,
        BLOCKED: `Your business "${org.name}" has been blocked for repeated failed verification attempts.`,
        FLAGGED: `Your business "${org.name}" verification needs additional review.`,
      };
      for (const owner of owners) {
        await this.notifications.notifyUser(
          owner.userId,
          'Business verification update',
          messages[status],
          'ACCOUNT_VERIFICATION',
        );
      }
    }
    return { accountType, accountId, verificationStatus: status };
  }

  /**
   * Admin/AI action: ask the account owner to upload missing documents.
   * Notifies the user with the exact file names to upload ("Upload a picture
   * of X for approval.").
   */
  async requestDocuments(
    accountType: 'USER' | 'BUSINESS',
    accountId: number,
    documents: string[],
  ): Promise<{ message: string }> {
    const requested = (documents ?? []).map((d) => d.trim()).filter(Boolean);
    if (requested.length === 0) {
      throw new BadRequestException('List at least one document to request.');
    }

    const DOC_LABELS: Record<string, string> = {
      NATIONAL_ID: 'Renewed National ID',
      TRADE_LICENSE: 'Renewed Trade License',
      TIN_CERTIFICATE: 'TIN Registration Certificate',
    };
    const labels = requested.map((d) => DOC_LABELS[d] ?? d);

    let userId: number | null = null;
    let accountName = '';
    let tenantId: number | null = null;

    if (accountType === 'USER') {
      const user = await this.prisma.user.findUnique({
        where: { id: accountId },
        select: { id: true, name: true },
      });
      if (!user) throw new NotFoundException('User not found');
      userId = user.id;
      accountName = user.name;
      // Link the notification to the user's primary (owned) business so it
      // shows up in that business's notification feed.
      const owned = await this.prisma.membership.findFirst({
        where: { userId: user.id, role: { isSystem: true } },
        select: { organizationId: true },
        orderBy: { organizationId: 'asc' },
      });
      tenantId = owned?.organizationId ?? null;
    } else {
      const org = await this.prisma.organization.findUnique({
        where: { id: accountId },
        select: { id: true, name: true },
      });
      if (!org) throw new NotFoundException('Business not found');
      const owner = await this.prisma.membership.findFirst({
        where: { organizationId: accountId, role: { isSystem: true } },
        select: { userId: true },
      });
      userId = owner?.userId ?? null;
      accountName = org.name;
      tenantId = accountId;
    }

    if (userId == null) {
      throw new BadRequestException(
        'No owner user is linked to this account — cannot send a notification.',
      );
    }

    const message = `Upload a picture of ${labels.join(', ')} for approval.`;
    await this.notifications.notifyUser(
      userId,
      '📎 Documents needed for approval',
      message,
      'ACCOUNT_VERIFICATION',
      tenantId,
    );

    return { message: `Requested documents from ${accountName}.` };
  }

  private async assertCanManageBusiness(userId: number, organizationId: number) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { role: true },
    });
    if (!membership || !membership.role?.isSystem) {
      throw new ForbiddenException(
        'Only the business owner can upload verification documents for this business.',
      );
    }
  }

  private assertNotBlocked(status: string) {
    if (status === VerificationStatus.BLOCKED) {
      throw new ForbiddenException(
        'This account has been permanently blocked for repeated fraudulent verification attempts.',
      );
    }
  }

  /**
   * Re-upload gating: a document can only be (re-)submitted when the account is
   * PENDING (nothing submitted yet) or REJECTED (the previous review finished
   * and asked for a legitimate file). While SUBMITTED/FLAGGED it is under review
   * and the uploader must wait for the AI/admin decision.
   */
  private assertCanSubmit(status: string) {
    if (status === VerificationStatus.APPROVED) {
      throw new BadRequestException(
        'This account is already verified. No further documents are needed.',
      );
    }
    if (
      status === VerificationStatus.SUBMITTED ||
      status === VerificationStatus.FLAGGED
    ) {
      throw new BadRequestException(
        'Your document is under review. You can upload a new document once the review is completed.',
      );
    }
  }
}

