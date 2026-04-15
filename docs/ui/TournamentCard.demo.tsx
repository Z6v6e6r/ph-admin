import React from 'react';
import { TournamentCard } from './TournamentCard';

const demoItems = [
  {
    id: 'open',
    time: '18:00',
    durationText: '120 мин',
    title: 'Падел турнир от PadlxAB',
    tournamentLabel: 'Padel турнир',
    location: 'Селигерская',
    organizerName: 'Artem Nikitin',
    organizerAvatarUrl: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=128&q=80',
    participants: 1,
    capacity: 12,
    divisionLabel: 'MIX',
    format: 'Американо' as const,
    subscriptions: [
      { label: 'Энергия 1', price: '5500 ₽' },
      { label: 'Энергия 5', price: '3960 ₽' }
    ],
    freeSpots: 11,
    actionLabel: 'Записаться' as const
  },
  {
    id: 'full',
    time: '20:00',
    durationText: '120 мин',
    title: 'Падел турнир от PadlxAB',
    tournamentLabel: 'Padel турнир',
    location: 'Селигерская',
    organizerName: 'Maria Smirnova',
    organizerAvatarUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=128&q=80',
    participants: 12,
    capacity: 12,
    divisionLabel: 'MIX',
    format: 'Мексикано' as const,
    subscriptions: [
      { label: 'Энергия 1', price: '5500 ₽' },
      { label: 'Энергия 5', price: '3960 ₽' }
    ],
    freeSpots: 0,
    actionLabel: 'Просмотр' as const
  }
];

export function TournamentCardDemo() {
  return (
    <section className="mx-auto w-full max-w-md space-y-3 bg-[#F6F6FA] p-3">
      {demoItems.map((item) => (
        <TournamentCard key={item.id} {...item} />
      ))}
    </section>
  );
}

export default TournamentCardDemo;
