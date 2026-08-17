export function TextField({ label, value, onChange, placeholder, ...rest }) {
  return (
    <label className="field">
      {label ? <span>{label}</span> : null}
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </label>
  );
}

export function NumField({ label, value, onChange, min, max, step = 1, ...rest }) {
  return (
    <label className="field">
      {label ? <span>{label}</span> : null}
      <input
        type="number"
        value={value ?? 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? 0 : Number(raw));
        }}
        {...rest}
      />
    </label>
  );
}

export function AreaField({ label, value, onChange, rows = 3, placeholder }) {
  return (
    <label className="field">
      {label ? <span>{label}</span> : null}
      <textarea
        rows={rows}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function SelectField({ label, value, onChange, options, ...rest }) {
  return (
    <label className="field">
      {label ? <span>{label}</span> : null}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => {
          const val = typeof o === 'string' ? o : o.value;
          const text = typeof o === 'string' ? o : o.label;
          return (
            <option key={val} value={val}>
              {text}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function CheckField({ label, checked, onChange, title }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** 0-6 pip track, as on the reference sheet. Click a pip to set the rating. */
export function PipTrack({ value = 0, max = 6, onChange, title }) {
  return (
    <span className="pips" title={title}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={`pip ${n <= value ? 'on' : ''}`}
          aria-label={`Set to ${n}`}
          onClick={() => onChange(value === n ? n - 1 : n)}
        />
      ))}
    </span>
  );
}

export function RollButton({ onClick, title = 'Roll', label = '⚅' }) {
  return (
    <button type="button" className="roll-btn" title={title} onClick={onClick}>
      {label}
    </button>
  );
}
