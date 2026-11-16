import { useEffect, useRef, type ReactElement } from 'react';
import { getBackend } from './backend/index.ts';
import type { PlayerState } from './backend/types.ts';
import { type AccountStatus, useAccountStore } from './game/accountStore.ts';
import { useBotStore } from './game/botStore.ts';
import { usePackUi } from './game/packUi.ts';
import { type Screen, type Tab, useGameStore } from './game/store.ts';
import { useLocale } from './i18n/useLocale.ts';
import { t } from './i18n/index.ts';
import { uiErrorOf } from './ui/accountText.ts';
import { PackButton } from './ui/PackButton.tsx';
import { PackModal, type OpenOutcome } from './ui/PackModal.tsx';
import { welcomeToOpen } from './ui/packLogic.ts';
import { BattleScreen } from './ui/BattleScreen.tsx';
import { DeckScreen } from './ui/DeckScreen.tsx';
import { ProfileScreen, type ProfileScreenProps } from './ui/ProfileScreen.tsx';
import { StatBar } from './ui/StatBar.tsx';
import { TabBar } from './ui/TabBar.tsx';
import { TabPager } from './ui/TabPager.tsx';
import { TitleScreen, type TitleScreenProps } from './ui/TitleScreen.tsx';
import { UsernameScreen } from './ui/UsernameScreen.tsx';
import type { UsernameFormProps } from './ui/UsernameForm.tsx';
import { LoadingScreen, WelcomeScreen, type WelcomeScreenProps } from './ui/WelcomeScreen.tsx';

export interface AppViewProps {
  status: AccountStatus;
  screen: Screen;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** Set once the player is loaded (status "onboarding" and "ready"). */
  player: PlayerState | null;
  welcome: WelcomeScreenProps;
  username: Pick<UsernameFormProps, 'checkFree' | 'onSubmit'>;
  title: Omit<TitleScreenProps, 'player'>;
  profile: Omit<ProfileScreenProps, 'player'>;
  /** Reward packs: the dialog and the button that opens it. */
  pack: {
    open: boolean;
    preferId: string | null;
    busy: boolean;
    onShow: () => void;
    onOpen: (packId: string) => Promise<OpenOutcome>;
    onClose: () => void;
  };
}

function Menu({
  player,
  tab,
  onTab,
  title,
  profile,
  onShowPacks,
}: Pick<AppViewProps, 'tab' | 'onTab' | 'title' | 'profile'> & {
  onShowPacks: () => void;
  player: PlayerState;
}): ReactElement {
  return (
    <div className="menu">
      <StatBar
        username={player.username ?? ''}
        elo={player.elo}
        gold={player.gold}
        jokers={player.jokers}
      />
      <TabPager
        tab={tab}
        onTab={onTab}
        pages={{
          deck: <DeckScreen player={player} />,
          battle: (
            <TitleScreen
              {...title}
              player={player}
              extra={<PackButton count={player.packs.length} onClick={onShowPacks} />}
            />
          ),
          profile: <ProfileScreen {...profile} player={player} />,
        }}
      />
      <TabBar tab={tab} onSelect={onTab} />
    </div>
  );
}

/** The whole app for a given state: the screen that fits the account status, then menu tabs or the battle. */
export function AppView({
  status,
  screen,
  tab,
  onTab,
  player,
  welcome,
  username,
  title,
  profile,
  pack,
}: AppViewProps): ReactElement {
  let content: ReactElement;
  if (status === 'loading') content = <LoadingScreen />;
  else if (status === 'signedOut') content = <WelcomeScreen {...welcome} />;
  else if (status === 'onboarding') content = <UsernameScreen {...username} />;
  else if (screen === 'battle') content = <BattleScreen />;
  else if (player === null) content = <LoadingScreen />;
  else {
    content = (
      <Menu
        player={player}
        tab={tab}
        onTab={onTab}
        title={title}
        profile={profile}
        onShowPacks={pack.onShow}
      />
    );
  }
  return (
    <div className="app-shell">
      <div className="app-column">
        {content}
        {status === 'ready' && player !== null && pack.open && (
          <PackModal
            key={pack.preferId ?? 'oldest'}
            packs={player.packs}
            preferId={pack.preferId}
            busy={pack.busy}
            onOpen={pack.onOpen}
            onClose={pack.onClose}
          />
        )}
      </div>
      <div className="rotate-hint" role="alert">
        <span className="rotate-hint__icon" aria-hidden="true">
          ⟳
        </span>
        <span>{t('rotate.hint')}</span>
      </div>
    </div>
  );
}

const checkFree = (name: string): Promise<boolean> => getBackend().isUsernameFree(name);

export function App(): ReactElement {
  useLocale(); // re-render everything when the player switches the language
  useEffect(() => {
    void useAccountStore.getState().init();
  }, []);
  const account = useAccountStore();
  const screen = useGameStore((s) => s.screen);
  const tab = useGameStore((s) => s.tab);
  const setTab = useGameStore((s) => s.setTab);
  const startMatch = useGameStore((s) => s.startMatch);
  const starting = useGameStore((s) => s.starting);
  const startError = useGameStore((s) => s.startError);
  const botLevel = useBotStore((s) => s.level);
  const setBotLevel = useBotStore((s) => s.setLevel);
  const packUi = usePackUi();
  const welcomeShown = useRef(false);
  const packs = account.player?.packs ?? null;
  // The guaranteed first pack opens by itself once the player is in the menu (SPEC 9.5).
  useEffect(() => {
    if (account.status !== 'ready' || screen !== 'menu' || packs === null) return;
    const welcome = welcomeToOpen(packs, welcomeShown.current);
    if (welcome === null) return;
    welcomeShown.current = true;
    usePackUi.getState().show(welcome.id);
  }, [account.status, screen, packs]);
  const backend = getBackend();
  const setName = async (name: string) => uiErrorOf(await account.setUsername(name));
  return (
    <AppView
      status={account.status}
      screen={screen}
      tab={tab}
      onTab={setTab}
      player={account.player}
      welcome={{
        methods: backend.authMethods,
        busy: account.busy,
        error: account.error?.code ?? null,
        onRetryInit: () => void account.init(),
        onGuest: account.signInAsGuest,
        onGoogle: account.signInWithGoogle,
        onEmail: account.signInWithEmail,
      }}
      username={{ checkFree, onSubmit: setName }}
      title={{
        botLevel,
        onBotLevel: setBotLevel,
        starting,
        startError,
        onPlay: () => void startMatch(),
        onResume: () => void startMatch('resume'),
        onForfeit: () => void startMatch('forfeit'),
      }}
      pack={{
        open: packUi.open,
        preferId: packUi.preferId,
        busy: account.busy,
        onShow: () => packUi.show(),
        onOpen: async (packId) => {
          const res = await account.openPack(packId);
          if (res.ok) return { ok: true, ...res.data };
          return { ok: false, error: uiErrorOf(res) ?? 'internal' };
        },
        onClose: packUi.close,
      }}
      profile={{
        user: account.user,
        mode: backend.mode,
        methods: backend.authMethods,
        checkFree,
        onRename: setName,
        onLinkGoogle: account.linkGoogle,
        onLinkEmail: account.linkEmail,
        onSignOut: () => {
          setTab('battle');
          void account.signOut();
        },
      }}
    />
  );
}
