import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { DateStrip, SectionHead } from '../../components/HomeSections.jsx';
import { Card, Empty, SkeletonRows } from '../../components/ui.jsx';
import { MatchRow, TourTabs } from '../components.jsx';
import { etDay } from '../data.jsx';

const ORDER = { in: 0, pre: 1, post: 2 };
const label = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
const md = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function TennisHome() {
  const { data, loading } = useData();
  const today = etDay(Date.now());
  const days = useMemo(() => {
    const m = new Map();
    for (const x of data?.matches || []) {
      const k = etDay(x.date);
      if (!m.has(k)) m.set(k, { ymd: k, live: false });
      if (x.state === 'in') m.get(k).live = true;
    }
    return [...m.values()].sort((a, b) => (a.ymd < b.ymd ? -1 : 1)).map((d) => ({ ...d, top: md(d.ymd), bottom: d.ymd === today ? 'Today' : label(d.ymd) }));
  }, [data, today]);
  const [day, setDay] = useState(null);
  const sel = day && days.some((d) => d.ymd === day) ? day : (days.find((d) => d.live) || days.find((d) => d.ymd >= today) || days[days.length - 1])?.ymd;
  const [ev, setEv] = useState('ALL');

  const groups = useMemo(() => {
    const list = (data?.matches || []).filter((m) => etDay(m.date) === sel && (ev === 'ALL' || m.eventId === ev));
    const by = new Map();
    for (const m of list.sort((a, b) => ORDER[a.state] - ORDER[b.state] || new Date(a.date) - new Date(b.date))) {
      if (!by.has(m.event)) by.set(m.event, []);
      by.get(m.event).push(m);
    }
    return [...by.entries()];
  }, [data, sel, ev]);
  const events = data?.events?.filter((e) => (data.matches || []).some((m) => m.eventId === e.id)) || [];

  return (
    <div className="page t-home">
      <TourTabs />
      {!data ? (loading ? <Card><SkeletonRows n={8} h={56} /></Card> : <Card><Empty title="Tennis data unavailable">Try again in a minute.</Empty></Card>) : (
        <>
          {events.length > 1 && (
            <div className="t-events">
              <button type="button" className={ev === 'ALL' ? 'on' : ''} onClick={() => setEv('ALL')}>All events</button>
              {events.map((e) => <button key={e.id} type="button" className={ev === e.id ? 'on' : ''} onClick={() => setEv(e.id)}>{e.major && '★ '}{e.name}</button>)}
            </div>
          )}
          {days.length > 0 && <DateStrip days={days} value={sel} onChange={setDay} />}
          {groups.length === 0 ? <Card><Empty title="No matches this day">Pick another day above.</Empty></Card> : groups.map(([name, list]) => (
            <section key={name} className="hs">
              <SectionHead title={name} />
              <div className="t-list" style={{ '--rows': Math.min(4, list.length) }}>{list.map((m) => <MatchRow key={m.id} m={m} d={data} />)}</div>
            </section>
          ))}
          <p className="muted small t-note">Win chances come from player ratings built on every result since last season, checked against matches the model hadn’t seen. During live matches they update from the current set and game score.</p>
        </>
      )}
    </div>
  );
}
