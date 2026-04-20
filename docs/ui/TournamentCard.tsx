import React from 'react';

export interface TournamentCardParticipant {
  id: string;
  name: string;
  avatarUrl?: string;
  levelLabel?: string;
}

export interface TournamentCardWarmupSlot {
  title: string;
  startsAt: string;
  note: string;
  players: TournamentCardParticipant[];
}

export interface TournamentCardSubscription {
  label: string;
  price: string;
}

export interface TournamentCardProps {
  title: string;
  subtitle: string;
  monthBadge: string;
  dayBadge: string;
  heroImageUrl?: string;
  statusTitle: string;
  organizerName: string;
  organizerRoleLabel: string;
  organizerAvatarUrl?: string;
  participants: TournamentCardParticipant[];
  warmup?: TournamentCardWarmupSlot;
  capacity: number;
  divisionLabel: string;
  footerLabel?: string;
  primaryActionLabel?: string;
  subscriptions?: TournamentCardSubscription[];
  onActionClick?: () => void;
  className?: string;
}

function initialsFromName(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function Avatar({
  name,
  avatarUrl,
  size = 48
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
}) {
  return (
    <div
      className="shrink-0 overflow-hidden rounded-full bg-[#EEE8FF] ring-2 ring-white"
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#F5D9FF_0%,#D8E1FF_100%)] text-[12px] font-semibold text-[#56317A]">
          {initialsFromName(name)}
        </div>
      )}
    </div>
  );
}

function LevelPill({ levelLabel }: { levelLabel?: string }) {
  if (!levelLabel) {
    return null;
  }

  return (
    <span className="inline-flex rounded-full bg-[linear-gradient(135deg,#F4B567_0%,#F07C5A_100%)] px-2 py-0.5 text-[11px] font-semibold leading-none text-white shadow-[0_8px_18px_rgba(240,124,90,0.24)]">
      {levelLabel}
    </span>
  );
}

