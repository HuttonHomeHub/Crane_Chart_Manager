import type { Crane } from '../../shared/api.ts';

/** The open crane's details above the viewer. */
export function InfoBar({ crane }: { crane: Crane }) {
  const fields: Array<[string, string, string]> = [
    ['Manufacturer', 'info-make', crane.make],
    ['Type', 'info-type', crane.type],
    ['Model', 'info-model', crane.model],
    ['Capacity', 'info-capacity', crane.capacity],
  ];
  return (
    <dl id="info-bar" className="info-bar">
      {fields.map(([label, id, value]) => (
        <div key={id} className="info-bar__item">
          <dt>{label}</dt>
          <dd id={id}>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
