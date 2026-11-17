import type { ReactElement } from 'react';
import { t } from '../i18n/index.ts';
import { UsernameForm, type UsernameFormProps } from './UsernameForm.tsx';

/** Onboarding step "choose a username" (SPEC 9.3). */
export function UsernameScreen(
  props: Omit<UsernameFormProps, 'submitLabel' | 'onCancel'>,
): ReactElement {
  return (
    <main className="onboard-screen" data-testid="username-screen">
      <h1 className="onboard-screen__title">{t('username.title')}</h1>
      <p className="onboard-screen__intro">{t('username.intro')}</p>
      <UsernameForm {...props} submitLabel={t('username.next')} />
    </main>
  );
}
