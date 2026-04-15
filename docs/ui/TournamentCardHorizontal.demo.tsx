import React from 'react';
import { TournamentCardHorizontal } from './TournamentCardHorizontal';

const tournaments = [
  {
    id: 'full-1',
    time: '18:00',
    durationMinutes: 120,
    title: 'Падел турнир от PadlxAB',
    location: 'Терехово',
    organizerName: 'Artem Nikitin',
    organizerAvatarUrl: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&w=128&q=80',
    participants: 16,
    capacity: 16,
    formatLabel: 'MIX',
    type: 'Американо' as const,
    subscriptions: [
      { label: 'Энергия 1', price: '5500₽' },
      { label: 'Энергия 5', price: '3960₽' }
    ],
    freeSpots: 0
  },
  {
    id: 'open-1',
    time: '20:30',
    durationMinutes: 90,
    title: 'Вечерний турнир от PadlxAB',
    location: 'Лужники',
    organizerName: 'Max Petrov',
    organizerAvatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=128&q=80',
    participants: 11,
    capacity: 16,
    formatLabel: 'MIX',
    type: 'Мексикано' as const,
    subscriptions: [
      { label: 'Энергия 1', price: '6200₽' },
      { label: 'Энергия 5', price: '4200₽' }
    ],
    freeSpots: 5
  }
];

export function TournamentCardHorizontalDemo() {
  return (
    <section className="mx-auto w-full max-w-md space-y-3 bg-[#F7F8FA] p-3">
      {tournaments.map((tournament) => (
        <TournamentCardHorizontal key={tournament.id} {...tournament} />
      ))}
    </section>
  );
}

export default TournamentCardHorizontalDemo;
