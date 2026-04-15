import React from 'react';

export type TournamentFormat = 'Американо' | 'Мексикано';

export interface TournamentCardSubscription {
  label: string;
  price: string;
}

export interface TournamentCardProps {
  time: string;
  durationText: string;
  title: string;
  tournamentLabel: string;
  location: string;
  organizerName: string;
  organizerAvatarUrl?: string;
  participants: number;
  capacity: number;
  divisionLabel: string;
  format: TournamentFormat;
  subscriptions: TournamentCardSubscription[];
  freeSpots: number;
  actionLabel?: 'Просмотр' | 'Записаться';
  onActionClick?: () => void;
  className?: string;
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[16px] w-[16px]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 19a4 4 0 0 0-8 0" />
      <circle cx="12" cy="11" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 19a4 4 0 0 0-3-3.87" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19a4 4 0 0 1 3-3.87" />
    </svg>
  );
}

export function TournamentCard({
  time,
  durationText,
  title,
  tournamentLabel,
  location,
  organizerName,
  organizerAvatarUrl,
  participants,
  capacity,
  divisionLabel,
  format,
  subscriptions,
  freeSpots,
  actionLabel,
  onActionClick,
  className
}: TournamentCardProps) {
  const isFull = freeSpots <= 0;
  const placesLabel = isFull ? 'Нет мест' : `${freeSpots} мест`;
  const ctaLabel = actionLabel ?? (isFull ? 'Просмотр' : 'Записаться');

  return (
    <article
      className={[
        'w-full rounded-[20px] border border-[#F0F0F0] bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.06)]',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="w-[68px] shrink-0">
          <p className="text-[22px] font-bold leading-[1.05] tracking-[-0.02em] text-[#1C1C1E]">{time}</p>
          <p className="mt-1 text-[13px] leading-none text-[#8E8E93]">{durationText}</p>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold leading-[1.2] text-[#1C1C1E]">{title}</h3>

          <div className="mt-2">
            <span className="inline-flex rounded-xl bg-[#111111] px-2.5 py-1.5 text-[12px] font-medium leading-none text-white">
              {tournamentLabel}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-1 text-[13px] leading-none text-[#8E8E93]">
            <PinIcon />
            <span className="truncate">
              {durationText} • {location}
            </span>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#ECECF1]">
              {organizerAvatarUrl ? (
                <img src={organizerAvatarUrl} alt={organizerName} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs font-semibold text-[#6E6E73]">
                  {organizerName
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
              )}
            </div>
            <p className="truncate text-[14px] leading-none text-[#1C1C1E]">{organizerName}</p>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 text-[16px] font-semibold leading-none text-[#1C1C1E]">
            <UsersIcon />
            <span>
              {participants} / {capacity} {divisionLabel}
            </span>
          </div>
        </div>

        <div className="w-[112px] shrink-0 text-right">
          <span
            className={[
              'inline-flex rounded-xl px-2.5 py-1.5 text-[12px] font-medium leading-none',
              format === 'Американо' ? 'bg-[#EEE8FA] text-[#6B57A5]' : 'bg-[#FFF0E3] text-[#B26B2A]'
            ].join(' ')}
          >
            {format}
          </span>

          <div className="mt-2 space-y-1 text-[12px] leading-[1.2] text-[#8E8E93]">
            {subscriptions.slice(0, 2).map((item, index) => (
              <p key={`${item.label}-${index}`} className="truncate">
                {item.label} · {item.price}
              </p>
            ))}
          </div>

          <span
            className={[
              'mt-2 inline-flex rounded-xl px-2.5 py-1.5 text-[12px] font-medium leading-none',
              isFull ? 'bg-[#F2F2F2] text-[#636366]' : 'bg-[#EAF5EE] text-[#3A7F5B]'
            ].join(' ')}
          >
            {placesLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={onActionClick}
          className="h-11 min-w-[184px] rounded-2xl bg-[#F3F3F7] px-5 text-[16px] font-semibold text-[#D46A6A] transition-colors hover:bg-[#ECECF3] active:bg-[#E5E6EE]"
        >
          {ctaLabel}
        </button>
      </div>
    </article>
  );
}

export default TournamentCard;
