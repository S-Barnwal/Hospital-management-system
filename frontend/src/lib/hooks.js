import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data with loading/error state; `reload()` refetches. Ignores stale responses. */
export function useApi(fn, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fn();
      if (id === seq.current) setState({ data: res?.data ?? null, meta: res?.meta ?? null, loading: false, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Debounced value for search boxes. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Simple form state with server-side field errors. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const bind = (name) => ({
    name,
    value: values[name] ?? '',
    onChange: (e) => {
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setValues((s) => ({ ...s, [name]: v }));
      if (errors[name]) setErrors((s) => ({ ...s, [name]: undefined }));
    },
    'aria-invalid': errors[name] ? 'true' : undefined,
  });
  const submit = (handler) => async (e) => {
    e?.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await handler(values);
    } catch (err) {
      setErrors(err.fieldErrors || {});
      setFormError(err.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };
  return { values, setValues, errors, setErrors, bind, submit, submitting, formError, setFormError };
}
