import React from 'react';
import { TournamentCard } from './TournamentCard';

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
  return (
    <TournamentCard
      time={time}
      durationText={`${durationMinutes} мин`}
      title={title}
      tournamentLabel="Padel турнир"
      location={location}
      organizerName={organizerName}
      organizerAvatarUrl={organizerAvatarUrl}
      participants={participants}
      capacity={capacity}
      divisionLabel={formatLabel}
      format={type}
      subscriptions={subscriptions}
      freeSpots={freeSpots}
      actionLabel={freeSpots <= 0 ? 'Просмотр' : 'Записаться'}
      onActionClick={onActionClick}
      className={className}
    />
  );
}

export default TournamentCardHorizontal;
