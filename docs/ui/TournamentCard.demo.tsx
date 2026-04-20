import React from 'react';
import { TournamentCard } from './TournamentCard';

const participants = [
  { id: '1', name: 'Игорь\nМахнов', levelLabel: 'D+' },
  { id: '2', name: 'Дани\nИсаев', levelLabel: 'D+' },
  { id: '3', name: 'Елена\nПолкова', levelLabel: 'C+' },
  { id: '4', name: 'Алисия\nВадиков', levelLabel: 'C+' },
  { id: '5', name: 'Евгений\nМордров', levelLabel: 'D+' },
  { id: '6', name: 'Мордвинов\nРавин', levelLabel: 'C+' },
  { id: '7', name: 'Валерий\nТкачев', levelLabel: 'D+' },
  { id: '8', name: 'Ткачев\nМаков', levelLabel: 'C+' },
  { id: '9', name: 'Максим\nРаков', levelLabel: 'D+' },
  { id: '10', name: 'Павел\nОрлов', levelLabel: 'D+' },
  { id: '11', name: 'Илья\nПавлов', levelLabel: 'D+' },
  { id: '12', name: 'Павлов\nСВ', levelLabel: 'C+' }
].map((item) => ({
  ...item,
  name: item.name.replace('\n', ' ')
}));

export function TournamentCardDemo() {
  return (
    <section className="mx-auto w-full max-w-[420px] bg-[linear-gradient(180deg,#F1E7FF_0%,#FFF7FB_100%)] p-4">
      <TournamentCard
        title="Padel Weekend Cup"
        subtitle="от PadlxAB"
        monthBadge="АПР"
        dayBadge="15"
        statusTitle="Вы в турнире!"
        organizerName="Игорь Махнов"
        organizerRoleLabel="Организатор"
        participants={participants}
        warmup={{
          title: 'РАЗМИНКА!',
          startsAt: '09:00',
          note: 'Площадка. Разогреваемся.',
          players: participants.slice(0, 4)
        }}
        capacity={16}
        divisionLabel="MIX"
        subscriptions={[
          { label: 'Абонемент турниры', price: '1 списание' },
          { label: 'Покупка участия', price: '2 500 ₽' }
        ]}
      />
    </section>
  );
}

export default TournamentCardDemo;
