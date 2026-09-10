// src/ai/platform-facts.ts
// LIVE PLATFORM FACTS for the public onboarding assistant.
//
// Everything here is derived from real code (permissions catalog, verticals,
// auth/tenants/AI-usage constants) so that dynamic claims — verification
// model, AI trial days, chat quota, modules per business type — can never
// drift out of date like hand-written prose can. The assistant is instructed
// that this section takes precedence over the static guide.

import { BusinessType } from '@prisma/client';
import { PERMISSION_GROUPS_BY_BUSINESS_TYPE } from '../common/permissions';

/** Single place to set the support address used by the assistant & widget. */
export const SUPPORT_EMAIL = 'support@kass.inv (placeholder)';

export interface PlatformFacts {
  verification: {
    type: 'manual_admin_review';
    emailLinkSent: boolean;
    summary: string[];
  };
  signupFields: { label: string; note?: string }[];
  ai: {
    trialDays: number;
    defaultDailyChatQuota: number;
    publicAssistDailyLimit: number;
  };
  notifications: { emailEnabled: boolean; channels: string[] };
  modulesByBusinessType: Record<BusinessType, string[]>;
  supportEmail: string;
}

export function getPlatformFacts(): PlatformFacts {
  return {
    verification: {
      type: 'manual_admin_review',
      emailLinkSent: false,
      summary: [
        'Signup is a single form — there is no email verification and no link in an inbox or spam folder.',
        'New accounts start PENDING; platform admins are notified inside the app and review the account plus the uploaded national-ID document.',
        'Until that review is done the account cannot operate.',
      ],
    },
    signupFields: [
      { label: 'Full name' },
      { label: 'Email' },
      { label: 'Phone number' },
      {
        label: 'Password',
        note: 'at least 8 characters, letters and numbers, shown/hidden with a toggle',
      },
      {
        label: 'National ID document upload',
        note: 'uploaded on the signup form and used for the manual account review',
      },
    ],
    ai: {
      trialDays: 15,
      defaultDailyChatQuota: 15,
      publicAssistDailyLimit: 5,
    },
    notifications: {
      emailEnabled: false,
      channels: ['in-app', 'browser push'],
    },
    modulesByBusinessType: PERMISSION_GROUPS_BY_BUSINESS_TYPE,
    supportEmail: SUPPORT_EMAIL,
  };
}

const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  [BusinessType.RETAIL]: 'Retail',
  [BusinessType.HOSPITALITY]: 'Hospitality (restaurant/hotel)',
  [BusinessType.MANUFACTURING]: 'Manufacturing',
  [BusinessType.SERVICE]: 'Service',
};

export function buildPlatformFactsText(): string {
  const facts = getPlatformFacts();
  const lines: string[] = [
    '- VERIFICATION MODEL: manual platform-admin review. emailLinkSent = false. There is no email verification.',
    `- Signup fields (current form): ${facts.signupFields.map((f) => f.label).join(', ')}.`,
    `- AI free trial: ${facts.ai.trialDays} days (new organizations). Default AI chat quota per user per day: ${facts.ai.defaultDailyChatQuota}. Public assistant: ${facts.ai.publicAssistDailyLimit} chats per device per day.`,
    `- Notifications channels: ${facts.notifications.channels.join(', ')}. Email is NOT enabled.`,
  ];
  for (const [type, label] of Object.entries(BUSINESS_TYPE_LABELS)) {
    const modules = facts.modulesByBusinessType[type as BusinessType];
    if (modules?.length) {
      lines.push(`- ${label} modules: ${modules.join(', ')}.`);
    }
  }
  lines.push(`- Support contact: ${facts.supportEmail} (placeholder — update in platform-facts.ts).`);
  return lines.join('\n');
}
