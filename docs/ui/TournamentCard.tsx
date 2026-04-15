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
  actionLabel?: 'Просмотр' | 'Записаться' | 'Лист ожидания';
  onActionClick?: () => void;
  className?: string;
}

export function TournamentCard({
  time,
  durationText,
  title,
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
  const placesLabel = isFull ? 'Нет мест' : `🔥 ${freeSpots} мест`;
  const ctaLabel = actionLabel ?? (isFull ? 'Лист ожидания' : 'Записаться');

  return (
    <article
      className={[
        'w-full rounded-[20px] border border-[#F2F2F2] bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.06)]',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="w-[70px] shrink-0 text-left">
          <p className="text-[22px] font-bold leading-[1.1] text-[#1C1C1E]">{time}</p>
          <p className="mt-2 text-[13px] leading-none text-[#8E8E93]">{durationText}</p>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[16px] font-semibold leading-[1.25] text-[#1C1C1E]">{title}</h3>

          <p className="mt-2 text-[13px] leading-none text-[#8E8E93]">
            {durationText} • {location}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#ECECF1]">
              {organizerAvatarUrl ? (
                <img src={organizerAvatarUrl} alt={organizerName} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="grid h-full w-full place-items-center text-[13px] font-semibold leading-none text-[#8E8E93]">
                  {organizerName
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
              )}
            </div>
            <p className="truncate text-[13px] leading-none text-[#1C1C1E]">{organizerName}</p>
          </div>

          <div className="mt-2">
            <div className="text-[13px] font-semibold leading-none text-[#1C1C1E]">
              {participants} / {capacity} {divisionLabel}
            </div>
          </div>
        </div>

        <div className="w-[116px] shrink-0">
          <div className="flex flex-col items-end gap-1.5 text-right">
            <span
              className={[
                'inline-flex rounded-xl px-[10px] py-1 text-[12px] leading-none text-white',
                format === 'Американо' ? 'bg-[#6F5BFF]' : 'bg-[#F4A261]'
              ].join(' ')}
            >
              {format}
            </span>

            <div className="text-[12px] leading-[1.25] text-[#8E8E93]">
              {subscriptions.slice(0, 2).map((item, index) => (
                <p key={`${item.label}-${index}`} className={index > 0 ? 'mt-1' : ''}>
                  {item.label} · {item.price}
                </p>
              ))}
            </div>

            <span
              className={[
                'inline-flex rounded-xl px-2 py-0.5 text-[11px] leading-none',
                isFull ? 'bg-[#F2F2F2] text-[#999999]' : 'bg-[#FFF3E8] text-[#D97706]'
              ].join(' ')}
            >
              {placesLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={onActionClick}
          className="h-11 w-full rounded-2xl bg-[#F3F3F7] text-center text-[16px] font-semibold text-[#1C1C1E] transition-colors hover:bg-[#ECECF2] active:bg-[#E6E6ED]"
        >
          {ctaLabel}
        </button>
      </div>
    </article>
  );
}

export default TournamentCard;
