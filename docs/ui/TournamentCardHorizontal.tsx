import React from 'react';

export type TournamentType = 'Американо' | 'Мексикано';

export interface TournamentSubscription {
  label: string;
  price: string;
}

export interface TournamentCardHorizontalProps {
  time: string;
  durationMinutes: number;
  title: string;
  location: string;
  organizerName: string;
  organizerAvatarUrl?: string;
  participants: number;
  capacity: number;
  formatLabel: string;
  type: TournamentType;
  subscriptions: TournamentSubscription[];
  freeSpots: number;
  onActionClick?: () => void;
  className?: string;
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 19a4 4 0 0 0-8 0" />
      <circle cx="12" cy="11" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 19a4 4 0 0 0-3-3.87" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19a4 4 0 0 1 3-3.87" />
    </svg>
  );
}

export function TournamentCardHorizontal({
  time,
  durationMinutes,
  title,
  location,
  organizerName,
  organizerAvatarUrl,
  participants,
  capacity,
  formatLabel,
  type,
  subscriptions,
  freeSpots,
  onActionClick,
  className
}: TournamentCardHorizontalProps) {
  const isFull = freeSpots <= 0;
  const actionLabel = isFull ? 'Лист ожидания' : 'Записаться';
  const placesLabel = isFull ? 'Нет мест' : `${freeSpots} мест`;

  return (
    <article
      className={[
        'w-full rounded-2xl border border-[#ECECF2] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.05)]',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className="w-[62px] shrink-0">
          <p className="text-[20px] font-semibold leading-[1.05] tracking-[-0.01em] text-[#171A25]">{time}</p>
          <p className="mt-1 text-[13px] leading-none text-[#8A8F98]">{durationMinutes} мин</p>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-[1.2] text-[#171A25]">{title}</h3>

          <div className="mt-1.5 flex items-center gap-1 text-[14px] leading-none text-[#666D7A]">
            <PinIcon />
            <span className="truncate">{location}</span>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-[#ECEFF3]">
              {organizerAvatarUrl ? (
                <img src={organizerAvatarUrl} alt={organizerName} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs font-medium text-[#6B7280]">
                  {organizerName
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
              )}
            </div>
            <p className="truncate text-[14px] leading-none text-[#1E2230]">{organizerName}</p>
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-[14px] leading-none text-[#3A4051]">
            <UsersIcon />
            <span>
              {participants} / {capacity} {formatLabel}
            </span>
          </div>
        </div>

        <div className="w-[114px] shrink-0 text-right">
          <span
            className={[
              'inline-flex rounded-xl px-2.5 py-1 text-[12px] font-medium leading-none',
              type === 'Американо' ? 'bg-[#EFE9FF] text-[#6D53C8]' : 'bg-[#FFF0E2] text-[#BC6D21]'
            ].join(' ')}
          >
            {type}
          </span>

          <div className="mt-2 space-y-1 text-[12px] leading-[1.2] text-[#666D7A]">
            {subscriptions.slice(0, 2).map((item, index) => (
              <p key={`${item.label}-${index}`} className="truncate">
                {item.label} · {item.price}
              </p>
            ))}
          </div>

          <span className="mt-2 inline-flex rounded-xl bg-[#F3F4F7] px-2.5 py-1 text-[12px] leading-none text-[#4A5162]">
            {placesLabel}
          </span>
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={onActionClick}
          className="h-10 min-w-[188px] rounded-[20px] border border-[#DADDEA] bg-white px-5 text-[14px] font-medium text-[#21263A] transition-colors hover:bg-[#F6F7FA] active:bg-[#EDF0F5]"
        >
          {actionLabel}
        </button>
      </div>
    </article>
  );
}

export default TournamentCardHorizontal;
