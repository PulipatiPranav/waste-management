import type { ReactNode } from 'react';

/** A titled content card — the console's primary container. */
export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title !== undefined || actions !== undefined) && (
        <header className="card__head">
          {title !== undefined && <h2 className="card__title">{title}</h2>}
          {actions !== undefined && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A coloured status pill. `tone` maps a status string to a semantic colour. */
export function StatusBadge({ value }: { value: string }) {
  return <span className={`badge badge--${tone(value)}`}>{value}</span>;
}

function tone(value: string): string {
  const v = value.toUpperCase();
  if (['CONFIRMED', 'COMPLETED', 'DELIVERED', 'VERIFIED', 'PAID', 'ACTIVE', 'APPROVED'].includes(v))
    return 'good';
  if (['PENDING', 'PENDING_PAYMENT', 'REQUESTED', 'DRAFT', 'ASSIGNED', 'CREATED'].includes(v))
    return 'wait';
  if (['FAILED', 'CANCELLED', 'REJECTED', 'SUSPENDED', 'FLAGGED'].includes(v)) return 'bad';
  return 'neutral';
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}
    </p>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

export function Button({
  children,
  onClick,
  type = 'button',
  disabled,
  variant = 'primary',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`btn btn--${variant}`}>
      {children}
    </button>
  );
}

/** A minimal data table. Columns render a cell from a row. */
export function Table<T>({
  columns,
  rows,
  rowKey,
}: {
  columns: { header: string; cell: (row: T) => ReactNode }[];
  rows: T[];
  rowKey: (row: T) => string;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.header}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.header}>{col.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
