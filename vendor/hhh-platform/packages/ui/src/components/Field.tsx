import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldFrameProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
}

/** Label above, hint below, error below the hint (the standard's field layout). */
function useFieldIds(hint: unknown, error: unknown) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { id, hintId, errorId, describedBy };
}

function FieldFrame({
  id,
  label,
  hint,
  hintId,
  error,
  errorId,
  children,
}: FieldFrameProps & {
  id: string;
  hintId: string | undefined;
  errorId: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`hhh-field${error ? ' hhh-field--invalid' : ''}`}>
      <label className="hhh-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="hhh-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="hhh-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = FieldFrameProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export function TextField({ label, hint, error, className, ...rest }: TextFieldProps) {
  const ids = useFieldIds(hint, error);
  return (
    <FieldFrame label={label} hint={hint} error={error} {...ids}>
      <input
        id={ids.id}
        className={['hhh-input', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...rest}
      />
    </FieldFrame>
  );
}

export type TextareaProps = FieldFrameProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export function Textarea({ label, hint, error, className, ...rest }: TextareaProps) {
  const ids = useFieldIds(hint, error);
  return (
    <FieldFrame label={label} hint={hint} error={error} {...ids}>
      <textarea
        id={ids.id}
        className={['hhh-input', 'hhh-input--textarea', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...rest}
      />
    </FieldFrame>
  );
}

export type SelectProps = FieldFrameProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>;

export function Select({ label, hint, error, className, children, ...rest }: SelectProps) {
  const ids = useFieldIds(hint, error);
  return (
    <FieldFrame label={label} hint={hint} error={error} {...ids}>
      <select
        id={ids.id}
        className={['hhh-input', 'hhh-input--select', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...rest}
      >
        {children}
      </select>
    </FieldFrame>
  );
}

export type CheckboxProps = { label: string; hint?: ReactNode } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type'
>;

export function Checkbox({ label, hint, className, ...rest }: CheckboxProps) {
  const ids = useFieldIds(hint, undefined);
  return (
    <div className={['hhh-checkbox', className].filter(Boolean).join(' ')}>
      <input id={ids.id} type="checkbox" aria-describedby={ids.describedBy} {...rest} />
      <div>
        <label htmlFor={ids.id}>{label}</label>
        {hint ? (
          <p className="hhh-field__hint" id={ids.hintId}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