export function TournamentCard({
  title,
  subtitle,
  monthBadge,
  dayBadge,
  heroImageUrl,
  statusTitle,
  organizerName,
  organizerRoleLabel,
  organizerAvatarUrl,
  participants,
  warmup,
  capacity,
  divisionLabel,
  footerLabel = 'Сетка скоро появится',
  primaryActionLabel = 'Покинуть турнир',
  subscriptions = [],
  onActionClick,
  className
}: TournamentCardProps) {
  const previewPlayers = warmup?.players?.slice(0, 4) ?? participants.slice(0, 4);
  const participantCountLabel = `${participants.length} / ${capacity} ${divisionLabel}`;

  return (
    <article
      className={[
        'w-full overflow-hidden rounded-[30px] border border-white/70 bg-[#FFFCFF] shadow-[0_24px_64px_rgba(77,37,117,0.16)]',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="relative overflow-hidden px-5 pb-4 pt-5 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(255,255,255,0.4),transparent_30%),linear-gradient(135deg,#CBA6FF_0%,#8C72F6_50%,#6F56E9_100%)]" />
        {heroImageUrl ? (
          <img
            src={heroImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover mix-blend-screen opacity-35"
            loading="lazy"
          />
        ) : null}

        <div className="relative flex items-start justify-between gap-3">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/16 text-xl leading-none text-white backdrop-blur-sm"
            aria-label="Назад"
          >
            ←
          </button>

          <div className="rounded-[18px] bg-[#5E44D6]/80 px-3 py-2 text-center shadow-[0_12px_28px_rgba(59,28,121,0.28)] backdrop-blur-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
              {monthBadge}
            </div>
            <div className="mt-1 text-[32px] font-semibold leading-none">{dayBadge}</div>
            <div className="mt-1 text-[11px] font-medium text-white/82">в календарь</div>
          </div>
        </div>

        <div className="relative mt-6 flex items-center gap-4">
          <div className="grid h-[84px] w-[84px] place-items-center rounded-[28px] bg-white/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] backdrop-blur-sm">
            <div className="text-[42px] leading-none">🎾</div>
          </div>
          <div className="min-w-0">
            <h2 className="text-[34px] font-semibold leading-[0.95] tracking-[-0.04em]">
              {title}
            </h2>
            <p className="mt-2 text-[18px] font-medium text-white/86">{subtitle}</p>
          </div>
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="rounded-[26px] bg-white px-4 pb-4 pt-3 shadow-[0_12px_32px_rgba(59,28,121,0.08)]">
          <div className="text-[32px] font-semibold leading-none tracking-[-0.04em] text-[#232028]">
            {statusTitle}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-[22px] bg-[#FCFAFF] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(122,92,181,0.08)]">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={organizerName} avatarUrl={organizerAvatarUrl} size={42} />
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold text-[#232028]">
                  {organizerName}
                </div>
                <div className="text-[13px] font-medium text-[#6F6780]">
                  {organizerRoleLabel}
                </div>
              </div>
            </div>
            <span className="inline-flex rounded-full bg-[#F4EDFF] px-3 py-1 text-[12px] font-semibold text-[#7A56C6]">
              Организатор
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[18px] bg-[#FAF8FC] p-1 shadow-[inset_0_0_0_1px_rgba(122,92,181,0.08)]">
            <div className="rounded-[14px] bg-[linear-gradient(135deg,#935EFF_0%,#7B53F7_100%)] px-3 py-2 text-center text-[15px] font-semibold text-white">
              Статус
            </div>
            <div className="px-3 py-2 text-center text-[15px] font-medium text-[#5F5A6E]">
              Регламент
            </div>
          </div>

          {warmup ? (
            <section className="mt-4 rounded-[20px] border border-[#EEE7F8] bg-[#FFFDFF] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[18px] font-semibold text-[#232028]">Участники турнира</div>
                  <div className="mt-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-[#3B3247]">
                    {warmup.title}
                  </div>
                </div>
                <div className="text-[14px] font-semibold text-[#4A4456]">{participantCountLabel}</div>
              </div>

              <div className="mt-1 text-[14px] text-[#6D657A]">
                {warmup.startsAt} • {warmup.note}
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-[18px] bg-[#FBF8FF] px-3 py-2">
                <div className="flex -space-x-3">
                  {previewPlayers.map((player) => (
                    <Avatar
                      key={`preview-${player.id}`}
                      name={player.name}
                      avatarUrl={player.avatarUrl}
                      size={34}
                    />
                  ))}
                </div>
                <LevelPill
                  levelLabel={
                    previewPlayers.length > 0
                      ? previewPlayers[previewPlayers.length - 1]?.levelLabel
                      : undefined
                  }
                />
              </div>
            </section>
          ) : null}

          <section className="mt-4 rounded-[20px] border border-[#EEE7F8] bg-[#FFFDFF] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[18px] font-semibold text-[#232028]">Участники турнира</div>
                <div className="mt-0.5 text-[14px] text-[#7B7389]">{participantCountLabel}</div>
              </div>
              <div className="text-[18px] font-semibold text-[#232028]">{participantCountLabel}</div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-4">
              {participants.map((player) => (
                <div key={player.id} className="flex flex-col items-center text-center">
                  <div className="relative">
                    <Avatar name={player.name} avatarUrl={player.avatarUrl} size={56} />
                    <div className="absolute -right-1 bottom-0">
                      <LevelPill levelLabel={player.levelLabel} />
                    </div>
                  </div>
                  <div className="mt-2 text-[15px] font-medium leading-[1.1] text-[#413A4D]">
                    {player.name}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[16px] bg-[#FBF8FF] px-4 py-3 text-center text-[15px] font-medium text-[#8A7FA1] shadow-[inset_0_0_0_1px_rgba(122,92,181,0.08)]">
              {footerLabel}
            </div>
          </section>

          {subscriptions.length > 0 ? (
            <div className="mt-4 rounded-[18px] bg-[#FFF7F2] px-3 py-3 text-[13px] text-[#7B5B4A]">
              {subscriptions.map((item) => (
                <div key={`${item.label}-${item.price}`} className="flex items-center justify-between gap-3">
                  <span>{item.label}</span>
                  <span className="font-semibold">{item.price}</span>
                </div>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onActionClick}
            className="mt-5 h-14 w-full rounded-[20px] bg-[linear-gradient(135deg,#FF6E77_0%,#FF5647_100%)] text-[20px] font-semibold text-white shadow-[0_18px_40px_rgba(255,86,71,0.26)] transition-transform active:scale-[0.99]"
          >
            {primaryActionLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

export default TournamentCard;
